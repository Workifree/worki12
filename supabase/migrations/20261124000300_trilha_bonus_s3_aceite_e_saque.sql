-- Migration: Trilha de bonus do operador, S3 — RPCs do operador: aceite, tela, PIX, saque, confete
-- File: supabase/migrations/20261124000300_trilha_bonus_s3_aceite_e_saque.sql
-- Spec:  .harness/spec/trilha-bonus-operador/spec.md (R3, R8, R20-R25, A30-A32)
-- ADR:   .harness/memory-bank/decisions/ADR-20261124-trilha-bonus-operador.md (C2, C4, C10)
--
-- RPCs do OPERADOR (todas DEFINER, search_path vazio, sempre sobre auth.uid(): nenhuma aceita
-- "por qual usuario perguntar"; REVOKE PUBLIC/anon; GRANT authenticated + service_role):
--   bonus_accept_enrollment(p_pix_key text DEFAULT NULL, p_rules_version text DEFAULT NULL)
--   bonus_get_my_trail(p_light boolean DEFAULT false)      -- VOLATILE: avalia antes de ler (C4)
--   bonus_set_pix_key(p_pix_key text)
--   bonus_request_payout()
--   bonus_cancel_payout()
--   bonus_mark_celebrated(p_award_ids uuid[])
-- Helpers internos (sem EXECUTE para authenticated): bonus_payout_cut, bonus_next_payout_monday,
--   bonus_award_phase.
--
-- CONTRATO COM A UI (frontend/src/components/bonus/{types,rpcApi,trailView}.ts)
-- ----------------------------------------------------------------------------
--   * Nomes das 6 RPCs e argumentos p_pix_key / p_award_ids: IGUAIS ao adaptador.
--   * Snapshot snake_case: status, ends_at, milestones[], earned_cents, releasing_cents,
--     releasing_until, in_review_cents, finalizing, available_cents, min_payout_cents,
--     requested_payout_cents, next_payout_date, pix_key_masked, payouts[]. EXTRAS (o adaptador atual
--     ignora): outcome, eligible, rules_version, total_milestones, done_milestones,
--     missing_to_min_cents, can_request, requested_payout_id, earned_cents por marco, window_closed.
--   * Marco: id, key, group, sort_order, title, amount_cents, counts_in_total (o
--     total vem do dado: 19 marcos A-D, ver S1/C7), earned, earned_at, award_state, available_at,
--     award_id, celebrated, progress {current,target,unit}.
--   * M5: award_state devolvido: validating | available | in_payout | paid | not_counted. O operador
--     NUNCA ve conferencia: um turno em revisao aparece como 'validating', com os MESMOS campos da
--     janela normal enquanto a data e futura; sem data futura, available_at nulo e release_text fixo
--     "estamos finalizando". As chaves in_review_cents e finalizing NAO existem (topo: release_text).
--     pending_shifts[].warnings[]: frases em portugues quando um horario informado diverge do registro.
--   * pending_shifts[]: turnos do operador ainda fora do livro, com missing_stamps[] para a UI cobrar:
--     worker_checkin | worker_checkout | company_checkin | company_checkout | payment_record |
--     receipt_confirmation  (+ job_id, job_title, shift_date, worker_name).
--   * "estado concluido/ativo/trancado" e VISUAL (R21): o banco entrega earned + progress; os 3 ativos
--     sao escolhidos pela UI (3 primeiros nao concluidos por sort_order).
--   * Status: disabled | not_enrolled | invited | active | ended | identity_required.
--   * p_light=true: so status/ends_at, SEM avaliar (para o menu perguntar "ha inscricao active?").
--   * Desfechos (campo `outcome`): aceite: ok | disabled | not_invited | track_not_open | ack_missing |
--     identity_required | rules_version_mismatch | invalid | unauthenticated.
--     PIX: ok | open_payout | invalid | not_enrolled | disabled. Saque: ok | below_minimum |
--     no_pix_key | already_requested | nothing_available | disabled | not_enrolled.
--     p_rules_version NULL = aceita a versao vigente (o operador marcou o regulamento na tela).
--
-- C10 — REGRA DE CORTE UNICA (unifica AF5 e R25; substitui o "domingo" de R25 e A30):
--   O PIX de uma segunda-feira M inclui so o que (a) ja era "disponivel" e (b) foi PEDIDO ate a
--   sexta-feira anterior 23:59:59 America/Sao_Paulo. O corte e bonus_payout_cut(M) = sabado 00:00 SP
--   (limite exclusivo). Pedido e cancelamento valem ate esse instante; depois dele o pedido cai na
--   segunda seguinte. Uma regra so, aplicada a "o que entra" e ao "ate quando se pede/cancela".
--   Efeito sobre A30: quarta -> proxima segunda; sabado/domingo/segunda -> a segunda DEPOIS dela.
--
-- Article 8: nada aqui toca o razao financeiro nem RPC de saldo. Dinheiro em centavos; texto de tela
-- usa "bonus conquistado" (nunca saldo/carteira).
--
-- DOWN (rollback):
--   DROP FUNCTION IF EXISTS public.bonus_accept_enrollment(text, text), public.bonus_get_my_trail(boolean),
--       public.bonus_set_pix_key(text), public.bonus_request_payout(), public.bonus_cancel_payout(),
--       public.bonus_mark_celebrated(uuid[]), public.bonus_payout_cut(date),
--       public.bonus_next_payout_monday(timestamptz), public.bonus_award_phase(text, timestamptz, jsonb);
--
-- SIMULACAO CONTRA PRODUCAO: gate exige S1+S2 aplicadas (ordem acusada); nenhum objeto de S3 existe;
--   nenhuma funcao com o mesmo nome em outro schema de busca. Programa desligado: toda RPC devolve
--   status/outcome 'disabled' sem escrever.

