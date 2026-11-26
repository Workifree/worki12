-- Testes de caracterizacao: 20261125000200_applications_update_hardening.sql
-- NAO e migration. Rodar a mao DEPOIS de aplicar a migration.
-- PARTE 1: read-only, pode rodar em producao.
-- PARTE 2: escreve dentro de transacao com ROLLBACK. Rodar em branch/QA/PGlite, NUNCA em producao.
--   Pre-condicoes: 1 turno 'open' com budget > 0 e 1 freela sem candidatura nele.
--   Falha = RAISE EXCEPTION.

-- ============================================================================
-- PARTE 1 — AUDITORIA (read-only)
-- ============================================================================

-- 1.1 esperado: 1 linha, definer = false, enabled = 'O'.
SELECT t.tgname, t.tgenabled AS enabled, p.prosecdef AS definer
  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE t.tgrelid = 'public.applications'::regclass AND t.tgname = 'trg_zz_applications_update_guard';

-- 1.2 Triagem (so contagens): estados que o guard nao deixa um cliente produzir.
SELECT
    count(*) FILTER (WHERE status = 'hired' AND invited_by_company_at IS NOT NULL
                       AND invitation_response IS DISTINCT FROM 'accepted')            AS contratado_sem_aceite,
    count(*) FILTER (WHERE status IN ('pending', 'invited', 'declined', 'rejected')
                       AND (company_checkin_confirmed_at IS NOT NULL
                            OR company_checkout_confirmed_at IS NOT NULL))             AS confirmacao_fora_de_hora,
    count(*) FILTER (WHERE status = 'completed'
                       AND (company_checkin_confirmed_at IS NULL
                            OR company_checkout_confirmed_at IS NULL))                 AS concluido_sem_confirmacao,
    count(*) FILTER (WHERE status = 'in_progress' AND worker_checkin_at IS NULL
                       AND company_checkin_confirmed_at IS NULL)                       AS andamento_sem_chegada
  FROM public.applications;

-- ============================================================================
-- PARTE 2 — COMPORTAMENTO (BEGIN ... ROLLBACK)
-- ============================================================================
BEGIN;

CREATE TEMP TABLE _ctx (job uuid, company uuid, owner uuid, worker uuid, stranger uuid) ON COMMIT DROP;

INSERT INTO _ctx
SELECT j.id, j.company_id, COALESCE(c.owner_id, c.id), w.id, gen_random_uuid()
  FROM public.jobs j
  JOIN public.companies c ON c.id = j.company_id
  JOIN public.workers w ON w.id <> COALESCE(c.owner_id, c.id)
   AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = j.id AND a.worker_id = w.id)
 WHERE j.status = 'open' AND j.budget > 0
 LIMIT 1;

CREATE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', p::text, true);
END $f$;

CREATE FUNCTION pg_temp.as_server() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
END $f$;

