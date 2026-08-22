-- Migration: F13 Fase 0 — organizations / company_members / organization_members (aditivo puro)
-- File: supabase/migrations/20260818100000_organizations_schema.sql
-- Contrato: .harness/spec/multi-unidade/ddl-aprovado.md §5.1
-- ADR: .harness/memory-bank/decisions/ADR-20260818-multi-unidade-hierarquia-empresa.md
--
-- NENHUMA policy existente é tocada aqui. NENHUMA função de autorização existente é tocada aqui.
-- Esta migration pode subir em produção sozinha e ficar meses inerte sem efeito observável.
--
-- ORDEM OBRIGATÓRIA (landmine do projeto): tabelas -> funções -> policies -> ENABLE RLS.
-- Corpo LANGUAGE sql é parseado no CREATE mesmo escrito como string; função antes da tabela = a
-- migration chega inaplicável em produção e build/lint/teste não pegam (nenhum executa SQL).
--
-- Article 8: nada aqui toca wallets / escrow_transactions / wallet_transactions / shift_payments.
--
-- DOWN (rollback): bloco no final do arquivo.

-- =============================================
-- 1. TABELAS
-- =============================================

CREATE TABLE IF NOT EXISTS public.organizations (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL CHECK (length(trim(name)) > 0),
    created_by  uuid        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.organizations IS
    'Grupo/rede de unidades. NAO tem owner_id: o dono/operador vive em organization_members '
    '(permite mais de um socio). Uma companies pertence a exatamente uma organization.';

-- Coluna nova em companies: NULLABLE nesta fase. SET NOT NULL so na Fase 1, DEPOIS do trigger
-- de auto-provisao (senao handle_new_user quebra todo signup novo de empresa).
ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.companies.organization_id IS
    'Organizacao (rede) a que esta unidade pertence. ON DELETE RESTRICT: organizacao nunca some '
    'por baixo de uma unidade com dado gravado. Preenchida automaticamente por '
    'trg_company_autoprovision_organization quando a linha nasce sem ela.';

CREATE INDEX IF NOT EXISTS idx_companies_organization
    ON public.companies (organization_id);

CREATE TABLE IF NOT EXISTS public.organization_members (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    user_id         uuid,                       -- NULL ate o aceite do convite
    role            text        NOT NULL DEFAULT 'operator'
                                CHECK (role IN ('owner', 'operator')),
    status          text        NOT NULL DEFAULT 'invited'
                                CHECK (status IN ('invited', 'active', 'removed')),
    invited_email   text,
    invite_token    text,
    invited_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz,
    accepted_at     timestamptz,
    created_by      uuid        NOT NULL,
    CONSTRAINT organization_members_active_needs_user
        CHECK (status <> 'active' OR user_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.company_members (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
    user_id         uuid,                       -- NULL ate o aceite do convite (divergencia V1)
    role            text        NOT NULL DEFAULT 'manager'
                                CHECK (role = 'manager'),
    status          text        NOT NULL DEFAULT 'invited'
                                CHECK (status IN ('invited', 'active', 'removed')),
    invited_email   text,
    invite_token    text,
    invited_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz,
    accepted_at     timestamptz,
    created_by      uuid        NOT NULL,
    CONSTRAINT company_members_active_needs_user
        CHECK (status <> 'active' OR user_id IS NOT NULL)
);

COMMENT ON TABLE public.company_members IS
    'Vinculo pessoa x unidade (gerente). user_id NULLABLE ate o aceite: no convite ainda nao se '
    'sabe quem e a pessoa. Remocao e SOFT (status=removed), nunca DELETE — preserva a auditoria '
    'de quem operou a unidade e quando. ON DELETE RESTRICT em company_id pelo mesmo motivo.';

-- Unicidade: uma pessoa tem no maximo UMA linha por unidade (indice parcial por causa do NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_members_company_user
    ON public.company_members (company_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_members_org_user
    ON public.organization_members (organization_id, user_id) WHERE user_id IS NOT NULL;

-- Um convite pendente por (unidade, e-mail) — evita fila de tokens validos para a mesma pessoa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_members_pending_email
    ON public.company_members (company_id, lower(invited_email)) WHERE status = 'invited';

-- Token e credencial portadora: unico e indexado para o lookup da RPC de aceite.
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_members_invite_token
    ON public.company_members (invite_token) WHERE invite_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_members_invite_token
    ON public.organization_members (invite_token) WHERE invite_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_company_members_user_active
    ON public.company_members (user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_organization_members_user_active
    ON public.organization_members (user_id) WHERE status = 'active';

-- =============================================
-- 2. FUNCOES (DEPOIS das tabelas — ver cabecalho)
-- =============================================

-- 2.1 DEFINER minimo: "sou operador ativo desta organizacao?" — sempre sobre auth.uid(), nunca
-- aceita "por qual usuario perguntar". Existe para quebrar a recursao 42P17 da policy de
-- organization_members consigo mesma (precedente: is_shift_call_target, 20260817000100).
CREATE OR REPLACE FUNCTION public.is_organization_operator(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT (SELECT auth.uid()) IS NOT NULL
       AND p_organization_id IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM public.organization_members om
             WHERE om.organization_id = p_organization_id
               AND om.user_id = (SELECT auth.uid())
               AND om.status  = 'active'
               AND om.role IN ('owner', 'operator')
       );
$$;

COMMENT ON FUNCTION public.is_organization_operator(uuid) IS
    'DEFINER minimo (grafo de policies aciclico, ver ddl-aprovado.md §4). Sempre sobre auth.uid(); '
    'nao aceita uid de terceiro, entao nao serve para varrer dado alheio.';

-- 2.2 DEFINER minimo: "pertenco a esta organizacao em qualquer papel ativo?" (para ver a linha
-- de organizations).
CREATE OR REPLACE FUNCTION public.is_organization_member(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT (SELECT auth.uid()) IS NOT NULL
       AND p_organization_id IS NOT NULL
       AND (
            EXISTS (SELECT 1 FROM public.organization_members om
                     WHERE om.organization_id = p_organization_id
                       AND om.user_id = (SELECT auth.uid())
                       AND om.status  = 'active')
         OR EXISTS (SELECT 1 FROM public.company_members cm
                      JOIN public.companies c ON c.id = cm.company_id
                     WHERE c.organization_id = p_organization_id
                       AND cm.user_id = (SELECT auth.uid())
                       AND cm.status  = 'active')
         OR EXISTS (SELECT 1 FROM public.companies c2
                     WHERE c2.organization_id = p_organization_id
                       AND (c2.owner_id = (SELECT auth.uid()) OR c2.id = (SELECT auth.uid())))
       );
$$;

-- 2.3 INVOKER: resolve a organizacao de uma unidade. NAO precisa de DEFINER — companies ja tem
-- SELECT USING(true) para authenticated (20260317160000). Manter INVOKER mantem o inventario de
-- objetos privilegiados menor (licao dos advisors 20260816201420/57).
CREATE OR REPLACE FUNCTION public.company_organization_id(p_company_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT c.organization_id FROM public.companies c WHERE c.id = p_company_id;
$$;

-- 2.4 DEFINER minimo: a branch NOVA do seam. Uma funcao so (em vez de duas) para nao dobrar o
-- custo por linha nas ~15 policies que chamam is_company_owner.
CREATE OR REPLACE FUNCTION public.session_operates_company_membership(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT (SELECT auth.uid()) IS NOT NULL
       AND p_company_id IS NOT NULL
       AND (
            EXISTS (
                SELECT 1 FROM public.company_members cm
                 WHERE cm.company_id = p_company_id
                   AND cm.user_id = (SELECT auth.uid())
                   AND cm.status  = 'active'
            )
         OR EXISTS (
                SELECT 1
                  FROM public.organization_members om
                  JOIN public.companies c ON c.organization_id = om.organization_id
                 WHERE c.id = p_company_id
                   AND om.user_id = (SELECT auth.uid())
                   AND om.status  = 'active'
                   AND om.role IN ('owner', 'operator')
            )
       );
$$;

COMMENT ON FUNCTION public.session_operates_company_membership(uuid) IS
    'Branch de multi-unidade do seam de autorizacao. DEFINER de proposito: se fosse INVOKER, a '
    'policy de company_members chamaria is_company_owner que chamaria esta funcao que releria '
    'company_members = recursao 42P17 EM RUNTIME (precedente shift_calls x shift_call_targets). '
    'Chamada por public.is_company_owner a partir de 20260818100200. Ver ddl-aprovado.md §4.';

-- 2.5 Auto-provisao de organizacao: sem isto, o SET NOT NULL da Fase 1 quebra handle_new_user
-- (trigger de auth.users que INSERE em companies sem organization_id) e NENHUMA empresa nova
-- consegue se cadastrar. Blocker identificado no gate — nao remover.
-- ATENCAO: organizations.name tem CHECK length(trim(name)) > 0 e companies.name NASCE COMO ''
-- em handle_new_user. Um NULLIF direto devolveria NULL e violaria o NOT NULL no primeiro signup.
-- Dai o fallback de rotulo estavel abaixo; a conta-mae renomeia depois na UI.
CREATE OR REPLACE FUNCTION public.autoprovision_company_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org_id uuid;
    v_name   text;
BEGIN
    IF NEW.organization_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    IF EXISTS (SELECT 1 FROM public.companies c WHERE c.id = NEW.id) THEN
        RETURN NEW;
    END IF;

    v_name := NULLIF(trim(COALESCE(NEW.name, '')), '');
    IF v_name IS NULL THEN
        v_name := 'Organizacao ' || left(NEW.id::text, 8);
    END IF;

    INSERT INTO public.organizations (name, created_by)
    VALUES (v_name, COALESCE(NEW.owner_id, NEW.id))
    RETURNING id INTO v_org_id;

    INSERT INTO public.organization_members
        (organization_id, user_id, role, status, accepted_at, created_by)
    VALUES
        (v_org_id, COALESCE(NEW.owner_id, NEW.id), 'owner', 'active', now(), COALESCE(NEW.owner_id, NEW.id));

    NEW.organization_id := v_org_id;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.autoprovision_company_organization() IS
    'BEFORE INSERT em companies: toda unidade nova nasce dentro de uma organizacao propria, com '
    'o dono como organization_members owner ativo. Sem isto, o SET NOT NULL da Fase 1 quebra '
    'handle_new_user e nenhum signup de empresa funciona. NAO toca saldo (Article 8).';

DROP TRIGGER IF EXISTS trg_company_autoprovision_organization ON public.companies;
CREATE TRIGGER trg_company_autoprovision_organization
    BEFORE INSERT ON public.companies
    FOR EACH ROW EXECUTE FUNCTION public.autoprovision_company_organization();

-- =============================================
-- 3. GRANTS (antes das policies, padrao do projeto)
-- =============================================
REVOKE ALL ON public.organizations        FROM anon;
REVOKE ALL ON public.organization_members FROM anon;
REVOKE ALL ON public.company_members      FROM anon;

-- Sem INSERT/UPDATE/DELETE para authenticated: toda escrita passa pelas RPCs da Fase 3.
GRANT SELECT ON public.organizations        TO authenticated;
GRANT SELECT ON public.organization_members TO authenticated;
GRANT SELECT ON public.company_members      TO authenticated;

GRANT ALL ON public.organizations        TO service_role;
GRANT ALL ON public.organization_members TO service_role;
GRANT ALL ON public.company_members      TO service_role;

REVOKE ALL ON FUNCTION public.is_organization_operator(uuid)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_organization_member(uuid)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_organization_id(uuid)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.session_operates_company_membership(uuid)   FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_organization_operator(uuid)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_organization_member(uuid)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_organization_id(uuid)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.session_operates_company_membership(uuid) TO authenticated, service_role;

-- Funcao de trigger: EXECUTE para authenticated (licao 20260816201420/57 — sem isto o INSERT
-- de companies feito pela propria sessao falha ao disparar o trigger).
REVOKE ALL ON FUNCTION public.autoprovision_company_organization() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.autoprovision_company_organization() TO authenticated, service_role;

-- =============================================
-- 4. POLICIES (antes do ENABLE RLS — landmine do harness)
-- =============================================
-- NENHUMA destas policies chama is_company_owner / is_job_owner. Ver ddl-aprovado.md §4, regra 1.

DROP POLICY IF EXISTS "organizations_select_member" ON public.organizations;
CREATE POLICY "organizations_select_member" ON public.organizations
    FOR SELECT TO authenticated
    USING (public.is_organization_member(id));

DROP POLICY IF EXISTS "om_select_self_or_operator" ON public.organization_members;
CREATE POLICY "om_select_self_or_operator" ON public.organization_members
    FOR SELECT TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR public.is_organization_operator(organization_id)
    );

DROP POLICY IF EXISTS "cm_select_self_or_operator" ON public.company_members;
CREATE POLICY "cm_select_self_or_operator" ON public.company_members
    FOR SELECT TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR public.is_organization_operator(public.company_organization_id(company_id))
    );

COMMENT ON POLICY "cm_select_self_or_operator" ON public.company_members IS
    'Gerente ve so a PROPRIA linha (nunca a de outro gerente, nem a existencia de outra unidade). '
    'Socio/operador ve todas as linhas das unidades da organizacao dele. NAO usa is_company_owner: '
    'isso recursaria (42P17) — ver ddl-aprovado.md §4.';

-- SEM policy de INSERT/UPDATE/DELETE em nenhuma das tres tabelas: toda transicao de estado passa
-- pelas RPCs SECURITY DEFINER da Fase 3, mantendo a maquina de estados num lugar auditavel
-- (mesmo padrao de shift_calls / shift_call_targets).

-- =============================================
-- 5. RLS (depois das policies; SEM FORCE — ver 20260318000000)
-- =============================================
ALTER TABLE public.organizations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.company_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_members      NO FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- DOWN (rollback) — aditivo puro, nada externo depende ainda:
--   DROP TRIGGER  IF EXISTS trg_company_autoprovision_organization ON public.companies;
--   DROP FUNCTION IF EXISTS public.autoprovision_company_organization();
--   DROP FUNCTION IF EXISTS public.session_operates_company_membership(uuid);
--   DROP FUNCTION IF EXISTS public.company_organization_id(uuid);
--   DROP FUNCTION IF EXISTS public.is_organization_member(uuid);
--   DROP FUNCTION IF EXISTS public.is_organization_operator(uuid);
--   ALTER TABLE public.companies DROP COLUMN IF EXISTS organization_id;
--   DROP TABLE IF EXISTS public.company_members;
--   DROP TABLE IF EXISTS public.organization_members;
--   DROP TABLE IF EXISTS public.organizations;
-- ATENCAO: a partir da 20260818100200, session_operates_company_membership vira dependencia
-- registrada de is_company_owner (corpo BEGIN ATOMIC) e este DROP passa a falhar com 2BP01 —
-- o que e desejado: reverta a Fase 2 primeiro.
-- ============================================================================