-- ============================================================================
-- 0. PORTAO
-- ============================================================================
DO $mig$
BEGIN
    IF to_regclass('public.bonus_awards') IS NULL OR to_regclass('public.bonus_enrollments') IS NULL THEN
        RAISE EXCEPTION 'ASSERCAO S3: S1 (20261124000100) nao aplicada. Ordem: S1 -> S2 -> S3 -> S4. Nada foi criado. HALT.';
    END IF;
    IF to_regprocedure('public.bonus_evaluate_enrollment(uuid)') IS NULL
       OR to_regprocedure('public.bonus_identity_ok(uuid, uuid)') IS NULL
       OR to_regprocedure('public.bonus_award_review_due(jsonb)') IS NULL
       OR to_regprocedure('public.bonus_worker_exclusion(uuid, uuid)') IS NULL
       OR to_regprocedure('public.bonus_recheck_payability(uuid)') IS NULL
       OR to_regprocedure('public.bonus_ledger_is_live(uuid, uuid, uuid)') IS NULL THEN
        RAISE EXCEPTION 'ASSERCAO S3: S2 (20261124000200) nao aplicada (motor ausente). Ordem: S1 -> S2 -> S3 -> S4. Nada foi criado. HALT.';
    END IF;
END
$mig$;

-- ============================================================================
-- 1. HELPERS INTERNOS
-- ============================================================================

-- Corte do PIX da segunda-feira p_monday: sabado 00:00 SP (exclusivo) = sexta 23:59:59.999.
CREATE OR REPLACE FUNCTION public.bonus_payout_cut(p_monday date)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
    SELECT (((p_monday - 2))::timestamp) AT TIME ZONE 'America/Sao_Paulo';
$fn$;

-- Primeira segunda-feira (estritamente depois de hoje, data local) cujo corte ainda nao passou.
CREATE OR REPLACE FUNCTION public.bonus_next_payout_monday(p_now timestamptz DEFAULT now())
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $fn$
DECLARE
    v_d date := (p_now AT TIME ZONE 'America/Sao_Paulo')::date;
    v_m date;
BEGIN
    v_m := v_d + (8 - extract(isodow FROM v_d)::integer);   -- segunda estritamente depois de hoje
    WHILE p_now >= public.bonus_payout_cut(v_m) LOOP
        v_m := v_m + 7;
    END LOOP;
    RETURN v_m;
END;
$fn$;

-- Fase DERIVADA do award (C4): nada disto e persistido.
CREATE OR REPLACE FUNCTION public.bonus_award_phase(p_state text, p_available_at timestamptz, p_evidence jsonb)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT CASE
        WHEN p_state = 'not_counted' THEN 'not_counted'
        WHEN p_state = 'paid'        THEN 'paid'
        WHEN p_state = 'in_payout'   THEN 'in_payout'
        WHEN public.bonus_award_review_due(p_evidence) IS NOT NULL THEN 'in_review'
        WHEN p_available_at > now()  THEN 'validating'
        ELSE 'available'
    END;
$fn$;

