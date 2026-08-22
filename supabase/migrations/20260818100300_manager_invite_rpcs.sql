-- Migration: F13 Fase 3 — RPCs de convite/remocao de gerente e leitura de unidades
-- File: supabase/migrations/20260818100300_manager_invite_rpcs.sql
-- Contrato: .harness/spec/multi-unidade/ddl-aprovado.md §5.4
--
-- Esta e a migration que HABILITA convidar. Enquanto ela nao subir, a Fase 2 e observavelmente
-- um no-op de membership (as duas tabelas ficam vazias). Aplicar SO depois do portao (§6).
--
-- Padrao: toda RPC SECURITY DEFINER + SET search_path = '' + REVOKE PUBLIC/anon + GRANT explicito.
-- Nenhuma delas aceita "por qual usuario perguntar" a nao ser onde a autorizacao ja foi checada.
-- Article 8: nao toca saldo.

-- =============================================
-- 1. Gerador de token (sem dependencia de extensao)
-- =============================================
CREATE OR REPLACE FUNCTION public.generate_invite_token()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
    SELECT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

-- =============================================
-- 2. invite_company_manager — so socio/operador da organizacao convida
-- =============================================
CREATE OR REPLACE FUNCTION public.invite_company_manager(p_company_id uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid   uuid := auth.uid();
    v_org   uuid;
    v_token text;
    v_id    uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_company_id IS NULL OR NULLIF(trim(COALESCE(p_email, '')), '') IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT c.organization_id INTO v_org FROM public.companies c WHERE c.id = p_company_id;
    IF v_org IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- Gerente NAO convida gerente: exige organization_members owner/operator.
    IF NOT public.is_organization_operator(v_org) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- Convite pendente para o mesmo e-mail nesta unidade: devolve o token existente
    -- (idempotente; nao empilha tokens validos para a mesma pessoa).
    SELECT cm.id, cm.invite_token INTO v_id, v_token
      FROM public.company_members cm
     WHERE cm.company_id = p_company_id
       AND cm.status = 'invited'
       AND lower(cm.invited_email) = lower(trim(p_email))
       AND cm.expires_at > now();
    IF v_id IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'already_invited',
                                  'member_id', v_id, 'invite_token', v_token);
    END IF;

    -- Convite vencido para o mesmo e-mail: marca como removido e emite um novo.
    UPDATE public.company_members
       SET status = 'removed'
     WHERE company_id = p_company_id
       AND status = 'invited'
       AND lower(invited_email) = lower(trim(p_email));

    v_token := public.generate_invite_token();

    INSERT INTO public.company_members
        (company_id, user_id, role, status, invited_email, invite_token, expires_at, created_by)
    VALUES
        (p_company_id, NULL, 'manager', 'invited', lower(trim(p_email)), v_token,
         now() + interval '7 days', v_uid)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('outcome', 'invited', 'member_id', v_id, 'invite_token', v_token);
END;
$$;

-- =============================================
-- 3. accept_manager_invite — o gerente ja autenticado amarra o proprio user_id
-- =============================================
CREATE OR REPLACE FUNCTION public.accept_manager_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_row public.company_members;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF NULLIF(trim(COALESCE(p_token, '')), '') IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    SELECT * INTO v_row FROM public.company_members cm
     WHERE cm.invite_token = trim(p_token)
     FOR UPDATE;

    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- Idempotencia: mesmo usuario reaceitando o proprio convite.
    IF v_row.status = 'active' AND v_row.user_id = v_uid THEN
        RETURN jsonb_build_object('outcome', 'already_accepted',
                                  'company_id', v_row.company_id, 'member_id', v_row.id);
    END IF;
    -- NUNCA aceitar em silencio um token ja usado por outra pessoa.
    IF v_row.user_id IS NOT NULL AND v_row.user_id <> v_uid THEN
        RETURN jsonb_build_object('outcome', 'token_already_used');
    END IF;
    IF v_row.status <> 'invited' THEN
        RETURN jsonb_build_object('outcome', 'revoked');
    END IF;
    IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;
    -- Isolamento de papel (Article 1): quem tem perfil de freela nao vira gerente.
    IF EXISTS (SELECT 1 FROM public.workers w WHERE w.id = v_uid) THEN
        RETURN jsonb_build_object('outcome', 'worker_cannot_be_manager');
    END IF;

    UPDATE public.company_members
       SET user_id      = v_uid,
           status       = 'active',
           accepted_at  = now(),
           invite_token = NULL          -- token queima no uso
     WHERE id = v_row.id;

    -- Limpeza da CASCA de companies criada por handle_new_user para o signup user_type='hire'.
    -- Sem isto o gerente carrega uma "empresa" fantasma com onboarding_completed=false e volta
    -- ao loop de onboarding por outro caminho (ver ddl-aprovado.md D4).
    -- Guardas estritas: so remove se estiver COMPLETAMENTE vazia.
    DELETE FROM public.companies c
     WHERE c.id = v_uid
       AND COALESCE(c.onboarding_completed, false) = false
       AND NOT EXISTS (SELECT 1 FROM public.jobs             j  WHERE j.company_id  = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.team_connections tc WHERE tc.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.shift_payments   sp WHERE sp.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.company_members  cm WHERE cm.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.team_lists       tl WHERE tl.company_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.job_series       js WHERE js.company_id = c.id);

    RETURN jsonb_build_object('outcome', 'accepted',
                              'company_id', v_row.company_id, 'member_id', v_row.id);
