-- Migration: Equipe e encarregados, E4 — convites, entrada, confirmacao, remocao e o papel 'encarregado'
-- File: supabase/migrations/20261123000500_equipe_e4_convites_e_papel.sql
-- Spec:  .harness/spec/equipe-encarregados/spec.md (R11, R13, R14b, R15, R17, R22, R23; A7-A13, A24)
-- Gate:  .harness/spec/equipe-encarregados/gate-architect.md (G1, G6, G7, secao D)
-- ADRs:  ADR-20261123-encarregado-confirmado-e-pii, ADR-20261123-remover-pessoa-so-corta-acesso,
--        ADR-20261123-elenco-unico-da-company
--
-- PONTO DE NAO RETORNO: o primeiro aceite real depois desta migration. Antes dele, tudo abaixo e
-- reversivel (DOWN no fim do cabecalho). Depois, existe linha role='encarregado' e o DOWN do CHECK
-- passa a exigir decisao humana.
--
-- O QUE ENTRA (UP)
-- ----------------------------------------------------------------------------
--   0. PORTAO (asserções): E0-E3 aplicadas; C6 (zero role <> manager); nenhum leitor de
--      company_members (funcao, policy, view) ficou sem filtro de papel — a escalada silenciosa que
--      a spec descreve; FKs de companies conhecidas (guarda da casca vazia).
--   1. company_members.invite_token_hash (hash SHA-256 do token QUEIMADO) — ver "CONTRADICAO A8/A9".
--   2. Helpers internos (sem EXECUTE para o client): internal_company_gestor_ids,
--      internal_notify_member_event, internal_drop_empty_company_shell.
--   3. RPCs de convite e entrada:
--        invite_company_member(company, nome, papel)   -> {outcome, member_id, invite_token, expires_at}
--        resend_member_invite(member_id)               -> rotaciona o token, +14 dias
--        revoke_member_invite(member_id)               -> convite pendente vira 'removed'
--        get_member_invite_preview(token)              -> {outcome, company_name, role} (leitura minima)
--        accept_company_member_invite(token, aceita_termos)
--   4. RPCs de equipe: confirm_company_member, reject_company_member, remove_company_member (com
--      p_dry_run), list_company_members (Gestor-only, SEM invite_token na projecao).
--   5. get_my_companies(): DROP + CREATE com role real ('encarregado'), confirmed e team_enabled.
--   6. lgpd_guard_auth_user_delete: ASSERCAO idempotente (a E1 ja trata qualquer papel como perfil
--      vivo; a E4 so confere, nao corrige nada — ver secao 6).
--   7. GRANTs das RPCs de equipe (anon NUNCA, exceto get_member_invite_preview — ADR previa-publica).
--   8. POR ULTIMO: company_members_role_check alargado para ('manager','encarregado').
--   9. Verificacao final (DO) — falha a migration se qualquer invariante nao fechar.
--
-- NO-OP PARA AS 13 CONTAS ATUAIS (company_members esta VAZIA, verificado 23/11/2026): nenhuma funcao
-- nova e chamada por codigo existente; o CHECK alargado nao altera linha nenhuma; get_my_companies
-- devolve para dono/operador exatamente as mesmas 7 primeiras colunas (+ confirmed=true,
-- team_enabled=false). Esta migration NAO cria trigger nenhum; logo nao ha o que atravessar para
-- sessao nula (cron/service_role). As RPCs novas respondem 'unauthenticated' a sessao nula.
--
-- CONTRADICAO A8/A9 DA SPEC (resolvida aqui): A8 pede "token anulado" no aceite; A9 pede
-- `token_already_used` para a segunda pessoa e `revoked` para link revogado. Com o token em NULL, as
-- duas respostas sao inalcancaveis (o lookup nao acha a linha) e um retry do MESMO usuario cairia em
-- `not_found` em vez de `already_accepted`. E o mesmo codigo morto que accept_manager_invite ja
-- carrega. Solucao: no aceite/revogacao o token vai a NULL e grava-se so o HASH dele. O lookup casa
-- por token vivo OU por hash. O hash de um token queimado nao concede nada (nao e credencial).
--
-- GESTOR NAO ENTRA POR ESTE CAMINHO (H1 de seguranca): o gate R22 (confirmed_at) so corta o acesso
-- do ENCARREGADO; um Gestor aceito por link entraria `active` com acesso pleno (o seam so olha
-- role='manager' + active). Logo invite_company_member so aceita p_role='encarregado' e
-- accept_company_member_invite recusa linha role='manager' (outcome use_manager_invite, sem ativar).
-- Gestor segue entrando SO por invite_company_manager (e-mail) + accept_manager_invite.
--
-- SEGURANCA / REGRAS (D1-D5 do gate)
--   * Nenhum predicado NOVO com company_id/owner_id = auth.uid(). Unica ocorrencia textual: o
--     get_my_companies PRESERVA os predicados de dono do baseline (20260818100300), porque ele e o
--     proprio resolvedor do seam. Toda decisao de acesso aqui passa por is_company_owner /
--     is_organization_operator / is_company_member_confirmed.
--   * Toda RPC DEFINER com SET search_path = ''; REVOKE FROM PUBLIC, anon; GRANT authenticated,
--     service_role (helpers internos: so service_role). UNICA excecao com anon:
--     get_member_invite_preview (ADR-20261123-previa-publica-do-convite), com assert no fim. Nenhuma aceita "por qual usuario perguntar".
--   * invite_token so sai de invite_company_member / resend_member_invite, para quem convidou. A
--     listagem nao o devolve. (Org operator ainda le a coluna por SELECT direto pela policy
--     cm_select_self_or_operator: e quem emite; nao e novo.)
--   * Article 8: nada aqui toca wallets / escrow_transactions / wallet_transactions / shift_payments.
--
-- DOWN (rollback) — seguro enquanto NAO existir company_members.role = 'encarregado' (aborte e
-- decida se existir). Ordem:
--   1. restaurar o CHECK:
--        DO $d$ BEGIN
--          IF EXISTS (SELECT 1 FROM public.company_members WHERE role <> 'manager') THEN
--            RAISE EXCEPTION 'DOWN E4: ha role <> manager; decidir antes de restaurar o CHECK'; END IF;
--        END $d$;
--        ALTER TABLE public.company_members DROP CONSTRAINT company_members_role_check;
--        ALTER TABLE public.company_members ADD CONSTRAINT company_members_role_check CHECK (role = 'manager');
--   2. lgpd_guard_auth_user_delete: NADA a reverter (a E4 nao altera a funcao; so asserta que a E1
--      ja a deixou cobrindo qualquer papel).
--   3. get_my_companies: DROP FUNCTION public.get_my_companies(); e recriar a versao de 7 colunas:
--        CREATE FUNCTION public.get_my_companies() RETURNS TABLE (company_id uuid, company_name text,
--          role text, organization_id uuid, organization_name text, onboarding_completed boolean,
--          accepted_tos boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
--          SELECT c.id, c.name,
--                 CASE WHEN c.owner_id = (SELECT auth.uid()) OR c.id = (SELECT auth.uid()) THEN 'owner'
--                      WHEN EXISTS (SELECT 1 FROM public.organization_members om
--                                    WHERE om.organization_id = c.organization_id
--                                      AND om.user_id = (SELECT auth.uid()) AND om.status = 'active')
--                           THEN 'operator' ELSE 'manager' END,
--                 c.organization_id, o.name, COALESCE(c.onboarding_completed, false),
--                 COALESCE(c.accepted_tos, false)
--            FROM public.companies c LEFT JOIN public.organizations o ON o.id = c.organization_id
--           WHERE (SELECT auth.uid()) IS NOT NULL
--             AND ( c.owner_id = (SELECT auth.uid()) OR c.id = (SELECT auth.uid())
--                OR EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.company_id = c.id
--                            AND cm.user_id = (SELECT auth.uid()) AND cm.status = 'active'
--                            AND cm.role = 'manager')
--                OR EXISTS (SELECT 1 FROM public.organization_members om2
--                            WHERE om2.organization_id = c.organization_id
--                              AND om2.user_id = (SELECT auth.uid()) AND om2.status = 'active'
--                              AND om2.role IN ('owner', 'operator')))
--           ORDER BY 3, 2; $f$;
--        REVOKE ALL ON FUNCTION public.get_my_companies() FROM PUBLIC, anon;
--        GRANT EXECUTE ON FUNCTION public.get_my_companies() TO authenticated, service_role;
--   4. DROP FUNCTION IF EXISTS public.get_member_invite_preview(text);
--      DROP FUNCTION IF EXISTS public.accept_company_member_invite(text, boolean);
--      DROP FUNCTION IF EXISTS public.list_company_members(uuid, boolean);
--      DROP FUNCTION IF EXISTS public.remove_company_member(uuid, uuid, boolean);
--      DROP FUNCTION IF EXISTS public.reject_company_member(uuid, uuid);
--      DROP FUNCTION IF EXISTS public.confirm_company_member(uuid, uuid);
--      DROP FUNCTION IF EXISTS public.revoke_member_invite(uuid);
--      DROP FUNCTION IF EXISTS public.resend_member_invite(uuid);
--      DROP FUNCTION IF EXISTS public.invite_company_member(uuid, text, text);
--      DROP FUNCTION IF EXISTS public.internal_drop_empty_company_shell(uuid);
--      DROP FUNCTION IF EXISTS public.internal_notify_member_event(uuid, text, text, text);
--      DROP FUNCTION IF EXISTS public.internal_company_gestor_ids(uuid);
--   5. DROP INDEX IF EXISTS public.idx_company_members_invite_token_hash;
--      ALTER TABLE public.company_members DROP COLUMN IF EXISTS invite_token_hash;

