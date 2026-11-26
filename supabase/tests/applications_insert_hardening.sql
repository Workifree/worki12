-- Testes de caracterizacao: 20261125000100_applications_insert_hardening.sql
-- NAO e migration. Rodar a mao DEPOIS de aplicar a migration.
-- PARTE 1: read-only, pode rodar em producao.
-- PARTE 2: escreve dentro de transacao com ROLLBACK. Rodar em branch/QA/PGlite, NUNCA em producao.
--   Pre-condicoes: 1 turno 'open' e 3 freelas sem candidatura nele e sem vinculo com a empresa dele.
--   Falha = RAISE EXCEPTION.

-- ============================================================================
-- PARTE 1 — AUDITORIA (read-only)
-- ============================================================================

-- 1.1 esperado: 1 linha, definer = false, enabled = 'O'.
SELECT t.tgname, t.tgenabled AS enabled, p.prosecdef AS definer
  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE t.tgrelid = 'public.applications'::regclass AND t.tgname = 'trg_zz_applications_insert_guard';

-- 1.2 Linhas SUSPEITAS de forja passada (triagem humana, nao e prova): carimbo anterior a criacao
--     da linha, ou freela e empresa carimbados no mesmo instante exato. A empresa pode registrar
--     horario manual retroativo, entao as colunas company_* geram falso positivo.
SELECT a.id, a.job_id, a.worker_id, a.status, a.created_at,
       a.worker_checkin_at, a.worker_checkout_at,
       a.company_checkin_confirmed_at, a.company_checkout_confirmed_at
  FROM public.applications a
 WHERE a.worker_checkin_at < a.created_at
    OR a.worker_checkout_at < a.created_at
    OR a.worker_checkin_at = a.company_checkin_confirmed_at
    OR a.worker_checkout_at = a.company_checkout_confirmed_at;

-- ============================================================================
-- PARTE 2 — COMPORTAMENTO (BEGIN ... ROLLBACK)
-- ============================================================================
BEGIN;

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

