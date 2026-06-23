-- Migration: RPCs atômicas do escrow postpago — Slice 2 (pagamento postpago, modelo Uber)
-- File: supabase/migrations/20260622000800_postpago_escrow_rpcs.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260622-pagamento-postpago.md
--
-- CONTEXTO: a CHAMADA ao Asaas (tokenize / authorizeOnly / capture) é da Edge Function. Estas RPCs
--   gravam apenas o ESTADO no DB, de forma ATÔMICA e IDEMPOTENTE (Article 8 e 9). Espelham as RPCs
--   prepago (reserve/release/refund) mas no substrato postpago (hold no cartão, sem saldo pré-pago).
--
-- TRÊS RPCs:
--   1. authorize_escrow_postpago(job, application, amount, asaas_payment_id, company_user_id)
--        Após a Edge Function criar o hold no Asaas (authorizeOnly:true), grava o escrow 'authorized'
--        /'postpaid' com o asaas_payment_id. NÃO mexe em saldo (postpago: nada saiu do DB; o lock é
--        no cartão). Loga um wallet_transaction de auditoria (type 'escrow_authorize', amount 0).
--        IDEMPOTENTE: se já existe escrow para esse asaas_payment_id, retorna o existente (não duplica).
--
--   2. capture_escrow_postpago(job, worker_wallet_id)
--        Após a Edge Function capturar o hold no Asaas (captureAuthorizedPayment), marca o escrow
--        'captured'+'released' e CREDITA o worker — no MESMO passo atômico. O crédito reusa o type
--        'escrow_release' com reference_id = job_id (idempotência (wallet_id, reference_id), Article 9):
--        capturar duas vezes não credita em dobro. UPDATE ... WHERE status='authorized' impede
--        double-capture. O crédito de saldo só roda quando o INSERT do wallet_transaction REALMENTE
--        inseriu (RETURNING id INTO v_txn_id) — NUNCA via `IF FOUND`, que é TRUE mesmo quando o
--        ON CONFLICT DO NOTHING suprime a linha (creditaria em dobro num retry/corrida).
--
--   3. release_hold_postpago(job, reason)
--        Cancelamento / no-show ANTES da captura: marca 'refunded'. NÃO mexe em saldo (nada foi
--        debitado do DB no postpago). Loga auditoria com type 'escrow_void' (hold anulado, amount 0).
--        Retorna o asaas_payment_id para a Edge Function liberar/deletar o hold no Asaas.
--        UPDATE ... WHERE status='authorized' impede liberar um já capturado.
--
-- reference_id ESTÁVEL: job_id (igual ao prepago — um pagamento por turno). Compatível com a
--   constraint UNIQUE (wallet_id, reference_id) já existente. NÃO altera o contrato das RPCs prepago
--   nem a constraint de idempotência.
--
-- search_path = '' + refs schema-qualificadas (padrão consolidado nas migrations 20260622000300).
-- GRANT EXECUTE ... TO service_role, authenticated (Article 8 — sem GRANT, .rpc() falha no PostgREST).
-- Idempotente (CREATE OR REPLACE). Reversível (DOWN abaixo).
--
-- DOWN (rollback):
--   DROP FUNCTION IF EXISTS public.authorize_escrow_postpago(UUID, UUID, DECIMAL, TEXT, UUID);
--   DROP FUNCTION IF EXISTS public.capture_escrow_postpago(UUID, UUID);
--   DROP FUNCTION IF EXISTS public.release_hold_postpago(UUID, TEXT);
--   ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
--   ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
--     CHECK (type IN ('credit','debit','escrow_reserve','escrow_release','initial_balance','platform_fee'));

-- =============================================
-- 0. Estender o CHECK de wallet_transactions.type com os tipos de auditoria postpago (amount 0):
--    'escrow_authorize' (hold criado no cartão) e 'escrow_void' (hold liberado/anulado antes da captura).
-- =============================================
ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
    CHECK (type IN (
        'credit', 'debit', 'escrow_reserve', 'escrow_release',
        'initial_balance', 'platform_fee', 'escrow_authorize', 'escrow_void'
    ));

