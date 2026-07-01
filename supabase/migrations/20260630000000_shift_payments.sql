-- Migration: Marcador de pagamento externo por turno (modo A) + recibo — Piloto #1
-- File: supabase/migrations/20260630000000_shift_payments.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260630-pagamento-opcional-piloto.md (decisão-mãe: modo A = registro ≠ saldo)
-- Plano: .harness/spec/v1-operacao-freelancer/plan-modo-a.md (§2 schema; §4 HALT RESOLVIDO)
-- Gate: harness-architect (auditoria financeira, mesmo SEM mover saldo).
--
-- ============================================================================
-- FRONTEIRA CRÍTICA (Article 8/9/10) — LER ANTES DE MEXER
-- ----------------------------------------------------------------------------
--   Esta tabela é REGISTRO/AUDITORIA, NÃO liquidação. O modo A grava a DECLARAÇÃO
--   de que o pagamento aconteceu FORA do Worki (PIX/dinheiro) e emite recibo.
--
--   NÃO move saldo:      nenhum UPDATE em wallets, nenhuma linha em escrow_transactions.
--   NÃO chama RPC:       sem reserve/release/refund/authorize/capture — Article 8 intacto.
--   NÃO referencia nem   é referenciada por wallets/escrow_transactions. As FKs saem
--                        de shift_payments → jobs/companies/workers/applications (nunca o inverso).
--   NÃO precisa de       service_role para ESCREVER: o INSERT é do papel `authenticated`
--                        sob RLS (a empresa dona registra). O GRANT a service_role é só
--                        p/ LEITURA futura do BI (BI-1 unifica escrow ∪ marcador por job_id).
--   Idempotência (Article 9, adaptado — NÃO é wallet_transactions): a chave de dedupe
--                        é `job_id` — UM turno é pago por EXATAMENTE uma fonte no modo A.
--                        Aqui o UNIQUE é PARCIAL (WHERE status='recorded') — ver DECISÃO abaixo.
--
-- ============================================================================
-- DECISÃO DO ARCHITECT — UNIQUE PARCIAL (WHERE status = 'recorded')
-- ----------------------------------------------------------------------------
--   HALT resolveu "1 registro por turno, índice parcial p/ re-registro após void".
--   Adotado: UNIQUE (job_id) WHERE status = 'recorded'  (índice parcial).
--   Justificativa: um UNIQUE(job_id) simples impediria corrigir um registro errado —
--   como correção = ESTORNO LÓGICO (status='voided', nunca UPDATE destrutivo do valor),
--   após o void o mesmo turno precisa aceitar um NOVO registro 'recorded'. O parcial
--   permite N linhas 'voided' + no máximo UMA 'recorded' por job_id. Casa com o contrato
--   de dedupe do BI (job_id disjunto entre escrow e marcador; escrow tem precedência em
--   anomalia). Não é wallet_transactions → não usa (wallet_id, reference_id).
--
-- ============================================================================
-- MODELO DE IDENTIDADE (confirmado por team_connections / payment_methods / applications)
-- ----------------------------------------------------------------------------
--   companies.id = companies.owner_id = auth.uid() = jobs.company_id = wallets.user_id  → UUID
--   workers.id   = auth.uid() (usuário 'work')  = applications.worker_id                → UUID
--   → company_id ancora o RLS da empresa (owner_id = auth.uid()); worker_id = auth.uid() ancora o freela.
--
-- ============================================================================
-- IMUTABILIDADE / AUDITORIA (ADR §2; HALT bilateral ativo)
-- ----------------------------------------------------------------------------
--   Colunas MATERIAIS (job_id, company_id, worker_id, application_id, source, amount,
--   paid_at, recorded_by, note, created_at) são IMUTÁVEIS após o INSERT — trigger
--   BEFORE UPDATE compara OLD/NEW (padrão validate_application_update). Correção só via
--   estorno lógico (status='voided' + voided_at + void_reason) — NUNCA UPDATE do valor.
--   Registro 'voided' é totalmente imutável (não re-abre, não re-confirma).
--   UPDATE PARTICIONADO por papel:
--     - EMPRESA dona → estorno lógico (status recorded→voided, voided_at, void_reason).
--                      NÃO pode tocar worker_confirmed_at (é do freela).
--     - FREELA (worker_id=auth.uid()) → só seta worker_confirmed_at (one-way NULL→ts).
--                      NÃO pode tocar status/void/nada mais. Bilateral ATIVO (HALT #2).
--   SEM policy de DELETE — auditoria não se apaga (correção = voided).
--   FKs com ON DELETE RESTRICT (jobs/companies/workers): o registro de auditoria NÃO
--   pode ser destruído em cascata por deleção de turno/empresa/freela. application_id
--   (link opcional) usa SET NULL: se a candidatura sumir, o recibo permanece.
--
-- Turno concluído é PRÉ-REQUISITO de PRODUTO (guarda de UI/service — habilitar o botão só
-- pós-checkout/confirmação). NÃO é enforced aqui: o schema não conhece o estado do ciclo
-- sem acoplar shift_payments a applications.status (acoplamento indesejado). Fica no service.
--
-- DOWN (rollback): ver rodapé.
-- ============================================================================

-- =============================================
-- 1. TABELA
-- =============================================
CREATE TABLE IF NOT EXISTS public.shift_payments (
    id             uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
    -- turno pago. Base do dedupe (UNIQUE parcial abaixo). RESTRICT: audit não some com o job.
    job_id         uuid          NOT NULL REFERENCES public.jobs(id)         ON DELETE RESTRICT,
    -- dono do registro (empresa). Âncora do RLS empresa. RESTRICT: audit não some com a empresa.
    company_id     uuid          NOT NULL REFERENCES public.companies(id)    ON DELETE RESTRICT,
    -- freela pago. Âncora do RLS worker (= auth.uid()). RESTRICT: audit não some com o freela.
    -- [architect ajustou §2: worker_id ganha FK → workers(id) ON DELETE RESTRICT (integridade
    --  referencial + proteção de auditoria; o plano listava só jobs/applications/companies).]
    worker_id      uuid          NOT NULL REFERENCES public.workers(id)      ON DELETE RESTRICT,
    -- liga ao ciclo/turno específico (evidência). Opcional; SET NULL preserva o recibo se a
    -- candidatura for removida.
    application_id uuid          REFERENCES public.applications(id)          ON DELETE SET NULL,
    -- método DECLARADO (não prova bancária). HALT #3.
    source         text          NOT NULL CHECK (source IN ('external_pix', 'cash', 'other')),
    -- valor declarado pago (BRL). Sempre > 0.
    amount         numeric(12,2) NOT NULL CHECK (amount > 0),
    -- quando o pagamento aconteceu (declarado). Carimbo de período do BI (fallback = conclusão).
    paid_at        timestamptz   NOT NULL DEFAULT now(),
    -- quem registrou (empresa no v1). DEFAULT auth.uid(); RLS INSERT força = auth.uid().
    recorded_by    uuid          NOT NULL DEFAULT auth.uid(),
    -- confirmação de recebimento pelo freela (bilateral ATIVO — HALT #2). One-way NULL→ts.
    -- NÃO bloqueia ciclo/avaliação (HALT #7); é sinal de confiança.
    worker_confirmed_at timestamptz,
    -- observação livre (ex.: "pago em 2x", referência PIX). Imutável (parte da declaração).
    note           text,
    -- estado. Correção = estorno lógico ('voided'), NUNCA UPDATE destrutivo do valor.
    status         text          NOT NULL DEFAULT 'recorded'
                                 CHECK (status IN ('recorded', 'voided')),
    -- trilha do estorno lógico.
    voided_at      timestamptz,
    void_reason    text,
    created_at     timestamptz   NOT NULL DEFAULT now(),
    -- coerência do estorno: 'recorded' é limpo; 'voided' exige carimbo (motivo opcional).
    CONSTRAINT shift_payments_void_consistency CHECK (
        (status = 'recorded' AND voided_at IS NULL AND void_reason IS NULL)
        OR
        (status = 'voided'   AND voided_at IS NOT NULL)
    )
);

COMMENT ON TABLE  public.shift_payments IS 'Marcador de pagamento EXTERNO por turno (modo A do ADR-20260630). Registro/auditoria declaratório — NÃO move saldo, NÃO toca wallets/escrow_transactions, sem RPC. Fonte da verdade do gasto quando o dinheiro não passa pelo Worki (insumo do BI).';
COMMENT ON COLUMN public.shift_payments.job_id              IS 'Turno pago. Chave de dedupe (UNIQUE parcial WHERE status=recorded). RESTRICT.';
COMMENT ON COLUMN public.shift_payments.source              IS 'Método DECLARADO (não prova bancária): external_pix | cash | other.';
COMMENT ON COLUMN public.shift_payments.amount              IS 'Valor declarado pago em BRL (> 0). NÃO é saldo — nenhuma RPC.';
COMMENT ON COLUMN public.shift_payments.paid_at             IS 'Data declarada do pagamento. Carimbo de período do BI (fallback = conclusão do turno).';
COMMENT ON COLUMN public.shift_payments.recorded_by         IS 'auth.uid() de quem registrou (empresa no v1). RLS força = auth.uid() no INSERT.';
COMMENT ON COLUMN public.shift_payments.worker_confirmed_at IS 'Confirmação de recebimento pelo freela (bilateral ativo). One-way NULL→ts. Não bloqueia ciclo.';
COMMENT ON COLUMN public.shift_payments.status              IS 'recorded (ativo) | voided (estornado, imutável). Correção = void + novo registro, nunca UPDATE do valor.';

-- =============================================
-- 2. ÍNDICES (tabela nova/vazia → CREATE INDEX simples é seguro; sem CONCURRENTLY)
-- =============================================
-- Dedupe + idempotência: no máximo UMA linha 'recorded' por turno; N 'voided' permitidos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_payments_job_recorded
    ON public.shift_payments (job_id)
    WHERE status = 'recorded';

-- Lookup do recibo por turno (qualquer status) — getPaymentByJob.
CREATE INDEX IF NOT EXISTS idx_shift_payments_job
    ON public.shift_payments (job_id);

-- BI de gasto externo por empresa/período (só linhas ativas somam) — parcial p/ enxugar.
CREATE INDEX IF NOT EXISTS idx_shift_payments_company_paid
    ON public.shift_payments (company_id, paid_at)
    WHERE status = 'recorded';

-- Recibos/gasto do lado do freela.
CREATE INDEX IF NOT EXISTS idx_shift_payments_worker
    ON public.shift_payments (worker_id);

-- =============================================
-- 3. IMUTABILIDADE — trigger BEFORE UPDATE (padrão validate_application_update)
--    Enforça: colunas materiais congeladas (todos os papéis, inclusive service_role);
--    'voided' totalmente imutável; worker_confirmed_at one-way; UPDATE particionado por papel.
-- =============================================
CREATE OR REPLACE FUNCTION public.enforce_shift_payment_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_is_company BOOLEAN;
    v_is_worker  BOOLEAN;
BEGIN
    -- === COLUNAS MATERIAIS: imutáveis para TODOS (inclusive service_role) ===
    -- Não há caso legítimo de mutar valor/fonte/data/vínculo de um registro de auditoria.
    IF NEW.id             IS DISTINCT FROM OLD.id
       OR NEW.job_id         IS DISTINCT FROM OLD.job_id
       OR NEW.company_id     IS DISTINCT FROM OLD.company_id
       OR NEW.worker_id      IS DISTINCT FROM OLD.worker_id
       OR NEW.application_id IS DISTINCT FROM OLD.application_id
       OR NEW.source         IS DISTINCT FROM OLD.source
       OR NEW.amount         IS DISTINCT FROM OLD.amount
       OR NEW.paid_at        IS DISTINCT FROM OLD.paid_at
       OR NEW.recorded_by    IS DISTINCT FROM OLD.recorded_by
       OR NEW.note           IS DISTINCT FROM OLD.note
       OR NEW.created_at     IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'shift_payments: colunas materiais sao imutaveis (job_id, company_id, worker_id, application_id, source, amount, paid_at, recorded_by, note, created_at). Correcao = estorno logico (voided).';
    END IF;

    -- === Registro estornado é IMUTÁVEL (não re-abre, não re-confirma) ===
    IF OLD.status = 'voided' THEN
        RAISE EXCEPTION 'shift_payments: registro estornado (voided) e imutavel.';
    END IF;

    -- === worker_confirmed_at é ONE-WAY (NULL → timestamp; nunca altera/limpa) ===
    IF OLD.worker_confirmed_at IS NOT NULL
       AND NEW.worker_confirmed_at IS DISTINCT FROM OLD.worker_confirmed_at
    THEN
        RAISE EXCEPTION 'shift_payments: worker_confirmed_at nao pode ser alterado apos a confirmacao.';
    END IF;

    -- === PARTIÇÃO POR PAPEL (só para chamadas autenticadas; service_role/trigger tem auth.uid() NULL) ===
    IF auth.uid() IS NOT NULL THEN
        v_is_company := EXISTS (
            SELECT 1 FROM public.companies WHERE id = NEW.company_id AND owner_id = auth.uid()
        );
        v_is_worker := (NEW.worker_id = auth.uid());

        IF v_is_worker AND NOT v_is_company THEN
            -- Freela: SÓ pode setar worker_confirmed_at. Nada mais muda.
            IF NEW.status      IS DISTINCT FROM OLD.status
               OR NEW.voided_at   IS DISTINCT FROM OLD.voided_at
               OR NEW.void_reason IS DISTINCT FROM OLD.void_reason
            THEN
                RAISE EXCEPTION 'shift_payments: freela so pode confirmar recebimento (worker_confirmed_at).';
            END IF;
        ELSIF v_is_company THEN
            -- Empresa: gerencia estorno lógico; NÃO toca a confirmação do freela.
            IF NEW.worker_confirmed_at IS DISTINCT FROM OLD.worker_confirmed_at THEN
                RAISE EXCEPTION 'shift_payments: empresa nao pode alterar a confirmacao do freela.';
            END IF;
        ELSE
            RAISE EXCEPTION 'shift_payments: usuario nao autorizado a atualizar este registro.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_shift_payment_immutability ON public.shift_payments;
CREATE TRIGGER trg_enforce_shift_payment_immutability
    BEFORE UPDATE ON public.shift_payments
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_shift_payment_immutability();

-- =============================================
-- 4. RLS
-- =============================================
ALTER TABLE public.shift_payments ENABLE ROW LEVEL SECURITY;
-- NÃO usar FORCE ROW LEVEL SECURITY (ver 20260318000000): FORCE + REVOKE bloquearia o
-- service_role, que precisa LER o marcador para o BI. RLS normal basta (service_role bypassa).

-- Sem acesso anônimo (padrão team_connections / company_spend_limits / applications / wallets).
REVOKE ALL ON public.shift_payments FROM anon;
-- SEM DELETE para authenticated — auditoria não se apaga (correção = 'voided').
GRANT SELECT, INSERT, UPDATE ON public.shift_payments TO authenticated;
-- service_role: leitura futura do BI (escrow ∪ marcador). NÃO é usado para ESCREVER no modo A.
GRANT ALL ON public.shift_payments TO service_role;

-- ---- SELECT: empresa dona OU freela pago veem o próprio registro (recibo bilateral) ----
DROP POLICY IF EXISTS "sp_select_participants" ON public.shift_payments;
CREATE POLICY "sp_select_participants" ON public.shift_payments
    FOR SELECT TO authenticated
    USING (
        company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
        OR worker_id = auth.uid()
    );

-- ---- INSERT: SÓ a empresa dona registra; nasce 'recorded', limpo, por ela mesma ----
DROP POLICY IF EXISTS "sp_insert_company" ON public.shift_payments;
CREATE POLICY "sp_insert_company" ON public.shift_payments
    FOR INSERT TO authenticated
    WITH CHECK (
        company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
        AND recorded_by = auth.uid()
        AND status = 'recorded'
        AND worker_confirmed_at IS NULL
        AND voided_at IS NULL
        AND void_reason IS NULL
    );

-- ---- UPDATE (empresa): estorno lógico de um registro ATIVO (recorded→voided) ----
-- USING restringe a linhas ativas dela; WITH CHECK permite manter 'recorded' ou virar 'voided'.
-- A imutabilidade coluna-a-coluna (não tocar worker_confirmed_at etc.) é do TRIGGER.
DROP POLICY IF EXISTS "sp_update_company" ON public.shift_payments;
CREATE POLICY "sp_update_company" ON public.shift_payments
    FOR UPDATE TO authenticated
    USING (
        company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
        AND status = 'recorded'
    )
    WITH CHECK (
        company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
        AND status IN ('recorded', 'voided')
    );

-- ---- UPDATE (freela): confirma recebimento em registro ATIVO; status permanece 'recorded' ----
-- USING/CHECK travam o freela em linhas dele e ativas; o TRIGGER garante que SÓ
-- worker_confirmed_at muda (bilateral ativo — HALT #2).
DROP POLICY IF EXISTS "sp_update_worker" ON public.shift_payments;
CREATE POLICY "sp_update_worker" ON public.shift_payments
    FOR UPDATE TO authenticated
    USING (
        worker_id = auth.uid()
        AND status = 'recorded'
    )
    WITH CHECK (
        worker_id = auth.uid()
        AND status = 'recorded'
    );

-- ---- DELETE: NENHUMA policy — negado a todos os papéis authenticated (auditoria imutável). ----

-- ============================================================================
-- DOWN (rollback) — sem impacto em saldo/escrow (nenhuma RPC tocada):
--   DROP TABLE IF EXISTS public.shift_payments CASCADE;
--   DROP FUNCTION IF EXISTS public.enforce_shift_payment_immutability();
-- ============================================================================
