-- Auditoria e testes de caracterizacao: Equipe e encarregados, E4 (convites, entrada e papel)
-- File: supabase/tests/equipe_e4_auditoria.sql
-- NAO e migration (fica fora de supabase/migrations/ de proposito: o CLI aplicaria). Rodar a mao, por
-- MCP/psql, DEPOIS de aplicar 20261123000500_equipe_e4_convites_e_papel.sql (e E0-E3).
-- Spec: .harness/spec/equipe-encarregados/spec.md (R11, R13-R17, R22, A7-A13, A24); gate D1-D5.
--
-- PARTE 1 e PARTE 2 sao READ-ONLY e podem rodar em PRODUCAO.
-- PARTE 3 escreve (auth.users, companies, company_members, jobs, notifications ...) DENTRO de uma
--   transacao com ROLLBACK ao fim. Dados 100% sinteticos (uuid novo, e-mail @invalido.local). Mesmo
--   assim: rodar em branch/QA/staging; em producao so com janela curta (dispara triggers de signup).
--   Pre-condicao: pelo menos 1 linha em `jobs` (molde para clonar). Falha = RAISE EXCEPTION.
--
-- Esta suite foi ESCRITA SEM EXECUCAO contra um banco (nao havia Postgres disponivel na sessao de
-- construcao): a primeira rodada em QA e parte da verificacao, nao confirmacao.
--
-- Convencao: `esperado:` descreve o resultado correto de cada consulta.

-- ============================================================================
-- PARTE 1 — AUDITORIA ESTRUTURAL (read-only)
-- ============================================================================

-- 1.1 [R1/D5] CHECK de role alargado, e SO para encarregado (sem 'consulta' dormente).
--     esperado: 1 linha, definicao contendo 'manager' e 'encarregado' e NAO contendo 'consulta'.
SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
 WHERE conrelid = 'public.company_members'::regclass AND conname = 'company_members_role_check';

-- 1.2 [D2 + ADR previa-publica] RPCs de equipe: DEFINER, search_path vazio; helpers internos SEM
--     EXECUTE para authenticated. esperado: definer = true em todas; anon_exec = true SO em
--     get_member_invite_preview (excecao unica) e false em todas as outras; auth_exec = false SO nas
--     tres internal_*; svc_exec = true em todas.
SELECT p.proname,
       p.prosecdef                                       AS definer,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc_exec,
       p.proconfig                                       AS config
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('invite_company_member','resend_member_invite','revoke_member_invite',
                     'get_member_invite_preview','accept_company_member_invite',
                     'confirm_company_member','reject_company_member','remove_company_member',
                     'list_company_members','get_my_companies','internal_company_gestor_ids',
                     'internal_notify_member_event','internal_drop_empty_company_shell')
 ORDER BY 1;
--     esperado: config contem search_path="" em todas.
--     Prova direta de "unica com anon" entre as funcoes de E4. esperado: 1 linha (a previa).
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('invite_company_member','resend_member_invite','revoke_member_invite',
                     'get_member_invite_preview','accept_company_member_invite',
                     'confirm_company_member','reject_company_member','remove_company_member',
                     'list_company_members','get_my_companies','internal_company_gestor_ids',
                     'internal_notify_member_event','internal_drop_empty_company_shell')
   AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- 1.3 [G6/M2] a listagem nao devolve token nem le auth.users (sem ultimo acesso).
--     esperado: tem_token = false; le_auth_users = false.
SELECT strpos(pg_get_functiondef('public.list_company_members(uuid, boolean)'::regprocedure), 'invite_token') > 0 AS tem_token,
       strpos(pg_get_functiondef('public.list_company_members(uuid, boolean)'::regprocedure), 'auth.users')   > 0 AS le_auth_users;

-- 1.4 [A21/D1] nenhuma RPC NOVA de equipe ancora empresa em uid cru. esperado: 0 linhas.
--     (get_my_companies fica de fora de proposito: preserva os predicados de dono do baseline porque
--     e o resolvedor do seam; ja aparece na lista de "dividas conscientes" da auditoria 1.2 de E0-E3.)
SELECT p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('invite_company_member','resend_member_invite','revoke_member_invite',
                     'get_member_invite_preview','accept_company_member_invite',
                     'confirm_company_member','reject_company_member','remove_company_member',
                     'list_company_members')
   AND ( pg_get_functiondef(p.oid) ~* 'company_id[[:space:]]*=[[:space:]]*[(]?[[:space:]]*(select[[:space:]]+)?auth[.]uid[(][)]'
      OR pg_get_functiondef(p.oid) ~* 'owner_id[[:space:]]*=[[:space:]]*[(]?[[:space:]]*(select[[:space:]]+)?auth[.]uid[(][)]'
      OR pg_get_functiondef(p.oid) ~* '(company_id|owner_id)[[:space:]]*=[[:space:]]*v_[a-z_]*uid' );

-- 1.5 [R23] get_my_companies devolve role real, confirmed e team_enabled.
--     esperado: ...accepted_tos boolean, confirmed boolean, team_enabled boolean
SELECT pg_get_function_result('public.get_my_companies()'::regprocedure);

-- 1.6 [LGPD] a guarda de DELETE em auth.users nao se restringe a encarregado (E1 corrigida; a E4 so
--     asserta). esperado: restringe = false.
SELECT strpos(pg_get_functiondef('public.lgpd_guard_auth_user_delete()'::regprocedure),
              'cm.role = ''encarregado''') > 0 AS restringe;

-- 1.7 [E0/D5] leitor de company_members sem tratar papel (funcao). A heuristica casa a PALAVRA `role`
--     (limite de palavra POSIX): `primary_role`/`service_role` NAO contam. can_review_for_job fica na
--     lista branca (delega a is_job_owner; sem leitura propria de membros). esperado: 0 linhas.
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind = 'f'
   -- PALAVRA company_members: "session_operates_company_membership" contem "company_members" + "hip"
   -- e o strpos puro acusava is_company_owner (falso positivo do dry-run de producao)
   AND pg_get_functiondef(p.oid) ~ '[[:<:]]company_members[[:>:]]'
   AND pg_get_functiondef(p.oid) !~ '[[:<:]]role[[:>:]]'
   AND p.proname NOT IN ('anonymize_account','lgpd_guard_auth_user_delete',
                         'internal_company_active_operator','session_company_member_confirmed',
                         'can_review_for_job','internal_drop_empty_company_shell')
 ORDER BY 1;
--     idem para policies de OUTRAS tabelas e views. esperado: 0 linhas cada.
SELECT tablename, policyname FROM pg_policies
 WHERE schemaname = 'public' AND tablename <> 'company_members'
   AND (coalesce(qual,'') || coalesce(with_check,'')) ~ '[[:<:]]company_members[[:>:]]'
   AND (coalesce(qual,'') || coalesce(with_check,'')) !~ '[[:<:]]role[[:>:]]';
SELECT viewname FROM pg_views WHERE schemaname = 'public' AND definition ~ '[[:<:]]company_members[[:>:]]';
-- 1.7b a previa e VOLATILE (PostgREST so serve GET para STABLE/IMMUTABLE: token na URL). esperado: v.
SELECT provolatile FROM pg_proc WHERE oid = 'public.get_member_invite_preview(text)'::regprocedure;

-- 1.8 [R1] o seam continua exigindo role = manager (papel novo nao herda acesso pleno).
--     esperado: true.
SELECT strpos(pg_get_functiondef('public.session_operates_company_membership(uuid)'::regprocedure),
              'cm.role = ''manager''') > 0 AS seam_filtra_manager;

-- 1.9 company_members: nenhuma escrita direta pelo client (so SELECT) e nenhuma policy de escrita.
--     esperado: 0 linhas nas duas.
SELECT grantee, privilege_type FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'company_members'
   AND grantee IN ('anon', 'authenticated') AND privilege_type <> 'SELECT';
