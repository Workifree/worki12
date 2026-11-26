-- Auditoria e testes de caracterizacao: Equipe e encarregados, E5 (operacao)
-- File: supabase/tests/equipe_e5_auditoria.sql
-- NAO e migration (fica fora de supabase/migrations/ de proposito: o CLI aplicaria). Rodar a mao, por
-- MCP/psql, DEPOIS de aplicar 20261123000600_equipe_e5_operacao.sql (e E0-E4).
-- Spec: .harness/spec/equipe-encarregados/spec.md (R7b, R14, R18, R20, R21, R27; A5, A6, A14-A18, A25-A27).
--
-- PARTE 1 e READ-ONLY e pode rodar em PRODUCAO.
-- PARTE 3 escreve (company_members, jobs, applications, shift_calls, shift_payments, notifications, ...)
--   DENTRO de uma transacao com ROLLBACK ao fim. Rodar em branch/QA/staging, NUNCA em producao.
--   Pre-condicoes: >= 1 empresa com >= 1 turno nao deletado, >= 1 linha em `applications` (molde) e
--   >= 3 freelas em `workers` sem vinculo com essa empresa. Falha = RAISE EXCEPTION.
--
-- Esta suite foi ESCRITA SEM EXECUCAO contra um banco (nao havia Postgres disponivel na sessao de
-- construcao): a primeira rodada em QA e parte da verificacao, nao confirmacao.
--
-- Convencao: `esperado:` descreve o resultado correto de cada consulta.

-- ============================================================================
-- PARTE 1 — AUDITORIA ESTRUTURAL (read-only)
-- ============================================================================

-- 1.1 [D1/D2] RPCs de E5: DEFINER, search_path vazio, anon SEM EXECUTE; authenticated COM EXECUTE,
--     exceto o helper interno internal_member_label (que aceita uid de terceiro).
--     esperado: definer = true em todas; anon_exec = false em todas; auth_exec = false SO em
--     internal_member_label; config contem search_path="" em todas.
SELECT p.proname,
       p.prosecdef                                               AS definer,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc_exec,
       p.proconfig                                               AS config
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('get_busy_workers','reassign_job_responsible','create_responsibility_coverage',
                     'end_responsibility_coverage','cancel_job','create_company_tag','archive_company_tag',
                     'set_job_tag','my_link_risk_config','list_jobs_by_responsible','internal_member_label',
                     'list_company_operators')
 ORDER BY 1;

-- 1.1b [L-4] job_cancellations: RLS ligada. esperado: rls = true.
SELECT relrowsecurity AS rls FROM pg_class WHERE oid = 'public.job_cancellations'::regclass;

-- 1.2 [R7b] so UMA assinatura de my_link_risk_config (sem overload ambiguo no PostgREST).
--     esperado: 1 linha, args = 'p_company_id uuid DEFAULT NULL::uuid'.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, pg_get_function_arguments(p.oid) AS args_default
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'my_link_risk_config';

-- 1.3 [A5/D3] get_busy_workers devolve SO worker_id. esperado: 'TABLE(worker_id uuid)'.
SELECT pg_get_function_result('public.get_busy_workers(uuid, timestamptz, timestamptz, uuid[], uuid)'::regprocedure);

-- 1.4 [R21] as tres funcoes de aviso roteiam por notification_recipients_for_job e nao resolvem mais o
--     destinatario por owner_id. esperado: roteia = true e usa_owner_antigo = false nas tres.
SELECT p.proname,
       strpos(pg_get_functiondef(p.oid), 'notification_recipients_for_job') > 0 AS roteia,
       strpos(pg_get_functiondef(p.oid), 'INTO v_company_user') > 0              AS usa_owner_antigo
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('claim_shift_slot','decline_shift_call','respond_attendance_confirmation')
 ORDER BY 1;

-- 1.5 [E5 guard] jobs_responsible_guard: edicao presente, sessao nula preservada, guard so LE a GUC.
--     esperado: as tres colunas true.
SELECT strpos(pg_get_functiondef(p.oid), 'app.job_reassign')   > 0 AS editado,
       strpos(pg_get_functiondef(p.oid), 'IF v_uid IS NULL THEN') > 0 AS sessao_nula_passa,
       strpos(pg_get_functiondef(p.oid), 'set_config')             = 0 AS guard_so_le
  FROM pg_proc p WHERE p.oid = 'public.jobs_responsible_guard()'::regprocedure;
-- 1.5b [ADR troca-de-responsavel-so-pela-rpc] so reassign_job_responsible e o guard citam a GUC.
--     esperado: exatamente 2 linhas (jobs_responsible_guard, reassign_job_responsible).
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND strpos(pg_get_functiondef(p.oid), 'app.job_reassign') > 0 ORDER BY 1;

-- 1.6 [D1/A21] nenhuma RPC de E5 ancora empresa em auth.uid() cru. esperado: 0 linhas.
SELECT p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('get_busy_workers','reassign_job_responsible','create_responsibility_coverage',
                     'end_responsibility_coverage','cancel_job','create_company_tag','archive_company_tag',
                     'set_job_tag','my_link_risk_config','list_jobs_by_responsible','internal_member_label')
   AND ( pg_get_functiondef(p.oid) ~* 'company_id[[:space:]]*=[[:space:]]*[(]?[[:space:]]*(select[[:space:]]+)?auth[.]uid[(][)]'
      OR pg_get_functiondef(p.oid) ~* 'owner_id[[:space:]]*=[[:space:]]*[(]?[[:space:]]*(select[[:space:]]+)?auth[.]uid[(][)]'
      OR pg_get_functiondef(p.oid) ~* '(company_id|owner_id)[[:space:]]*=[[:space:]]*v_[a-z_]*uid' );

-- 1.7 [E4 portao, LIMITE DE PALAVRA] funcao que le company_members sem tratar o PAPEL. esperado: 0 linhas
--     (lista branca = as mesmas de E4). `[[:<:]]` evita o falso positivo de "company_membership".
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind = 'f'
   AND pg_get_functiondef(p.oid) ~ '[[:<:]]company_members[[:>:]]'
   AND pg_get_functiondef(p.oid) !~ '[[:<:]]role[[:>:]]'
   AND p.proname NOT IN ('anonymize_account','lgpd_guard_auth_user_delete','can_review_for_job',
                         'internal_company_active_operator','session_company_member_confirmed',
                         'internal_drop_empty_company_shell')
 ORDER BY 1;

-- 1.8 [D6/R20] tags e coberturas continuam sem DELETE. esperado: 0 linhas nas duas.
SELECT tablename, policyname FROM pg_policies
 WHERE schemaname = 'public' AND tablename IN ('company_tags','responsibility_coverages') AND cmd = 'DELETE';
SELECT t.tbl, ro.rol FROM (VALUES ('public.company_tags'), ('public.responsibility_coverages'), ('public.job_cancellations')) AS t(tbl)
  CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS ro(rol)
 WHERE has_table_privilege(ro.rol, t.tbl, 'DELETE');   -- role_table_grants lista tambem o DONO (postgres): sempre acusaria

-- 1.9 [Article 8 / A22] E5 nao toca saldo: conferir por revisao do diff
--     (git diff main -- supabase/migrations/20261123000600*): nenhuma referencia de ESCRITA a wallets,
--     escrow_transactions, wallet_transactions, RPCs de escrow. shift_payments so e LIDO em cancel_job.

-- ============================================================================
-- PARTE 3 — CARACTERIZACAO — SO EM QA/STAGING (tudo em transacao com ROLLBACK)
-- ============================================================================
BEGIN;

CREATE FUNCTION pg_temp.as_user(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
END $f$;

CREATE FUNCTION pg_temp.as_server() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);   -- sessao NULA (servidor/cron)
END $f$;

