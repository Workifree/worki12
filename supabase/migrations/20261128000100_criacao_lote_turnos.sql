-- Migration: Criacao rapida de turnos — publicacao em lote atomica e idempotente
-- File: supabase/migrations/20261128000100_criacao_lote_turnos.sql
-- Spec: .harness/spec/criacao-rapida-de-turnos/spec.md (R1.5, R1.6, R2d, R4.4; A2, A3, A4, A12)
-- Pre-requisitos APLICADOS em producao: F3 (20260817000400) e equipe E1/E2/E3 (20261123000200..400).
--
-- O QUE ENTRA
--   1. jobs.creation_batch_id uuid, jobs.creation_row smallint (nullable: turno avulso = NULL/NULL).
--   2. UNIQUE parcial (creation_batch_id, creation_row): ultima linha de defesa contra 2o lote.
--      Sem filtro por status DE PROPOSITO: turno cancelado nao libera o lote para ser republicado.
--   3. RPC create_jobs_batch — SECURITY INVOKER. NENHUMA regra de acesso nova: cada INSERT passa pela
--      policy jobs_insert_company_owner (E3), pelo trigger jobs_responsible_guard (E2: preenche
--      responsible_id com quem publica e valida a etiqueta: mesma empresa e nao arquivada, a mesma
--      regra de set_job_tag) e pelos triggers de serie/cap (F3) e da trilha de bonus.
--      jobs_soft_delete_guard (E3) so age em UPDATE de status e nao participa.
--      Serie (R2d): p_series delega a create_job_series (INVOKER; job_series_insert = Gestor-only) e
--      marca o lote NA MESMA transacao, entao a serie tambem fica idempotente.
--
-- Presenca verificada: a politica (presence_mode etc.) ainda nao existe no banco. Os turnos do lote
-- nao citam essas colunas (quando existirem, valem os defaults). Um template que PECA uma politica
-- (attendance_mode / presence_policy nao nulo) e RECUSADO, nunca ignorado em silencio.
--
-- Article 8: nao toca wallets / escrow_transactions / wallet_transactions / shift_payments.
-- Indice sem CONCURRENTLY (a migration roda em transacao; jobs e pequena no piloto).
-- ORDEM DE DEPLOY: esta migration ANTES do frontend que le creation_batch_id (senao 42703).
--
-- DOWN (os turnos criados ficam; so perdem o agrupamento e a idempotencia):
--   DROP FUNCTION IF EXISTS public.create_jobs_batch(uuid, uuid, jsonb, jsonb, jsonb);
--   DROP INDEX IF EXISTS public.uq_jobs_creation_batch_row;
--   ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_creation_batch_pair;
--   ALTER TABLE public.jobs DROP COLUMN IF EXISTS creation_row;
--   ALTER TABLE public.jobs DROP COLUMN IF EXISTS creation_batch_id;
--
-- VERIFICACAO: supabase/tests/pglite-lote/run.mjs

