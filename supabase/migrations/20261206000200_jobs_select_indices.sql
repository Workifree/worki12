-- Indice de apoio ao ramo do freela em jobs_select_scoped (session_is_job_participant).
-- CONCURRENTLY: sem transacao, um statement por arquivo. Rodar DEPOIS de 20261206000100.
-- Cobertura verificada no catalogo (27/11/2026): applications ja tem applications_job_worker_unique (job_id, worker_id);
-- shift_calls ja tem idx_shift_calls_job (job_id); shift_call_targets so tem indices que nao comecam por worker_id
-- (os de worker_id sao parciais). Este cobre o EXISTS por worker.
-- DOWN: DROP INDEX CONCURRENTLY IF EXISTS public.idx_shift_call_targets_worker_call;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shift_call_targets_worker_call
    ON public.shift_call_targets (worker_id, call_id);