-- =============================================
-- 1. authorize_escrow_postpago — grava o hold (status 'authorized', kind 'postpaid'). Sem saldo.
-- =============================================
CREATE OR REPLACE FUNCTION public.authorize_escrow_postpago(
    p_job_id           UUID,
    p_application_id   UUID,
    p_amount           DECIMAL,
    p_asaas_payment_id TEXT,
    p_company_user_id  UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_company_wallet_id UUID;
    v_escrow_id         UUID;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Valor de autorizacao invalido: %', p_amount;
    END IF;
    IF p_asaas_payment_id IS NULL OR length(trim(p_asaas_payment_id)) = 0 THEN
        RAISE EXCEPTION 'asaas_payment_id obrigatorio para autorizar escrow postpago';
    END IF;

    -- IDEMPOTÊNCIA: hold já registrado para esta cobrança Asaas → retorna o existente, sem duplicar.
    SELECT id INTO v_escrow_id
    FROM public.escrow_transactions
    WHERE asaas_payment_id = p_asaas_payment_id;
    IF FOUND THEN
        RETURN v_escrow_id;
    END IF;

    -- Carteira da empresa (NÃO debita — postpago: o lock é no cartão, não no saldo do DB).
    -- A coluna company_wallet_id é NOT NULL no schema; usamos a wallet existente da empresa.
    SELECT id INTO v_company_wallet_id
    FROM public.wallets
    WHERE user_id = p_company_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Carteira da empresa nao encontrada para usuario: %', p_company_user_id;
    END IF;

    -- Cria o escrow 'authorized'/'postpaid'. O índice parcial único idx_escrow_one_authorized_per_job
    -- impede dois holds ativos para o mesmo turno; idx_escrow_unique_asaas_payment impede dois escrows
    -- para o mesmo hold (corrida concorrente cai aqui com 23505).
    INSERT INTO public.escrow_transactions(
        job_id, application_id, amount, company_wallet_id, status, kind,
        asaas_payment_id, authorized_at
    )
    VALUES (
        p_job_id, p_application_id, p_amount, v_company_wallet_id, 'authorized', 'postpaid',
        p_asaas_payment_id, now()
    )
    RETURNING id INTO v_escrow_id;

    -- Log de auditoria (amount 0 — não move saldo). reference_id liga ao hold, idempotente por wallet.
    INSERT INTO public.wallet_transactions(wallet_id, amount, type, description, reference_id)
    VALUES (
        v_company_wallet_id, 0, 'escrow_authorize',
        'Hold autorizado no cartao (postpago)', 'authorize-' || p_asaas_payment_id
    )
    ON CONFLICT (wallet_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;

    RETURN v_escrow_id;
END;
$$;

-- =============================================
-- 2. capture_escrow_postpago — captura o hold e credita o worker (atômico, idempotente).
-- =============================================
CREATE OR REPLACE FUNCTION public.capture_escrow_postpago(
    p_job_id           UUID,
    p_worker_wallet_id UUID
)
RETURNS TABLE(escrow_id UUID, escrow_amount DECIMAL)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_escrow_id UUID;
    v_amount    DECIMAL;
    v_txn_id    UUID;
BEGIN
    -- Só captura um hold AINDA autorizado (impede double-capture: a 2ª chamada não casa o WHERE).
    UPDATE public.escrow_transactions
    SET status      = 'released',   -- estado terminal de pagamento ao worker (igual ao prepago)
        captured_at = now(),
        released_at = now(),
        worker_wallet_id = p_worker_wallet_id
    WHERE job_id = p_job_id
      AND status = 'authorized'
      AND kind   = 'postpaid'
    RETURNING id, amount INTO v_escrow_id, v_amount;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nenhum hold autorizado (postpago) encontrado para o job: %', p_job_id;
    END IF;

    -- Credita o worker. reference_id = job_id (estável) + UNIQUE (wallet_id, reference_id) garante
    -- que recapturar/reprocessar não credita em dobro (Article 9). Reusa type 'escrow_release' para
    -- manter sync/relatórios existentes funcionando sem alteração.
    --
    -- RETURNING id INTO v_txn_id é a chave da idempotência REAL: com ON CONFLICT DO NOTHING o RETURNING
    -- só devolve uma linha quando a transação foi DE FATO inserida; num conflito (recaptura/retry/corrida)
    -- ele devolve zero linhas e v_txn_id fica NULL. NÃO usar `IF FOUND` aqui: em PL/pgSQL FOUND é TRUE
    -- após o INSERT mesmo quando o ON CONFLICT suprimiu a linha — usar FOUND creditaria o saldo em dobro.
    INSERT INTO public.wallet_transactions(wallet_id, amount, type, description, reference_id)
    VALUES (p_worker_wallet_id, v_amount, 'escrow_release', 'Pagamento recebido pela vaga', p_job_id::TEXT)
    ON CONFLICT (wallet_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_txn_id;

    -- Só credita o saldo quando a transação foi REALMENTE inserida (v_txn_id NOT NULL). Se o log já
    -- existia (conflito), o saldo já foi creditado na 1ª captura — não credita de novo.
    IF v_txn_id IS NOT NULL THEN
        UPDATE public.wallets
        SET balance = balance + v_amount, updated_at = now()
        WHERE id = p_worker_wallet_id;
    END IF;

    RETURN QUERY SELECT v_escrow_id, v_amount;
END;
$$;

-- =============================================
-- 3. release_hold_postpago — cancela/no-show ANTES da captura. Marca 'refunded'. Sem saldo.
-- =============================================
CREATE OR REPLACE FUNCTION public.release_hold_postpago(
    p_job_id UUID,
    p_reason TEXT DEFAULT 'Hold liberado (cancelamento/no-show)'
)
RETURNS TABLE(escrow_id UUID, asaas_payment_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_escrow_id         UUID;
    v_asaas_payment_id  TEXT;
    v_company_wallet_id UUID;
BEGIN
    -- Só libera um hold ainda autorizado (não toca um já capturado/released).
    UPDATE public.escrow_transactions
    SET status = 'refunded'
    WHERE job_id = p_job_id
      AND status = 'authorized'
      AND kind   = 'postpaid'
    RETURNING id, asaas_payment_id, company_wallet_id
        INTO v_escrow_id, v_asaas_payment_id, v_company_wallet_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nenhum hold autorizado (postpago) encontrado para o job: %', p_job_id;
    END IF;

    -- Log de auditoria (amount 0 — nada saiu/entrou no saldo no postpago). Idempotente por wallet.
    -- type 'escrow_void' = hold liberado/anulado (distinto de 'escrow_authorize' = hold criado).
    INSERT INTO public.wallet_transactions(wallet_id, amount, type, description, reference_id)
    VALUES (v_company_wallet_id, 0, 'escrow_void', p_reason, 'release-hold-' || v_asaas_payment_id)
    ON CONFLICT (wallet_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;

    RETURN QUERY SELECT v_escrow_id, v_asaas_payment_id;
END;
$$;

-- =============================================
-- 4. GRANT EXECUTE (Article 8 — sem isto, .rpc() via PostgREST falha)
-- =============================================
GRANT EXECUTE ON FUNCTION public.authorize_escrow_postpago(UUID, UUID, DECIMAL, TEXT, UUID) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_escrow_postpago(UUID, UUID)                        TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.release_hold_postpago(UUID, TEXT)                          TO service_role, authenticated;