-- ============================================================================
-- 2. bonus_accept_enrollment (R3, R8, C2)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bonus_accept_enrollment(
    p_pix_key       text DEFAULT NULL,
    p_rules_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_tz    constant text := 'America/Sao_Paulo';
    v_uid   uuid := auth.uid();
    s       record;
    e       record;
    tr      record;
    v_snap  jsonb;
    v_start timestamptz;
    v_day   timestamp;
    v_pix   text;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    SELECT * INTO s FROM public.bonus_program_settings;
    IF NOT FOUND OR NOT s.enabled THEN
        RETURN jsonb_build_object('outcome', 'disabled');
    END IF;

    SELECT * INTO e FROM public.bonus_enrollments WHERE operator_user_id = v_uid FOR NO KEY UPDATE;
    IF NOT FOUND OR e.status = 'cancelled' THEN
        RETURN jsonb_build_object('outcome', 'not_invited');
    END IF;
    IF e.status IN ('active', 'ended') THEN
        RETURN jsonb_build_object('outcome', 'ok', 'enrollment_id', e.id);      -- idempotente
    END IF;

    SELECT * INTO tr FROM public.bonus_tracks WHERE id = e.track_id;
    IF tr.status <> 'open' THEN
        RETURN jsonb_build_object('outcome', 'track_not_open');
    END IF;
    IF e.company_ack_at IS NULL THEN
        RETURN jsonb_build_object('outcome', 'ack_missing');
    END IF;
    -- C2: identidade propria confirmada, nao dono, nao do Worki, nao vetada. Dono unico/concierge: recusado.
    IF NOT public.bonus_identity_ok(e.company_id, v_uid) THEN
        RETURN jsonb_build_object('outcome', 'identity_required');
    END IF;
    IF p_rules_version IS NOT NULL AND p_rules_version <> s.rules_version THEN
        RETURN jsonb_build_object('outcome', 'rules_version_mismatch', 'rules_version', s.rules_version);
    END IF;
    IF p_pix_key IS NOT NULL AND length(btrim(p_pix_key)) NOT BETWEEN 3 AND 140 THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    v_pix := CASE WHEN p_pix_key IS NULL THEN e.pix_key ELSE btrim(p_pix_key) END;

    v_snap := jsonb_build_object(
        'track', jsonb_build_object('key', tr.key, 'cap_cents', tr.cap_cents,
                                    'window_weeks', tr.window_weeks, 'params', tr.params),
        'milestones', (SELECT jsonb_agg(jsonb_build_object(
                           'id', m.id, 'key', m.key, 'grp', m.grp, 'sort_order', m.sort_order,
                           'title', m.title, 'amount_cents', m.amount_cents, 'event_kind', m.event_kind,
                           'params', m.params, 'requires_actor', m.requires_actor,
                           'counts_in_total', m.counts_in_total) ORDER BY m.sort_order)
                         FROM public.bonus_milestones m WHERE m.track_id = tr.id AND m.active),
        'min_payout_cents', s.min_payout_cents,
        'rules_version', s.rules_version,
        -- briefing que ja existia no aceite nunca vale marco (mesmo apagado e regravado)
        'briefing_prefilled', COALESCE((SELECT length(btrim(COALESCE(c.default_briefing, '')))
                                               >= (tr.params->>'briefing_min_chars')::integer
                                          FROM public.companies c WHERE c.id = e.company_id), false));

    -- inicio = comeco do dia LOCAL; fim = inicio + window_weeks*7 dias (data local, sem deriva de DST)
    v_day   := date_trunc('day', now() AT TIME ZONE v_tz);
    v_start := v_day AT TIME ZONE v_tz;

    UPDATE public.bonus_enrollments
       SET status             = 'active',
           accepted_at        = now(),
           starts_at          = v_start,
           ends_at            = (v_day + make_interval(days => tr.window_weeks * 7)) AT TIME ZONE v_tz,
           rules_version      = s.rules_version,
           milestones_snapshot = v_snap,
           cap_cents          = tr.cap_cents,
           pix_key            = v_pix,
           pix_key_normalized = public.bonus_normalize_pix(v_pix)
     WHERE id = e.id;

    -- cria os awards de aceite (marcos 1 e 2) pelo motor: nada de tratamento especial
    PERFORM public.bonus_evaluate_enrollment(e.id);

    RETURN jsonb_build_object('outcome', 'ok', 'enrollment_id', e.id);
END;
$fn$;

-- ============================================================================
-- 3. bonus_get_my_trail (R20-R24) — projecao FECHADA: nada interno sai (AF7, A12g)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bonus_get_my_trail(p_light boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid        uuid := auth.uid();
    s            record;
    e            record;
    tr           record;
    v_snap       jsonb;
    v_identity   boolean;
    v_eligible   boolean;
    v_earned     bigint;
    v_releasing  bigint;
    v_inreview   bigint;
    v_available  bigint;
    v_requested  bigint;
    v_rel_until  timestamptz;
    v_rel_text   text;
    v_tol        interval;
    v_pending    jsonb;
    v_min        integer;
    v_pay        record;
    v_next       date;
    v_miles      jsonb;
    v_payouts    jsonb;
    v_total      integer;
    v_done       integer;
    c_shifts     integer;
    c_weeks      integer;
    c_invites    integer;
    c_accepted   integer;
    c_jobs       integer;
    c_repeat     integer;
    v_pix_mask   text;
    v_closed     boolean;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated', 'status', 'not_enrolled');
    END IF;
    SELECT * INTO s FROM public.bonus_program_settings;
    IF NOT FOUND OR NOT s.enabled THEN
        RETURN jsonb_build_object('outcome', 'ok', 'status', 'disabled');
    END IF;

    SELECT * INTO e FROM public.bonus_enrollments WHERE operator_user_id = v_uid;
    IF NOT FOUND OR e.status = 'cancelled' THEN
        RETURN jsonb_build_object('outcome', 'ok', 'status', 'not_enrolled');
    END IF;

    IF e.status = 'invited' THEN
        SELECT * INTO tr FROM public.bonus_tracks WHERE id = e.track_id;
        v_identity := public.bonus_identity_ok(e.company_id, v_uid);
        v_eligible := v_identity AND e.company_ack_at IS NOT NULL AND tr.status = 'open';
        RETURN jsonb_build_object(
            'outcome', 'ok',
            'status', CASE WHEN v_identity THEN 'invited' ELSE 'identity_required' END,
            'eligible', v_eligible,
            'rules_version', s.rules_version,
            'cap_cents', e.cap_cents,
            'min_payout_cents', s.min_payout_cents,
            'milestones', '[]'::jsonb, 'payouts', '[]'::jsonb);
    END IF;

    IF p_light THEN
        RETURN jsonb_build_object('outcome', 'ok', 'status', e.status, 'ends_at', e.ends_at);
    END IF;

    -- avalia ANTES de ler (C4): a tela nunca fica atras do banco e nao ha corrida com a decisao do dono
    PERFORM public.bonus_evaluate_enrollment(e.id);
    SELECT * INTO e FROM public.bonus_enrollments WHERE id = e.id;
    v_snap := e.milestones_snapshot;
    v_min  := (v_snap->>'min_payout_cents')::integer;

    v_tol := make_interval(mins => (v_snap->'track'->'params'->>'clock_tolerance_min')::integer);

    -- LOW-8: com data futura, conferencia e janela normal sao identicas (mesmos campos). Sem data
    -- futura o texto e unico e fixo, sem prazo nem distincao.
    SELECT COALESCE(sum(a.amount_cents) FILTER (WHERE a.state <> 'not_counted'), 0),
           COALESCE(sum(a.amount_cents) FILTER (WHERE a.state = 'earned'
                       AND public.bonus_award_phase(a.state, a.available_at, a.evidence) IN ('validating', 'in_review')), 0),
           COALESCE(sum(a.amount_cents) FILTER (WHERE a.state = 'earned'
                       AND public.bonus_award_phase(a.state, a.available_at, a.evidence) = 'in_review'
                       AND a.available_at <= now()), 0),
           COALESCE(sum(a.amount_cents) FILTER (WHERE a.state = 'earned'
                       AND public.bonus_award_phase(a.state, a.available_at, a.evidence) = 'available'), 0),
           COALESCE(sum(a.amount_cents) FILTER (WHERE a.state = 'in_payout'), 0),
           min(a.available_at) FILTER (WHERE a.state = 'earned' AND a.amount_cents > 0 AND a.available_at > now())
      INTO v_earned, v_releasing, v_inreview, v_available, v_requested, v_rel_until
      FROM public.bonus_awards a
     WHERE a.enrollment_id = e.id;

    v_rel_text := CASE WHEN v_inreview > 0 THEN 'estamos finalizando' END;

    -- contadores de progresso (so turnos CONTAVEIS e vivos; nunca o motivo do resto)
    SELECT count(*) INTO c_shifts FROM public.bonus_shift_ledger l
     WHERE l.enrollment_id = e.id AND l.counted
       AND public.bonus_ledger_is_live(e.company_id, l.job_id, l.worker_id);
    SELECT count(*) INTO c_weeks FROM (
        SELECT 1 FROM public.bonus_shift_ledger l WHERE l.enrollment_id = e.id AND l.counted
           AND public.bonus_ledger_is_live(e.company_id, l.job_id, l.worker_id)
         GROUP BY date_trunc('week', l.shift_date::timestamp)) w;
    SELECT COALESCE(max(q.n), 0) INTO c_repeat FROM (
        SELECT count(DISTINCT l.job_id) AS n FROM public.bonus_shift_ledger l
         WHERE l.enrollment_id = e.id AND l.counted
           AND public.bonus_ledger_is_live(e.company_id, l.job_id, l.worker_id)
         GROUP BY l.worker_id) q;
    SELECT count(*) INTO c_jobs FROM public.bonus_attributions ba
      JOIN public.jobs jb ON jb.id = ba.job_id AND jb.company_id = e.company_id
     WHERE ba.enrollment_id = e.id AND COALESCE(jb.status, '') <> 'deleted';
    SELECT count(*), count(*) FILTER (WHERE x.accepted)
      INTO c_invites, c_accepted
      FROM (SELECT tc.worker_id,
                   tc.status = 'accepted' AND EXISTS (
                       SELECT 1 FROM public.bonus_server_stamps sa
                        WHERE sa.subject_id = tc.id AND sa.kind = 'elenco_accept'
                          AND sa.actor_user_id = tc.worker_id) AS accepted
              FROM public.team_connections tc
              JOIN public.bonus_server_stamps si
                ON si.subject_id = tc.id AND si.kind = 'elenco_invite' AND si.actor_user_id = e.operator_user_id
             WHERE tc.company_id = e.company_id AND tc.invited_by = e.operator_user_id
               AND si.stamped_at >= e.starts_at AND si.stamped_at < e.ends_at) x
     WHERE public.bonus_worker_exclusion(e.id, x.worker_id) IS NULL;

    -- turnos ja iniciados, fora do livro, com o que falta para fechar
    SELECT COALESCE(jsonb_agg(q.item ORDER BY q.ord), '[]'::jsonb) INTO v_pending
      FROM (
        SELECT jb.start_date AS ord,
               jsonb_build_object(
                 'job_id', jb.id, 'job_title', jb.title,
                 'shift_date', public.bonus_local_date(jb.start_date),
                 'worker_name', wk.full_name,
                 'missing_stamps', to_jsonb(array_remove(ARRAY[
                     CASE WHEN ap.worker_checkin_at IS NULL THEN 'worker_checkin' END,
                     CASE WHEN ap.worker_checkout_at IS NULL THEN 'worker_checkout' END,
                     CASE WHEN ap.company_checkin_confirmed_at IS NULL THEN 'company_checkin' END,
                     CASE WHEN ap.company_checkout_confirmed_at IS NULL THEN 'company_checkout' END,
                     CASE WHEN sp.id IS NULL THEN 'payment_record' END,
                     CASE WHEN sp.id IS NULL OR sp.worker_confirmed_at IS NULL THEN 'receipt_confirmation' END
                 ], NULL)),
                 -- horario informado a posteriori, diferente de quando foi registrado
                 'warnings', COALESCE((
                     SELECT jsonb_agg('O horário informado para ' ||
                                CASE st.kind WHEN 'worker_checkin'  THEN 'a chegada do freela'
                                             WHEN 'worker_checkout' THEN 'a saída do freela'
                                             WHEN 'company_checkin' THEN 'a confirmação de chegada'
                                             ELSE 'a confirmação de saída' END
                                || ' é diferente da hora em que foi registrado. Este turno pode não entrar na contagem.'
                                ORDER BY st.kind)
                       FROM public.bonus_server_stamps st
                      CROSS JOIN LATERAL (SELECT CASE st.kind
                              WHEN 'worker_checkin'   THEN ap.worker_checkin_at
                              WHEN 'worker_checkout'  THEN ap.worker_checkout_at
                              WHEN 'company_checkin'  THEN ap.company_checkin_confirmed_at
                              ELSE ap.company_checkout_confirmed_at END AS informado) h
                      WHERE st.subject_id = ap.id
                        AND st.kind IN ('worker_checkin', 'worker_checkout', 'company_checkin', 'company_checkout')
                        AND h.informado NOT BETWEEN st.stamped_at - v_tol AND st.stamped_at + v_tol), '[]'::jsonb)
               ) AS item
          FROM public.bonus_attributions ba
          JOIN public.jobs jb ON jb.id = ba.job_id AND jb.company_id = e.company_id
          JOIN public.applications ap ON ap.job_id = jb.id
          LEFT JOIN public.workers wk ON wk.id = ap.worker_id
          LEFT JOIN public.shift_payments sp
                 ON sp.job_id = ap.job_id AND sp.worker_id = ap.worker_id AND sp.status = 'recorded'
         WHERE ba.enrollment_id = e.id AND e.status = 'active'
           AND ap.status IN ('hired', 'in_progress', 'completed')
           AND COALESCE(jb.status, '') <> 'deleted'
           AND public.bonus_local_date(jb.start_date) <= public.bonus_local_date(now())
           AND NOT EXISTS (SELECT 1 FROM public.bonus_shift_ledger l
                            WHERE l.enrollment_id = e.id AND l.job_id = ap.job_id AND l.worker_id = ap.worker_id)
         ORDER BY jb.start_date DESC
         LIMIT 20) q;

    v_closed := now() >= e.ends_at;

    SELECT COALESCE(jsonb_agg(q.item ORDER BY q.so), '[]'::jsonb) INTO v_miles
      FROM (
        SELECT (m.x->>'sort_order')::integer AS so,
               jsonb_build_object(
                 'id',             m.x->>'id',
                 'key',            m.x->>'key',
                 'group',          m.x->>'grp',
                 'sort_order',     (m.x->>'sort_order')::integer,
                 'title',          m.x->>'title',
                 'amount_cents',   (m.x->>'amount_cents')::integer
                                   + COALESCE((SELECT sum((t.value->>'amount_cents')::integer)
                                                 FROM jsonb_array_elements(m.x->'params'->'tiers') AS t(value)
                                                WHERE (t.value->>'tier')::integer > 1), 0),
                 'counts_in_total', (m.x->>'counts_in_total')::boolean,
                 'earned',         a.id IS NOT NULL AND a.state <> 'not_counted',
                 'earned_at',      CASE WHEN a.state <> 'not_counted' THEN a.earned_at END,
                 'earned_cents',   COALESCE((SELECT sum(a2.amount_cents) FROM public.bonus_awards a2
                                              WHERE a2.enrollment_id = e.id AND a2.state <> 'not_counted'
                                                AND a2.milestone_id = (m.x->>'id')::uuid), 0),
                 'award_state',    CASE WHEN a.id IS NULL THEN NULL
                                        WHEN public.bonus_award_phase(a.state, a.available_at, a.evidence) = 'in_review'
                                        THEN 'validating'
                                        ELSE public.bonus_award_phase(a.state, a.available_at, a.evidence) END,
                 'release_text',   CASE WHEN a.id IS NOT NULL AND a.available_at <= now()
                                         AND public.bonus_award_phase(a.state, a.available_at, a.evidence) = 'in_review'
                                        THEN 'estamos finalizando' END,
                 'available_at',   CASE WHEN a.id IS NOT NULL AND a.available_at > now()
                                         AND public.bonus_award_phase(a.state, a.available_at, a.evidence) IN ('validating', 'in_review')
                                        THEN a.available_at END,
                 'award_id',       a.id,
                 'celebrated',     a.id IS NULL OR a.celebrated_at IS NOT NULL,
                 'progress',       CASE m.x->>'event_kind'
                     WHEN 'elenco_invited'  THEN jsonb_build_object('current', LEAST(c_invites,  (m.x->'params'->>'threshold')::integer), 'target', (m.x->'params'->>'threshold')::integer, 'unit', 'freelas')
                     WHEN 'elenco_accepted' THEN jsonb_build_object('current', LEAST(c_accepted, (m.x->'params'->>'threshold')::integer), 'target', (m.x->'params'->>'threshold')::integer, 'unit', 'freelas')
                     WHEN 'job_published'   THEN jsonb_build_object('current', LEAST(c_jobs,     (m.x->'params'->>'threshold')::integer), 'target', (m.x->'params'->>'threshold')::integer, 'unit', 'turnos')
                     WHEN 'shift_counted'   THEN jsonb_build_object('current', LEAST(c_shifts,   (m.x->'params'->>'threshold')::integer), 'target', (m.x->'params'->>'threshold')::integer, 'unit', 'turnos')
                     WHEN 'repeat_worker'   THEN jsonb_build_object('current', LEAST(c_repeat,   (m.x->'params'->>'threshold')::integer), 'target', (m.x->'params'->>'threshold')::integer, 'unit', 'turnos')
                     WHEN 'active_weeks'    THEN jsonb_build_object('current', LEAST(c_weeks,    (m.x->'params'->>'threshold')::integer), 'target', (m.x->'params'->>'threshold')::integer, 'unit', 'semanas')
                     ELSE NULL END
               ) AS item
          FROM jsonb_array_elements(v_snap->'milestones') AS m(x)
          LEFT JOIN public.bonus_awards a
                 ON a.enrollment_id = e.id AND a.milestone_id = (m.x->>'id')::uuid AND a.tier = 1
      ) q;

    SELECT count(*) FILTER (WHERE (m.x->>'counts_in_total')::boolean),
           count(*) FILTER (WHERE (m.x->>'counts_in_total')::boolean
                              AND EXISTS (SELECT 1 FROM public.bonus_awards a
                                           WHERE a.enrollment_id = e.id AND a.milestone_id = (m.x->>'id')::uuid
                                             AND a.tier = 1 AND a.state <> 'not_counted'))
      INTO v_total, v_done
      FROM jsonb_array_elements(v_snap->'milestones') AS m(x);

    SELECT p.id, p.amount_cents, p.scheduled_for INTO v_pay
      FROM public.bonus_payouts p WHERE p.enrollment_id = e.id AND p.status = 'requested';
    v_next := COALESCE(v_pay.scheduled_for, public.bonus_next_payout_monday(now()));

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', p.id, 'amount_cents', p.amount_cents, 'paid_at', p.paid_at,
               'milestone_titles', COALESCE((SELECT jsonb_agg(mm.title ORDER BY mm.sort_order)
                                               FROM public.bonus_awards a
                                               JOIN public.bonus_milestones mm ON mm.id = a.milestone_id
                                              WHERE a.payout_id = p.id), '[]'::jsonb))
               ORDER BY p.paid_at DESC), '[]'::jsonb)
      INTO v_payouts
      FROM public.bonus_payouts p WHERE p.enrollment_id = e.id AND p.status = 'paid';

    v_pix_mask := CASE WHEN e.pix_key IS NULL THEN NULL ELSE '••••' || right(btrim(e.pix_key), 4) END;

    RETURN jsonb_build_object(
        'outcome',                'ok',
        'status',                 e.status,
        'ends_at',                e.ends_at,
        'window_closed',          v_closed,
        'milestones',             v_miles,
        'total_milestones',       v_total,
        'done_milestones',        v_done,
        'earned_cents',           v_earned,
        'releasing_cents',        v_releasing,
        'releasing_until',        v_rel_until,
        'release_text',           v_rel_text,
        'pending_shifts',         v_pending,
        'available_cents',        v_available,
        'min_payout_cents',       v_min,
        'missing_to_min_cents',   CASE WHEN e.status = 'active' AND v_available > 0 AND v_available < v_min
                                       THEN v_min - v_available ELSE 0 END,
        'can_request',            v_pay.id IS NULL AND e.pix_key IS NOT NULL AND v_available > 0
                                  AND (v_available >= v_min OR e.status = 'ended'),
        'requested_payout_id',    v_pay.id,
        'requested_payout_cents', v_pay.amount_cents,
        'next_payout_date',       v_next,
        'pix_key_masked',         v_pix_mask,
        'rules_version',          e.rules_version,
        'payouts',                v_payouts);