-- Exige que o comando seja recusado PELO GUARD (nao por RLS, constraint ou outra causa).
CREATE FUNCTION pg_temp.deve_recusar(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN insufficient_privilege THEN
        IF SQLERRM LIKE 'applications_insert_guard:%' THEN RETURN; END IF;
        RAISE EXCEPTION 'FALHA [%]: recusado por outra causa: %', p_label, SQLERRM;
    END;
    RAISE EXCEPTION 'FALHA [%]: INSERT forjado foi aceito', p_label;
END $f$;

-- Dublê de RPC/servidor: DEFINER do dono, chamada por 'authenticated'.
CREATE FUNCTION pg_temp.definer_insert(p_job uuid, p_worker uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER AS $f$
    INSERT INTO public.applications (job_id, worker_id, status, worker_checkin_at, company_checkin_confirmed_at)
    VALUES (p_job, p_worker, 'hired', now(), now()) RETURNING id;
$f$;

DO $t$
DECLARE
    v_job uuid; v_company uuid; v_owner uuid; v_ws uuid[];
    v_call uuid; v_json jsonb; v_col text; v_st text; v_n integer; v_id uuid;
    v_base text;
BEGIN
    SELECT j.id, j.company_id, COALESCE(c.owner_id, c.id) INTO v_job, v_company, v_owner
      FROM public.jobs j JOIN public.companies c ON c.id = j.company_id
     WHERE j.status = 'open' LIMIT 1;
    SELECT array_agg(id) INTO v_ws FROM (
        SELECT w.id FROM public.workers w
         WHERE w.id <> v_owner
           AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = v_job AND a.worker_id = w.id)
           AND NOT EXISTS (SELECT 1 FROM public.team_connections tc WHERE tc.company_id = v_company AND tc.worker_id = w.id)
         LIMIT 3) s;
    IF v_job IS NULL OR COALESCE(array_length(v_ws, 1), 0) < 3 THEN
        RAISE EXCEPTION 'PRE-CONDICAO: falta turno open ou 3 freelas livres';
    END IF;
    INSERT INTO public.team_connections (company_id, worker_id, status, source)
    VALUES (v_company, v_ws[2], 'accepted', 'link');

    -- ---------------- FREELA (v_ws[1]) ----------------
    PERFORM pg_temp.as_user(v_ws[1]);
    SET LOCAL ROLE authenticated;
    v_base := format('INSERT INTO public.applications (job_id, worker_id, status, %%I) VALUES (%L, %L, ''pending'', %%L)',
                     v_job, v_ws[1]);
    FOREACH v_col IN ARRAY ARRAY['worker_checkin_at','worker_checkout_at',
                                 'company_checkin_confirmed_at','company_checkout_confirmed_at',
                                 'invitation_responded_at','invited_by_company_at']
    LOOP
        PERFORM pg_temp.deve_recusar('freela ' || v_col, format(v_base, v_col, now()));
    END LOOP;
    PERFORM pg_temp.deve_recusar('freela invitation_response', format(v_base, 'invitation_response', 'accepted'));

    FOREACH v_st IN ARRAY ARRAY['hired','in_progress','completed','approved','accepted','applied',
                                'reviewing','interview','rejected','cancelled','declined','invited', NULL]
    LOOP
        PERFORM pg_temp.deve_recusar('freela status ' || COALESCE(v_st, 'NULL'), format(
            'INSERT INTO public.applications (job_id, worker_id, status) VALUES (%L, %L, %L)',
            v_job, v_ws[1], v_st));
    END LOOP;
    -- o ataque (2) completo
    PERFORM pg_temp.deve_recusar('ataque 2', format(
        'INSERT INTO public.applications (job_id, worker_id, status, worker_checkin_at, worker_checkout_at, '
        'company_checkin_confirmed_at, company_checkout_confirmed_at) VALUES (%L, %L, ''hired'', now(), now(), now(), now())',
        v_job, v_ws[1]));
    -- A1: freela FORA do Elenco se convidando, com a marca
    PERFORM pg_temp.deve_recusar('freela fora do Elenco: invited com marca', format(
        'INSERT INTO public.applications (job_id, worker_id, status, invited_by_company_at) '
        'VALUES (%L, %L, ''invited'', now())', v_job, v_ws[1]));
    -- A1: freela DENTRO do Elenco se convidando, com a marca
    PERFORM pg_temp.as_user(v_ws[2]);
    PERFORM pg_temp.deve_recusar('freela do Elenco: invited com marca', format(
        'INSERT INTO public.applications (job_id, worker_id, status, invited_by_company_at) '
        'VALUES (%L, %L, ''invited'', now())', v_job, v_ws[2]));
    PERFORM pg_temp.deve_recusar('candidatura em nome de outro', format(
        'INSERT INTO public.applications (job_id, worker_id, status) VALUES (%L, %L, ''pending'')',
        v_job, v_ws[1]));
    PERFORM pg_temp.as_user(v_ws[1]);
    -- legitimo: candidatura pull limpa
    INSERT INTO public.applications (job_id, worker_id, status) VALUES (v_job, v_ws[1], 'pending');
    RESET ROLE;

    -- ---------------- EMPRESA ----------------
    PERFORM pg_temp.as_user(v_owner);
    SET LOCAL ROLE authenticated;
    v_base := format('INSERT INTO public.applications (job_id, worker_id, status, invited_by_company_at, %%I) '
                     'VALUES (%L, %L, ''invited'', now(), %%L)', v_job, v_ws[2]);
    FOREACH v_col IN ARRAY ARRAY['worker_checkin_at','worker_checkout_at',
                                 'company_checkin_confirmed_at','company_checkout_confirmed_at',
                                 'invitation_responded_at']
    LOOP
        PERFORM pg_temp.deve_recusar('empresa ' || v_col, format(v_base, v_col, now()));   -- ataque (1)
    END LOOP;
    PERFORM pg_temp.deve_recusar('empresa invitation_response', format(v_base, 'invitation_response', 'accepted'));
    PERFORM pg_temp.deve_recusar('empresa cria pending em nome do freela', format(
        'INSERT INTO public.applications (job_id, worker_id, status) VALUES (%L, %L, ''pending'')',
        v_job, v_ws[2]));
    PERFORM pg_temp.deve_recusar('empresa convida a si mesma', format(
        'INSERT INTO public.applications (job_id, worker_id, status, invited_by_company_at) '
        'VALUES (%L, %L, ''invited'', now())', v_job, v_owner));
    -- legitimo: convite limpo; B1: datas forjadas sao substituidas pelo servidor
    INSERT INTO public.applications (job_id, worker_id, status, invited_by_company_at, invitation_expires_at, created_at)
    VALUES (v_job, v_ws[2], 'invited', now() - interval '1 year', now() + interval '1 day',
            now() - interval '1 year');
    RESET ROLE;
    SELECT count(*) INTO v_n FROM public.applications
     WHERE job_id = v_job AND worker_id = v_ws[2] AND created_at = now() AND invited_by_company_at = now();
    IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA [B1]: datas do cliente nao foram substituidas'; END IF;
    RESET ROLE;

    -- ---------------- SERVIDOR ----------------
    -- DEFINER chamada por usuario autenticado continua livre
    PERFORM pg_temp.as_user(v_ws[3]);
    SET LOCAL ROLE authenticated;
    v_id := pg_temp.definer_insert(v_job, v_ws[3]);
    RESET ROLE;
    DELETE FROM public.applications WHERE id = v_id;

    -- service_role
    PERFORM pg_temp.as_server();
    SET LOCAL ROLE service_role;
    INSERT INTO public.applications (job_id, worker_id, status, worker_checkin_at)
    VALUES (v_job, v_ws[3], 'completed', now()) RETURNING id INTO v_id;
    DELETE FROM public.applications WHERE id = v_id;
    RESET ROLE;

    -- postgres / cron
    INSERT INTO public.applications (job_id, worker_id, status, company_checkin_confirmed_at)
    VALUES (v_job, v_ws[3], 'hired', now()) RETURNING id INTO v_id;
    DELETE FROM public.applications WHERE id = v_id;

    -- ---------------- claim_shift_slot REAL ----------------
    UPDATE public.jobs SET slots = 50 WHERE id = v_job;
    INSERT INTO public.shift_calls (job_id, company_id, created_by, slots, reason, targets_count, status, expires_at)
    VALUES (v_job, v_company, v_owner, 1, 'reforco', 1, 'open', now() + interval '1 hour')
    RETURNING id INTO v_call;
    INSERT INTO public.shift_call_targets (call_id, worker_id) VALUES (v_call, v_ws[3]);

    PERFORM pg_temp.as_user(v_ws[3]);
    SET LOCAL ROLE authenticated;
    v_json := public.claim_shift_slot(v_call);
    RESET ROLE;
    IF v_json->>'outcome' IS DISTINCT FROM 'claimed' THEN
        RAISE EXCEPTION 'FALHA [claim_shift_slot]: %', v_json;
    END IF;
    SELECT count(*) INTO v_n FROM public.applications
     WHERE job_id = v_job AND worker_id = v_ws[3] AND status = 'hired'
       AND invitation_response = 'accepted' AND worker_checkin_at IS NULL;
    IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA [claim_shift_slot]: linha nao criada como esperado'; END IF;

    RAISE NOTICE 'applications_insert_hardening: TODOS OS TESTES PASSARAM';
END $t$;

ROLLBACK;
