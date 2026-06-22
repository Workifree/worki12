-- Migration: Rating bidirecional — trigger de companies.rating_average/reviews_count — Slice 1
-- File: supabase/migrations/20260622000200_company_rating_trigger.sql
-- ADR: .harness/spec/v1-operacao-freelancer/adr-001-conexoes-convite.md
--
-- Hoje existe `update_worker_rating_on_review` (AFTER INSERT em reviews) que atualiza
-- workers.rating_average/reviews_count para CADA review (UPDATE workers WHERE id = reviewed_id).
-- Quando o reviewed_id é uma EMPRESA, esse UPDATE não encontra worker e não faz nada —
-- "seguro por acidente" (um auth.uid é worker XOR company), mas a empresa NUNCA tem rating
-- atualizado. Falta o espelho para companies.
--
-- DECISÃO DE DIREÇÃO (sem ambiguidade): adicionamos a coluna `reviews.direction`
-- ('worker' | 'company') indicando QUEM é o avaliado:
--   - direction='worker'  → company→worker (reviewed_id é um worker)  → atualiza workers
--   - direction='company' → worker→company (reviewed_id é uma company)→ atualiza companies
-- Isso torna a direção explícita e consultável, em vez de depender da coincidência de
-- "o id só existe numa das tabelas". Backfill resolve os reviews legados por presença em
-- workers/companies.
--
-- Tipos: reviews.reviewer_id/reviewed_id são TEXT (migration 20260314000008 usa
-- reviewer_id::text). companies.id/workers.id são UUID. As comparações usam cast explícito.
--
-- NÃO toca saldo/escrow. Sem RPC de saldo.
--
-- DOWN (rollback):
--   DROP TRIGGER IF EXISTS trg_update_company_rating ON reviews;
--   DROP FUNCTION IF EXISTS public.update_company_rating_on_review();
--   ALTER TABLE reviews DROP COLUMN IF EXISTS direction;
--   (o trigger de worker permanece; recriado abaixo para filtrar por direção)

-- =============================================
-- 1. Garantir colunas de rating em companies (idempotente)
-- =============================================
ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS rating_average NUMERIC,
    ADD COLUMN IF NOT EXISTS reviews_count  INTEGER DEFAULT 0 NOT NULL;

-- =============================================
-- 2. Coluna de direção em reviews (explícita, sem ambiguidade)
-- =============================================
ALTER TABLE public.reviews
    ADD COLUMN IF NOT EXISTS direction text
        CHECK (direction IS NULL OR direction IN ('worker', 'company'));

COMMENT ON COLUMN public.reviews.direction IS 'Quem é o avaliado: worker (company→worker) ou company (worker→company). Define qual tabela o trigger de rating atualiza.';

-- Backfill: inferir direção dos reviews existentes pela presença do reviewed_id em cada tabela.
UPDATE public.reviews r
SET direction = 'worker'
WHERE r.direction IS NULL
  AND EXISTS (SELECT 1 FROM public.workers w WHERE w.id::text = r.reviewed_id::text);

UPDATE public.reviews r
SET direction = 'company'
WHERE r.direction IS NULL
  AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id::text = r.reviewed_id::text);

-- =============================================
-- 2b. Auto-preencher `direction` no INSERT (self-healing)
--     Se o client não enviar direction, inferimos pela presença do reviewed_id em
--     companies/workers. Assim o rating bidirecional funciona mesmo que o service/UI
--     ainda não passe direction explicitamente — sem footgun para o builder.
--     BEFORE INSERT para gravar o valor na própria linha.
-- =============================================
CREATE OR REPLACE FUNCTION public.set_review_direction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.direction IS NULL THEN
        IF EXISTS (SELECT 1 FROM public.companies c WHERE c.id::text = NEW.reviewed_id::text) THEN
            NEW.direction := 'company';
        ELSIF EXISTS (SELECT 1 FROM public.workers w WHERE w.id::text = NEW.reviewed_id::text) THEN
            NEW.direction := 'worker';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_review_direction ON public.reviews;
CREATE TRIGGER trg_set_review_direction
    BEFORE INSERT ON public.reviews
    FOR EACH ROW
    EXECUTE FUNCTION public.set_review_direction();

-- =============================================
-- 3. Recriar o trigger de WORKER para agir só na direção 'worker'
--    (tolerante a direction NULL — legado — mantendo comportamento atual)
-- =============================================
CREATE OR REPLACE FUNCTION public.update_worker_rating_on_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Só atualiza worker quando a review é direcionada a um worker.
    -- direction NULL (review legada) cai aqui também: o UPDATE filtra por id, então é no-op
    -- se reviewed_id não for um worker — preservando o comportamento "seguro por acidente".
    IF NEW.direction IS DISTINCT FROM 'company' THEN
        UPDATE public.workers
        SET
            rating_average = (
                SELECT ROUND(AVG(rating)::numeric, 1)
                FROM public.reviews
                WHERE reviewed_id::text = NEW.reviewed_id::text
                  AND (direction IS NULL OR direction = 'worker')
            ),
            reviews_count = (
                SELECT COUNT(*)
                FROM public.reviews
                WHERE reviewed_id::text = NEW.reviewed_id::text
                  AND (direction IS NULL OR direction = 'worker')
            )
        WHERE id::text = NEW.reviewed_id::text;
    END IF;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Não bloquear o insert da review se o update de rating falhar.
    RETURN NEW;
END;
$$;

-- =============================================
-- 4. Trigger de COMPANY (espelho)
-- =============================================
CREATE OR REPLACE FUNCTION public.update_company_rating_on_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Só atualiza company quando a review é direcionada a uma company.
    IF NEW.direction = 'company' THEN
        UPDATE public.companies
        SET
            rating_average = (
                SELECT ROUND(AVG(rating)::numeric, 1)
                FROM public.reviews
                WHERE reviewed_id::text = NEW.reviewed_id::text
                  AND direction = 'company'
            ),
            reviews_count = (
                SELECT COUNT(*)
                FROM public.reviews
                WHERE reviewed_id::text = NEW.reviewed_id::text
                  AND direction = 'company'
            )
        WHERE id::text = NEW.reviewed_id::text;
    END IF;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_company_rating ON public.reviews;
CREATE TRIGGER trg_update_company_rating
    AFTER INSERT ON public.reviews
    FOR EACH ROW
    EXECUTE FUNCTION public.update_company_rating_on_review();

-- (o trigger trg_update_worker_rating já existe e aponta para a função recriada acima)

-- =============================================
-- 5. Backfill dos agregados de companies a partir dos reviews 'company'
-- =============================================
UPDATE public.companies c
SET
    rating_average = sub.avg_rating,
    reviews_count  = sub.cnt
FROM (
    SELECT reviewed_id,
           ROUND(AVG(rating)::numeric, 1) AS avg_rating,
           COUNT(*)                        AS cnt
    FROM public.reviews
    WHERE direction = 'company'
    GROUP BY reviewed_id
) sub
WHERE c.id::text = sub.reviewed_id::text;
