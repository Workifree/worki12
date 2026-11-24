-- Auditoria e testes de caracterizacao: Equipe e encarregados, E0-E3
-- File: supabase/tests/equipe_e0_e3_auditoria.sql
-- NAO e migration (fica fora de supabase/migrations/ de proposito: o CLI aplicaria). Rodar a mao,
-- por MCP/psql, no Portao entre E3 e E4 (spec: "Portao"; gate: C13, A1, A2, A3, A12, A21, A22).
--
-- PARTE 1 e PARTE 2 sao READ-ONLY e podem rodar em PRODUCAO (a Parte 2 abre BEGIN ... ROLLBACK).
-- PARTE 3 faz DDL transacional (alarga o CHECK de role DENTRO da transacao e desfaz com ROLLBACK):
--   rodar SO em branch/QA/staging, NUNCA em producao (toma lock curto em company_members).
--
-- Convencao: `esperado:` descreve o resultado correto de cada consulta.

-- ============================================================================
-- PARTE 1 — AUDITORIA ESTRUTURAL (A20, A21, A22, D1, D2, D6)
-- ============================================================================

-- 1.1 [A21] Policies de public que decidem acesso de empresa por ancora crua. strpos, nunca LIKE
--     (em LIKE o `_` e curinga e acusaria is_company_owner). esperado: so as dividas conscientes
--     de 20260824000300 (Conversation/Message x5, companies "Users can create their company",
--     company_monthly_revenue x4, company_spend_limits x4, payment_methods x4) — NENHUMA tabela
--     do raio de alcance (jobs, applications, shift_*, team_*, service_terms, reviews, ...).
SELECT tablename, policyname, cmd
  FROM pg_policies
 WHERE schemaname = 'public'
   AND ( strpos(coalesce(qual,'') || coalesce(with_check,''), 'owner_id') > 0
      OR coalesce(qual,'') || coalesce(with_check,'') ~* 'company_id[[:space:]]*=[[:space:]]*[(]?[[:space:]]*(select[[:space:]]+)?auth[.]uid[(][)]' )
 ORDER BY 1, 2;

-- 1.2 [A21] Funcoes de public com ancora crua de empresa (mesmo criterio do C1 do gate), exceto o seam.
--     esperado: dividas conscientes ja listadas (anonymize_account: ancoragem DUPLA deliberada;
--     can_review_for_job ramo (b) e invited-by-owner dos RPCs de convite F13; reserve_escrow morto).
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind = 'f'
   AND ( pg_get_functiondef(p.oid) ~* 'company_id[[:space:]]*=[[:space:]]*[(]?[[:space:]]*(select[[:space:]]+)?auth[.]uid[(][)]'
      OR pg_get_functiondef(p.oid) ~* 'owner_id[[:space:]]*=[[:space:]]*[(]?[[:space:]]*(select[[:space:]]+)?auth[.]uid[(][)]'
      -- A2 (seguranca): ancora em VARIAVEL local de uid (v_uid, v_caller_uid, ...): foi como
      -- create_sos_call/sos_call_eligibility escaparam da regex antiga.
      OR pg_get_functiondef(p.oid) ~* '(company_id|owner_id)[[:space:]]*=[[:space:]]*v_[a-z_]*uid' )
 ORDER BY 1;

-- 1.3 [ADR elenco-unico, decisao 2] invited_by e RASTRO: nao pode aparecer em predicado de acesso.
--     esperado: 0 linhas (R10c/D8: invited_by saiu do WITH CHECK de tc_insert_company; o valor vem de
--     trigger, nunca de predicado de autorizacao).
SELECT tablename, policyname FROM pg_policies
 WHERE schemaname = 'public' AND strpos(coalesce(qual,'') || coalesce(with_check,''), 'invited_by') > 0;
--     esperado: so team_connections_invited_by_guard (+ funcoes de E4/E5 quando existirem, que
--     devem ESCREVER, nunca autorizar por invited_by).
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind = 'f' AND strpos(pg_get_functiondef(p.oid), 'invited_by') > 0
 ORDER BY 1;

-- 1.4 [D6] company_tags / responsibility_coverages: sem policy de DELETE e sem GRANT DELETE.
--     esperado: 0 linhas nas duas.
SELECT tablename, policyname FROM pg_policies
 WHERE schemaname = 'public' AND tablename IN ('company_tags','responsibility_coverages') AND cmd = 'DELETE';
SELECT t.tbl, ro.rol FROM (VALUES ('public.company_tags'), ('public.responsibility_coverages')) AS t(tbl)
  CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS ro(rol)
 WHERE has_table_privilege(ro.rol, t.tbl, 'DELETE');   -- (role_table_grants lista tambem o DONO: sempre acusaria)

-- 1.5 [D1/D2] RPCs/funcoes novas: DEFINER onde esperado, anon sem EXECUTE, internas sem EXECUTE
--     para authenticated. esperado: anon = false em todas; authenticated = false SO nas TRES
--     funcoes internas: internal_company_active_operator, internal_company_confirmed_operator e
--     notification_recipients_for_job.
SELECT p.proname,
       p.prosecdef AS definer,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc_exec,
       p.proconfig AS config
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('session_company_member_role','session_company_member_confirmed',
                     'is_company_member','is_company_member_confirmed',
                     'internal_company_active_operator','internal_company_confirmed_operator',
                     'session_can_operate_job','notification_recipients_for_job',
                     'jobs_responsible_guard','jobs_soft_delete_guard',
                     'get_shift_worker_payment_card','team_connections_invited_by_guard')
 ORDER BY 1;
--     esperado: config contem search_path='' em todas.

-- 1.6 [R1/D5] CHECK de role INTACTO ate E4 (so manager), e nenhuma linha fora de manager.
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid = 'public.company_members'::regclass AND conname = 'company_members_role_check';
SELECT role, status, count(*) FROM public.company_members GROUP BY 1, 2 ORDER BY 1, 2;

