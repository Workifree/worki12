-- Migration: Coluna `briefing` em jobs (briefing do turno escrito pela empresa) — Slice 1
-- File: supabase/migrations/20260622000500_add_briefing_to_jobs.sql
-- Fix do evaluator (finding F4): o `briefing` digitado em CompanyCreateJob NÃO persistia
-- nem chegava ao freela porque a tabela `jobs` não tinha a coluna. O frontend já envia
-- `briefing` no payload de insert/update (CompanyCreateJob.tsx) — sem a coluna, o PostgREST
-- descartava o campo silenciosamente.
--
-- Coluna TEXT nullable: jobs antigos ficam com briefing NULL (backfill desnecessário; o
-- briefing é opcional na criação do turno). Sem CHECK de tamanho — texto livre.
--
-- NÃO toca saldo/escrow. Sem RPC, sem GRANT EXECUTE financeiro.
--
-- RLS: nenhuma mudança. O SELECT de `jobs` já é USING (true) para `authenticated`
-- (migration 20260309000000_enable_rls_all_tables.sql) — qualquer freela autenticado lê
-- todas as colunas do job, então o `briefing` chega ao freela sem policy nova. O INSERT/
-- UPDATE pela empresa também já é coberto (company_id = auth.uid()).
--
-- DOWN (rollback):
--   ALTER TABLE public.jobs DROP COLUMN IF EXISTS briefing;

-- =============================================
-- 1. COLUNA briefing (nullable — backfill desnecessário; opcional no turno)
-- =============================================
ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS briefing text;

COMMENT ON COLUMN public.jobs.briefing IS 'Briefing do turno escrito pela empresa em CompanyCreateJob. Texto livre opcional, visível ao freela. NULL = sem briefing.';
