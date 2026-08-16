-- Migration: devolve EXECUTE a `authenticated` nas duas funcoes de TRIGGER
-- File: supabase/migrations/20260816201457_restore_execute_authenticated_trigger_functions.sql
--
-- Reverte parcialmente a 20260816201420, que revogou EXECUTE de PUBLIC/anon/authenticated nas
-- funcoes de trigger por causa do lint 0028 do advisor.
--
-- Por que reverter para `authenticated`: o lint e FALSO POSITIVO em funcao de trigger — o
-- PostgREST nao expoe funcoes cujo tipo de retorno e `trigger`, e o Postgres recusa chamada
-- direta ("trigger functions can only be called as triggers"). Manter o REVOKE de `authenticated`
-- traria risco assimetrico: se o disparo do trigger checar a permissao do papel chamador, a
-- empresa deixaria de conseguir registrar pagamento e cancelar turno — regressao severa — em
-- troca de fechar uma superficie que nao existe.
--
-- O REVOKE de `anon` da migration anterior PERMANECE (defesa em profundidade, custo zero).
--
-- Verificado em producao apos aplicar (INSERT em shift_payments dentro de transacao, com rollback):
-- o trigger disparou e gerou a notificacao correta para o worker.
--
-- Article 8 intacto. Nenhuma policy alterada.
--
-- DOWN (rollback):
--   REVOKE EXECUTE ON FUNCTION public.notify_worker_on_shift_payment() FROM authenticated;
--   REVOKE EXECUTE ON FUNCTION public.notify_counterpart_on_application_cancel() FROM authenticated;

GRANT EXECUTE ON FUNCTION public.notify_worker_on_shift_payment() TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_counterpart_on_application_cancel() TO authenticated;
