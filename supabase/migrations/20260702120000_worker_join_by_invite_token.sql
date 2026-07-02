-- Migration: Worker entra no elenco da empresa via LINK de convite (fix GTM bloqueante)
-- File: supabase/migrations/20260702120000_worker_join_by_invite_token.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260702-worker-join-by-invite-token.md
--
-- PROBLEMA (E2E prod, contas novas):
--   Fluxo pretendido (forcing-function do GTM): a EMPRESA gera um link de convite
--   (Meu Elenco -> Adicionar -> Link) e manda pro freela; o freela (logado) abre
--   /convite/:token e entra no elenco. O token é base64url(company_id).
--   FALHA: o worker abrindo o link recebe 403 em POST /rest/v1/team_connections.
--   CAUSA-RAIZ: teamConnectionService.addToTeamByToken faz INSERT direto como o
--   worker, mas a policy tc_insert_company (20260622000000) só permite a EMPRESA
--   inserir (WITH CHECK company_id IN companies do auth.uid()). Worker -> viola RLS.
--
-- SOLUÇÃO (opção a — RPC SECURITY DEFINER):
--   Em vez de abrir uma policy de INSERT ampla pro worker (que abriria escrita
--   direta na tabela financeira-adjacente de relações), introduzimos uma RPC
--   estreita e auditada. Ela roda como owner (bypassa RLS), mas valida e FORÇA
--   server-side tudo o que importa:
--     - worker_id := auth.uid()  (worker não pode inserir em nome de terceiro)
--     - status  := 'accepted'    (worker não pode forjar outro estado)
--     - source  := 'link'
--     - a empresa do token precisa existir
--     - quem chama precisa ter perfil de worker (isolamento de papel — Art. 1)
--   O INSERT direto do worker na tabela continua PROIBIDO. As policies existentes
--   (tc_insert_company, tc_update_worker, tc_update_company, ...) ficam INTACTAS,
--   então o caminho que já funciona (empresa-adiciona-por-ID -> worker-aceita) NÃO
--   muda.
--
-- DECISÃO DE ESTADO (pending vs accepted): nasce 'accepted'. Ambos os lados já
--   consentiram — a empresa deliberadamente GEROU e ENVIOU o link, e o worker
--   ABRIU e está logado. 'pending' só adicionaria fricção redundante (a empresa
--   teria que reconfirmar algo que ela mesma iniciou) sem ganho de segurança: o
--   token é forjável de qualquer forma, e uma linha 'pending' forjada exigiria a
--   mesma remediação (a empresa bloquear/deletar) que uma 'accepted' forjada.
--   Ver ADR para a análise de risco (spam limitado, sem acesso indevido a dados).
--
-- Idempotência: se a conexão já existe (qualquer status), retorna a linha existente
--   SEM alterá-la. Em particular NÃO reabre uma conexão 'blocked' (veto do freela).
--
-- NÃO toca saldo/escrow. Não é RPC financeira; mesmo assim segue o padrão
--   SECURITY DEFINER + SET search_path = '' + GRANT EXECUTE explícito.
--
-- DOWN (rollback): DROP FUNCTION IF EXISTS public.accept_company_invite_by_token(text);

-- =============================================
-- RPC: accept_company_invite_by_token
-- =============================================
CREATE OR REPLACE FUNCTION public.accept_company_invite_by_token(p_token text)
RETURNS public.team_connections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid        uuid := auth.uid();
    v_b64        text;
    v_company_id uuid;
    v_row        public.team_connections;
BEGIN
    -- 1. Precisa de sessão
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
    END IF;

    -- 2. Token de worker (prefixo w_) não entra por aqui — é o fluxo inverso
    --    (empresa abrindo o link do worker), que continua via addToTeam.
    IF p_token IS NULL OR left(p_token, 2) = 'w_' THEN
        RAISE EXCEPTION 'invalid_token' USING errcode = '22023';
    END IF;

    -- 3. base64url -> base64 padrão + re-padding -> UUID da empresa
    BEGIN
        v_b64 := replace(replace(p_token, '-', '+'), '_', '/');
        v_b64 := v_b64 || repeat('=', (4 - length(v_b64) % 4) % 4);
        v_company_id := convert_from(decode(v_b64, 'base64'), 'utf8')::uuid;
    EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'invalid_token' USING errcode = '22023';
    END;

    -- 4. A empresa do link precisa existir
    IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_company_id) THEN
        RAISE EXCEPTION 'company_not_found' USING errcode = 'P0002';
    END IF;

    -- 5. Isolamento de papel (Art. 1): só quem tem perfil de worker entra em elenco.
    --    Uma sessão de empresa abrindo este link é rejeitada (usa addToTeam do lado dela).
    IF NOT EXISTS (SELECT 1 FROM public.workers WHERE id = v_uid) THEN
        RAISE EXCEPTION 'not_a_worker' USING errcode = '42501';
    END IF;

    -- 6. Idempotência: já existe? Retorna sem tocar (respeita 'blocked' = veto do freela).
    SELECT * INTO v_row
    FROM public.team_connections
    WHERE company_id = v_company_id AND worker_id = v_uid;

    IF FOUND THEN
        RETURN v_row;
    END IF;

    -- 7. Ambos consentiram (empresa gerou+enviou o link; worker abriu) -> nasce 'accepted'.
    INSERT INTO public.team_connections (company_id, worker_id, status, source, accepted_at)
    VALUES (v_company_id, v_uid, 'accepted', 'link', now())
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.accept_company_invite_by_token(text) IS
    'Worker entra no elenco da empresa via link de convite (base64url(company_id)). '
    'SECURITY DEFINER: força worker_id=auth.uid() e status=accepted server-side, sem abrir INSERT direto ao worker. Idempotente; não reabre blocked.';

-- Sem GRANT EXECUTE a RPC via PostgREST (.rpc()) falha. authenticated = worker logado; service_role por consistência.
GRANT EXECUTE ON FUNCTION public.accept_company_invite_by_token(text) TO authenticated, service_role;

-- =============================================
-- DOWN (rollback manual):
--   DROP FUNCTION IF EXISTS public.accept_company_invite_by_token(text);
-- =============================================
