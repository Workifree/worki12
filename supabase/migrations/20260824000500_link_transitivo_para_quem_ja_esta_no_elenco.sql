-- Migration: quem JA esta no elenco pode repassar o link (crescimento fechado e transitivo)
--
-- Complemento de 20260824000400. Ao trocar o token derivavel por um segredo com RLS restrita ao
-- operador da empresa, uma feature legitima caiu junto: o botao "Repassar link da empresa X" na
-- Carteira de Clientes do freela. Ele existe de proposito -- e o mecanismo de crescimento do
-- produto: fechado, mas transitivo (quem a empresa aceitou pode apresenta-la a outro freela).
--
-- Com a policy so do operador, o freela nao le o token da propria empresa e o botao morre.
--
-- A leitura passa a valer tambem para quem tem vinculo ACEITO com aquela empresa. Isso preserva a
-- intencao e mantem o buraco fechado: quem nunca foi aceito continua sem ver token nenhum, e um
-- token derivado do id publico continua invalido.
--
-- 'pending' NAO le -- alinhado a DS-PII-1 (20260821000300): 'pending' e "quero", 'accepted' e
-- "pode". 'blocked' tambem nao: veto do freela nao vira canal de divulgacao.
--
-- O risco residual e inerente ao link transitivo, nao introduzido aqui: um membro do elenco pode
-- publicar o token. O remedio e a rotacao, que ja existe (get_company_invite_token(true)) e
-- invalida o anterior.
--
-- Article 8: nao toca saldo.

DROP POLICY IF EXISTS cil_select_operator ON public.company_invite_links;

CREATE POLICY cil_select_operator_ou_elenco ON public.company_invite_links
    FOR SELECT
    USING (
        public.is_company_owner(company_id)
        OR EXISTS (
            SELECT 1 FROM public.team_connections tc
             WHERE tc.company_id = company_invite_links.company_id
               AND tc.worker_id  = auth.uid()
               AND tc.status     = 'accepted'
        )
    );

COMMENT ON POLICY cil_select_operator_ou_elenco ON public.company_invite_links IS
    'Le o token: quem OPERA a empresa, e quem tem vinculo ACEITO com ela (o link transitivo da '
    'Carteira de Clientes). pending e blocked nao leem -- mesma regra de DS-PII-1: pending e '
    '"quero", accepted e "pode".';
