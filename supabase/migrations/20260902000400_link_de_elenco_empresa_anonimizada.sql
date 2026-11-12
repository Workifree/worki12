-- Migration: link de elenco de empresa ANONIMIZADA nao pode mais recrutar freelas
--
-- RASCUNHO -- NAO APLICADO. Revisar contra o catalogo de producao antes (ver checklist no fim).
-- DEPENDE de 20260902000300_link_de_elenco_para_toda_empresa.sql: aplicar DEPOIS dela (o
-- backfill dela cria linha em company_invite_links para TODA empresa sem token, inclusive as ja
-- anonimizadas; a limpeza (a) abaixo desfaz isso).
--
-- ACHADO (gate de seguranca da 20260902000300): `anonymize_account` (LGPD, 20260821000000 e
-- 20260902000200) tombstona a empresa (`companies.anonymized_at`, perde nome/CNPJ/etc.), mas NAO
-- toca em `company_invite_links`. O token continua valido: quem tem o link antigo ainda entra no
-- elenco ACEITO de uma empresa que, juridicamente, deixou de existir. A 20260902000300 agrava o
-- quadro porque passa a gerar token para toda empresa, anonimizada ou nao.
--
-- CORRECAO, em duas frentes:
--   (a) limpeza unica: apaga os tokens das empresas ja anonimizadas
--       (coluna real: `public.companies.anonymized_at`, criada em 20260821000000);
--   (b) defesa permanente: `accept_company_invite_by_token` rejeita empresa anonimizada com
--       `invalid_token` (22023) -- a MESMA excecao do token inexistente, para nao virar oraculo
--       de "essa empresa existiu e foi apagada". Cobre tambem anonimizacoes FUTURAS, que a limpeza
--       (a) nao alcanca.
--
-- PENDENCIA REGISTRADA (nao feita aqui de proposito): o desenho ideal e `anonymize_account`
-- apagar a linha de `company_invite_links` da empresa na mesma transacao da anonimizacao. Nao
-- editamos `anonymize_account` nesta migration -- e uma funcao muito grande, ja reescrita em
-- 20260902000200, e mexer nela exige revisao propria. Enquanto a pendencia existir, (b) e a
-- unica barreira para anonimizacoes futuras e a linha do token sobrevive como lixo inerte.
--
-- O corpo de `accept_company_invite_by_token` abaixo e a copia INTEGRAL da definicao vigente
-- (20260824000400_link_de_elenco_precisa_ser_segredo.sql -- nenhuma migration posterior a
-- redefine; conferido por grep), acrescida SOMENTE do bloco marcado "ACRESCIMO". REVOKE/GRANT
-- preservados.
--
-- Article 8: nao toca saldo.
--
-- DOWN (rollback manual):
--   Recriar `accept_company_invite_by_token(text)` copiando o bloco de
--   20260824000400_link_de_elenco_precisa_ser_segredo.sql (sem o ACRESCIMO), com o mesmo
--   REVOKE/GRANT. Os tokens apagados em (a) nao sao recuperaveis -- e intencional (empresa
--   anonimizada); para empresas ativas o token e recriado sob demanda por get_company_invite_token.


-- (a) Limpeza unica dos tokens de empresas ja anonimizadas.
DELETE FROM public.company_invite_links l
 USING public.companies c
 WHERE c.id = l.company_id
   AND c.anonymized_at IS NOT NULL;

-- (b) Aceite rejeita empresa anonimizada.
CREATE OR REPLACE FUNCTION public.accept_company_invite_by_token(p_token text)
RETURNS public.team_connections
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid        uuid := auth.uid();
    v_company_id uuid;
    v_row        public.team_connections;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
    END IF;

    IF p_token IS NULL OR left(p_token, 2) = 'w_' THEN
        RAISE EXCEPTION 'invalid_token' USING errcode = '22023';
    END IF;

    -- Antes: decode de base64 -> company_id. O "token" era o proprio id publico da empresa, e
    -- entrar no elenco de qualquer uma era so uma questao de saber o uuid dela.
    -- Agora: so entra quem apresenta o segredo que a empresa emitiu.
    SELECT l.company_id INTO v_company_id
      FROM public.company_invite_links l
     WHERE l.token = p_token;

    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'invalid_token' USING errcode = '22023';
    END IF;

    -- ACRESCIMO (20260902000400): empresa anonimizada (LGPD) nao recruta mais. Mesma excecao do
    -- token inexistente -- nao revela que a empresa existiu.
    IF EXISTS (
        SELECT 1 FROM public.companies c
         WHERE c.id = v_company_id AND c.anonymized_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'invalid_token' USING errcode = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.workers WHERE id = v_uid) THEN
        RAISE EXCEPTION 'not_a_worker' USING errcode = '42501';
    END IF;

    SELECT * INTO v_row
      FROM public.team_connections
     WHERE company_id = v_company_id AND worker_id = v_uid;

    IF FOUND THEN
        RETURN v_row;
    END IF;

    INSERT INTO public.team_connections (company_id, worker_id, status, source, accepted_at)
    VALUES (v_company_id, v_uid, 'accepted', 'link', now())
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.accept_company_invite_by_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_company_invite_by_token(text) TO authenticated, service_role;


-- ============================================================================
-- VERIFICACAO (rodar no catalogo ANTES e DEPOIS de aplicar)
--
-- ANTES:
--   -- a coluna existe e quantas empresas estao anonimizadas
--   SELECT count(*) FILTER (WHERE anonymized_at IS NOT NULL) AS anonimizadas, count(*) FROM public.companies;
--   -- quantos tokens serao apagados (apos a 20260902000300 ter rodado, inclui backfill)
--   SELECT count(*) FROM public.company_invite_links l JOIN public.companies c ON c.id = l.company_id
--    WHERE c.anonymized_at IS NOT NULL;
--   -- definicao vigente do aceite == a de 20260824000400 (sem ACRESCIMO); compare o corpo:
--   SELECT pg_get_functiondef('public.accept_company_invite_by_token(text)'::regprocedure);
--   -- privilegios vigentes (esperado: anon=false, authenticated=true, service_role=true)
--   SELECT has_function_privilege('anon','public.accept_company_invite_by_token(text)','EXECUTE'),
--          has_function_privilege('authenticated','public.accept_company_invite_by_token(text)','EXECUTE');
--
-- DEPOIS:
--   SELECT count(*) FROM public.company_invite_links l JOIN public.companies c ON c.id = l.company_id
--    WHERE c.anonymized_at IS NOT NULL;  -- 0
--   -- mesmos privilegios de antes (anon=false, authenticated=true)
--   -- em transacao com ROLLBACK: marcar uma empresa de teste com anonymized_at = now() (conferir antes
--   -- se ha trigger/guarda em companies que barre esse UPDATE direto) e chamar o aceite com o token dela como freela -> 22023 invalid_token.
-- ============================================================================
