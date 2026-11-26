-- Indices da presenca verificada. RODAR FORA DE TRANSACAO (CONCURRENTLY), um comando por vez.
-- Se um falhar no meio, o indice fica INVALID: DROP INDEX e rodar de novo.
-- DOWN: DROP INDEX CONCURRENTLY IF EXISTS public.idx_presence_checks_job;
--       DROP INDEX CONCURRENTLY IF EXISTS public.idx_company_sites_company;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_presence_checks_job ON public.presence_checks (job_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_company_sites_company ON public.company_sites (company_id);
