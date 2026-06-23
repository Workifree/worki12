-- Migration: Confirma que o aceite de convite NÃO reserva/autoriza escrow no trigger — Slice 2
-- File: supabase/migrations/20260622000900_postpago_no_escrow_in_trigger.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260622-pagamento-postpago.md
--
-- DECISÃO (ADR, ponto 4): a AUTORIZAÇÃO postpago (hold no cartão via Asaas) é responsabilidade
--   EXPLÍCITA do service/Edge Function (asaas-authorize-payment), NÃO um side-effect de trigger.
--   Razão dura: um trigger Postgres não pode (e não deve) fazer chamada de rede a um gateway de
--   pagamento — seria I/O externo dentro de uma transação de banco (bloqueia conexão, sem retry,
--   sem tratar timeout/falha do Asaas, e a transação de UPDATE da application ficaria refém da
--   latência/erro do Asaas). Por isso o trigger CONTINUA apenas PULANDO no aceite de convite; quem
--   cria o hold é a Edge Function, chamada pelo `shiftInviteService.respondToInvite('accepted')`.
--
--   Esta migration NÃO muda o comportamento em runtime do trigger (ele já pulava desde a
--   20260622000300). Recria a função SÓ para atualizar o comentário do early-return: ele deixa de
--   ser "placeholder até o Slice 2" e passa a ser a decisão definitiva (sem escrow em trigger no
--   fluxo push). Mantém intacto o fluxo PULL legado (candidatura→hired reserva escrow prepago).
--
-- Idempotente (CREATE OR REPLACE). Reversível (DOWN abaixo).
--
-- DOWN (rollback): reaplicar a função public.auto_reserve_escrow_on_hire da migration
--   20260622000300_invite_accept_hired_transition.sql (comportamento idêntico; só muda o comentário).

CREATE OR REPLACE FUNCTION public.auto_reserve_escrow_on_hire()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_job_budget DECIMAL;
    v_company_id UUID;
BEGIN
    -- Só dispara quando status muda PARA 'hired'.
    IF NEW.status = 'hired' AND (OLD.status IS DISTINCT FROM 'hired') THEN

        -- FLUXO PUSH (postpago, Slice 2): aceite de CONVITE não toca escrow NO TRIGGER.
        -- A autorização (hold no cartão) é feita pela Edge Function asaas-authorize-payment, chamada
        -- explicitamente pelo service no aceite — NUNCA aqui (proibido I/O de pagamento em trigger).
        -- Reconhecemos o aceite pelo par (OLD.status='invited' + invited_by_company_at NOT NULL).
        IF OLD.status = 'invited' AND NEW.invited_by_company_at IS NOT NULL THEN
            RETURN NEW;
        END IF;

        -- FLUXO PULL legado (candidatura → contratação, prepago): reserva escrow como sempre.
        SELECT budget, company_id INTO v_job_budget, v_company_id
        FROM public.jobs WHERE id = NEW.job_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Vaga nao encontrada: %', NEW.job_id;
        END IF;

        IF v_job_budget IS NULL OR v_job_budget <= 0 THEN
            RAISE EXCEPTION 'Vaga sem valor definido. Defina o orcamento antes de contratar.';
        END IF;

        -- Reserva atômica (prepago). Se saldo < budget, reserve_escrow lança e a contratação reverte.
        PERFORM public.reserve_escrow(NEW.job_id, v_job_budget, v_company_id);

        RAISE NOTICE 'Escrow prepago de R$% reservado para job % ao contratar worker % (fluxo pull)',
            v_job_budget, NEW.job_id, NEW.worker_id;
    END IF;

    RETURN NEW;
END;
$$;

-- O trigger trg_auto_reserve_escrow_on_hire (AFTER UPDATE) já existe e aponta para esta função
-- (CREATE OR REPLACE preserva o bind). Nenhum DROP/CREATE TRIGGER necessário.
