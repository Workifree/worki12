-- Auditoria e caracterizacao: Lojas como etiquetas + equipe unificada (Gestor e Encarregado num convite so)
-- File: supabase/tests/equipe_lojas_unificada_auditoria.sql
-- NAO e migration (fica fora de supabase/migrations/ de proposito). Rodar a mao, por MCP/psql, DEPOIS de aplicar
-- 20261204000400_lojas_etiquetas_equipe_unificada.sql (e E0-E5 + 20261127000200).
-- ADR: .harness/memory-bank/decisions/ADR-20261127-lojas-como-etiquetas-e-equipe-unificada.md
--
-- PARTE 1 e READ-ONLY (pode rodar em producao). PARTE 2 escreve (auth.users, companies, company_members,
-- company_tags, jobs...) DENTRO de BEGIN ... ROLLBACK, dados sinteticos (@invalido.local): rodar em QA/branch.
-- Falha = RAISE EXCEPTION. Escrita SEM execucao contra banco: a primeira rodada em QA e parte da verificacao.

-- ============================================================================
-- PARTE 1 — AUDITORIA ESTRUTURAL (read-only)
-- ============================================================================

-- 1.1 Coluna, FK composta e CHECK de papel. esperado: 3 linhas (FK referencia company_tags(company_id,id)).
SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
 WHERE conname IN ('company_members_default_tag_fk','company_members_default_tag_role_chk','company_tags_company_id_id_key');

-- 1.2 D7: porta antiga fechada. esperado: auth_exec = false e anon_exec = false nas tres; svc_exec = true.
--     accept_company_invite_by_token NAO esta na lista de proposito (e o aceite do Elenco do FREELA: auth_exec = true).
SELECT p.proname,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc_exec
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('invite_company_manager','accept_manager_invite','revoke_company_manager');

-- 1.3 RPCs novas: DEFINER + search_path vazio; internal_member_default_tag sem EXECUTE para authenticated/anon.
--     esperado: rename_company_tag e set_member_default_tag com auth_exec = true, anon_exec = false.
SELECT p.proname, p.prosecdef AS definer, p.proconfig AS config,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('rename_company_tag','set_member_default_tag','internal_member_default_tag','invite_company_member');

-- 1.4 invite_company_member so existe com 5 argumentos (a de 4 foi dropada). esperado: 1 linha.
SELECT pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'invite_company_member';

-- 1.5 D3: o seam NAO le tag_id nem default_tag_id. esperado: 0 linhas.
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('is_company_owner','is_job_owner','session_can_operate_job','session_operates_company_membership')
   AND (pg_get_functiondef(p.oid) ILIKE '%default_tag%' OR pg_get_functiondef(p.oid) ILIKE '%tag_id%');

-- 1.6 D6: seam exige confirmed_at para manager. esperado: true.
SELECT pg_get_functiondef('public.session_operates_company_membership(uuid)'::regprocedure) ILIKE '%confirmed_at IS NOT NULL%' AS ok;

-- ============================================================================
-- PARTE 2 — CARACTERIZACAO FUNCIONAL (QA/staging; BEGIN ... ROLLBACK)
-- ============================================================================
BEGIN;

