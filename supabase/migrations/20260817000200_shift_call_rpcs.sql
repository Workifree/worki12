-- Migration: RPCs do Chamado de Turno — aceitar (corrida), recusar, cancelar (F1)
-- File: supabase/migrations/20260817000200_shift_call_rpcs.sql
-- Spec: .harness/spec/chamado-de-turno/spec.md (R4, R5, R6, R7, R9, R10)
--
-- ============================================================================
-- POR QUE RPC (e não UPDATE do client)
-- ============================================================================
--   O aceite é uma CORRIDA: N freelas recebem a mesma vaga e o primeiro leva. Hoje
--   `respondToInvite` valida a transição no client (fetch, depois update) — dois aceites
--   simultâneos passam os dois. Com vaga única isso contrata duas pessoas para uma posição:
--   a empresa descobre no dia do turno, com gente sobrando e uma diária a mais para pagar.
--   Só o banco pode arbitrar, e só com lock.
--
--   `shift_calls`/`shift_call_targets` não têm policy de UPDATE (20260817000100) — toda
--   transição de estado passa por aqui. Máquina de estados em um lugar só.
--
-- ============================================================================
-- ONDE O LOCK MORA — no TURNO, não no chamado
-- ============================================================================
--   Lockar a linha do chamado pareceria natural e estaria ERRADO: nada impede dois chamados
--   abertos para o MESMO turno (a empresa dispara para o elenco do salão e, dez minutos depois,
--   para o da cozinha). Eles disputam as mesmas vagas. `SELECT ... FROM jobs WHERE id = ...
--   FOR UPDATE` serializa por TURNO, que é onde o recurso escasso (as vagas) realmente vive.
--
-- ============================================================================
-- OS DOIS TRIGGERS PRÉ-EXISTENTES QUE ESTA RPC PRECISA ATRAVESSAR
-- ============================================================================
--   Ambos vivem em `applications` e são AFTER/BEFORE **UPDATE**:
--     - trg_validate_application_update (BEFORE): o WORKER só pode escrever 'hired' quando
--       OLD.status='invited' E OLD.invited_by_company_at IS NOT NULL (20260622000300).
--     - trg_auto_reserve_escrow_on_hire (AFTER): reserva escrow PREPAGO em todo 'hired', EXCETO
--       nessa mesma condição de aceite-de-convite (20260622000300 / 20260622000900).
--
--   Consequências, e como esta função lida com cada uma:
--
--   (a) Caminho normal (não existe application ainda) → **INSERT** com status já 'hired'.
--       Nenhum dos dois triggers é de INSERT ⇒ nenhum dispara ⇒ nenhum saldo se move, sem
--       precisar de flag nem de exceção nova. Article 8 intacto por construção.
--
--   (b) Já existe application em estado não-terminal ('invited' legado, 'declined', ou os
--       status do fluxo pull) → **DOIS UPDATEs**, de propósito. Um UPDATE único para 'hired'
--       vindo de 'declined' seria barrado pelo primeiro trigger ("Apenas a empresa pode
--       aprovar, rejeitar ou contratar") e, se passasse, cairia na reserva prepaga do segundo —
--       que em modo A aborta por falta de saldo e derruba o aceite inteiro. O passo 1 normaliza
--       a linha para convite pendente ('invited' não é gatilho de nada); o passo 2 executa a
--       transição que os dois triggers reconhecem e liberam. Nenhum trigger existente é alterado.
--
-- ============================================================================
-- AUTORIZAÇÃO DENTRO DE SECURITY DEFINER
-- ============================================================================
--   SECURITY DEFINER **desliga a RLS** (as tabelas são NO FORCE). Toda checagem de permissão
--   aqui é EXPLÍCITA no corpo da função — nunca herdada de policy. `cancel_shift_call` chama
--   `is_job_owner` na unha; `claim_shift_slot`/`decline_shift_call` exigem que auth.uid() seja
--   alvo do chamado. auth.uid() FUNCIONA dentro de DEFINER (o DEFINER troca o ROLE, não as
--   claims do JWT) — precedentes: validate_application_update, notify_counterpart_on_*.
--
-- Article 8 INTACTO: nenhuma RPC de saldo chamada, nenhuma tabela financeira tocada.
-- Risk: MEDIUM (escreve em applications). Reversível (DOWN abaixo).
--
-- ATENÇÃO AO APLICAR: as mensagens de notificação abaixo são TEXTO DE PRODUTO (vão para o sino
-- do freela) e têm acentuação. Aplicar via CLI/arquivo. Se aplicar via MCP, conferir depois que
-- os acentos sobreviveram — já se perderam uma vez no transporte (ver 20260816201322).
--
-- ============================================================================
-- DOWN (rollback)
-- ============================================================================
--   DROP FUNCTION IF EXISTS public.claim_shift_slot(uuid);
--   DROP FUNCTION IF EXISTS public.decline_shift_call(uuid);
--   DROP FUNCTION IF EXISTS public.cancel_shift_call(uuid);
--
-- ============================================================================
-- COMO VERIFICAR A CORRIDA (o teste que justifica a feature inteira)
-- ============================================================================
--   Precisa de DUAS sessões simultâneas. Com um turno de 1 vaga e um chamado com 2 alvos:
--
--   Sessão A                                   Sessão B
--   --------                                   --------
--   BEGIN;                                     BEGIN;
--   SELECT set_config('role','authenticated',true);
--   SELECT set_config('request.jwt.claims',
--          '{"sub":"<WORKER_A>","role":"authenticated"}',true);
--   SELECT public.claim_shift_slot('<CALL_ID>');
--   -- devolve {"outcome":"claimed",...}
--                                              SELECT set_config('role','authenticated',true);
--                                              SELECT set_config('request.jwt.claims',
--                                                     '{"sub":"<WORKER_B>","role":"authenticated"}',true);
--                                              SELECT public.claim_shift_slot('<CALL_ID>');
--                                              -- BLOQUEIA no lock de jobs...
--   COMMIT;
--                                              -- ...destrava e devolve {"outcome":"filled"}
--                                              ROLLBACK;
--
--   Prova final (uma contratação, não duas):
--     SELECT count(*) FROM public.applications
--      WHERE job_id='<JOB_ID>' AND status IN ('hired','in_progress','completed');
--     -- ESPERADO: 1
--
--   Prova de que nenhum saldo se moveu:
--     SELECT count(*) FROM public.escrow_transactions WHERE job_id='<JOB_ID>';  -- ESPERADO: 0
-- ============================================================================

-- =============================================
-- 1. claim_shift_slot — o aceite (corrida)
-- =============================================
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

    -- LOCK no turno (ver cabeçalho). A partir daqui, um aceite por vez neste turno.
    SELECT j.slots INTO v_slots FROM public.jobs j WHERE j.id = v_call.job_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
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
        -- (a) do cabeçalho: INSERT não dispara os triggers de escrow (ambos são de UPDATE).
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
        -- (b) do cabeçalho: dois UPDATEs para atravessar os triggers sem alterá-los.
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
    -- histórica — ver 20260816210000); resolvemos os dois casos.
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

