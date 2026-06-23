-- Migration: Métodos de pagamento on-file da empresa (cartão tokenizado) — Slice 2 (postpago)
-- File: supabase/migrations/20260622000600_payment_methods.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260622-pagamento-postpago.md
--
-- CONTEXTO (R4 da spec — modelo Uber, sem depósito antecipado):
--   No fluxo PUSH (Slice 1: empresa convida freela conhecido) não há depósito prévio. A empresa
--   cadastra UM método uma vez (cartão on-file). A tokenização do cartão acontece na Edge Function
--   `asaas-tokenize-card` (PCI: o PAN nunca toca o nosso banco — guardamos só o `creditCardToken`
--   opaco do Asaas + metadados não-sensíveis: brand/last4/holder_name). Esta tabela é o registro
--   desse token por empresa, para a captura na conclusão (`asaas-capture-payment`).
--
-- MODELO DE IDENTIDADE (confirmado por asaas-checkout, handle_new_user, team_connections):
--   companies.id = companies.owner_id = auth.uid() = jobs.company_id = wallets.user_id
--   → guardamos company_id = auth.uid() da empresa (mesma chave usada em jobs/wallets).
--
-- NÃO toca saldo/escrow (Article 8 intacto). Sem RPC de saldo aqui. Sem dado de cartão sensível
-- (Article 10 / PCI: só token opaco + metadados). RLS isola a empresa (Article 1/4).
--
-- DOWN (rollback): DROP TABLE IF EXISTS public.payment_methods CASCADE;

-- =============================================
-- 1. TABELA
-- =============================================
CREATE TABLE IF NOT EXISTS public.payment_methods (
    id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    -- dono = empresa (auth.uid()); espelha jobs.company_id / wallets.user_id
    company_id              uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    -- token OPACO do Asaas (NÃO é o PAN). Tokenização feita na Edge Function asaas-tokenize-card.
    asaas_credit_card_token text        NOT NULL,
    -- metadados NÃO-sensíveis para exibição na UI ("Visa ****1234")
    brand                   text,
    last4                   text        CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$'),
    holder_name             text,
    -- método padrão da empresa (default usado na captura). Só um default por empresa (índice parcial abaixo).
    is_default              boolean     NOT NULL DEFAULT true,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    -- idempotência de cadastro: um par (empresa, token) é único — re-tokenizar o mesmo cartão não duplica.
    CONSTRAINT payment_methods_unique_token UNIQUE (company_id, asaas_credit_card_token)
);

COMMENT ON TABLE  public.payment_methods IS 'Cartão on-file da empresa (token Asaas opaco + metadados). Captura postpago na conclusão. Sem PAN (PCI).';
COMMENT ON COLUMN public.payment_methods.asaas_credit_card_token IS 'creditCardToken opaco retornado por POST /v3/creditCard/tokenizeCreditCard. NUNCA o número do cartão.';
COMMENT ON COLUMN public.payment_methods.is_default IS 'Método padrão usado na captura. Um único default por empresa (idx_payment_methods_one_default).';

-- =============================================
-- 2. ÍNDICES (tabela nova/vazia → CREATE INDEX simples é seguro)
-- =============================================
CREATE INDEX IF NOT EXISTS idx_payment_methods_company
    ON public.payment_methods (company_id);

-- garante NO MÁXIMO um cartão default por empresa (índice parcial único)
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_methods_one_default
    ON public.payment_methods (company_id) WHERE is_default = true;

-- trigger utilitário de updated_at (mesmo padrão de team_connections)
CREATE OR REPLACE FUNCTION public.set_payment_methods_updated_at()
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

DROP TRIGGER IF EXISTS trg_payment_methods_updated_at ON public.payment_methods;
CREATE TRIGGER trg_payment_methods_updated_at
    BEFORE UPDATE ON public.payment_methods
    FOR EACH ROW
    EXECUTE FUNCTION public.set_payment_methods_updated_at();

-- =============================================
-- 3. RLS
-- =============================================
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
-- NÃO usar FORCE ROW LEVEL SECURITY (ver 20260318000000): FORCE + REVOKE bloqueia o service_role,
-- e a Edge Function de captura precisa ler o token via service_role. RLS normal já basta.

-- Sem acesso anônimo (mesmo padrão de team_connections/applications/wallets)
REVOKE ALL ON public.payment_methods FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_methods TO authenticated;
-- service_role precisa de acesso explícito: as Edge Functions asaas-tokenize-card / asaas-capture-payment
-- gravam/leem o token via service_role. Sem este GRANT, .from('payment_methods') via service_role falha.
-- (Espelha o GRANT ALL ... TO service_role das migrations 20260318000000 / 20260622000000.)
GRANT ALL ON public.payment_methods TO service_role;

-- ---- SELECT: a empresa vê só os próprios métodos ----
DROP POLICY IF EXISTS "pm_select_owner" ON public.payment_methods;
CREATE POLICY "pm_select_owner" ON public.payment_methods
    FOR SELECT TO authenticated
    USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));

-- ---- INSERT: a empresa cadastra método só pra si ----
-- O token vem da Edge Function (que tokeniza no Asaas); a inserção via service_role bypassa esta
-- policy, mas a mantemos para o caso de a empresa inserir metadados via client autenticado.
DROP POLICY IF EXISTS "pm_insert_owner" ON public.payment_methods;
CREATE POLICY "pm_insert_owner" ON public.payment_methods
    FOR INSERT TO authenticated
    WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));

-- ---- UPDATE: a empresa gerencia (ex.: trocar default) só os próprios métodos ----
DROP POLICY IF EXISTS "pm_update_owner" ON public.payment_methods;
CREATE POLICY "pm_update_owner" ON public.payment_methods
    FOR UPDATE TO authenticated
    USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()))
    WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));

-- ---- DELETE: a empresa remove os próprios métodos ----
DROP POLICY IF EXISTS "pm_delete_owner" ON public.payment_methods;
CREATE POLICY "pm_delete_owner" ON public.payment_methods
    FOR DELETE TO authenticated
    USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));