-- 1.7 [E0] todos os leitores de company_members que significam "Gestor" filtram role='manager'.
--     esperado: as 6 linhas abaixo com filtra_manager = true (verificavel: nenhuma false).
SELECT p.proname, strpos(pg_get_functiondef(p.oid), 'role = ''manager''') > 0 AS filtra_manager
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('session_operates_company_membership','is_organization_member','get_my_companies',
                     'invite_company_manager','accept_manager_invite','revoke_company_manager')
 ORDER BY 1;
--     esperado: SO funcoes do proprio seam de encarregado que tratam o papel por outro caminho
--     (internal_company_active_operator, session_company_member_confirmed, notification_recipients_
--     for_job, jobs/team triggers) e, apos E4, as RPCs de convite de equipe. Qualquer OUTRA que
--     aparecer le company_members sem filtrar papel = achado (e o caso de can_review_for_job antes
--     de E0). anonymize_account e lgpd_guard ficam fora da lista de proposito (tratam todos os papeis).
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind = 'f'
   -- PALAVRA company_members (company_membership contem "company_members" + "hip": falso positivo)
   AND pg_get_functiondef(p.oid) ~ '[[:<:]]company_members[[:>:]]'
   AND pg_get_functiondef(p.oid) !~ '[[:<:]]role[[:>:]]'      -- a PALAVRA role (primary_role nao conta)
   -- can_review_for_job: lista branca explicita — delega a is_job_owner, sem leitura propria de membros
   AND p.proname NOT IN ('anonymize_account','lgpd_guard_auth_user_delete','can_review_for_job')
 ORDER BY 1;

-- 1.8 [G1/C11] dependencias registradas do par (BEGIN ATOMIC) — ordem do DOWN.
SELECT pg_describe_object(classid, objid, objsubid) AS dependente,
       pg_describe_object(refclassid, refobjid, refobjsubid) AS depende_de
  FROM pg_depend
 WHERE refobjid IN ('public.is_company_owner(uuid)'::regprocedure,
                    'public.is_job_owner(uuid)'::regprocedure,
                    'public.session_can_operate_job(uuid,uuid,date)'::regprocedure)
 ORDER BY 2, 1;

-- 1.9 [A20] jobs SELECT segue USING (true) — escopo por pessoa NAO vale para a linha de jobs.
--     esperado: 1 linha, qual = 'true'.
SELECT policyname, qual FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'jobs' AND cmd = 'SELECT';

-- 1.10 [A22/Article 8] nenhuma tabela/RPC de saldo foi tocada por E0-E3: conferir por revisao do
--      diff (git diff main -- supabase/migrations/2026112300*): nenhuma referencia a wallets,
--      escrow_transactions, wallet_transactions, reserve_escrow/release_escrow/refund_escrow,
--      credit_deposit, update_wallet_balance. (shift_payments: so predicados de policy + trigger.)

-- 1.11 [G8] colunas de PII novas e classificacao.
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='company_members'
   AND column_name IN ('display_name','accepted_email','accepted_tos_at','confirmed_at','confirmed_by','removed_at');
--      anonymize_account anula display_name/accepted_email e revoga coberturas:
SELECT strpos(pg_get_functiondef('public.anonymize_account(uuid)'::regprocedure), 'cm.display_name') > 0 AS anula_pii_membro,
       strpos(pg_get_functiondef('public.anonymize_account(uuid)'::regprocedure), 'responsibility_coverages') > 0 AS revoga_coberturas;

-- ============================================================================
-- PARTE 2 — A1 / C13: SNAPSHOT ANTES x DEPOIS (read-only, ROLLBACK). Resultado IDENTICO.
--   Rodar ANTES de aplicar E0 e DEPOIS de E3, para: cada dono real, o gerente de QA (se houver),
--   uma conta de freela, uma conta de empresa sem vinculo. Trocar <uid>.
-- ============================================================================
-- BEGIN;
-- SET LOCAL ROLE authenticated;
-- SET LOCAL request.jwt.claims = '{"sub":"<uid>","role":"authenticated"}';
-- SELECT c.id, public.is_company_owner(c.id)  FROM public.companies c ORDER BY 1;
-- SELECT j.id, public.is_job_owner(j.id)      FROM public.jobs j WHERE j.status <> 'deleted' ORDER BY 1;
-- SELECT * FROM public.get_my_companies();
-- SELECT public.my_link_risk_config();
-- SELECT count(*) FROM public.team_connections;      -- visao do Elenco
-- SELECT count(*) FROM public.shift_payments;        -- visao de pagamentos
-- SELECT count(*) FROM public.applications;          -- visao de candidaturas
-- SELECT count(*) FROM public.team_lists;
-- SELECT jsonb_array_length(public.list_team_connection_cards() -> 'items');
-- ROLLBACK;
--
-- Equivalencia estrutural (A1) — para um dono real, em TODA linha:
--   is_job_owner(turno) = is_company_owner(company do turno). Tem de ser true (NULL com 0 turnos):
-- BEGIN; SET LOCAL ROLE authenticated;
-- SET LOCAL request.jwt.claims = '{"sub":"<uid de dono>","role":"authenticated"}';
-- SELECT bool_and(public.is_job_owner(j.id) = public.is_company_owner(j.company_id)) FROM public.jobs j;
-- ROLLBACK;

-- ============================================================================
-- PARTE 3 — CARACTERIZACAO DO ENCARREGADO — SO EM QA/STAGING (tudo em transacao com ROLLBACK)
--   Alarga o CHECK de role DENTRO da transacao (E4 faz isso de verdade, ao final) e desfaz tudo
--   no ROLLBACK. Precisa de: 1 empresa com >= 1 turno nao-deletado, >= 3 freelas em `workers` e
--   >= 1 linha em `applications` (usada como molde para clonar). Falha = RAISE EXCEPTION.
--   Cobre: A2 (escalada), A3, A12 (nao confirmado), INSERT de turno por confirmado/nao confirmado,
--   voided so Gestor, sp_insert_company com company_id divergente, sessao nula em shift_payments,
--   PII (can_view_worker_profile x RPC de cartao sem CPF), ator/destinatarios do aviso de
--   cancelamento (freela, sistema), A13d (invited_by), A13 (remocao), A15 (cobertura), A16,
--   R27 (soft delete), SOS Gestor-only, count_worker_shifts_by_week sem falso zero (R7a).
-- ============================================================================
BEGIN;

