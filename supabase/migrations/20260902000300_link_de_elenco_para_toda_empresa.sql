-- Migration: "Nao foi possivel obter o link do seu elenco agora" -- empresa criada depois de
-- 24/08/2026 nao tinha token de convite de elenco
--
-- RASCUNHO -- NAO APLICADO. Revisar contra o catalogo de producao antes (ver checklist no fim).
--
-- ACHADO (relato de usuaria real, empresa Momma, ao copiar o link do elenco): o frontend
-- (`TeamConnectionService.generateInviteToken`) so le `company_invite_links` e devolve null
-- quando nao ha linha. A migration 20260824000400 fez o backfill UMA vez (empresas existentes em
-- 24/08/2026); NADA cria a linha para empresas criadas depois. A RPC `get_company_invite_token`
-- cria sob demanda, mas (a) ninguem a chamava e (b) ela escolhe `LIMIT 1` entre as empresas que
-- o chamador opera, ignorando a UNIDADE selecionada (multi-unidade, F13) -- um gerente/socio de
-- varias unidades receberia o token da unidade errada.
--
-- CORRECAO, em tres frentes:
--   (a) backfill idempotente das empresas que hoje estao sem linha;
--   (b) trigger AFTER INSERT em `companies` que cria a linha -- a causa raiz: toda empresa nova
--       nasce com token, sem depender de alguem clicar em nada;
--   (c) `get_company_invite_token` ganha `p_company_id uuid`, validado por
--       `public.is_company_owner(p_company_id)` (o seam de autorizacao de empresa -- nunca
--       `company_id = auth.uid()` escrito a mao). O ramo antigo SEM `p_company_id` foi ELIMINADO:
--       `LIMIT 1` sem ORDER BY e nao deterministico e, para quem opera varias unidades, entregaria
--       o token de uma unidade arbitraria. Sem o id -> `company_required` (22023). O DEFAULT NULL
--       existe so para a assinatura ficar `(boolean, uuid)`; o unico chamador
--       (`TeamConnectionService.generateInviteToken`, usado por CompanyTeam, CompanyProfile e
--       CarteiraClientes) sempre passa o id da unidade.
--
-- MUDANCA DE ASSINATURA: `(boolean)` vira `(boolean, uuid)`. CREATE OR REPLACE com lista de
-- parametros diferente NAO substitui: criaria um OVERLOAD, e uma chamada `rpc('...', {})` ou
-- `{p_rotate: false}` ficaria ambigua para o PostgREST. Por isso a assinatura antiga e removida
-- (DROP) na mesma transacao. Nenhum outro objeto depende dela (conferido por grep em
-- migrations, edge functions e frontend; o unico chamador nasce neste mesmo PR).
--
-- ORDEM DE DEPLOY: ESTA MIGRATION ANTES do frontend. O frontend novo chama a RPC com
-- `p_company_id`; contra a assinatura antiga o PostgREST responde PGRST202 (funcao nao
-- encontrada) e o botao continua mostrando o erro -- falha segura (nunca devolve token de outra
-- unidade), mas sem cura.
--
-- Article 8: nao toca saldo. Nenhum dado financeiro envolvido.
--
-- DOWN (rollback manual) -- ORDEM IMPORTA:
--   1. Reverter o FRONTEND primeiro (voltar teamConnectionService.generateInviteToken para a versao
--      sem `p_company_id`). Se as funcoes forem removidas com o frontend novo no ar, o botao volta
--      a mostrar o erro (PGRST202).
--   2. Remover o que esta migration criou:
--        DROP TRIGGER IF EXISTS trg_companies_create_invite_link ON public.companies;
--        DROP FUNCTION IF EXISTS public.create_company_invite_link_on_insert();
--        DROP FUNCTION IF EXISTS public.get_company_invite_token(boolean, uuid);
--   3. Recriar a assinatura antiga `(boolean)`: copiar o bloco
--      `get_company_invite_token(p_rotate boolean DEFAULT false)` de
--      20260824000400_link_de_elenco_precisa_ser_segredo.sql JUNTO com o REVOKE/GRANT dele
--      (REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated, service_role),
--      e terminar com `NOTIFY pgrst, 'reload schema';`.
--   As linhas de company_invite_links criadas pelo backfill/trigger sao inofensivas; manter.


-- (a) Backfill idempotente: so empresas sem linha. ON CONFLICT cobre corrida com a RPC/trigger.
INSERT INTO public.company_invite_links (company_id, token)
SELECT c.id, encode(extensions.gen_random_bytes(24), 'hex')
  FROM public.companies c
 WHERE c.anonymized_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.company_invite_links l WHERE l.company_id = c.id)
ON CONFLICT (company_id) DO NOTHING;

-- (b) Toda empresa nova nasce com token. SECURITY DEFINER porque a tabela so tem policy de
-- SELECT (a escrita e sempre via funcao DEFINER); o INSERT do usuario em `companies` nao
-- poderia escrever aqui sob a RLS dele.
CREATE OR REPLACE FUNCTION public.create_company_invite_link_on_insert()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    INSERT INTO public.company_invite_links (company_id, token)
    VALUES (NEW.id, encode(extensions.gen_random_bytes(24), 'hex'))
    ON CONFLICT (company_id) DO NOTHING;
    RETURN NEW;