END;
$fn$;

-- ============================================================================
-- 4. bonus_set_pix_key (R24b/R25): a chave e do operador e so vai ao admin
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bonus_set_pix_key(p_pix_key text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid uuid := auth.uid();
    e     record;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bonus_program_settings s WHERE s.enabled) THEN
        RETURN jsonb_build_object('outcome', 'disabled');
    END IF;
    IF p_pix_key IS NULL OR length(btrim(p_pix_key)) NOT BETWEEN 3 AND 140 THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    SELECT * INTO e FROM public.bonus_enrollments WHERE operator_user_id = v_uid FOR NO KEY UPDATE;
    IF NOT FOUND OR e.status = 'cancelled' THEN
        RETURN jsonb_build_object('outcome', 'not_enrolled');
    END IF;
    IF EXISTS (SELECT 1 FROM public.bonus_payouts p WHERE p.enrollment_id = e.id AND p.status = 'requested') THEN
        RETURN jsonb_build_object('outcome', 'open_payout');      -- cancele o pedido antes de trocar a chave
    END IF;
    UPDATE public.bonus_enrollments
       SET pix_key = btrim(p_pix_key), pix_key_normalized = public.bonus_normalize_pix(p_pix_key)
     WHERE id = e.id;
    -- A2: chave nova revalidada contra os freelas que sustentam marcos e os vetados (silencioso)
    PERFORM public.bonus_recheck_payability(e.id);
    RETURN jsonb_build_object('outcome', 'ok');