-- Helpers de sessao (temporarios, somem no ROLLBACK).
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

DO $t$
DECLARE
    v_company uuid;  v_job uuid;  v_start date;  v_owner uuid;
    v_enc  uuid := gen_random_uuid();       -- encarregado ATIVO e CONFIRMADO
    v_enc2 uuid := gen_random_uuid();       -- encarregado ATIVO e NAO confirmado
    v_w1 uuid; v_w2 uuid; v_w3 uuid;        -- freelas de teste
    v_a_tpl public.applications%ROWTYPE;
    v_j_tpl public.jobs%ROWTYPE;
    v_new_job uuid := gen_random_uuid();
    v_sp1 uuid; v_sp2 uuid;
    v_n_real bigint; v_n bigint; v_t text; v_json jsonb; v_item jsonb; v_ok boolean;
    v_mgr uuid := gen_random_uuid();        -- Gestor 'manager' NAO-dono
    v_enc3 uuid := gen_random_uuid();       -- encarregado NAO confirmado + conta real em auth.users
    v_orgop uuid := gen_random_uuid();      -- operador de organizacao
    v_org uuid; v_cid uuid;
BEGIN
    -- ---------------- setup (superusuario, sessao nula) ----------------
    PERFORM pg_temp.as_server();
    SELECT j.company_id, j.id, (j.start_date AT TIME ZONE 'America/Sao_Paulo')::date, COALESCE(c.owner_id, c.id)
      INTO v_company, v_job, v_start, v_owner
      FROM public.jobs j JOIN public.companies c ON c.id = j.company_id
     WHERE j.status <> 'deleted'
     ORDER BY j.created_at DESC NULLS LAST LIMIT 1;
    IF v_job IS NULL THEN RAISE EXCEPTION 'PRE-CONDICAO: nenhuma empresa com turno.'; END IF;

    SELECT * INTO v_a_tpl FROM public.applications LIMIT 1;
    IF v_a_tpl.id IS NULL THEN RAISE EXCEPTION 'PRE-CONDICAO: nenhuma application para molde.'; END IF;
    SELECT * INTO v_j_tpl FROM public.jobs WHERE id = v_job;

    SELECT array_agg(id) INTO STRICT v_t FROM (SELECT w.id FROM public.workers w
        WHERE NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = v_job AND a.worker_id = w.id)
          AND NOT EXISTS (SELECT 1 FROM public.team_connections tc WHERE tc.company_id = v_company AND tc.worker_id = w.id)
        LIMIT 3) x;
    v_w1 := split_part(trim(both '{}' from v_t), ',', 1)::uuid;
    v_w2 := split_part(trim(both '{}' from v_t), ',', 2)::uuid;
    v_w3 := split_part(trim(both '{}' from v_t), ',', 3)::uuid;
    IF v_w3 IS NULL THEN RAISE EXCEPTION 'PRE-CONDICAO: preciso de 3 freelas sem vinculo com a empresa.'; END IF;
    UPDATE public.workers SET pix_key = 'qa-pix-key', phone = '11999990000', cpf = '00011122233',
                              birth_date = DATE '1990-01-01' WHERE id = v_w1;

    ALTER TABLE public.company_members DROP CONSTRAINT company_members_role_check;
    ALTER TABLE public.company_members ADD CONSTRAINT company_members_role_check
        CHECK (role IN ('manager', 'encarregado'));
    INSERT INTO public.company_members
        (company_id, user_id, role, status, created_by, accepted_at, display_name, confirmed_at)
    VALUES (v_company, v_enc,  'encarregado', 'active', v_owner, now(), 'QA Enc 1', now()),
           (v_company, v_enc2, 'encarregado', 'active', v_owner, now(), 'QA Enc 2', NULL);
    SELECT count(*) INTO v_n_real FROM public.team_connections WHERE company_id = v_company;

    -- application 'hired' de w1 no turno v_job (clone do molde)
    v_a_tpl.id := gen_random_uuid(); v_a_tpl.job_id := v_job; v_a_tpl.worker_id := v_w1; v_a_tpl.status := 'hired';
    INSERT INTO public.applications SELECT v_a_tpl.*;

    -- ============ A2: encarregado confirmado, turno de OUTRO responsavel (NULL = Gestor) ============
    PERFORM pg_temp.as_user(v_enc);
    IF public.is_company_owner(v_company) THEN RAISE EXCEPTION 'A2: encarregado satisfaz is_company_owner.'; END IF;
    IF public.is_job_owner(v_job) THEN RAISE EXCEPTION 'A2: encarregado opera turno de outro responsavel.'; END IF;
    IF NOT public.is_company_member(v_company) THEN RAISE EXCEPTION 'A2: is_company_member deveria ser true.'; END IF;

    -- A3: 0 linhas de turno alheio
    SELECT count(*) INTO v_n FROM public.applications WHERE job_id = v_job;
    IF v_n <> 0 THEN RAISE EXCEPTION 'A3: le applications de turno alheio (%).', v_n; END IF;
    SELECT count(*) INTO v_n FROM public.shift_payments WHERE job_id = v_job;
    IF v_n <> 0 THEN RAISE EXCEPTION 'A3: le shift_payments de turno alheio (%).', v_n; END IF;
    SELECT count(*) INTO v_n FROM public.shift_calls WHERE job_id = v_job;
    IF v_n <> 0 THEN RAISE EXCEPTION 'A3: le shift_calls de turno alheio (%).', v_n; END IF;

    -- A12 (confirmado): le o Elenco inteiro
    SELECT count(*) INTO v_n FROM public.team_connections WHERE company_id = v_company;
    IF v_n <> v_n_real THEN RAISE EXCEPTION 'A12: confirmado le % de % conexoes.', v_n, v_n_real; END IF;

    -- ============ INSERT de turno por encarregado CONFIRMADO (responsavel preenchido pelo trigger) ====
    v_j_tpl.id := v_new_job; v_j_tpl.responsible_id := NULL; v_j_tpl.series_id := NULL; v_j_tpl.tag_id := NULL;
    v_j_tpl.company_id := v_company;
    INSERT INTO public.jobs SELECT v_j_tpl.*;
    SELECT responsible_id::text INTO v_t FROM public.jobs WHERE id = v_new_job;
    IF v_t IS DISTINCT FROM v_enc::text THEN RAISE EXCEPTION 'R3: trigger nao atribuiu o criador como responsavel (%).', v_t; END IF;
    IF NOT public.is_job_owner(v_new_job) THEN RAISE EXCEPTION 'A2: confirmado nao opera o turno que criou.'; END IF;

    -- encarregado nao reatribui nem escolhe outro responsavel
    BEGIN
        UPDATE public.jobs SET responsible_id = v_owner WHERE id = v_new_job;
        RAISE EXCEPTION 'A2: encarregado reatribuiu responsible_id.';
    EXCEPTION WHEN sqlstate '42501' THEN NULL; END;

    -- R27: UPDATE cru -> deleted em turno VAZIO passa; em turno POPULADO e barrado (so cancel_job).
    -- (turno populado: v_job nao e dele; usa o novo + uma application viva clonada pelo servidor)
    PERFORM pg_temp.as_server();
    v_a_tpl.id := gen_random_uuid(); v_a_tpl.job_id := v_new_job; v_a_tpl.worker_id := v_w2; v_a_tpl.status := 'hired';
    INSERT INTO public.applications SELECT v_a_tpl.*;
    PERFORM pg_temp.as_user(v_enc);
    BEGIN
        UPDATE public.jobs SET status = 'deleted' WHERE id = v_new_job;
        RAISE EXCEPTION 'R27: encarregado apagou turno populado por UPDATE cru.';
    EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
    PERFORM pg_temp.as_server();
    DELETE FROM public.applications WHERE job_id = v_new_job;        -- esvazia (servidor)
    PERFORM pg_temp.as_user(v_enc);
    UPDATE public.jobs SET status = 'deleted' WHERE id = v_new_job;  -- vazio: passa
    PERFORM pg_temp.as_server();
    UPDATE public.jobs SET status = 'open' WHERE id = v_new_job;     -- sessao nula passa

    -- ============ encarregado NAO confirmado: opera ZERO, le ZERO, cria ZERO ====================
    PERFORM pg_temp.as_user(v_enc2);
    SELECT count(*) INTO v_n FROM public.team_connections WHERE company_id = v_company;
    IF v_n <> 0 THEN RAISE EXCEPTION 'A12: nao confirmado le % conexoes.', v_n; END IF;
    SELECT count(*) INTO v_n FROM public.team_lists WHERE company_id = v_company;
    IF v_n <> 0 THEN RAISE EXCEPTION 'A12: nao confirmado le % listas.', v_n; END IF;
    IF public.is_company_member_confirmed(v_company) THEN RAISE EXCEPTION 'A12: is_company_member_confirmed true.'; END IF;
    v_j_tpl.id := gen_random_uuid(); v_j_tpl.responsible_id := v_enc2;
    BEGIN
        INSERT INTO public.jobs SELECT v_j_tpl.*;
        RAISE EXCEPTION 'A12: nao confirmado CRIOU turno.';
    -- BEFORE trigger (23514: responsavel nao confirmado) roda antes da RLS (42501): qualquer um barra
    EXCEPTION WHEN sqlstate '42501' OR sqlstate '23514' THEN NULL; END;
    -- ... nem recebe turno atribuido (responsavel exige confirmado; sessao NULA passa por desenho):
    PERFORM pg_temp.as_user(v_owner);
    BEGIN
        UPDATE public.jobs SET responsible_id = v_enc2 WHERE id = v_new_job;
        RAISE EXCEPTION 'A12: Gestor atribuiu turno a encarregado NAO confirmado.';
    EXCEPTION WHEN sqlstate '23514' THEN NULL; END;
    -- R7a: nao confirmado nunca ve "zero" na guarda de vinculo — erro, nao linhas
    --   (a mensagem 'not_confirmed' (42501) so existe quando get_my_companies devolve o encarregado,
    --   isto e, apos E4; antes disso a negacao vem do is_job_owner do turno-ancora. Em AMBOS os
    --   casos tem de ser erro, NUNCA um conjunto vazio.)
    PERFORM pg_temp.as_user(v_enc2);
    v_ok := false;
    BEGIN
        PERFORM * FROM public.count_worker_shifts_by_week(ARRAY[v_w1], v_new_job);
        v_ok := true;                       -- chegou aqui = devolveu (vazio ou nao) sem erro
    EXCEPTION WHEN OTHERS THEN NULL; END;
    IF v_ok THEN RAISE EXCEPTION 'R7a: nao confirmado recebeu resultado da guarda de vinculo (falso zero).'; END IF;
    -- SOS e Gestor-only (nao confirmado tambem cai fora)
    IF public.create_sos_call(v_new_job, 'falta', NULL) ->> 'outcome' <> 'forbidden' THEN
        RAISE EXCEPTION 'SOS: nao confirmado nao recebeu forbidden.'; END IF;

    -- ============ PII: can_view_worker_profile (Gestor) x RPC de cartao (encarregado) ============
    PERFORM pg_temp.as_server();
    UPDATE public.jobs SET responsible_id = v_enc WHERE id = v_job;   -- v_enc passa a operar v_job
    PERFORM pg_temp.as_user(v_enc);
    IF NOT public.is_job_owner(v_job) THEN RAISE EXCEPTION 'A2: responsavel nao opera o proprio turno.'; END IF;
    IF public.can_view_worker_profile(v_w1) THEN
        RAISE EXCEPTION 'PII: encarregado le workers (CPF/nascimento) via can_view_worker_profile.'; END IF;
    SELECT count(*) INTO v_n FROM public.workers WHERE id = v_w1;
    IF v_n <> 0 THEN RAISE EXCEPTION 'PII: SELECT em workers devolveu linha para o encarregado.'; END IF;
    v_json := public.get_shift_worker_payment_card(v_job);
    SELECT i INTO v_item FROM jsonb_array_elements(v_json -> 'items') AS i WHERE i ->> 'worker_id' = v_w1::text;
    IF v_json ->> 'outcome' <> 'ok' OR v_item IS NULL THEN
        RAISE EXCEPTION 'PII: RPC de cartao nao devolveu o freela hired (%).', v_json; END IF;
    IF v_item ? 'cpf' OR v_item ? 'birth_date'
       OR v_item ->> 'pix_key' IS DISTINCT FROM 'qa-pix-key'
       OR v_item ->> 'phone' IS DISTINCT FROM '11999990000' THEN
        RAISE EXCEPTION 'PII: projecao do cartao errada (%).', v_item; END IF;
    IF v_json::text LIKE '%00011122233%' THEN RAISE EXCEPTION 'PII: CPF vazou no payload do cartao.'; END IF;
    IF public.get_shift_worker_payment_card(v_new_job) ->> 'outcome' <> 'ok' THEN
        RAISE EXCEPTION 'PII: cartao de turno proprio vazio deveria ser ok com 0 itens.'; END IF;
    PERFORM pg_temp.as_user(v_enc2);
    IF public.get_shift_worker_payment_card(v_job) ->> 'outcome' <> 'forbidden' THEN
        RAISE EXCEPTION 'PII: nao confirmado leu cartao.'; END IF;
    PERFORM pg_temp.as_user(v_owner);                      -- Gestor: ramo 2 INALTERADO
    IF NOT public.can_view_worker_profile(v_w1) THEN
        RAISE EXCEPTION 'PII: Gestor perdeu o ramo 2 de can_view_worker_profile.'; END IF;

    -- ============ shift_payments: insert, divergencia de company_id, voided, sessao nula ========
    PERFORM pg_temp.as_user(v_enc);
    BEGIN   -- company_id divergente do turno: RLS barra (42501) ANTES de FK
        INSERT INTO public.shift_payments (job_id, company_id, worker_id, application_id, source, amount, status, scheduled_for, recorded_by)
        SELECT v_job, gen_random_uuid(), v_w1, a.id, 'external_pix', 10, 'scheduled', current_date, v_enc
          FROM public.applications a WHERE a.job_id = v_job AND a.worker_id = v_w1;
        RAISE EXCEPTION 'G3: sp_insert_company aceitou company_id divergente.';
    EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
    INSERT INTO public.shift_payments (job_id, company_id, worker_id, application_id, source, amount, status, scheduled_for, recorded_by)
    SELECT v_job, v_company, v_w1, a.id, 'external_pix', 10, 'scheduled', current_date, v_enc
      FROM public.applications a WHERE a.job_id = v_job AND a.worker_id = v_w1
    RETURNING id INTO v_sp1;
    SELECT count(*) INTO v_n FROM public.shift_payments WHERE id = v_sp1;
    IF v_n <> 1 THEN RAISE EXCEPTION 'A4: encarregado nao ve o pagamento do proprio turno.'; END IF;
    SELECT count(*) INTO v_n FROM public.shift_payments WHERE job_id <> v_job;
    IF v_n <> 0 THEN RAISE EXCEPTION 'A4: encarregado ve % pagamentos de turnos alheios.', v_n; END IF;
    BEGIN   -- estorno/cancelamento (->voided): trigger barra o nao-Gestor
        UPDATE public.shift_payments SET status = 'voided', voided_at = now(), void_reason = 'qa' WHERE id = v_sp1;
        RAISE EXCEPTION 'G3: encarregado estornou/cancelou pagamento.';
    EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
        IF v_t NOT LIKE '%apenas o Gestor%' THEN RAISE EXCEPTION 'G3: erro inesperado no estorno: %', v_t; END IF;
    END;
    UPDATE public.shift_payments SET status = 'recorded', paid_at = now() WHERE id = v_sp1;  -- efetivar: permitido
    PERFORM pg_temp.as_user(v_owner);                       -- Gestor estorna
    UPDATE public.shift_payments SET status = 'voided', voided_at = now(), void_reason = 'qa' WHERE id = v_sp1;
    PERFORM pg_temp.as_server();                            -- sessao nula atravessa o trigger
    INSERT INTO public.shift_payments (job_id, company_id, worker_id, application_id, source, amount, status, scheduled_for, recorded_by)
    SELECT v_job, v_company, v_w1, a.id, 'external_pix', 10, 'scheduled', current_date, v_owner
      FROM public.applications a WHERE a.job_id = v_job AND a.worker_id = v_w1
    RETURNING id INTO v_sp2;
    UPDATE public.shift_payments SET status = 'recorded', paid_at = now() WHERE id = v_sp2;
    UPDATE public.shift_payments SET status = 'voided', voided_at = now(), void_reason = 'qa-server' WHERE id = v_sp2;

    -- ============ A13d: invited_by por trigger; UPDATE imutavel; nao confirmado nao insere =====
    PERFORM pg_temp.as_user(v_enc);
    INSERT INTO public.team_connections (company_id, worker_id, status, source, invited_by)
    VALUES (v_company, v_w2, 'pending', 'link', gen_random_uuid());      -- payload forjado
    SELECT invited_by::text INTO v_t FROM public.team_connections WHERE company_id = v_company AND worker_id = v_w2;
    IF v_t IS DISTINCT FROM v_enc::text THEN RAISE EXCEPTION 'A13d: invited_by nao foi forcado a auth.uid() (%).', v_t; END IF;
    PERFORM pg_temp.as_user(v_owner);       -- nem o Gestor altera: trigger imutavel (encarregado nem chega la, RLS)
    BEGIN
        UPDATE public.team_connections SET invited_by = v_owner WHERE company_id = v_company AND worker_id = v_w2;
        RAISE EXCEPTION 'A13d: invited_by foi alterado por UPDATE.';
    EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
    PERFORM pg_temp.as_user(v_enc);
    BEGIN   -- encarregado nao remove/bloqueia (Gestor-only): 0 linhas ou negado
        UPDATE public.team_connections SET status = 'blocked', blocked_by = v_enc WHERE company_id = v_company AND worker_id = v_w2;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n <> 0 THEN RAISE EXCEPTION 'A13c: encarregado bloqueou vinculo.'; END IF;
    EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
    PERFORM pg_temp.as_user(v_enc2);
    BEGIN
        INSERT INTO public.team_connections (company_id, worker_id, status, source) VALUES (v_company, v_w3, 'pending', 'link');
        RAISE EXCEPTION 'A12: nao confirmado inseriu vinculo.';
    EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
    PERFORM pg_temp.as_server();
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'team_connections'
                AND strpos(coalesce(qual,'') || coalesce(with_check,''), 'invited_by') > 0) THEN
        RAISE EXCEPTION 'A13d/D8: invited_by aparece em predicado de policy de team_connections.'; END IF;

    -- ============ SOS: Gestor-only (herda is_job_owner NAO e mais suficiente) ====================
    PERFORM pg_temp.as_user(v_enc);
    IF public.create_sos_call(v_job, 'falta', NULL) ->> 'outcome' <> 'forbidden'
       OR public.sos_call_eligibility(v_job) ->> 'reason' <> 'forbidden' THEN
        RAISE EXCEPTION 'SOS: encarregado nao recebeu forbidden.'; END IF;
    PERFORM pg_temp.as_user(v_owner);
    IF public.sos_call_eligibility(v_job) ->> 'reason' = 'forbidden' THEN
        RAISE EXCEPTION 'SOS: Gestor recebeu forbidden.'; END IF;

    -- ============ aviso de cancelamento: ator FREELA e ator SISTEMA, destinatarios sem duplicar ====
    -- freela cancela (hired -> cancelled) o turno v_job (responsavel = v_enc, ativo e confirmado)
    PERFORM pg_temp.as_user(v_w1);
    UPDATE public.applications SET status = 'cancelled' WHERE job_id = v_job AND worker_id = v_w1;
    PERFORM pg_temp.as_server();
    SELECT count(*) INTO v_n FROM public.notifications
     WHERE title = 'Turno cancelado pelo freela' AND link = '/company/jobs/' || v_job::text || '/candidates';
    IF v_n < 2 THEN RAISE EXCEPTION 'A18: esperado >= 2 avisos (dono + responsavel), veio %.', v_n; END IF;
    SELECT count(*) INTO v_n FROM (SELECT user_id FROM public.notifications
     WHERE title = 'Turno cancelado pelo freela' AND link = '/company/jobs/' || v_job::text || '/candidates'
     GROUP BY user_id HAVING count(*) > 1) d;
    IF v_n <> 0 THEN RAISE EXCEPTION 'A18: destinatario duplicado.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = v_enc AND title = 'Turno cancelado pelo freela')
       OR NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = v_owner AND title = 'Turno cancelado pelo freela') THEN
        RAISE EXCEPTION 'A18: responsavel e dono precisam ser avisados.'; END IF;
    IF EXISTS (SELECT 1 FROM public.notifications WHERE user_id = v_enc2) THEN
        RAISE EXCEPTION 'A18: encarregado nao responsavel recebeu aviso.'; END IF;
    -- ator SISTEMA (sessao nula): os DOIS lados, texto neutro
    v_a_tpl.id := gen_random_uuid(); v_a_tpl.job_id := v_job; v_a_tpl.worker_id := v_w3; v_a_tpl.status := 'hired';
    INSERT INTO public.applications SELECT v_a_tpl.*;
    UPDATE public.applications SET status = 'cancelled' WHERE job_id = v_job AND worker_id = v_w3;
    IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = v_w3 AND title = 'Turno cancelado')
       OR NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = v_owner AND title = 'Turno cancelado') THEN
        RAISE EXCEPTION 'A18: ator desconhecido deve avisar freela e empresa com texto neutro.'; END IF;
    -- ator EMPRESA (encarregado cancela o convite/turno que opera): freela avisado, empresa NAO.
    -- NOTA (A18 x R27): hoje, quando a EMPRESA cancela, so o freela e avisado; se os Gestores tambem
    -- devem ser avisados quando o encarregado cancela sera decidido junto com cancel_job (E5).
    -- Este teste fixa o comportamento ATUAL de proposito; nao muda com E0-E3.
    v_a_tpl.id := gen_random_uuid(); v_a_tpl.job_id := v_job; v_a_tpl.worker_id := v_w2; v_a_tpl.status := 'hired';
    INSERT INTO public.applications SELECT v_a_tpl.*;
    SELECT count(*) INTO v_n FROM public.notifications WHERE user_id = v_owner;
    PERFORM pg_temp.as_user(v_enc);
    UPDATE public.applications SET status = 'cancelled' WHERE job_id = v_job AND worker_id = v_w2;
    PERFORM pg_temp.as_server();
    IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = v_w2 AND title = 'Turno cancelado pela empresa') THEN
        RAISE EXCEPTION 'A18: encarregado cancelando deveria cair no ator empresa (freela avisado).'; END IF;
    IF (SELECT count(*) FROM public.notifications WHERE user_id = v_owner) <> v_n THEN
        RAISE EXCEPTION 'A18: ator empresa nao deveria avisar a propria empresa.'; END IF;

    -- ============ A15: cobertura por janela de data (sem cron); from tem de ser ENCARREGADO =====
    UPDATE public.jobs SET responsible_id = v_enc WHERE id = v_job;
    UPDATE public.company_members SET confirmed_at = now() WHERE user_id = v_enc2;   -- enc2 agora confirmado
    INSERT INTO public.responsibility_coverages (company_id, from_user_id, to_user_id, starts_on, ends_on, created_by)
    VALUES (v_company, v_enc, v_enc2, v_start, v_start, v_owner);
    PERFORM pg_temp.as_user(v_enc2);
    IF NOT public.is_job_owner(v_job) THEN RAISE EXCEPTION 'A15: quem cobre nao opera dentro da janela.'; END IF;
    PERFORM pg_temp.as_server();
    UPDATE public.responsibility_coverages SET starts_on = v_start + 1, ends_on = v_start + 2 WHERE to_user_id = v_enc2;
    PERFORM pg_temp.as_user(v_enc2);
    IF public.is_job_owner(v_job) THEN RAISE EXCEPTION 'A15: cobertura fora da janela ainda concede acesso.'; END IF;
    -- M1: cobertura DE Gestor/dono e inerte
    PERFORM pg_temp.as_server();
    UPDATE public.jobs SET responsible_id = v_owner WHERE id = v_new_job;
    INSERT INTO public.responsibility_coverages (company_id, from_user_id, to_user_id, starts_on, ends_on, created_by)
    VALUES (v_company, v_owner, v_enc2, (v_j_tpl.start_date AT TIME ZONE 'America/Sao_Paulo')::date,
            (v_j_tpl.start_date AT TIME ZONE 'America/Sao_Paulo')::date, v_owner);
    PERFORM pg_temp.as_user(v_enc2);
    IF public.is_job_owner(v_new_job) THEN RAISE EXCEPTION 'M1: cobertura de Gestor/dono concedeu acesso.'; END IF;
    -- B1: a parte le a propria cobertura enquanto opera
    SELECT count(*) INTO v_n FROM public.responsibility_coverages WHERE to_user_id = v_enc2;
    IF v_n < 1 THEN RAISE EXCEPTION 'B1: a parte nao le a propria cobertura.'; END IF;

    -- ============ A13/A16: remover corta o acesso; responsavel removido cai no Gestor ===========
    PERFORM pg_temp.as_server();
    UPDATE public.company_members SET status = 'removed', removed_at = now() WHERE user_id = v_enc;
    PERFORM pg_temp.as_user(v_enc);
    IF public.is_job_owner(v_job) OR public.is_company_member(v_company) THEN
        RAISE EXCEPTION 'A13: encarregado removido ainda opera.'; END IF;
    SELECT count(*) INTO v_n FROM public.team_connections WHERE company_id = v_company;
    IF v_n <> 0 THEN RAISE EXCEPTION 'A13: removido le o Elenco.'; END IF;
    SELECT count(*) INTO v_n FROM public.responsibility_coverages WHERE from_user_id = v_enc;
    IF v_n <> 0 THEN RAISE EXCEPTION 'B1: removido le o proprio historico de cobertura.'; END IF;
    PERFORM pg_temp.as_user(v_owner);
    IF NOT public.is_job_owner(v_job) THEN RAISE EXCEPTION 'A16: Gestor deixou de operar turno de responsavel removido.'; END IF;
    PERFORM pg_temp.as_server();
    SELECT count(*) = count(DISTINCT r) INTO v_ok FROM public.notification_recipients_for_job(v_job) AS r;
    IF NOT v_ok THEN RAISE EXCEPTION 'A18: destinatarios duplicados.'; END IF;
    IF v_enc IN (SELECT r FROM public.notification_recipients_for_job(v_job) AS r) THEN
        RAISE EXCEPTION 'A16/A18: responsavel removido ainda recebe aviso.'; END IF;
    IF v_owner NOT IN (SELECT r FROM public.notification_recipients_for_job(v_job) AS r) THEN
        RAISE EXCEPTION 'A18: dono nao recebe aviso.'; END IF;

    -- ============ operador de ORGANIZACAO entre os destinatarios do aviso (R8/R21) ==============
    SELECT organization_id INTO v_org FROM public.companies WHERE id = v_company;
    IF v_org IS NOT NULL THEN
        INSERT INTO public.organization_members (organization_id, user_id, role, status, created_by, accepted_at)
        VALUES (v_org, v_orgop, 'operator', 'active', v_owner, now());
        IF v_orgop NOT IN (SELECT r FROM public.notification_recipients_for_job(v_job) AS r) THEN
            RAISE EXCEPTION 'A18: operador de organizacao nao recebe o aviso.'; END IF;
        SELECT count(*) = count(DISTINCT r) INTO v_ok FROM public.notification_recipients_for_job(v_job) AS r;
        IF NOT v_ok THEN RAISE EXCEPTION 'A18: duplicata apos incluir operador de organizacao.'; END IF;
    ELSE
        RAISE NOTICE 'operador de organizacao: pulado (company sem organization_id).';
    END IF;

    -- ============ SOS POSITIVO com Gestor manager NAO-dono (achado A2: cota, varredura, veto) ====
    -- Antes da reancoragem, para um operador nao-dono a contagem dava 0: a cota nunca valia e o freela
    -- que BLOQUEOU a empresa nao era excluido do pool. Cenario: turno em 2h, Elenco ja tentado
    -- (shift_calls 'team' expirado), SOS antigo ABERTO e vencido (a varredura deve expira-lo),
    -- v_w2 BLOQUEOU a empresa, v_w3 e elegivel.
    INSERT INTO public.company_members (company_id, user_id, role, status, created_by, accepted_at)
    VALUES (v_company, v_mgr, 'manager', 'active', v_owner, now());
    UPDATE public.companies SET city = 'QA City' WHERE id = v_company;
    UPDATE public.workers SET discoverable_for_sos = true, city = 'QA City',
                              completed_jobs_count = 5, reviews_count = 0
     WHERE id IN (v_w1, v_w2, v_w3);
    UPDATE public.team_connections SET status = 'blocked', blocked_by = v_w2
     WHERE company_id = v_company AND worker_id = v_w2;
    UPDATE public.jobs SET start_date = now() + interval '2 hours', slots = 1, status = 'open', responsible_id = v_owner
     WHERE id = v_new_job;
    DELETE FROM public.applications WHERE job_id = v_new_job;
    INSERT INTO public.shift_calls (job_id, company_id, created_by, slots, reason, targets_count, status, origin, expires_at)
    VALUES (v_new_job, v_company, v_owner, 1, 'falta', 0, 'expired', 'team', now() - interval '1 hour');
    INSERT INTO public.shift_calls (job_id, company_id, created_by, slots, reason, targets_count, status, origin, expires_at)
    VALUES (v_new_job, v_company, v_owner, 1, 'falta', 1, 'open', 'sos', now() - interval '1 hour')
    RETURNING id INTO v_cid;
    PERFORM pg_temp.as_user(v_mgr);
    IF NOT public.is_company_owner(v_company) THEN RAISE EXCEPTION 'SOS: manager nao e Gestor (premissa do teste).'; END IF;
    v_json := public.create_sos_call(v_new_job, 'falta', NULL);
    IF v_json ->> 'outcome' <> 'created' THEN
        RAISE EXCEPTION 'SOS: manager nao-dono deveria criar o chamado, veio %.', v_json; END IF;
    PERFORM pg_temp.as_server();
    IF (SELECT status FROM public.shift_calls WHERE id = v_cid) <> 'expired' THEN
        RAISE EXCEPTION 'SOS: varredura de expirados nao enxergou o SOS vencido da company.'; END IF;
    SELECT count(*) INTO v_n FROM public.shift_call_targets t JOIN public.shift_calls c ON c.id = t.call_id
     WHERE c.id = (v_json ->> 'call_id')::uuid AND t.worker_id = v_w2;
    IF v_n <> 0 THEN RAISE EXCEPTION 'SOS: freela que BLOQUEOU a empresa entrou no pool (veto furado).'; END IF;
    SELECT count(*) INTO v_n FROM public.shift_call_targets WHERE call_id = (v_json ->> 'call_id')::uuid;
    IF v_n < 1 THEN RAISE EXCEPTION 'SOS: pool vazio apesar de freela elegivel.'; END IF;
    PERFORM pg_temp.as_user(v_mgr);                              -- cota: 1 SOS aberto por company
    IF public.create_sos_call(v_new_job, 'falta', NULL) ->> 'outcome' <> 'quota_exceeded' THEN
        RAISE EXCEPTION 'SOS: cota de 1 aberto nao valeu para o manager nao-dono.'; END IF;
    PERFORM pg_temp.as_server();

    -- ============ R7a no MODO INTERVALO (nao so ancora), encarregado NAO confirmado ===============
    INSERT INTO public.company_members (company_id, user_id, role, status, created_by, accepted_at, display_name, accepted_email, confirmed_at)
    VALUES (v_company, v_enc3, 'encarregado', 'active', v_owner, now(), 'QA Enc 3', 'qa-enc3@example.invalid', NULL);
    PERFORM pg_temp.as_user(v_enc3);
    -- RESSALVA: o erro `not_confirmed` (42501) depende de get_my_companies() devolver o encarregado,
    -- o que so passa a valer com a E4 (hoje get_my_companies filtra role='manager'). Antes da E4 o
    -- modo intervalo devolve vazio SEM erro para quem nao opera nada — o teste so afirma quando a
    -- premissa vale, e avisa quando esta pulado.
    IF EXISTS (SELECT 1 FROM public.get_my_companies()) THEN
        v_ok := false;
        BEGIN
            PERFORM * FROM public.count_worker_shifts_by_week(ARRAY[v_w1], NULL, current_date, current_date + 7);
            v_ok := true;
        EXCEPTION WHEN OTHERS THEN NULL; END;
        IF v_ok THEN RAISE EXCEPTION 'R7a: modo intervalo devolveu resultado (falso zero) para nao confirmado.'; END IF;
    ELSE
        RAISE NOTICE 'R7a modo intervalo: PULADO — get_my_companies ainda nao devolve encarregado (valera com a E4).';
    END IF;
    PERFORM pg_temp.as_server();

    -- ============ anonymize_account sobre ENCARREGADO + guard de LGPD (conta real em auth.users) ==
    INSERT INTO auth.users (id, instance_id, aud, role, email)
    VALUES (v_enc3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-enc3@example.invalid');
    UPDATE public.jobs SET responsible_id = v_enc3 WHERE id = v_job;                 -- sessao nula passa
    UPDATE public.team_connections SET invited_by = v_enc3 WHERE company_id = v_company AND worker_id = v_w2;
    INSERT INTO public.responsibility_coverages (company_id, from_user_id, to_user_id, starts_on, ends_on, created_by)
    VALUES (v_company, v_enc3, v_enc2, current_date, current_date + 1, v_owner);
    -- guard: membro ativo (qualquer papel) com PII = perfil vivo -> DELETE em auth.users e recusado
    v_ok := false;
    BEGIN
        DELETE FROM auth.users WHERE id = v_enc3;
        v_ok := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
        IF v_t NOT LIKE 'LGPD:%' THEN RAISE EXCEPTION 'guard LGPD: erro inesperado: %', v_t; END IF;
    END;
    IF v_ok THEN RAISE EXCEPTION 'guard LGPD: apagou a credencial de membro ativo sem anonimizar.'; END IF;
    v_json := public.anonymize_account(v_enc3);
    IF v_json ->> 'outcome' <> 'anonymized' OR (v_json ->> 'is_member')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'LGPD: anonymize_account sobre encarregado devolveu %.', v_json; END IF;
    IF EXISTS (SELECT 1 FROM public.company_members WHERE user_id = v_enc3
                AND (display_name IS NOT NULL OR accepted_email IS NOT NULL OR status <> 'removed' OR removed_at IS NULL)) THEN
        RAISE EXCEPTION 'LGPD: company_members do encarregado nao foi anonimizado/removido.'; END IF;
    IF EXISTS (SELECT 1 FROM public.responsibility_coverages
                WHERE (from_user_id = v_enc3 OR to_user_id = v_enc3) AND revoked_at IS NULL) THEN
        RAISE EXCEPTION 'LGPD: cobertura do titular nao foi revogada.'; END IF;
    IF EXISTS (SELECT 1 FROM public.jobs WHERE responsible_id = v_enc3) THEN
        RAISE EXCEPTION 'LGPD: jobs.responsible_id do titular nao foi anulado.'; END IF;
    IF EXISTS (SELECT 1 FROM public.team_connections WHERE invited_by = v_enc3) THEN
        RAISE EXCEPTION 'LGPD: team_connections.invited_by do titular nao foi anulado.'; END IF;
    DELETE FROM auth.users WHERE id = v_enc3;                -- depois de anonimizado, o guard libera

    RAISE NOTICE 'OK: A2, A3, A4, A12, A13, A13d, A15, A16, A18, G3, PII, R3, R7a, R27, M1, B1, SOS (inclui manager nao-dono), LGPD verdes.';
END
$t$;

ROLLBACK;  -- desfaz o CHECK alargado, as linhas de teste, responsible_id e as notificacoes
