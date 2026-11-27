-- Auditoria: Mensagens do Encarregado (ADR-20261127)
-- File: supabase/tests/mensagens_do_encarregado.sql
-- NAO e migration. Rodar a mao DEPOIS de aplicar 20261205000500_mensagens_do_encarregado.sql.
-- PARTE 1 e READ-ONLY (pode rodar em producao). PARTE 2 escreve dentro de BEGIN...ROLLBACK: so em
-- branch/QA. Escrita SEM execucao previa contra banco: a primeira rodada em QA faz parte da verificacao.

-- ============================================================================
-- PARTE 1 — CATALOGO (read-only)
-- ============================================================================

-- 1.1 can_access_application usa o seam do turno e nao a ancoragem de Gestor.
--     esperado: usa_job_owner = true, usa_company_owner = false, definer = true, search_path vazio.
SELECT strpos(pg_get_functiondef(p.oid), 'is_job_owner(a.job_id)') > 0 AS usa_job_owner,
       strpos(pg_get_functiondef(p.oid), 'is_company_owner') > 0       AS usa_company_owner,
       p.prosecdef AS definer, p.proconfig AS config
  FROM pg_proc p WHERE p.oid = 'public.can_access_application(text)'::regprocedure;

-- 1.2 conversation_worker_id: DEFINER, anon SEM EXECUTE, authenticated COM.
--     esperado: definer = true; anon_exec = false; auth_exec = true.
SELECT p.prosecdef AS definer,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
  FROM pg_proc p WHERE p.oid = 'public.conversation_worker_id(text)'::regprocedure;

-- 1.3 Message: so 3 policies; a de UPDATE usa o helper.
--     esperado: 3 linhas; message_update_read_receipt com usa_helper = true.
SELECT polname, polcmd,
       strpos(pg_get_expr(polqual, polrelid), 'conversation_worker_id') > 0 AS usa_helper
  FROM pg_policy WHERE polrelid = 'public."Message"'::regclass ORDER BY 1;

-- 1.4 notify_new_message avisa seam + cobertura. esperado: ambos = true.
SELECT strpos(pg_get_functiondef(p.oid), 'notification_recipients_for_job') > 0 AS seam,
       strpos(pg_get_functiondef(p.oid), 'responsibility_coverages') > 0         AS cobertura
  FROM pg_proc p WHERE p.oid = 'public.notify_new_message()'::regprocedure;

-- 1.5 Sem PII nova: Message/Conversation nao ganharam colunas alem das conhecidas.
--     esperado: Conversation = id, createdat, islocked, application_uuid; nenhuma coluna de CPF/PIX/telefone.
SELECT table_name, column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name IN ('Conversation', 'Message')
   AND column_name ~* '(cpf|pix|phone|telefone|birth|email)';
-- esperado: 0 linhas.

-- 1.6 Conversas sem application_uuid ou sem turno (lado empresa deve falhar fechado).
--     esperado: informativo; qualquer linha so e acessivel ao freela dono da candidatura.
SELECT count(*) AS conversas_sem_turno
  FROM public."Conversation" c LEFT JOIN public.applications a ON a.id = c.application_uuid
 WHERE a.id IS NULL OR a.job_id IS NULL;

-- ============================================================================
-- PARTE 2 — COMPORTAMENTO (ESCREVE; ROLLBACK ao fim; NUNCA em producao)
-- Pre-condicoes: 1 empresa com Gestor, >= 3 usuarios auth que nao sejam freela dessa empresa
-- (E1, E2 encarregados, E3 sem vinculo) e >= 1 freela (W) em `workers`. Papeis simulados por
-- SET LOCAL ROLE authenticated + request.jwt.claims.
-- ============================================================================
BEGIN;

