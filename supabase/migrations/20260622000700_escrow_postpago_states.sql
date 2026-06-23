-- Migration: Estados postpago no escrow_transactions — Slice 2 (pagamento postpago, modelo Uber)
-- File: supabase/migrations/20260622000700_escrow_postpago_states.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260622-pagamento-postpago.md
--
-- DECISÃO (ADR): ESTENDER `escrow_transactions` em vez de criar tabela nova.
--   Razão: escrow_transactions JÁ É a aresta financeira por job — carrega application_id, valores,
--   wallets, status, o índice parcial "um ativo por job" e a RLS por papel. O postpago é o MESMO
--   conceito (valor garantido até a conclusão) num substrato diferente (hold no cartão da empresa,
--   não saldo pré-depositado). Tabela separada duplicaria RLS, índice e lógica de auto-liberação.
--
-- MODELO DE ESTADOS (coexistente; nada do fluxo PULL legado muda):
--   PRE-PAGO (pull legado, kind='prepaid'):  reserved → released | refunded   (intacto)
--   POST-PAGO (push Slice 2, kind='postpaid'): authorized → captured → released
--                                              authorized → refunded (cancel/no-show: libera o hold)
--   - `authorized`: hold criado no cartão (POST /v3/payments authorizeOnly:true). Saldo NÃO sai do DB
--     (a empresa não tem saldo pré-depositado no postpago) — o "lock" é no cartão, no Asaas.
--   - `captured`:   captura confirmada no Asaas (captureAuthorizedPayment). O dinheiro entrou na conta
--     master. A RPC de captura credita o worker no mesmo passo atômico e marca `released`.
--   - `refunded`:   hold liberado/estornado (sem captura) em cancelamento/no-show.
--
-- COLUNAS NOVAS (todas nullable / com default → sem backfill; linhas antigas = prepaid):
--   - kind            : discrimina prepaid (legado) vs postpaid (Slice 2). Default 'prepaid' preserva
--                       toda linha existente como prepaid sem tocá-la.
--   - asaas_payment_id: id da cobrança no Asaas (do authorizeOnly). Liga o escrow ao hold/captura.
--   - authorized_at / captured_at: auditoria do ciclo postpago.
--
-- IDEMPOTÊNCIA: asaas_payment_id é UNIQUE quando presente — o webhook/reprocesso não cria dois
--   escrows para o mesmo hold. (A idempotência do crédito ao worker segue em wallet_transactions
--   (wallet_id, reference_id), Article 9, via release_escrow — inalterado.)
--
-- NÃO altera o contrato das RPCs de escrow existentes nem a constraint de idempotência de
-- wallet_transactions (Article 9). O índice parcial legado `idx_escrow_one_reserved_per_job`
-- (WHERE status='reserved') continua valendo só para prepaid. Adicionamos o análogo postpago.
-- Idempotente (IF [NOT] EXISTS). Reversível (DOWN abaixo).
--
-- DOWN (rollback):
--   DROP INDEX IF EXISTS public.idx_escrow_one_authorized_per_job;
--   ALTER TABLE public.escrow_transactions
--     DROP CONSTRAINT IF EXISTS escrow_transactions_status_check,
--     ADD  CONSTRAINT escrow_transactions_status_check
--          CHECK (status IN ('reserved','released','refunded'));
--   ALTER TABLE public.escrow_transactions
--     DROP COLUMN IF EXISTS kind,
--     DROP COLUMN IF EXISTS asaas_payment_id,
--     DROP COLUMN IF EXISTS authorized_at,
--     DROP COLUMN IF EXISTS captured_at;

-- =============================================
-- 1. COLUNAS NOVAS
-- =============================================
ALTER TABLE public.escrow_transactions
    ADD COLUMN IF NOT EXISTS kind             text        NOT NULL DEFAULT 'prepaid',
    ADD COLUMN IF NOT EXISTS asaas_payment_id text,
    ADD COLUMN IF NOT EXISTS authorized_at    timestamptz,
    ADD COLUMN IF NOT EXISTS captured_at      timestamptz;

-- CHECK de kind (separado para DOWN limpo)
DO $$ BEGIN
    ALTER TABLE public.escrow_transactions
        ADD CONSTRAINT escrow_transactions_kind_check CHECK (kind IN ('prepaid', 'postpaid'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.escrow_transactions.kind             IS 'prepaid = fluxo pull legado (saldo pré-depositado, reserved→released); postpaid = Slice 2 push (hold no cartão, authorized→captured).';
COMMENT ON COLUMN public.escrow_transactions.asaas_payment_id IS 'id da cobrança no Asaas (authorizeOnly:true). NULL para prepaid. UNIQUE quando presente (idempotência do hold).';
COMMENT ON COLUMN public.escrow_transactions.authorized_at    IS 'Quando o hold no cartão foi criado (postpaid).';
COMMENT ON COLUMN public.escrow_transactions.captured_at      IS 'Quando o hold foi capturado no Asaas (postpaid).';

-- =============================================
-- 2. STATUS: estender o CHECK com authorized / captured
-- =============================================
-- O CHECK original (001_create_wallet_escrow_tables.sql) é status IN ('reserved','released','refunded').
-- Substituímos por um superset. NÃO removemos nenhum valor → linhas existentes seguem válidas.
ALTER TABLE public.escrow_transactions
    DROP CONSTRAINT IF EXISTS escrow_transactions_status_check;
ALTER TABLE public.escrow_transactions
    ADD CONSTRAINT escrow_transactions_status_check
    CHECK (status IN ('reserved', 'authorized', 'captured', 'released', 'refunded'));

-- =============================================
-- 3. ÍNDICE: um hold ATIVO por job (análogo postpago do idx_escrow_one_reserved_per_job)
-- =============================================
-- O índice legado garante 1 'reserved' por job (prepaid). Para postpaid, o estado "ativo/travado" é
-- 'authorized'. Garantimos 1 'authorized' por job → não dá para criar dois holds para o mesmo turno.
-- (Tabela já em produção, mas a condição WHERE status='authorized' não casa nenhuma linha existente
--  → criação do índice não varre/trava dados; CREATE INDEX simples é seguro aqui.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_one_authorized_per_job
    ON public.escrow_transactions (job_id) WHERE status = 'authorized';

-- idempotência do hold: no máximo um escrow por cobrança Asaas
CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_unique_asaas_payment
    ON public.escrow_transactions (asaas_payment_id) WHERE asaas_payment_id IS NOT NULL;

-- consulta por payment id (webhook do Asaas resolve o escrow pelo id da cobrança)
CREATE INDEX IF NOT EXISTS idx_escrow_asaas_payment_id
    ON public.escrow_transactions (asaas_payment_id) WHERE asaas_payment_id IS NOT NULL;
