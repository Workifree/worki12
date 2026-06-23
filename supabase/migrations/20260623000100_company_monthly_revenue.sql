-- Migration: Faturamento mensal informado pela empresa (R14) — Slice 3 (inteligência financeira)
-- File: supabase/migrations/20260623000100_company_monthly_revenue.sql
-- Spec: .harness/spec/v1-operacao-freelancer/spec.md (R14)
--
-- CONTEXTO (R14 — custo-%-faturamento, a "métrica de ouro" do food service):
--   O custo-por-hora é DERIVADO (gasto/horas, sem armazenar). Mas o custo-como-%-do-faturamento
--   exige UM número que o sistema não conhece: o faturamento mensal da empresa. Esta tabela guarda
--   esse único número por (empresa, mês). A empresa digita 1 valor/mês → unlock barato da métrica.
--
-- NÃO toca saldo/escrow. Sem RPC de saldo, sem GRANT EXECUTE financeiro (Article 8 intacto).
--   É puro input declarativo da empresa; o ratio (custo/faturamento) é calculado por query no service.
--
-- MODELO DE IDENTIDADE: company_id = companies.id = auth.uid() (igual payment_methods / spend_limits).
--
-- SOBRE `year_month`: usamos DATE ancorada no DIA 1 do mês (ex.: 2026-06-01 = junho/2026), NÃO TEXT.
--   Razão: DATE permite range/ordenação/agregação por período direto em SQL (BETWEEN, date_trunc),
--   evita o inferno de parse de 'YYYY-MM' string, e o builder normaliza com date_trunc('month', x)::date.
--   Um CHECK garante a âncora no dia 1 (sem meses "no meio").
--
-- DOWN (rollback): DROP TABLE IF EXISTS public.company_monthly_revenue CASCADE;

-- =============================================
-- 1. TABELA
-- =============================================
CREATE TABLE IF NOT EXISTS public.company_monthly_revenue (
    id          uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id  uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    -- mês de competência, ancorado no dia 1 (ex.: 2026-06-01). date_trunc('month', x)::date no service.
    year_month  date          NOT NULL CHECK (year_month = date_trunc('month', year_month)::date),
    -- faturamento bruto declarado pela empresa naquele mês (BRL). >= 0 (0 = informou que não faturou).
    amount      numeric(14,2) NOT NULL CHECK (amount >= 0),
    created_at  timestamptz   NOT NULL DEFAULT now(),
    updated_at  timestamptz   NOT NULL DEFAULT now(),
    -- um faturamento por (empresa, mês) → re-digitar atualiza (upsert), não duplica.
    CONSTRAINT company_monthly_revenue_unique UNIQUE (company_id, year_month)
);

COMMENT ON TABLE  public.company_monthly_revenue IS 'Faturamento mensal declarado pela empresa (R14). Input p/ custo-%-faturamento. Não materializa custo (derivado de escrow).';
COMMENT ON COLUMN public.company_monthly_revenue.year_month IS 'Mês de competência ancorado no dia 1 (DATE). date_trunc(month) no service.';
COMMENT ON COLUMN public.company_monthly_revenue.amount     IS 'Faturamento bruto declarado naquele mês (BRL, >= 0).';

-- =============================================
-- 2. ÍNDICES (tabela nova/vazia → CREATE INDEX simples é seguro)
-- =============================================
CREATE INDEX IF NOT EXISTS idx_company_monthly_revenue_company
    ON public.company_monthly_revenue (company_id, year_month);

-- trigger utilitário de updated_at (mesmo padrão de team_connections / payment_methods)
CREATE OR REPLACE FUNCTION public.set_company_monthly_revenue_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_monthly_revenue_updated_at ON public.company_monthly_revenue;
CREATE TRIGGER trg_company_monthly_revenue_updated_at
    BEFORE UPDATE ON public.company_monthly_revenue
    FOR EACH ROW
    EXECUTE FUNCTION public.set_company_monthly_revenue_updated_at();

-- =============================================
-- 3. RLS
-- =============================================
ALTER TABLE public.company_monthly_revenue ENABLE ROW LEVEL SECURITY;
-- NÃO usar FORCE ROW LEVEL SECURITY (ver 20260318000000): mantém o service_role acessível.

REVOKE ALL ON public.company_monthly_revenue FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_monthly_revenue TO authenticated;
-- service_role: o BI agregado (se gerado por edge) lê faturamento via service_role. (Espelha 20260318000000.)
GRANT ALL ON public.company_monthly_revenue TO service_role;

-- ---- SELECT: a empresa vê só o próprio faturamento ----
DROP POLICY IF EXISTS "cmr_select_owner" ON public.company_monthly_revenue;
CREATE POLICY "cmr_select_owner" ON public.company_monthly_revenue
    FOR SELECT TO authenticated
    USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));

-- ---- INSERT: a empresa informa o próprio faturamento ----
DROP POLICY IF EXISTS "cmr_insert_owner" ON public.company_monthly_revenue;
CREATE POLICY "cmr_insert_owner" ON public.company_monthly_revenue
    FOR INSERT TO authenticated
    WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));

-- ---- UPDATE: a empresa corrige o próprio faturamento (upsert via on conflict) ----
DROP POLICY IF EXISTS "cmr_update_owner" ON public.company_monthly_revenue;
CREATE POLICY "cmr_update_owner" ON public.company_monthly_revenue
    FOR UPDATE TO authenticated
    USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()))
    WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));

-- ---- DELETE: a empresa remove o próprio registro ----
DROP POLICY IF EXISTS "cmr_delete_owner" ON public.company_monthly_revenue;
CREATE POLICY "cmr_delete_owner" ON public.company_monthly_revenue
    FOR DELETE TO authenticated
    USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));
