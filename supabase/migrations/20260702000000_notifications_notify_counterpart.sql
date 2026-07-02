-- Migration: INSERT em `notifications` pode notificar a CONTRAPARTE de um vínculo aceito
-- File: supabase/migrations/20260702000000_notifications_notify_counterpart.sql
-- Contexto: fluxo push (Slice 1 / pivô empresa-primeiro) — ver .harness/memory-bank/architecture.md
--
-- PROBLEMA (HIGH, funcional — achado no E2E de produção):
--   A policy de INSERT criada em 20260623000200_notifications_insert_policy.sql usa
--   WITH CHECK (auth.uid() = user_id): só deixa o usuário inserir notificação PARA SI MESMO.
--   O fluxo push precisa notificar a CONTRAPARTE:
--     - Empresa notifica o worker ao convidar pra turno
--       (shiftInviteService.inviteWorkerToShift → insert com user_id = workerId).
--     - Worker notifica a empresa ao aceitar o convite / falha de cartão
--       (shiftInviteService → insert com user_id = companyOwnerId).
--   Resultado: POST /rest/v1/notifications → 403 → InviteTakeover (tela cheia) e o sino
--   NÃO disparam (dependem do INSERT em notifications + Realtime). O freela só via o convite
--   na aba Convites. Degrada a "notificação por todos os meios" que é parte da operação.
--
-- FIX:
--   Substitui a policy de INSERT por uma que permite:
--     (a) SELF   — auth.uid() = user_id  (preserva spendLimitService.evaluateSpendAlert,
--                  em que o owner da empresa insere o alerta de teto PARA SI MESMO);  OU
--     (b) CONTRAPARTE CONECTADA — existe team_connections com status='accepted' ligando
--         auth.uid() ao user_id alvo, nas DUAS direções:
--           - empresa (company_id = auth.uid()) notificando worker do seu Elenco
--             (worker_id = user_id);
--           - worker (worker_id = auth.uid()) notificando a empresa conectada
--             (company_id = user_id).
--   Invariante usada (documentada em 20260622000000_team_connections.sql):
--     companies.id = companies.owner_id = auth.uid()  e  workers.id = auth.uid().
--   Logo team_connections.company_id = auth.uid() (lado empresa) e
--   team_connections.worker_id = auth.uid() (lado worker) são comparações diretas e corretas,
--   e o user_id alvo da notificação (companyOwnerId) = company_id.
--
-- POR QUE NÃO É VETOR DE SPAM:
--   - Só pares MUTUAMENTE CONSENTIDOS (handshake de equipe aceito) podem se notificar.
--     A empresa só notifica workers que aceitaram entrar no seu Elenco; o worker só notifica
--     empresas a que está conectado. Não há user→user arbitrário.
--   - status DEVE ser 'accepted': conexões 'pending' ou 'blocked' NÃO autorizam INSERT.
--     Se o freela bloqueia a loja (status='blocked'), as notificações da empresa param.
--   - Não ampliamos para `applications`: o convite push já exige team_connection aceita
--     (a política de INSERT de applications só deixa convidar membro aceito), então
--     team_connections cobre o fluxo com a MENOR superfície. Incluir applications abriria
--     candidaturas pull/pendentes como canal de notificação — desnecessário e mais largo.
--
-- COMPATIBILIDADE / SEGURANÇA:
--   - Triggers SECURITY DEFINER que inserem notifications (ex.: notify_on_new_message) rodam
--     como owner → não passam por RLS de authenticated → intactos.
--   - service_role (send-notification, edge functions) bypassa RLS → intacto.
--   - Article 4 (RLS 1ª linha de defesa) mantido; Article 9 não se aplica (notifications não é
--     tabela financeira / não move saldo).
--   - GRANT: `authenticated` JÁ possui INSERT em public.notifications (a policy self-only da
--     20260623000200 funcionava para o alerta de teto). Nada a alterar em GRANT — o que muda é a
--     policy. GRANT idempotente incluído abaixo por robustez (no-op se já existe).
--   - Idempotente: DROP POLICY IF EXISTS da policy antiga E da nova antes do CREATE.
--
-- DOWN (rollback):
--   DROP POLICY IF EXISTS "notifications_insert_self_or_connected" ON public.notifications;
--   CREATE POLICY "Users insert own notifications" ON public.notifications
--     FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

GRANT INSERT ON public.notifications TO authenticated;

-- Remove a policy antiga (self-only) e qualquer resíduo da nova.
DROP POLICY IF EXISTS "Users insert own notifications" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_self_or_connected" ON public.notifications;

CREATE POLICY "notifications_insert_self_or_connected"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- (a) SELF: inserir na própria caixa (ex.: alerta de teto de gasto)
    auth.uid() = notifications.user_id
    -- (b) CONTRAPARTE de um vínculo de equipe ACEITO (as duas direções)
    OR EXISTS (
      SELECT 1
      FROM public.team_connections tc
      WHERE tc.status = 'accepted'
        AND (
          -- empresa (auth.uid()) notificando worker do seu Elenco
          (tc.company_id = auth.uid() AND tc.worker_id = notifications.user_id)
          -- worker (auth.uid()) notificando a empresa conectada
          OR (tc.worker_id = auth.uid() AND tc.company_id = notifications.user_id)
        )
    )
  );