END;
$fn$;

-- ============================================================================
-- 5. bonus_request_payout (R25 + C10)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bonus_request_payout()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid    uuid := auth.uid();
    e        record;
    v_monday date;
    v_cut    timestamptz;
    v_ids    uuid[];
    v_sum    bigint;
    v_min    integer;
    v_pid    uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bonus_program_settings s WHERE s.enabled) THEN
        RETURN jsonb_build_object('outcome', 'disabled');
    END IF;
    SELECT * INTO e FROM public.bonus_enrollments WHERE operator_user_id = v_uid FOR NO KEY UPDATE;
    IF NOT FOUND OR e.status NOT IN ('active', 'ended') THEN
        RETURN jsonb_build_object('outcome', 'not_enrolled');
    END IF;
    -- avalia antes de ler (C4): decisao do dono e pedido serializam na mesma linha de inscricao
    PERFORM public.bonus_evaluate_enrollment(e.id);
    SELECT * INTO e FROM public.bonus_enrollments WHERE id = e.id;

    IF e.pix_key IS NULL THEN
        RETURN jsonb_build_object('outcome', 'no_pix_key');
    END IF;
    IF EXISTS (SELECT 1 FROM public.bonus_payouts p WHERE p.enrollment_id = e.id AND p.status = 'requested') THEN
        RETURN jsonb_build_object('outcome', 'already_requested');
    END IF;

    -- A2/B3: revalida identidade e veto por PIX antes de criar o pedido. Resposta NEUTRA ao operador
    -- (o motivo fica em payout_block_reason, so para o admin). RETURN, nao RAISE: as marcas persistem.
    IF public.bonus_recheck_payability(e.id) IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'nothing_available');
    END IF;

    v_monday := public.bonus_next_payout_monday(now());
    v_cut    := public.bonus_payout_cut(v_monday);
    v_min    := (e.milestones_snapshot->>'min_payout_cents')::integer;

    -- disponivel = earned, sem pedido, passou a janela, nenhum turno da evidencia em conferencia,
    -- e dentro do corte unico (C10)
    SELECT COALESCE(array_agg(a.id), '{}'::uuid[]), COALESCE(sum(a.amount_cents), 0)
      INTO v_ids, v_sum
      FROM public.bonus_awards a
     WHERE a.enrollment_id = e.id
       AND a.state = 'earned' AND a.payout_id IS NULL
       AND a.amount_cents > 0
       AND a.available_at <= now() AND a.available_at < v_cut
       AND public.bonus_award_review_due(a.evidence) IS NULL;

    IF v_sum = 0 THEN
        RETURN jsonb_build_object('outcome', 'nothing_available');
    END IF;
    IF e.status = 'active' AND v_sum < v_min THEN
        RETURN jsonb_build_object('outcome', 'below_minimum', 'available_cents', v_sum,
                                  'missing_cents', v_min - v_sum, 'min_payout_cents', v_min);
    END IF;

    INSERT INTO public.bonus_payouts (enrollment_id, amount_cents, scheduled_for, pix_key_snapshot)
    VALUES (e.id, v_sum, v_monday, e.pix_key)
    RETURNING id INTO v_pid;

    UPDATE public.bonus_awards SET state = 'in_payout', payout_id = v_pid WHERE id = ANY (v_ids);

    RETURN jsonb_build_object('outcome', 'ok', 'payout_id', v_pid, 'amount_cents', v_sum,
                              'scheduled_for', v_monday);