SELECT policyname, cmd FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'company_members' AND cmd <> 'SELECT';

-- 1.10 [A9] hash de token queimado: coluna e indice existem. esperado: 1 linha cada.
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'company_members' AND column_name = 'invite_token_hash';
SELECT indexname FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'idx_company_members_invite_token_hash';

-- 1.11 [A21] nenhuma policy nova de E4 (a migration nao cria policy). esperado: so a(s) de F13:
--      cm_select_self_or_operator em company_members.
SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'company_members';

-- ============================================================================
-- PARTE 2 — NO-OP PARA AS CONTAS ATUAIS (read-only, ROLLBACK). ANTES x DEPOIS de E4, por conta real:
--   as 7 PRIMEIRAS colunas de get_my_companies tem de ser IDENTICAS; confirmed = true e
--   team_enabled = false para todo dono/operador (company_members vazia).
-- ============================================================================
-- BEGIN;
-- SET LOCAL ROLE authenticated;
-- SET LOCAL request.jwt.claims = '{"sub":"<uid de dono real>","role":"authenticated"}';
-- SELECT company_id, company_name, role, organization_id, organization_name,
--        onboarding_completed, accepted_tos, confirmed, team_enabled
--   FROM public.get_my_companies();
-- SELECT c.id, public.is_company_owner(c.id) FROM public.companies c ORDER BY 1;
-- SELECT bool_and(public.is_job_owner(j.id) = public.is_company_owner(j.company_id)) FROM public.jobs j;
-- ROLLBACK;
-- C6 (read-only, qualquer momento): esperado: so 'manager' (ou vazio).
-- SELECT role, status, count(*) FROM public.company_members GROUP BY 1, 2 ORDER BY 1, 2;

-- ============================================================================
-- PARTE 3 — CARACTERIZACAO FUNCIONAL (QA/staging; BEGIN ... ROLLBACK)
--   Cobre: A7 (convite sem e-mail, 14 dias, token >= 32), A8 (aceite: ativo, nao confirmado, token
--   queimado, casca removida, e-mail verificado), A9 (token_already_used / expired / revoked /
--   not_found), A10 (worker_cannot_be_manager), A11 (reenvio rotaciona), A12 (nao confirmado le 0 de
--   Elenco; confirmar libera), A13 (remover nao bloqueia, nada reescrito, Elenco intacto), A24
--   (not_confirmed no modo intervalo; depois de confirmar a contagem inclui turno de outro
--   responsavel), Gestor NAO entra por link (invite manager = invalid_input; aceite de linha manager
--   = use_manager_invite), aceite exige Termos (tos_required), Encarregado nao convida, re-convite de
--   removido, remocao idempotente (already_removed), Elenco e chamado intactos apos remover, listagem
--   sem token e sem ultimo acesso, get_my_companies com papel real e ordem por poder, previa PUBLICA
--   (anon): projecao minima e erro colapsado, LGPD (guarda e anonymize cobrem Gestor).
-- ============================================================================
BEGIN;

CREATE FUNCTION pg_temp.as_user(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
END $f$;

CREATE FUNCTION pg_temp.as_anon() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);   -- sem JWT: papel anon do PostgREST
    SET LOCAL ROLE anon;
END $f$;

CREATE FUNCTION pg_temp.as_server() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);   -- sessao NULA (servidor/cron)
END $f$;

-- auth.users nasce como no signup real (handle_new_user cria a casca de companies p/ 'hire' e a linha
-- de workers para o resto).
CREATE FUNCTION pg_temp.mk_user(p_id uuid, p_email text, p_hire boolean, p_verified boolean)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, '',
            CASE WHEN p_verified THEN now() ELSE NULL END, now(), now(), '{}'::jsonb,
            CASE WHEN p_hire THEN '{"user_type":"hire"}'::jsonb ELSE '{}'::jsonb END);
END $f$;

DO $t$
DECLARE
    v_dono   uuid := gen_random_uuid();   -- dono (Gestor, operador da organizacao dele)
    v_mgr    uuid := gen_random_uuid();   -- Gestor 'manager' (so linha em company_members; sem auth.users)
    v_inv    uuid := gen_random_uuid();   -- convidado 1 (Ana): conta 'hire' verificada
    v_inv2   uuid := gen_random_uuid();   -- convidado 2 (Beto)
    v_carla  uuid := gen_random_uuid();   -- convidada como Gestor
    v_x      uuid := gen_random_uuid();   -- 'hire' sem relacao
    v_unver  uuid := gen_random_uuid();   -- 'hire' com e-mail NAO verificado
    v_wk     uuid := gen_random_uuid();   -- conta de freela (no Elenco)
    v_wk2    uuid := gen_random_uuid();   -- freela que o ENCARREGADO traz ao Elenco
    v_company uuid;
    v_n1     bigint;
    v_job3   uuid := gen_random_uuid();   -- turno de OUTRO responsavel (Gestor), com freela hired
    v_tok_mgr text;
    v_a_tpl  public.applications%ROWTYPE;
    v_sc_ok  boolean := false;
    v_tag    text := left(replace(gen_random_uuid()::text, '-', ''), 8);
    v_email_inv text;
    v_r      jsonb;
    v_item   jsonb;
    v_t      text;
    v_n      bigint;
    v_n0     bigint;
    v_gc     record;
    v_exp    timestamptz;
    v_tok_ana text;  v_tok_ana2 text;  v_tok_beto text;  v_tok_beto2 text;  v_tok_beto3 text;
    v_tok_dani text;  v_tok_eva text;
    v_mid_ana uuid;  v_mid_ana2 uuid;  v_mid_beto uuid;  v_mid_dani uuid;
    v_job1 uuid := gen_random_uuid();
    v_job2 uuid := gen_random_uuid();
    v_j_tpl public.jobs%ROWTYPE;
