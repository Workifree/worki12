-- ============================================================================
-- Relatorio financeiro + planilha de pagamento (ADR-20261127-relatorio-financeiro-e-planilha-de-pagamento)
--
-- ORDEM DE DEPLOY: esta migration ANTES do frontend (o frontend chama as RPCs).
-- Nao depende de nenhuma outra migration pendente: usa so objetos ja em producao
-- (is_company_owner, session_can_operate_job, session_company_member_role,
--  internal_company_confirmed_operator, job_local_date).
--
-- PREMISSAS / NOTAS
--  * Dia local (M3): jobs.start_date e convertido para America/Sao_Paulo. Premissa: o horario
--    gravado e instante real; em producao so 4 de 57 jobs tem start_date 00:00 UTC.
--  * Filtro por responsavel (m4): p_responsible_id NULL = TODOS. Nao existe filtro "so Gestor";
--    turnos sem responsavel ativo aparecem com responsible_id NULL e responsible_name 'Gestor'.
--  * Valor estimado (M1): budget_type='hourly' => budget e valor da HORA;
--    amount = round(budget * COALESCE(horas_medidas, estimated_hours), 2), NULL se nenhuma existir.
--    amount_kind: 'realized' | 'estimated' | 'estimated_by_planned_hours' (hourly sem horas medidas).
--    daily/project: amount = budget.
--  * Totais (M2) cobrem o conjunto filtrado INTEIRO; rows e limitado a 5000 (truncated).
--  * payment_sheet_exports.generated_by sem FK para auth.users (B1).
--
-- Modo A puro: nao toca wallets/escrow/saldo (Article 8 intacto).
--
-- get_financial_report : Gestor (company inteira) OU Encarregado confirmado (so turnos que opera).
--                        NUNCA devolve CPF/PIX.
-- get_payment_sheet    : SO Gestor/dono (is_company_owner). Unica saida com CPF/PIX. Grava log.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Log de geracao da planilha (SEM PII)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_sheet_exports (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
    generated_by  uuid        NOT NULL,  -- pseudonimo retido, SEM FK para auth.users (convencao H2 LGPD, 20260821000000)
    generated_at  timestamptz NOT NULL DEFAULT now(),
    period_from   date        NOT NULL,
    period_to     date        NOT NULL,
    filters       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    workers_count integer     NOT NULL CHECK (workers_count >= 0)
);

COMMENT ON TABLE public.payment_sheet_exports IS
  'Auditoria de quem extraiu CPF/PIX (get_payment_sheet). NUNCA guardar CPF/PIX/nome aqui. ADR-20261127-relatorio-financeiro-e-planilha-de-pagamento.';

ALTER TABLE public.payment_sheet_exports ENABLE ROW LEVEL SECURITY;

-- Somente leitura para o Gestor; escrita exclusiva da RPC DEFINER (sem policy de INSERT/UPDATE/DELETE).
DROP POLICY IF EXISTS pse_select_owner ON public.payment_sheet_exports;
CREATE POLICY pse_select_owner ON public.payment_sheet_exports
    FOR SELECT TO authenticated
    USING (public.is_company_owner(company_id));

REVOKE ALL ON public.payment_sheet_exports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_sheet_exports TO authenticated;
GRANT SELECT, INSERT ON public.payment_sheet_exports TO service_role;

-- Auditoria imutavel: nenhum UPDATE/DELETE, nem de service_role/DEFINER.
CREATE OR REPLACE FUNCTION public.payment_sheet_exports_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $f$
BEGIN
    RAISE EXCEPTION 'payment_sheet_exports e imutavel (auditoria)';
END;
$f$;
DROP TRIGGER IF EXISTS trg_payment_sheet_exports_immutable ON public.payment_sheet_exports;
CREATE TRIGGER trg_payment_sheet_exports_immutable
    BEFORE UPDATE OR DELETE ON public.payment_sheet_exports
    FOR EACH ROW EXECUTE FUNCTION public.payment_sheet_exports_immutable();

CREATE INDEX IF NOT EXISTS idx_pse_company_generated
    ON public.payment_sheet_exports (company_id, generated_at DESC);

