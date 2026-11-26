-- Fecha o EXECUTE de `anon` nas funcoes SECURITY DEFINER que movem saldo (falha pre-existente).
-- File: supabase/migrations/20261126000200_funcoes_de_saldo_sem_anon.sql
--
-- Causa: EXECUTE nasce concedido a PUBLIC e os default privileges do Supabase ainda concedem
-- DIRETO a anon/authenticated. Os GRANTs antigos nunca revogaram isso. update_wallet_balance e
-- credit_deposit nao checam auth; release/refund/reserve_escrow pulam a checagem de dono quando
-- auth.uid() e NULL, que e justamente o caso do anon.
--
-- Chamadores levantados (branch atual e main):
--   so service_role (Edge Functions) ou gatilho DEFINER -> perdem PUBLIC, anon e authenticated:
--     update_wallet_balance    asaas-withdraw
--     credit_deposit           asaas-webhook, asaas-sync, admin-data
--     release_escrow           asaas-checkout; trigger auto_release_escrow_on_completion
--     reserve_escrow           trigger auto_reserve_escrow_on_hire (WalletService.reserveEscrow
--                              existe, mas nao tem nenhum call site)
--     authorize_escrow_postpago  asaas-authorize-payment, asaas-capture-payment
--     capture_escrow_postpago    asaas-capture-payment
--     release_hold_postpago      asaas-release-hold
--   chamadas com JWT do usuario -> perdem PUBLIC e anon, mantem authenticated:
--     refund_escrow            WalletService.refundEscrow (CompanyJobs, CompanyJobDetails)
--     increment_worker_view    services/analytics.ts (company/WorkerPublicProfile)
--     increment_job_view       services/analytics.ts (nao existe nas migrations; tratada se existir)
--     recompute_my_aggregates  pages/Profile.tsx
--   get_member_invite_preview e publica de proposito: nao e tocada.
--
-- Nenhum corpo de funcao muda. Nenhum saldo e movido. Idempotente.
-- Tudo em um unico DO: pre-condicao ou assercao que falhe desfaz todos os REVOKE/GRANT.
--
-- ATENCAO para migrations futuras: CREATE OR REPLACE preserva a ACL, mas DROP + CREATE (ou uma
-- sobrecarga nova) volta a nascer aberta a anon e precisa repetir REVOKE/GRANT.

DO $migration$
DECLARE
    -- Somente service_role (e o dono, usado pelos gatilhos DEFINER).
    c_servidor CONSTANT text[] := ARRAY[
        'update_wallet_balance', 'credit_deposit', 'release_escrow', 'reserve_escrow',
        'authorize_escrow_postpago', 'capture_escrow_postpago', 'release_hold_postpago'];
    -- authenticated + service_role.
    c_usuario CONSTANT text[] := ARRAY[
        'refund_escrow', 'increment_worker_view', 'increment_job_view', 'recompute_my_aggregates'];
    c_obrigatorias CONSTANT text[] := ARRAY[
        'update_wallet_balance', 'credit_deposit', 'release_escrow', 'reserve_escrow',
        'refund_escrow', 'authorize_escrow_postpago', 'capture_escrow_postpago',
        'release_hold_postpago'];
    v_nome text;
    v_regex_servidor text;
    r record;