BEGIN
    -- ---------------- pre-condicoes ----------------
    PERFORM pg_temp.as_server();
    IF to_regprocedure('public.accept_company_member_invite(text, boolean)') IS NULL THEN
        RAISE EXCEPTION 'PRE-CONDICAO: E4 (20261123000500) nao aplicada.'; END IF;
    SELECT * INTO v_j_tpl FROM public.jobs LIMIT 1;
    IF v_j_tpl.id IS NULL THEN RAISE EXCEPTION 'PRE-CONDICAO: preciso de 1 turno em jobs (molde).'; END IF;

    -- ---------------- setup (servidor) ----------------
    v_email_inv := 'qa-e4-' || v_tag || '-ana@invalido.local';
    PERFORM pg_temp.mk_user(v_dono,  'qa-e4-' || v_tag || '-dono@invalido.local',  true,  true);
    PERFORM pg_temp.mk_user(v_inv,   v_email_inv,                                  true,  true);
    PERFORM pg_temp.mk_user(v_inv2,  'qa-e4-' || v_tag || '-beto@invalido.local',  true,  true);
    PERFORM pg_temp.mk_user(v_carla, 'qa-e4-' || v_tag || '-carla@invalido.local', true,  true);
    PERFORM pg_temp.mk_user(v_x,     'qa-e4-' || v_tag || '-x@invalido.local',     true,  true);
    PERFORM pg_temp.mk_user(v_unver, 'qa-e4-' || v_tag || '-unver@invalido.local', true,  false);
    PERFORM pg_temp.mk_user(v_wk,    'qa-e4-' || v_tag || '-wk@invalido.local',    false, true);
    PERFORM pg_temp.mk_user(v_wk2,   'qa-e4-' || v_tag || '-wk2@invalido.local',   false, true);

    v_company := v_dono;      -- a casca de companies do signup 'hire' e a empresa do dono
    UPDATE public.companies SET name = 'QA Empresa E4 ' || v_tag WHERE id = v_company;
    IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_company) THEN
        RAISE EXCEPTION 'PRE-CONDICAO: handle_new_user nao criou a casca de companies.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.workers WHERE id = v_wk) THEN
        RAISE EXCEPTION 'PRE-CONDICAO: handle_new_user nao criou o freela.'; END IF;

    INSERT INTO public.company_members
        (company_id, user_id, role, status, created_by, accepted_at, display_name, confirmed_at)
    VALUES (v_company, v_mgr, 'manager', 'active', v_dono, now(), 'QA Gestor', now());
    INSERT INTO public.team_connections (company_id, worker_id, status, source)
    VALUES (v_company, v_wk, 'pending', 'link');
    SELECT count(*) INTO v_n0 FROM public.team_connections WHERE company_id = v_company;     -- = 1

    -- CHECK: 'consulta' NAO e valor valido (sem valor dormente)
    BEGIN
        INSERT INTO public.company_members (company_id, user_id, role, status, created_by)
        VALUES (v_company, gen_random_uuid(), 'consulta', 'active', v_dono);
        RAISE EXCEPTION 'R1: CHECK aceitou role consulta.';
    EXCEPTION WHEN check_violation THEN NULL; END;

    -- ============ A7 / R11: convite sem e-mail, 14 dias, token >= 32, idempotente ================
    PERFORM pg_temp.as_user(v_dono);
    v_r := public.invite_company_member(v_company, '  Ana QA  ', 'encarregado');
    IF v_r ->> 'outcome' <> 'invited' THEN RAISE EXCEPTION 'A7: esperado invited, veio %.', v_r; END IF;
    v_tok_ana := v_r ->> 'invite_token';  v_mid_ana := (v_r ->> 'member_id')::uuid;
    v_exp := (v_r ->> 'expires_at')::timestamptz;
    IF length(v_tok_ana) < 32 THEN RAISE EXCEPTION 'A7: token curto (%).', length(v_tok_ana); END IF;
    IF v_exp < now() + interval '13 days 23 hours' OR v_exp > now() + interval '14 days 1 hour' THEN
        RAISE EXCEPTION 'A7: validade fora de ~14 dias (%).', v_exp; END IF;
    PERFORM pg_temp.as_server();
    IF NOT EXISTS (SELECT 1 FROM public.company_members cm
                    WHERE cm.id = v_mid_ana AND cm.status = 'invited' AND cm.user_id IS NULL
                      AND cm.invited_email IS NULL AND cm.display_name = 'Ana QA'
                      AND cm.role = 'encarregado' AND cm.created_by = v_dono) THEN
        RAISE EXCEPTION 'A7: linha do convite nao tem a forma esperada.'; END IF;
    PERFORM pg_temp.as_user(v_dono);
    v_r := public.invite_company_member(v_company, 'ana qa', 'encarregado');
    IF v_r ->> 'outcome' <> 'already_invited' OR v_r ->> 'invite_token' <> v_tok_ana
       OR (v_r ->> 'member_id')::uuid <> v_mid_ana THEN
        RAISE EXCEPTION 'R11: idempotencia por (nome sem caixa, papel) falhou: %.', v_r; END IF;

    -- validacao de entrada
    IF public.invite_company_member(v_company, '   ', 'encarregado') ->> 'outcome' <> 'invalid_input'
       OR public.invite_company_member(v_company, 'Fulano', 'consulta') ->> 'outcome' <> 'invalid_input'
       OR public.invite_company_member(v_company, 'Fulano', 'manager') ->> 'outcome' <> 'invalid_input'   -- Gestor nao entra por link
       OR public.invite_company_member(v_company, 'Fulano', NULL) ->> 'outcome' <> 'invalid_input'
       OR public.invite_company_member(v_company, 'Fu' || chr(9) || 'lano', 'encarregado') ->> 'outcome' <> 'invalid_input'
       OR public.invite_company_member(v_company, repeat('x', 81), 'encarregado') ->> 'outcome' <> 'invalid_input' THEN
        RAISE EXCEPTION 'R11: entradas invalidas nao devolveram invalid_input.'; END IF;
    IF public.invite_company_member(gen_random_uuid(), 'Fulano', 'encarregado') ->> 'outcome' <> 'not_found' THEN
        RAISE EXCEPTION 'R11: empresa inexistente nao devolveu not_found.'; END IF;

    -- Gestor ('manager') convida Encarregado; NINGUEM convida Gestor por link (invalid_input)
    PERFORM pg_temp.as_user(v_mgr);
    v_r := public.invite_company_member(v_company, 'Beto QA', 'encarregado');
    IF v_r ->> 'outcome' <> 'invited' THEN RAISE EXCEPTION 'R11: Gestor nao convidou encarregado: %.', v_r; END IF;
    v_tok_beto := v_r ->> 'invite_token';  v_mid_beto := (v_r ->> 'member_id')::uuid;
    IF public.invite_company_member(v_company, 'Zed QA', 'manager') ->> 'outcome' <> 'invalid_input' THEN
        RAISE EXCEPTION 'R11/H1: Gestor convidou Gestor por link.'; END IF;
    -- quem nao e Gestor (nem membro) nao convida; nem lista; nem reenvia/revoga
    PERFORM pg_temp.as_user(v_x);
    IF public.invite_company_member(v_company, 'Intruso', 'encarregado') ->> 'outcome' <> 'forbidden'
       OR public.list_company_members(v_company) ->> 'outcome' <> 'forbidden'
       OR public.resend_member_invite(v_mid_beto) ->> 'outcome' <> 'forbidden'
       OR public.revoke_member_invite(v_mid_beto) ->> 'outcome' <> 'forbidden' THEN
        RAISE EXCEPTION 'R11: sessao sem poder sobre a empresa nao recebeu forbidden.'; END IF;
    -- dono tambem nao convida Gestor por este caminho
    PERFORM pg_temp.as_user(v_dono);
    IF public.invite_company_member(v_company, 'Carla QA', 'manager') ->> 'outcome' <> 'invalid_input' THEN
        RAISE EXCEPTION 'R11/H1: dono convidou Gestor por link.'; END IF;
    v_r := public.invite_company_member(v_company, 'Eva QA', 'encarregado');
    v_tok_eva := v_r ->> 'invite_token';
    -- convite de GESTOR legado (invite_company_manager: com e-mail), simulado pelo servidor
    PERFORM pg_temp.as_server();
    v_tok_mgr := public.generate_invite_token();
    INSERT INTO public.company_members
        (company_id, user_id, role, status, invited_email, invite_token, expires_at, created_by)
    VALUES (v_company, NULL, 'manager', 'invited', 'zed-' || v_tag || '@invalido.local', v_tok_mgr,
            now() + interval '7 days', v_dono);

    -- resend/revoke so tratam convite de encarregado (convite de Gestor e de invite_company_manager)
    IF public.resend_member_invite((SELECT id FROM public.company_members WHERE invite_token = v_tok_mgr))
         ->> 'outcome' <> 'unauthenticated' THEN RAISE EXCEPTION 'sessao nula em resend.'; END IF;
    PERFORM pg_temp.as_user(v_dono);
    IF public.resend_member_invite((SELECT id FROM public.company_members WHERE invite_token = v_tok_mgr))
         ->> 'outcome' <> 'not_found'
       OR public.revoke_member_invite((SELECT id FROM public.company_members WHERE invite_token = v_tok_mgr))
         ->> 'outcome' <> 'not_found' THEN
        RAISE EXCEPTION 'H1: resend/revoke tocaram convite de Gestor.'; END IF;

    -- ===== previa publica (ADR previa-publica): anon, projecao minima, erro colapsado ===========
    PERFORM pg_temp.as_anon();
    v_r := public.get_member_invite_preview(v_tok_eva);
    IF v_r ->> 'outcome' <> 'ok' OR v_r ->> 'role' <> 'encarregado'
       OR (SELECT count(*) FROM jsonb_object_keys(v_r)) <> 3
       OR v_r ->> 'company_name' IS DISTINCT FROM 'QA Empresa E4 ' || v_tag THEN
        RAISE EXCEPTION 'R13: previa anon fora da projecao minima: %.', v_r; END IF;
    IF v_r::text LIKE '%' || v_tok_eva || '%' OR v_r::text LIKE '%@%' OR v_r::text LIKE '%Eva%'
       OR v_r::text LIKE '%hash%' OR v_r::text LIKE '%token%' THEN
        RAISE EXCEPTION 'R13: previa vazou token/hash/e-mail/nome: %.', v_r; END IF;
    -- inexistente, malformado, tamanho errado, NULL e linha de Gestor: TODOS identicos (not_found)
    IF public.get_member_invite_preview(repeat('a', 64)) IS DISTINCT FROM jsonb_build_object('outcome', 'not_found')
       OR public.get_member_invite_preview('abc')          IS DISTINCT FROM jsonb_build_object('outcome', 'not_found')
       OR public.get_member_invite_preview(repeat('a', 65)) IS DISTINCT FROM jsonb_build_object('outcome', 'not_found')
       OR public.get_member_invite_preview(upper(v_tok_eva)) IS DISTINCT FROM jsonb_build_object('outcome', 'not_found')
       OR public.get_member_invite_preview(NULL)           IS DISTINCT FROM jsonb_build_object('outcome', 'not_found')
       OR public.get_member_invite_preview(v_tok_mgr)      IS DISTINCT FROM jsonb_build_object('outcome', 'not_found') THEN
        RAISE EXCEPTION 'R13: previa distingue tipos de erro (oraculo).'; END IF;
    -- o resto das RPCs continua fechado para anon
    BEGIN
        PERFORM public.list_company_members(v_company);
        RAISE EXCEPTION 'R13: anon executou list_company_members.';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        PERFORM public.accept_company_member_invite(v_tok_eva, true);
        RAISE EXCEPTION 'R13: anon executou accept_company_member_invite.';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    -- sessao nula
    PERFORM pg_temp.as_server();
    IF public.invite_company_member(v_company, 'Nulo', 'encarregado') ->> 'outcome' <> 'unauthenticated'
       OR public.confirm_company_member(v_company, v_inv) ->> 'outcome' <> 'unauthenticated'
       OR public.list_company_members(v_company) ->> 'outcome' <> 'unauthenticated'
       OR public.accept_company_member_invite(v_tok_ana, true) ->> 'outcome' <> 'unauthenticated' THEN
        RAISE EXCEPTION 'sessao nula nao recebeu unauthenticated.'; END IF;

    -- ============ A10: conta de freela nao entra; nada e criado ===================================
    PERFORM pg_temp.as_user(v_wk);
    v_r := public.accept_company_member_invite(v_tok_ana, true);
    IF v_r ->> 'outcome' <> 'worker_cannot_be_manager' THEN RAISE EXCEPTION 'A10: %.', v_r; END IF;
    PERFORM pg_temp.as_server();
    IF EXISTS (SELECT 1 FROM public.company_members WHERE user_id = v_wk)
       OR NOT EXISTS (SELECT 1 FROM public.company_members WHERE id = v_mid_ana AND status = 'invited') THEN
        RAISE EXCEPTION 'A10: o convite foi consumido ou criou membership para a conta de freela.'; END IF;

    -- e-mail nao verificado nao entra
    PERFORM pg_temp.as_user(v_unver);
    IF public.accept_company_member_invite(v_tok_ana, true) ->> 'outcome' <> 'email_not_verified' THEN
        RAISE EXCEPTION 'R14b: e-mail nao verificado aceitou o convite.'; END IF;

    -- quem ja e Gestor da empresa nao queima o convite
    PERFORM pg_temp.as_user(v_dono);
    IF public.accept_company_member_invite(v_tok_eva, true) ->> 'outcome' <> 'already_operator' THEN
        RAISE EXCEPTION 'R14b: dono aceitou convite da propria empresa.'; END IF;
    PERFORM pg_temp.as_server();
    IF NOT EXISTS (SELECT 1 FROM public.company_members WHERE invite_token = v_tok_eva AND status = 'invited') THEN
        RAISE EXCEPTION 'R14b: already_operator queimou o convite.'; END IF;

    -- ============ A8: aceite -> ativo, NAO confirmado, token queimado, casca removida ============
    PERFORM pg_temp.as_server();
    IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_inv) THEN
        RAISE EXCEPTION 'A8 (setup): a casca de companies do convidado deveria existir antes do aceite.'; END IF;
    -- A8, pre-login: a previa anon mostra empresa + papel do convite da Ana
    PERFORM pg_temp.as_anon();
    v_r := public.get_member_invite_preview(v_tok_ana);
    IF v_r ->> 'outcome' <> 'ok' OR v_r ->> 'role' <> 'encarregado' THEN
        RAISE EXCEPTION 'A8: previa pre-login errada: %.', v_r; END IF;
    PERFORM pg_temp.as_user(v_inv);
    -- sem Termos nao aceita e NAO consome o token (encarregado nao fica preso no TOS gate)
    IF public.accept_company_member_invite(v_tok_ana, false) ->> 'outcome' <> 'tos_required'
       OR public.accept_company_member_invite(v_tok_ana, NULL) ->> 'outcome' <> 'tos_required' THEN
        RAISE EXCEPTION 'R13: aceite sem Termos nao devolveu tos_required.'; END IF;
    PERFORM pg_temp.as_server();
    IF NOT EXISTS (SELECT 1 FROM public.company_members WHERE id = v_mid_ana AND status = 'invited' AND invite_token = v_tok_ana)
       OR NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_inv) THEN
        RAISE EXCEPTION 'R13: tos_required consumiu o convite ou removeu a casca.'; END IF;
    -- convite de GESTOR nao ativa por aqui (H1) e nao queima o token
    PERFORM pg_temp.as_user(v_x);
    IF public.accept_company_member_invite(v_tok_mgr, true) ->> 'outcome' <> 'use_manager_invite' THEN
        RAISE EXCEPTION 'H1: aceite de convite de Gestor nao devolveu use_manager_invite.'; END IF;
    PERFORM pg_temp.as_server();
    IF NOT EXISTS (SELECT 1 FROM public.company_members WHERE invite_token = v_tok_mgr AND status = 'invited' AND user_id IS NULL) THEN
        RAISE EXCEPTION 'H1: use_manager_invite ativou/queimou o convite de Gestor.'; END IF;
    PERFORM pg_temp.as_user(v_inv);
    v_r := public.accept_company_member_invite(v_tok_ana, true);
    IF v_r ->> 'outcome' <> 'accepted' OR (v_r ->> 'confirmed')::boolean THEN
        RAISE EXCEPTION 'A8: aceite falhou ou veio confirmado: %.', v_r; END IF;
    -- depois do aceite a previa anon do MESMO link e not_found, igual a token inexistente
    PERFORM pg_temp.as_anon();
    IF public.get_member_invite_preview(v_tok_ana) IS DISTINCT FROM public.get_member_invite_preview(repeat('b', 64)) THEN
        RAISE EXCEPTION 'R13: previa distingue token queimado de inexistente.'; END IF;
    PERFORM pg_temp.as_user(v_inv);
    PERFORM pg_temp.as_server();
    IF NOT EXISTS (SELECT 1 FROM public.company_members cm
                    WHERE cm.id = v_mid_ana AND cm.status = 'active' AND cm.user_id = v_inv
                      AND cm.confirmed_at IS NULL AND cm.confirmed_by IS NULL
                      AND cm.invite_token IS NULL AND cm.invite_token_hash IS NOT NULL
                      AND cm.accepted_email = lower(v_email_inv) AND cm.accepted_tos_at IS NOT NULL
                      AND cm.accepted_at IS NOT NULL) THEN
        RAISE EXCEPTION 'A8: membership apos o aceite nao tem a forma esperada.'; END IF;
    IF EXISTS (SELECT 1 FROM public.companies WHERE id = v_inv) THEN
        RAISE EXCEPTION 'A8: a casca de companies do convidado nao foi removida.'; END IF;
    FOR v_t IN SELECT unnest(ARRAY[v_dono::text, v_mgr::text]) LOOP
        IF NOT EXISTS (SELECT 1 FROM public.notifications
                        WHERE user_id = v_t::uuid AND title = 'Nova pessoa na equipe') THEN
            RAISE EXCEPTION 'R22: Gestor % nao foi avisado "entrou" (dono/manager).', v_t; END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM public.notifications
                WHERE title = 'Nova pessoa na equipe' AND created_at >= now() AND message LIKE '%@%') THEN
        RAISE EXCEPTION 'R22: o aviso ao Gestor grava o e-mail da pessoa (minimizacao).'; END IF;
    IF EXISTS (SELECT 1 FROM public.notifications WHERE user_id = v_inv AND title = 'Nova pessoa na equipe') THEN
        RAISE EXCEPTION 'R22: o proprio convidado recebeu o aviso destinado ao Gestor.'; END IF;

    -- ============ A9: token queimado ===============================================================
    PERFORM pg_temp.as_user(v_inv);
    IF public.accept_company_member_invite(v_tok_ana, true) ->> 'outcome' <> 'already_accepted' THEN
        RAISE EXCEPTION 'A9: retry do mesmo usuario nao foi idempotente.'; END IF;
    PERFORM pg_temp.as_user(v_inv2);
    IF public.accept_company_member_invite(v_tok_ana, true) ->> 'outcome' <> 'token_already_used' THEN
        RAISE EXCEPTION 'A9: segunda pessoa nao recebeu token_already_used.'; END IF;
    IF public.accept_company_member_invite(repeat('0', 64), true) ->> 'outcome' <> 'not_found'
       OR public.accept_company_member_invite('   ', true) ->> 'outcome' <> 'invalid_input' THEN
        RAISE EXCEPTION 'A9: token inexistente/vazio.'; END IF;
    PERFORM pg_temp.as_server();
    SELECT count(*) INTO v_n FROM public.company_members WHERE company_id = v_company AND user_id = v_inv;
    IF v_n <> 1 THEN RAISE EXCEPTION 'A9: % memberships para a mesma pessoa.', v_n; END IF;

    -- ============ A12: NAO confirmado le 0, opera 0, nao se auto-confirma ========================
    PERFORM pg_temp.as_user(v_inv);
    IF public.is_company_owner(v_company) THEN RAISE EXCEPTION 'A2: encarregado satisfaz is_company_owner.'; END IF;
    IF NOT public.is_company_member(v_company) OR public.is_company_member_confirmed(v_company) THEN
        RAISE EXCEPTION 'A12: nao confirmado deveria ser membro mas nao confirmado.'; END IF;
    SELECT count(*) INTO v_n FROM public.team_connections WHERE company_id = v_company;
    IF v_n <> 0 THEN RAISE EXCEPTION 'A12: nao confirmado le % conexoes do Elenco.', v_n; END IF;
    SELECT count(*) INTO v_n FROM public.company_members WHERE user_id IS DISTINCT FROM v_inv;
    IF v_n <> 0 THEN RAISE EXCEPTION 'G6: encarregado le % linhas de company_members de outras pessoas (token?).', v_n; END IF;
    BEGIN
        UPDATE public.company_members SET confirmed_at = now() WHERE user_id = v_inv;
        RAISE EXCEPTION 'A12: encarregado se auto-confirmou por UPDATE direto.';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    IF public.confirm_company_member(v_company, v_inv) ->> 'outcome' <> 'forbidden'
       OR public.reject_company_member(v_company, v_inv) ->> 'outcome' <> 'forbidden'
       OR public.remove_company_member(v_company, v_inv, false) ->> 'outcome' <> 'forbidden'
       OR public.list_company_members(v_company) ->> 'outcome' <> 'forbidden'
       OR public.invite_company_member(v_company, 'Lateral', 'encarregado') ->> 'outcome' <> 'forbidden'
       OR public.resend_member_invite(v_mid_beto) ->> 'outcome' <> 'forbidden' THEN
        RAISE EXCEPTION 'R11/R22: encarregado conseguiu agir como Gestor.'; END IF;
    -- get_my_companies: o encarregado (nao confirmado) APARECE, com papel real
    SELECT * INTO v_gc FROM public.get_my_companies() WHERE company_id = v_company;
    IF v_gc.company_id IS NULL OR v_gc.role <> 'encarregado' OR v_gc.confirmed OR NOT v_gc.team_enabled
       OR NOT v_gc.accepted_tos THEN
        RAISE EXCEPTION 'R23/E4: get_my_companies do encarregado nao confirmado esta errado: %.', v_gc; END IF;
    SELECT count(*) INTO v_n FROM public.get_my_companies();
    IF v_n <> 1 THEN RAISE EXCEPTION 'E4: get_my_companies devolveu % empresas ao encarregado (esperado 1).', v_n; END IF;
    -- A24: a guarda de vinculo recusa (nunca "zero") no modo INTERVALO, que nao tem turno-ancora
    BEGIN
        PERFORM * FROM public.count_worker_shifts_by_week(ARRAY[v_wk], NULL::uuid, current_date, current_date + 7);
        RAISE EXCEPTION 'A24: nao confirmado recebeu resultado da guarda de vinculo no modo intervalo (falso zero).';
    EXCEPTION WHEN sqlstate '42501' THEN
        GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
        IF v_t <> 'not_confirmed' THEN RAISE EXCEPTION 'A24: erro inesperado: %.', v_t; END IF;
    END;

    -- ============ A12 (lado do Gestor): lista sem token; confirmar libera =======================
    PERFORM pg_temp.as_user(v_dono);
    v_r := public.list_company_members(v_company);
    IF v_r ->> 'outcome' <> 'ok' THEN RAISE EXCEPTION 'R24: list_company_members: %.', v_r; END IF;
    SELECT i INTO v_item FROM jsonb_array_elements(v_r -> 'items') AS i WHERE i ->> 'member_id' = v_mid_ana::text;
    IF v_item IS NULL OR v_item ->> 'state' <> 'awaiting_confirmation'
       OR v_item ->> 'accepted_email' IS DISTINCT FROM lower(v_email_inv) THEN
        RAISE EXCEPTION 'R24: item da Ana errado: %.', v_item; END IF;
    SELECT i INTO v_item FROM jsonb_array_elements(v_r -> 'items') AS i WHERE i ->> 'member_id' = v_mid_beto::text;
    IF v_item IS NULL OR v_item ->> 'state' <> 'invited' THEN RAISE EXCEPTION 'R24: item do Beto errado: %.', v_item; END IF;
    IF v_r::text LIKE '%invite_token%' OR v_r::text LIKE '%' || v_tok_beto || '%'
       OR v_r::text LIKE '%' || v_tok_mgr || '%' OR v_r::text LIKE '%' || v_tok_eva || '%' THEN
        RAISE EXCEPTION 'G6: a listagem vazou invite_token.'; END IF;
    IF v_r::text LIKE '%last_access%' OR v_r::text LIKE '%last_sign_in%' THEN
        RAISE EXCEPTION 'M2: a listagem devolve ultimo acesso (dado global de auth.users).'; END IF;

    PERFORM pg_temp.as_user(v_mgr);
    IF public.confirm_company_member(v_company, v_mgr) ->> 'outcome' <> 'forbidden' THEN
        RAISE EXCEPTION 'R22: Gestor se confirmou sozinho.'; END IF;
    IF public.confirm_company_member(v_company, gen_random_uuid()) ->> 'outcome' <> 'not_found' THEN
        RAISE EXCEPTION 'R22: confirmar quem nao existe nao devolveu not_found.'; END IF;
    IF public.confirm_company_member(v_company, v_inv) ->> 'outcome' <> 'confirmed' THEN
        RAISE EXCEPTION 'R22: confirmar falhou.'; END IF;
    IF public.confirm_company_member(v_company, v_inv) ->> 'outcome' <> 'already_confirmed' THEN
        RAISE EXCEPTION 'R22: reconfirmar nao foi idempotente.'; END IF;
    PERFORM pg_temp.as_server();
    IF NOT EXISTS (SELECT 1 FROM public.company_members WHERE id = v_mid_ana AND confirmed_at IS NOT NULL AND confirmed_by = v_mgr)
       OR NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = v_inv AND title = 'Acesso confirmado') THEN
        RAISE EXCEPTION 'R22: confirmed_by/aviso ao confirmado ausentes.'; END IF;

    PERFORM pg_temp.as_user(v_inv);
    IF NOT public.is_company_member_confirmed(v_company) OR public.is_company_owner(v_company) THEN
        RAISE EXCEPTION 'A12/A2: apos confirmar: confirmado=true e is_company_owner=false esperados.'; END IF;
    SELECT count(*) INTO v_n FROM public.team_connections WHERE company_id = v_company;
    IF v_n <> v_n0 THEN RAISE EXCEPTION 'A12: confirmado le % de % conexoes.', v_n, v_n0; END IF;
    SELECT * INTO v_gc FROM public.get_my_companies() WHERE company_id = v_company;
    IF v_gc.company_id IS NULL OR NOT v_gc.confirmed OR v_gc.role <> 'encarregado' THEN
        RAISE EXCEPTION 'R22: get_my_companies apos confirmar: %.', v_gc; END IF;
    PERFORM * FROM public.count_worker_shifts_by_week(ARRAY[v_wk], NULL::uuid, current_date, current_date + 7);  -- sem erro

    -- A13c/R10b: o encarregado TRAZ um freela ao Elenco da EMPRESA (pending); invited_by = ele (trigger)
    INSERT INTO public.team_connections (company_id, worker_id, status, source, invited_by)
    VALUES (v_company, v_wk2, 'pending', 'link', v_dono);                    -- invited_by forjado: sobrescrito
    PERFORM pg_temp.as_server();
    IF NOT EXISTS (SELECT 1 FROM public.team_connections
                    WHERE company_id = v_company AND worker_id = v_wk2 AND invited_by = v_inv) THEN
        RAISE EXCEPTION 'A13d: o vinculo trazido pelo encarregado nao tem company_id da empresa e invited_by = ele.'; END IF;
    SELECT count(*) INTO v_n1 FROM public.team_connections WHERE company_id = v_company;      -- = v_n0 + 1

    -- A24 (depois de confirmar): a contagem inclui turnos de OUTRO responsavel (so numeros por semana)
    SELECT * INTO v_a_tpl FROM public.applications LIMIT 1;
    IF v_a_tpl.id IS NULL THEN
        RAISE NOTICE 'NAO VERIFICADO (A24, contagem de turno alheio): nao ha applications para molde.';
    ELSE
        v_j_tpl.company_id := v_company;  v_j_tpl.series_id := NULL;  v_j_tpl.series_occurrence_date := NULL;
        v_j_tpl.tag_id := NULL;  v_j_tpl.responsible_id := NULL;          -- NULL = Gestor (nao e do encarregado)
        v_j_tpl.status := 'open';  v_j_tpl.start_date := now() + interval '3 days';
        v_j_tpl.id := v_job3;  INSERT INTO public.jobs SELECT v_j_tpl.*;
        v_a_tpl.id := gen_random_uuid();  v_a_tpl.job_id := v_job3;  v_a_tpl.worker_id := v_wk;
        v_a_tpl.status := 'hired';
        INSERT INTO public.applications SELECT v_a_tpl.*;
        PERFORM pg_temp.as_user(v_inv);
        IF public.is_job_owner(v_job3) THEN RAISE EXCEPTION 'A2: encarregado opera turno do Gestor.'; END IF;
        SELECT COALESCE(sum(c.shift_count), 0) INTO v_n
          FROM public.count_worker_shifts_by_week(ARRAY[v_wk], NULL::uuid, current_date, current_date + 7) AS c;
        IF v_n < 1 THEN
            RAISE EXCEPTION 'A24: confirmado nao contou o turno de outro responsavel (contagem %).', v_n; END IF;
    END IF;

    -- ============ A13: remover NAO bloqueia, nao reescreve nada, Elenco intacto ===================
    PERFORM pg_temp.as_server();
    v_j_tpl.company_id := v_company;  v_j_tpl.series_id := NULL;  v_j_tpl.series_occurrence_date := NULL;
    v_j_tpl.tag_id := NULL;
    v_j_tpl.responsible_id := v_inv;  v_j_tpl.status := 'open';
    v_j_tpl.start_date := now() + interval '3 days';
    v_j_tpl.id := v_job1;  INSERT INTO public.jobs SELECT v_j_tpl.*;
    v_j_tpl.id := v_job2;  INSERT INTO public.jobs SELECT v_j_tpl.*;
    -- chamado ABERTO no turno 1 (colunas conforme architecture.md; se o molde de QA divergir, avisa)
    BEGIN
        INSERT INTO public.shift_calls (job_id, company_id, created_by, slots, reason, status, expires_at)
        VALUES (v_job1, v_company, v_inv, 1, 'falta', 'open', now() + interval '1 hour');
        v_sc_ok := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
        RAISE NOTICE 'NAO VERIFICADO (A13, chamado aberto): insert de shift_calls falhou no molde: %', v_t;
    END;
    PERFORM pg_temp.as_user(v_inv);
    IF NOT public.is_job_owner(v_job1) THEN RAISE EXCEPTION 'A2: responsavel confirmado nao opera o proprio turno.'; END IF;

    PERFORM pg_temp.as_user(v_dono);
    v_r := public.remove_company_member(v_company, v_inv, true);                     -- dry-run
    IF v_r ->> 'outcome' <> 'would_remove' OR (v_r ->> 'open_jobs')::int <> 2
       OR NOT (v_r ->> 'elenco_link_rotation_advised')::boolean THEN
        RAISE EXCEPTION 'R17: dry-run errado: %.', v_r; END IF;
    PERFORM pg_temp.as_server();
    IF NOT EXISTS (SELECT 1 FROM public.company_members WHERE id = v_mid_ana AND status = 'active') THEN
        RAISE EXCEPTION 'R17: dry-run escreveu.'; END IF;

    PERFORM pg_temp.as_user(v_mgr);
    IF public.remove_company_member(v_company, v_mgr, false) ->> 'outcome' <> 'cannot_remove_self' THEN
        RAISE EXCEPTION 'R17: Gestor removeu a si mesmo.'; END IF;
    v_r := public.remove_company_member(v_company, v_inv, false);
    IF v_r ->> 'outcome' <> 'removed' OR (v_r ->> 'open_jobs')::int <> 2
       OR NOT (v_r ->> 'elenco_link_rotation_advised')::boolean THEN
        RAISE EXCEPTION 'A13: remover com turnos abertos nao devolveu removed + aviso de rotacao: %.', v_r; END IF;
    v_r := public.remove_company_member(v_company, v_inv, false);                 -- L1: idempotente
    IF v_r ->> 'outcome' <> 'removed' OR NOT COALESCE((v_r ->> 'already_removed')::boolean, false) THEN
        RAISE EXCEPTION 'L1: remover de novo nao devolveu removed + already_removed: %.', v_r; END IF;
    IF public.remove_company_member(v_company, gen_random_uuid(), false) ->> 'outcome' <> 'not_found' THEN
        RAISE EXCEPTION 'A13: remover quem nunca foi membro nao devolveu not_found.'; END IF;

    PERFORM pg_temp.as_server();
    IF NOT EXISTS (SELECT 1 FROM public.company_members
                    WHERE id = v_mid_ana AND status = 'removed' AND removed_at IS NOT NULL
                      AND invite_token IS NULL AND display_name = 'Ana QA') THEN
        RAISE EXCEPTION 'A13: linha removida sem removed_at/display_name preservado.'; END IF;
    SELECT count(*) INTO v_n FROM public.jobs
     WHERE id IN (v_job1, v_job2) AND responsible_id = v_inv AND status <> 'deleted';
    IF v_n <> 2 THEN RAISE EXCEPTION 'A13: remocao reescreveu jobs (% de 2 intactos).', v_n; END IF;
    SELECT count(*) INTO v_n FROM public.team_connections WHERE company_id = v_company;
    IF v_n <> v_n1 THEN RAISE EXCEPTION 'A13b: Elenco mudou na remocao (% -> %).', v_n1, v_n; END IF;
    -- o freela que o encarregado trouxe PERMANECE, com company_id da empresa e invited_by = a pessoa
    IF NOT EXISTS (SELECT 1 FROM public.team_connections
                    WHERE company_id = v_company AND worker_id = v_wk2 AND status = 'pending'
                      AND invited_by = v_inv) THEN
        RAISE EXCEPTION 'A13b: o freela trazido pelo encarregado saiu junto (ou perdeu o rastro).'; END IF;
    IF EXISTS (SELECT 1 FROM public.team_connections WHERE company_id = v_inv) THEN
        RAISE EXCEPTION 'A13b: existe team_connections com company_id = uid da pessoa.'; END IF;
    -- chamado aberto continua aberto (nada foi cancelado/migrado na remocao)
    IF v_sc_ok AND NOT EXISTS (SELECT 1 FROM public.shift_calls WHERE job_id = v_job1 AND status = 'open') THEN
        RAISE EXCEPTION 'A13: a remocao mexeu no chamado aberto.'; END IF;

    PERFORM pg_temp.as_user(v_inv);                          -- removido: corte no proximo request
    IF public.is_job_owner(v_job1) OR public.is_company_member(v_company) THEN
        RAISE EXCEPTION 'A13: removido ainda opera.'; END IF;
    SELECT count(*) INTO v_n FROM public.team_connections WHERE company_id = v_company;
    IF v_n <> 0 THEN RAISE EXCEPTION 'A13: removido le o Elenco.'; END IF;
    SELECT count(*) INTO v_n FROM public.get_my_companies();
    IF v_n <> 0 THEN RAISE EXCEPTION 'A13: get_my_companies do removido devolveu % linhas.', v_n; END IF;
    PERFORM pg_temp.as_user(v_dono);
    IF NOT public.is_job_owner(v_job1) THEN RAISE EXCEPTION 'A16: Gestor nao opera turno de responsavel removido.'; END IF;

    -- ============ re-convite de quem foi removido ==================================================
    v_r := public.invite_company_member(v_company, 'Ana QA', 'encarregado');
    IF v_r ->> 'outcome' <> 'invited' OR (v_r ->> 'member_id')::uuid = v_mid_ana
       OR v_r ->> 'invite_token' = v_tok_ana THEN
        RAISE EXCEPTION 'R11: re-convite de removido nao criou linha/token novos: %.', v_r; END IF;
    v_tok_ana2 := v_r ->> 'invite_token';  v_mid_ana2 := (v_r ->> 'member_id')::uuid;
    PERFORM pg_temp.as_user(v_inv2);
    IF public.accept_company_member_invite(v_tok_ana, true) ->> 'outcome' <> 'revoked' THEN
        RAISE EXCEPTION 'A9: link antigo de pessoa removida deveria ser revoked.'; END IF;
    PERFORM pg_temp.as_user(v_inv);
    IF public.accept_company_member_invite(v_tok_ana2, false) ->> 'outcome' <> 'tos_required' THEN
        RAISE EXCEPTION 'R13: re-aceite sem Termos nao devolveu tos_required.'; END IF;
    v_r := public.accept_company_member_invite(v_tok_ana2, true);
    IF v_r ->> 'outcome' <> 'accepted' THEN RAISE EXCEPTION 'R11: re-aceite falhou: %.', v_r; END IF;
    SELECT * INTO v_gc FROM public.get_my_companies() WHERE company_id = v_company;
    IF v_gc.company_id IS NULL OR v_gc.confirmed OR NOT v_gc.accepted_tos THEN
        RAISE EXCEPTION 'R22/R13: re-aceito deveria voltar nao confirmado e com Termos da nova linha: %.', v_gc; END IF;
    PERFORM pg_temp.as_server();
    SELECT count(*) INTO v_n FROM public.company_members WHERE company_id = v_company AND user_id = v_inv;
    IF v_n <> 2 THEN RAISE EXCEPTION 'R11: esperadas 2 linhas (removida + ativa) para a pessoa, vieram %.', v_n; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.company_members WHERE id = v_mid_ana2 AND status = 'active' AND confirmed_at IS NULL) THEN
        RAISE EXCEPTION 'R22: re-entrada nao voltou a nao confirmada.'; END IF;

    -- ============ A11 / R15: reenvio rotaciona; vencido reabre ===================================
    PERFORM pg_temp.as_user(v_dono);
    v_r := public.resend_member_invite(v_mid_beto);
    IF v_r ->> 'outcome' <> 'resent' OR v_r ->> 'invite_token' = v_tok_beto THEN
        RAISE EXCEPTION 'A11: reenvio nao rotacionou: %.', v_r; END IF;
    v_tok_beto2 := v_r ->> 'invite_token';
    PERFORM pg_temp.as_user(v_inv2);
    IF public.accept_company_member_invite(v_tok_beto, true) ->> 'outcome' <> 'not_found' THEN
        RAISE EXCEPTION 'A11: o token antigo ainda funciona.'; END IF;
    PERFORM pg_temp.as_server();
    UPDATE public.company_members SET expires_at = now() - interval '1 day' WHERE id = v_mid_beto;
    PERFORM pg_temp.as_user(v_inv2);
    IF public.accept_company_member_invite(v_tok_beto2, true) ->> 'outcome' <> 'expired' THEN
        RAISE EXCEPTION 'A9: convite vencido nao devolveu expired.'; END IF;
    PERFORM pg_temp.as_user(v_dono);
    SELECT i INTO v_item FROM jsonb_array_elements(public.list_company_members(v_company) -> 'items') AS i
     WHERE i ->> 'member_id' = v_mid_beto::text;
    IF v_item ->> 'state' <> 'invite_expired' THEN RAISE EXCEPTION 'R15: selo Venceu ausente: %.', v_item; END IF;
    v_r := public.resend_member_invite(v_mid_beto);
    v_tok_beto3 := v_r ->> 'invite_token';
    v_exp := (v_r ->> 'expires_at')::timestamptz;
    IF v_exp < now() + interval '13 days 23 hours' THEN RAISE EXCEPTION 'A11: validade nao renovou (%).', v_exp; END IF;
    PERFORM pg_temp.as_user(v_inv2);
    IF public.accept_company_member_invite(v_tok_beto3, true) ->> 'outcome' <> 'accepted' THEN
        RAISE EXCEPTION 'A11: token novo nao funcionou.'; END IF;
    PERFORM pg_temp.as_server();
    IF EXISTS (SELECT 1 FROM public.companies WHERE id = v_inv2) THEN
        RAISE EXCEPTION 'A8: casca do segundo convidado nao foi removida.'; END IF;

    -- "Revogar" quem entrou e ainda nao foi confirmado
    PERFORM pg_temp.as_user(v_dono);
    IF public.reject_company_member(v_company, v_inv2) ->> 'outcome' <> 'rejected' THEN
        RAISE EXCEPTION 'R22: revogar falhou.'; END IF;
    IF public.confirm_company_member(v_company, v_inv2) ->> 'outcome' <> 'not_found' THEN
        RAISE EXCEPTION 'R22: confirmar quem foi revogado nao devolveu not_found.'; END IF;
    PERFORM pg_temp.as_user(v_inv2);
    SELECT count(*) INTO v_n FROM public.get_my_companies();
    IF v_n <> 0 OR public.is_company_member(v_company) THEN
        RAISE EXCEPTION 'R22: revogado ainda opera/aparece.'; END IF;

    -- ============ revogar convite pendente =========================================================
    PERFORM pg_temp.as_user(v_dono);
    v_r := public.invite_company_member(v_company, 'Dani QA', 'encarregado');
    v_tok_dani := v_r ->> 'invite_token';  v_mid_dani := (v_r ->> 'member_id')::uuid;
    PERFORM pg_temp.as_user(v_inv);
    IF public.revoke_member_invite(v_mid_dani) ->> 'outcome' <> 'forbidden' THEN
        RAISE EXCEPTION 'R11: encarregado revogou convite.'; END IF;
    PERFORM pg_temp.as_user(v_dono);
    IF public.revoke_member_invite(v_mid_dani) ->> 'outcome' <> 'revoked'
       OR public.revoke_member_invite(v_mid_dani) ->> 'outcome' <> 'not_pending' THEN
        RAISE EXCEPTION 'R15: revogar convite pendente.'; END IF;
    PERFORM pg_temp.as_user(v_x);
    IF public.accept_company_member_invite(v_tok_dani, true) ->> 'outcome' <> 'revoked' THEN
        RAISE EXCEPTION 'A9: link revogado nao devolveu revoked.'; END IF;
    -- previa: so token vivo, so empresa + papel
    PERFORM pg_temp.as_user(v_x);
    v_r := public.get_member_invite_preview(v_tok_eva);
    IF v_r ->> 'outcome' <> 'ok' OR v_r ->> 'role' <> 'encarregado'
       OR (SELECT count(*) FROM jsonb_object_keys(v_r)) <> 3 THEN
        RAISE EXCEPTION 'R13: previa deveria ter so outcome/company_name/role: %.', v_r; END IF;
    IF public.get_member_invite_preview(v_tok_dani) ->> 'outcome' <> 'not_found'
       OR public.get_member_invite_preview(v_tok_ana) ->> 'outcome' <> 'not_found' THEN
        RAISE EXCEPTION 'R13: previa respondeu para token queimado/revogado.'; END IF;

    -- ============ Gestor (entrou por invite_company_manager) + LGPD ================================
    -- Gestor NAO entra por link de equipe (H1). Aqui o servidor simula o Gestor ja ativo, com PII, para
    -- exercitar remocao (so dono/operador de organizacao) e a guarda de LGPD (qualquer papel).
    PERFORM pg_temp.as_server();
    PERFORM public.internal_drop_empty_company_shell(v_carla);        -- sem a casca, so a membership segura
    INSERT INTO public.company_members
        (company_id, user_id, role, status, created_by, accepted_at, display_name, accepted_email)
    VALUES (v_company, v_carla, 'manager', 'active', v_dono, now(), 'Carla QA',
            'qa-e4-' || v_tag || '-carla@invalido.local');
    PERFORM pg_temp.as_user(v_mgr);
    IF public.remove_company_member(v_company, v_carla, false) ->> 'outcome' <> 'forbidden' THEN
        RAISE EXCEPTION 'R17: Gestor removeu Gestor (so dono/operador de organizacao remove).'; END IF;
    PERFORM pg_temp.as_user(v_dono);
    v_r := public.remove_company_member(v_company, v_carla, true);
    IF v_r ->> 'outcome' <> 'would_remove' OR v_r ->> 'role' <> 'manager' THEN RAISE EXCEPTION 'R17: dry-run de Gestor: %.', v_r; END IF;

    PERFORM pg_temp.as_server();
    BEGIN       -- Gestor (qualquer papel) com PII ativa NAO pode perder a credencial sem anonimizar
        DELETE FROM auth.users WHERE id = v_carla;
        RAISE EXCEPTION 'guarda nao barrou';
    EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
        IF v_t NOT LIKE 'LGPD:%' THEN RAISE EXCEPTION 'E4/LGPD: a guarda de DELETE nao barrou Gestor com PII (%).', v_t; END IF;
    END;
    BEGIN       -- ...e o encarregado ativo tambem
        DELETE FROM auth.users WHERE id = v_inv;
        RAISE EXCEPTION 'guarda nao barrou';
    EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
        IF v_t NOT LIKE 'LGPD:%' THEN RAISE EXCEPTION 'E4/LGPD: a guarda de DELETE nao barrou encarregado ativo (%).', v_t; END IF;
    END;
    BEGIN       -- anonymize_account limpa a PII de Gestor e a guarda libera (parte dependente de F13)
        PERFORM public.anonymize_account(v_carla);
        IF EXISTS (SELECT 1 FROM public.company_members
                    WHERE user_id = v_carla
                      AND (display_name IS NOT NULL OR accepted_email IS NOT NULL OR status <> 'removed')) THEN
            RAISE EXCEPTION 'E4/LGPD: anonymize_account nao limpou display_name/accepted_email do Gestor.';
        END IF;
        DELETE FROM auth.users WHERE id = v_carla;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
        IF v_t LIKE 'E4/LGPD:%' THEN RAISE EXCEPTION '%', v_t; END IF;
        RAISE NOTICE 'NAO VERIFICADO: anonymize_account/DELETE do Gestor falhou por motivo possivelmente alheio a E4: %', v_t;
    END;

    -- ============ dono unico e conta sem relacao: get_my_companies segue como antes ================
    PERFORM pg_temp.as_user(v_dono);
    SELECT * INTO v_gc FROM public.get_my_companies() WHERE company_id = v_company;
    IF v_gc.company_id IS NULL OR v_gc.role <> 'owner' OR NOT v_gc.confirmed OR NOT v_gc.team_enabled THEN
        RAISE EXCEPTION 'R23: dono com equipe: %.', v_gc; END IF;
    PERFORM pg_temp.as_user(v_x);
    SELECT * INTO v_gc FROM public.get_my_companies();
    IF v_gc.company_id IS NULL OR v_gc.role <> 'owner' OR NOT v_gc.confirmed OR v_gc.team_enabled THEN
        RAISE EXCEPTION 'R23: dono unico sem equipe deveria ter team_enabled=false: %.', v_gc; END IF;
    PERFORM pg_temp.as_user(v_wk);
    SELECT count(*) INTO v_n FROM public.get_my_companies();
    IF v_n <> 0 THEN RAISE EXCEPTION 'E4: freela viu empresas em get_my_companies.'; END IF;

    -- ordem por PODER: quem e dono de uma empresa e encarregado de outra ve a propria primeiro
    -- (ordem alfabetica do texto poria 'encarregado' antes de 'owner')
    PERFORM pg_temp.as_server();
    INSERT INTO public.company_members
        (company_id, user_id, role, status, created_by, accepted_at, display_name, confirmed_at, accepted_tos_at)
    VALUES (v_company, v_x, 'encarregado', 'active', v_dono, now(), 'X QA', now(), now());
    PERFORM pg_temp.as_user(v_x);
    SELECT role INTO v_t FROM public.get_my_companies() OFFSET 0 LIMIT 1;
    IF v_t IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'E4: 1a linha de get_my_companies deveria ser owner, veio %.', v_t; END IF;
    SELECT role INTO v_t FROM public.get_my_companies() OFFSET 1 LIMIT 1;
    IF v_t IS DISTINCT FROM 'encarregado' THEN RAISE EXCEPTION 'E4: 2a linha deveria ser encarregado, veio %.', v_t; END IF;

    PERFORM pg_temp.as_server();
    RAISE NOTICE 'OK: A2, A7, A8, A9, A10, A11, A12, A13, A13b, A16, A24, R11, R13, R14b, R15, R17, R22, R23, G6, LGPD verdes.';
END
$t$;

ROLLBACK;  -- desfaz usuarios, empresas, memberships, turnos, avisos