CREATE FUNCTION pg_temp.as_user(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
END $f$;

CREATE FUNCTION pg_temp.as_server() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
END $f$;

CREATE FUNCTION pg_temp.mk_user(p_id uuid, p_email text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, '',
            now(), now(), now(), '{}'::jsonb, '{"user_type":"hire"}'::jsonb);
END $f$;

DO $t$
DECLARE
    v_dono uuid := gen_random_uuid();   -- dono
    v_enc1 uuid := gen_random_uuid();   -- encarregado com loja padrao A
    v_enc2 uuid := gen_random_uuid();   -- encarregado com a MESMA loja A (nao ve turno do enc1)
    v_ger  uuid := gen_random_uuid();   -- Gestor convidado
    v_ger2 uuid := gen_random_uuid();   -- Gestor convidado que fica PENDENTE (nunca confirmado)
    v_ger3 uuid := gen_random_uuid();   -- conta pre-criada com email_ownership=not_verified
    v_tok2 text;  v_tok3 text;
    v_msg  text;
    v_tag  text := left(replace(gen_random_uuid()::text, '-', ''), 8);
    v_r    jsonb;
    v_tok  text;
    v_a    uuid;  v_b uuid;
    v_m1   uuid;  v_m2 uuid;  v_mg uuid;
    v_j1   uuid := gen_random_uuid();
    v_j2   uuid := gen_random_uuid();
    v_j3   uuid := gen_random_uuid();
    v_j4   uuid := gen_random_uuid();
    v_tpl  public.jobs%ROWTYPE;
    v_n    bigint;
    v_got  uuid;
    v_ok   boolean;
BEGIN
    PERFORM pg_temp.as_server();
    SELECT * INTO v_tpl FROM public.jobs LIMIT 1;
    IF v_tpl.id IS NULL THEN RAISE EXCEPTION 'PRE-CONDICAO: preciso de 1 turno em jobs (molde).'; END IF;

    PERFORM pg_temp.mk_user(v_dono, 'qa-lj-' || v_tag || '-dono@invalido.local');
    PERFORM pg_temp.mk_user(v_enc1, 'qa-lj-' || v_tag || '-e1@invalido.local');
    PERFORM pg_temp.mk_user(v_enc2, 'qa-lj-' || v_tag || '-e2@invalido.local');
    PERFORM pg_temp.mk_user(v_ger,  'qa-lj-' || v_tag || '-g@invalido.local');
    UPDATE public.companies SET name = 'QA Lojas ' || v_tag, onboarding_completed = true WHERE id = v_dono;

    -- ---- lojas: criar, renomear, duplicado ----
    PERFORM pg_temp.as_user(v_dono);
    v_r := public.create_company_tag(v_dono, 'Loja A ' || v_tag);  v_a := (v_r->>'tag_id')::uuid;
    v_r := public.create_company_tag(v_dono, 'Loja B ' || v_tag);  v_b := (v_r->>'tag_id')::uuid;
    IF v_a IS NULL OR v_b IS NULL THEN RAISE EXCEPTION 'FALHA: create_company_tag %', v_r; END IF;

    v_r := public.rename_company_tag(v_a, 'Loja A2 ' || v_tag);
    IF v_r->>'outcome' <> 'renamed' THEN RAISE EXCEPTION 'FALHA rename: %', v_r; END IF;
    v_r := public.rename_company_tag(v_a, lower('LOJA B ' || v_tag));
    IF v_r->>'outcome' <> 'already_exists' THEN RAISE EXCEPTION 'FALHA rename duplicado: %', v_r; END IF;

    -- ---- convite unificado: encarregado com loja padrao; gestor sem loja; loja em gestor = invalid_input ----
    v_r := public.invite_company_member(v_dono, 'Enc Um', 'encarregado', 'qa-lj-' || v_tag || '-e1@invalido.local', v_a);
    IF v_r->>'outcome' <> 'invited' THEN RAISE EXCEPTION 'FALHA convite enc: %', v_r; END IF;
    v_m1 := (v_r->>'member_id')::uuid;
    v_r := public.invite_company_member(v_dono, 'Gestor X', 'manager', 'qa-lj-' || v_tag || '-g@invalido.local', v_a);
    IF v_r->>'outcome' <> 'invalid_input' THEN RAISE EXCEPTION 'FALHA: loja em manager deveria ser invalid_input: %', v_r; END IF;
    v_r := public.invite_company_member(v_dono, 'Gestor X', 'manager', 'qa-lj-' || v_tag || '-g@invalido.local');
    IF v_r->>'outcome' <> 'invited' THEN RAISE EXCEPTION 'FALHA convite gestor: %', v_r; END IF;
    v_mg := (v_r->>'member_id')::uuid;  v_tok := v_r->>'invite_token';
    -- mesmo e-mail, outro papel pendente: nao sobrescreve
    v_r := public.invite_company_member(v_dono, 'Gestor X', 'encarregado', 'qa-lj-' || v_tag || '-g@invalido.local');
    IF v_r->>'outcome' <> 'already_invited_other_role' THEN RAISE EXCEPTION 'FALHA other_role: %', v_r; END IF;

    -- ---- archive recusado: loja e padrao de convidado ----
    v_r := public.archive_company_tag(v_a);
    IF v_r->>'outcome' <> 'default_of_members' OR (v_r->>'count')::int < 1 THEN
        RAISE EXCEPTION 'FALHA archive deveria recusar: %', v_r; END IF;

    -- ---- Gestor convidado: aceite deixa active NAO confirmado e opera ZERO ----
    PERFORM pg_temp.as_user(v_ger);
    v_r := public.accept_company_member_invite(v_tok, true);
    IF v_r->>'outcome' <> 'accepted' OR (v_r->>'confirmed')::boolean THEN RAISE EXCEPTION 'FALHA aceite gestor: %', v_r; END IF;
    IF public.is_company_owner(v_dono) THEN RAISE EXCEPTION 'FALHA: manager nao confirmado virou Gestor.'; END IF;
    v_r := public.invite_company_member(v_dono, 'Outro', 'encarregado', 'qa-lj-' || v_tag || '-o@invalido.local');
    IF v_r->>'outcome' <> 'forbidden' THEN RAISE EXCEPTION 'FALHA: manager nao confirmado convidou: %', v_r; END IF;
    v_r := public.confirm_company_member(v_dono, v_ger, 'Gestor X');
    IF v_r->>'outcome' <> 'forbidden' THEN RAISE EXCEPTION 'FALHA: auto-confirmacao: %', v_r; END IF;

    -- dono confirma; agora e Gestor
    PERFORM pg_temp.as_user(v_dono);
    v_r := public.confirm_company_member(v_dono, v_ger, 'Gestor X');
    IF v_r->>'outcome' <> 'confirmed' THEN RAISE EXCEPTION 'FALHA confirmar gestor: %', v_r; END IF;
    PERFORM pg_temp.as_user(v_ger);
    IF NOT public.is_company_owner(v_dono) THEN RAISE EXCEPTION 'FALHA: manager confirmado deveria operar.'; END IF;
    -- Gestor JA confirmado tambem nao se confirma sozinho (nem confirma a linha do outro por cima de si)
    v_r := public.confirm_company_member(v_dono, v_ger, 'Gestor X');
    IF v_r->>'outcome' <> 'forbidden' THEN RAISE EXCEPTION 'FALHA: Gestor confirmado se autoconfirmou: %', v_r; END IF;

    -- ---- Gestor PENDENTE (ger2): conta verificada, aceita, mas nao confirmada => zero acesso ----
    PERFORM pg_temp.as_server();
    PERFORM pg_temp.mk_user(v_ger2, 'qa-lj-' || v_tag || '-g2@invalido.local');
    PERFORM pg_temp.as_user(v_dono);
    v_r := public.invite_company_member(v_dono, 'Gestor Dois', 'manager', 'qa-lj-' || v_tag || '-g2@invalido.local');
    IF v_r->>'outcome' <> 'invited' THEN RAISE EXCEPTION 'FALHA convite gestor2: %', v_r; END IF;
    v_tok2 := v_r->>'invite_token';
    PERFORM pg_temp.as_user(v_ger2);
    v_r := public.accept_company_member_invite(v_tok2, true);
    IF v_r->>'outcome' <> 'accepted' THEN RAISE EXCEPTION 'FALHA aceite gestor2: %', v_r; END IF;
    v_r := public.list_company_members(v_dono, false);
    IF v_r->>'outcome' <> 'forbidden' THEN RAISE EXCEPTION 'FALHA: gestor pendente listou a equipe: %', v_r; END IF;
    SELECT count(*) INTO v_n FROM public.company_tags WHERE company_id = v_dono;
    IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA 1.2: gestor pendente le lojas (%).', v_n; END IF;
    SELECT count(*) INTO v_n FROM public.team_connections WHERE company_id = v_dono;
    IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA: gestor pendente le Elenco (%).', v_n; END IF;
    IF public.is_company_owner(v_dono) OR public.is_company_member_confirmed(v_dono) THEN
        RAISE EXCEPTION 'FALHA: gestor pendente passa nos seams (PII de freela depende deles).'; END IF;
    IF EXISTS (SELECT 1 FROM public.get_my_companies() g WHERE g.company_id = v_dono AND g.confirmed) THEN
        RAISE EXCEPTION 'FALHA: get_my_companies marca gestor pendente como confirmado.'; END IF;

    -- ---- Gestor so nasce de conta VERIFICADA (MAJOR 1) ----
    PERFORM pg_temp.as_user(v_dono);
    v_r := public.invite_company_member(v_dono, 'Gestor Tres', 'manager', 'qa-lj-' || v_tag || '-g3@invalido.local');
    v_tok3 := v_r->>'invite_token';
    PERFORM pg_temp.as_server();
    v_r := public.internal_team_invite_provision_check(v_tok3);   -- e-mail sem conta
    IF v_r->>'outcome' <> 'manager_requires_verified_signup' THEN
        RAISE EXCEPTION 'FALHA MAJOR 1: provision_check de manager sem conta: %', v_r; END IF;
    -- conta pre-criada pela edge function (email_ownership=not_verified) nao aceita convite de Gestor
    PERFORM pg_temp.mk_user(v_ger3, 'qa-lj-' || v_tag || '-g3@invalido.local');
    UPDATE auth.users SET raw_app_meta_data = '{"email_ownership":"not_verified"}'::jsonb WHERE id = v_ger3;
    PERFORM pg_temp.as_user(v_ger3);
    v_r := public.accept_company_member_invite(v_tok3, true);
    IF v_r->>'outcome' <> 'email_not_verified' THEN
        RAISE EXCEPTION 'FALHA MAJOR 1: conta not_verified virou Gestor: %', v_r; END IF;

    -- ---- previa publica NAO revela token de Gestor; aceite de Elenco segue executavel ----
    PERFORM pg_temp.as_server();
    v_r := public.get_invite_preview(v_tok3);
    IF v_r->>'outcome' <> 'not_found' OR v_r->>'kind' IS NOT NULL THEN
        RAISE EXCEPTION 'FALHA 2.1: get_invite_preview revelou token de gerente: %', v_r; END IF;
    IF NOT has_function_privilege('authenticated', 'public.accept_company_invite_by_token(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FALHA: accept_company_invite_by_token (Elenco do freela) perdeu EXECUTE.'; END IF;
    PERFORM pg_temp.as_user(v_ger);

    -- ---- encarregados aceitos e confirmados ----
    PERFORM pg_temp.as_user(v_dono);
    SELECT invite_token INTO v_tok FROM public.company_members WHERE id = v_m1;
    PERFORM pg_temp.as_user(v_enc1);
    v_r := public.accept_company_member_invite(v_tok, true);
    IF v_r->>'outcome' <> 'accepted' THEN RAISE EXCEPTION 'FALHA aceite enc1: %', v_r; END IF;
    PERFORM pg_temp.as_user(v_dono);
    v_r := public.confirm_company_member(v_dono, v_enc1, 'Enc Um');
    IF v_r->>'outcome' <> 'confirmed' THEN RAISE EXCEPTION 'FALHA confirmar enc1: %', v_r; END IF;

    v_r := public.invite_company_member(v_dono, 'Enc Dois', 'encarregado', 'qa-lj-' || v_tag || '-e2@invalido.local');
    v_m2 := (v_r->>'member_id')::uuid;  v_tok := v_r->>'invite_token';
    PERFORM pg_temp.as_user(v_enc2);
    PERFORM public.accept_company_member_invite(v_tok, true);
    PERFORM pg_temp.as_user(v_dono);
    PERFORM public.confirm_company_member(v_dono, v_enc2, 'Enc Dois');

    -- ---- set_member_default_tag: enc2 sem loja -> A -> remove; manager e tag invalida ----
    v_r := public.set_member_default_tag(v_dono, v_m2, v_a);
    IF v_r->>'outcome' <> 'updated' THEN RAISE EXCEPTION 'FALHA set default: %', v_r; END IF;
    v_r := public.set_member_default_tag(v_dono, v_m2, v_a);
    IF v_r->>'outcome' <> 'unchanged' THEN RAISE EXCEPTION 'FALHA set default idempotente: %', v_r; END IF;
    v_r := public.set_member_default_tag(v_dono, v_mg, v_a);
    IF v_r->>'outcome' <> 'not_encarregado' THEN RAISE EXCEPTION 'FALHA set default em manager: %', v_r; END IF;
    v_r := public.set_member_default_tag(v_dono, v_m2, gen_random_uuid());
    IF v_r->>'outcome' <> 'invalid_tag' THEN RAISE EXCEPTION 'FALHA tag inexistente: %', v_r; END IF;
    PERFORM pg_temp.as_user(v_enc1);
    v_r := public.set_member_default_tag(v_dono, v_m2, NULL);
    IF v_r->>'outcome' <> 'forbidden' THEN RAISE EXCEPTION 'FALHA: encarregado mudou loja de colega: %', v_r; END IF;

    -- ---- heranca: turno criado pelo GESTOR com responsible=enc1 herda a loja A; explicito vence ----
    PERFORM pg_temp.as_server();
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.jobs SELECT (jsonb_populate_record(v_tpl, jsonb_build_object(
        'id', v_j1, 'company_id', v_dono, 'responsible_id', v_enc1, 'tag_id', NULL, 'series_id', NULL, 'status', 'open'))).*;
    SELECT tag_id INTO v_got FROM public.jobs WHERE id = v_j1;
    IF v_got IS DISTINCT FROM v_a THEN RAISE EXCEPTION 'FALHA heranca: tag=% esperado=%', v_got, v_a; END IF;

    INSERT INTO public.jobs SELECT (jsonb_populate_record(v_tpl, jsonb_build_object(
        'id', v_j2, 'company_id', v_dono, 'responsible_id', v_enc1, 'tag_id', v_b, 'series_id', NULL, 'status', 'open'))).*;
    SELECT tag_id INTO v_got FROM public.jobs WHERE id = v_j2;
    IF v_got IS DISTINCT FROM v_b THEN RAISE EXCEPTION 'FALHA: explicito deveria vencer o padrao.'; END IF;

    -- ---- heranca com SESSAO NULA (cron/service_role): tambem herda ----
    PERFORM pg_temp.as_server();
    INSERT INTO public.jobs SELECT (jsonb_populate_record(v_tpl, jsonb_build_object(
        'id', v_j3, 'company_id', v_dono, 'responsible_id', v_enc2, 'tag_id', NULL, 'series_id', NULL, 'status', 'open'))).*;
    SELECT tag_id INTO v_got FROM public.jobs WHERE id = v_j3;
    IF v_got IS DISTINCT FROM v_a THEN RAISE EXCEPTION 'FALHA heranca sessao nula: tag=%', v_got; END IF;

    -- ---- D3: etiqueta nao concede acesso: enc2 (mesma loja A) NAO ve o turno do enc1 ----
    PERFORM pg_temp.as_user(v_enc2);
    IF public.is_job_owner(v_j1) THEN RAISE EXCEPTION 'FALHA D3: mesma loja concedeu acesso ao turno alheio.'; END IF;
    SELECT count(*) INTO v_n FROM public.applications WHERE job_id = v_j1;   -- RLS: 0 linhas visiveis, sem erro
    IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA D3: enc2 le applications do turno de enc1.'; END IF;

    -- ---- trava: enc1 (padrao A) nao grava outra loja no PROPRIO turno; Gestor grava ----
    PERFORM pg_temp.as_user(v_enc1);
    v_ok := false;
    BEGIN
        UPDATE public.jobs SET tag_id = v_b WHERE id = v_j1;
    EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
    END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA trava: encarregado trocou a loja do turno.'; END IF;
    PERFORM pg_temp.as_user(v_dono);
    v_r := public.set_job_tag(v_j1, v_b);
    IF v_r->>'outcome' <> 'ok' THEN RAISE EXCEPTION 'FALHA: Gestor nao conseguiu trocar a loja: %', v_r; END IF;

    -- ---- mudar o padrao NAO reescreve turno existente ----
    v_r := public.set_member_default_tag(v_dono, v_m1, v_b);
    IF v_r->>'outcome' <> 'updated' THEN RAISE EXCEPTION 'FALHA mudar padrao: %', v_r; END IF;
    SELECT tag_id INTO v_got FROM public.jobs WHERE id = v_j2;
    IF v_got IS DISTINCT FROM v_b THEN RAISE EXCEPTION 'FALHA: turno existente foi reescrito.'; END IF;

    -- ---- INSERT de encarregado com loja explicita DIFERENTE do padrao (enc1 agora tem padrao B) ----
    PERFORM pg_temp.as_user(v_enc1);
    v_ok := false;
    BEGIN
        INSERT INTO public.jobs SELECT (jsonb_populate_record(v_tpl, jsonb_build_object(
            'id', v_j4, 'company_id', v_dono, 'responsible_id', v_enc1, 'tag_id', v_a, 'series_id', NULL, 'status', 'open'))).*;
    EXCEPTION WHEN insufficient_privilege THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        v_ok := v_msg LIKE '%loja do turno%';
    END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA 3.1: INSERT de encarregado com outra loja nao foi barrado pela trava.'; END IF;

    -- ---- porta F13 fechada para authenticated ----
    PERFORM pg_temp.as_user(v_dono);
    v_ok := false;
    BEGIN
        PERFORM public.invite_company_manager(v_dono, 'x@invalido.local');
    EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
    END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA D7: invite_company_manager ainda executavel por authenticated.'; END IF;

    RAISE NOTICE 'OK: auditoria lojas/equipe unificada passou (rollback a seguir).';
END $t$;

ROLLBACK;
