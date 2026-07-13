-- Migration: Pagamento AGENDADO por turno (modo A) — status 'scheduled' + data prevista
-- File: supabase/migrations/20260712000000_shift_payment_scheduled.sql
-- ADR: .harness/spec/pagamento-agendado/adr-pagamento-agendado.md
-- Depende de: 20260630000000_shift_payments.sql (tabela-base, trigger de imutabilidade, RLS)
-- Gate: harness-architect (auditoria financeira — mesmo SEM mover saldo).
--
-- ============================================================================
-- FRONTEIRA CRÍTICA (Article 8/9/10) — INALTERADA
-- ----------------------------------------------------------------------------
--   Modo A continua sendo REGISTRO/AUDITORIA, NÃO liquidação. 'scheduled' é um
--   COMPROMISSO declarado (promessa de pagar numa data prevista) — não move saldo,
--   não chama RPC, não toca wallets/escrow_transactions. Nenhuma RPC de saldo é
--   criada ou alterada. Article 8 intacto.
--
-- ============================================================================
-- MODELO (decisão do architect — ADR §Decisão)
-- ----------------------------------------------------------------------------
--   Máquina de estados (mesma linha, transição in-place):
--       scheduled ──efetivar──► recorded
--       scheduled ──cancelar──► voided
--       recorded  ──estornar──► voided        (fluxo legado, inalterado)
--   'voided' é terminal/imutável (trigger já garante).
--
--   OPÇÃO (a) ADOTADA para o dilema `paid_at`:
--     - `paid_at` passa a ser NULLABLE. 'scheduled' NÃO tem paid_at (ainda não pagou).
--     - Nova coluna `scheduled_for date` = a PROMESSA (data prevista). Imutável (material).
--     - Na EFETIVAÇÃO (scheduled→recorded), `paid_at` é setado UMA vez (NULL→data real).
--       Depois disso é imutável de novo. O trigger libera SÓ essa transição.
--   Rejeitada opção (b) (paid_at = scheduled_for provisório): gravaria um FATO FALSO
--   (data futura como "data paga") e, sendo imutável, travaria a data real na efetivação.
--
--   Dedupe: UM marcador ATIVO por turno. UNIQUE parcial passa a cobrir
--   status IN ('scheduled','recorded') — impede promessa + pagamento em linhas
--   separadas para o mesmo turno. N linhas 'voided' seguem permitidas (re-agendar/re-registrar).
--   BI (status='recorded') NÃO conta 'scheduled' como gasto — promessa ≠ liquidação. Correto.
--
-- DOWN (rollback): ver rodapé.
-- ============================================================================

-- =============================================
-- 1. COLUNAS
-- =============================================
-- Data prevista da promessa. Material/imutável (reagendar = void + novo scheduled).
ALTER TABLE public.shift_payments
    ADD COLUMN IF NOT EXISTS scheduled_for date;

-- paid_at deixa de ser obrigatório: 'scheduled' não tem data de pagamento ainda.
-- (Widening seguro; linhas existentes já têm paid_at preenchido.)
ALTER TABLE public.shift_payments
    ALTER COLUMN paid_at DROP NOT NULL;

COMMENT ON COLUMN public.shift_payments.scheduled_for IS
    'Data PREVISTA do pagamento (promessa) quando status=scheduled. Material/imutavel — reagendar = void + novo agendamento. NULL em registros diretos (recorded sem agendamento previo).';
COMMENT ON COLUMN public.shift_payments.paid_at IS
    'Data DECLARADA do pagamento. NULL enquanto scheduled; setada UMA vez na efetivacao (scheduled->recorded) e entao imutavel. Carimbo de periodo do BI.';
COMMENT ON COLUMN public.shift_payments.status IS
    'scheduled (agendado, promessa) | recorded (efetivado/ativo) | voided (cancelado, imutavel). Correcao = void + novo registro, nunca UPDATE do valor.';