END;
$$;

-- =============================================
-- 4. revoke_company_manager — remocao SOFT
-- =============================================
CREATE OR REPLACE FUNCTION public.revoke_company_manager(p_company_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_org uuid;
    v_n   integer;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    SELECT c.organization_id INTO v_org FROM public.companies c WHERE c.id = p_company_id;
    IF v_org IS NULL THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF NOT public.is_organization_operator(v_org) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    UPDATE public.company_members
       SET status = 'removed', invite_token = NULL
     WHERE company_id = p_company_id
       AND (user_id = p_user_id OR (p_user_id IS NULL AND user_id IS NULL))
       AND status IN ('invited', 'active');
    GET DIAGNOSTICS v_n = ROW_COUNT;

    -- NUNCA DELETE: o historico de quem operou a unidade e quando fica. jobs / team_connections /
    -- shift_payments criados pelo gerente continuam pertencendo a UNIDADE, intocados.
    RETURN jsonb_build_object('outcome', CASE WHEN v_n > 0 THEN 'revoked' ELSE 'not_found' END,
                              'affected', v_n);
END;
$$;

-- =============================================
-- 5. get_my_companies — o unico ponto de resolucao de escopo do frontend
-- =============================================
CREATE OR REPLACE FUNCTION public.get_my_companies()
RETURNS TABLE (
    company_id           uuid,
    company_name         text,
    role                 text,
    organization_id      uuid,
    organization_name    text,
    onboarding_completed boolean,
    accepted_tos         boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT c.id,
           c.name,
           CASE
               WHEN c.owner_id = (SELECT auth.uid()) OR c.id = (SELECT auth.uid()) THEN 'owner'
               WHEN EXISTS (SELECT 1 FROM public.organization_members om
                             WHERE om.organization_id = c.organization_id
                               AND om.user_id = (SELECT auth.uid())
                               AND om.status = 'active') THEN 'operator'
               ELSE 'manager'
           END AS role,
           c.organization_id,
           o.name,
           COALESCE(c.onboarding_completed, false),
           COALESCE(c.accepted_tos, false)
      FROM public.companies c
      LEFT JOIN public.organizations o ON o.id = c.organization_id
     WHERE (SELECT auth.uid()) IS NOT NULL
       AND (
             c.owner_id = (SELECT auth.uid())
          OR c.id = (SELECT auth.uid())
          OR EXISTS (SELECT 1 FROM public.company_members cm
                      WHERE cm.company_id = c.id
                        AND cm.user_id = (SELECT auth.uid())
                        AND cm.status = 'active')
          OR EXISTS (SELECT 1 FROM public.organization_members om2
                      WHERE om2.organization_id = c.organization_id
                        AND om2.user_id = (SELECT auth.uid())
                        AND om2.status = 'active'
                        AND om2.role IN ('owner', 'operator'))
       )
     ORDER BY 3, 2;
$$;

COMMENT ON FUNCTION public.get_my_companies() IS
    'Toda unidade que a SESSAO opera, com o papel efetivo. SEMPRE sobre auth.uid() — nunca recebe '
    'uid como parametro. E o unico ponto de resolucao de escopo de empresa do frontend: '
    'teamConnectionService.getAuthenticatedCompanyId(), CompanyProfile e '
    'operationAnalyticsService.resolveCompanyScope() consomem esta RPC. DEFINER porque precisa '
    'enxergar companies alem do que a RLS do invoker mostraria em cenarios futuros; nao expoe nada '
    'que a sessao nao pudesse ler (companies tem SELECT USING(true)).';

-- =============================================
-- 6. GRANTS
-- =============================================
REVOKE ALL ON FUNCTION public.generate_invite_token()                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invite_company_manager(uuid, text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_manager_invite(text)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_company_manager(uuid, uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_companies()                          FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.generate_invite_token()            TO service_role;
GRANT EXECUTE ON FUNCTION public.invite_company_manager(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_manager_invite(text)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_company_manager(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_companies()                 TO authenticated, service_role;

-- ============================================================================
-- DOWN (rollback) — aditivo puro; ninguem foi convidado ainda no momento em que sobe:
--   DROP FUNCTION IF EXISTS public.get_my_companies();
--   DROP FUNCTION IF EXISTS public.revoke_company_manager(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.accept_manager_invite(text);
--   DROP FUNCTION IF EXISTS public.invite_company_manager(uuid, text);
--   DROP FUNCTION IF EXISTS public.generate_invite_token();
-- ============================================================================
