-- Migration: meu estado de acesso (ex-membro nao deve cair no onboarding de empresa nova)
-- File: supabase/migrations/20261126000600_meu_estado_de_acesso.sql
--
-- my_access_state() -> {removed, has_active, owns_company}. So booleanos, sempre sobre auth.uid();
-- sem nome nem id de empresa. Leitura de UX para o roteamento: NAO e predicado de autorizacao
-- (nao usar em policy; o seam continua is_company_owner / is_job_owner).
--
--   removed      : ha linha 'removed' da pessoa em company_members (encarregado ou gerente F13
--                  revogado; removed_at nao e exigido, a revogacao F13 antiga nao o gravava) ou em
--                  organization_members. Convite revogado antes do aceite tem user_id NULL: nao conta.
--   has_active   : membership ativa em company_members (inclui encarregado ainda nao confirmado), ou
--                  operador ativo de organizacao com ao menos uma empresa que NAO e da propria pessoa.
--                  A exigencia da empresa e necessaria: internal_drop_empty_company_shell apaga a
--                  casca e deixa a linha 'owner' ativa na organizacao orfa.
--   owns_company : empresa PROPRIA (owner_id ou id = pessoa) com onboarding_completed = true. A casca
--                  que handle_new_user cria para signup 'hire' (onboarding false) NAO conta.
--
-- Sessao nula: tudo false. Article 8: so leitura.
--
-- DOWN:
--   DROP FUNCTION IF EXISTS public.my_access_state();

-- 0. Pre-condicoes
DO $mig$
DECLARE
    v_n integer;
BEGIN
    SELECT count(*) INTO v_n FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (table_name, column_name) IN (
            ('company_members', 'user_id'), ('company_members', 'status'),
            ('company_members', 'removed_at'), ('companies', 'owner_id'),
            ('companies', 'organization_id'), ('organization_members', 'organization_id'),
            ('companies', 'onboarding_completed'),
            ('organization_members', 'user_id'), ('organization_members', 'status'),
            ('organization_members', 'role'));
    IF v_n <> 10 THEN
        RAISE EXCEPTION 'PRECONDICAO meu_estado_de_acesso: % de 10 colunas esperadas. Aplicar F13 e E1 antes. HALT.', v_n;
    END IF;
END
$mig$;

-- 1. RPC
CREATE OR REPLACE FUNCTION public.my_access_state()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT jsonb_build_object(
        'removed',
            EXISTS (SELECT 1 FROM public.company_members cm
                     WHERE cm.user_id = (SELECT auth.uid()) AND cm.status = 'removed')
         OR EXISTS (SELECT 1 FROM public.organization_members om
                     WHERE om.user_id = (SELECT auth.uid()) AND om.status = 'removed'),
        'has_active',
            -- qualquer role conta: a pergunta e "ainda tem vinculo?", nao concede acesso
            EXISTS (SELECT 1 FROM public.company_members cm
                     WHERE cm.user_id = (SELECT auth.uid()) AND cm.status = 'active')
         OR EXISTS (SELECT 1 FROM public.organization_members om
                      JOIN public.companies c ON c.organization_id = om.organization_id
                     WHERE om.user_id = (SELECT auth.uid()) AND om.status = 'active'
                       AND om.role IN ('owner', 'operator')
                       AND c.id <> (SELECT auth.uid())
                       AND c.owner_id IS DISTINCT FROM (SELECT auth.uid())),
        'owns_company',
            EXISTS (SELECT 1 FROM public.companies c
                     WHERE (c.owner_id = (SELECT auth.uid()) OR c.id = (SELECT auth.uid()))
                       AND c.onboarding_completed IS TRUE)
    );
$fn$;

COMMENT ON FUNCTION public.my_access_state() IS
    'Estado de acesso da PROPRIA sessao: {removed, has_active, owns_company}. Sem parametro, sem nomes '
    'nem ids. So para roteamento no client; nao usar como predicado de autorizacao.';

REVOKE ALL ON FUNCTION public.my_access_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_access_state() TO authenticated, service_role;

-- 2. Verificacao final
DO $mig$
DECLARE
    v_oid oid := to_regprocedure('public.my_access_state()');
    v_def text;
BEGIN
    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'ASSERCAO meu_estado_de_acesso: funcao ausente.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid AND p.prosecdef AND p.provolatile = 's'
                      AND p.pronargs = 0 AND array_to_string(p.proconfig, ',') = 'search_path=""') THEN
        RAISE EXCEPTION 'ASSERCAO meu_estado_de_acesso: esperado STABLE SECURITY DEFINER search_path vazio, sem parametro.';
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'ASSERCAO meu_estado_de_acesso: grants errados (anon nao, authenticated sim).';
    END IF;
    v_def := pg_get_functiondef(v_oid);
    -- limite de palavra: "company_membership" nao pode contar; o portao da E4 exige tratar role
    IF v_def !~ '[[:<:]]company_members[[:>:]]' OR v_def !~ '[[:<:]]role[[:>:]]' THEN
        RAISE EXCEPTION 'ASSERCAO meu_estado_de_acesso: corpo inesperado.';
    END IF;
END
$mig$;