-- =============================================
-- 2. CONSTRAINTS DE ESTADO (substituem status/void checks legados)
-- =============================================
-- Remove os CHECKs legados que referenciam `status` mas desconhecem 'scheduled'
-- (o status-check inline `IN ('recorded','voided')` e o shift_payments_void_consistency).
-- Introspectivo p/ não depender do nome auto-gerado; idempotente (os novos mencionam
-- 'scheduled' e ficam de fora do filtro).
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.shift_payments'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%status%'
          AND pg_get_constraintdef(oid) NOT ILIKE '%scheduled%'
    LOOP
        EXECUTE format('ALTER TABLE public.shift_payments DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

-- Idempotência dos nomes fixos (caso a migration rode 2x).
ALTER TABLE public.shift_payments DROP CONSTRAINT IF EXISTS shift_payments_status_check;
ALTER TABLE public.shift_payments DROP CONSTRAINT IF EXISTS shift_payments_state_consistency;
ALTER TABLE public.shift_payments DROP CONSTRAINT IF EXISTS shift_payments_void_consistency;

-- Domínio do status (agora com 'scheduled').
ALTER TABLE public.shift_payments
    ADD CONSTRAINT shift_payments_status_check
    CHECK (status IN ('scheduled', 'recorded', 'voided'));

-- Coerência por estado:
--   scheduled → promessa: tem data prevista, SEM paid_at, SEM confirmação, SEM void.
--   recorded  → efetivado: tem paid_at, SEM void. scheduled_for livre (pode vir de agendamento).
--   voided    → cancelado: tem voided_at (motivo opcional). Congela o que havia.
ALTER TABLE public.shift_payments
    ADD CONSTRAINT shift_payments_state_consistency CHECK (
        (status = 'scheduled'
            AND scheduled_for       IS NOT NULL
            AND paid_at             IS NULL
            AND worker_confirmed_at IS NULL
            AND voided_at           IS NULL
            AND void_reason         IS NULL)
        OR
        (status = 'recorded'
            AND paid_at   IS NOT NULL
            AND voided_at IS NULL
            AND void_reason IS NULL)
        OR
        (status = 'voided'
            AND voided_at IS NOT NULL)
    );

-- =============================================
-- 3. UNIQUE PARCIAL — 1 marcador ATIVO por turno (scheduled OU recorded)
-- =============================================
-- Substitui uq_shift_payments_job_recorded por uma versão que também barra 2 promessas
-- e a coexistência promessa+pagamento em linhas distintas do mesmo turno.
-- Tabela é de baixo volume (piloto) → CREATE UNIQUE INDEX simples (lock breve aceitável;
-- se algum dia crescer, migrar p/ CONCURRENTLY fora de transação). Ver ADR §Trade-offs.
DROP INDEX IF EXISTS public.uq_shift_payments_job_recorded;
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_payments_job_active
    ON public.shift_payments (job_id)
    WHERE status IN ('scheduled', 'recorded');

-- Lookup de agendamentos por empresa/data prevista (agenda de pagamentos futuros).
CREATE INDEX IF NOT EXISTS idx_shift_payments_company_scheduled
    ON public.shift_payments (company_id, scheduled_for)
    WHERE status = 'scheduled';

-- =============================================
-- 4. TRIGGER DE IMUTABILIDADE — libera SÓ a transição scheduled→recorded p/ paid_at
--    e valida a máquina de estados. Reescreve enforce_shift_payment_immutability.
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
    -- === COLUNAS MATERIAIS SEMPRE IMUTÁVEIS (todos os papéis, inclusive service_role) ===
    -- scheduled_for entra aqui: a PROMESSA não se reescreve (reagendar = void + novo).
    IF NEW.id             IS DISTINCT FROM OLD.id
       OR NEW.job_id         IS DISTINCT FROM OLD.job_id
       OR NEW.company_id     IS DISTINCT FROM OLD.company_id
       OR NEW.worker_id      IS DISTINCT FROM OLD.worker_id
       OR NEW.application_id IS DISTINCT FROM OLD.application_id
       OR NEW.source         IS DISTINCT FROM OLD.source
       OR NEW.amount         IS DISTINCT FROM OLD.amount
       OR NEW.recorded_by    IS DISTINCT FROM OLD.recorded_by
       OR NEW.note           IS DISTINCT FROM OLD.note
       OR NEW.created_at     IS DISTINCT FROM OLD.created_at
       OR NEW.scheduled_for  IS DISTINCT FROM OLD.scheduled_for
    THEN
        RAISE EXCEPTION 'shift_payments: colunas materiais sao imutaveis (job_id, company_id, worker_id, application_id, source, amount, recorded_by, note, created_at, scheduled_for). Correcao = estorno logico (voided).';
    END IF;

    -- === paid_at: imutável, EXCETO a efetivacao (scheduled->recorded) que o define UMA vez ===
    IF NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
        IF NOT (OLD.status = 'scheduled' AND NEW.status = 'recorded'
                AND OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL) THEN
            RAISE EXCEPTION 'shift_payments: paid_at so pode ser definido na efetivacao (scheduled->recorded) e depois e imutavel.';
        END IF;
    END IF;

    -- === Registro estornado é IMUTÁVEL (não re-abre, não re-confirma) ===
    IF OLD.status = 'voided' THEN
        RAISE EXCEPTION 'shift_payments: registro estornado (voided) e imutavel.';
    END IF;

    -- === Transições de status permitidas ===
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT (
            (OLD.status = 'scheduled' AND NEW.status IN ('recorded', 'voided'))
            OR (OLD.status = 'recorded' AND NEW.status = 'voided')
        ) THEN
            RAISE EXCEPTION 'shift_payments: transicao de status invalida (% -> %).', OLD.status, NEW.status;
        END IF;
    END IF;

    -- === worker_confirmed_at é ONE-WAY (NULL → timestamp; nunca altera/limpa) ===
    IF OLD.worker_confirmed_at IS NOT NULL
       AND NEW.worker_confirmed_at IS DISTINCT FROM OLD.worker_confirmed_at
    THEN
        RAISE EXCEPTION 'shift_payments: worker_confirmed_at nao pode ser alterado apos a confirmacao.';
    END IF;

    -- === PARTIÇÃO POR PAPEL (só p/ chamadas autenticadas; service_role/trigger tem auth.uid() NULL) ===
    IF auth.uid() IS NOT NULL THEN
        v_is_company := EXISTS (
            SELECT 1 FROM public.companies WHERE id = NEW.company_id AND owner_id = auth.uid()
        );
        v_is_worker := (NEW.worker_id = auth.uid());

        IF v_is_worker AND NOT v_is_company THEN
            -- Freela: SÓ pode setar worker_confirmed_at (num registro já 'recorded'). Nada mais muda.
            IF NEW.status      IS DISTINCT FROM OLD.status
               OR NEW.voided_at   IS DISTINCT FROM OLD.voided_at
               OR NEW.void_reason IS DISTINCT FROM OLD.void_reason
               OR NEW.paid_at     IS DISTINCT FROM OLD.paid_at
            THEN
                RAISE EXCEPTION 'shift_payments: freela so pode confirmar recebimento (worker_confirmed_at).';
            END IF;
        ELSIF v_is_company THEN
            -- Empresa: efetiva (scheduled->recorded), cancela (->voided), estorna; NÃO toca a confirmacao do freela.
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
-- Trigger já existe (BEFORE UPDATE) da migration base; CREATE OR REPLACE acima basta.

-- =============================================
-- 5. RLS — permitir INSERT 'scheduled' e as transições da empresa
-- =============================================
-- INSERT: empresa dona registra 'scheduled' OU 'recorded' (limpo). A coerência de
-- cada estado é do CHECK shift_payments_state_consistency.
DROP POLICY IF EXISTS "sp_insert_company" ON public.shift_payments;
CREATE POLICY "sp_insert_company" ON public.shift_payments
    FOR INSERT TO authenticated
    WITH CHECK (
        company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
        AND recorded_by = auth.uid()
        AND status IN ('scheduled', 'recorded')
        AND worker_confirmed_at IS NULL
        AND voided_at IS NULL
        AND void_reason IS NULL
    );

-- UPDATE (empresa): opera sobre registro ATIVO (scheduled OU recorded); pode ir a
-- recorded (efetivar) ou voided (cancelar/estornar). Imutabilidade coluna-a-coluna é do TRIGGER.
DROP POLICY IF EXISTS "sp_update_company" ON public.shift_payments;
CREATE POLICY "sp_update_company" ON public.shift_payments
    FOR UPDATE TO authenticated
    USING (
        company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
        AND status IN ('scheduled', 'recorded')
    )
    WITH CHECK (
        company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
        AND status IN ('scheduled', 'recorded', 'voided')
    );

-- UPDATE (freela): INALTERADO — só confirma recebimento em registro 'recorded'.
-- (sp_update_worker já restringe a status='recorded' — freela não toca 'scheduled'.)

-- ============================================================================
-- DOWN (rollback) — sem impacto em saldo/escrow (nenhuma RPC tocada):
--   -- 1. Restaurar RLS/estado anterior:
--   DROP INDEX IF EXISTS public.uq_shift_payments_job_active;
--   DROP INDEX IF EXISTS public.idx_shift_payments_company_scheduled;
--   -- (só é seguro se NÃO houver linhas status='scheduled'; efetive/estorne-as antes)
--   DELETE FROM public.shift_payments WHERE status = 'scheduled'; -- ou migre-as
--   CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_payments_job_recorded
--       ON public.shift_payments (job_id) WHERE status = 'recorded';
--   ALTER TABLE public.shift_payments DROP CONSTRAINT IF EXISTS shift_payments_state_consistency;
--   ALTER TABLE public.shift_payments DROP CONSTRAINT IF EXISTS shift_payments_status_check;
--   ALTER TABLE public.shift_payments
--       ADD CONSTRAINT shift_payments_status_check CHECK (status IN ('recorded','voided'));
--   ALTER TABLE public.shift_payments
--       ADD CONSTRAINT shift_payments_void_consistency CHECK (
--           (status='recorded' AND voided_at IS NULL AND void_reason IS NULL)
--           OR (status='voided' AND voided_at IS NOT NULL));
--   ALTER TABLE public.shift_payments ALTER COLUMN paid_at SET NOT NULL; -- exige paid_at preenchido
--   ALTER TABLE public.shift_payments DROP COLUMN IF EXISTS scheduled_for;
--   -- 2. Reaplicar a versão anterior de enforce_shift_payment_immutability (migration base).
-- ============================================================================
