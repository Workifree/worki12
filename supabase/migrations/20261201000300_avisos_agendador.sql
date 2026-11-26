-- Migration: AVISOS MULTICANAL (3/3) - agendador (pg_cron + pg_net + Vault)
--
-- pg_net esta disponivel mas nao instalado em producao: tentamos instalar; se falhar, WARNING e a
-- migration segue (usar a alternativa abaixo). Nenhum segredo vive aqui: a funcao le do Vault
--   select vault.create_secret('<NOTICE_DISPATCH_SECRET>', 'notice_dispatch_secret');
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/notice-dispatch', 'notice_dispatch_url');
-- Sem os dois, nao ha chamada HTTP. Fila vazia: nao ha chamada HTTP.
--
-- ALTERNATIVA sem pg_net: qualquer cron externo a cada minuto (Supabase Dashboard > Integrations >
-- Cron, GitHub Actions, cron-job.org):
--   curl -X POST https://<ref>.supabase.co/functions/v1/notice-dispatch -H "x-dispatch-secret: $SEGREDO"
--
-- VERIFICAR depois de aplicar (via MCP os WARNING nao aparecem):
--   select jobname, schedule from cron.job where jobname like 'notice-%';  -- esperado 2
--   select public.internal_trigger_notice_dispatch();                     -- 'idle' ou 'requested'
--
-- DOWN:
--   select cron.unschedule('notice-dispatch'); select cron.unschedule('notice-purge');
--   DROP FUNCTION public.internal_trigger_notice_dispatch();
--   (pg_net pode ficar instalado.)

DO $$
BEGIN
    IF to_regclass('public.notice_deliveries') IS NULL THEN
        RAISE EXCEPTION 'PRE-CONDICAO avisos: aplicar 20261201000100 antes. HALT.';
    END IF;
    -- Instalar extensao de rede e decisao humana: a migration NAO instala o pg_net.
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
        RAISE WARNING 'avisos: pg_net ausente; notice-dispatch nao sera agendado (instalar e decisao humana).';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.internal_trigger_notice_dispatch()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_secret text;
    v_url    text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.notice_deliveries d
                    WHERE (d.status = 'pending' AND d.next_attempt_at <= pg_catalog.now())
                       OR (d.status = 'sending' AND d.claimed_at < pg_catalog.now() - interval '10 minutes')) THEN
        RETURN 'idle';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'net' AND p.proname = 'http_post') THEN
        RETURN 'no_pg_net';
    END IF;
    IF pg_catalog.to_regclass('vault.decrypted_secrets') IS NULL THEN RETURN 'no_vault'; END IF;

    EXECUTE 'select decrypted_secret from vault.decrypted_secrets where name = $1'
       INTO v_secret USING 'notice_dispatch_secret';
    EXECUTE 'select decrypted_secret from vault.decrypted_secrets where name = $1'
       INTO v_url USING 'notice_dispatch_url';
    IF COALESCE(v_secret, '') = '' OR COALESCE(v_url, '') !~ '^https://' THEN RETURN 'no_secret'; END IF;

    EXECUTE 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
      USING v_url, '{}'::jsonb,
            pg_catalog.jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret),
            30000;
    RETURN 'requested';
END;
$$;

REVOKE ALL ON FUNCTION public.internal_trigger_notice_dispatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_trigger_notice_dispatch() TO service_role;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE WARNING 'pg_cron ausente: avisos NAO serao despachados nem expurgados. Use cron externo.';
        RETURN;
    END IF;
    -- cron.schedule faz upsert por nome: reaplicar e seguro.
    PERFORM cron.schedule('notice-purge', '30 6 * * *', $cron$SELECT public.internal_purge_notices();$cron$);
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
        PERFORM cron.schedule('notice-dispatch', '* * * * *',
                              $cron$SELECT public.internal_trigger_notice_dispatch();$cron$);
    ELSE
        RAISE WARNING 'pg_net ausente: job notice-dispatch NAO agendado. Use cron externo.';
    END IF;
END $$;
