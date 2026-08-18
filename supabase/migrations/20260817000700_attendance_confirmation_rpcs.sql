-- Migration: RPCs da Confirmação de véspera — pedir (manual+varredura), responder (F4)
-- File: supabase/migrations/20260817000700_attendance_confirmation_rpcs.sql
-- Spec: .harness/spec/confirmacao-vespera/spec.md (R2, R3, R4 — REVISADOS pelo gate)
-- DDL aprovado (fonte normativa): .harness/spec/confirmacao-vespera/ddl-aprovado.md
-- ADR: .harness/memory-bank/decisions/ADR-20260817-confirmacao-vespera-log-evento.md
--
-- ============================================================================
-- POR QUE RPC (e não UPDATE do client) — mesma razão de shift_call_rpcs
-- ============================================================================
--   `shift_attendance_confirmations` não tem policy de INSERT/UPDATE (20260817000600) — toda
--   transição passa por aqui. Três funções:
--
--   1. `request_attendance_confirmation(p_application_id)` — disparo MANUAL pela empresa
--      (botão "Pedir confirmação"). Cap de 2 pedidos por application, cooldown de 6h.
--   2. `respond_attendance_confirmation(p_application_id, p_response)` — resposta do freela
--      (UM toque em MyJobs). Idempotente: duplo toque não sobrescreve a primeira resposta.
--   3. `request_attendance_confirmations_due()` — a varredura D-1 em lote, chamada pelo
--      `pg_cron` (20260817000800). ÚNICA função desta feature que `authenticated` NÃO pode
--      executar (L5 do gate) — senão qualquer conta dispara notificação em massa para todos os
--      freelas de todos os turnos de amanhã.
--
-- ============================================================================
-- L3 — CAP DE 2 SEM LOCK É CORRIDA, NÃO CONVENIÇÃO
-- ============================================================================
--   `request_attendance_confirmation` abre com `SELECT ... FROM applications WHERE id = ...
--   FOR UPDATE`. Sem o lock, dois cliques simultâneos no botão "Pedir confirmação" leriam
--   `count(*) < 2` duas vezes ANTES de qualquer um gravar — e os dois passariam, estourando o
--   cap para 3. `count()` sozinho não é atômico. Mesmo raciocínio do lock de `jobs` em
--   `claim_shift_slot` (20260817000200) — só que aqui o recurso escasso é o application, não o
--   turno inteiro.
--
-- ============================================================================
-- L8 — RESPOSTA ATÔMICA, NUNCA SELECT-DEPOIS-UPDATE
-- ============================================================================
--   `respond_attendance_confirmation` faz `UPDATE ... WHERE response IS NULL` direto e lê
--   `GET DIAGNOSTICS ... ROW_COUNT`. Um SELECT prévio ("já tem resposta?") seguido de UPDATE
--   abriria a mesma corrida: duplo toque leria "ainda não respondido" duas vezes antes do
--   primeiro UPDATE terminar. O WHERE da própria instrução é o árbitro.
--
--   O UPDATE responde TODOS os pedidos pendentes da application de uma vez (no máximo 2, pelo
--   cap) — uma única resposta do freela fecha qualquer pedido auto+manual ainda em aberto para
--   aquele turno, não só o mais recente.
--
-- ============================================================================
-- POR QUE A NOTIFICAÇÃO DA RESPOSTA FICA INLINE (e a do pedido é trigger — 20260817000600)
-- ============================================================================
--   A regra é o número de ESCRITORES, não o papel do destinatário (ADR, decisão 4). O pedido
--   tem dois caminhos de escrita (esta RPC manual + a varredura em lote) — um trigger garante
--   texto único nos dois. A resposta tem um único escritor (esta RPC), e um trigger por linha
--   aqui criaria um problema real: com 2 pedidos pendentes respondidos no mesmo UPDATE (2
--   linhas afetadas), um trigger AFTER UPDATE FOR EACH ROW disparia DUAS notificações para um
--   único "não vou poder". A notificação fica inline, disparada uma vez por chamada de RPC.
--
-- ============================================================================
-- AUTORIZAÇÃO DENTRO DE SECURITY DEFINER
-- ============================================================================
--   SECURITY DEFINER desliga a RLS. Toda checagem de permissão é EXPLÍCITA no corpo — nunca
--   herdada de policy. `auth.uid()` funciona corretamente dentro de DEFINER (o DEFINER troca o
--   ROLE de execução, não as claims do JWT) — precedentes: validate_application_update,
--   notify_counterpart_on_application_cancel, claim_shift_slot.
--
-- Article 8 INTACTO: nenhuma RPC de saldo chamada, nenhuma tabela financeira tocada.
-- Risk: LOW-MEDIUM (escreve só em shift_attendance_confirmations + notifications; não toca
-- applications).
--
-- ATENÇÃO AO APLICAR: os textos abaixo são TEXTO DE PRODUTO (vão para o sino do freela/empresa)
-- e têm acentuação. Aplicar via CLI/arquivo. Se aplicar via MCP, conferir depois que os acentos
-- sobreviveram — já se perderam uma vez no transporte (20260816201322).
--
-- ============================================================================
-- DOWN (rollback)
-- ============================================================================
--   DROP FUNCTION IF EXISTS public.request_attendance_confirmation(uuid);
--   DROP FUNCTION IF EXISTS public.respond_attendance_confirmation(uuid, text);
--   DROP FUNCTION IF EXISTS public.request_attendance_confirmations_due();
--
-- ============================================================================
-- COMO VERIFICAR (read-only, depois de aplicar)
-- ============================================================================
--   V1. authenticated NÃO pode chamar a varredura (L5 — o achado mais caro se ignorado):
--       SELECT has_function_privilege('authenticated',
--              'public.request_attendance_confirmations_due()', 'EXECUTE');
--       -- ESPERADO: f
--       SELECT has_function_privilege('service_role',
--              'public.request_attendance_confirmations_due()', 'EXECUTE');
--       -- ESPERADO: t
--
--   V2. Cap de 2 + cooldown (sessão de teste, application de teste hired):
--       SELECT public.request_attendance_confirmation('<APP_ID>'); -- {"outcome":"requested","request_count":1}
--       SELECT public.request_attendance_confirmation('<APP_ID>'); -- {"outcome":"cooldown","retry_after":...}
--       -- (avançar requested_at manualmente -6h em teste, ou aguardar)
--       SELECT public.request_attendance_confirmation('<APP_ID>'); -- {"outcome":"requested","request_count":2}
--       SELECT public.request_attendance_confirmation('<APP_ID>'); -- {"outcome":"limit_reached"}
--
--   V3. Idempotência do ON CONFLICT da varredura (rodar duas vezes seguidas):
--       SELECT public.request_attendance_confirmations_due();  -- {"outcome":"ok","requested":N}
--       SELECT public.request_attendance_confirmations_due();  -- {"outcome":"ok","requested":0}
--
--   V3b. A varredura respeita o cap de 2 e não re-pergunta quem já respondeu (achado do
--       evaluator 18/08/2026 — ver comentário no corpo da função):
--       -- application de teste com 2 linhas manuais (cap atingido) e turno = amanhã:
--       SELECT public.request_attendance_confirmations_due();
--       SELECT count(*) FROM public.shift_attendance_confirmations WHERE application_id = '<APP_ID>';
--       -- ESPERADO: continua 2, nenhuma linha 'auto' nova
--       -- application de teste já respondida (response IS NOT NULL) e turno = amanhã:
--       SELECT public.request_attendance_confirmations_due();
--       SELECT count(*) FROM public.shift_attendance_confirmations
--        WHERE application_id = '<APP_ID_RESPONDIDA>' AND response IS NULL;
--       -- ESPERADO: 0 (nenhum pedido novo pendente — o card não deve reaparecer em MyJobs)
--
--   V4. Resposta idempotente (duplo toque):
--       SELECT public.respond_attendance_confirmation('<APP_ID>', 'confirmed');
--       -- {"outcome":"confirmed"}
--       SELECT public.respond_attendance_confirmation('<APP_ID>', 'confirmed');
--       -- {"outcome":"already_responded"}
--       SELECT response, responded_at FROM public.shift_attendance_confirmations
--        WHERE application_id = '<APP_ID>';
--       -- ESPERADO: responded_at do PRIMEIRO toque, não sobrescrito pelo segundo
-- ============================================================================