END;
$fn$;

-- ============================================================================
-- 6. bonus_cancel_payout (A31): ate o corte unico; devolve os awards a "disponivel"
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bonus_cancel_payout()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid uuid := auth.uid();
    e     record;
    p     record;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    SELECT * INTO e FROM public.bonus_enrollments WHERE operator_user_id = v_uid FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_enrolled');
    END IF;
    SELECT * INTO p FROM public.bonus_payouts WHERE enrollment_id = e.id AND status = 'requested';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF now() >= public.bonus_payout_cut(p.scheduled_for) THEN
        RETURN jsonb_build_object('outcome', 'too_late');
    END IF;
    UPDATE public.bonus_awards SET state = 'earned', payout_id = NULL
     WHERE payout_id = p.id AND state = 'in_payout';
    UPDATE public.bonus_payouts SET status = 'cancelled' WHERE id = p.id;
    RETURN jsonb_build_object('outcome', 'ok');
END;
$fn$;

-- ============================================================================
-- 7. bonus_mark_celebrated (R24): so awards do proprio operador
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bonus_mark_celebrated(p_award_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid uuid := auth.uid();
    v_n   integer;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_award_ids IS NULL OR cardinality(p_award_ids) = 0 OR cardinality(p_award_ids) > 50 THEN
        RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    UPDATE public.bonus_awards a
       SET celebrated_at = now()
      FROM public.bonus_enrollments e
     WHERE a.id = ANY (p_award_ids)
       AND a.enrollment_id = e.id
       AND e.operator_user_id = v_uid
       AND a.celebrated_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN jsonb_build_object('outcome', 'ok', 'marked', v_n);
END;
$fn$;

-- ============================================================================
-- 8. GRANTS
-- ============================================================================
REVOKE ALL ON FUNCTION public.bonus_payout_cut(date)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bonus_next_payout_monday(timestamptz)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bonus_award_phase(text, timestamptz, jsonb)     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bonus_payout_cut(date)                       TO service_role;
GRANT EXECUTE ON FUNCTION public.bonus_next_payout_monday(timestamptz)        TO service_role;
GRANT EXECUTE ON FUNCTION public.bonus_award_phase(text, timestamptz, jsonb)  TO service_role;

REVOKE ALL ON FUNCTION public.bonus_accept_enrollment(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bonus_get_my_trail(boolean)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bonus_set_pix_key(text)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bonus_request_payout()              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bonus_cancel_payout()               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bonus_mark_celebrated(uuid[])       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bonus_accept_enrollment(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bonus_get_my_trail(boolean)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bonus_set_pix_key(text)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bonus_request_payout()              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bonus_cancel_payout()               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bonus_mark_celebrated(uuid[])       TO authenticated, service_role;

COMMENT ON FUNCTION public.bonus_get_my_trail(boolean) IS
    'Tela do operador (R20-R24). Projecao fechada: nunca devolve exclusion_reason, flags, review/decisao, vetos nem limiares. p_light=true so devolve status (menu) e NAO avalia.';
COMMENT ON FUNCTION public.bonus_request_payout() IS
    'Pedido de saque (R25). Corte unico (C10): sexta 23:59:59 SP antes da segunda do PIX. Minimo so enquanto active; ended pede o restante.';

-- ============================================================================
-- 9. VERIFICACAO FINAL
-- ============================================================================
DO $mig$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('bonus_accept_enrollment', 'bonus_get_my_trail', 'bonus_set_pix_key',
                                  'bonus_request_payout', 'bonus_cancel_payout', 'bonus_mark_celebrated')
    LOOP
        IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'VERIFICACAO S3: % acessivel a anon. HALT.', r.proname;
        END IF;
        IF NOT has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'VERIFICACAO S3: % sem EXECUTE para authenticated. HALT.', r.proname;
        END IF;
    END LOOP;
    -- a regra unica de corte: segunda 2026-11-30 -> sabado 2026-11-28 00:00 SP
    IF public.bonus_payout_cut(DATE '2026-11-30') <> TIMESTAMPTZ '2026-11-28 00:00:00-03' THEN
        RAISE EXCEPTION 'VERIFICACAO S3: bonus_payout_cut errado. HALT.';
    END IF;
    -- quarta 25/11 12:00 SP -> segunda 30/11; sabado 28/11 10:00 -> segunda 07/12; segunda 30/11 00:01 -> 07/12
    IF public.bonus_next_payout_monday(TIMESTAMPTZ '2026-11-25 12:00:00-03') <> DATE '2026-11-30'
       OR public.bonus_next_payout_monday(TIMESTAMPTZ '2026-11-28 10:00:00-03') <> DATE '2026-12-07'
       OR public.bonus_next_payout_monday(TIMESTAMPTZ '2026-11-29 23:59:00-03') <> DATE '2026-12-07'
       OR public.bonus_next_payout_monday(TIMESTAMPTZ '2026-11-30 00:01:00-03') <> DATE '2026-12-07'
       OR public.bonus_next_payout_monday(TIMESTAMPTZ '2026-11-27 23:59:00-03') <> DATE '2026-11-30' THEN
        RAISE EXCEPTION 'VERIFICACAO S3: bonus_next_payout_monday viola a regra unica de corte (C10). HALT.';
    END IF;
END
$mig$;
