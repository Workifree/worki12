-- Migration: Teto de gasto + config de alertas por empresa (R12) — Slice 3 (inteligência financeira)
-- File: supabase/migrations/20260623000000_company_spend_limits.sql
-- Spec: .harness/spec/v1-operacao-freelancer/spec.md (R12)
--
-- CONTEXTO (R12 da spec — ALERTA, NUNCA BLOQUEIO):
--   O contato financeiro da empresa define um TETO de gasto por período (mês, v1). O sistema
--   alerta quando o gasto acumulado cruza 80% / 90% / 100% / acima — in-app (tabela `notifications`,
--   reusada — NÃO criamos tabela de alertas) + e-mail (send-notification). WhatsApp = Slice 4.
--   Bloquear contratação deixaria turno descoberto → o teto NUNCA bloqueia, só sinaliza.
--
-- ESTA TABELA É SÓ CONFIG. Não há saldo, não há RPC de saldo, não há escrow aqui (Article 8 intacto).
--   O "gasto acumulado do período" NÃO é materializado aqui — é DERIVADO de escrow_transactions por
--   query (ver CONTRATO PRO BUILDER no rodapé). A avaliação do cruzamento de threshold e a inserção da
--   notification acontecem no service/edge, não no banco.
--
-- MODELO DE IDENTIDADE (confirmado por payment_methods / team_connections / handle_new_user):
--   companies.id = companies.owner_id = auth.uid() = jobs.company_id = wallets.user_id  → UUID
--   → company_id referencia companies(id); RLS isola pelo owner (mesmo padrão de payment_methods).
--
-- SOBRE `scope` (loja): o Worki v1 é SINGLE-STORE por empresa — NÃO existe tabela `stores`
--   (jobs.company_id = a própria empresa; não há FK de loja). O teto "por loja" do R12 é OPCIONAL.
--   Modelamos `scope` como rótulo TEXT NOT NULL DEFAULT '' (não-FK): '' (string vazia) = teto da
--   empresa inteira (caso v1); um rótulo de loja livre quando/se a empresa segmentar (multi-loja é
--   Fase 2). Isso evita criar uma tabela `stores` especulativa agora e mantém a porta aberta sem
--   migration de quebra depois.
--   IMPORTANTE (security-reviewer Slice 3): scope é NOT NULL '' (NÃO nullable). Com scope NULL, o
--   UNIQUE (company_id, period, scope) não resolveria conflito no upsert (NULL != NULL no Postgres)
--   e o onConflict do supabase-js inseriria teto duplicado. String vazia colide normalmente.
--   → o teto company-wide usa scope = '' (string vazia), NUNCA null. (Ver service: upsertSpendLimit.)
--   Decisão de baixa reversibilidade-de-risco (coluna simples) → sem ADR (config table simples).
--
-- DOWN (rollback): DROP TABLE IF EXISTS public.company_spend_limits CASCADE;

