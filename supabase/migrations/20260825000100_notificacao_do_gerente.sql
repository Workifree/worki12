-- Migration: gerente disparava chamado e ninguem era notificado
--
-- ACHADO (25/08/2026, fechando a varredura de policies fora do seam): a unica que faltava era
-- `notifications_insert_self_or_connected`, com a ancora antiga:
--     tc.company_id = auth.uid()
--
-- O cliente insere notificacao DIRETO em tres pontos -- disparo de chamado
-- (shiftCallService) e dois caminhos de convite (shiftInviteService) -- e o insert e
-- best-effort: "o chamado ja existe; aviso nao bloqueia". Ou seja, para um GERENTE de unidade o
-- chamado seria criado e o freela nao receberia nada: nem notificacao, nem realtime. Falha muda,
-- no caminho mais importante do produto.
--
-- Nao atinge dono hoje: as 7 empresas reais tem `id = owner_id`, entao `tc.company_id =
-- auth.uid()` casa para elas. Atinge quem opera sem SER a empresa -- gerente, e dono ancorado por
-- `companies.owner_id` se aparecer.
--
-- Passa a usar `is_company_owner(tc.company_id)`, o mesmo seam de todas as outras camadas
-- corrigidas em 20260824000100/000200/000300. Com esta, nao sobra policy nem funcao decidindo
-- "quem e a empresa?" por conta propria em caminho que o gerente percorre.
--
-- O ramo do FRELA (worker avisando a empresa) nao muda: continua `tc.worker_id = auth.uid()`.
--
-- Article 8: nao toca saldo.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname='public' AND tablename='notifications'
           AND policyname='notifications_insert_self_or_connected'
    ) THEN
        RAISE EXCEPTION
          'ASSERCAO: a policy alvo nao existe mais em notifications -- reconferir antes de '
          'recriar, para nao ressuscitar regra vencida.';
    END IF;
END $$;

DROP POLICY "notifications_insert_self_or_connected" ON public.notifications;

CREATE POLICY "notifications_insert_self_or_connected"
    ON public.notifications
    FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        OR EXISTS (
            SELECT 1
              FROM public.team_connections tc
             WHERE tc.status = 'accepted'
               AND (
                     -- Empresa avisando o freela: quem OPERA a empresa (dono direto, dono via
                     -- owner_id, ou gerente ativo) -- nao apenas quem E a empresa.
                     (public.is_company_owner(tc.company_id) AND tc.worker_id = notifications.user_id)
                     -- Freela avisando a empresa: inalterado.
                  OR (tc.worker_id = auth.uid() AND tc.company_id = notifications.user_id)
                 )
        )
    );

COMMENT ON POLICY "notifications_insert_self_or_connected" ON public.notifications IS
    'Quem pode criar aviso para outra pessoa: para si mesmo sempre; da empresa para o freela '
    'quando ha vinculo ACEITO e a sessao OPERA a empresa (is_company_owner -- inclui gerente); e '
    'do freela para a empresa do vinculo. Ate 20260825000100 o lado da empresa era '
    '`tc.company_id = auth.uid()`, e o gerente disparava chamado sem ninguem ser notificado.';
