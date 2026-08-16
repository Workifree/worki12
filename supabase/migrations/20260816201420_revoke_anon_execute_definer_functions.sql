-- Migration: revoga EXECUTE de `anon` nas funcoes SECURITY DEFINER desta leva
-- File: supabase/migrations/20260816201420_revoke_anon_execute_definer_functions.sql
--
-- Contexto: o advisor de seguranca do Supabase (lint 0028, anon_security_definer_function_executable)
-- sinalizou que `can_view_worker_profile`, `notify_worker_on_shift_payment` e
-- `notify_counterpart_on_application_cancel` podiam ser executadas pelo papel `anon` via
-- /rest/v1/rpc/<nome>. Causa: no Postgres, EXECUTE em funcao e concedido a PUBLIC por padrao —
-- um GRANT explicito a `authenticated` NAO revoga o acesso herdado.
--
-- A 20260816130000 ja fazia esse REVOKE para `get_profile_reviews` e `mask_display_name`;
-- as tres funcoes acima ficaram de fora.
--
-- Severidade real:
--   - can_view_worker_profile: baixa (retorna so boolean, e com anon auth.uid() e NULL -> false),
--     mas e higiene e superficie de API desnecessaria.
--   - as duas funcoes de trigger: FALSO POSITIVO do lint — o PostgREST nao expoe funcoes cujo
--     retorno e `trigger`, e o Postgres recusa chamada direta. O REVOKE de `anon` fica assim
--     mesmo (custo zero); o de `authenticated` foi revertido na migration seguinte
--     (20260816201457) para nao arriscar o disparo do trigger.
--
-- Article 8 intacto (nao move saldo). Nenhuma policy alterada.
--
-- DOWN (rollback):
--   GRANT EXECUTE ON FUNCTION public.can_view_worker_profile(uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.notify_worker_on_shift_payment() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.notify_counterpart_on_application_cancel() TO PUBLIC;

REVOKE EXECUTE ON FUNCTION public.can_view_worker_profile(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_view_worker_profile(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.can_view_worker_profile(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.notify_worker_on_shift_payment() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_worker_on_shift_payment() FROM anon;

REVOKE EXECUTE ON FUNCTION public.notify_counterpart_on_application_cancel() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_counterpart_on_application_cancel() FROM anon;