-- ---------------------------------------------------------------------------
-- 2. get_financial_report  (jsonb, sem PII)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_financial_report(
    p_company_id     uuid,
    p_from           date,
    p_to             date,
    p_worker_id      uuid DEFAULT NULL,
    p_responsible_id uuid DEFAULT NULL,
    p_tag_id         uuid DEFAULT NULL,
    p_status         text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid       uuid := (SELECT auth.uid());
    v_scope     text;
    v_limit     constant integer := 5000;
    v_result    jsonb;
BEGIN
    IF v_uid IS NULL OR p_company_id IS NULL THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    -- Autorizacao pelo seam (nunca company_id = auth.uid() na mao).
    IF public.is_company_owner(p_company_id) THEN
        v_scope := 'company';
    ELSIF public.session_company_member_role(p_company_id) = 'encarregado' THEN
        IF NOT public.internal_company_confirmed_operator(p_company_id, v_uid) THEN
            RETURN jsonb_build_object('outcome', 'not_confirmed');
        END IF;
        v_scope := 'own';
        p_responsible_id := NULL;   -- forcado ao escopo: o filtro vem do seam, nao do client
    ELSE
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
        RETURN jsonb_build_object('outcome', 'invalid_range');
    END IF;
    IF (p_to - p_from + 1) > 92 THEN
        RETURN jsonb_build_object('outcome', 'range_too_large');
    END IF;
    IF p_status IS NOT NULL AND p_status NOT IN ('aberta', 'agendada', 'paga', 'conciliada') THEN
        RETURN jsonb_build_object('outcome', 'invalid_status');
    END IF;

    WITH pairs AS (
        SELECT a.job_id, a.worker_id
          FROM public.applications a
         WHERE a.status IN ('hired', 'in_progress', 'completed')
        UNION
        SELECT sp.job_id, sp.worker_id
          FROM public.shift_payments sp
         WHERE sp.company_id = p_company_id
           AND sp.status IN ('scheduled', 'recorded')
           AND sp.purged_at IS NULL
    ),
    base AS (
        SELECT
            j.id                                                        AS job_id,
            j.title                                                     AS job_title,
            j.category                                                  AS job_category,
            (COALESCE(j.start_date, j.created_at)
                 AT TIME ZONE 'America/Sao_Paulo')::date                AS job_date,
            j.tag_id,
            t.name                                                      AS tag_name,
            cm.user_id                                                  AS responsible_id,
            CASE WHEN cm.user_id IS NULL THEN 'Gestor'
                 ELSE COALESCE(NULLIF(btrim(cm.display_name), ''), 'Gestor') END AS responsible_name,
            pr.worker_id,
            w.full_name                                                 AS worker_name,
            a.worker_checkin_at                                         AS checkin_at,
            a.worker_checkout_at                                        AS checkout_at,
            (a.company_checkout_confirmed_at IS NOT NULL)               AS checkout_confirmed,
            hm.h                                                        AS hours,
            j.estimated_hours                                           AS hours_estimated,
            CASE WHEN sp.id IS NOT NULL THEN sp.amount
                 WHEN j.budget_type = 'hourly' THEN round(j.budget * COALESCE(hm.h, j.estimated_hours), 2)
                 ELSE j.budget END                                      AS amount,
            CASE WHEN sp.id IS NOT NULL THEN 'realized'
                 WHEN j.budget_type = 'hourly' AND hm.h IS NULL THEN 'estimated_by_planned_hours'
                 ELSE 'estimated' END                                   AS amount_kind,
            sp.id                                                       AS payment_id,
            sp.status                                                   AS payment_status,
            sp.source,
            sp.paid_at,
            sp.scheduled_for,
            sp.worker_confirmed_at,
            CASE WHEN sp.status = 'recorded' AND sp.worker_confirmed_at IS NOT NULL THEN 'conciliada'
                 WHEN sp.status = 'recorded'  THEN 'paga'
                 WHEN sp.status = 'scheduled' THEN 'agendada'
                 ELSE 'aberta' END                                      AS row_status,
            j.company_id,
            j.responsible_id                                            AS raw_responsible_id
          FROM pairs pr
          JOIN public.jobs j
            ON j.id = pr.job_id
           AND j.company_id = p_company_id
           AND j.status <> 'deleted'
          LEFT JOIN public.applications a
            ON a.job_id = pr.job_id AND a.worker_id = pr.worker_id
          LEFT JOIN LATERAL (
                SELECT CASE WHEN a.worker_checkin_at IS NOT NULL
                             AND a.worker_checkout_at IS NOT NULL
                             AND a.worker_checkout_at > a.worker_checkin_at
                            THEN round(extract(epoch FROM (a.worker_checkout_at - a.worker_checkin_at))::numeric / 3600, 2)
                       END AS h
          ) hm ON TRUE
          LEFT JOIN public.shift_payments sp
            ON sp.job_id = pr.job_id AND sp.worker_id = pr.worker_id
           AND sp.status IN ('scheduled', 'recorded') AND sp.purged_at IS NULL
          LEFT JOIN public.workers w ON w.id = pr.worker_id
          LEFT JOIN public.company_tags t
            ON t.id = j.tag_id AND t.company_id = j.company_id
          LEFT JOIN LATERAL (
                SELECT m.user_id, m.display_name
                  FROM public.company_members m
                 WHERE m.company_id = j.company_id
                   AND m.user_id    = j.responsible_id
                   AND m.status     = 'active'
                 LIMIT 1
          ) cm ON TRUE
    ),
    filtered AS (
        SELECT b.*
          FROM base b
         WHERE b.job_date BETWEEN p_from AND p_to
           AND (p_worker_id      IS NULL OR b.worker_id      = p_worker_id)
           AND (p_responsible_id IS NULL OR b.responsible_id = p_responsible_id)
           AND (p_tag_id         IS NULL OR b.tag_id         = p_tag_id)
           AND (p_status         IS NULL OR b.row_status     = p_status)
           AND (v_scope = 'company'
                OR public.session_can_operate_job(b.company_id, b.raw_responsible_id, b.job_date))
    ),
    numbered AS (
        SELECT f.*,
               row_number() OVER (ORDER BY f.job_date, f.worker_name, f.job_id, f.worker_id) AS rn,
               count(*)     OVER ()                                                        AS total_n
          FROM filtered f
    ),
    kept AS (
        SELECT * FROM numbered WHERE rn <= v_limit
    ),
    by_worker AS (
        SELECT k.worker_id,
               max(k.worker_name)                                          AS worker_name,
               count(*)                                                    AS shifts_count,
               COALESCE(sum(k.hours), 0)                                   AS hours_total,
               count(*) FILTER (WHERE k.hours IS NULL)                     AS hours_missing_count,
               COALESCE(sum(k.amount), 0)                                  AS total_amount,
               COALESCE(sum(k.amount) FILTER (WHERE k.payment_status = 'recorded'), 0) AS total_paid,
               COALESCE(sum(k.amount) FILTER (WHERE k.payment_status IS DISTINCT FROM 'recorded'), 0) AS total_to_pay
          FROM numbered k GROUP BY k.worker_id
    ),
    by_day AS (
        SELECT k.job_date,
               count(*)                                                    AS shifts_count,
               COALESCE(sum(k.hours), 0)                                   AS hours_total,
               count(*) FILTER (WHERE k.hours IS NULL)                     AS hours_missing_count,
               COALESCE(sum(k.amount), 0)                                  AS total_amount,
               COALESCE(sum(k.amount) FILTER (WHERE k.payment_status = 'recorded'), 0) AS total_paid,
               COALESCE(sum(k.amount) FILTER (WHERE k.payment_status IS DISTINCT FROM 'recorded'), 0) AS total_to_pay
          FROM numbered k GROUP BY k.job_date
    )
    SELECT jsonb_build_object(
        'outcome',   'ok',
        'scope',     v_scope,
        'truncated', COALESCE((SELECT max(n.total_n) FROM numbered n), 0) > v_limit,
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'job_id', k.job_id, 'job_title', k.job_title, 'job_category', k.job_category,
                'job_date', k.job_date, 'tag_id', k.tag_id, 'tag_name', k.tag_name,
                'responsible_id', k.responsible_id, 'responsible_name', k.responsible_name,
                'worker_id', k.worker_id, 'worker_name', k.worker_name,
                'checkin_at', k.checkin_at, 'checkout_at', k.checkout_at,
                'checkout_confirmed', k.checkout_confirmed,
                'hours', k.hours, 'hours_estimated', k.hours_estimated,
                'amount', k.amount, 'amount_kind', k.amount_kind,
                'hourly_rate', CASE WHEN k.hours > 0 AND k.amount IS NOT NULL
                                    THEN round(k.amount / k.hours, 2) END,
                'payment_id', k.payment_id, 'payment_status', k.payment_status,
                'source', k.source, 'paid_at', k.paid_at, 'scheduled_for', k.scheduled_for,
                'worker_confirmed_at', k.worker_confirmed_at, 'status', k.row_status
            ) ORDER BY k.rn) FROM kept k
        ), '[]'::jsonb),
        'totals', jsonb_build_object(
            'by_worker', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'worker_id', bw.worker_id, 'worker_name', bw.worker_name,
                    'shifts_count', bw.shifts_count, 'hours_total', bw.hours_total,
                    'hours_missing_count', bw.hours_missing_count,
                    'total_amount', bw.total_amount, 'total_paid', bw.total_paid,
                    'total_to_pay', bw.total_to_pay
                ) ORDER BY bw.worker_name, bw.worker_id) FROM by_worker bw
            ), '[]'::jsonb),
            'by_day', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'job_date', bd.job_date,
                    'shifts_count', bd.shifts_count, 'hours_total', bd.hours_total,
                    'hours_missing_count', bd.hours_missing_count,
                    'total_amount', bd.total_amount, 'total_paid', bd.total_paid,
                    'total_to_pay', bd.total_to_pay
                ) ORDER BY bd.job_date) FROM by_day bd
            ), '[]'::jsonb),
            'overall', jsonb_build_object(
                'shifts_count',        (SELECT count(*) FROM numbered),
                'hours_total',         (SELECT COALESCE(sum(hours), 0) FROM numbered),
                'hours_missing_count', (SELECT count(*) FROM numbered WHERE hours IS NULL),
                'total_amount',        (SELECT COALESCE(sum(amount), 0) FROM numbered),
                'total_paid',          (SELECT COALESCE(sum(amount) FILTER (WHERE payment_status = 'recorded'), 0) FROM numbered),
                'total_to_pay',        (SELECT COALESCE(sum(amount) FILTER (WHERE payment_status IS DISTINCT FROM 'recorded'), 0) FROM numbered)
            )
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_financial_report(uuid, date, date, uuid, uuid, uuid, text) IS
  'Relatorio financeiro por (turno, freela). Gestor: company inteira; Encarregado confirmado: so turnos que opera. SEM CPF/PIX. ADR-20261127-relatorio-financeiro-e-planilha-de-pagamento.';

