-- Ativa o despacho automático de avisos (E-mail via Resend + Web Push mobile) a cada minuto via pg_cron + pg_net.
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notice-dispatch-every-minute') THEN
    PERFORM cron.unschedule('notice-dispatch-every-minute');
  END IF;

  PERFORM cron.schedule(
    'notice-dispatch-every-minute',
    '* * * * *',
    $$
    SELECT net.http_post(
      url := 'https://vrklakcbkcsonarmhqhp.supabase.co/functions/v1/notice-dispatch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-dispatch-secret', '28fb01d6ffe1f006f842ccb604a62b6945a9a87c6d2d07592109cf9dae32215f'
      ),
      body := '{}'::jsonb
    );
    $$
  );
END;
$cron$;

SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'notice-dispatch-every-minute';