BEGIN
    -- ---------------------------------------------------------------- pre-condicoes
    FOREACH v_nome IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_nome) THEN
            RAISE EXCEPTION 'pre-condicao: role % ausente', v_nome;
        END IF;
    END LOOP;

    FOREACH v_nome IN ARRAY c_obrigatorias LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc p
             WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_nome) THEN
            RAISE EXCEPTION 'pre-condicao: funcao public.% ausente', v_nome;
        END IF;
    END LOOP;

    -- Os dois gatilhos que chamam RPC de saldo precisam ser DEFINER, senao o REVOKE quebra
    -- contratacao/conclusao de turno.
    FOR r IN
        SELECT p.proname, p.prosecdef
          FROM pg_catalog.pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname IN ('auto_reserve_escrow_on_hire', 'auto_release_escrow_on_completion')
    LOOP
        IF NOT r.prosecdef THEN
            RAISE EXCEPTION 'pre-condicao: % e SECURITY INVOKER e quebraria com o REVOKE', r.proname;
        END IF;
    END LOOP;

    -- Qualquer outra funcao INVOKER que chame uma RPC "so servidor" (comentarios ignorados).
    v_regex_servidor := '[[:<:]](' || array_to_string(c_servidor, '|') || ')[[:space:]]*\(';
    FOR r IN
        SELECT p.oid::regprocedure AS assinatura
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
           AND NOT p.prosecdef
           AND p.proname <> ALL (c_servidor)
           AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* v_regex_servidor
    LOOP
        RAISE EXCEPTION 'pre-condicao: funcao INVOKER % chama RPC de saldo', r.assinatura;
    END LOOP;

    -- ---------------------------------------------------------------- REVOKE / GRANT
    -- Por pg_proc: cobre todas as sobrecargas, inclusive as criadas fora do repositorio.
    FOR r IN
        SELECT p.oid::regprocedure AS assinatura, p.proname
          FROM pg_catalog.pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND p.prokind = 'f'
           AND p.prorettype <> 'trigger'::regtype
           AND p.proname = ANY (c_servidor || c_usuario)
    LOOP
        IF r.proname = ANY (c_servidor) THEN
            EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.assinatura);
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.assinatura);
        ELSE
            EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.assinatura);
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.assinatura);
        END IF;
    END LOOP;

    -- ---------------------------------------------------------------- assercoes finais
    -- has_function_privilege enxerga PUBLIC e heranca de role; pega tambem REVOKE que virou
    -- no-op porque o GRANT original foi feito por outro grantor.
    FOR r IN
        SELECT p.oid, p.oid::regprocedure AS assinatura, p.proname
          FROM pg_catalog.pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND p.prokind = 'f'
           AND p.prorettype <> 'trigger'::regtype
           AND p.proname = ANY (c_servidor || c_usuario)
    LOOP
        IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'assercao: anon ainda executa %', r.assinatura;
        END IF;
        IF NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'assercao: service_role sem EXECUTE em %', r.assinatura;
        END IF;
        IF has_function_privilege('authenticated', r.oid, 'EXECUTE') IS DISTINCT FROM (r.proname = ANY (c_usuario)) THEN
            RAISE EXCEPTION 'assercao: EXECUTE de authenticated divergente em %', r.assinatura;
        END IF;
    END LOOP;

    -- Toda funcao DEFINER que chama uma RPC "so servidor" roda como o proprio dono:
    -- esse dono precisa continuar com EXECUTE.
    FOR r IN
        SELECT c.oid::regprocedure AS chamador, t.oid::regprocedure AS alvo
          FROM pg_catalog.pg_proc c
          JOIN pg_catalog.pg_proc t
            ON t.pronamespace = 'public'::regnamespace
           AND t.proname = ANY (c_servidor)
           AND c.oid <> t.oid
           AND regexp_replace(c.prosrc, '--[^\n]*', '', 'g') ~* ('[[:<:]]' || t.proname || '[[:space:]]*\(')
         WHERE c.prosecdef
           AND NOT has_function_privilege(c.proowner, t.oid, 'EXECUTE')
    LOOP
        RAISE EXCEPTION 'assercao: dono de % perdeu EXECUTE em %', r.chamador, r.alvo;
    END LOOP;
END
$migration$;

NOTIFY pgrst, 'reload schema';

-- DOWN (rollback). ATENCAO: reabre a falha (anon volta a mover saldo). Prefira conceder apenas
-- o papel/funcao que faltou, por exemplo:
--   GRANT EXECUTE ON FUNCTION public.reserve_escrow(uuid, numeric, uuid) TO authenticated;
-- Rollback integral do estado anterior:
--   GRANT EXECUTE ON FUNCTION public.update_wallet_balance(uuid, numeric) TO PUBLIC, anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.credit_deposit(uuid, numeric, text, text) TO PUBLIC, anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.release_escrow(uuid, uuid) TO PUBLIC, anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.reserve_escrow(uuid, numeric, uuid) TO PUBLIC, anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.refund_escrow(uuid, text) TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION public.authorize_escrow_postpago(uuid, uuid, numeric, text, uuid) TO PUBLIC, anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.capture_escrow_postpago(uuid, uuid) TO PUBLIC, anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.release_hold_postpago(uuid, text) TO PUBLIC, anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.increment_worker_view(uuid) TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION public.recompute_my_aggregates() TO anon;
--   (increment_job_view: conferir a assinatura no catalogo antes.)
--   NOTIFY pgrst, 'reload schema';
