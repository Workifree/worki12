-- Migration: Agregados do worker na conclusão do turno (XP / nível / ganhos / nº de turnos)
-- File: supabase/migrations/20260710000000_worker_completion_aggregates.sql
--
-- BUG (relatado): na tela inicial do freela o NÍVEL não sobe, os GANHOS TOTAIS não
-- aumentam e o contador de turnos fica em 0 após concluir um turno.
--
-- CAUSA RAIZ: os campos workers.xp / workers.level / workers.earnings_total /
-- workers.completed_jobs_count eram apenas LIDOS pelo frontend, nunca ESCRITOS.
-- `addXP()` existe em lib/gamification.ts mas nunca é chamado, e não havia trigger.
-- Além disso, a conclusão do turno é disparada pela EMPRESA (applications.status=
-- 'completed'), e o RLS não deixa a empresa atualizar linhas de `workers` — por isso
-- a atualização precisa ser um trigger SECURITY DEFINER no banco.
--
-- DECISÃO: recomputo idempotente (self-healing) a partir da fonte da verdade
-- (applications concluídas + budget do turno), em vez de incrementos — assim
-- reprocessar nunca duplica e o backfill conserta o histórico existente.
--   - completed_jobs_count = nº de applications 'completed' do worker
--   - earnings_total       = soma do budget dos turnos concluídos
--   - xp                   = 100 XP por turno concluído (economia simples e determinística)
--   - level                = derivado do xp pelos limiares de lib/gamification.ts
--
-- NÃO toca saldo/escrow (Article 8): earnings_total é um agregado de EXIBIÇÃO, não a
-- carteira (wallets.balance). Nenhuma RPC de saldo é alterada.
--
-- DOWN (rollback):
--   DROP TRIGGER IF EXISTS trg_worker_completion_aggregates ON public.applications;
--   DROP FUNCTION IF EXISTS public.update_worker_completion_aggregates();
--   DROP FUNCTION IF EXISTS public.worker_level_for_xp(integer);

-- =============================================
-- 1. Garantir colunas de agregado em workers (idempotente)
-- =============================================
ALTER TABLE public.workers
    ADD COLUMN IF NOT EXISTS xp                  INTEGER  DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS level               INTEGER  DEFAULT 1 NOT NULL,
    ADD COLUMN IF NOT EXISTS earnings_total      NUMERIC  DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS completed_jobs_count INTEGER DEFAULT 0 NOT NULL;

-- =============================================
-- 2. Função de nível a partir do XP (espelha LEVELS de lib/gamification.ts)
--    IMMUTABLE — pura, sem I/O.
-- =============================================
CREATE OR REPLACE FUNCTION public.worker_level_for_xp(p_xp integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_xp >= 4500 THEN 10
        WHEN p_xp >= 3600 THEN 9
        WHEN p_xp >= 2800 THEN 8
        WHEN p_xp >= 2100 THEN 7
        WHEN p_xp >= 1500 THEN 6
        WHEN p_xp >= 1000 THEN 5
        WHEN p_xp >= 600  THEN 4
        WHEN p_xp >= 300  THEN 3
        WHEN p_xp >= 100  THEN 2
        ELSE 1
    END;
$$;

-- =============================================
-- 3. Recomputa os agregados de UM worker a partir das applications concluídas
--    SECURITY DEFINER: precisa contornar o RLS de workers (quem conclui é a empresa).
-- =============================================
CREATE OR REPLACE FUNCTION public.update_worker_completion_aggregates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_worker_id uuid;
    v_count     integer;
    v_earnings  numeric;
    v_xp        integer;
BEGIN
    -- worker_id do turno concluído (uuid). Guarda contra nulo.
    v_worker_id := NEW.worker_id;
    IF v_worker_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT
        COUNT(*)::int,
        COALESCE(SUM(j.budget), 0)
    INTO v_count, v_earnings
    FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.worker_id::text = v_worker_id::text
      AND a.status = 'completed';

    v_xp := v_count * 100;

    UPDATE public.workers
    SET
        completed_jobs_count = v_count,
        earnings_total       = v_earnings,
        xp                   = v_xp,
        level                = public.worker_level_for_xp(v_xp)
    WHERE id::text = v_worker_id::text;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Nunca bloquear a conclusão do turno por causa do agregado de exibição.
    RETURN NEW;
END;
$$;

-- Dispara sempre que uma application entra (ou é atualizada para) 'completed'.
-- Recompute idempotente: reprocessar não duplica.
DROP TRIGGER IF EXISTS trg_worker_completion_aggregates ON public.applications;
CREATE TRIGGER trg_worker_completion_aggregates
    AFTER INSERT OR UPDATE OF status ON public.applications
    FOR EACH ROW
    WHEN (NEW.status = 'completed')
    EXECUTE FUNCTION public.update_worker_completion_aggregates();

-- =============================================
-- 4. Backfill — conserta os agregados de todos os workers com turnos já concluídos
-- =============================================
WITH agg AS (
    SELECT
        a.worker_id,
        COUNT(*)::int                 AS cnt,
        COALESCE(SUM(j.budget), 0)    AS earnings
    FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.status = 'completed'
    GROUP BY a.worker_id
)
UPDATE public.workers w
SET
    completed_jobs_count = agg.cnt,
    earnings_total       = agg.earnings,
    xp                   = agg.cnt * 100,
    level                = public.worker_level_for_xp(agg.cnt * 100)
FROM agg
WHERE w.id::text = agg.worker_id::text;