-- =============================================
-- 2. decline_shift_call — recusa (NEUTRA, R6)
-- =============================================
CREATE OR REPLACE FUNCTION public.decline_shift_call(p_call_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid          uuid := (SELECT auth.uid());
    v_now          timestamptz := now();
    v_call         public.shift_calls%ROWTYPE;
    v_target_id    uuid;
    v_target_resp  text;
    v_pending      integer;
    v_accepted     integer;
    v_company_user uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    SELECT * INTO v_call FROM public.shift_calls WHERE id = p_call_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    SELECT t.id, t.response INTO v_target_id, v_target_resp
      FROM public.shift_call_targets t
     WHERE t.call_id = p_call_id AND t.worker_id = v_uid;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_target');
    END IF;
    IF v_target_resp IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'already_responded', 'response', v_target_resp);
    END IF;

    -- Recusa NÃO exige chamado aberto: se expirou, registrar a recusa é inofensivo e mantém
    -- o histórico honesto. Nenhuma punição, nenhum efeito em reputação/XP (R6).
    UPDATE public.shift_call_targets
       SET response = 'declined', responded_at = v_now
     WHERE id = v_target_id;

    SELECT count(*) FILTER (WHERE t.response IS NULL),
           count(*) FILTER (WHERE t.response = 'accepted')
      INTO v_pending, v_accepted
      FROM public.shift_call_targets t
     WHERE t.call_id = p_call_id;

    -- Chamado esvaziou (todo mundo respondeu, ninguém aceitou): a empresa precisa saber AGORA,
    -- não no fim da janela — é o caso em que ela tem de chamar mais gente.
    IF v_pending = 0 AND v_accepted = 0 AND v_call.status = 'open' THEN
        SELECT c.owner_id INTO v_company_user
          FROM public.companies c WHERE c.id = v_call.company_id;
        IF v_company_user IS NULL THEN
            v_company_user := v_call.company_id;
        END IF;

        INSERT INTO public.notifications (user_id, type, title, message, link)
        VALUES (
            v_company_user,
            'status_change',
            'Ninguém aceitou o chamado',
            'Todos os freelas chamados para este turno recusaram. Chame mais gente do elenco.',
            '/company/jobs/' || v_call.job_id::text || '/candidates'
        );
    END IF;

    RETURN jsonb_build_object('outcome', 'declined', 'pending', v_pending);