-- =============================================
-- 1. request_attendance_confirmation — disparo MANUAL pela empresa
-- =============================================
CREATE OR REPLACE FUNCTION public.request_attendance_confirmation(p_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET timezone = 'America/Sao_Paulo'
AS $$
DECLARE
    v_uid       uuid := (SELECT auth.uid());
    v_now       timestamptz := now();
    v_job_id    uuid;
    v_worker_id uuid;
    v_status    text;
    v_responded boolean;
    v_count     integer;
    v_last      timestamptz;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    -- LOCK na application: serializa o cap de 2 (L3 — count() sozinho não é atômico). Mesmo
    -- raciocínio do lock de jobs em claim_shift_slot, só que o recurso escasso aqui é o
    -- application, não o turno inteiro.
    SELECT a.job_id, a.worker_id, a.status
      INTO v_job_id, v_worker_id, v_status
      FROM public.applications a
     WHERE a.id = p_application_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    -- DEFINER desliga a RLS: autorização explícita, na unha (mesmo padrão de cancel_shift_call).
    IF NOT public.is_job_owner(v_job_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    IF v_status NOT IN ('hired', 'in_progress') THEN
        RETURN jsonb_build_object('outcome', 'invalid_status');
    END IF;

    -- MESMO predicado de 20260817000500 (status <> 'deleted'), via helper (L4).
    IF NOT public.job_is_active(v_job_id) THEN
        RETURN jsonb_build_object('outcome', 'job_inactive');
    END IF;

    -- "Amanhã" já passou (turno é hoje ou já foi): não faz sentido pedir confirmação de véspera.
    IF public.job_local_date(v_job_id) < v_now::date THEN
        RETURN jsonb_build_object('outcome', 'job_past');
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.shift_attendance_confirmations
         WHERE application_id = p_application_id AND response IS NOT NULL
    ) INTO v_responded;
    IF v_responded THEN
        RETURN jsonb_build_object('outcome', 'already_responded');
    END IF;

    SELECT count(*), max(requested_at)
      INTO v_count, v_last
      FROM public.shift_attendance_confirmations
     WHERE application_id = p_application_id;

    IF v_count >= 2 THEN
        RETURN jsonb_build_object('outcome', 'limit_reached');
    END IF;

    IF v_last IS NOT NULL AND v_last > v_now - interval '6 hours' THEN
        RETURN jsonb_build_object(
            'outcome', 'cooldown',
            'retry_after', to_jsonb(v_last + interval '6 hours')
        );
    END IF;

    INSERT INTO public.shift_attendance_confirmations
           (application_id, job_id, worker_id, source, requested_by)
    VALUES (p_application_id, v_job_id, v_worker_id, 'manual', v_uid);
    -- trg_notify_worker_on_attendance_request (20260817000600) notifica o freela.

    RETURN jsonb_build_object('outcome', 'requested', 'request_count', v_count + 1);
END;
$$;

COMMENT ON FUNCTION public.request_attendance_confirmation(uuid) IS
    'Disparo MANUAL de confirmação de véspera pela empresa. Lock FOR UPDATE em applications '
    'serializa o cap de 2 (L3). Outcomes: requested|forbidden|invalid_status|job_inactive|'
    'job_past|already_responded|limit_reached|cooldown|not_found|unauthenticated.';

-- =============================================
-- 2. respond_attendance_confirmation — resposta do freela (UM toque)
-- =============================================
CREATE OR REPLACE FUNCTION public.respond_attendance_confirmation(
    p_application_id uuid,
    p_response       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET timezone = 'America/Sao_Paulo'
AS $$
DECLARE
    v_uid          uuid := (SELECT auth.uid());
    v_now          timestamptz := now();
    v_job_id       uuid;
    v_worker_id    uuid;
    v_status       text;
    v_company_id   uuid;
    v_company_user uuid;
    v_job_title    text;
    v_worker_name  text;
    v_rows         integer;
    v_any          boolean;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;

    IF p_response NOT IN ('confirmed', 'cannot_attend') THEN
        RETURN jsonb_build_object('outcome', 'invalid_response');
    END IF;

    SELECT a.job_id, a.worker_id, a.status
      INTO v_job_id, v_worker_id, v_status
      FROM public.applications a
     WHERE a.id = p_application_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_worker_id <> v_uid THEN
        RETURN jsonb_build_object('outcome', 'not_target');
    END IF;

    IF v_status NOT IN ('hired', 'in_progress') THEN
        RETURN jsonb_build_object('outcome', 'invalid_status');
    END IF;

    -- L8: ATÔMICO. Nada de SELECT-depois-UPDATE — duplo toque/retry perde a corrida no próprio
    -- WHERE. Responde TODOS os pedidos pendentes desta application de uma vez (no máx. 2, cap).
    UPDATE public.shift_attendance_confirmations
       SET response = p_response, responded_at = v_now
     WHERE application_id = p_application_id
       AND response IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows = 0 THEN
        SELECT EXISTS (
            SELECT 1 FROM public.shift_attendance_confirmations
             WHERE application_id = p_application_id
        ) INTO v_any;
        RETURN jsonb_build_object(
            'outcome', CASE WHEN v_any THEN 'already_responded' ELSE 'not_requested' END
        );
    END IF;

    -- 'confirmed': NENHUMA notificação extra — a empresa lê ao vivo na própria tela (evita ruído).
    IF p_response = 'cannot_attend' THEN
        SELECT j.company_id, j.title INTO v_company_id, v_job_title
          FROM public.jobs j WHERE j.id = v_job_id;

        -- Ancoragem dupla verbatim de claim_shift_slot (20260816210000): company_id pode ser o
        -- id da empresa OU o uid do dono.
        SELECT c.owner_id INTO v_company_user FROM public.companies c WHERE c.id = v_company_id;
        IF v_company_user IS NULL THEN
            v_company_user := v_company_id;
        END IF;

        SELECT COALESCE(w.full_name, 'O freela') INTO v_worker_name
          FROM public.workers w WHERE w.id = v_worker_id;
        v_worker_name := COALESCE(v_worker_name, 'O freela');

        INSERT INTO public.notifications (user_id, type, title, message, link)
        VALUES (
            v_company_user,
            'status_change',
            v_worker_name || ' avisou que não vai poder ir',
            v_worker_name || ' respondeu que não vai poder comparecer ao turno'
                || COALESCE(' "' || v_job_title || '"', '') || ' de amanhã. '
                || 'Reabra a vaga chamando outro freela do elenco.',
            '/company/jobs/' || v_job_id::text || '/candidates'
        );
    END IF;

    RETURN jsonb_build_object('outcome', p_response);
END;
$$;

COMMENT ON FUNCTION public.respond_attendance_confirmation(uuid, text) IS
    'Resposta do freela ao pedido de confirmação de véspera. UPDATE atômico (WHERE response IS '
    'NULL + ROW_COUNT — L8), nunca SELECT-depois-UPDATE. Notificação da empresa é inline (único '
    'escritor) e só em cannot_attend. Outcomes: confirmed|cannot_attend|not_target|'
    'invalid_status|invalid_response|already_responded|not_requested|not_found|unauthenticated.';

-- =============================================
-- 3. request_attendance_confirmations_due — varredura D-1 em lote (chamada só pelo pg_cron)
-- =============================================
CREATE OR REPLACE FUNCTION public.request_attendance_confirmations_due()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET timezone = 'America/Sao_Paulo'
AS $$
DECLARE
    v_count integer;
BEGIN
    -- Idempotente por ÍNDICE (uq_sac_auto_once), não por convenção de WHERE — duas execuções
    -- simultâneas do cron não duplicam pedido nem notificação (o índice é quem decide).
    --
    -- ACHADO DO EVALUATOR (18/08/2026) — o `ddl-aprovado.md` original especificava esta
    -- varredura SEM guarda de cap/resposta (lacuna da especificação, não desvio do builder).
    -- Sem o NOT EXISTS abaixo, dois cenários reais quebravam a feature:
    --   (a) empresa já usou os 2 pedidos manuais (cap atingido) → o cron inseria uma 3ª linha e
    --       disparava uma 3ª notificação, furando o cap de R6/L3.
    --   (b) freela já respondeu (confirmed/cannot_attend) → o cron perguntava de NOVO em D-1, e
    --       o card reaparecia em MyJobs como se a resposta anterior nunca tivesse existido — o
    --       pior sinal possível numa feature cujo produto É a confirmação.
    --
    -- Escolha: `count(*) < 2`, o MESMO predicado de cap usado em `request_attendance_
    -- confirmation` (não "excluir se existir qualquer linha manual"). Trata 'auto' e 'manual'
    -- SIMETRICAMENTE — o teto é por application, não por origem do pedido. Isso ainda permite
    -- o caso comum do produto (cron dispara em D-1, empresa manda 1 lembrete manual depois) E o
    -- caso "empresa adianta 1 manual antes do cron rodar, cron ainda cobre a véspera" — só barra
    -- quando o teto de 2 já foi tocado, igual à RPC manual.
    INSERT INTO public.shift_attendance_confirmations
           (application_id, job_id, worker_id, source, requested_by)
    SELECT a.id, a.job_id, a.worker_id, 'auto', NULL
      FROM public.applications a
      JOIN public.jobs j ON j.id = a.job_id
     WHERE a.status IN ('hired', 'in_progress')
       AND j.start_date::timestamptz::date = now()::date + 1
       AND public.job_is_active(j.id)
       -- Nunca re-perguntar quem já respondeu (qualquer source).
       AND NOT EXISTS (
           SELECT 1 FROM public.shift_attendance_confirmations s
            WHERE s.application_id = a.id AND s.response IS NOT NULL
       )
       -- Nunca ultrapassar o cap de 2 pedidos totais por application (mesmo predicado da RPC
       -- manual — count(*) >= 2 lá, count(*) < 2 aqui como condição de entrada).
       AND (
           SELECT count(*) FROM public.shift_attendance_confirmations s2
            WHERE s2.application_id = a.id
       ) < 2
    ON CONFLICT (application_id) WHERE source = 'auto' DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    RETURN jsonb_build_object('outcome', 'ok', 'requested', v_count);
END;
$$;

COMMENT ON FUNCTION public.request_attendance_confirmations_due() IS
    'Varredura D-1: pede confirmação para toda application hired/in_progress cujo turno é '
    'AMANHÃ (data local America/Sao_Paulo), respeitando o cap de 2 pedidos totais por '
    'application e nunca re-perguntando quem já respondeu (achado do evaluator, 18/08/2026 — '
    'guarda ausente na especificação original). Chamada só pelo pg_cron (20260817000800) — '
    'NUNCA por authenticated (L5): revogado explicitamente, senão qualquer conta dispara '
    'notificação em massa para todos os freelas de todos os turnos de amanhã. Idempotente por '
    'índice único parcial (uq_sac_auto_once), não por WHERE ... IS NULL.';

-- =============================================
-- 4. GRANTS
-- =============================================
REVOKE ALL ON FUNCTION public.request_attendance_confirmation(uuid)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_attendance_confirmation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_attendance_confirmation(uuid)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.respond_attendance_confirmation(uuid, text) TO authenticated, service_role;

-- L5: a varredura é a ÚNICA função desta feature que `authenticated` NÃO pode chamar. EXECUTE é
-- PUBLIC por default — o REVOKE explícito é obrigatório, não higiene.
REVOKE ALL ON FUNCTION public.request_attendance_confirmations_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_attendance_confirmations_due() TO service_role;