-- =============================================
-- 1. TABELA
-- =============================================
CREATE TABLE IF NOT EXISTS public.company_spend_limits (
    id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    -- dono = empresa (auth.uid()); espelha jobs.company_id / wallets.user_id
    company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    -- período do teto. v1 = 'month' (mensal). Enum-via-CHECK para abrir 'week'/'quarter' depois sem quebra.
    period            text        NOT NULL DEFAULT 'month'
                                  CHECK (period IN ('month')),
    -- valor do teto em BRL. > 0 (teto zero não faz sentido; "sem teto" = não criar linha).
    amount            numeric(12,2) NOT NULL CHECK (amount > 0),
    -- limiares de alerta (% do teto) que disparam notification. Default {80,90,100}.
    -- "acima" (>100%) é derivado em runtime (gasto > teto) — não precisa estar no array.
    alert_thresholds  integer[]   NOT NULL DEFAULT ARRAY[80, 90, 100]
                                  CHECK (
                                    array_length(alert_thresholds, 1) BETWEEN 1 AND 10
                                    AND alert_thresholds <@ ARRAY[50,60,70,75,80,85,90,95,100]
                                  ),
    -- escopo opcional (rótulo de loja). '' (string vazia) = teto da empresa inteira (caso v1,
    -- single-store). NÃO é FK (não há tabela stores no v1) — ver nota de cabeçalho.
    -- NOT NULL DEFAULT '' (não nullable): NULL não colide com NULL em UNIQUE no Postgres, então
    -- onConflict('company_id,period,scope') do supabase-js NÃO resolveria conflito com scope NULL
    -- → upsert inseriria teto duplicado. String vazia colide normalmente → UNIQUE convencional funciona.
    scope             text        NOT NULL DEFAULT '',
    -- contato que recebe o alerta. WhatsApp depois (Slice 4); por ora telefone/e-mail de destino.
    financial_contact_email text  CHECK (financial_contact_email IS NULL
                                         OR financial_contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    financial_contact_phone text  CHECK (financial_contact_phone IS NULL
                                         OR financial_contact_phone ~ '^\+?[0-9]{8,15}$'),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    -- um teto por (empresa, período, escopo). scope='' (empresa inteira) e scope='loja X' são
    -- tetos distintos. Como scope é NOT NULL (nunca NULL), este UNIQUE cobre TODOS os casos —
    -- inclusive o teto company-wide (scope='') — e casa com onConflict('company_id,period,scope').
    CONSTRAINT company_spend_limits_unique UNIQUE (company_id, period, scope)
);

COMMENT ON TABLE  public.company_spend_limits IS 'Config de teto de gasto por empresa/período/escopo (R12). ALERTA, nunca bloqueio. Gasto acumulado é derivado de escrow_transactions (não materializado aqui).';
COMMENT ON COLUMN public.company_spend_limits.period           IS 'Período do teto. v1 = month. CHECK abre week/quarter depois.';
COMMENT ON COLUMN public.company_spend_limits.amount           IS 'Valor do teto em BRL (> 0).';
COMMENT ON COLUMN public.company_spend_limits.alert_thresholds IS 'Limiares (%) que disparam alerta in-app+email. Default {80,90,100}. >100% é derivado em runtime.';
COMMENT ON COLUMN public.company_spend_limits.scope            IS 'Rótulo de loja opcional (NÃO-FK; não há tabela stores no v1). NOT NULL DEFAULT ''''; '''' (vazio) = empresa inteira. NUNCA null (quebraria o upsert por onConflict).';
COMMENT ON COLUMN public.company_spend_limits.financial_contact_email IS 'E-mail do contato financeiro p/ alerta. NULL = usa e-mail do owner.';
COMMENT ON COLUMN public.company_spend_limits.financial_contact_phone IS 'Telefone do contato financeiro (alerta WhatsApp = Slice 4). E.164-ish.';

-- =============================================
-- 2. ÍNDICES (tabela nova/vazia → CREATE INDEX simples é seguro)
-- =============================================
CREATE INDEX IF NOT EXISTS idx_company_spend_limits_company
    ON public.company_spend_limits (company_id);

-- (Removido o índice parcial idx_company_spend_limits_one_default que existia para cobrir o
--  caso scope IS NULL: como scope agora é NOT NULL DEFAULT '', a CONSTRAINT UNIQUE
--  (company_id, period, scope) já garante no máximo um teto company-wide (scope='') por período.
--  O índice parcial ficou redundante.)

-- trigger utilitário de updated_at (mesmo padrão de team_connections / payment_methods)
CREATE OR REPLACE FUNCTION public.set_company_spend_limits_updated_at()
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

DROP TRIGGER IF EXISTS trg_company_spend_limits_updated_at ON public.company_spend_limits;
CREATE TRIGGER trg_company_spend_limits_updated_at
    BEFORE UPDATE ON public.company_spend_limits
    FOR EACH ROW
    EXECUTE FUNCTION public.set_company_spend_limits_updated_at();

-- =============================================
-- 3. RLS
-- =============================================
ALTER TABLE public.company_spend_limits ENABLE ROW LEVEL SECURITY;
-- NÃO usar FORCE ROW LEVEL SECURITY (ver 20260318000000): FORCE + REVOKE bloqueia o service_role,
-- e a avaliação de teto (edge/cron) precisa ler a config via service_role. RLS normal já basta.

-- Sem acesso anônimo (mesmo padrão de payment_methods / team_connections / applications / wallets)
REVOKE ALL ON public.company_spend_limits FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_spend_limits TO authenticated;
-- service_role precisa de acesso explícito: o serviço de avaliação de teto (insere a notification
-- in-app via service_role) lê esta config. Sem este GRANT, .from('company_spend_limits') via
-- service_role falha. (Espelha o GRANT ALL ... TO service_role de 20260318000000 / payment_methods.)
GRANT ALL ON public.company_spend_limits TO service_role;

-- ---- SELECT: a empresa vê só os próprios tetos ----
DROP POLICY IF EXISTS "csl_select_owner" ON public.company_spend_limits;
CREATE POLICY "csl_select_owner" ON public.company_spend_limits
    FOR SELECT TO authenticated
    USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));

-- ---- INSERT: a empresa cria teto só pra si ----
DROP POLICY IF EXISTS "csl_insert_owner" ON public.company_spend_limits;
CREATE POLICY "csl_insert_owner" ON public.company_spend_limits
    FOR INSERT TO authenticated
    WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));

-- ---- UPDATE: a empresa edita os próprios tetos ----
DROP POLICY IF EXISTS "csl_update_owner" ON public.company_spend_limits;
CREATE POLICY "csl_update_owner" ON public.company_spend_limits
    FOR UPDATE TO authenticated
    USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()))
    WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));

-- ---- DELETE: a empresa remove os próprios tetos ----
DROP POLICY IF EXISTS "csl_delete_owner" ON public.company_spend_limits;
CREATE POLICY "csl_delete_owner" ON public.company_spend_limits
    FOR DELETE TO authenticated
    USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));
