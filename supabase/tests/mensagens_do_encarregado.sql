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

-- 1.2b anon sem EXECUTE nas funcoes de acesso; authenticated com. esperado: anon = false, auth = true.
SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
  FROM pg_proc p WHERE p.oid IN ('public.can_access_application(text)'::regprocedure,
                                 'public.can_access_conversation(text)'::regprocedure);

-- 1.2c notify_new_message com search_path vazio e cobertura exigindo encarregado confirmado (from e to).
--     esperado: config contem search_path="" ; exige_from_to = true.
SELECT p.proconfig AS config,
       strpos(pg_get_functiondef(p.oid), 'cf.role = ''encarregado''') > 0
       AND strpos(pg_get_functiondef(p.oid), 'ct.role = ''encarregado''') > 0 AS exige_from_to
  FROM pg_proc p WHERE p.oid = 'public.notify_new_message()'::regprocedure;

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
        (SELECT to_jsonb(a) FROM public.applications a ORDER BY a.id LIMIT 1)
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
    v_cov uuid; v_cov2 uuid; v_enc_o uuid := gen_random_uuid(); v_other_co uuid;
    v_jg uuid; v_ag uuid; v_cg text := 'tst-g-' || gen_random_uuid(); v_jdel uuid; v_adel uuid;
    v_cdel text := 'tst-d-' || gen_random_uuid(); v_cnj text := 'tst-n-' || gen_random_uuid(); v_anj uuid;
    v_n0 integer; v_flag boolean; v_day date;
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

    -- senderid forjado falha (freela tenta enviar como outra pessoa)
    v_flag := false;
    BEGIN
        INSERT INTO public."Message" (id, content, conversationid, senderid)
        VALUES ('tst-f-' || gen_random_uuid(), 'x', v_ca, v_enc_a::text);
    EXCEPTION WHEN insufficient_privilege THEN v_flag := true; END;
    IF NOT v_flag THEN RAISE EXCEPTION 'senderid forjado foi aceito.'; END IF;

    -- UPDATE de content falha (so read_at muda)
    v_flag := false;
    BEGIN
        UPDATE public."Message" SET content = 'alterado' WHERE id = v_m_e;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n = 0 THEN v_flag := true; END IF;   -- RLS filtrou: tambem vale como barrado
    EXCEPTION WHEN OTHERS THEN v_flag := true; END;
    IF NOT v_flag THEN RAISE EXCEPTION 'UPDATE de content passou.'; END IF;
    PERFORM pg_temp.as_server();
    IF (SELECT content FROM public."Message" WHERE id = v_m_e) <> 'ola' THEN
        RAISE EXCEPTION 'content da mensagem mudou.'; END IF;

    -- Encarregado de OUTRA empresa ve zero
    SELECT c.id INTO v_other_co FROM public.companies c WHERE c.id <> v_company ORDER BY c.id LIMIT 1;
    IF v_other_co IS NULL THEN
        RAISE NOTICE 'PULADO: nao ha segunda empresa para o teste de encarregado de outra empresa.';
    ELSE
        ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
        INSERT INTO auth.users (id, email) VALUES (v_enc_o, v_enc_o::text || '@invalido.local');
        ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;
        INSERT INTO public.company_members (company_id, user_id, role, status, created_by, accepted_at, display_name, confirmed_at)
        VALUES (v_other_co, v_enc_o, 'encarregado', 'active', v_enc_o, now(), 'QA O', now());
        PERFORM pg_temp.as_user(v_enc_o);
        IF pg_temp.n_visible_conv(v_all) <> 0 THEN
            RAISE EXCEPTION 'Enc de outra empresa ve % conversa(s).', pg_temp.n_visible_conv(v_all); END IF;
        PERFORM pg_temp.as_server();
    END IF;

    -- anon: zero em Conversation/Message e sem EXECUTE
    IF has_function_privilege('anon', 'public.can_access_application(text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.can_access_conversation(text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.conversation_worker_id(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'anon tem EXECUTE nas funcoes de acesso do chat.'; END IF;
    v_flag := false;
    BEGIN
        SET LOCAL ROLE anon;
        IF (SELECT count(*) FROM public."Conversation" WHERE id = ANY (v_all)) = 0
           AND (SELECT count(*) FROM public."Message" WHERE conversationid = ANY (v_all)) = 0 THEN
            v_flag := true;
        END IF;
    EXCEPTION WHEN insufficient_privilege THEN v_flag := true; END;
    PERFORM pg_temp.as_server();
    IF NOT v_flag THEN RAISE EXCEPTION 'anon enxerga conversa/mensagem.'; END IF;

    -- Turno deleted: o freela mantem; (caracterizacao) o Gestor tambem, pois o seam nao filtra status
    v_jdel := pg_temp.mk_job(v_job, v_enc_a);
    UPDATE public.jobs SET status = 'deleted' WHERE id = v_jdel;
    v_adel := pg_temp.mk_app(v_jdel, v_w2);
    INSERT INTO public."Conversation" (id, application_uuid) VALUES (v_cdel, v_adel);
    PERFORM pg_temp.as_user(v_w2);
    IF NOT EXISTS (SELECT 1 FROM public."Conversation" WHERE id = v_cdel) THEN
        RAISE EXCEPTION 'Freela perdeu acesso a conversa de turno deleted.'; END IF;
    PERFORM pg_temp.as_user(v_owner);
    IF NOT EXISTS (SELECT 1 FROM public."Conversation" WHERE id = v_cdel) THEN
        RAISE EXCEPTION 'Gestor perdeu acesso a conversa de turno deleted (regressao).'; END IF;
    PERFORM pg_temp.as_server();

    -- Candidatura sem job_id: lado empresa falha fechado, freela mantem (se o schema permitir NULL)
    v_anj := pg_temp.mk_app(v_ja, v_w2);
    BEGIN
        UPDATE public.applications SET job_id = NULL WHERE id = v_anj;
        INSERT INTO public."Conversation" (id, application_uuid) VALUES (v_cnj, v_anj);
        PERFORM pg_temp.as_user(v_owner);
        IF EXISTS (SELECT 1 FROM public."Conversation" WHERE id = v_cnj) THEN
            RAISE EXCEPTION 'SEMJOB: Gestor ve conversa de candidatura sem job_id.'; END IF;
        PERFORM pg_temp.as_user(v_w2);
        IF NOT EXISTS (SELECT 1 FROM public."Conversation" WHERE id = v_cnj) THEN
            RAISE EXCEPTION 'SEMJOB: freela perdeu a conversa sem job_id.'; END IF;
    EXCEPTION WHEN not_null_violation THEN
        RAISE NOTICE 'PULADO: applications.job_id e NOT NULL (caso inalcancavel).';
    END;
    PERFORM pg_temp.as_server();

    -- Avisos x cobertura (M1). Turno B (responsavel enc_b), conversa cb (freela 1).
    SELECT (j.start_date AT TIME ZONE 'America/Sao_Paulo')::date INTO v_day FROM public.jobs j WHERE j.id = v_jb;
    -- (a) cobertura VALIDA: D recebe 1; enc_b (responsavel) 1; Gestor/dono em dois ramos do UNION: exatamente 1
    INSERT INTO public.responsibility_coverages (company_id, from_user_id, to_user_id, starts_on, ends_on, created_by)
    VALUES (v_company, v_enc_b, v_enc_d, v_day, v_day, v_owner) RETURNING id INTO v_cov2;
    SELECT count(*) INTO v_n0 FROM public.notifications WHERE user_id = v_owner AND link LIKE '%' || v_cb;
    INSERT INTO public."Message" (id, content, conversationid, senderid) VALUES ('tst-v1-' || gen_random_uuid(), 'cob', v_cb, v_w1::text);
    SELECT count(*) INTO v_n FROM public.notifications WHERE user_id = v_enc_d AND link LIKE '%' || v_cb;
    IF v_n <> 1 THEN RAISE EXCEPTION 'Cobertura valida: D deveria receber 1 aviso, recebeu %.', v_n; END IF;
    SELECT count(*) INTO v_n FROM public.notifications WHERE user_id = v_enc_b AND link LIKE '%' || v_cb;
    IF v_n <> 1 THEN RAISE EXCEPTION 'Responsavel B deveria receber 1 aviso, recebeu %.', v_n; END IF;
    SELECT count(*) INTO v_n FROM public.notifications WHERE user_id = v_owner AND link LIKE '%' || v_cb;
    IF v_n - v_n0 <> 1 THEN RAISE EXCEPTION 'Dono/Gestor (varios ramos) deveria receber exatamente 1, recebeu %.', v_n - v_n0; END IF;

    -- (b) cobertura REVOGADA: D nao recebe novo aviso
    UPDATE public.responsibility_coverages SET revoked_at = now() WHERE id = v_cov2;
    SELECT count(*) INTO v_n0 FROM public.notifications WHERE user_id = v_enc_d AND link LIKE '%' || v_cb;
    INSERT INTO public."Message" (id, content, conversationid, senderid) VALUES ('tst-v2-' || gen_random_uuid(), 'rev', v_cb, v_w1::text);
    SELECT count(*) INTO v_n FROM public.notifications WHERE user_id = v_enc_d AND link LIKE '%' || v_cb;
    IF v_n <> v_n0 THEN RAISE EXCEPTION 'Cobertura revogada vazou aviso para D.'; END IF;

    -- (c) cobertura cujo FROM e Gestor (inerte, M1): D nao recebe aviso
    v_jg := pg_temp.mk_job(v_job, v_owner);
    v_ag := pg_temp.mk_app(v_jg, v_w1);
    INSERT INTO public."Conversation" (id, application_uuid) VALUES (v_cg, v_ag);
    SELECT (j.start_date AT TIME ZONE 'America/Sao_Paulo')::date INTO v_day FROM public.jobs j WHERE j.id = v_jg;
    BEGIN
        INSERT INTO public.responsibility_coverages (company_id, from_user_id, to_user_id, starts_on, ends_on, created_by)
        VALUES (v_company, v_owner, v_enc_d, v_day, v_day, v_owner);
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'cobertura com from=Gestor rejeitada pelo schema (%): inerte por construcao.', SQLERRM;
    END;
    INSERT INTO public."Message" (id, content, conversationid, senderid) VALUES ('tst-v3-' || gen_random_uuid(), 'g', v_cg, v_w1::text);
    SELECT count(*) INTO v_n FROM public.notifications WHERE user_id = v_enc_d AND link LIKE '%' || v_cg;
    IF v_n <> 0 THEN RAISE EXCEPTION 'Cobertura de Gestor vazou aviso para D.'; END IF;

    -- (d) remetente operador nao recebe o proprio aviso (mensagem do lado empresa so avisa o freela)
    SELECT count(*) INTO v_n0 FROM public.notifications WHERE user_id = v_enc_a AND link LIKE '%' || v_ca;
    INSERT INTO public."Message" (id, content, conversationid, senderid) VALUES ('tst-v4-' || gen_random_uuid(), 'eu', v_ca, v_enc_a::text);
    SELECT count(*) INTO v_n FROM public.notifications WHERE user_id = v_enc_a AND link LIKE '%' || v_ca;
    IF v_n <> v_n0 THEN RAISE EXCEPTION 'Remetente operador recebeu o proprio aviso.'; END IF;

    RAISE NOTICE 'mensagens_do_encarregado: PARTE 2 OK';
END $t$;

ROLLBACK;
