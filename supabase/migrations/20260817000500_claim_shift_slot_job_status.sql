-- Migration: `claim_shift_slot` passa a verificar `jobs.status` (fix de bug achado pelo gate do F3)
-- File: supabase/migrations/20260817000500_claim_shift_slot_job_status.sql
-- Spec: .harness/spec/escala-recorrente/spec.md (predicado de "ocorrência tocável", ADR decisão 3)
--
-- ============================================================================
-- O BUG
-- ============================================================================
--   `claim_shift_slot` (20260817000200) faz `SELECT j.slots FROM public.jobs j WHERE j.id =
--   v_call.job_id FOR UPDATE` para lockar o turno, mas NUNCA olha `j.status`. Um turno
--   excluído (`status = 'deleted'`, soft delete — ver 20260817000400, seção "2") com um
--   `shift_calls` ainda aberto continua reivindicável: o freela chama `claim_shift_slot`, a
--   função encontra o turno pelo id (ele continua existindo como linha, só "escondido" pelo
--   filtro de UI), e ele sai `hired` de um turno que a empresa já cancelou.
--
--   Antes da Escala Recorrente (F3) isso era raro (cancelamento de turno avulso, um de cada
--   vez). Com o cancelamento em massa da F3 (`stop_job_series`, até 60 ocorrências por gesto)
--   deixa de ser raro: qualquer uma dessas ocorrências pode ter um `shift_calls` aberto que o
--   predicado de "ocorrência tocável" já soube evitar TOCAR (ver 20260817000400, seção 3) — mas
--   nada impedia um freela de aceitar um chamado de uma ocorrência que JÁ foi soft-deletada por
--   OUTRO caminho (ex.: "Somente este turno" cancelado manualmente enquanto o chamado seguia
--   aberto).
--
-- ============================================================================
-- O FIX
-- ============================================================================
--   Mesma leitura `FOR UPDATE` (já lockava a linha do turno) passa a trazer `j.status` junto —
--   sem SELECT extra, sem mudar onde o lock mora (ver cabeçalho de 20260817000200, "ONDE O LOCK
--   MORA"). Se `status = 'deleted'`, a função fecha o chamado (mesmo efeito de "vaga não existe
--   mais") e devolve `{"outcome":"cancelled"}` — outcome que já existe no union type do frontend
--   (`ShiftCallOutcome`, `types/index.ts`), nenhuma mudança de tipo necessária.
--
--   Função recriada INTEIRA (`CREATE OR REPLACE`), idêntica à de 20260817000200, com esta ÚNICA
--   mudança. Nenhum outro comportamento muda: a corrida, o lock, os dois outros outcomes de
--   fechamento preguiçoso (expired/filled), e as notificações seguem bit a bit como estavam.
--
-- Article 8 INTACTO: nenhuma RPC de saldo chamada, nenhuma tabela financeira tocada.
-- Risk: LOW. Aditivo — só fecha um caminho que já deveria estar fechado.
--
-- ============================================================================
-- DOWN (rollback — reaplicar a versão anterior de 20260817000200_shift_call_rpcs.sql, seção 1)
-- ============================================================================
--
-- ============================================================================
-- COMO VERIFICAR (read-only, depois de aplicar)
-- ============================================================================
--   V1. Um turno soft-deletado com chamado aberto não é mais reivindicável:
--       BEGIN;
--         -- turno de teste com status='deleted' e um shift_calls 'open' com 1 alvo pendente
--         SELECT set_config('role','authenticated',true);
--         SELECT set_config('request.jwt.claims','{"sub":"<WORKER_ALVO>","role":"authenticated"}',true);
--         SELECT public.claim_shift_slot('<CALL_ID_DE_TURNO_DELETADO>');
--         -- ESPERADO: {"outcome":"cancelled"}
--         SELECT status FROM public.shift_calls WHERE id = '<CALL_ID_DE_TURNO_DELETADO>';
--         -- ESPERADO: 'cancelled'
--         SELECT count(*) FROM public.applications WHERE job_id = '<JOB_ID_DELETADO>';
--         -- ESPERADO: 0 (nenhuma application criada por este caminho)
--       ROLLBACK;
--
--   V2. Turno normal (status='open') continua reivindicável sem mudança de comportamento:
--       SELECT prosrc LIKE '%j.status%' FROM pg_proc WHERE proname = 'claim_shift_slot';
--       -- ESPERADO: t (a checagem existe no corpo da função)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_shift_slot(p_call_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid           uuid := (SELECT auth.uid());
    v_now           timestamptz := now();
    v_call          public.shift_calls%ROWTYPE;
    v_target_id     uuid;
    v_target_resp   text;
    v_slots         integer;
    v_job_status    text;
    v_filled        integer;
    v_app_id        uuid;
    v_app_status    text;
    v_company_user  uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    SELECT * INTO v_call FROM public.shift_calls WHERE id = p_call_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- Ser alvo é pré-requisito e é checado ANTES do lock: um estranho não deve conseguir
    -- serializar a fila de um turno alheio só chamando a função em loop.
    SELECT t.id, t.response INTO v_target_id, v_target_resp
      FROM public.shift_call_targets t
     WHERE t.call_id = p_call_id AND t.worker_id = v_uid;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_target');
    END IF;

    IF v_target_resp IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'already_responded', 'response', v_target_resp);
    END IF;

    -- LOCK no turno (ver cabeçalho de 20260817000200). A partir daqui, um aceite por vez neste
    -- turno. Traz j.status junto (fix desta migration, 20260817000500) — mesmo SELECT, sem
    -- SELECT extra, sem mudar onde o lock mora.
    SELECT j.slots, j.status INTO v_slots, v_job_status
      FROM public.jobs j WHERE j.id = v_call.job_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- FIX (20260817000500): turno soft-deletado (status='deleted', ver 20260817000400 seção 2)
    -- com chamado ainda aberto não é mais reivindicável — fecha o chamado, mesma forma de
    -- fechamento preguiçoso já usada para expired/filled abaixo, e devolve 'cancelled' (outcome
    -- já existente no ShiftCallOutcome do frontend, nenhuma mudança de tipo necessária).
    IF v_job_status = 'deleted' THEN
        UPDATE public.shift_calls
           SET status = 'cancelled', closed_at = v_now
         WHERE id = p_call_id AND status = 'open';
        UPDATE public.shift_call_targets
           SET response = 'closed', responded_at = v_now
         WHERE call_id = p_call_id AND response IS NULL;
        RETURN jsonb_build_object('outcome', 'cancelled');
    END IF;

    -- Reler o chamado DEPOIS do lock: ele pode ter fechado enquanto esperávamos na fila.
    SELECT * INTO v_call FROM public.shift_calls WHERE id = p_call_id;

    IF v_call.status <> 'open' THEN
        RETURN jsonb_build_object(
            'outcome', CASE WHEN v_call.status = 'filled' THEN 'filled' ELSE v_call.status END
        );
    END IF;

    -- Expiração preguiçosa: quem chega atrasado fecha o chamado. Sem cron, sem job agendado.
    IF v_call.expires_at <= v_now THEN
        UPDATE public.shift_calls
           SET status = 'expired', closed_at = v_now
         WHERE id = p_call_id AND status = 'open';
        UPDATE public.shift_call_targets
           SET response = 'closed', responded_at = v_now
         WHERE call_id = p_call_id AND response IS NULL;
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    -- Quantas posições do turno já estão ocupadas (fonte da verdade: applications).
    SELECT count(*) INTO v_filled
      FROM public.applications a
     WHERE a.job_id = v_call.job_id
       AND a.status IN ('hired', 'in_progress', 'completed');

    IF v_filled >= v_slots THEN
        UPDATE public.shift_calls
           SET status = 'filled', closed_at = v_now
         WHERE id = p_call_id AND status = 'open';
        UPDATE public.shift_call_targets
           SET response = 'closed', responded_at = v_now
         WHERE call_id = p_call_id AND response IS NULL;
        RETURN jsonb_build_object('outcome', 'filled');
    END IF;

    SELECT a.id, a.status INTO v_app_id, v_app_status
      FROM public.applications a
     WHERE a.job_id = v_call.job_id AND a.worker_id = v_uid;

    IF v_app_id IS NULL THEN
        -- (a) do cabeçalho de 20260817000200: INSERT não dispara os triggers de escrow (ambos
        -- são de UPDATE).
        INSERT INTO public.applications (
            job_id, worker_id, status,
            invited_by_company_at, invitation_response, invitation_responded_at, invitation_expires_at
        ) VALUES (
            v_call.job_id, v_uid, 'hired',
            v_call.created_at, 'accepted', v_now, v_call.expires_at
        ) RETURNING id INTO v_app_id;

    ELSIF v_app_status IN ('hired', 'in_progress', 'completed') THEN
        -- Já estava no turno (ex.: aceitou por outro chamado). Idempotente.
        UPDATE public.shift_call_targets
           SET response = 'accepted', responded_at = v_now
         WHERE id = v_target_id;
        RETURN jsonb_build_object('outcome', 'already_hired', 'application_id', v_app_id);

    ELSIF v_app_status = 'cancelled' THEN
        -- 'cancelled' é irreversível por decisão anterior do projeto (máquina de estados de
        -- cancelamento). Reabrir aqui contrabandearia uma exceção para essa regra.
        RETURN jsonb_build_object('outcome', 'blocked_cancelled');

    ELSE
        -- (b) do cabeçalho de 20260817000200: dois UPDATEs para atravessar os triggers sem
        -- alterá-los.
        UPDATE public.applications
           SET status                = 'invited',
               invited_by_company_at = COALESCE(invited_by_company_at, v_call.created_at),
               invitation_expires_at = v_call.expires_at
         WHERE id = v_app_id;

        UPDATE public.applications
           SET status                  = 'hired',
               invitation_response     = 'accepted',
               invitation_responded_at = v_now
         WHERE id = v_app_id;
    END IF;

    UPDATE public.shift_call_targets
       SET response = 'accepted', responded_at = v_now
     WHERE id = v_target_id;

    v_filled := v_filled + 1;

    UPDATE public.shift_calls
       SET first_claim_at = COALESCE(first_claim_at, v_now)
     WHERE id = p_call_id;

    IF v_filled >= v_slots THEN
        -- O turno lotou: fecha TODOS os chamados abertos dele (podem ser mais de um) e os
        -- alvos pendentes de todos eles.
        UPDATE public.shift_call_targets t
           SET response = 'closed', responded_at = v_now
          FROM public.shift_calls sc
         WHERE t.call_id = sc.id
           AND sc.job_id = v_call.job_id
           AND t.response IS NULL;

        UPDATE public.shift_calls
           SET status = 'filled', closed_at = v_now
         WHERE job_id = v_call.job_id AND status = 'open';

        -- R10: quem ficou de fora é avisado. O texto é deliberadamente sem culpa — perder a
        -- corrida não é recusa e não conta contra o freela em lugar nenhum (R5).
        INSERT INTO public.notifications (user_id, type, title, message, link)
        SELECT t.worker_id,
               'status_change',
               'Vaga preenchida',
               'A vaga do turno que você recebeu foi preenchida por outro freela. Você continua '
               || 'no elenco e recebe os próximos chamados normalmente.',
               '/my-jobs'
          FROM public.shift_call_targets t
          JOIN public.shift_calls sc ON sc.id = t.call_id
         WHERE sc.job_id      = v_call.job_id
           AND t.response     = 'closed'
           AND t.responded_at = v_now
           AND t.worker_id   <> v_uid;
    END IF;

    -- Avisar a empresa. `company_id` pode ser o id da empresa OU o uid do dono (ancoragem dupla
    -- histórica — ver 20260816210000), resolvemos os dois casos.
    SELECT c.owner_id INTO v_company_user
      FROM public.companies c WHERE c.id = v_call.company_id;
    IF v_company_user IS NULL THEN
        v_company_user := v_call.company_id;
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (
        v_company_user,
        'status_change',
        'Vaga preenchida no turno',
        'Um freela aceitou o chamado e ocupou uma vaga do turno.',
        '/company/jobs/' || v_call.job_id::text || '/candidates'
    );

    RETURN jsonb_build_object(
        'outcome', 'claimed',
        'application_id', v_app_id,
        'filled', v_filled,
        'slots', v_slots
    );
END;
$$;

COMMENT ON FUNCTION public.claim_shift_slot(uuid) IS
    'Aceite de chamado com primeiro-aceite. Serializa no LOCK de jobs (as vagas são do turno, '
    'não do chamado). Devolve jsonb {outcome: claimed|filled|expired|cancelled|not_target|'
    'already_responded|already_hired|blocked_cancelled|not_found|unauthenticated}. '
    'NÃO move saldo: o caminho normal é INSERT, e os triggers de escrow são de UPDATE. '
    '20260817000500: verifica jobs.status — turno soft-deletado (status=deleted) com chamado '
    'ainda aberto fecha o chamado e devolve cancelled, em vez de permitir aceite de um turno '
    'que não existe mais.';

-- GRANT já existia (20260817000200) — CREATE OR REPLACE preserva os privilégios de uma função já
-- existente, mas reafirmamos de forma idempotente por clareza/defesa em profundidade.
REVOKE ALL ON FUNCTION public.claim_shift_slot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_shift_slot(uuid) TO authenticated, service_role;
