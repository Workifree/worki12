-- Migration: `jobs.slots` — quantas pessoas o turno precisa (F1 — Chamado de Turno)
-- File: supabase/migrations/20260817000000_jobs_slots.sql
-- Spec: .harness/spec/chamado-de-turno/spec.md (R1)
--
-- ============================================================================
-- POR QUE
-- ============================================================================
--   O turno hoje não tem contagem de posições. Sem ela não existe "vaga preenchida":
--   o disparo 1→N com primeiro-aceite (R4) não teria o que decrementar nem quando fechar.
--   `slots` é o denominador de tudo no F1 — "2 de 3 preenchidas".
--
--   Modelo de dados: o turno (`jobs`) é UM registro com N posições; cada posição preenchida
--   vira UMA `applications` com status 'hired'. Isso já é o comportamento de fato do schema
--   (não há UNIQUE(job_id) em applications; o UNIQUE é (job_id, worker_id)), e é o que o
--   marcador de pagamento por freela já assume desde ADR-20260816 ("turno com N freelas tem
--   N marcadores"). `slots` só torna a intenção explícita e verificável.
--
--   DEFAULT 1: todo turno existente vira "1 vaga", que é exatamente a semântica com que
--   foram criados. Nenhum backfill separado é necessário — o DEFAULT preenche as linhas
--   existentes no próprio ALTER.
--
-- Article 8 INTACTO: nenhuma tabela/RPC financeira tocada.
-- Risk: LOW. Coluna aditiva com default; nenhuma leitura existente muda.
--
-- ============================================================================
-- DOWN (rollback)
-- ============================================================================
--   ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_slots_positive;
--   ALTER TABLE public.jobs DROP COLUMN IF EXISTS slots;
--
-- ============================================================================
-- COMO VERIFICAR (read-only, depois de aplicar)
-- ============================================================================
--   V1. SELECT column_name, data_type, is_nullable, column_default
--         FROM information_schema.columns
--        WHERE table_schema='public' AND table_name='jobs' AND column_name='slots';
--       -- ESPERADO: slots | integer | NO | 1
--
--   V2. SELECT count(*) FILTER (WHERE slots IS NULL) AS nulos,
--              count(*) FILTER (WHERE slots < 1)     AS invalidos,
--              min(slots), max(slots) FROM public.jobs;
--       -- ESPERADO: 0 | 0 | 1 | 1  (toda a base herdou o default)
-- ============================================================================

ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS slots integer NOT NULL DEFAULT 1;

-- CHECK sem IF NOT EXISTS (Postgres não suporta para constraint) — DO block idempotente.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.jobs'::regclass
          AND conname  = 'jobs_slots_positive'
    ) THEN
        ALTER TABLE public.jobs
            ADD CONSTRAINT jobs_slots_positive CHECK (slots >= 1);
    END IF;
END $$;

COMMENT ON COLUMN public.jobs.slots IS
    'Quantas pessoas este turno precisa (>=1, default 1). Uma posição preenchida = uma '
    'applications com status hired/in_progress/completed. Denominador do Chamado de Turno '
    '(F1): o chamado fecha quando o nº de preenchidas alcança slots.';