-- Clona um turno existente (so o servidor chama: superusuario, sessao nula).
CREATE FUNCTION pg_temp.mk_job(p_tpl uuid, p_from text, p_to text, p_slots integer) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
    INSERT INTO public.jobs
    SELECT * FROM jsonb_populate_record(NULL::public.jobs,
        (SELECT to_jsonb(j) FROM public.jobs j WHERE j.id = p_tpl)
        || jsonb_build_object('id', v_id, 'responsible_id', NULL, 'series_id', NULL, 'tag_id', NULL,
                              'work_start_time', p_from, 'work_end_time', p_to, 'slots', p_slots,
                              'status', 'open'));
    RETURN v_id;
END $f$;

-- Clona uma candidatura existente para (job, worker, status) — sem check-in/out.
CREATE FUNCTION pg_temp.mk_app(p_job uuid, p_worker uuid, p_status text) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
    INSERT INTO public.applications
    SELECT * FROM jsonb_populate_record(NULL::public.applications,
        (SELECT to_jsonb(a) FROM public.applications a LIMIT 1)
        || jsonb_build_object('id', v_id, 'job_id', p_job, 'worker_id', p_worker, 'status', p_status,
                              'worker_checkin_at', NULL, 'company_checkin_confirmed_at', NULL,
                              'company_checkout_confirmed_at', NULL,
                              'invited_by_company_at', now()));
    RETURN v_id;
END $f$;

-- Quantas notificacoes (titulo LIKE) a pessoa tem. Chamar com a sessao do SERVIDOR.
CREATE FUNCTION pg_temp.n_notif(p_uid uuid, p_title text) RETURNS bigint
LANGUAGE sql AS $f$
    SELECT count(*) FROM public.notifications WHERE user_id = p_uid AND title LIKE p_title;
$f$;

DO $t$
DECLARE
    v_company uuid;  v_company2 uuid;  v_job uuid;  v_start date;  v_owner uuid;
    v_enc  uuid := gen_random_uuid();     -- encarregado ATIVO e CONFIRMADO
    v_enc2 uuid := gen_random_uuid();     -- encarregado ATIVO e CONFIRMADO (cobre/recebe)
    v_enc3 uuid := gen_random_uuid();     -- encarregado ATIVO e NAO confirmado
    v_mgr  uuid := gen_random_uuid();     -- Gestor 'manager' em DUAS companies (A25)
    v_ws   uuid[];  v_w1 uuid;  v_w2 uuid;  v_w3 uuid;
    v_jb uuid; v_jc uuid; v_jd uuid; v_je uuid; v_jf uuid; v_jg uuid; v_esc uuid; v_jh uuid;
    v_ps timestamptz; v_pe timestamptz;
    v_json jsonb; v_n bigint; v_n0 bigint; v_t text; v_ok boolean;
    v_cid uuid; v_tag uuid; v_sp uuid; v_app uuid; v_cov uuid; v_n_tc bigint;