-- ---------------------------------------------------------------------------
-- 3. get_payment_sheet  (jsonb, COM CPF/PIX, Gestor-only, grava log)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_payment_sheet(
    p_company_id     uuid,
    p_from           date,
    p_to             date,
    p_worker_id      uuid DEFAULT NULL,
    p_responsible_id uuid DEFAULT NULL,
    p_tag_id         uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid       uuid := (SELECT auth.uid());
    v_limit     constant integer := 500;
    v_rows      jsonb;
    v_count     integer;
    v_total     integer;
    v_log_id    uuid;
    v_now       timestamptz := now();
BEGIN
    -- Gestor-only. Qualquer outro papel (inclusive Encarregado) = forbidden, sem log.
    IF v_uid IS NULL OR p_company_id IS NULL OR NOT public.is_company_owner(p_company_id) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;

    IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
        RETURN jsonb_build_object('outcome', 'invalid_range');
    END IF;
    IF (p_to - p_from + 1) > 92 THEN
        RETURN jsonb_build_object('outcome', 'range_too_large');
    END IF;

    WITH src AS (
        SELECT
            a.worker_id,
            j.id                                                        AS job_id,
            (COALESCE(j.start_date, j.created_at)
                 AT TIME ZONE 'America/Sao_Paulo')::date                AS job_date,
            t.name                                                      AS tag_name,
            j.tag_id,
            cm.user_id                                                  AS responsible_id,
            hm.h                                                        AS hours,
            sp.id                                                       AS payment_id,
            sp.status                                                   AS payment_status,
            CASE WHEN sp.id IS NOT NULL THEN sp.amount
                 WHEN j.budget_type = 'hourly' THEN round(j.budget * COALESCE(hm.h, j.estimated_hours), 2)
                 ELSE j.budget END                                      AS amount,
            (sp.id IS NULL)                                             AS is_estimated
          FROM public.applications a
          JOIN public.jobs j
            ON j.id = a.job_id
           AND j.company_id = p_company_id
           AND j.status <> 'deleted'
          LEFT JOIN LATERAL (
                SELECT CASE WHEN a.worker_checkin_at IS NOT NULL
                             AND a.worker_checkout_at IS NOT NULL
                             AND a.worker_checkout_at > a.worker_checkin_at
                            THEN round(extract(epoch FROM (a.worker_checkout_at - a.worker_checkin_at))::numeric / 3600, 2)
                       END AS h
          ) hm ON TRUE
          LEFT JOIN public.shift_payments sp
            ON sp.job_id = a.job_id AND sp.worker_id = a.worker_id
           AND sp.status IN ('scheduled', 'recorded') AND sp.purged_at IS NULL
          LEFT JOIN public.company_tags t
            ON t.id = j.tag_id AND t.company_id = j.company_id
          LEFT JOIN LATERAL (
                SELECT m.user_id
                  FROM public.company_members m
                 WHERE m.company_id = j.company_id
                   AND m.user_id    = j.responsible_id
                   AND m.status     = 'active'
                 LIMIT 1
          ) cm ON TRUE
         WHERE a.status = 'completed'
    ),
    f AS (
        SELECT s.*
          FROM src s
         WHERE s.job_date BETWEEN p_from AND p_to
           AND (p_worker_id      IS NULL OR s.worker_id      = p_worker_id)
           AND (p_responsible_id IS NULL OR s.responsible_id = p_responsible_id)
           AND (p_tag_id         IS NULL OR s.tag_id         = p_tag_id)
    ),
    agg AS (
        SELECT
            f.worker_id,
            count(*)                                                       AS shifts_count,
            COALESCE(sum(f.hours), 0)                                      AS hours_total,
            count(*) FILTER (WHERE f.hours IS NULL)                        AS hours_missing_count,
            COALESCE(sum(f.amount) FILTER (WHERE f.payment_status = 'recorded'), 0) AS total_paid,
            COALESCE(sum(f.amount) FILTER (WHERE f.payment_status IS DISTINCT FROM 'recorded'), 0) AS total_to_pay,
            COALESCE(bool_or(f.is_estimated), false)                       AS has_estimated_amount,
            COALESCE(array_agg(DISTINCT f.tag_name) FILTER (WHERE f.tag_name IS NOT NULL), '{}') AS tags,
            COALESCE(array_agg(DISTINCT f.payment_id) FILTER (WHERE f.payment_id IS NOT NULL), '{}') AS payment_ids
          FROM f GROUP BY f.worker_id
    ),
    ranked AS (
        SELECT g.*, w.full_name, w.cpf, w.pix_key,
               row_number() OVER (ORDER BY w.full_name, g.worker_id) AS rn,
               count(*) OVER ()                                      AS total_n
          FROM agg g
          LEFT JOIN public.workers w ON w.id = g.worker_id
    )
    SELECT
        COALESCE(jsonb_agg(jsonb_build_object(
            'worker_id', r.worker_id, 'full_name', r.full_name, 'cpf', r.cpf, 'pix_key', r.pix_key,
            'shifts_count', r.shifts_count, 'hours_total', r.hours_total,
            'hours_missing_count', r.hours_missing_count,
            'total_paid', r.total_paid, 'total_to_pay', r.total_to_pay,
            'has_estimated_amount', r.has_estimated_amount,
            'tags', to_jsonb(r.tags), 'payment_ids', to_jsonb(r.payment_ids)
        ) ORDER BY r.rn) FILTER (WHERE r.rn <= v_limit), '[]'::jsonb),
        count(*) FILTER (WHERE r.rn <= v_limit),
        COALESCE(max(r.total_n), 0)
      INTO v_rows, v_count, v_total
      FROM ranked r;

    IF v_total = 0 THEN
        RETURN jsonb_build_object('outcome', 'ok', 'truncated', false, 'rows', '[]'::jsonb,
                                  'generated_at', v_now, 'log_id', NULL);
    END IF;

    -- Log sem PII. Falha no log aborta a transacao: nao entrega CPF/PIX sem rastro.
    INSERT INTO public.payment_sheet_exports
        (company_id, generated_by, generated_at, period_from, period_to, filters, workers_count)
    VALUES (
        p_company_id, v_uid, v_now, p_from, p_to,
        jsonb_strip_nulls(jsonb_build_object(
            'worker_id', p_worker_id, 'responsible_id', p_responsible_id, 'tag_id', p_tag_id)),
        v_count
    )
    RETURNING id INTO v_log_id;

    RETURN jsonb_build_object(
        'outcome',      'ok',
        'truncated',    v_total > v_limit,
        'rows',         v_rows,
        'generated_at', v_now,
        'log_id',       v_log_id
    );
END;
$$;

COMMENT ON FUNCTION public.get_payment_sheet(uuid, date, date, uuid, uuid, uuid) IS
  'Planilha de pagamento (1 linha por freela, COM CPF/PIX). Gestor-only; grava payment_sheet_exports. ADR-20261127-relatorio-financeiro-e-planilha-de-pagamento.';

-- ---------------------------------------------------------------------------
-- 4. GRANTs (nada para anon)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_financial_report(uuid, date, date, uuid, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_payment_sheet(uuid, date, date, uuid, uuid, uuid)          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_financial_report(uuid, date, date, uuid, uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_payment_sheet(uuid, date, date, uuid, uuid, uuid)          TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- DOWN (manual; payment_sheet_exports NAO e dropada: e auditoria)
-- ---------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.get_payment_sheet(uuid, date, date, uuid, uuid, uuid);
-- DROP FUNCTION IF EXISTS public.get_financial_report(uuid, date, date, uuid, uuid, uuid, text);