CREATE FUNCTION pg_temp.as_user(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
END $f$;

CREATE FUNCTION pg_temp.as_server() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
END $f$;

CREATE FUNCTION pg_temp.mk_job(p_tpl uuid, p_resp uuid) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
    INSERT INTO public.jobs
    SELECT * FROM jsonb_populate_record(NULL::public.jobs,
        (SELECT to_jsonb(j) FROM public.jobs j WHERE j.id = p_tpl)
        || jsonb_build_object('id', v_id, 'responsible_id', p_resp, 'series_id', NULL, 'tag_id', NULL, 'status', 'open'));
    RETURN v_id;
END $f$;

CREATE FUNCTION pg_temp.mk_app(p_job uuid, p_worker uuid) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
    INSERT INTO public.applications
    SELECT * FROM jsonb_populate_record(NULL::public.applications,
        (SELECT to_jsonb(a) FROM public.applications a LIMIT 1)
        || jsonb_build_object('id', v_id, 'job_id', p_job, 'worker_id', p_worker, 'status', 'hired',
                              'worker_checkin_at', NULL, 'company_checkin_confirmed_at', NULL,
                              'company_checkout_confirmed_at', NULL, 'invited_by_company_at', now()));
    RETURN v_id;
END $f$;

CREATE FUNCTION pg_temp.n_visible_conv(p_ids text[]) RETURNS integer LANGUAGE sql AS $f$
    SELECT count(*)::integer FROM public."Conversation" WHERE id = ANY (p_ids);
$f$;

DO $t$
DECLARE
    v_company uuid; v_job uuid; v_owner uuid;
    v_enc_a uuid := gen_random_uuid();   -- confirmado, responsavel do turno A
    v_enc_b uuid := gen_random_uuid();   -- confirmado, responsavel do turno B
    v_enc_c uuid := gen_random_uuid();   -- NAO confirmado, responsavel do turno C
    v_enc_d uuid := gen_random_uuid();   -- confirmado, cobre B na data
    v_enc_r uuid := gen_random_uuid();   -- confirmado e depois REMOVIDO
    v_ws uuid[]; v_w1 uuid; v_w2 uuid;
    v_ja uuid; v_jb uuid; v_jc uuid; v_jr uuid;
    v_aa uuid; v_ab uuid; v_ac uuid; v_ar uuid; v_ax uuid;
    v_ca text := 'tst-a-' || gen_random_uuid(); v_cb text := 'tst-b-' || gen_random_uuid();
    v_cc text := 'tst-c-' || gen_random_uuid(); v_cr text := 'tst-r-' || gen_random_uuid();
    v_cx text := 'tst-x-' || gen_random_uuid();
    v_all text[]; v_n integer;
    v_m_w text := 'tst-mw-' || gen_random_uuid(); v_m_e text := 'tst-me-' || gen_random_uuid();
    v_cov uuid;
BEGIN
    PERFORM pg_temp.as_server();
    SELECT j.company_id, j.id, COALESCE(c.owner_id, c.id)
      INTO v_company, v_job, v_owner
      FROM public.jobs j JOIN public.companies c ON c.id = j.company_id
     WHERE j.status <> 'deleted' AND j.start_date IS NOT NULL ORDER BY j.created_at DESC NULLS LAST LIMIT 1;
    IF v_job IS NULL OR NOT EXISTS (SELECT 1 FROM public.applications) THEN
        RAISE EXCEPTION 'PRE-CONDICAO: preciso de empresa com turno e de uma application molde.'; END IF;
    SELECT array_agg(id) INTO v_ws FROM (SELECT w.id FROM public.workers w
        WHERE NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = v_job AND a.worker_id = w.id)
        ORDER BY w.id LIMIT 2) x;
    IF v_ws IS NULL OR cardinality(v_ws) < 2 THEN RAISE EXCEPTION 'PRE-CONDICAO: preciso de 2 freelas.'; END IF;
    v_w1 := v_ws[1]; v_w2 := v_ws[2];

    IF position('encarregado' IN (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                                   WHERE conrelid = 'public.company_members'::regclass
                                     AND conname = 'company_members_role_check')) = 0 THEN
        RAISE EXCEPTION 'PRE-CONDICAO: E4 nao aplicada (CHECK de role).'; END IF;

    ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
    INSERT INTO auth.users (id, email)
      SELECT x, x::text || '@invalido.local' FROM unnest(ARRAY[v_enc_a, v_enc_b, v_enc_c, v_enc_d, v_enc_r]) x;
    ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;
    INSERT INTO public.company_members (company_id, user_id, role, status, created_by, accepted_at, display_name, confirmed_at)
    VALUES (v_company, v_enc_a, 'encarregado', 'active', v_owner, now(), 'QA A', now()),
           (v_company, v_enc_b, 'encarregado', 'active', v_owner, now(), 'QA B', now()),
           (v_company, v_enc_c, 'encarregado', 'active', v_owner, now(), 'QA C', NULL),
           (v_company, v_enc_d, 'encarregado', 'active', v_owner, now(), 'QA D', now()),
           (v_company, v_enc_r, 'encarregado', 'active', v_owner, now(), 'QA R', now());

    v_ja := pg_temp.mk_job(v_job, v_enc_a); v_jb := pg_temp.mk_job(v_job, v_enc_b);
    v_jc := pg_temp.mk_job(v_job, v_enc_c); v_jr := pg_temp.mk_job(v_job, v_enc_r);
    v_aa := pg_temp.mk_app(v_ja, v_w1); v_ab := pg_temp.mk_app(v_jb, v_w1);
    v_ac := pg_temp.mk_app(v_jc, v_w1); v_ar := pg_temp.mk_app(v_jr, v_w1);
    v_ax := pg_temp.mk_app(v_ja, v_w2);   -- outro freela, turno de A
    INSERT INTO public."Conversation" (id, application_uuid) VALUES
        (v_ca, v_aa), (v_cb, v_ab), (v_cc, v_ac), (v_cr, v_ar), (v_cx, v_ax);
    v_all := ARRAY[v_ca, v_cb, v_cc, v_cr, v_cx];

    -- Gestor (dono) ve tudo
    PERFORM pg_temp.as_user(v_owner);
    IF pg_temp.n_visible_conv(v_all) <> 5 THEN
        RAISE EXCEPTION 'Gestor: esperava ver as 5 conversas, viu %.', pg_temp.n_visible_conv(v_all); END IF;

    -- Encarregado A: so as conversas do turno A (freela 1 e freela 2)
    PERFORM pg_temp.as_user(v_enc_a);
    IF pg_temp.n_visible_conv(v_all) <> 2
       OR NOT EXISTS (SELECT 1 FROM public."Conversation" WHERE id = v_ca)
       OR NOT EXISTS (SELECT 1 FROM public."Conversation" WHERE id = v_cx) THEN
        RAISE EXCEPTION 'Enc A: esperava so as conversas do turno A, viu %.', pg_temp.n_visible_conv(v_all); END IF;

    -- Enc A nao envia em conversa de B
    BEGIN
        INSERT INTO public."Message" (id, content, conversationid, senderid)
        VALUES ('tst-x-' || gen_random_uuid(), 'x', v_cb, v_enc_a::text);
        RAISE EXCEPTION 'Enc A: inseriu mensagem em conversa de B (RLS nao barrou).';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;

    -- Nao confirmado: zero
    PERFORM pg_temp.as_user(v_enc_c);
    IF pg_temp.n_visible_conv(v_all) <> 0 THEN
        RAISE EXCEPTION 'Enc nao confirmado ve % conversa(s).', pg_temp.n_visible_conv(v_all); END IF;

    -- Removido: zero
    PERFORM pg_temp.as_server();
    UPDATE public.company_members SET status = 'removed', removed_at = now()
     WHERE company_id = v_company AND user_id = v_enc_r;
    PERFORM pg_temp.as_user(v_enc_r);
    IF pg_temp.n_visible_conv(v_all) <> 0 THEN
        RAISE EXCEPTION 'Enc removido ve % conversa(s).', pg_temp.n_visible_conv(v_all); END IF;

    -- Cobertura: D cobre B na data do turno B
    PERFORM pg_temp.as_user(v_enc_d);
    IF pg_temp.n_visible_conv(v_all) <> 0 THEN RAISE EXCEPTION 'Enc D ve conversa antes da cobertura.'; END IF;
    PERFORM pg_temp.as_server();
    INSERT INTO public.responsibility_coverages (company_id, from_user_id, to_user_id, starts_on, ends_on, created_by)
    SELECT v_company, v_enc_b, v_enc_d, (j.start_date AT TIME ZONE 'America/Sao_Paulo')::date,
           (j.start_date AT TIME ZONE 'America/Sao_Paulo')::date, v_owner
      FROM public.jobs j WHERE j.id = v_jb RETURNING id INTO v_cov;
    PERFORM pg_temp.as_user(v_enc_d);
    IF pg_temp.n_visible_conv(v_all) <> 1 OR NOT EXISTS (SELECT 1 FROM public."Conversation" WHERE id = v_cb) THEN
        RAISE EXCEPTION 'Enc D: com cobertura deveria ver so a conversa B.'; END IF;
    PERFORM pg_temp.as_server();
    UPDATE public.responsibility_coverages SET revoked_at = now() WHERE id = v_cov;
    PERFORM pg_temp.as_user(v_enc_d);
    IF pg_temp.n_visible_conv(v_all) <> 0 THEN RAISE EXCEPTION 'Enc D: cobertura revogada ainda da acesso.'; END IF;

    -- Freela nao ve conversa alheia
    PERFORM pg_temp.as_user(v_w2);
    IF pg_temp.n_visible_conv(v_all) <> 1 OR NOT EXISTS (SELECT 1 FROM public."Conversation" WHERE id = v_cx) THEN
        RAISE EXCEPTION 'Freela 2: deveria ver so a propria conversa.'; END IF;
    PERFORM pg_temp.as_user(v_w1);
    IF pg_temp.n_visible_conv(v_all) <> 4 THEN RAISE EXCEPTION 'Freela 1: deveria ver as 4 proprias.'; END IF;

    -- Aviso: freela escreve na conversa A -> Gestor e Enc A recebem 1 cada; o freela, nenhum
    PERFORM pg_temp.as_server();
    INSERT INTO public."Message" (id, content, conversationid, senderid) VALUES (v_m_w, 'oi', v_ca, v_w1::text);
    SELECT count(*) INTO v_n FROM public.notifications WHERE user_id = v_enc_a AND link LIKE '%' || v_ca;
    IF v_n <> 1 THEN RAISE EXCEPTION 'Aviso: Enc A deveria receber 1, recebeu %.', v_n; END IF;
    SELECT count(*) INTO v_n FROM public.notifications WHERE user_id = v_owner AND link LIKE '%' || v_ca;
    IF v_n <> 1 THEN RAISE EXCEPTION 'Aviso: Gestor deveria receber 1, recebeu %.', v_n; END IF;
    SELECT count(*) INTO v_n FROM public.notifications WHERE user_id IN (v_w1, v_enc_b, v_enc_c) AND link LIKE '%' || v_ca;
    IF v_n <> 0 THEN RAISE EXCEPTION 'Aviso: remetente/outro encarregado recebeu aviso (%).', v_n; END IF;

    -- Recibo: Enc A responde ao freela; Gestor abre e NAO marca a mensagem da propria empresa
    INSERT INTO public."Message" (id, content, conversationid, senderid) VALUES (v_m_e, 'ola', v_ca, v_enc_a::text);
    PERFORM pg_temp.as_user(v_owner);
    UPDATE public."Message" SET read_at = now() WHERE id = v_m_e;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 0 THEN RAISE EXCEPTION 'Recibo: Gestor marcou como lida mensagem da propria empresa.'; END IF;
    UPDATE public."Message" SET read_at = now() WHERE id = v_m_w;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'Recibo: Gestor deveria marcar a mensagem do freela.'; END IF;

    -- Freela marca a da empresa, nao a propria
    PERFORM pg_temp.as_user(v_w1);
    UPDATE public."Message" SET read_at = now() WHERE id = v_m_w;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 0 THEN RAISE EXCEPTION 'Recibo: freela marcou a propria mensagem.'; END IF;
    UPDATE public."Message" SET read_at = now() WHERE id = v_m_e;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'Recibo: freela deveria marcar a mensagem da empresa.'; END IF;

    RAISE NOTICE 'mensagens_do_encarregado: PARTE 2 OK';
END $t$;

ROLLBACK;