END;
$fn$;

-- Funcao de trigger: ninguem a chama direto.
REVOKE ALL ON FUNCTION public.create_company_invite_link_on_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_companies_create_invite_link ON public.companies;
CREATE TRIGGER trg_companies_create_invite_link
    AFTER INSERT ON public.companies
    FOR EACH ROW
    EXECUTE FUNCTION public.create_company_invite_link_on_insert();

-- (c) RPC com unidade explicita.
DROP FUNCTION IF EXISTS public.get_company_invite_token(boolean);

CREATE OR REPLACE FUNCTION public.get_company_invite_token(
    p_rotate     boolean DEFAULT false,
    p_company_id uuid    DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_company_id uuid;
    v_token      text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
    END IF;

    -- Sem unidade explicita nao ha resposta correta: antes havia `LIMIT 1` sem ORDER BY
    -- (nao deterministico -- quem opera varias unidades receberia o token de uma qualquer).
    IF p_company_id IS NULL THEN
        RAISE EXCEPTION 'company_required' USING errcode = '22023';
    END IF;

    -- Unidade explicita (multi-unidade/F13): autoriza pelo seam, nao por owner_id na mao.
    -- Mesma excecao de "nao e empresa sua" para id inexistente e id alheio -- sem oraculo.
    IF NOT public.is_company_owner(p_company_id) THEN
        RAISE EXCEPTION 'not_a_company' USING errcode = '42501';
    END IF;
    v_company_id := p_company_id;

    IF p_rotate THEN
        UPDATE public.company_invite_links
           SET token = encode(extensions.gen_random_bytes(24), 'hex'),
               rotated_at = now()
         WHERE company_id = v_company_id
        RETURNING token INTO v_token;
    ELSE
        SELECT l.token INTO v_token
          FROM public.company_invite_links l
         WHERE l.company_id = v_company_id;
    END IF;

    IF v_token IS NULL THEN
        -- DO NOTHING (nao DO UPDATE): numa corrida com o trigger/backfill/outra chamada, o token
        -- que ja foi entregue a alguem NAO pode ser rotacionado em silencio. Em conflito o
        -- RETURNING nao devolve linha (v_token fica NULL) e relemos o token vigente.
        INSERT INTO public.company_invite_links (company_id, token)
        VALUES (v_company_id, encode(extensions.gen_random_bytes(24), 'hex'))
        ON CONFLICT (company_id) DO NOTHING
        RETURNING token INTO v_token;

        IF v_token IS NULL THEN
            SELECT l.token INTO v_token
              FROM public.company_invite_links l
             WHERE l.company_id = v_company_id;
        END IF;
    END IF;

    RETURN v_token;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_company_invite_token(boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_invite_token(boolean, uuid) TO authenticated, service_role;

-- Assinatura mudou: sem isso o PostgREST responde PGRST202 ate o cache recarregar.
NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- VERIFICACAO (rodar no catalogo ANTES e DEPOIS de aplicar)
--
-- ANTES:
--   -- quantas empresas estao sem token (esperado: > 0, inclui a da usuaria que relatou)
--   SELECT count(*) FROM public.companies c
--    WHERE NOT EXISTS (SELECT 1 FROM public.company_invite_links l WHERE l.company_id = c.id);
--   -- assinatura vigente (esperado: UMA linha, args = 'p_rotate boolean DEFAULT false')
--   SELECT oid::regprocedure FROM pg_proc WHERE proname = 'get_company_invite_token';
--   -- nao existe trigger homonimo nem outro AFTER INSERT em companies que conflite
--   SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public.companies'::regclass AND NOT tgisinternal;
--   -- is_company_owner existe e e a versao BEGIN ATOMIC (F13)
--   SELECT pg_get_functiondef('public.is_company_owner(uuid)'::regprocedure);
--   -- extensions.gen_random_bytes disponivel
--   SELECT 'extensions.gen_random_bytes(int)'::regprocedure;
--
-- DEPOIS:
--   SELECT count(*) FROM public.companies c
--    WHERE NOT EXISTS (SELECT 1 FROM public.company_invite_links l WHERE l.company_id = c.id);  -- 0
--   SELECT oid::regprocedure FROM pg_proc WHERE proname = 'get_company_invite_token';
--     -- UMA linha: get_company_invite_token(boolean,uuid)
--   SELECT has_function_privilege('anon', 'public.get_company_invite_token(boolean,uuid)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('authenticated', 'public.get_company_invite_token(boolean,uuid)', 'EXECUTE');  -- true
--   -- como a Sabrina (sessao dela): rpc('get_company_invite_token', {p_company_id: <unidade dela>})
--   --   devolve 48 hex; com p_company_id de OUTRA empresa -> erro 42501 not_a_company;
--   --   SEM p_company_id (rpc('get_company_invite_token', {})) -> erro 22023 company_required.
--   -- criar empresa de teste (dentro de ROLLBACK) e conferir que nasce com linha em company_invite_links.
-- ============================================================================
