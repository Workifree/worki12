-- Migration: qualquer freela entrava sozinho no elenco de qualquer empresa
--
-- ACHADO (24/08/2026, testando "Repassar link" na Carteira de Clientes): o link de convite de
-- elenco e /convite/<base64url(company_id)>. O token nao e segredo -- e uma FUNCAO PURA de um
-- identificador publico:
--   - companies tem SELECT USING (true): qualquer sessao autenticada lista TODAS as empresas e
--     seus ids (conferido: 9 visiveis para o freela de QA);
--   - generateInviteToken so faz btoa(companyId), no cliente, sem servidor nenhum;
--   - accept_company_invite_by_token decodifica de volta e insere status='accepted'.
--
-- Reproduzido em producao com ROLLBACK forcado: o freela de QA enumerou as empresas, derivou o
-- token de uma com quem NAO tem relacao alguma e entrou no elenco dela como 'accepted',
-- source='link'. Nenhum convite foi emitido por aquela empresa.
--
-- O comentario da propria RPC dizia "Ambos consentiram (empresa gerou+enviou o link; worker
-- abriu)". A primeira metade e falsa: gerar o link nao e um ato da empresa, e um calculo que
-- qualquer um faz sobre um id publico. Nao havia consentimento da empresa em lugar nenhum.
--
-- POR QUE E GRAVE: "lista fechada" e a premissa do modelo push inteiro. Estar no elenco ACEITO
-- e o que torna a pessoa selecionavel no Chamado de Turno, incluivel em team_lists, e elegivel
-- como indicada em create_worker_referral (que exige vinculo). A empresa veria estranhos na
-- propria operacao sem nunca ter convidado ninguem.
--
-- CORRECAO: o link vira uma CAPACIDADE de verdade -- token aleatorio, opaco, que so quem opera a
-- empresa consegue ler, e rotacionavel se vazar. O segredo NAO pode morar em companies: aquele
-- SELECT USING (true) publicaria a coluna junto.
--
-- COMPATIBILIDADE, declarada: links base64 antigos param de funcionar -- eram exatamente o
-- buraco. No piloto, quem tiver um link em maos pede o novo na mesma tela.
--
-- O fluxo INVERSO (empresa abre o link do freela, prefixo w_) nao muda: ele cria vinculo
-- 'pending', que ainda depende do "sim" do freela.
--
-- Article 8: nao toca saldo.

CREATE TABLE IF NOT EXISTS public.company_invite_links (
    company_id  uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
    token       text NOT NULL UNIQUE CHECK (length(token) >= 32),
    created_at  timestamptz NOT NULL DEFAULT now(),
    rotated_at  timestamptz
);

ALTER TABLE public.company_invite_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cil_select_operator ON public.company_invite_links;
CREATE POLICY cil_select_operator ON public.company_invite_links
    FOR SELECT USING (public.is_company_owner(company_id));

INSERT INTO public.company_invite_links (company_id, token)
SELECT c.id, encode(extensions.gen_random_bytes(24), 'hex')
  FROM public.companies c
 WHERE NOT EXISTS (SELECT 1 FROM public.company_invite_links l WHERE l.company_id = c.id);

COMMENT ON TABLE public.company_invite_links IS
    'Token opaco do link de convite de elenco. Tabela separada de proposito: companies tem SELECT '
    'USING (true), entao um segredo guardado la seria publico. So quem opera a empresa le o '
    'proprio token (RLS via is_company_owner); a resolucao no aceite acontece dentro de RPC '
    'SECURITY DEFINER. Criada em 20260824000400, quando o token era base64 do company_id e '
    'qualquer freela entrava sozinho no elenco de qualquer empresa.';

CREATE OR REPLACE FUNCTION public.get_company_invite_token(p_rotate boolean DEFAULT false)
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

    SELECT c.id INTO v_company_id
      FROM public.companies c
     WHERE public.is_company_owner(c.id)
     LIMIT 1;

    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'not_a_company' USING errcode = '42501';
    END IF;

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
        INSERT INTO public.company_invite_links (company_id, token)
        VALUES (v_company_id, encode(extensions.gen_random_bytes(24), 'hex'))
        ON CONFLICT (company_id) DO UPDATE SET token = excluded.token
        RETURNING token INTO v_token;
    END IF;

    RETURN v_token;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_company_invite_token(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_invite_token(boolean) TO authenticated, service_role;

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
