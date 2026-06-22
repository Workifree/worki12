-- Migration: Permitir aceite de convite push (worker invited→hired) — Slice 1 (loop relacional)
-- File: supabase/migrations/20260622000300_invite_accept_hired_transition.sql
-- ADR: .harness/spec/v1-operacao-freelancer/adr-001-conexoes-convite.md
--
-- CONTEXTO (finding HIGH do security-review do Slice 1):
--   No modelo PUSH, a EMPRESA cria a application como convite ('invited'); o convite JÁ é o
--   consentimento da empresa em contratar. O aceite do FREELA confirma o engajamento e deve
--   levar a application a 'hired' (status canônico de "contratado para o turno", do qual
--   dependem check-in/checkout e o restante do lifecycle). O service `shiftInviteService.
--   respondToInvite('accepted')` seta exatamente 'hired'.
--
--   DOIS triggers PRÉ-EXISTENTES (já deployados) bloqueiam/distorcem esse aceite — por isso uma
--   NOVA migration (não edição in-place: estes objetos já estão em produção):
--
--   (1) validate_application_update (20260311100000, ~linha 69): lança EXCEPTION quando um worker
--       seta status IN ('approved','rejected','hired') ("Apenas a empresa pode aprovar, rejeitar
--       ou contratar"). Correto para o fluxo PULL (candidatura). Mas o aceite de um CONVITE é
--       diferente: a empresa já convidou (invited_by_company_at NOT NULL). Abrimos uma exceção
--       cirúrgica: worker pode 'invited'→'hired' SE for um convite real (OLD.status='invited' E
--       invited_by_company_at IS NOT NULL). Demais transições do worker para 'hired' seguem
--       bloqueadas (não furamos o isolamento do fluxo pull).
--
--   (2) auto_reserve_escrow_on_hire (20260311200000, AFTER UPDATE): dispara reserve_escrow sempre
--       que status vira 'hired'. No Slice 1 o pagamento é POSTPAGO (escrow é Slice 2 — ver ADR e
--       cabeçalho de 20260622000100). Se deixássemos como está, aceitar um convite exigiria saldo
--       pré-depositado da empresa e reservaria escrow — contrariando o modelo do piloto. Guardamos
--       o trigger para PULAR a reserva quando o 'hired' vem de um aceite de convite. Slice 2
--       substitui este guard pelo hook de pagamento postpago correto.
--
-- NÃO altera o contrato das RPCs de escrow nem a constraint de idempotência. Não cria RPC de saldo.
-- Idempotente (CREATE OR REPLACE). Reversível (DOWN abaixo restaura as versões anteriores).
--
-- DOWN (rollback) — restaurar comportamento pré-Slice-1:
--   Reaplicar as funções validate_application_update e auto_reserve_escrow_on_hire das migrations
--   20260311100000 e 20260311200000 (sem a exceção de convite / sem o guard de convite).

-- =============================================
-- 1. validate_application_update — permitir worker invited→hired SÓ em convite real
-- =============================================
CREATE OR REPLACE FUNCTION public.validate_application_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_is_worker  BOOLEAN;
    v_is_company BOOLEAN;
    v_is_invite_accept BOOLEAN;
BEGIN
    -- Bypass para service_role / contexto de trigger/RPC (auth.uid() é NULL).
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    v_is_worker  := (NEW.worker_id = auth.uid());
    v_is_company := EXISTS(SELECT 1 FROM public.jobs WHERE id = NEW.job_id AND company_id = auth.uid());

    -- É um aceite de convite push? (a empresa já convidou; o worker está confirmando)
    -- OLD.status='invited' garante que só vale a transição a partir do convite pendente;
    -- invited_by_company_at NOT NULL garante que a linha nasceu como convite (não candidatura pull).
    v_is_invite_accept := (
        OLD.status = 'invited'
        AND NEW.status = 'hired'
        AND OLD.invited_by_company_at IS NOT NULL
    );

    -- === CAMPOS IMUTÁVEIS (nenhum papel altera) ===
    IF NEW.worker_id IS DISTINCT FROM OLD.worker_id THEN
        RAISE EXCEPTION 'Nao e permitido alterar o worker_id';
    END IF;
    IF NEW.job_id IS DISTINCT FROM OLD.job_id THEN
        RAISE EXCEPTION 'Nao e permitido alterar o job_id';
    END IF;

    -- === RESTRIÇÕES DO WORKER ===
    IF v_is_worker THEN
        -- Worker NÃO pode alterar colunas de confirmação da empresa
        IF NEW.company_checkin_confirmed_at IS DISTINCT FROM OLD.company_checkin_confirmed_at THEN
            RAISE EXCEPTION 'Worker nao pode alterar confirmacao da empresa (checkin)';
        END IF;
        IF NEW.company_checkout_confirmed_at IS DISTINCT FROM OLD.company_checkout_confirmed_at THEN
            RAISE EXCEPTION 'Worker nao pode alterar confirmacao da empresa (checkout)';
        END IF;
        -- Worker NÃO pode finalizar ('completed')
        IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
            RAISE EXCEPTION 'Apenas a empresa pode finalizar o trabalho';
        END IF;
        -- Worker NÃO pode tomar decisões da empresa (approved/rejected/hired) NO FLUXO PULL.
        -- EXCEÇÃO (Slice 1): aceitar um CONVITE push (invited→hired com invited_by_company_at)
        -- — aí o 'hired' é o aceite do freela, não uma auto-contratação. Esse caso é liberado.
        IF NEW.status IN ('approved', 'rejected', 'hired')
           AND OLD.status NOT IN ('approved', 'rejected', 'hired')
           AND NOT v_is_invite_accept
        THEN
            RAISE EXCEPTION 'Apenas a empresa pode aprovar, rejeitar ou contratar';
        END IF;
    END IF;

    -- === RESTRIÇÕES DA EMPRESA ===
    IF v_is_company THEN
        IF NEW.worker_checkin_at IS DISTINCT FROM OLD.worker_checkin_at THEN
            RAISE EXCEPTION 'Empresa nao pode alterar checkin do worker';
        END IF;
        IF NEW.worker_checkout_at IS DISTINCT FROM OLD.worker_checkout_at THEN
            RAISE EXCEPTION 'Empresa nao pode alterar checkout do worker';
        END IF;
    END IF;

    -- Se o chamador não é worker nem company, bloqueia totalmente.
    IF NOT v_is_worker AND NOT v_is_company THEN
        RAISE EXCEPTION 'Usuario nao autorizado a atualizar esta candidatura';
    END IF;

    RETURN NEW;
END;
$$;

-- =============================================
-- 2. auto_reserve_escrow_on_hire — NÃO reservar escrow quando o 'hired' vem de aceite de convite
--    (Slice 1 é POSTPAGO; escrow no convite é Slice 2). Demais 'hired' (fluxo pull) seguem
--    reservando escrow exatamente como hoje.
-- =============================================
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

        -- Slice 1 (postpago): aceite de CONVITE push não reserva escrow.
        -- Reconhecemos o aceite pelo par (OLD.status='invited' + invited_by_company_at NOT NULL).
        -- Slice 2 troca este early-return pelo hook de pagamento postpago.
        IF OLD.status = 'invited' AND NEW.invited_by_company_at IS NOT NULL THEN
            RETURN NEW;
        END IF;

        -- Fluxo PULL (candidatura → contratação): reserva escrow como sempre.
        SELECT budget, company_id INTO v_job_budget, v_company_id
        FROM public.jobs WHERE id = NEW.job_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Vaga nao encontrada: %', NEW.job_id;
        END IF;

        IF v_job_budget IS NULL OR v_job_budget <= 0 THEN
            RAISE EXCEPTION 'Vaga sem valor definido. Defina o orcamento antes de contratar.';
        END IF;

        -- Reserva atômica. Se saldo < budget, reserve_escrow lança e a contratação é revertida.
        PERFORM public.reserve_escrow(NEW.job_id, v_job_budget, v_company_id);

        RAISE NOTICE 'Escrow de R$% reservado automaticamente para job % ao contratar worker %',
            v_job_budget, NEW.job_id, NEW.worker_id;
    END IF;

    RETURN NEW;
END;
$$;

-- Triggers já existem e apontam para as funções recriadas acima (CREATE OR REPLACE preserva o bind):
--   trg_validate_application_update  (BEFORE UPDATE)
--   trg_auto_reserve_escrow_on_hire  (AFTER UPDATE)
-- Nenhum DROP/CREATE TRIGGER necessário.