-- ============================================================================
-- 0. PORTAO — o catalogo precisa ser o que esta migration espera (D4/D5 do gate)
-- ============================================================================
DO $mig$
DECLARE
    r         record;
    v_def     text;
    v_n       integer;
    v_unknown text;
BEGIN
    -- (a) objetos de E0-E3 e da F13 de que esta migration depende
    FOR r IN SELECT unnest(ARRAY[
        'public.session_company_member_role(uuid)',
        'public.session_company_member_confirmed(uuid)',
        'public.is_company_member(uuid)',
        'public.is_company_member_confirmed(uuid)',
        'public.internal_company_active_operator(uuid, uuid)',
        'public.internal_company_confirmed_operator(uuid, uuid)',
        'public.session_can_operate_job(uuid, uuid, date)',
        'public.notification_recipients_for_job(uuid)',
        'public.jobs_responsible_guard()',
        'public.jobs_soft_delete_guard()',
        'public.team_connections_invited_by_guard()',
        'public.get_shift_worker_payment_card(uuid)',
        'public.count_worker_shifts_by_week(uuid[], uuid, date, date)',
        'public.generate_invite_token()',
        'public.is_organization_operator(uuid)',
        'public.company_organization_id(uuid)',
        'public.anonymize_account(uuid)',
        'public.lgpd_guard_auth_user_delete()',
        'public.get_my_companies()'
    ]) AS sig
    LOOP
        IF to_regprocedure(r.sig) IS NULL THEN
            RAISE EXCEPTION 'ASSERCAO E4: % ausente no catalogo. Aplicar E0-E3 (20261123000100..400) antes. HALT.', r.sig;
        END IF;
    END LOOP;

    -- (b) colunas de E1
    SELECT count(*) INTO v_n FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'company_members'
       AND column_name IN ('display_name','accepted_tos_at','confirmed_at','confirmed_by','accepted_email','removed_at');
    IF v_n <> 6 THEN
        RAISE EXCEPTION 'ASSERCAO E4: company_members tem % de 6 colunas de E1. E1 nao aplicada. HALT.', v_n;
    END IF;

    -- (c) E0: o ramo company_members do seam filtra o papel
    IF position('cm.role = ''manager''' IN pg_get_functiondef('public.session_operates_company_membership(uuid)'::regprocedure)) = 0 THEN
        RAISE EXCEPTION 'ASSERCAO E4: session_operates_company_membership nao exige role = manager (E0). Alargar o CHECK abriria escalada silenciosa. HALT.';
    END IF;

    -- (d) E2: is_job_owner delega ao calculo por pessoa; a guarda not_confirmed existe
    IF position('session_can_operate_job' IN pg_get_functiondef('public.is_job_owner(uuid)'::regprocedure)) = 0 THEN
        RAISE EXCEPTION 'ASSERCAO E4: is_job_owner nao usa session_can_operate_job (E2). HALT.';
    END IF;
    v_def := pg_get_functiondef('public.count_worker_shifts_by_week(uuid[], uuid, date, date)'::regprocedure);
    IF position('not_confirmed' IN v_def) = 0 OR position('get_my_companies' IN v_def) = 0 THEN
        RAISE EXCEPTION 'ASSERCAO E4: count_worker_shifts_by_week sem a guarda not_confirmed via get_my_companies (E2). HALT.';
    END IF;

    -- (e) E3: policy de INSERT do Elenco e trigger de soft delete
    IF NOT EXISTS (SELECT 1 FROM pg_policies p
                    WHERE p.schemaname = 'public' AND p.tablename = 'team_connections'
                      AND p.policyname = 'tc_insert_company'
                      AND strpos(coalesce(p.with_check, ''), 'is_company_member_confirmed') > 0) THEN
        RAISE EXCEPTION 'ASSERCAO E4: tc_insert_company nao usa is_company_member_confirmed (E3). HALT.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_jobs_soft_delete_guard' AND NOT t.tgisinternal) THEN
        RAISE EXCEPTION 'ASSERCAO E4: trg_jobs_soft_delete_guard ausente (E3). HALT.';
    END IF;

    -- (f) G7/E1: o UNIQUE (company_id, user_id) e PARCIAL e exclui 'removed' (re-convite)
    IF NOT EXISTS (SELECT 1 FROM pg_indexes i
                    WHERE i.schemaname = 'public' AND i.indexname = 'uq_company_members_company_user'
                      AND strpos(i.indexdef, 'removed') > 0) THEN
        RAISE EXCEPTION 'ASSERCAO E4: uq_company_members_company_user nao exclui status removed (G7/E1). Re-convidar quem foi removido violaria o UNIQUE. HALT.';
    END IF;

    -- (g) escalada silenciosa: NENHUM leitor de company_members pode ficar sem tratar o papel.
    --     Funcao (mesmo criterio da auditoria 1.7 do teste E0-E3). Lista branca = funcoes que tratam
    --     o papel por outro caminho, declaradas nas migrations E0-E3.
    --     Heuristica: a PALAVRA `role` (limite de palavra POSIX, sem barra invertida): `primary_role`,
    --     `service_role` e `session_company_member_role` NAO contam como tratamento de papel. A busca
    --     por `company_members` tambem e por PALAVRA: "company_membership" CONTEM "company_members"
    --     + "hip", e o strpos puro deu falso positivo em is_company_owner (que cita
    --     session_operates_company_membership) no dry-run de producao.
    --     can_review_for_job (E0) fica na lista branca por justificativa explicita: delega a
    --     is_job_owner (o seam); nao le a tabela de membros por conta propria.
    SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_unknown
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND pg_get_functiondef(p.oid) ~ '[[:<:]]company_members[[:>:]]'
       AND pg_get_functiondef(p.oid) !~ '[[:<:]]role[[:>:]]'
       AND p.proname <> ALL (ARRAY['anonymize_account', 'lgpd_guard_auth_user_delete',
                                   'internal_company_active_operator', 'session_company_member_confirmed',
                                   -- E0: delega a is_job_owner (seam); sem leitura propria de membros
                                   'can_review_for_job',
                                   -- E4 (reaplicacao): so confere se a casca esta vazia; nao concede acesso
                                   'internal_drop_empty_company_shell']);
    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION
          'ASSERCAO E4: funcao(oes) leem company_members sem tratar papel: %. Com o CHECK alargado o encarregado herdaria acesso por aqui. HALT -> architect.', v_unknown;
    END IF;

    --     Policy de OUTRA tabela que referencie company_members sem papel.
    SELECT string_agg(p.tablename || '.' || p.policyname, ', ') INTO v_unknown
      FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename <> 'company_members'
       AND (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ '[[:<:]]company_members[[:>:]]'
       AND (coalesce(p.qual, '') || coalesce(p.with_check, '')) !~ '[[:<:]]role[[:>:]]';
    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION 'ASSERCAO E4: policy(ies) leem company_members sem papel: %. HALT -> architect.', v_unknown;
    END IF;

    --     View que referencie company_members.
    SELECT string_agg(v.viewname, ', ') INTO v_unknown
      FROM pg_views v
     WHERE v.schemaname = 'public' AND v.definition ~ '[[:<:]]company_members[[:>:]]';
    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION 'ASSERCAO E4: view(s) leem company_members: %. Classificar antes de alargar o CHECK. HALT.', v_unknown;
    END IF;
END
$mig$;

-- ============================================================================
-- 1. invite_token_hash — memoria de token QUEIMADO (resolve a contradicao A8/A9)
-- ============================================================================
ALTER TABLE public.company_members
    ADD COLUMN IF NOT EXISTS invite_token_hash text;

CREATE INDEX IF NOT EXISTS idx_company_members_invite_token_hash
    ON public.company_members (invite_token_hash) WHERE invite_token_hash IS NOT NULL;

COMMENT ON COLUMN public.company_members.invite_token_hash IS
    'SHA-256 (hex) do invite_token no momento em que ele foi queimado (aceite ou revogacao). NAO e '
    'credencial: serve so para responder token_already_used / revoked / already_accepted em vez de '
    'not_found (A9 da spec equipe-encarregados). Rotacao de token (reenvio) NAO grava hash: o link '
    'antigo morre como not_found. Equipe e encarregados (E4).';

-- ============================================================================
-- 2. HELPERS INTERNOS (sem EXECUTE para authenticated/anon)
-- ============================================================================

-- 2.1 Gestores da empresa: dono + managers ativos + operadores da organizacao dona. O mesmo conjunto
--     de notification_recipients_for_job (E2), sem o responsavel de turno (aqui nao ha turno).
CREATE OR REPLACE FUNCTION public.internal_company_gestor_ids(p_company_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT COALESCE(c.owner_id, c.id)
      FROM public.companies c
     WHERE c.id = p_company_id
    UNION
    SELECT cm.user_id
      FROM public.company_members cm
     WHERE cm.company_id = p_company_id
       AND cm.status = 'active'
       AND cm.role   = 'manager'
       AND cm.user_id IS NOT NULL
    UNION
    SELECT om.user_id
      FROM public.organization_members om
      JOIN public.companies c2 ON c2.organization_id = om.organization_id
     WHERE c2.id = p_company_id
       AND om.status = 'active'
       AND om.role IN ('owner', 'operator')
       AND om.user_id IS NOT NULL;
$fn$;

COMMENT ON FUNCTION public.internal_company_gestor_ids(uuid) IS
    'INTERNA. Uuids dos Gestores da empresa (dono, manager ativo, operador da organizacao dona), sem '
    'duplicar. Sem EXECUTE para authenticated/anon: devolveria uuid de pessoas da empresa. Usada pelas '
    'RPCs de equipe (E4) para avisar "fulano entrou".';

-- 2.2 Aviso best-effort: falha de notificacao nunca derruba o convite/aceite, mas NAO e engolida em
--     silencio (RAISE WARNING, licao de 20260824000900).
CREATE OR REPLACE FUNCTION public.internal_notify_member_event(
    p_user_id uuid,
    p_title   text,
    p_message text,
    p_link    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    IF p_user_id IS NULL THEN
        RETURN;
    END IF;
    INSERT INTO public.notifications (user_id, type, title, message, link, read_at, created_at)
    VALUES (p_user_id, 'status_change', p_title, p_message, p_link, NULL, now());
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'internal_notify_member_event engoliu um erro (%): %', SQLSTATE, SQLERRM;
END;
$fn$;

COMMENT ON FUNCTION public.internal_notify_member_event(uuid, text, text, text) IS
    'INTERNA. Insere notificacao (type status_change) para a pessoa; falha vira WARNING, nunca excecao. '
    'Aceita uid de terceiro, por isso SEM EXECUTE para authenticated/anon.';

-- 2.3 Casca vazia de companies que handle_new_user cria para todo signup 'hire'. Equivale ao DELETE de
--     accept_manager_invite (20260822000300), com a lista EXAUSTIVA de dependentes atualizada para o
--     que nasceu depois: shift_calls (20260823000500), company_tags e responsibility_coverages (E1).
--     company_invite_links tem ON DELETE CASCADE e nasce vazia na casca; fica fora de proposito.
DO $mig$
DECLARE
    v_classified text[] := ARRAY[
        'public.jobs', 'public.team_connections', 'public.shift_payments', 'public.company_members',
        'public.team_lists', 'public.job_series', 'public.payment_methods', 'public.company_spend_limits',
        'public.company_monthly_revenue', 'public.worker_trainings', 'public.worker_certifications',
        'public.worker_company_badge_prefs', 'public.worker_referrals', 'public.service_terms',
        'public.shift_calls', 'public.company_invite_links', 'public.company_tags',
        'public.responsibility_coverages'
    ];
    v_unknown text;
BEGIN
    -- Nome montado de pg_namespace/pg_class (regclass::text omite o schema do search_path — licao de
    -- 20260821001100).
    SELECT string_agg(DISTINCT format('%I.%I', ns.nspname, cl.relname), ', ') INTO v_unknown
      FROM pg_constraint con
      JOIN pg_class cl      ON cl.oid = con.conrelid
      JOIN pg_namespace ns  ON ns.oid = cl.relnamespace
     WHERE con.contype = 'f'
       AND con.confrelid = 'public.companies'::regclass
       AND format('%I.%I', ns.nspname, cl.relname) <> ALL (v_classified);
    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION
          'ASSERCAO E4: tabelas dependentes de companies NAO classificadas na guarda da casca vazia: %. HALT -> architect.', v_unknown;
    END IF;
END
$mig$;

CREATE OR REPLACE FUNCTION public.internal_drop_empty_company_shell(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_n integer;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN 0;
    END IF;

    DELETE FROM public.companies c
     WHERE c.id = p_user_id
       AND COALESCE(c.onboarding_completed, false) = false
       AND NOT EXISTS (SELECT 1 FROM public.jobs                       j    WHERE j.company_id    = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.team_connections           tc   WHERE tc.company_id   = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.shift_payments             sp   WHERE sp.company_id   = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.company_members            cm   WHERE cm.company_id   = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.team_lists                 tl   WHERE tl.company_id   = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.job_series                 js   WHERE js.company_id   = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.payment_methods            pm   WHERE pm.company_id   = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.company_spend_limits       csl  WHERE csl.company_id  = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.company_monthly_revenue    cmr  WHERE cmr.company_id  = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.worker_trainings           wt   WHERE wt.company_id   = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.worker_certifications      wc   WHERE wc.verified_by_company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.worker_company_badge_prefs wcbp WHERE wcbp.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.worker_referrals           wr
                        WHERE wr.referring_company_id = c.id OR wr.requesting_company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.service_terms              st   WHERE st.company_id   = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.shift_calls                sc   WHERE sc.company_id   = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.company_tags               ct   WHERE ct.company_id   = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.responsibility_coverages   rc   WHERE rc.company_id   = c.id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$fn$;

COMMENT ON FUNCTION public.internal_drop_empty_company_shell(uuid) IS
    'INTERNA. Apaga a casca de companies (id = pessoa, onboarding_completed=false) que handle_new_user '
    'cria para todo signup hire, SO se estiver completamente vazia (17 NOT EXISTS: as 14 de '
    '20260821001100 + shift_calls, company_tags, responsibility_coverages). Chamada no aceite do convite '
    'de equipe: quem entra como membro nao carrega uma "empresa" fantasma que o mandaria ao onboarding '
    'de CNPJ. Aceita uid como parametro, por isso SEM EXECUTE para authenticated/anon.';

REVOKE ALL ON FUNCTION public.internal_company_gestor_ids(uuid)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.internal_notify_member_event(uuid, text, text, text)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.internal_drop_empty_company_shell(uuid)                 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_company_gestor_ids(uuid)                    TO service_role;
GRANT EXECUTE ON FUNCTION public.internal_notify_member_event(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.internal_drop_empty_company_shell(uuid)              TO service_role;

-- ============================================================================
-- 3. RPCs DE CONVITE E ENTRADA
-- ============================================================================

-- 3.1 invite_company_member (R11)
--     SO Encarregado: qualquer Gestor (is_company_owner) convida. Gestor NAO entra por link (H1);
--     p_role='manager' e invalid_input. Encarregado nunca convida. Idempotente por (empresa, nome
--     sem caixa, papel) pendente.
CREATE OR REPLACE FUNCTION public.invite_company_member(
    p_company_id   uuid,
    p_display_name text,
    p_role         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid     uuid := auth.uid();
    v_name    text := btrim(COALESCE(p_display_name, ''));
    v_row     public.company_members;
    v_token   text;
    v_id      uuid;
    v_exp     timestamptz;
    v_cn      text;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL
       OR p_role IS DISTINCT FROM 'encarregado'
       OR length(v_name) < 1 OR length(v_name) > 80
       OR v_name ~ '[[:cntrl:]]' THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    PERFORM 1 FROM public.companies c WHERE c.id = p_company_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- Convite pendente para o mesmo (nome, papel): devolve o vigente; vencido e reemitido.
    SELECT * INTO v_row FROM public.company_members cm
     WHERE cm.company_id = p_company_id
       AND cm.status = 'invited'
       AND cm.role = p_role
       AND cm.display_name IS NOT NULL
       AND lower(btrim(cm.display_name)) = lower(v_name)
     FOR UPDATE;

    IF v_row.id IS NOT NULL THEN
        IF v_row.expires_at IS NOT NULL AND v_row.expires_at > now() THEN
            RETURN jsonb_build_object('outcome', 'already_invited', 'member_id', v_row.id,
                                      'invite_token', v_row.invite_token, 'expires_at', v_row.expires_at);
        END IF;
        v_token := public.generate_invite_token();
        UPDATE public.company_members
           SET invite_token = v_token,
               expires_at   = now() + interval '14 days'
         WHERE id = v_row.id
        RETURNING expires_at INTO v_exp;
        RETURN jsonb_build_object('outcome', 'reinvited', 'member_id', v_row.id,
                                  'invite_token', v_token, 'expires_at', v_exp);
    END IF;

    v_token := public.generate_invite_token();
    BEGIN
        INSERT INTO public.company_members
            (company_id, user_id, role, status, display_name, invite_token, expires_at, created_by)
        VALUES
            (p_company_id, NULL, p_role, 'invited', v_name, v_token, now() + interval '14 days', v_uid)
        RETURNING id, expires_at INTO v_id, v_exp;
    EXCEPTION WHEN unique_violation THEN
        -- corrida: so o indice de (empresa, nome, papel) e tratado; qualquer outra violacao sobe.
        GET STACKED DIAGNOSTICS v_cn = CONSTRAINT_NAME;
        IF v_cn IS DISTINCT FROM 'uq_company_members_invited_name_role' THEN
            RAISE;
        END IF;
        SELECT * INTO v_row FROM public.company_members cm
         WHERE cm.company_id = p_company_id AND cm.status = 'invited' AND cm.role = p_role
           AND cm.display_name IS NOT NULL AND lower(btrim(cm.display_name)) = lower(v_name);
        RETURN jsonb_build_object('outcome', 'already_invited', 'member_id', v_row.id,
                                  'invite_token', v_row.invite_token, 'expires_at', v_row.expires_at);
    END;

    RETURN jsonb_build_object('outcome', 'invited', 'member_id', v_id,
                              'invite_token', v_token, 'expires_at', v_exp);
END;
$fn$;

COMMENT ON FUNCTION public.invite_company_member(uuid, text, text) IS
    'Convida ENCARREGADO para a equipe SEM e-mail: nome + papel (so encarregado; manager = '
    'invalid_input, Gestor entra por invite_company_manager), token '
    'aleatorio de 64 hex (generate_invite_token), validade 14 dias. Quem convida: qualquer Gestor '
    '(is_company_owner). Encarregado nunca convida. Idempotente por (empresa, nome sem caixa, papel): devolve o token '
    'vigente; vencido e reemitido. O token so e devolvido a quem convida. Outcomes: invited | '
    'already_invited | reinvited | forbidden | invalid_input | not_found | unauthenticated. R11/A7.';

-- 3.2 resend_member_invite (R15) — rotaciona o token (o link antigo morre como not_found)
CREATE OR REPLACE FUNCTION public.resend_member_invite(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid     uuid := auth.uid();
    v_row     public.company_members;
    v_allowed boolean;
    v_token   text;
    v_exp     timestamptz;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_member_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm WHERE cm.id = p_member_id FOR UPDATE;
    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- Convite de Gestor nao e desta RPC (usa invite_company_manager / revoke_company_manager).
    IF v_row.role <> 'encarregado' THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF NOT public.is_company_owner(v_row.company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    IF v_row.status <> 'invited' THEN
        RETURN jsonb_build_object('outcome', 'not_pending');
    END IF;

    v_token := public.generate_invite_token();
    UPDATE public.company_members
       SET invite_token = v_token,
           expires_at   = now() + interval '14 days'
     WHERE id = v_row.id
    RETURNING expires_at INTO v_exp;

    RETURN jsonb_build_object('outcome', 'resent', 'member_id', v_row.id,
                              'invite_token', v_token, 'expires_at', v_exp);
END;
$fn$;

COMMENT ON FUNCTION public.resend_member_invite(uuid) IS
    'Reenvia convite PENDENTE (vigente ou vencido): gera token novo, o antigo morre (not_found), e '
    'renova a validade para +14 dias. Quem pode: o mesmo que convidaria aquele papel. Devolve o token '
    'novo so a quem reenvia. R15/A11. Outcomes: resent | not_pending | forbidden | not_found | '
    'invalid_input | unauthenticated.';

-- 3.3 revoke_member_invite — convite pendente vira 'removed'; o link revogado responde `revoked`
--     (revoke_company_manager so alcanca gerente com e-mail, desde E0).
CREATE OR REPLACE FUNCTION public.revoke_member_invite(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid     uuid := auth.uid();
    v_row     public.company_members;
    v_allowed boolean;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_member_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm WHERE cm.id = p_member_id FOR UPDATE;
    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_row.role <> 'encarregado' THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF NOT public.is_company_owner(v_row.company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    IF v_row.status <> 'invited' THEN
        RETURN jsonb_build_object('outcome', 'not_pending');
    END IF;

    UPDATE public.company_members
       SET status            = 'removed',
           removed_at        = now(),
           invite_token_hash = CASE WHEN invite_token IS NOT NULL
                                    THEN encode(sha256(convert_to(invite_token, 'UTF8')), 'hex')
                                    ELSE invite_token_hash END,
           invite_token      = NULL
     WHERE id = v_row.id;

    RETURN jsonb_build_object('outcome', 'revoked', 'member_id', v_row.id);
END;
$fn$;

COMMENT ON FUNCTION public.revoke_member_invite(uuid) IS
    'Revoga convite PENDENTE de equipe (status removed, token queimado com hash). Quem pode: o mesmo '
    'que convidaria aquele papel. Nunca DELETE. Outcomes: revoked | not_pending | forbidden | '
    'not_found | invalid_input | unauthenticated.';

-- 3.4 get_member_invite_preview (R13) — leitura minima: empresa + papel + vigencia. NADA mais.
--     ADR-20261123-previa-publica-do-convite: UNICA funcao de E4 com EXECUTE para anon (excecao
--     explicita). Projecao fechada {outcome, company_name, role}; nunca token, hash, e-mail nem nome
--     de pessoa. Token inexistente, queimado, rotacionado, revogado, malformado, de tamanho invalido
--     ou de linha que nao e encarregado = `not_found` GENERICO (indistinguiveis). O formato (64 hex,
--     o que generate_invite_token produz) e checado ANTES da consulta. `expired` so para token VIVO
--     vencido. Nenhum RAISE com detalhe.
--     VOLATILE de proposito (nao STABLE): PostgREST so executa funcao STABLE/IMMUTABLE por GET, e um
--     GET poria o token (segredo) na URL e nos logs de acesso/proxy/CDN. VOLATILE forca POST (corpo).
CREATE OR REPLACE FUNCTION public.get_member_invite_preview(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_tok  text := NULLIF(btrim(COALESCE(p_token, '')), '');
    v_row  public.company_members;
    v_name text;
BEGIN
    IF v_tok IS NULL OR length(v_tok) <> 64 OR v_tok !~ '^[0-9a-f]+$' THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm WHERE cm.invite_token = v_tok;
    IF v_row.id IS NULL OR v_row.status <> 'invited' OR v_row.role <> 'encarregado' THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    SELECT c.name INTO v_name FROM public.companies c WHERE c.id = v_row.company_id;

    RETURN jsonb_build_object(
        'outcome',      CASE WHEN v_row.expires_at IS NOT NULL AND v_row.expires_at <= now()
                             THEN 'expired' ELSE 'ok' END,
        'company_name', v_name,
        'role',         v_row.role
    );
END;
$fn$;

COMMENT ON FUNCTION public.get_member_invite_preview(text) IS
    'Previa do convite para a tela "{Empresa} te convidou como {Papel}": {outcome ok|expired|not_found, '
    'company_name, role}. Nenhum outro dado (nem nome do convidado, nem quem convidou, nem token, hash '
    'ou e-mail). Todo erro (inexistente, queimado, rotacionado, revogado, malformado) = not_found '
    'generico; expired so para token vivo vencido. EXECUTE para anon por EXCECAO unica e explicita '
    '(ADR-20261123-previa-publica-do-convite): a tela publica pre-login precisa dela. R13/A8.';

-- 3.5 accept_company_member_invite (R14b/R13/R22) — generaliza accept_manager_invite
--     A assinatura (text, boolean) nao tem DEFAULT; DROP defensivo da forma de 1 argumento (nao
--     existe em producao; evita overload ambiguo no PostgREST se alguem a tiver criado antes).
DROP FUNCTION IF EXISTS public.accept_company_member_invite(text);
CREATE OR REPLACE FUNCTION public.accept_company_member_invite(
    p_token      text,
    p_accept_tos boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid      uuid := auth.uid();
    v_tok      text := NULLIF(btrim(COALESCE(p_token, '')), '');
    v_hash     text;
    v_row      public.company_members;
    v_existing uuid;
    v_email    text;
    v_verified boolean;
    v_g        uuid;
    v_cn       text;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF v_tok IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    v_hash := encode(sha256(convert_to(v_tok, 'UTF8')), 'hex');

    SELECT * INTO v_row FROM public.company_members cm
     WHERE cm.invite_token = v_tok OR cm.invite_token_hash = v_hash
     FOR UPDATE;

    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- Token JA queimado (achado pelo hash): responde o que aconteceu com ele (A9).
    IF v_row.invite_token IS DISTINCT FROM v_tok THEN
        IF v_row.status = 'active' AND v_row.user_id = v_uid THEN
            RETURN jsonb_build_object('outcome', 'already_accepted',
                                      'company_id', v_row.company_id, 'member_id', v_row.id,
                                      'role', v_row.role, 'confirmed', v_row.confirmed_at IS NOT NULL);
        ELSIF v_row.status = 'active' THEN
            RETURN jsonb_build_object('outcome', 'token_already_used');
        ELSIF v_row.status = 'removed' THEN
            RETURN jsonb_build_object('outcome', 'revoked');
        END IF;
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_row.status <> 'invited' THEN
        RETURN jsonb_build_object('outcome', 'revoked');
    END IF;
    IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    -- Gestor NAO entra por este caminho (H1): sem confirmed_at-gate no seam, um Gestor aceito por
    -- link teria acesso pleno imediato. Fica com invite_company_manager/accept_manager_invite.
    -- Nao ativa nada e nao consome o token.
    IF v_row.role <> 'encarregado' THEN
        RETURN jsonb_build_object('outcome', 'use_manager_invite');
    END IF;

    -- Termos aceitos no gesto do aceite: sem isso o encarregado ficaria preso no TOS gate (sem
    -- RPC que grave accepted_tos_at depois). Nao consome o token.
    IF p_accept_tos IS DISTINCT FROM true THEN
        RETURN jsonb_build_object('outcome', 'tos_required');
    END IF;

    -- Isolamento de papel (Article 1): conta de freela nao vira membro de empresa. Nada e criado.
    IF EXISTS (SELECT 1 FROM public.workers w WHERE w.id = v_uid) THEN
        RETURN jsonb_build_object('outcome', 'worker_cannot_be_manager');
    END IF;

    -- Quem ja opera a empresa como Gestor nao precisa (nem deve) virar membro: nao queima o convite.
    IF public.is_company_owner(v_row.company_id) THEN
        RETURN jsonb_build_object('outcome', 'already_operator');
    END IF;

    -- E-mail verificado do Auth (OTP). Sem e-mail confirmado nao ha "e ele?" que o Gestor consiga
    -- conferir. Leitura de auth.users: precedente 20260822000300 (so id/e-mail da propria sessao,
    -- nunca devolvido ao client alem do que o Gestor ve na lista).
    SELECT lower(btrim(u.email)), (u.email_confirmed_at IS NOT NULL)
      INTO v_email, v_verified
      FROM auth.users u WHERE u.id = v_uid;
    IF v_email IS NULL OR NOT COALESCE(v_verified, false) THEN
        RETURN jsonb_build_object('outcome', 'email_not_verified');
    END IF;

    -- Ja e membro ATIVO desta empresa por OUTRA linha? Queima este convite redundante (sem 23505 cru).
    SELECT cm.id INTO v_existing
      FROM public.company_members cm
     WHERE cm.company_id = v_row.company_id
       AND cm.user_id    = v_uid
       AND cm.status     = 'active'
       AND cm.id <> v_row.id;
    IF v_existing IS NOT NULL THEN
        UPDATE public.company_members
           SET status = 'removed', removed_at = now(), invite_token = NULL, invite_token_hash = v_hash
         WHERE id = v_row.id;
        RETURN jsonb_build_object('outcome', 'already_accepted',
                                  'company_id', v_row.company_id, 'member_id', v_existing);
    END IF;

    BEGIN
        UPDATE public.company_members
           SET user_id           = v_uid,
               status            = 'active',
               accepted_at       = now(),
               accepted_email    = v_email,
               accepted_tos_at   = now(),          -- p_accept_tos = true exigido acima
               confirmed_at      = NULL,           -- R22: ativo, mas NAO confirmado
               confirmed_by      = NULL,
               invite_token      = NULL,           -- token queima no uso...
               invite_token_hash = v_hash          -- ...e fica so o hash (A8/A9)
         WHERE id = v_row.id;
    EXCEPTION WHEN unique_violation THEN
        -- corrida: so o UNIQUE (empresa, pessoa) e tratado; qualquer outra violacao sobe.
        GET STACKED DIAGNOSTICS v_cn = CONSTRAINT_NAME;
        IF v_cn IS DISTINCT FROM 'uq_company_members_company_user' THEN
            RAISE;
        END IF;
        SELECT cm.id INTO v_existing
          FROM public.company_members cm
         WHERE cm.company_id = v_row.company_id AND cm.user_id = v_uid
           AND cm.status = 'active' AND cm.id <> v_row.id;
        UPDATE public.company_members
           SET status = 'removed', removed_at = now(), invite_token = NULL, invite_token_hash = v_hash
         WHERE id = v_row.id;
        RETURN jsonb_build_object('outcome', 'already_accepted',
                                  'company_id', v_row.company_id, 'member_id', v_existing);
    END;

    -- Casca vazia de companies (signup hire): sem ela a pessoa voltaria ao onboarding de CNPJ.
    PERFORM public.internal_drop_empty_company_shell(v_uid);

    -- "{Nome} entrou. E a pessoa certa?" — aos Gestores (dono, managers, operadores da organizacao).
    FOR v_g IN SELECT g FROM public.internal_company_gestor_ids(v_row.company_id) AS g WHERE g <> v_uid
    LOOP
        PERFORM public.internal_notify_member_event(
            v_g,
            'Nova pessoa na equipe',
            -- Sem e-mail na mensagem (minimizacao): o Gestor o ve na lista da equipe. So o NOME que
            -- ele mesmo deu ao convidar. Nota LGPD: anonymize_account apaga notificacoes do TITULAR
            -- (user_id = titular); este aviso mora com o Gestor e mantem o apelido que ele digitou.
            format('%s entrou na equipe como Encarregado. É a pessoa certa? Confirme ou revogue o acesso.',
                   COALESCE(v_row.display_name, 'Alguém')),
            '/company/configuracoes/equipe'
        );
    END LOOP;

    RETURN jsonb_build_object('outcome', 'accepted',
                              'company_id', v_row.company_id, 'member_id', v_row.id,
                              'role', v_row.role, 'confirmed', false);
END;
$fn$;

COMMENT ON FUNCTION public.accept_company_member_invite(text, boolean) IS
    'Aceite do convite de equipe pela sessao autenticada (OTP e frontend/Supabase Auth; aqui o token '
    'liga auth.uid()). SO ENCARREGADO (linha role=manager: use_manager_invite, sem ativar). EXIGE '
    'p_accept_tos = true (tos_required, sem consumir o token). Ativa a membership com confirmed_at NULL '
    '(R22), grava o e-mail VERIFICADO e accepted_tos_at; queima o token (so o hash fica); apaga a casca '
    'vazia de companies; avisa os Gestores. Idempotente para o mesmo usuario (already_accepted). '
    'Outcomes: accepted | already_accepted | already_operator | token_already_used | revoked | expired | '
    'not_found | use_manager_invite | tos_required | worker_cannot_be_manager | email_not_verified | '
    'invalid_input | unauthenticated. R13/R14b/R22/A8-A10.';

-- ============================================================================
-- 4. RPCs DE EQUIPE: confirmar, revogar, remover, listar
-- ============================================================================

-- 4.1 confirm_company_member (R22). Gestor confirma "e a pessoa certa". Quem e Gestor-manager nao
--     confirma a si mesmo; confirmar linha de Gestor exige dono/operador de organizacao.
CREATE OR REPLACE FUNCTION public.confirm_company_member(p_company_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid uuid := auth.uid();
    v_row public.company_members;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR p_user_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;
    IF NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF p_user_id = v_uid THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm
     WHERE cm.company_id = p_company_id AND cm.user_id = p_user_id AND cm.status = 'active'
     FOR UPDATE;
    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_row.role = 'manager'
       AND NOT public.is_organization_operator(public.company_organization_id(p_company_id)) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    IF v_row.confirmed_at IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'already_confirmed', 'member_id', v_row.id);
    END IF;

    UPDATE public.company_members
       SET confirmed_at = now(), confirmed_by = v_uid
     WHERE id = v_row.id;

    PERFORM public.internal_notify_member_event(
        p_user_id,
        'Acesso confirmado',
        'O Gestor confirmou o seu acesso à equipe. Você já pode usar o Elenco.',
        '/company/hoje'
    );

    RETURN jsonb_build_object('outcome', 'confirmed', 'member_id', v_row.id);
END;
$fn$;

COMMENT ON FUNCTION public.confirm_company_member(uuid, uuid) IS
    'Gestor confirma uma pessoa ativa ("e a pessoa certa?"): grava confirmed_at/confirmed_by. So depois '
    'o encarregado le o Elenco e opera turnos (ADR encarregado-confirmado). Confirmar linha de Gestor '
    'exige dono/operador de organizacao; ninguem se confirma sozinho. Outcomes: confirmed | '
    'already_confirmed | forbidden | not_found | invalid_input | unauthenticated. R22/A12.';

-- 4.2 reject_company_member (R22) — "Revogar": so enquanto NAO confirmada (confirmada = remove_*)
CREATE OR REPLACE FUNCTION public.reject_company_member(p_company_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid uuid := auth.uid();
    v_row public.company_members;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR p_user_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;
    IF NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF p_user_id = v_uid THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm
     WHERE cm.company_id = p_company_id AND cm.user_id = p_user_id AND cm.status = 'active'
     FOR UPDATE;
    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_row.role = 'manager'
       AND NOT public.is_organization_operator(public.company_organization_id(p_company_id)) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    IF v_row.confirmed_at IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'not_pending_confirmation', 'member_id', v_row.id);
    END IF;

    UPDATE public.company_members
       SET status = 'removed', removed_at = now(), invite_token = NULL
     WHERE id = v_row.id;

    RETURN jsonb_build_object('outcome', 'rejected', 'member_id', v_row.id);
END;
$fn$;

COMMENT ON FUNCTION public.reject_company_member(uuid, uuid) IS
    'Gestor REVOGA pessoa que entrou e ainda nao foi confirmada: status removed, acesso cessa no '
    'proximo request. Pessoa ja confirmada sai por remove_company_member. Nao toca turno, chamado, '
    'candidatura, pagamento nem Elenco. Outcomes: rejected | not_pending_confirmation | forbidden | '
    'not_found | invalid_input | unauthenticated. R22/A12.';

-- 4.3 remove_company_member (R17) — corta acesso NA HORA; nunca bloqueia; nada e migrado
CREATE OR REPLACE FUNCTION public.remove_company_member(
    p_company_id uuid,
    p_user_id    uuid,
    p_dry_run    boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid        uuid := auth.uid();
    v_row        public.company_members;
    v_open_jobs  integer;
    v_rotate     boolean;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR p_user_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;
    IF NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF p_user_id = v_uid THEN
        RETURN jsonb_build_object('outcome', 'cannot_remove_self');
    END IF;

    -- Dry-run NAO toma lock (nao escreve); so a remocao real trava a linha.
    IF COALESCE(p_dry_run, false) THEN
        SELECT * INTO v_row FROM public.company_members cm
         WHERE cm.company_id = p_company_id AND cm.user_id = p_user_id AND cm.status = 'active';
    ELSE
        SELECT * INTO v_row FROM public.company_members cm
         WHERE cm.company_id = p_company_id AND cm.user_id = p_user_id AND cm.status = 'active'
         FOR UPDATE;
    END IF;
    IF v_row.id IS NULL THEN
        -- Idempotente (L1): quem ja foi removido responde `removed` com already_removed, sem escrever
        -- (em dry-run: `would_remove`, tambem com already_removed). A autorizacao (Gestor da empresa)
        -- ja foi checada acima.
        IF EXISTS (SELECT 1 FROM public.company_members cm
                    WHERE cm.company_id = p_company_id AND cm.user_id = p_user_id
                      AND cm.status = 'removed') THEN
            RETURN jsonb_build_object(
                'outcome', CASE WHEN COALESCE(p_dry_run, false) THEN 'would_remove' ELSE 'removed' END,
                'already_removed', true);
        END IF;
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- Simetria com "Gestor nao convida Gestor": so dono/operador de organizacao remove Gestor.
    IF v_row.role = 'manager'
       AND NOT public.is_organization_operator(public.company_organization_id(p_company_id)) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- Turnos realmente ABERTOS e FUTUROS cujo responsavel registrado e a pessoa: ficam com o Gestor
    -- como responsavel efetivo (R19), sem escrita em jobs. jobs.status so admite open | paused |
    -- deleted (CHECK de 20260822000400): "aberto" = open ou paused; deleted nao conta. So informativo.
    SELECT count(*) INTO v_open_jobs
      FROM public.jobs j
     WHERE j.company_id     = p_company_id
       AND j.responsible_id = p_user_id
       AND j.status        IN ('open', 'paused')
       AND j.start_date    >= now();

    -- Quem estava confirmado (ou e Gestor) pode ter lido o link de convite do Elenco: avisar o Gestor
    -- para rotaciona-lo (B4/B5 de seguranca; rotacionar e manual, nunca automatico).
    v_rotate := (v_row.role = 'manager' OR v_row.confirmed_at IS NOT NULL);

    IF COALESCE(p_dry_run, false) THEN
        RETURN jsonb_build_object('outcome', 'would_remove', 'member_id', v_row.id,
                                  'display_name', v_row.display_name, 'role', v_row.role,
                                  'open_jobs', v_open_jobs,
                                  'elenco_link_rotation_advised', v_rotate);
    END IF;

    UPDATE public.company_members
       SET status = 'removed', removed_at = now(), invite_token = NULL
     WHERE id = v_row.id;

    RETURN jsonb_build_object('outcome', 'removed', 'member_id', v_row.id,
                              'display_name', v_row.display_name, 'role', v_row.role,
                              'open_jobs', v_open_jobs,
                              'elenco_link_rotation_advised', v_rotate);
END;
$fn$;

COMMENT ON FUNCTION public.remove_company_member(uuid, uuid, boolean) IS
    'Remove pessoa ATIVA da equipe: status removed + removed_at, e mais nada. NUNCA e recusada por '
    'turno aberto, chamado, pagamento ou freela trazido por ela; NENHUMA linha de jobs, applications, '
    'shift_*, team_connections ou coberturas e reescrita (ADR remover-pessoa-so-corta-acesso). O corte '
    'e consequencia do seam (membership deixa de ser active). p_dry_run devolve {open_jobs} sem '
    'escrever (copy "N turnos abertos dele ficarao com voce"). elenco_link_rotation_advised=true quando '
    'a pessoa era Gestor ou confirmada: o Gestor deve rotacionar o link do Elenco. Gestor remove '
    'Encarregado; so dono/operador de organizacao remove Gestor. Convite pendente: revoke_member_invite. '
    'open_jobs conta so turnos open/paused e futuros (jobs.status nao tem outro valor aberto). Remover '
    'quem ja foi removido e idempotente: outcome removed + already_removed=true. '
    'Outcomes: removed | would_remove (dry-run) | cannot_remove_self | forbidden | not_found | invalid_input | '
    'unauthenticated. R17/A13.';

-- 4.4 list_company_members — Gestor-only, projecao FECHADA, SEM invite_token (G6)
CREATE OR REPLACE FUNCTION public.list_company_members(
    p_company_id      uuid,
    p_include_removed boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_items jsonb;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    SELECT COALESCE(jsonb_agg(
               jsonb_build_object(
                   'member_id',      cm.id,
                   'user_id',        cm.user_id,
                   'display_name',   cm.display_name,
                   'role',           cm.role,
                   'status',         cm.status,
                   'state',          CASE
                                         WHEN cm.status = 'removed' THEN 'removed'
                                         WHEN cm.status = 'invited'
                                              AND (cm.expires_at IS NULL OR cm.expires_at <= now())
                                              THEN 'invite_expired'
                                         WHEN cm.status = 'invited' THEN 'invited'
                                         WHEN cm.confirmed_at IS NULL THEN 'awaiting_confirmation'
                                         ELSE 'active'
                                     END,
                   'confirmed',      cm.confirmed_at IS NOT NULL,
                   'accepted_email', cm.accepted_email,
                   'invited_at',     cm.invited_at,
                   'expires_at',     cm.expires_at,
                   'accepted_at',    cm.accepted_at,
                   'confirmed_at',   cm.confirmed_at,
                   'removed_at',     cm.removed_at
               )
               ORDER BY (cm.status = 'active' AND cm.confirmed_at IS NULL) DESC,
                        cm.status, lower(cm.display_name), cm.id
           ), '[]'::jsonb)
      INTO v_items
      FROM public.company_members cm
     WHERE cm.company_id = p_company_id
       AND (COALESCE(p_include_removed, false) OR cm.status <> 'removed');

    RETURN jsonb_build_object('outcome', 'ok', 'items', v_items);
END;
$fn$;

COMMENT ON FUNCTION public.list_company_members(uuid, boolean) IS
    'Equipe da empresa para o Gestor (is_company_owner): nome, papel, status, estado derivado '
    '(invited | invite_expired | awaiting_confirmation | active | removed), confirmado e e-mail aceito. '
    'NAO le auth.users (ultimo acesso removido: dado global, minimizacao LGPD). Projecao FECHADA e EXAUSTIVA: NUNCA devolve '
    'invite_token (o token so sai de invite_company_member / resend_member_invite). Encarregado nao '
    'lista a equipe. Dono e operadores de organizacao nao tem linha em company_members e nao aparecem. '
    'G6/R24.';

-- ============================================================================
-- 5. get_my_companies — papel REAL, confirmed e team_enabled (DROP + CREATE: muda o tipo de retorno)
--    Baseline: 20260818100300 + filtro de papel de E0. Os predicados de dono/operador sao PRESERVADOS
--    (a funcao e o resolvedor do seam). O encarregado, confirmado ou nao, passa a aparecer: sem isso
--    a guarda `not_confirmed` de count_worker_shifts_by_week (E2) nao dispara no modo intervalo.
-- ============================================================================
DO $mig$
DECLARE
    v_def text := pg_get_functiondef('public.get_my_companies()'::regprocedure);
    v_dep text;
BEGIN
    IF position('team_enabled' IN v_def) = 0 THEN
        -- baseline esperado: F13 (organization_members + ORDER BY 3, 2) endurecida por E0
        IF position('cm.role = ''manager''' IN v_def) = 0
           OR position('organization_members' IN v_def) = 0
           OR position('ORDER BY 3, 2' IN v_def) = 0 THEN
            RAISE EXCEPTION 'ASSERCAO E4: get_my_companies nao tem o corpo esperado (F13 + E0). Reconferir no catalogo. HALT.';
        END IF;
    END IF;

    -- "nenhuma dependencia registrada": conferido, nao presumido.
    SELECT string_agg(DISTINCT pg_describe_object(d.classid, d.objid, d.objsubid), ', ') INTO v_dep
      FROM pg_depend d
     WHERE d.refclassid = 'pg_proc'::regclass
       AND d.refobjid   = 'public.get_my_companies()'::regprocedure
       AND d.deptype    = 'n';
    IF v_dep IS NOT NULL THEN
        RAISE EXCEPTION 'ASSERCAO E4: objetos dependem de get_my_companies() por pg_depend: %. DROP quebraria. HALT.', v_dep;
    END IF;

    -- Referencias so por texto (plpgsql): informativo. O DROP + CREATE acontece na mesma transacao.
    FOR v_dep IN
        SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname <> 'get_my_companies'
           AND strpos(pg_get_functiondef(p.oid), 'get_my_companies') > 0
    LOOP
        RAISE NOTICE 'E4: % referencia get_my_companies() por texto; as colunas existentes (company_id, ...) permanecem.', v_dep;
    END LOOP;
END
$mig$;

DROP FUNCTION IF EXISTS public.get_my_companies();

CREATE FUNCTION public.get_my_companies()
RETURNS TABLE (
    company_id           uuid,
    company_name         text,
    role                 text,
    organization_id      uuid,
    organization_name    text,
    onboarding_completed boolean,
    accepted_tos         boolean,
    confirmed            boolean,
    team_enabled         boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT b.id,
           b.name,
           CASE
               WHEN b.is_owner          THEN 'owner'
               WHEN b.is_operator       THEN 'operator'
               WHEN b.m_role = 'manager' THEN 'manager'
               ELSE 'encarregado'
           END AS role,
           b.organization_id,
           b.org_name,
           COALESCE(b.onboarding_completed, false),
           -- Article 12 por PESSOA: o encarregado nao herda o aceite de Termos da empresa.
           CASE
               WHEN NOT b.is_owner AND NOT b.is_operator AND b.m_role = 'encarregado'
                   THEN b.m_tos_at IS NOT NULL
               ELSE COALESCE(b.accepted_tos, false) OR b.m_tos_at IS NOT NULL
           END,
           -- Gestor (dono, operador de organizacao, manager) e confirmado por definicao; so o
           -- encarregado depende de confirmed_at (R22).
           (b.is_owner OR b.is_operator OR b.m_role = 'manager' OR b.m_confirmed_at IS NOT NULL),
           -- R23 (divulgacao progressiva): ha ao menos uma pessoa nao removida na equipe. Vale para o
           -- encarregado tambem (a propria linha dele e nao removida).
           b.has_team
      FROM (
            SELECT c.id,
                   c.name,
                   c.organization_id,
                   o.name AS org_name,
                   c.onboarding_completed,
                   c.accepted_tos,
                   COALESCE((c.owner_id = (SELECT auth.uid()) OR c.id = (SELECT auth.uid())), false) AS is_owner,
                   EXISTS (SELECT 1 FROM public.organization_members om
                            WHERE om.organization_id = c.organization_id
                              AND om.user_id = (SELECT auth.uid())
                              AND om.status  = 'active'
                              AND om.role IN ('owner', 'operator')) AS is_operator,
                   mm.m_role,
                   mm.m_confirmed_at,
                   mm.m_tos_at,
                   EXISTS (SELECT 1 FROM public.company_members cx
                            WHERE cx.company_id = c.id AND cx.status <> 'removed') AS has_team
              FROM public.companies c
              LEFT JOIN public.organizations o ON o.id = c.organization_id
              LEFT JOIN LATERAL (
                       SELECT cm.role AS m_role, cm.confirmed_at AS m_confirmed_at,
                              cm.accepted_tos_at AS m_tos_at
                         FROM public.company_members cm
                        WHERE cm.company_id = c.id
                          AND cm.user_id    = (SELECT auth.uid())
                          AND cm.status     = 'active'
                        ORDER BY (cm.role = 'manager') DESC
                        LIMIT 1
                   ) mm ON true
             WHERE (SELECT auth.uid()) IS NOT NULL
           ) b
     WHERE b.is_owner OR b.is_operator OR b.m_role IS NOT NULL
     -- Prioridade EXPLICITA de poder (a primeira linha e a empresa onde a pessoa pode mais), depois
     -- nome. Nao ordena pelo texto do papel (alfabetico poria 'encarregado' antes de 'owner').
     ORDER BY CASE WHEN b.is_owner          THEN 1
                   WHEN b.is_operator       THEN 2
                   WHEN b.m_role = 'manager' THEN 3
                   ELSE 4 END,
              b.name, b.id;
$fn$;

COMMENT ON FUNCTION public.get_my_companies() IS
    'Toda empresa que a SESSAO opera, com o papel efetivo (owner | operator | manager | encarregado), '
    'confirmed (Gestor sempre true; encarregado so apos confirm_company_member) e team_enabled (R23: ha '
    'ao menos uma pessoa nao removida na equipe). SEMPRE sobre auth.uid(). Unico ponto de resolucao de '
    'escopo de empresa do frontend. O encarregado, confirmado ou nao, APARECE aqui — e disso que '
    'depende a guarda not_confirmed de count_worker_shifts_by_week. Prioridade do papel: owner > '
    'operator > manager > encarregado, e e a MESMA ordem das linhas (depois nome). accepted_tos do encarregado e por PESSOA (accepted_tos_at). '
    'E4 de equipe-encarregados (substitui a versao de E0).';

REVOKE ALL ON FUNCTION public.get_my_companies() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_companies() TO authenticated, service_role;

-- ============================================================================
-- 6. LGPD — ASSERCAO (a E4 NAO corrige nada aqui)
--    A E1 (7b, rodada 3) ja deixa lgpd_guard_auth_user_delete tratando QUALQUER papel ativo ou com
--    PII residual (display_name/accepted_email) como perfil vivo, e anonymize_account (E1, bloco 7)
--    anula essa PII para qualquer papel. A E4 so CONFERE, de forma idempotente, que o corpo vigente
--    cobre company_members sem se restringir a 'encarregado' — se alguem aplicar uma E1 antiga, a
--    migration para aqui em vez de corrigir em silencio.
-- ============================================================================
DO $mig$
DECLARE
    v_def text := pg_get_functiondef('public.lgpd_guard_auth_user_delete()'::regprocedure);
BEGIN
    IF v_def !~ '[[:<:]]company_members[[:>:]]' THEN
        RAISE EXCEPTION 'ASSERCAO E4 (LGPD): a guarda nao olha company_members (E1 nao aplicada). HALT.';
    END IF;
    IF position('cm.role = ''encarregado''' IN v_def) > 0 THEN
        RAISE EXCEPTION 'ASSERCAO E4 (LGPD): a guarda ainda restringe company_members a encarregado (E1 antiga). Reaplicar a E1 corrigida. HALT.';
    END IF;
    IF position('display_name' IN pg_get_functiondef('public.anonymize_account(uuid)'::regprocedure)) = 0
       OR position('accepted_email' IN pg_get_functiondef('public.anonymize_account(uuid)'::regprocedure)) = 0 THEN
        RAISE EXCEPTION 'ASSERCAO E4 (LGPD): anonymize_account nao anula display_name/accepted_email (E1). HALT.';
    END IF;
END
$mig$;

-- ============================================================================
-- 7. GRANTS das RPCs de equipe (padrao do projeto; anon NUNCA — exceto get_member_invite_preview,
--    excecao unica e explicita do ADR-20261123-previa-publica-do-convite)
-- ============================================================================
REVOKE ALL ON FUNCTION public.invite_company_member(uuid, text, text)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resend_member_invite(uuid)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_member_invite(uuid)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_member_invite_preview(text)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_company_member_invite(text, boolean)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_company_member(uuid, uuid)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_company_member(uuid, uuid)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_company_member(uuid, uuid, boolean)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_company_members(uuid, boolean)           FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.invite_company_member(uuid, text, text)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resend_member_invite(uuid)                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_member_invite(uuid)                  TO authenticated, service_role;
-- Excecao unica (ADR previa-publica): projecao fechada {outcome, company_name, role}, erro colapsado.
GRANT EXECUTE ON FUNCTION public.get_member_invite_preview(text)             TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_company_member_invite(text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_company_member(uuid, uuid)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_company_member(uuid, uuid)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_company_member(uuid, uuid, boolean)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_company_members(uuid, boolean)         TO authenticated, service_role;

-- ============================================================================
-- 8. POR ULTIMO — alarga company_members_role_check para ('manager', 'encarregado')
--    Condicao D5 do gate: so depois das asserções do portao (secao 0) e de tudo acima. C6 de novo,
--    imediatamente antes: nenhuma linha com papel novo existe ainda (o CHECK vigente nem permite).
--    O nome real do CHECK vem do catalogo (constraint de coluna unica em `role`), nao de suposicao.
-- ============================================================================
DO $mig$
DECLARE
    v_att  smallint;
    v_con  text;
    v_def  text;
BEGIN
    SELECT a.attnum INTO v_att
      FROM pg_attribute a
     WHERE a.attrelid = 'public.company_members'::regclass AND a.attname = 'role' AND NOT a.attisdropped;

    SELECT con.conname, pg_get_constraintdef(con.oid) INTO v_con, v_def
      FROM pg_constraint con
     WHERE con.conrelid = 'public.company_members'::regclass
       AND con.contype  = 'c'
       AND con.conkey   = ARRAY[v_att];

    IF v_def IS NOT NULL AND position('encarregado' IN v_def) > 0 THEN
        RAISE NOTICE 'E4: company_members_role_check ja aceita encarregado; nada a fazer.';
        RETURN;
    END IF;

    -- C6: nenhuma linha fora de 'manager' antes de existir papel novo.
    IF EXISTS (SELECT 1 FROM public.company_members WHERE role <> 'manager') THEN
        RAISE EXCEPTION 'ASSERCAO E4 (C6): existe company_members com role <> manager antes do alargamento. HALT -> architect.';
    END IF;

    IF v_con IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.company_members DROP CONSTRAINT %I', v_con);
    END IF;
    ALTER TABLE public.company_members
        ADD CONSTRAINT company_members_role_check CHECK (role IN ('manager', 'encarregado'));
END
$mig$;

COMMENT ON COLUMN public.company_members.role IS
    'manager = Gestor (rotulo de UI; sem migracao de dados) | encarregado. Consulta entra so em fase '
    'posterior (sem valor dormente no CHECK). session_operates_company_membership exige manager: o '
    'encarregado nunca herda acesso pleno. Alargado em E4 (20261123000500), POR ULTIMO.';

-- ============================================================================
-- 9. VERIFICACAO FINAL — a migration inteira falha se qualquer invariante nao fechar
-- ============================================================================
DO $mig$
DECLARE
    r         record;
    v_bad     text;
BEGIN
    IF position('encarregado' IN (SELECT pg_get_constraintdef(con.oid) FROM pg_constraint con
                                   WHERE con.conrelid = 'public.company_members'::regclass
                                     AND con.conname  = 'company_members_role_check')) = 0 THEN
        RAISE EXCEPTION 'VERIFICACAO E4: company_members_role_check nao aceita encarregado. HALT.';
    END IF;

    -- ADR previa-publica: get_member_invite_preview e a UNICA funcao criada/recriada pela E4 com
    -- EXECUTE para anon (e anon PRECISA tê-lo). Qualquer outra com anon = falha.
    SELECT string_agg(p.proname, ', ') INTO v_bad
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('invite_company_member','resend_member_invite','revoke_member_invite',
                         'accept_company_member_invite','confirm_company_member',
                         'reject_company_member','remove_company_member','list_company_members',
                         'get_my_companies','internal_company_gestor_ids',
                         'internal_notify_member_event','internal_drop_empty_company_shell')
       AND has_function_privilege('anon', p.oid, 'EXECUTE');
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'VERIFICACAO E4: funcao(oes) alem da previa com EXECUTE para anon: %. HALT.', v_bad;
    END IF;
    IF NOT has_function_privilege('anon', 'public.get_member_invite_preview(text)'::regprocedure, 'EXECUTE') THEN
        RAISE EXCEPTION 'VERIFICACAO E4: get_member_invite_preview sem EXECUTE para anon (ADR previa-publica). HALT.';
    END IF;

    -- toda funcao nova: DEFINER, search_path vazio (anon ja conferido acima)
    SELECT string_agg(p.proname, ', ') INTO v_bad
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('invite_company_member','resend_member_invite','revoke_member_invite',
                         'get_member_invite_preview','accept_company_member_invite',
                         'confirm_company_member','reject_company_member','remove_company_member',
                         'list_company_members','get_my_companies','internal_company_gestor_ids',
                         'internal_notify_member_event','internal_drop_empty_company_shell')
       AND ( NOT p.prosecdef
          OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) x WHERE x LIKE 'search_path=%' AND x NOT LIKE '%public%') );
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'VERIFICACAO E4: funcao(oes) sem DEFINER/search_path vazio: %. HALT.', v_bad;
    END IF;

    -- helpers internos nao alcancaveis pelo client
    SELECT string_agg(p.proname, ', ') INTO v_bad
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('internal_company_gestor_ids','internal_notify_member_event','internal_drop_empty_company_shell')
       AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'VERIFICACAO E4: helper(s) interno(s) com EXECUTE para authenticated: %. HALT.', v_bad;
    END IF;

    -- a listagem nao pode carregar o token
    IF strpos(pg_get_functiondef('public.list_company_members(uuid, boolean)'::regprocedure), 'invite_token') > 0 THEN
        RAISE EXCEPTION 'VERIFICACAO E4: list_company_members referencia invite_token. HALT.';
    END IF;

    -- get_my_companies: 9 colunas de saida, na ordem esperada
    IF pg_get_function_result('public.get_my_companies()'::regprocedure)
       NOT LIKE '%accepted_tos boolean, confirmed boolean, team_enabled boolean%' THEN
        RAISE EXCEPTION 'VERIFICACAO E4: get_my_companies sem confirmed/team_enabled. HALT.';
    END IF;

    -- nenhuma decisao nova ancorada em uid cru dentro das funcoes de equipe (get_my_companies e o
    -- resolvedor e preserva o baseline; fica de fora desta checagem de proposito)
    FOR r IN
        SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('invite_company_member','resend_member_invite','revoke_member_invite',
                             'get_member_invite_preview','accept_company_member_invite',
                             'confirm_company_member','reject_company_member','remove_company_member',
                             'list_company_members')
           AND ( pg_get_functiondef(p.oid) ~* 'company_id[[:space:]]*=[[:space:]]*[(]?[[:space:]]*(select[[:space:]]+)?auth[.]uid[(][)]'
              OR pg_get_functiondef(p.oid) ~* 'owner_id[[:space:]]*=[[:space:]]*[(]?[[:space:]]*(select[[:space:]]+)?auth[.]uid[(][)]'
              OR pg_get_functiondef(p.oid) ~* '(company_id|owner_id)[[:space:]]*=[[:space:]]*v_[a-z_]*uid' )
    LOOP
        RAISE EXCEPTION 'VERIFICACAO E4: % ancora empresa em uid cru (auditoria A21). HALT.', r.proname;
    END LOOP;
END
$mig$;

-- ============================================================================
-- VERIFICACAO pos-aplicacao: supabase/tests/equipe_e4_auditoria.sql
--   Parte 1 (read-only, pode rodar em producao): estrutura, grants, projecao sem token, CHECK, guarda.
--   Parte 2 (BEGIN ... ROLLBACK, dados sinteticos): A7-A13, A24, remocao sem bloqueio, re-convite.
-- ============================================================================