-- ============================================================================
-- 0. PRE-CONDICOES
-- ============================================================================
DO $mig$
BEGIN
    IF to_regclass('public.jobs') IS NULL THEN
        RAISE EXCEPTION 'ASSERCAO LOTE: public.jobs ausente. HALT.';
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.jobs'::regclass) THEN
        RAISE EXCEPTION 'ASSERCAO LOTE: RLS desligada em jobs; uma RPC INVOKER ficaria sem guarda. HALT.';
    END IF;
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'jobs'
           AND column_name IN ('responsible_id', 'tag_id', 'slots', 'series_id', 'series_occurrence_date',
                               'certification_requirement', 'briefing')) <> 7 THEN
        RAISE EXCEPTION 'ASSERCAO LOTE: faltam colunas em jobs (F1/F3/F8/E1). HALT.';
    END IF;
    IF to_regprocedure('public.session_can_operate_job(uuid, uuid, date)') IS NULL
       OR to_regprocedure('public.is_company_owner(uuid)') IS NULL
       OR to_regprocedure('public.create_job_series(uuid, text, integer[], date, date, date[], jsonb)') IS NULL THEN
        RAISE EXCEPTION 'ASSERCAO LOTE: seam (E2) ou create_job_series (F3) ausente. HALT.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.jobs'::regclass AND tgname = 'trg_jobs_responsible_guard'
                      AND tgenabled <> 'D') THEN
        RAISE EXCEPTION 'ASSERCAO LOTE: trg_jobs_responsible_guard ausente ou desligado (E2). HALT.';
    END IF;
    -- Exatamente UMA policy permissiva de INSERT (ou ALL), e ela precisa ser a da E3.
    IF (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'jobs' AND cmd IN ('INSERT', 'ALL')
           AND permissive = 'PERMISSIVE') <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_policies
                       WHERE schemaname = 'public' AND tablename = 'jobs'
                         AND policyname = 'jobs_insert_company_owner'
                         AND position('session_can_operate_job' IN coalesce(with_check, '')) > 0) THEN
        RAISE EXCEPTION 'ASSERCAO LOTE: policy de INSERT em jobs diferente da esperada (E3). HALT -> reconferir.';
    END IF;
END
$mig$;