-- Cria a linha como servidor no estado p_ini e executa os passos como cliente. Cada passo e
-- 'W: <SET ...>' (freela), 'C: <SET ...>' (empresa) ou 'X: <SET ...>' (terceiro).
-- p_ok = true : todos os passos passam (1 linha).
-- p_ok = false: os passos anteriores passam e o ULTIMO e recusado pelo guard/validador/RLS.
-- p_ini: s=status, inv=convite, exp=prazo em horas, wi/wo/ci/co=carimbos. Tudo e desfeito no fim.
-- p_turno = SET aplicado ao turno (padrao: aberto, hoje, sem horario). p_check = condicao sobre a
-- linha final, avaliada como servidor (so em casos legitimos).
CREATE FUNCTION pg_temp.caso(p_label text, p_ok boolean, p_ini jsonb, p_passos text[],
                             p_turno text DEFAULT NULL, p_check text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
    x record;
    v_app uuid; v_i integer; v_n integer; v_err text; v_state text; v_bool boolean;
BEGIN
    SELECT * INTO x FROM _ctx;
    BEGIN
        PERFORM pg_temp.as_server();
        EXECUTE format('UPDATE public.jobs SET %s WHERE id = %L',
                       COALESCE(p_turno, $s$status='open', start_date=now(), work_start_time=NULL$s$), x.job);
        INSERT INTO public.applications (job_id, worker_id, status, invited_by_company_at,
            invitation_expires_at, invitation_response,
            worker_checkin_at, worker_checkout_at,
            company_checkin_confirmed_at, company_checkout_confirmed_at)
        VALUES (x.job, x.worker, p_ini->>'s',
            CASE WHEN (p_ini->>'inv')::boolean THEN now() END,
            now() + make_interval(hours => (p_ini->>'exp')::int),
            CASE WHEN (p_ini->>'inv')::boolean AND p_ini->>'s' <> 'invited' THEN 'accepted' END,
            CASE WHEN p_ini ? 'wi' THEN now() END, CASE WHEN p_ini ? 'wo' THEN now() END,
            CASE WHEN p_ini ? 'ci' THEN now() END, CASE WHEN p_ini ? 'co' THEN now() END)
        RETURNING id INTO v_app;

        FOR v_i IN 1 .. array_length(p_passos, 1) LOOP
            PERFORM pg_temp.as_user(CASE left(p_passos[v_i], 1)
                        WHEN 'W' THEN x.worker WHEN 'C' THEN x.owner ELSE x.stranger END);
            v_err := NULL; v_n := 0;
            BEGIN
                SET LOCAL ROLE authenticated;
                EXECUTE format('UPDATE public.applications SET %s WHERE id = %L', substr(p_passos[v_i], 4), v_app);
                GET DIAGNOSTICS v_n = ROW_COUNT;
                RESET ROLE;
            EXCEPTION WHEN OTHERS THEN
                v_err := SQLERRM; v_state := SQLSTATE;
            END;
            RESET ROLE;

            -- Contratacao pull: passar do guard e parar na reserva de escrow por saldo e sucesso.
            IF v_err ~* '(saldo|escrow|carteira)' AND v_err !~ 'applications_update_guard' THEN
                v_err := NULL; v_n := 1;
            END IF;

            IF p_ok OR v_i < array_length(p_passos, 1) THEN
                IF v_err IS NOT NULL OR v_n <> 1 THEN
                    RAISE EXCEPTION 'FALHA [%] passo %: devia passar (linhas=%, erro=%)', p_label, v_i, v_n, v_err;
                END IF;
            ELSIF v_err IS NULL THEN
                IF v_n <> 0 THEN
                    RAISE EXCEPTION 'FALHA [%]: ataque foi aceito', p_label;
                END IF;
            ELSIF NOT (v_err LIKE 'applications_update_guard:%' OR v_state IN ('P0001', '42501')) THEN
                RAISE EXCEPTION 'FALHA [%]: recusado por causa inesperada: % %', p_label, v_state, v_err;
            END IF;
        END LOOP;

        IF p_check IS NOT NULL THEN
            PERFORM pg_temp.as_server();
            EXECUTE format('SELECT %s FROM public.applications WHERE id = %L', p_check, v_app) INTO v_bool;
            IF v_bool IS NOT TRUE THEN
                RAISE EXCEPTION 'FALHA [%]: linha final divergente (%)', p_label, p_check;
            END IF;
        END IF;

        RAISE EXCEPTION USING ERRCODE = 'ZZ999', MESSAGE = 'desfaz';
    EXCEPTION WHEN SQLSTATE 'ZZ999' THEN
        NULL;
    END;
    PERFORM pg_temp.as_server();
    RAISE NOTICE 'ok [%] %', CASE WHEN p_ok THEN 'legitimo' ELSE 'bloqueado' END, p_label;
END $f$;

DO $t$
DECLARE
    pend  jsonb := '{"s":"pending","inv":false}';
    interv jsonb := '{"s":"interview","inv":false}';
    inv   jsonb := '{"s":"invited","inv":true,"exp":24}';
    invx  jsonb := '{"s":"invited","inv":true,"exp":-1}';
    inv0  jsonb := '{"s":"invited","inv":true}';
    hired jsonb := '{"s":"hired","inv":true}';
    prog_w jsonb := '{"s":"in_progress","inv":true,"wi":1}';
    prog_wo jsonb := '{"s":"in_progress","inv":true,"wi":1,"wo":1}';
    prog_c jsonb := '{"s":"in_progress","inv":true,"ci":1}';
    prog_all jsonb := '{"s":"in_progress","inv":true,"wi":1,"wo":1,"ci":1,"co":1}';
    done  jsonb := '{"s":"completed","inv":true,"wi":1,"wo":1,"ci":1,"co":1}';
    canc  jsonb := '{"s":"cancelled","inv":true}';
    decl  jsonb := '{"s":"declined","inv":true}';
    rej   jsonb := '{"s":"rejected","inv":false}';
    accept text := $s$W: status='hired', invitation_response='accepted', invitation_responded_at=now()$s$;
    -- turnos relativos a agora (data local + horario texto, como no produto)
    em text := $s$status='open', start_date=(((now() + interval '%1$s') AT TIME ZONE 'America/Sao_Paulo')::date + time '12:00') AT TIME ZONE 'America/Sao_Paulo', work_start_time=to_char((now() + interval '%1$s') AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI')$s$;
    futuro text := $s$status='open', start_date=now() + interval '5 days', work_start_time='08:00'$s$;
    apagado text := $s$status='deleted', start_date=now(), work_start_time=NULL$s$;
    w_in text := $s$W: worker_checkin_at=now(), status='in_progress'$s$;
    c_in text := $s$C: company_checkin_confirmed_at=now(), status='in_progress'$s$;
    v_job uuid;
BEGIN
    SELECT job INTO v_job FROM _ctx;
    IF v_job IS NULL THEN
        RAISE EXCEPTION 'PRE-CONDICAO: sem turno open com budget e freela livre.';
    END IF;

    -- ---------------- LEGITIMOS (cada payload igual ao do frontend) ----------------
    PERFORM pg_temp.caso('respondToInvite aceitar', true, inv, ARRAY[accept]);
    PERFORM pg_temp.caso('aceitar convite sem prazo', true, inv0, ARRAY[accept]);
    PERFORM pg_temp.caso('respondToInvite recusar', true, inv,
        ARRAY[$s$W: status='declined', invitation_response='declined', invitation_responded_at=now()$s$]);
    PERFORM pg_temp.caso('ciclo completo', true, inv, ARRAY[accept,
        $s$W: worker_checkin_at=now(), status='in_progress'$s$,
        $s$C: company_checkin_confirmed_at=now(), status='in_progress'$s$,
        $s$W: worker_checkout_at=now()$s$,
        $s$C: company_checkout_confirmed_at=now()$s$,
        $s$C: status='completed'$s$,
        $s$C: status='completed'$s$]);
    PERFORM pg_temp.caso('presenca manual pela empresa (retroativa) + saida do freela', true, hired, ARRAY[
        $s$C: company_checkin_confirmed_at=now() - interval '5 hours', status='in_progress'$s$,
        $s$W: worker_checkout_at=now()$s$,
        $s$C: company_checkout_confirmed_at=now()$s$,
        $s$C: status='completed'$s$]);
    PERFORM pg_temp.caso('freela chega depois da empresa (tela velha)', true, prog_c,
        ARRAY[$s$W: worker_checkin_at=now(), status='in_progress'$s$]);
    PERFORM pg_temp.caso('empresa conclui sem saida do freela', true, prog_c,
        ARRAY[$s$C: company_checkout_confirmed_at=now()$s$, $s$C: status='completed'$s$]);
    PERFORM pg_temp.caso('empresa confirma chegada apos check-in/out do freela', true, prog_wo,
        ARRAY[$s$C: company_checkin_confirmed_at=now(), status='in_progress'$s$]);
    PERFORM pg_temp.caso('avaliar turno concluido (no-op)', true, done, ARRAY[$s$C: status='completed'$s$]);
    PERFORM pg_temp.caso('freela cancela contratado', true, hired, ARRAY[$s$W: status='cancelled'$s$]);
    PERFORM pg_temp.caso('freela cancela em andamento', true, prog_w, ARRAY[$s$W: status='cancelled'$s$]);
    PERFORM pg_temp.caso('freela retira candidatura', true, pend, ARRAY[$s$W: status='cancelled'$s$]);
    PERFORM pg_temp.caso('cancelInvite', true, inv, ARRAY[$s$C: status='cancelled'$s$]);
    PERFORM pg_temp.caso('dismissFromShift hired', true, hired, ARRAY[$s$C: status='cancelled'$s$]);
    PERFORM pg_temp.caso('excluir turno em andamento', true, prog_w, ARRAY[$s$C: status='cancelled'$s$]);
    PERFORM pg_temp.caso('pull: empresa recusa', true, pend, ARRAY[$s$C: status='rejected'$s$]);
    PERFORM pg_temp.caso('pull: entrevista e contrata', true, pend,
        ARRAY[$s$C: status='interview'$s$, $s$C: status='hired'$s$]);

    -- ---------------- M1: chegada ja confirmada ----------------
    PERFORM pg_temp.caso('hired com chegada confirmada -> in_progress', true,
        '{"s":"hired","inv":true,"ci":1}', ARRAY[$s$C: status='in_progress'$s$]);

    -- ---------------- M2: hora do freela e do servidor ----------------
    PERFORM pg_temp.caso('chegada do freela com relogio atrasado vira now()', true, hired,
        ARRAY[$s$W: worker_checkin_at=now() - interval '9 hours', status='in_progress'$s$],
        NULL, 'worker_checkin_at = now()');
    PERFORM pg_temp.caso('chegada do freela com relogio adiantado vira now()', true, hired,
        ARRAY[$s$W: worker_checkin_at=now() + interval '3 days', status='in_progress'$s$],
        NULL, 'worker_checkin_at = now()');
    PERFORM pg_temp.caso('saida do freela forjada vira now()', true, prog_w,
        ARRAY[$s$W: worker_checkout_at=now() + interval '10 hours'$s$], NULL, 'worker_checkout_at = now()');
    PERFORM pg_temp.caso('empresa: retroativo preservado', true, hired,
        ARRAY[$s$C: company_checkin_confirmed_at=now() - interval '3 days', status='in_progress'$s$],
        NULL, $s$company_checkin_confirmed_at = now() - interval '3 days'$s$);
    PERFORM pg_temp.caso('empresa: relogio 10 min adiantado', true, hired,
        ARRAY[$s$C: company_checkin_confirmed_at=now() + interval '10 minutes', status='in_progress'$s$]);
    PERFORM pg_temp.caso('M2 empresa: chegada no futuro', false, hired,
        ARRAY[$s$C: company_checkin_confirmed_at=now() + interval '1 hour', status='in_progress'$s$]);
    PERFORM pg_temp.caso('M2 empresa: saida no futuro', false, prog_c,
        ARRAY[$s$C: company_checkout_confirmed_at=now() + interval '1 hour'$s$]);

    -- ---------------- M2: data do turno ----------------
    PERFORM pg_temp.caso('M2 freela: chegada em turno de daqui a 5 dias', false, hired, ARRAY[w_in], futuro);
    PERFORM pg_temp.caso('M2 empresa: chegada em turno de daqui a 5 dias', false, hired, ARRAY[c_in], futuro);
    PERFORM pg_temp.caso('M2 chegada 13h antes do inicio', false, hired, ARRAY[w_in],
        format(em, '13 hours'));
    PERFORM pg_temp.caso('chegada 11h antes do inicio (folga)', true, hired, ARRAY[w_in],
        format(em, '11 hours'));
    PERFORM pg_temp.caso('chegada 30min antes (janela do MyJobs)', true, hired, ARRAY[w_in],
        format(em, '30 minutes'));
    PERFORM pg_temp.caso('turno que virou a noite / confirmacao tardia', true, hired, ARRAY[c_in],
        format(em, '-26 hours'));
    PERFORM pg_temp.caso('turno sem data', true, hired, ARRAY[w_in],
        $s$status='open', start_date=NULL, work_start_time=NULL$s$);
    PERFORM pg_temp.caso('horario em texto invalido', true, hired, ARRAY[w_in],
        $s$status='open', start_date=now(), work_start_time='a combinar'$s$);
    PERFORM pg_temp.caso('start_date legado 00:00 UTC de hoje', true, hired, ARRAY[w_in],
        $s$status='open', start_date=date_trunc('day', now(), 'UTC'), work_start_time=NULL$s$);
    PERFORM pg_temp.caso('aceite de turno futuro', true, inv, ARRAY[accept], futuro);

    -- ---------------- B3: turno apagado ----------------
    PERFORM pg_temp.caso('B3 aceite em turno apagado', false, inv, ARRAY[accept], apagado);
    PERFORM pg_temp.caso('B3 chegada do freela em turno apagado', false, hired, ARRAY[w_in], apagado);
    PERFORM pg_temp.caso('B3 chegada pela empresa em turno apagado', false, hired, ARRAY[c_in], apagado);
    PERFORM pg_temp.caso('recusar convite de turno apagado', true, inv,
        ARRAY[$s$W: status='declined', invitation_response='declined', invitation_responded_at=now()$s$], apagado);
    PERFORM pg_temp.caso('cancelar apos apagar o turno', true, hired, ARRAY[$s$C: status='cancelled'$s$], apagado);

    -- ---------------- ATAQUE 1: autocontratacao do freela ----------------
    PERFORM pg_temp.caso('A1 pending->invited forjado', false, pend,
        ARRAY[$s$W: status='invited', invited_by_company_at=now()$s$]);
    PERFORM pg_temp.caso('A1 pending->invited sem carimbo', false, pend, ARRAY[$s$W: status='invited'$s$]);
    PERFORM pg_temp.caso('A1 so o carimbo de convite', false, pend, ARRAY[$s$W: invited_by_company_at=now()$s$]);
    PERFORM pg_temp.caso('A1 pending->hired', false, pend, ARRAY[$s$W: status='hired'$s$]);
    PERFORM pg_temp.caso('A1 pending->in_progress', false, pend, ARRAY[$s$W: status='in_progress'$s$]);
    PERFORM pg_temp.caso('A1 pending->in_progress com carimbo', false, pend,
        ARRAY[$s$W: status='in_progress', worker_checkin_at=now()$s$]);
    PERFORM pg_temp.caso('A1 interview->in_progress', false, interv,
        ARRAY[$s$W: status='in_progress', worker_checkin_at=now()$s$]);
    PERFORM pg_temp.caso('A1 declined->hired', false, decl, ARRAY[$s$W: status='hired'$s$]);
    PERFORM pg_temp.caso('A1 declined->invited', false, decl, ARRAY[$s$W: status='invited'$s$]);
    PERFORM pg_temp.caso('A1 cancelled->in_progress', false, canc,
        ARRAY[$s$W: status='in_progress', worker_checkin_at=now()$s$]);
    PERFORM pg_temp.caso('A1 cancelled->hired', false, canc, ARRAY[$s$W: status='hired'$s$]);
    PERFORM pg_temp.caso('A1 pull via cancelled', false, pend,
        ARRAY[$s$W: status='cancelled'$s$, $s$W: status='invited'$s$]);
    PERFORM pg_temp.caso('A1 hired->in_progress sem chegada', false, hired, ARRAY[$s$W: status='in_progress'$s$]);
    PERFORM pg_temp.caso('A1 freela conclui', false, prog_all, ARRAY[$s$W: status='completed'$s$]);
    PERFORM pg_temp.caso('A1 aceite sem resposta', false, inv, ARRAY[$s$W: status='hired'$s$]);
    PERFORM pg_temp.caso('A1 aceite de convite vencido', false, invx, ARRAY[accept]);
    PERFORM pg_temp.caso('A1 estende prazo do convite', false, invx,
        ARRAY[$s$W: invitation_expires_at=now() + interval '1 day'$s$]);
    PERFORM pg_temp.caso('A1 invited->pending', false, inv, ARRAY[$s$W: status='pending'$s$]);
    PERFORM pg_temp.caso('A1 status NULL', false, hired, ARRAY[$s$W: status=NULL$s$]);

    -- ---------------- ATAQUE 2: empresa aceita no lugar do freela ----------------
    PERFORM pg_temp.caso('A2 invited->hired', false, inv, ARRAY[$s$C: status='hired'$s$]);
    PERFORM pg_temp.caso('A2 invited->hired forjando resposta', false, inv, ARRAY[
        $s$C: status='hired', invitation_response='accepted', invitation_responded_at=now()$s$]);
    PERFORM pg_temp.caso('A2 so a resposta', false, inv, ARRAY[$s$C: invitation_response='accepted'$s$]);
    PERFORM pg_temp.caso('A2 invited->in_progress', false, inv,
        ARRAY[$s$C: status='in_progress', company_checkin_confirmed_at=now()$s$]);
    PERFORM pg_temp.caso('A2 invited->completed', false, inv, ARRAY[$s$C: status='completed'$s$]);
    PERFORM pg_temp.caso('A2 invited->pending (lavagem)', false, inv, ARRAY[$s$C: status='pending'$s$]);
    PERFORM pg_temp.caso('A2 apaga marca de convite', false, inv,
        ARRAY[$s$C: status='pending', invited_by_company_at=NULL$s$]);
    PERFORM pg_temp.caso('A2 declined->hired', false, decl, ARRAY[$s$C: status='hired'$s$]);
    PERFORM pg_temp.caso('A2 cancelled->hired', false, canc, ARRAY[$s$C: status='hired'$s$]);
    PERFORM pg_temp.caso('A2 cancela e recontrata', false, inv,
        ARRAY[$s$C: status='cancelled'$s$, $s$C: status='hired'$s$]);
    PERFORM pg_temp.caso('A2 rejected->hired', false, rej, ARRAY[$s$C: status='hired'$s$]);

    -- ---------------- ATAQUE 3: carimbo da empresa fora de hora ----------------
    PERFORM pg_temp.caso('A3 ci em pending', false, pend, ARRAY[$s$C: company_checkin_confirmed_at=now()$s$]);
    PERFORM pg_temp.caso('A3 co em pending', false, pend, ARRAY[$s$C: company_checkout_confirmed_at=now()$s$]);
    PERFORM pg_temp.caso('A3 ci em invited', false, inv, ARRAY[$s$C: company_checkin_confirmed_at=now()$s$]);
    PERFORM pg_temp.caso('A3 ci em hired sem andamento', false, hired, ARRAY[$s$C: company_checkin_confirmed_at=now()$s$]);
    PERFORM pg_temp.caso('A3 co em hired', false, hired, ARRAY[$s$C: company_checkout_confirmed_at=now()$s$]);
    PERFORM pg_temp.caso('A3 ci+co de uma vez', false, hired, ARRAY[
        $s$C: status='in_progress', company_checkin_confirmed_at=now(), company_checkout_confirmed_at=now()$s$]);
    PERFORM pg_temp.caso('A3 co sem chegada confirmada', false, prog_w, ARRAY[$s$C: company_checkout_confirmed_at=now()$s$]);
    PERFORM pg_temp.caso('A3 ci em cancelled', false, canc, ARRAY[$s$C: company_checkin_confirmed_at=now()$s$]);
    PERFORM pg_temp.caso('A3 ci em declined', false, decl, ARRAY[$s$C: company_checkin_confirmed_at=now()$s$]);
    PERFORM pg_temp.caso('A3 reescreve ci', false, prog_all,
        ARRAY[$s$C: company_checkin_confirmed_at=now() - interval '9 hours'$s$]);
    PERFORM pg_temp.caso('A3 apaga co em concluido', false, done, ARRAY[$s$C: company_checkout_confirmed_at=NULL$s$]);
    PERFORM pg_temp.caso('A3 hired->completed', false, hired, ARRAY[$s$C: status='completed'$s$]);
    PERFORM pg_temp.caso('A3 conclui sem confirmar saida', false, prog_c, ARRAY[$s$C: status='completed'$s$]);
    PERFORM pg_temp.caso('A3 completed->cancelled', false, done, ARRAY[$s$C: status='cancelled'$s$]);

    -- ---------------- Outros ----------------
    PERFORM pg_temp.caso('freela: saida em hired', false, hired, ARRAY[$s$W: worker_checkout_at=now()$s$]);
    PERFORM pg_temp.caso('freela: carimbo em pending', false, pend, ARRAY[$s$W: worker_checkin_at=now()$s$]);
    PERFORM pg_temp.caso('freela: reescreve chegada', false, prog_w,
        ARRAY[$s$W: worker_checkin_at=now() - interval '9 hours'$s$]);
    PERFORM pg_temp.caso('freela: carimbo da empresa', false, prog_w, ARRAY[$s$W: company_checkin_confirmed_at=now()$s$]);
    PERFORM pg_temp.caso('empresa: carimbo do freela', false, prog_c, ARRAY[$s$C: worker_checkout_at=now()$s$]);
    PERFORM pg_temp.caso('empresa: cover_letter', false, pend, ARRAY[$s$C: cover_letter='x'$s$]);
    PERFORM pg_temp.caso('empresa: created_at', false, pend, ARRAY[$s$C: created_at=now() - interval '1 year'$s$]);
    PERFORM pg_temp.caso('terceiro', false, hired, ARRAY[$s$X: status='cancelled'$s$]);
END $t$;

-- ---------------- Caminhos de SERVIDOR ----------------
DO $t$
DECLARE
    x record; v_call uuid; v_json jsonb; v_n integer; v_st text; v_id uuid;
BEGIN
    SELECT * INTO x FROM _ctx;

    -- claim_shift_slot (DEFINER) chamado por authenticated, reabrindo 'declined' (dois UPDATEs).
    PERFORM pg_temp.as_server();
    INSERT INTO public.applications (job_id, worker_id, status, invited_by_company_at, invitation_response)
    VALUES (x.job, x.worker, 'declined', now(), 'declined') RETURNING id INTO v_id;
    UPDATE public.jobs SET slots = 50, status = 'open' WHERE id = x.job;
    INSERT INTO public.shift_calls (job_id, company_id, created_by, slots, reason, targets_count, status, expires_at)
    VALUES (x.job, x.company, x.owner, 1, 'falta', 1, 'open', now() + interval '1 hour') RETURNING id INTO v_call;
    INSERT INTO public.shift_call_targets (call_id, worker_id) VALUES (v_call, x.worker);

    PERFORM pg_temp.as_user(x.worker);
    SET LOCAL ROLE authenticated;
    v_json := public.claim_shift_slot(v_call);
    RESET ROLE;
    SELECT status INTO v_st FROM public.applications WHERE id = v_id;
    IF v_json->>'outcome' <> 'claimed' OR v_st <> 'hired' THEN
        RAISE EXCEPTION 'FALHA claim_shift_slot: % %', v_json, v_st;
    END IF;
    RAISE NOTICE 'ok [legitimo] claim_shift_slot reabre declined';

    -- service_role: expire-invites e delete-account.
    PERFORM pg_temp.as_server();
    UPDATE public.applications SET status = 'invited' WHERE id = v_id;
    SET LOCAL ROLE service_role;
    UPDATE public.applications SET status = 'declined', invitation_responded_at = now() WHERE id = v_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA expire-invites'; END IF;
    UPDATE public.applications SET status = 'cancelled' WHERE id = v_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA delete-account'; END IF;
    RESET ROLE;
    RAISE NOTICE 'ok [legitimo] service_role (expire-invites, delete-account)';

    -- SQL de manutencao (postgres).
    UPDATE public.applications SET cover_letter = 'x' WHERE id = v_id;
    RAISE NOTICE 'ok [legitimo] postgres';
END $t$;

ROLLBACK;