BEGIN
    -- ---------------- setup (superusuario, sessao nula) ----------------
    PERFORM pg_temp.as_server();
    SELECT j.company_id, j.id, (j.start_date AT TIME ZONE 'America/Sao_Paulo')::date, COALESCE(c.owner_id, c.id)
      INTO v_company, v_job, v_start, v_owner
      FROM public.jobs j JOIN public.companies c ON c.id = j.company_id
     WHERE j.status <> 'deleted' AND j.start_date IS NOT NULL
     ORDER BY j.created_at DESC NULLS LAST LIMIT 1;
    IF v_job IS NULL THEN RAISE EXCEPTION 'PRE-CONDICAO: nenhuma empresa com turno.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.applications) THEN RAISE EXCEPTION 'PRE-CONDICAO: nenhuma application para molde.'; END IF;

    SELECT array_agg(id) INTO v_ws FROM (SELECT w.id FROM public.workers w
        WHERE NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = v_job AND a.worker_id = w.id)
          AND NOT EXISTS (SELECT 1 FROM public.team_connections tc WHERE tc.company_id = v_company AND tc.worker_id = w.id)
        ORDER BY w.id LIMIT 3) x;
    IF v_ws IS NULL OR cardinality(v_ws) < 3 THEN RAISE EXCEPTION 'PRE-CONDICAO: preciso de 3 freelas sem vinculo com a empresa.'; END IF;
    v_w1 := v_ws[1]; v_w2 := v_ws[2]; v_w3 := v_ws[3];

    -- o CHECK de role (E4 ja alarga; alarga DENTRO da transacao se ainda nao estiver)
    IF position('encarregado' IN (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                                   WHERE conrelid = 'public.company_members'::regclass
                                     AND conname = 'company_members_role_check')) = 0 THEN
        ALTER TABLE public.company_members DROP CONSTRAINT company_members_role_check;
        ALTER TABLE public.company_members ADD CONSTRAINT company_members_role_check
            CHECK (role IN ('manager', 'encarregado'));
    END IF;
    ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
    INSERT INTO auth.users (id, email) SELECT x, x::text || '@invalido.local' FROM unnest(ARRAY[v_enc, v_enc2, v_enc3, v_mgr]) x;
    ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;
    INSERT INTO public.company_members
        (company_id, user_id, role, status, created_by, accepted_at, display_name, confirmed_at)
    VALUES (v_company, v_enc,  'encarregado', 'active', v_owner, now(), 'QA Enc 1', now()),
           (v_company, v_enc2, 'encarregado', 'active', v_owner, now(), 'QA Enc 2', now()),
           (v_company, v_enc3, 'encarregado', 'active', v_owner, now(), 'QA Enc 3', NULL);

    -- Elenco: w1 e w3 ACEITOS; w2 FORA do Elenco (A6)
    INSERT INTO public.team_connections (company_id, worker_id, status, source, accepted_at)
    VALUES (v_company, v_w1, 'accepted', 'link', now()), (v_company, v_w3, 'accepted', 'link', now());
    SELECT count(*) INTO v_n_tc FROM public.team_connections WHERE company_id = v_company;

    -- turnos do cenario (mesmo dia local): v_job 18:00-22:00 (dono); B 19:00-23:00 (enc); C (enc);
    -- D (enc, cancelado pelo Gestor); E (enc, roteamento de avisos)
    -- datas no FUTURO (hoje + 7, local): a cobertura exige ends_on >= hoje e o turno de QA pode ser antigo.
    v_start := (now() AT TIME ZONE 'America/Sao_Paulo')::date + 7;
    UPDATE public.jobs
       SET start_date = ((v_start::text || ' 12:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo'),
           work_start_time = '18:00', work_end_time = '22:00', responsible_id = v_owner
     WHERE id = v_job;
    v_jb := pg_temp.mk_job(v_job, '19:00', '23:00', 2);
    v_jc := pg_temp.mk_job(v_job, '08:00', '12:00', 3);
    v_jd := pg_temp.mk_job(v_job, '08:00', '12:00', 1);
    v_je := pg_temp.mk_job(v_job, '08:00', '12:00', 3);
    UPDATE public.jobs SET responsible_id = v_enc WHERE id IN (v_jb, v_jc, v_jd, v_je);   -- sessao nula passa o guard

    v_ps := ((v_start::text || ' 19:00')::timestamp AT TIME ZONE 'America/Sao_Paulo');
    v_pe := ((v_start::text || ' 23:00')::timestamp AT TIME ZONE 'America/Sao_Paulo');

    -- ============ A5/A6: get_busy_workers ===========================================================
    PERFORM pg_temp.mk_app(v_job, v_w1, 'hired');      -- w1 (Elenco) ocupado 18-22 em turno do DONO
    PERFORM pg_temp.mk_app(v_job, v_w2, 'hired');      -- w2 (FORA do Elenco) tambem ocupado: nao pode aparecer
    PERFORM pg_temp.as_user(v_enc);
    SELECT array_agg(worker_id ORDER BY worker_id) INTO v_ws
      FROM public.get_busy_workers(v_company, v_ps, v_pe, ARRAY[v_w1, v_w2, v_w3], v_jb);
    IF v_ws IS DISTINCT FROM ARRAY[v_w1] THEN
        RAISE EXCEPTION 'A5/A6: esperado so w1 ocupado (w2 fora do Elenco, w3 livre), veio %.', v_ws; END IF;
    -- payload: nenhum campo alem de worker_id (A5)
    SELECT count(*) INTO v_n
      FROM (SELECT to_jsonb(b) AS item
              FROM (SELECT * FROM public.get_busy_workers(v_company, v_ps, v_pe, ARRAY[v_w1], v_jb)) AS b) q
     WHERE q.item IS DISTINCT FROM jsonb_build_object('worker_id', v_w1);
    IF v_n <> 0 THEN RAISE EXCEPTION 'A5: payload de get_busy_workers tem campo alem de worker_id.'; END IF;
    -- janela adjacente (22:00-23:00): fim do turno e EXCLUSIVO => livre
    v_ps := ((v_start::text || ' 22:00')::timestamp AT TIME ZONE 'America/Sao_Paulo');
    SELECT count(*) INTO v_n FROM public.get_busy_workers(v_company, v_ps, v_pe, ARRAY[v_w1], v_jb);
    IF v_n <> 0 THEN RAISE EXCEPTION 'A5: janela adjacente deveria estar livre.'; END IF;
    v_ps := ((v_start::text || ' 19:00')::timestamp AT TIME ZONE 'America/Sao_Paulo');
    -- p_exclude_job_id tira o proprio turno
    SELECT count(*) INTO v_n FROM public.get_busy_workers(v_company, v_ps, v_pe, ARRAY[v_w1], v_job);
    IF v_n <> 0 THEN RAISE EXCEPTION 'A5: p_exclude_job_id nao excluiu o turno.'; END IF;
    -- alvo PENDENTE de chamado aberto (nao vencido) tambem ocupa
    PERFORM pg_temp.as_server();
    INSERT INTO public.shift_calls (job_id, company_id, created_by, slots, reason, targets_count, status, origin, expires_at)
    VALUES (v_job, v_company, v_owner, 1, 'falta', 1, 'open', 'team', now() + interval '1 hour') RETURNING id INTO v_cid;
    INSERT INTO public.shift_call_targets (call_id, worker_id) VALUES (v_cid, v_w3);
    PERFORM pg_temp.as_user(v_enc);
    SELECT count(*) INTO v_n FROM public.get_busy_workers(v_company, v_ps, v_pe, ARRAY[v_w3], v_jb);
    IF v_n <> 1 THEN RAISE EXCEPTION 'A5: alvo pendente de chamado aberto deveria contar como ocupado.'; END IF;
    -- nao confirmado / outra empresa / sessao nula: ERRO, nunca zero linhas
    PERFORM pg_temp.as_user(v_enc3);
    v_ok := false;
    BEGIN PERFORM * FROM public.get_busy_workers(v_company, v_ps, v_pe, ARRAY[v_w1], v_jb); v_ok := true;
    EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
    IF v_ok THEN RAISE EXCEPTION 'A12: nao confirmado recebeu resultado de get_busy_workers.'; END IF;
    PERFORM pg_temp.as_user(v_enc);
    v_ok := false;
    BEGIN PERFORM * FROM public.get_busy_workers(gen_random_uuid(), v_ps, v_pe, ARRAY[v_w1], NULL); v_ok := true;
    EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
    IF v_ok THEN RAISE EXCEPTION 'A5: get_busy_workers respondeu para company que a sessao nao opera.'; END IF;
    v_ok := false;
    BEGIN PERFORM * FROM public.get_busy_workers(v_company, v_pe, v_ps, ARRAY[v_w1], NULL); v_ok := true;
    EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
    IF v_ok THEN RAISE EXCEPTION 'A5: janela invertida deveria dar 22023.'; END IF;
    PERFORM pg_temp.as_server();
    v_ok := false;
    BEGIN PERFORM * FROM public.get_busy_workers(v_company, v_ps, v_pe, ARRAY[v_w1], NULL); v_ok := true;
    EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
    IF v_ok THEN RAISE EXCEPTION 'A5: sessao nula recebeu resultado.'; END IF;
    -- limpa o estado de ocupacao usado acima
    DELETE FROM public.shift_call_targets WHERE call_id = v_cid;
    DELETE FROM public.shift_calls WHERE id = v_cid;
    DELETE FROM public.applications WHERE job_id = v_job AND worker_id IN (v_w1, v_w2);

    -- ============ A14: reassign_job_responsible =====================================================
    PERFORM pg_temp.as_user(v_enc);
    v_json := public.reassign_job_responsible(ARRAY[v_jb, v_job], v_enc2);       -- v_job NAO e dele
    IF (v_json ->> 'moved')::int <> 1 OR (v_json ->> 'skipped')::int <> 1 OR v_json ->> 'outcome' <> 'ok' THEN
        RAISE EXCEPTION 'A14: esperado moved=1 skipped=1, veio %.', v_json; END IF;
    PERFORM pg_temp.as_server();
    IF (SELECT responsible_id FROM public.jobs WHERE id = v_jb) IS DISTINCT FROM v_enc2 THEN
        RAISE EXCEPTION 'A14: responsible_id nao mudou.'; END IF;
    IF (SELECT responsible_id FROM public.jobs WHERE id = v_job) IS DISTINCT FROM v_owner THEN
        RAISE EXCEPTION 'A14: turno alheio foi movido.'; END IF;
    IF pg_temp.n_notif(v_enc2, 'Turno passado para você') < 1 OR pg_temp.n_notif(v_enc, 'Turno passado') < 1 THEN
        RAISE EXCEPTION 'A14: destino e origem precisam ser avisados.'; END IF;
    IF pg_temp.n_notif(v_owner, 'Turnos passados na equipe') < 1 THEN
        RAISE EXCEPTION 'M2: Gestor precisa ser avisado quando o encarregado passa turnos.'; END IF;
    -- M2: turno antigo (hoje - 3) nao e passado por encarregado; o Gestor passa
    v_jh := pg_temp.mk_job(v_job, '08:00', '12:00', 1);
    UPDATE public.jobs SET responsible_id = v_enc,
           start_date = ((((now() AT TIME ZONE 'America/Sao_Paulo')::date - 3)::text || ' 12:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo')
     WHERE id = v_jh;
    PERFORM pg_temp.as_user(v_enc);
    v_json := public.reassign_job_responsible(ARRAY[v_jh], v_enc2);
    IF (v_json ->> 'moved')::int <> 0 OR (v_json ->> 'skipped')::int <> 1 OR (v_json ->> 'skipped_past')::int <> 1 THEN
        RAISE EXCEPTION 'M2: encarregado passou turno antigo (%).', v_json; END IF;
    PERFORM pg_temp.as_user(v_owner);
    IF (public.reassign_job_responsible(ARRAY[v_jh], v_enc2) ->> 'moved')::int <> 1 THEN
        RAISE EXCEPTION 'M2: Gestor deveria poder passar turno antigo.'; END IF;
    PERFORM pg_temp.as_user(v_enc);                                             -- ja nao e dele
    IF public.is_job_owner(v_jb) THEN RAISE EXCEPTION 'A14: origem ainda opera o turno passado.'; END IF;
    IF (public.reassign_job_responsible(ARRAY[v_jb], v_enc) ->> 'moved')::int <> 0 THEN
        RAISE EXCEPTION 'A14: encarregado passou turno que nao e mais dele.'; END IF;
    -- PATCH direto nao serve: o WITH CHECK da policy de UPDATE barra (encarregado perde o turno)
    PERFORM pg_temp.as_server();
    UPDATE public.jobs SET responsible_id = v_enc WHERE id = v_jc;              -- (so garante o estado)
    PERFORM pg_temp.as_user(v_enc);
    BEGIN
        UPDATE public.jobs SET responsible_id = v_enc2 WHERE id = v_jc;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n <> 0 THEN RAISE EXCEPTION 'A14: PATCH direto reatribuiu turno.'; END IF;
    EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
    PERFORM pg_temp.as_user(v_owner);                                           -- Gestor devolve e testa destino invalido
    IF (public.reassign_job_responsible(ARRAY[v_jb], v_enc) ->> 'moved')::int <> 1 THEN
        RAISE EXCEPTION 'A14: Gestor nao passou o turno.'; END IF;
    v_json := public.reassign_job_responsible(ARRAY[v_jb], v_enc3);             -- destino NAO confirmado
    IF v_json ->> 'outcome' <> 'nothing_moved' THEN RAISE EXCEPTION 'A14: destino nao confirmado aceito (%).', v_json; END IF;
    v_json := public.reassign_job_responsible(ARRAY[v_jb], gen_random_uuid());  -- destino estranho a company
    IF v_json ->> 'outcome' <> 'nothing_moved' THEN RAISE EXCEPTION 'A14: destino fora da company aceito (%).', v_json; END IF;
    PERFORM pg_temp.as_user(v_w1);                                              -- freela
    IF (public.reassign_job_responsible(ARRAY[v_jb], v_w1) ->> 'moved')::int <> 0 THEN
        RAISE EXCEPTION 'A14: freela passou turno.'; END IF;

    -- ============ A15: cobertura por janela (sem cron) ==============================================
    PERFORM pg_temp.as_user(v_enc);
    v_json := public.create_responsibility_coverage(v_company, v_enc, v_enc2, v_start, v_start + 1);
    IF v_json ->> 'outcome' <> 'created' THEN RAISE EXCEPTION 'A15: cobertura nao criada: %.', v_json; END IF;
    v_cov := (v_json ->> 'coverage_id')::uuid;
    IF public.create_responsibility_coverage(v_company, v_enc, v_enc2, v_start, v_start + 1) ->> 'outcome' <> 'already_covered' THEN
        RAISE EXCEPTION 'A15: repeticao deveria devolver already_covered.'; END IF;
    v_json := public.create_responsibility_coverage(v_company, v_enc, v_enc2, v_start + 1, v_start + 5);   -- sobreposicao parcial
    IF v_json ->> 'outcome' <> 'overlaps' OR (v_json ->> 'existing_ends_on')::date <> v_start + 1 THEN
        RAISE EXCEPTION 'A15: sobreposicao parcial deveria devolver overlaps com a janela existente (%).', v_json; END IF;
    IF public.create_responsibility_coverage(v_company, v_enc2, v_enc, v_start, v_start) ->> 'outcome' <> 'forbidden' THEN
        RAISE EXCEPTION 'A15: encarregado cobriu em nome de outro.'; END IF;
    IF public.create_responsibility_coverage(v_company, v_enc, v_enc3, v_start, v_start) ->> 'outcome' <> 'to_not_encarregado' THEN
        RAISE EXCEPTION 'A15: cobertura para nao confirmado aceita.'; END IF;
    IF public.create_responsibility_coverage(v_company, v_enc, v_enc2, v_start, v_start + 60) ->> 'outcome' <> 'window_too_long' THEN
        RAISE EXCEPTION 'A15: janela > 60 dias aceita.'; END IF;
    IF public.create_responsibility_coverage(v_company, v_enc, v_enc2, v_start - 30, v_start - 20) ->> 'outcome' <> 'in_the_past' THEN
        RAISE EXCEPTION 'A15: janela no passado aceita.'; END IF;
    -- retroativa com fim no futuro: v_start = hoje + 7, logo v_start - 37 = hoje - 30 e v_start - 9 = hoje - 2
    IF public.create_responsibility_coverage(v_company, v_enc, v_enc2, v_start - 37, v_start - 2) ->> 'outcome' <> 'starts_in_the_past'
       OR public.create_responsibility_coverage(v_company, v_enc, v_enc2, v_start - 9, v_start - 2) ->> 'outcome' <> 'starts_in_the_past' THEN
        RAISE EXCEPTION 'A15: cobertura RETROATIVA aceita.'; END IF;
    PERFORM pg_temp.as_server();
    IF pg_temp.n_notif(v_owner, 'Cobertura criada na equipe') < 1 THEN
        RAISE EXCEPTION 'A15: cobertura criada por encarregado precisa avisar o Gestor.'; END IF;
    PERFORM pg_temp.as_user(v_enc);
    PERFORM pg_temp.as_user(v_owner);
    IF public.create_responsibility_coverage(v_company, v_owner, v_enc2, v_start, v_start) ->> 'outcome' <> 'from_is_gestor' THEN
        RAISE EXCEPTION 'M1: cobertura DE Gestor/dono aceita (e inerte).'; END IF;
    -- L-2 papel duplo (encarregado que TAMBEM e operador de organizacao) usa a mesma checagem
    -- (internal_company_gestor_ids inclui operadores de organizacao); montar o cenario exige uma
    -- organizacao na base — reaproveitar o bloco "operador de ORGANIZACAO" do teste E0-E3.
    PERFORM pg_temp.as_user(v_enc2);
    IF NOT public.is_job_owner(v_jb) THEN RAISE EXCEPTION 'A15: quem cobre nao opera dentro da janela.'; END IF;
    -- L-7: quem so COBRE nao troca responsible_id por PATCH direto
    BEGIN
        UPDATE public.jobs SET responsible_id = v_enc2 WHERE id = v_jb;
        RAISE EXCEPTION 'L-7: quem so cobre reatribuiu o turno por PATCH.';
    EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
    -- ... nem o proprio responsavel (ADR: PATCH direto e RECUSADO; so a RPC troca)
    PERFORM pg_temp.as_user(v_enc);
    BEGIN
        UPDATE public.jobs SET responsible_id = v_enc2 WHERE id = v_jb;
        RAISE EXCEPTION 'ADR: o responsavel trocou responsible_id por PATCH direto.';
    EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
    -- ... e a RPC continua funcionando para o mesmo gesto; o sinal some apos o UPDATE
    IF (public.reassign_job_responsible(ARRAY[v_jb], v_enc2) ->> 'moved')::int <> 1 THEN
        RAISE EXCEPTION 'ADR: a RPC deixou de funcionar com o guard estrito.'; END IF;
    IF COALESCE(current_setting('app.job_reassign', true), '') <> '' THEN
        RAISE EXCEPTION 'ADR: o sinal app.job_reassign sobreviveu ao UPDATE.'; END IF;
    -- o sinal de UM turno nao libera OUTRO: sob sinal do turno jb, PATCH em outro turno do enc continua recusado
    PERFORM pg_temp.as_server();
    PERFORM set_config('app.job_reassign', v_jb::text, true);
    PERFORM pg_temp.as_user(v_enc);
    BEGIN
        UPDATE public.jobs SET responsible_id = v_enc2 WHERE id = v_je;
        RAISE EXCEPTION 'ADR: o sinal de um turno liberou a troca de outro.';
    EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
    PERFORM set_config('app.job_reassign', '', true);
    PERFORM pg_temp.as_user(v_owner);                                           -- Gestor devolve o turno ao enc
    PERFORM public.reassign_job_responsible(ARRAY[v_jb], v_enc);
    -- L-7: encarregado NAO confirmado: PATCH nao afeta nada (USING nega)
    PERFORM pg_temp.as_user(v_enc3);
    UPDATE public.jobs SET responsible_id = v_enc3 WHERE id = v_jb;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 0 THEN RAISE EXCEPTION 'L-7: nao confirmado alterou turno por PATCH.'; END IF;
    PERFORM pg_temp.as_user(v_enc2);
    PERFORM pg_temp.as_server();
    IF (SELECT responsible_id FROM public.jobs WHERE id = v_jb) IS DISTINCT FROM v_enc THEN
        RAISE EXCEPTION 'A15: responsible_id mudou com a cobertura.'; END IF;
    IF pg_temp.n_notif(v_enc2, 'Você vai cobrir turnos') < 1 OR pg_temp.n_notif(v_enc, 'Seus turnos terão cobertura') < 1 THEN
        RAISE EXCEPTION 'A15: as duas pessoas precisam ser avisadas na criacao.'; END IF;
    -- fim AUTOMATICO: empurra a janela para o futuro e o acesso some, sem job agendado
    UPDATE public.responsibility_coverages SET starts_on = v_start + 3, ends_on = v_start + 4 WHERE id = v_cov;
    PERFORM pg_temp.as_user(v_enc2);
    IF public.is_job_owner(v_jb) THEN RAISE EXCEPTION 'A15: cobertura fora da janela ainda concede acesso.'; END IF;
    PERFORM pg_temp.as_server();
    UPDATE public.responsibility_coverages SET starts_on = v_start, ends_on = v_start + 1 WHERE id = v_cov;
    PERFORM pg_temp.as_user(v_enc2);                                            -- quem cobre encerra antes
    IF public.end_responsibility_coverage(v_cov) ->> 'outcome' <> 'ended' THEN RAISE EXCEPTION 'A15: nao encerrou.'; END IF;
    IF public.is_job_owner(v_jb) THEN RAISE EXCEPTION 'A15: cobertura encerrada ainda concede acesso.'; END IF;
    IF public.end_responsibility_coverage(v_cov) ->> 'outcome' <> 'already_ended' THEN RAISE EXCEPTION 'A15: ja encerrada.'; END IF;
    PERFORM pg_temp.as_user(v_enc3);
    IF public.end_responsibility_coverage(v_cov) ->> 'outcome' NOT IN ('forbidden', 'already_ended') THEN
        RAISE EXCEPTION 'A15: nao confirmado mexeu em cobertura.'; END IF;

    -- ============ R27/A26/A27: cancel_job ===========================================================
    PERFORM pg_temp.as_server();
    PERFORM pg_temp.mk_app(v_jc, v_w1, 'hired');
    PERFORM pg_temp.mk_app(v_jc, v_w3, 'invited');
    INSERT INTO public.shift_calls (job_id, company_id, created_by, slots, reason, targets_count, status, origin, expires_at)
    VALUES (v_jc, v_company, v_owner, 1, 'falta', 1, 'open', 'team', now() + interval '1 hour') RETURNING id INTO v_cid;
    INSERT INTO public.shift_call_targets (call_id, worker_id) VALUES (v_cid, v_w2);
    SELECT count(*) INTO v_n_tc FROM public.team_connections WHERE company_id = v_company;
    SELECT count(*) INTO v_n0 FROM public.notifications WHERE user_id = v_enc AND title = 'Cancelamento de turno';

    PERFORM pg_temp.as_user(v_enc2);                                            -- nao e dele
    IF public.cancel_job(v_jc, NULL) ->> 'outcome' <> 'forbidden' THEN RAISE EXCEPTION 'A26: cancelou turno alheio.'; END IF;
    PERFORM pg_temp.as_user(v_enc3);                                            -- nao confirmado
    IF public.cancel_job(v_jc, NULL) ->> 'outcome' <> 'forbidden' THEN RAISE EXCEPTION 'A12: nao confirmado cancelou turno.'; END IF;
    PERFORM pg_temp.as_user(v_w1);                                              -- freela
    IF public.cancel_job(v_jc, NULL) ->> 'outcome' <> 'forbidden' THEN RAISE EXCEPTION 'A26: freela cancelou turno.'; END IF;

    -- recusa por pagamento ativo: nada muda
    PERFORM pg_temp.as_server();
    INSERT INTO public.shift_payments (job_id, company_id, worker_id, application_id, source, amount, status, scheduled_for, paid_at, recorded_by)
    SELECT v_jc, v_company, v_w1, a.id, 'external_pix', 10, 'scheduled', current_date, NULL, v_owner
      FROM public.applications a WHERE a.job_id = v_jc AND a.worker_id = v_w1
    RETURNING id INTO v_sp;
    PERFORM pg_temp.as_user(v_enc);
    IF public.cancel_job(v_jc, NULL) ->> 'outcome' <> 'active_payment' THEN RAISE EXCEPTION 'A26: pagamento ativo nao recusou.'; END IF;
    PERFORM pg_temp.as_server();
    IF (SELECT count(*) FROM public.applications WHERE job_id = v_jc AND status IN ('hired','invited')) <> 2
       OR (SELECT status FROM public.jobs WHERE id = v_jc) = 'deleted'
       OR (SELECT status FROM public.shift_calls WHERE id = v_cid) <> 'open' THEN
        RAISE EXCEPTION 'A26: a recusa por pagamento ativo alterou dados.'; END IF;
    UPDATE public.shift_payments SET status = 'voided', voided_at = now(), void_reason = 'qa' WHERE id = v_sp;
    -- recusa por presenca iniciada
    UPDATE public.applications SET worker_checkin_at = now() WHERE job_id = v_jc AND worker_id = v_w1;
    PERFORM pg_temp.as_user(v_enc);
    IF public.cancel_job(v_jc, NULL) ->> 'outcome' <> 'attendance_started' THEN RAISE EXCEPTION 'A26: presenca iniciada nao recusou.'; END IF;
    PERFORM pg_temp.as_server();
    UPDATE public.applications SET worker_checkin_at = NULL WHERE job_id = v_jc AND worker_id = v_w1;

    -- sucesso: 1 hired + 1 invited + 1 chamado aberto
    PERFORM pg_temp.as_user(v_enc);
    v_json := public.cancel_job(v_jc, 'QA: evento cancelado');
    IF v_json ->> 'outcome' <> 'cancelled'
       OR (v_json ->> 'cancelled_applications')::int <> 2
       OR (v_json ->> 'cancelled_calls')::int <> 1 THEN
        RAISE EXCEPTION 'A26: esperado cancelled_applications=2 cancelled_calls=1, veio %.', v_json; END IF;
    PERFORM pg_temp.as_server();
    IF (SELECT status FROM public.jobs WHERE id = v_jc) <> 'deleted' THEN RAISE EXCEPTION 'A26: turno nao ficou deleted.'; END IF;
    IF (SELECT count(*) FROM public.job_cancellations
         WHERE job_id = v_jc AND cancelled_by = v_enc AND reason = 'QA: evento cancelado'
           AND cancelled_applications = 2 AND cancelled_calls = 1) <> 1 THEN
        RAISE EXCEPTION 'L-4: trilha job_cancellations ausente ou incorreta.'; END IF;
    IF (SELECT count(*) FROM public.applications WHERE job_id = v_jc AND status = 'cancelled') <> 2 THEN
        RAISE EXCEPTION 'A26: candidaturas nao foram canceladas.'; END IF;
    IF (SELECT status FROM public.shift_calls WHERE id = v_cid) <> 'cancelled'
       OR (SELECT response FROM public.shift_call_targets WHERE call_id = v_cid AND worker_id = v_w2) <> 'closed' THEN
        RAISE EXCEPTION 'A26: chamado/alvo nao foram fechados.'; END IF;
    IF pg_temp.n_notif(v_w1, 'Turno cancelado pela empresa') < 1
       OR pg_temp.n_notif(v_w3, 'Convite de turno cancelado') < 1 THEN
        RAISE EXCEPTION 'A26: hired e invited precisam ser avisados (trigger).'; END IF;
    IF pg_temp.n_notif(v_w2, 'Chamado cancelado') < 1 THEN RAISE EXCEPTION 'A26: alvo pendente do chamado nao foi avisado.'; END IF;
    IF pg_temp.n_notif(v_owner, 'Cancelamento de turno') < 1 THEN RAISE EXCEPTION 'A26: Gestor nao recebeu o rastro.'; END IF;
    IF pg_temp.n_notif(v_enc, 'Cancelamento de turno') <> v_n0 THEN
        RAISE EXCEPTION 'A26: quem cancelou nao deveria receber o proprio aviso.'; END IF;
    IF (SELECT count(*) FROM public.notifications WHERE user_id = v_w1 AND title = 'Chamado cancelado') <> 0 THEN
        RAISE EXCEPTION 'A26: freela ja avisado recebeu aviso duplicado.'; END IF;
    IF (SELECT count(*) FROM public.team_connections WHERE company_id = v_company) <> v_n_tc THEN
        RAISE EXCEPTION 'A26: Elenco mudou com o cancelamento.'; END IF;
    PERFORM pg_temp.as_user(v_enc);
    IF public.cancel_job(v_jc, NULL) ->> 'outcome' <> 'already_cancelled' THEN RAISE EXCEPTION 'A26: nao e idempotente.'; END IF;

    -- M-1: escrow vivo recusa sem alterar nada (precisa de uma wallet para a FK; sem wallet = PULADO)
    PERFORM pg_temp.as_server();
    v_jg := pg_temp.mk_job(v_job, '08:00', '12:00', 1);
    UPDATE public.jobs SET responsible_id = v_enc WHERE id = v_jg;
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM public.wallets) THEN
            INSERT INTO public.wallets (user_id, user_type) VALUES (v_owner, 'company');
        END IF;
        INSERT INTO public.escrow_transactions (job_id, amount, company_wallet_id, status)
        SELECT v_jg, 10, w.id, 'reserved' FROM public.wallets w LIMIT 1 RETURNING id INTO v_esc;
    EXCEPTION WHEN OTHERS THEN v_esc := NULL; RAISE NOTICE 'M-1: insert de escrow falhou (%): PULADO.', SQLERRM; END;
    IF v_esc IS NULL THEN
        RAISE NOTICE 'M-1 (escrow ativo): PULADO — escrow sintetico nao foi criado.';
    ELSE
        PERFORM pg_temp.as_user(v_enc);
        IF public.cancel_job(v_jg, NULL) ->> 'outcome' <> 'active_escrow' THEN
            RAISE EXCEPTION 'M-1: escrow reservado nao recusou o cancelamento.'; END IF;
        PERFORM pg_temp.as_server();
        IF (SELECT status FROM public.jobs WHERE id = v_jg) = 'deleted' THEN RAISE EXCEPTION 'M-1: a recusa alterou o turno.'; END IF;
    END IF;

    -- L-1: nao-Gestor nao cancela turno que JA COMECOU; o Gestor pode
    PERFORM pg_temp.as_server();
    v_jf := pg_temp.mk_job(v_job, '00:00', '01:00', 1);
    UPDATE public.jobs SET responsible_id = v_enc,
           start_date = ((((now() AT TIME ZONE 'America/Sao_Paulo')::date - 1)::text || ' 12:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo')
     WHERE id = v_jf;
    PERFORM pg_temp.as_user(v_enc);
    IF public.cancel_job(v_jf, NULL) ->> 'outcome' <> 'job_in_the_past' THEN
        RAISE EXCEPTION 'L-1: encarregado cancelou turno que ja passou.'; END IF;
    PERFORM pg_temp.as_user(v_owner);
    IF public.cancel_job(v_jf, NULL) ->> 'outcome' <> 'cancelled' THEN
        RAISE EXCEPTION 'L-1: Gestor deveria poder cancelar turno passado vazio.'; END IF;

    -- CORRIDA cancel_job x claim_shift_slot (M-2) — NAO automatizavel em uma sessao; rodar em QA com 2
    -- conexoes: (A) BEGIN; SELECT public.cancel_job(<turno com chamado aberto>); -- segura o lock do turno
    --                (B) SELECT public.claim_shift_slot(<chamado>);              -- bloqueia no FOR UPDATE de jobs
    --                (A) COMMIT;  => (B) le status='deleted' e devolve outcome='cancelled'; nenhuma application
    --                nova em hired. Inverso: (B) primeiro => (A) cancela tambem a candidatura que (B) criou.

    -- A27: Gestor cancela turno de OUTRO responsavel: mesmo comportamento; responsavel e avisado
    PERFORM pg_temp.as_server();
    PERFORM pg_temp.mk_app(v_jd, v_w1, 'hired');
    SELECT count(*) INTO v_n0 FROM public.notifications WHERE user_id = v_enc AND title = 'Cancelamento de turno';
    PERFORM pg_temp.as_user(v_owner);
    v_json := public.cancel_job(v_jd, NULL);
    IF v_json ->> 'outcome' <> 'cancelled' OR (v_json ->> 'cancelled_applications')::int <> 1 THEN
        RAISE EXCEPTION 'A27: Gestor nao cancelou turno de encarregado (%).', v_json; END IF;
    PERFORM pg_temp.as_server();
    IF pg_temp.n_notif(v_enc, 'Cancelamento de turno') <> v_n0 + 1 THEN RAISE EXCEPTION 'A27: responsavel nao foi avisado.'; END IF;
    IF pg_temp.n_notif(v_owner, 'Cancelamento de turno') > 1 THEN RAISE EXCEPTION 'A27: Gestor recebeu aviso do proprio cancelamento.'; END IF;

    -- ============ R20/A17: tags =====================================================================
    PERFORM pg_temp.as_user(v_enc);
    IF public.create_company_tag(v_company, 'QA Evento') ->> 'outcome' <> 'forbidden' THEN
        RAISE EXCEPTION 'R20: encarregado criou tag.'; END IF;
    PERFORM pg_temp.as_user(v_owner);
    v_json := public.create_company_tag(v_company, 'QA Evento');
    IF v_json ->> 'outcome' <> 'created' THEN RAISE EXCEPTION 'R20: tag nao criada (%).', v_json; END IF;
    v_tag := (v_json ->> 'tag_id')::uuid;
    IF public.create_company_tag(v_company, '  qa evento ') ->> 'outcome' <> 'already_exists' THEN
        RAISE EXCEPTION 'R20: nome com outra caixa duplicou.'; END IF;
    IF public.create_company_tag(v_company, '') ->> 'outcome' <> 'invalid_input' THEN RAISE EXCEPTION 'R20: nome vazio aceito.'; END IF;
    PERFORM pg_temp.as_user(v_enc);
    IF public.archive_company_tag(v_tag) ->> 'outcome' <> 'forbidden' THEN RAISE EXCEPTION 'R20: encarregado arquivou tag.'; END IF;
    IF public.set_job_tag(v_je, v_tag) ->> 'outcome' <> 'ok' THEN RAISE EXCEPTION 'R20: encarregado nao tagueou o proprio turno.'; END IF;
    IF public.set_job_tag(v_job, v_tag) ->> 'outcome' <> 'forbidden' THEN RAISE EXCEPTION 'R20: encarregado tagueou turno alheio.'; END IF;
    PERFORM pg_temp.as_user(v_owner);
    IF public.archive_company_tag(v_tag) ->> 'outcome' <> 'archived' THEN RAISE EXCEPTION 'R20: nao arquivou.'; END IF;
    IF public.archive_company_tag(v_tag) ->> 'outcome' <> 'already_archived' THEN RAISE EXCEPTION 'R20: arquivar 2x.'; END IF;
    PERFORM pg_temp.as_user(v_enc);
    IF public.set_job_tag(v_je, v_tag) ->> 'outcome' <> 'invalid_tag' THEN RAISE EXCEPTION 'A17: tag arquivada aceita em turno novo.'; END IF;
    PERFORM pg_temp.as_server();
    IF (SELECT tag_id FROM public.jobs WHERE id = v_je) IS DISTINCT FROM v_tag THEN
        RAISE EXCEPTION 'A17: turno historico perdeu a tag arquivada.'; END IF;
    PERFORM pg_temp.as_user(v_owner);
    BEGIN                                                                        -- nunca DELETE
        DELETE FROM public.company_tags WHERE id = v_tag;
        RAISE EXCEPTION 'A17: DELETE em company_tags funcionou.';
    EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN NULL; END;
    IF public.create_company_tag(v_company, 'QA Evento') ->> 'outcome' <> 'reactivated' THEN
        RAISE EXCEPTION 'R20: nome arquivado deveria reativar.'; END IF;

    -- ============ R7b/A25: my_link_risk_config ======================================================
    PERFORM pg_temp.as_server();
    v_company2 := gen_random_uuid();
    INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
    VALUES (v_company2, v_company2::text || '@invalido.local', now(),
            jsonb_build_object('user_type', 'hire', 'full_name', 'QA Segunda Empresa'));
    IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = v_company2) THEN
        RAISE EXCEPTION 'PRE-CONDICAO A25: o signup hire nao criou a segunda company.';
    END IF;
    PERFORM pg_temp.as_user(v_owner);
    SELECT count(*) INTO v_n FROM public.get_my_companies();
    v_json := public.my_link_risk_config();
    IF v_n = 1 AND (v_json ->> 'outcome' <> 'ok' OR NOT v_json ? 'enabled') THEN
        RAISE EXCEPTION 'A25: sessao de 1 company sem parametro deveria resolver (%).', v_json; END IF;
    IF v_n > 1 AND (v_json ->> 'outcome' <> 'company_required' OR v_json ? 'enabled' OR v_json ? 'threshold') THEN
        RAISE EXCEPTION 'A25: varias companies sem parametro deveria dar company_required sem dado (%).', v_json; END IF;
    v_json := public.my_link_risk_config(v_company);
    IF v_json ->> 'outcome' <> 'ok' OR NOT v_json ? 'threshold' THEN RAISE EXCEPTION 'A25: com p_company_id: %.', v_json; END IF;
    PERFORM pg_temp.as_user(v_enc);                                             -- confirmado le
    IF public.my_link_risk_config(v_company) ->> 'outcome' <> 'ok' THEN RAISE EXCEPTION 'A25: encarregado confirmado nao le a config.'; END IF;
    PERFORM pg_temp.as_user(v_enc3);                                            -- nao confirmado: nega SEM dado
    v_json := public.my_link_risk_config(v_company);
    IF v_json ->> 'outcome' <> 'forbidden' OR v_json ? 'enabled' THEN RAISE EXCEPTION 'A25: nao confirmado leu a config (%).', v_json; END IF;
    v_json := public.my_link_risk_config();
    IF v_json ->> 'outcome' <> 'forbidden' OR v_json ? 'enabled' THEN RAISE EXCEPTION 'A25: nao confirmado, sem parametro (%).', v_json; END IF;
    PERFORM pg_temp.as_user(v_w1);                                              -- freela: nega / default sem empresa
    IF public.my_link_risk_config(v_company) ->> 'outcome' <> 'forbidden' THEN RAISE EXCEPTION 'A25: freela leu config de empresa.'; END IF;
    IF public.my_link_risk_config() ->> 'outcome' <> 'no_company' THEN RAISE EXCEPTION 'A25: freela sem parametro deveria ser no_company.'; END IF;
    PERFORM pg_temp.as_server();
    INSERT INTO public.company_members (company_id, user_id, role, status, created_by, accepted_at)
    VALUES (v_company,  v_mgr, 'manager', 'active', v_owner, now()),
           (v_company2, v_mgr, 'manager', 'active', v_owner, now());
    UPDATE public.companies SET link_risk_alert_threshold = 3 WHERE id = v_company;
    UPDATE public.companies SET link_risk_alert_threshold = 5 WHERE id = v_company2;
    PERFORM pg_temp.as_user(v_mgr);
    v_json := public.my_link_risk_config();
    IF v_json ->> 'outcome' <> 'company_required' OR v_json ? 'enabled' OR v_json ? 'threshold' THEN
        RAISE EXCEPTION 'A25: duas companies sem parametro deveria dar company_required sem dado (%).', v_json; END IF;
    IF (public.my_link_risk_config(v_company)  ->> 'threshold')::int <> 3
       OR (public.my_link_risk_config(v_company2) ->> 'threshold')::int <> 5 THEN
        RAISE EXCEPTION 'A25: o limite devolvido nao e o da empresa pedida.'; END IF;

    -- ============ R21: avisos de claim / decline / respond roteados =================================
    PERFORM pg_temp.as_server();
    UPDATE public.jobs SET responsible_id = v_enc WHERE id = v_je;               -- (garante o estado)
    -- decline: chamado com UM alvo que recusa => "ninguem aceitou" vai ao responsavel E ao dono, sem duplicar
    INSERT INTO public.shift_calls (job_id, company_id, created_by, slots, reason, targets_count, status, origin, expires_at)
    VALUES (v_je, v_company, v_owner, 1, 'falta', 1, 'open', 'team', now() + interval '1 hour') RETURNING id INTO v_cid;
    INSERT INTO public.shift_call_targets (call_id, worker_id) VALUES (v_cid, v_w2);
    PERFORM pg_temp.as_user(v_w2);
    IF public.decline_shift_call(v_cid) ->> 'outcome' <> 'declined' THEN RAISE EXCEPTION 'R21: recusa falhou.'; END IF;
    PERFORM pg_temp.as_server();
    IF pg_temp.n_notif(v_enc, 'Ninguém aceitou o chamado') <> 1 OR pg_temp.n_notif(v_owner, 'Ninguém aceitou o chamado') <> 1 THEN
        RAISE EXCEPTION 'R21: "ninguem aceitou" nao chegou ao responsavel e ao Gestor (uma vez cada).'; END IF;
    IF pg_temp.n_notif(v_enc2, 'Ninguém aceitou o chamado') <> 0 OR pg_temp.n_notif(v_enc3, 'Ninguém aceitou o chamado') <> 0 THEN
        RAISE EXCEPTION 'R21: encarregado que nao e responsavel recebeu aviso.'; END IF;
    -- claim: aceite => "vaga preenchida" vai ao responsavel E ao dono
    INSERT INTO public.shift_calls (job_id, company_id, created_by, slots, reason, targets_count, status, origin, expires_at)
    VALUES (v_je, v_company, v_owner, 1, 'falta', 1, 'open', 'team', now() + interval '1 hour') RETURNING id INTO v_cid;
    INSERT INTO public.shift_call_targets (call_id, worker_id) VALUES (v_cid, v_w3);
    PERFORM pg_temp.as_user(v_w3);
    IF public.claim_shift_slot(v_cid) ->> 'outcome' <> 'claimed' THEN RAISE EXCEPTION 'R21: aceite falhou.'; END IF;
    PERFORM pg_temp.as_server();
    IF pg_temp.n_notif(v_enc, 'Vaga preenchida no turno') <> 1 OR pg_temp.n_notif(v_owner, 'Vaga preenchida no turno') <> 1 THEN
        RAISE EXCEPTION 'R21: "vaga preenchida" nao chegou ao responsavel e ao Gestor.'; END IF;
    -- respond: freela avisa que nao vai => responsavel E dono
    v_app := pg_temp.mk_app(v_je, v_w1, 'hired');
    INSERT INTO public.shift_attendance_confirmations (application_id, job_id, worker_id, source, requested_by)
    VALUES (v_app, v_je, v_w1, 'manual', v_owner);
    PERFORM pg_temp.as_user(v_w1);
    IF public.respond_attendance_confirmation(v_app, 'cannot_attend') ->> 'outcome' <> 'cannot_attend' THEN
        RAISE EXCEPTION 'R21: resposta de presenca falhou.'; END IF;
    PERFORM pg_temp.as_server();
    IF (SELECT count(*) FROM public.notifications WHERE user_id = v_enc   AND title LIKE '% avisou que não vai poder ir') < 1
       OR (SELECT count(*) FROM public.notifications WHERE user_id = v_owner AND title LIKE '% avisou que não vai poder ir') < 1 THEN
        RAISE EXCEPTION 'R21: aviso de "nao vou" nao chegou ao responsavel e ao Gestor.'; END IF;

    -- ============ relatorio v1 (Gestor-only) ========================================================
    PERFORM pg_temp.as_user(v_enc);
    IF public.list_jobs_by_responsible(v_company, v_start - 1, v_start + 1) ->> 'outcome' <> 'forbidden' THEN
        RAISE EXCEPTION 'A16: encarregado leu o relatorio.'; END IF;
    PERFORM pg_temp.as_server();
    UPDATE public.jobs SET responsible_id = v_enc3 WHERE id = v_je;              -- nao confirmado => cai no Gestor
    PERFORM pg_temp.as_user(v_owner);
    v_json := public.list_jobs_by_responsible(v_company, v_start - 1, v_start + 1);
    IF v_json ->> 'outcome' <> 'ok' THEN RAISE EXCEPTION 'relatorio: %.', v_json; END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_json -> 'items') i
                    WHERE i ->> 'job_id' = v_je::text AND i ->> 'responsible_label' = 'Gestor'
                      AND i ->> 'responsible_state' = 'removed') THEN
        RAISE EXCEPTION 'A16: turno de responsavel nao operador deveria aparecer como Gestor (%).', v_json; END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_json -> 'items') i
                    WHERE i ->> 'job_id' = v_jb::text AND i ->> 'responsible_label' = 'QA Enc 1') THEN
        RAISE EXCEPTION 'relatorio: responsavel visivel com o nome da pessoa (%).', v_json; END IF;
    v_json := public.list_jobs_by_responsible(v_company, v_start - 1, v_start + 1, v_enc);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_json -> 'items') i WHERE i ->> 'responsible_id' IS DISTINCT FROM v_enc::text) THEN
        RAISE EXCEPTION 'relatorio: filtro por pessoa devolveu turno de outro.'; END IF;
    v_json := public.list_jobs_by_responsible(v_company, v_start - 1, v_start + 1, v_owner);   -- filtro por Gestor inclui o fallback
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_json -> 'items') i WHERE i ->> 'job_id' = v_je::text) THEN
        RAISE EXCEPTION 'A16: filtro por Gestor nao incluiu o turno sem responsavel efetivo.'; END IF;
    v_json := public.list_jobs_by_responsible(v_company, v_start - 1, v_start + 1, NULL, v_tag);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_json -> 'items') i WHERE i ->> 'tag_id' IS DISTINCT FROM v_tag::text) THEN
        RAISE EXCEPTION 'relatorio: filtro por tag devolveu turno sem a tag.'; END IF;
    IF public.list_jobs_by_responsible(v_company, v_start, v_start + 400) ->> 'outcome' <> 'invalid_range' THEN
        RAISE EXCEPTION 'relatorio: janela > 92 dias aceita.'; END IF;

    -- ============ list_company_operators ============================================================
    PERFORM pg_temp.as_user(v_enc);                                             -- confirmado lista
    SELECT array_agg(user_id) INTO v_ws FROM public.list_company_operators(v_company);
    IF NOT (v_enc = ANY (v_ws) AND v_enc2 = ANY (v_ws) AND v_owner = ANY (v_ws)) THEN
        RAISE EXCEPTION 'operadores: encarregados confirmados e o Gestor precisam constar (%).', v_ws; END IF;
    IF v_enc3 = ANY (v_ws) THEN RAISE EXCEPTION 'operadores: encarregado NAO confirmado listado.'; END IF;
    SELECT count(*) INTO v_n FROM (SELECT jsonb_object_keys(to_jsonb(o)) AS k FROM public.list_company_operators(v_company) o) q
     WHERE k NOT IN ('user_id', 'label', 'role');
    IF v_n <> 0 THEN RAISE EXCEPTION 'operadores: payload tem campo alem de user_id, label e role.'; END IF;
    IF EXISTS (SELECT 1 FROM public.list_company_operators(v_company) o WHERE o.role NOT IN ('gestor', 'encarregado'))
       OR NOT EXISTS (SELECT 1 FROM public.list_company_operators(v_company) o WHERE o.user_id = v_enc2 AND o.role = 'encarregado')
       OR NOT EXISTS (SELECT 1 FROM public.list_company_operators(v_company) o WHERE o.user_id = v_owner AND o.role = 'gestor') THEN
        RAISE EXCEPTION 'operadores: papel incorreto (esperado gestor para o dono e encarregado para v_enc2).'; END IF;
    IF (SELECT string_agg(to_jsonb(o)::text, ' ') FROM public.list_company_operators(v_company) o) ~* '@' THEN
        RAISE EXCEPTION 'operadores: payload contem e-mail.'; END IF;
    PERFORM pg_temp.as_user(v_owner);                                           -- Gestor lista
    IF (SELECT count(*) FROM public.list_company_operators(v_company)) < 3 THEN
        RAISE EXCEPTION 'operadores: Gestor nao listou.'; END IF;
    PERFORM pg_temp.as_user(v_enc3);                                            -- nao confirmado: ERRO, nunca vazio
    v_ok := false;
    BEGIN PERFORM * FROM public.list_company_operators(v_company); v_ok := true;
    EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
    IF v_ok THEN RAISE EXCEPTION 'operadores: nao confirmado recebeu lista.'; END IF;
    PERFORM pg_temp.as_user(v_w1);                                              -- freela / outra company
    v_ok := false;
    BEGIN PERFORM * FROM public.list_company_operators(v_company); v_ok := true;
    EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
    IF v_ok THEN RAISE EXCEPTION 'operadores: usuario de fora recebeu lista.'; END IF;
    PERFORM pg_temp.as_user(v_enc);
    v_ok := false;
    BEGIN PERFORM * FROM public.list_company_operators(gen_random_uuid()); v_ok := true;
    EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
    IF v_ok THEN RAISE EXCEPTION 'operadores: encarregado listou company que nao opera.'; END IF;
    PERFORM pg_temp.as_server();

    -- ============ sessao NULA atravessa o guard editado (cron/service_role) =========================
    PERFORM pg_temp.as_server();
    UPDATE public.jobs SET responsible_id = v_enc2 WHERE id = v_jb;
    UPDATE public.jobs SET responsible_id = v_enc  WHERE id = v_jb;

    RAISE NOTICE 'OK: A5, A6, A14, A15, A16, A17, A18, A25, A26, A27, R20, R21, M1, sessao nula (E5) verdes.';
END
$t$;

ROLLBACK;  -- desfaz membros, turnos, candidaturas, chamados, pagamentos, tags, coberturas e avisos