-- ============================================================================
-- 1. COLUNAS + INDICE
-- ============================================================================
ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS creation_batch_id uuid,
    ADD COLUMN IF NOT EXISTS creation_row smallint;

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_creation_batch_pair;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_creation_batch_pair CHECK (
    (creation_batch_id IS NULL AND creation_row IS NULL)
    OR (creation_batch_id IS NOT NULL AND creation_row IS NOT NULL AND creation_row BETWEEN 1 AND 60)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_creation_batch_row
    ON public.jobs (creation_batch_id, creation_row)
    WHERE creation_batch_id IS NOT NULL;

COMMENT ON COLUMN public.jobs.creation_batch_id IS
    'Lote de publicacao (client_batch_id gerado na tela de revisao). Agrupamento e idempotencia; '
    'nao concede nem nega acesso. NULL = turno criado fora do lote.';
COMMENT ON COLUMN public.jobs.creation_row IS
    'Posicao (1..60) do turno dentro do lote, na ordem enviada a create_jobs_batch.';

-- ============================================================================
-- 2. RPC create_jobs_batch
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_jobs_batch(
    p_client_batch_id uuid,
    p_company_id      uuid,
    p_template        jsonb,
    p_rows            jsonb,
    p_series          jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
    v_uid        uuid := (SELECT auth.uid());
    v_today      date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
    v_total      integer;
    v_i          integer;
    -- FOR inteiro cria variavel propria que some ao sair do bloco: a linha culpada vive aqui.
    v_at         integer := 0;
    v_row        jsonb;
    v_eff        jsonb;
    v_date       date;
    v_errors     jsonb := '[]'::jsonb;
    v_effective  jsonb[] := ARRAY[]::jsonb[];
    v_ids        uuid[] := ARRAY[]::uuid[];
    v_id         uuid;
    v_rec        public.jobs;
    v_series     jsonb;
    v_series_id  uuid;
    v_dates      date[] := ARRAY[]::date[];
    v_weekdays   integer[];
    v_uniform    integer;
    v_state      text;
    v_msg        text;
    v_code       text;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('outcome', 'unauthenticated');
    END IF;
    IF p_client_batch_id IS NULL OR p_company_id IS NULL
       OR p_template IS NULL OR jsonb_typeof(p_template) <> 'object'
       OR p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;

    -- Serializa duplo toque / retry do MESMO lote: o segundo espera o primeiro terminar e, como o
    -- statement seguinte tira snapshot novo (READ COMMITTED), enxerga o lote ja gravado.
    PERFORM pg_advisory_xact_lock(hashtextextended('create_jobs_batch:' || p_client_batch_id::text, 0));

    -- Idempotencia ANTES de qualquer validacao: um retry depois da meia-noite continua sendo sucesso.
    IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.creation_batch_id = p_client_batch_id) THEN
        IF EXISTS (SELECT 1 FROM public.jobs j
                    WHERE j.creation_batch_id = p_client_batch_id
                      AND j.company_id IS DISTINCT FROM p_company_id) THEN
            RETURN jsonb_build_object('outcome', 'batch_conflict');
        END IF;
        -- A leitura de jobs e ampla; so devolve os ids a quem opera a empresa ou algum turno do lote.
        IF NOT public.is_company_owner(p_company_id)
           AND NOT EXISTS (SELECT 1 FROM public.jobs j
                            WHERE j.creation_batch_id = p_client_batch_id
                              AND public.session_can_operate_job(
                                      j.company_id, j.responsible_id,
                                      (j.start_date AT TIME ZONE 'America/Sao_Paulo')::date)) THEN
            RETURN jsonb_build_object('outcome', 'forbidden');
        END IF;
        RETURN jsonb_build_object(
            'outcome', 'already_created',
            'created', 0,
            'job_ids', (SELECT jsonb_agg(j.id ORDER BY j.creation_row)
                          FROM public.jobs j WHERE j.creation_batch_id = p_client_batch_id));
    END IF;

    v_total := jsonb_array_length(p_rows);
    IF v_total = 0 THEN
        RETURN jsonb_build_object('outcome', 'invalid', 'errors', jsonb_build_array(
            jsonb_build_object('row', 0, 'code', 'empty', 'message', 'O lote não tem nenhum turno.')));
    END IF;
    IF v_total > 60 THEN
        RETURN jsonb_build_object('outcome', 'invalid', 'errors', jsonb_build_array(
            jsonb_build_object('row', 0, 'code', 'over_limit', 'message', 'Um lote pode ter no máximo 60 turnos.')));
    END IF;
    IF coalesce(p_template ->> 'attendance_mode', p_template ->> 'presence_policy') IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid', 'errors', jsonb_build_array(
            jsonb_build_object('row', 0, 'code', 'presence_unsupported',
                               'message', 'A política de presença ainda não está disponível na publicação em lote.')));
    END IF;

    -- ------------------------------------------------------------------------
    -- Validacao de TODAS as linhas antes do primeiro INSERT (a pessoa ve todos os erros de uma vez)
    -- ------------------------------------------------------------------------
    FOR v_i IN 1 .. v_total LOOP
        v_row := p_rows -> (v_i - 1);
        IF jsonb_typeof(v_row) <> 'object'
           OR (v_row ? 'overrides' AND jsonb_typeof(v_row -> 'overrides') NOT IN ('object', 'null')) THEN
            v_errors := v_errors || jsonb_build_object('row', v_i, 'code', 'invalid_row', 'message', 'Linha inválida.');
            v_effective := v_effective || '{}'::jsonb;
            CONTINUE;
        END IF;

        v_eff := p_template
                 || CASE WHEN jsonb_typeof(v_row -> 'overrides') = 'object' THEN v_row -> 'overrides' ELSE '{}'::jsonb END
                 || jsonb_build_object('date', v_row -> 'date', 'start_time', v_row -> 'start_time',
                                       'end_time', v_row -> 'end_time', 'slots', v_row -> 'slots',
                                       'budget', v_row -> 'budget');
        v_effective := v_effective || v_eff;

        v_date := NULL;
        IF coalesce(v_eff ->> 'date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
            BEGIN
                v_date := (v_eff ->> 'date')::date;
            EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
                v_date := NULL;
            END;
        END IF;
        IF v_date IS NULL THEN
            v_errors := v_errors || jsonb_build_object('row', v_i, 'code', 'invalid_date', 'message', 'Data inválida.');
        ELSIF v_date < v_today THEN
            v_errors := v_errors || jsonb_build_object('row', v_i, 'code', 'past_date', 'message', 'Esta data já passou.');
        END IF;

        IF coalesce(v_eff ->> 'start_time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
           OR coalesce(v_eff ->> 'end_time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
           OR (v_eff ->> 'start_time') = (v_eff ->> 'end_time') THEN
            v_errors := v_errors || jsonb_build_object('row', v_i, 'code', 'invalid_time',
                                                       'message', 'Informe entrada e saída diferentes.');
        END IF;

        IF jsonb_typeof(v_eff -> 'slots') IS DISTINCT FROM 'number' THEN
            v_errors := v_errors || jsonb_build_object('row', v_i, 'code', 'invalid_slots', 'message', 'Vagas devem ser de 1 a 50.');
        ELSIF (v_eff ->> 'slots')::numeric NOT BETWEEN 1 AND 50
              OR (v_eff ->> 'slots')::numeric <> trunc((v_eff ->> 'slots')::numeric) THEN
            v_errors := v_errors || jsonb_build_object('row', v_i, 'code', 'invalid_slots', 'message', 'Vagas devem ser de 1 a 50.');
        END IF;

        IF jsonb_typeof(v_eff -> 'budget') IS DISTINCT FROM 'number' THEN
            v_errors := v_errors || jsonb_build_object('row', v_i, 'code', 'invalid_budget', 'message', 'Informe um valor maior que zero.');
        ELSIF (v_eff ->> 'budget')::numeric <= 0 OR (v_eff ->> 'budget')::numeric > 1000000 THEN
            v_errors := v_errors || jsonb_build_object('row', v_i, 'code', 'invalid_budget', 'message', 'Informe um valor maior que zero.');
        END IF;

        IF btrim(coalesce(v_eff ->> 'title', '')) = '' OR btrim(coalesce(v_eff ->> 'category', '')) = ''
           OR btrim(coalesce(v_eff ->> 'description', '')) = '' THEN
            v_errors := v_errors || jsonb_build_object('row', v_i, 'code', 'missing_field',
                                                       'message', 'Preencha título, função e descrição.');
        END IF;
        IF coalesce(v_eff ->> 'budget_type', '') NOT IN ('hourly', 'daily', 'project') THEN
            v_errors := v_errors || jsonb_build_object('row', v_i, 'code', 'invalid_budget_type', 'message', 'Tipo de pagamento inválido.');
        END IF;
        IF char_length(coalesce(v_eff ->> 'certification_requirement', '')) > 200 THEN
            v_errors := v_errors || jsonb_build_object('row', v_i, 'code', 'certification_too_long',
                                                       'message', 'A certificação exigida passa de 200 caracteres.');
        END IF;
        IF nullif(v_eff ->> 'tag_id', '') IS NOT NULL
           AND (v_eff ->> 'tag_id') !~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN
            v_errors := v_errors || jsonb_build_object('row', v_i, 'code', 'invalid_tag', 'message', 'Etiqueta inválida.');
        END IF;
    END LOOP;

    IF jsonb_array_length(v_errors) > 0 THEN
        RETURN jsonb_build_object('outcome', 'invalid', 'errors', v_errors);
    END IF;

    -- Serie: so quando todas as linhas sao iguais exceto a data, e sem data repetida.
    IF p_series IS NOT NULL AND jsonb_typeof(p_series) <> 'null' THEN
        SELECT count(DISTINCT (e.v - 'date'))::integer INTO v_uniform FROM unnest(v_effective) AS e(v);
        SELECT array_agg((e.v ->> 'date')::date ORDER BY e.n) INTO v_dates
          FROM unnest(v_effective) WITH ORDINALITY AS e(v, n);
        IF jsonb_typeof(p_series) <> 'object' OR v_uniform <> 1
           OR (SELECT count(DISTINCT d) FROM unnest(v_dates) AS d) <> v_total
           OR coalesce(p_series ->> 'recurrence_type', '') NOT IN ('weekly', 'daily')
           OR coalesce(p_series ->> 'range_start', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
           OR coalesce(p_series ->> 'range_end', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
            RETURN jsonb_build_object('outcome', 'invalid', 'errors', jsonb_build_array(
                jsonb_build_object('row', 0, 'code', 'invalid_series',
                                   'message', 'Estas linhas não formam uma série.')));
        END IF;
        v_series := p_series;
    END IF;

    -- ------------------------------------------------------------------------
    -- Gravacao tudo-ou-nada. O bloco com EXCEPTION e um savepoint: qualquer recusa desfaz TODAS as
    -- linhas ja inseridas e devolve a linha culpada. Erro nao previsto sobe e aborta a transacao.
    -- ------------------------------------------------------------------------
    BEGIN
        IF v_series IS NOT NULL THEN
            IF v_series ->> 'recurrence_type' = 'weekly' THEN
                SELECT array_agg(w.value::integer) INTO v_weekdays
                  FROM jsonb_array_elements_text(v_series -> 'weekdays') AS w(value);
            END IF;
            v_eff := v_effective[1];
            v_series := public.create_job_series(
                p_company_id,
                v_series ->> 'recurrence_type',
                v_weekdays,
                (v_series ->> 'range_start')::date,
                (v_series ->> 'range_end')::date,
                v_dates,
                jsonb_build_object(
                    'title', v_eff ->> 'title', 'category', v_eff ->> 'category', 'type', 'freelance',
                    'description', v_eff ->> 'description', 'requirements', coalesce(v_eff ->> 'requirements', ''),
                    'briefing', coalesce(v_eff ->> 'briefing', ''), 'location', coalesce(v_eff ->> 'location', ''),
                    'budget', v_eff -> 'budget', 'budget_type', v_eff ->> 'budget_type', 'scope', 'on-site',
                    'work_start_time', v_eff ->> 'start_time', 'work_end_time', v_eff ->> 'end_time',
                    'has_lunch', coalesce((v_eff ->> 'has_lunch')::boolean, false), 'slots', v_eff -> 'slots'));
            IF v_series ->> 'outcome' <> 'ok' THEN
                RETURN jsonb_build_object('outcome', 'invalid', 'errors', jsonb_build_array(
                    jsonb_build_object('row', 0, 'code', 'invalid_series', 'message', 'Não foi possível criar a série.')));
            END IF;
            v_series_id := (v_series ->> 'series_id')::uuid;

            FOR v_i IN 1 .. v_total LOOP
                v_at := v_i;
                UPDATE public.jobs j
                   SET creation_batch_id = p_client_batch_id,
                       creation_row = v_i,
                       certification_requirement = nullif(btrim(coalesce(v_eff ->> 'certification_requirement', '')), ''),
                       tag_id = nullif(v_eff ->> 'tag_id', '')::uuid
                 WHERE j.series_id = v_series_id
                   AND j.series_occurrence_date = v_dates[v_i]
                RETURNING j.id INTO v_id;
                IF v_id IS NULL THEN
                    RAISE EXCEPTION 'lote: ocorrencia da serie nao encontrada' USING ERRCODE = '42501';
                END IF;
                v_ids := v_ids || v_id;
            END LOOP;
        ELSE
            FOR v_i IN 1 .. v_total LOOP
                v_at := v_i;
                v_eff := v_effective[v_i];
                -- jsonb_populate_record usa a funcao de entrada de cada coluna (LM-15 de F3).
                v_rec := jsonb_populate_record(NULL::public.jobs, jsonb_build_object(
                    'title', v_eff ->> 'title', 'category', v_eff ->> 'category',
                    'description', v_eff ->> 'description', 'requirements', coalesce(v_eff ->> 'requirements', ''),
                    'briefing', coalesce(v_eff ->> 'briefing', ''), 'location', coalesce(v_eff ->> 'location', ''),
                    'certification_requirement', nullif(btrim(coalesce(v_eff ->> 'certification_requirement', '')), ''),
                    'budget', v_eff -> 'budget', 'budget_type', v_eff ->> 'budget_type',
                    'work_start_time', v_eff ->> 'start_time', 'work_end_time', v_eff ->> 'end_time',
                    'has_lunch', coalesce((v_eff ->> 'has_lunch')::boolean, false), 'slots', v_eff -> 'slots',
                    'tag_id', nullif(v_eff ->> 'tag_id', ''),
                    'type', 'freelance', 'scope', 'on-site', 'status', 'open'));

                -- responsible_id NAO e enviado: quem decide e o trigger jobs_responsible_guard.
                INSERT INTO public.jobs (
                    company_id, title, category, type, description, requirements, briefing,
                    certification_requirement, location, budget, budget_type, start_date, scope,
                    work_start_time, work_end_time, has_lunch, slots, status, tag_id,
                    creation_batch_id, creation_row
                ) VALUES (
                    p_company_id, v_rec.title, v_rec.category, v_rec.type, v_rec.description,
                    v_rec.requirements, v_rec.briefing, v_rec.certification_requirement, v_rec.location,
                    v_rec.budget, v_rec.budget_type,
                    -- Meio-dia local (mesma convencao de create_job_series / localDateToTimestamp).
                    (((v_eff ->> 'date') || ' 12:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo'),
                    v_rec.scope, v_rec.work_start_time, v_rec.work_end_time, v_rec.has_lunch, v_rec.slots,
                    v_rec.status, v_rec.tag_id, p_client_batch_id, v_i
                ) RETURNING id INTO v_id;
                v_ids := v_ids || v_id;
            END LOOP;
        END IF;
    EXCEPTION
        WHEN insufficient_privilege OR check_violation OR foreign_key_violation OR unique_violation THEN
            GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
            v_code := CASE
                WHEN v_state = '42501' THEN 'forbidden'
                WHEN position('tag' IN v_msg) > 0 THEN 'invalid_tag'
                ELSE 'rejected'
            END;
            RETURN jsonb_build_object('outcome', v_code, 'errors', jsonb_build_array(jsonb_build_object(
                'row', v_at, 'code', v_code, 'message', CASE v_code
                    WHEN 'forbidden' THEN 'Você não tem permissão para publicar estes turnos nesta empresa.'
                    WHEN 'invalid_tag' THEN 'A etiqueta não existe mais, está arquivada ou é de outra empresa.'
                    ELSE 'O banco recusou este turno. Nenhum turno foi publicado.'
                END)));
    END;

    RETURN jsonb_build_object('outcome', 'created', 'created', cardinality(v_ids), 'job_ids', to_jsonb(v_ids));
END;
$fn$;

COMMENT ON FUNCTION public.create_jobs_batch(uuid, uuid, jsonb, jsonb, jsonb) IS
    'Publica 1..60 turnos numa transacao (tudo ou nada), idempotente por p_client_batch_id. SECURITY '
    'INVOKER: RLS de jobs, jobs_responsible_guard e job_series_insert decidem o acesso, sem regra nova. '
    'p_series (opcional, Gestor) publica como job_series. Outcomes: created|already_created|invalid|'
    'forbidden|invalid_tag|rejected|batch_conflict|invalid_input|unauthenticated; errors[{row,code,message}] '
    'com row 1-based (0 = lote). Nao toca saldo (Article 8).';

REVOKE ALL ON FUNCTION public.create_jobs_batch(uuid, uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_jobs_batch(uuid, uuid, jsonb, jsonb, jsonb) TO authenticated, service_role;

-- ============================================================================
-- 3. ASSERCOES FINAIS
-- ============================================================================
DO $mig$
DECLARE
    v_fn regprocedure := to_regprocedure('public.create_jobs_batch(uuid, uuid, jsonb, jsonb, jsonb)');
BEGIN
    IF v_fn IS NULL OR (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) THEN
        RAISE EXCEPTION 'ASSERCAO LOTE: create_jobs_batch ausente ou SECURITY DEFINER. HALT.';
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'ASSERCAO LOTE: authenticated sem EXECUTE. HALT.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND has_function_privilege('anon', v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'ASSERCAO LOTE: anon com EXECUTE. HALT.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                    WHERE c.relname = 'uq_jobs_creation_batch_row' AND i.indisunique AND i.indisvalid) THEN
        RAISE EXCEPTION 'ASSERCAO LOTE: indice unico do lote ausente. HALT.';
    END IF;
END
$mig$;