END;
$$;

-- =============================================
-- 3. cancel_shift_call — empresa desfaz o disparo
-- =============================================
CREATE OR REPLACE FUNCTION public.cancel_shift_call(p_call_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid  uuid := (SELECT auth.uid());
    v_now  timestamptz := now();
    v_call public.shift_calls%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    SELECT * INTO v_call FROM public.shift_calls WHERE id = p_call_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- DEFINER desliga a RLS: a autorização é explícita, na unha.
    IF NOT public.is_job_owner(v_call.job_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    IF v_call.status <> 'open' THEN
        RETURN jsonb_build_object('outcome', 'not_open', 'status', v_call.status);
    END IF;

    UPDATE public.shift_calls
       SET status = 'cancelled', closed_at = v_now
     WHERE id = p_call_id AND status = 'open';

    UPDATE public.shift_call_targets
       SET response = 'closed', responded_at = v_now
     WHERE call_id = p_call_id AND response IS NULL;

    -- Quem já tinha aceitado NÃO é desfeito aqui: a application 'hired' segue de pé. Cancelar o
    -- chamado é parar de procurar, não dispensar quem já foi contratado — para isso existe
    -- `dismissFromShift`, que tem as próprias guardas (pagamento ativo, presença já registrada).
    INSERT INTO public.notifications (user_id, type, title, message, link)
    SELECT t.worker_id,
           'status_change',
           'Chamado cancelado',
           'A empresa cancelou o chamado deste turno. Nada muda para você — você continua no elenco.',
           '/my-jobs'
      FROM public.shift_call_targets t
     WHERE t.call_id      = p_call_id
       AND t.response     = 'closed'
       AND t.responded_at = v_now;

    RETURN jsonb_build_object('outcome', 'cancelled');
END;
$$;

-- =============================================
-- 4. GRANTS
-- =============================================
REVOKE ALL ON FUNCTION public.claim_shift_slot(uuid)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decline_shift_call(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_shift_call(uuid)  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.claim_shift_slot(uuid)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_shift_call(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_shift_call(uuid)  TO authenticated, service_role;

COMMENT ON FUNCTION public.claim_shift_slot(uuid) IS
    'Aceite de chamado com primeiro-aceite. Serializa no LOCK de jobs (as vagas são do turno, '
    'não do chamado). Devolve jsonb {outcome: claimed|filled|expired|cancelled|not_target|'
    'already_responded|already_hired|blocked_cancelled|not_found|unauthenticated}. '
    'NÃO move saldo: o caminho normal é INSERT, e os triggers de escrow são de UPDATE.';
COMMENT ON FUNCTION public.decline_shift_call(uuid) IS
    'Recusa de chamado. NEUTRA — zero punição (R6/R7 do Slice 1). Avisa a empresa quando o '
    'chamado esvazia (todos responderam, ninguém aceitou).';
COMMENT ON FUNCTION public.cancel_shift_call(uuid) IS
    'Empresa para de procurar. Fecha alvos pendentes e avisa. NÃO desfaz quem já aceitou — '
    'para isso existe dismissFromShift, com as guardas de pagamento e presença.';
