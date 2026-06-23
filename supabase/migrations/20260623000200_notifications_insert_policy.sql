-- Migration: Policy de INSERT em `notifications` para `authenticated` — Slice 3 (R12)
-- File: supabase/migrations/20260623000200_notifications_insert_policy.sql
-- Spec: .harness/spec/v1-operacao-freelancer/spec.md (R12 — alerta de teto de gasto)
--
-- PROBLEMA (HIGH, funcional — security-reviewer Slice 3):
--   A tabela public.notifications (criada em 20250209120000 / reforçada em 20250209130000)
--   tem RLS habilitado com policies de SELECT e UPDATE por user_id, mas NENHUMA policy de
--   INSERT para o papel `authenticated`. Com RLS ligado, ausência de policy = deny implícito.
--   → spendLimitService.evaluateSpendAlert insere a notificação de alerta via client
--     (role authenticated, o owner da empresa inserindo para si mesmo) e o INSERT é bloqueado.
--   → o alerta de teto NUNCA é gravado.
--
-- FIX:
--   Adiciona policy de INSERT FOR authenticated WITH CHECK (auth.uid() = user_id).
--   O inserter do alerta é o owner da empresa criando a notificação para si próprio,
--   logo auth.uid() = user_id é a checagem correta e segura (não permite escrever na
--   caixa de outro usuário).
--
-- COMPATIBILIDADE:
--   - Triggers SECURITY DEFINER que inserem notifications (ex.: notify_on_new_message,
--     20260312000000) rodam como definer/owner → não passam por RLS de authenticated → intactos.
--   - service_role (send-notification, edge functions) faz bypass de RLS → intacto.
--   - `notifications` JÁ É DEPLOYADA → esta é uma migration NOVA aditiva, não edição in-place.
--   - Não há outra policy de INSERT em notifications (verificado: 20250209120000 e
--     20250209130000 só declaram SELECT + UPDATE). DROP IF EXISTS torna a migration idempotente.
--
-- DOWN (rollback): DROP POLICY IF EXISTS "Users insert own notifications" ON public.notifications;

DROP POLICY IF EXISTS "Users insert own notifications" ON public.notifications;
CREATE POLICY "Users insert own notifications"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
