-- Migration: previa de convite para a tela de consentimento ("quem esta me convidando")
-- File: supabase/migrations/20261126000900_previa_de_convite.sql
--
-- get_invite_preview(p_token) -> {outcome:'ok'|'not_found', inviter_name, kind}
-- Mesmo padrao de get_member_invite_preview (ADR-20261123-previa-publica-do-convite): SECURITY
-- DEFINER, search_path='', projecao fechada, nenhum id, nenhum RAISE por token. Esta e uma SEGUNDA
-- excecao de EXECUTE para anon (o ADR pede um ADR proprio para cada uma).
--
-- Tokens atendidos (os dois sao segredos aleatorios, em texto enquanto vivos):
--   kind 'elenco'  -> company_invite_links.token: 48 hex, gen_random_bytes(24), 192 bits. Sem
--                     validade; rotacao substitui o valor (o antigo vira not_found).
--   kind 'gerente' -> company_members.invite_token (role='manager', status='invited'): 64 hex,
--                     dois gen_random_uuid() (generate_invite_token), 244 bits. Expira em 7 dias.
--                     Token queimado nao fica em texto e deve dar not_found: nao se compara hash.
--
-- NAO ATENDIDO: 'freela' (w_...). O token e base64url(workers.id), sem segredo: quem conhece o uuid
-- (que outras partes veem) fabrica o link. Nao expira, nao rotaciona e nao se revoga. Uma previa
-- anon viraria oraculo uuid -> nome, contra o DS-PII ("uuid de freela nao e credencial"). Cai em
-- not_found. Para atender: antes, token opaco proprio do freela (como company_invite_links).
--
-- Convite de encarregado tem 64 hex tambem, mas usa get_member_invite_preview: aqui e not_found.
--
-- VOLATILE de proposito (mesmo padrao de get_member_invite_preview): o PostgREST so aceita POST,
-- entao o token nunca vai para URL nem para log de acesso. A funcao nao tem efeito colateral.
--
-- Article 8: nao toca saldo.
--
-- DOWN (rollback manual; reverter o frontend antes):
--   DROP FUNCTION IF EXISTS public.get_invite_preview(text);
--   NOTIFY pgrst, 'reload schema';

-- 0. Pre-condicoes
DO $pre$
DECLARE
    v_missing text;
BEGIN
    SELECT string_agg(r.t || '.' || r.c, ', ') INTO v_missing
      FROM (VALUES
        ('companies', 'id'), ('companies', 'name'), ('companies', 'anonymized_at'),
        ('company_invite_links', 'company_id'), ('company_invite_links', 'token'),
        ('company_members', 'company_id'), ('company_members', 'invite_token'),
        ('company_members', 'role'), ('company_members', 'status'), ('company_members', 'expires_at')
      ) AS r(t, c)
     WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns k
         WHERE k.table_schema = 'public' AND k.table_name = r.t AND k.column_name = r.c);
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'PRECONDICAO previa de convite: colunas ausentes: %. HALT.', v_missing;
    END IF;
END;
$pre$;

-- 1. RPC
CREATE OR REPLACE FUNCTION public.get_invite_preview(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    -- Resposta unica para TODA falha: nada distingue inexistente, expirado, revogado ou malformado.
    c_not_found constant jsonb :=
        '{"outcome": "not_found", "inviter_name": null, "kind": null}'::jsonb;
    v_name text;
    v_kind text;
BEGIN
    -- Tamanho antes de qualquer regex ou consulta.
    IF p_token IS NULL OR octet_length(p_token) NOT IN (48, 64) THEN
        RETURN c_not_found;
    END IF;
    IF p_token !~ '^[0-9a-f]+$' THEN
        RETURN c_not_found;
    END IF;

    IF octet_length(p_token) = 48 THEN
        v_kind := 'elenco';
        SELECT c.name INTO v_name
          FROM public.company_invite_links l
          JOIN public.companies c ON c.id = l.company_id
         WHERE l.token = p_token
           AND c.anonymized_at IS NULL;
    ELSE
        v_kind := 'gerente';
        SELECT c.name INTO v_name
          FROM public.company_members m
          JOIN public.companies c ON c.id = m.company_id
         WHERE m.invite_token = p_token
           AND m.role = 'manager'
           AND m.status = 'invited'
           AND m.expires_at > now()
           AND c.anonymized_at IS NULL;
    END IF;

    v_name := NULLIF(btrim(COALESCE(v_name, '')), '');
    IF v_name IS NULL THEN
        RETURN c_not_found;
    END IF;

    RETURN jsonb_build_object('outcome', 'ok', 'inviter_name', v_name, 'kind', v_kind);
END;
$fn$;

COMMENT ON FUNCTION public.get_invite_preview(text) IS
    'Previa publica para a tela de consentimento: {outcome ok|not_found, inviter_name (nome da '
    'empresa), kind elenco|gerente}. Nenhum id, e-mail ou nome de pessoa. Toda falha = mesma '
    'resposta not_found. Link w_ de freela NAO e atendido de proposito: base64 do uuid, nao e '
    'segredo. EXECUTE para anon por excecao explicita. Chamar por POST.';

REVOKE ALL ON FUNCTION public.get_invite_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite_preview(text) TO anon, authenticated, service_role;

-- 2. Assercoes
DO $post$
DECLARE
    v_proc pg_proc;
BEGIN
    SELECT * INTO v_proc FROM pg_proc WHERE oid = 'public.get_invite_preview(text)'::regprocedure;
    IF NOT v_proc.prosecdef OR v_proc.provolatile <> 'v'
       OR NOT COALESCE(v_proc.proconfig && ARRAY['search_path=""', 'search_path=']::text[], false) THEN
        RAISE EXCEPTION 'VERIFICACAO previa: esperado SECURITY DEFINER, VOLATILE e search_path vazio. HALT.';
    END IF;
    IF NOT has_function_privilege('anon', v_proc.oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_proc.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'VERIFICACAO previa: anon/authenticated sem EXECUTE. HALT.';
    END IF;
    IF EXISTS (SELECT 1 FROM aclexplode(v_proc.proacl) a WHERE a.grantee = 0) THEN
        RAISE EXCEPTION 'VERIFICACAO previa: EXECUTE ainda concedido a PUBLIC. HALT.';
    END IF;
    IF (SELECT count(*) FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_invite_preview') <> 1 THEN
        RAISE EXCEPTION 'VERIFICACAO previa: overload inesperado de get_invite_preview. HALT.';
    END IF;
END;
$post$;

NOTIFY pgrst, 'reload schema';
