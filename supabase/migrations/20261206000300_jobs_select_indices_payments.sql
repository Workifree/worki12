-- Indice de apoio ao ramo do freela em jobs_select_scoped: shift_payments por (job_id, worker_id) INCLUINDO voided.
-- O unico indice com as duas colunas e parcial (scheduled/recorded); os demais sao so job_id ou so worker_id.
-- CONCURRENTLY: sem transacao, um statement por arquivo.
-- DOWN: DROP INDEX CONCURRENTLY IF EXISTS public.idx_shift_payments_job_worker;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shift_payments_job_worker
    ON public.shift_payments (job_id, worker_id);
