-- Migration: presenca verificada P3 - verificacao no servidor
--
-- No modo qr_gps o carimbo SO nasce das RPCs abaixo:
--   * trg_zz_applications_presence_guard (SECURITY INVOKER + current_user, mesmo padrao de
--     20261125000200) recusa UPDATE direto de cliente nos 4 carimbos. Trigger SEPARADO: o corpo de
--     applications_update_guard nao e tocado. Reaplicar 20261125000200 depois desta HALTa de
--     proposito (trigger BEFORE que ela nao conhece).
--   * validate_application_update decide por auth.uid() e barraria a propria RPC (freela gravando a
--     confirmacao da empresa). Ganha UM desvio, ligado pela GUC transacao-local app.presence_rpc =
--     id da candidatura, que so verify_presence liga e desliga. A GUC NAO abre o guard do cliente.
-- Modo dual: nenhum comportamento muda.
-- LGPD: presence_checks NAO tem coordenada; lat/lng sao usadas em memoria e descartadas.
-- Saida sem verificacao nao bloqueia: register_departure_unverified grava e MARCA ('unverified').
-- Article 8/9: nao toca saldo.
--
-- DOWN (turnos qr_gps voltam a aceitar carimbo direto):
--   SELECT cron.unschedule('presence-checks-purge');  -- se houver pg_cron
--   DROP TRIGGER trg_zz_applications_presence_guard ON public.applications;
--   DROP TRIGGER trg_zz_workers_presence_anonymize ON public.workers;
--   DROP FUNCTION public.applications_presence_guard(), public.presence_checks_on_anonymize(),
--     public.verify_presence(uuid,text,text,double precision,double precision,double precision),
--     public.record_presence_exception(uuid,text,text,text), public.request_presence_exception(uuid,text,text),
--     public.register_departure_unverified(uuid), public.get_presence_qr(uuid), public.get_site_static_qr(uuid),
--     public.rotate_site_secret(uuid), public.purge_presence_checks(), public.internal_presence_token(uuid,uuid,bigint),
--     public.internal_presence_qr_check(text,uuid,uuid,text), public.internal_presence_window_open(timestamptz,text),
--     public.internal_presence_distance_m(double precision,double precision,double precision,double precision),
--     public.internal_presence_notify_company(uuid,text,text);
--   DROP TABLE public.presence_checks;
--   validate_application_update: remover o bloco "presenca verificada" (replace inverso).

BEGIN;

-- 0. Pre-condicoes
DO $$
DECLARE
    v_bad text;
BEGIN
    IF to_regclass('public.company_site_secrets') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                       WHERE attrelid = 'public.jobs'::regclass AND attname = 'presence_mode' AND NOT attisdropped)
       OR to_regprocedure('public.is_job_owner(uuid)') IS NULL
       OR to_regprocedure('public.validate_application_update()') IS NULL
    THEN
        RAISE EXCEPTION 'PRE-CONDICAO P3: P1/P2, is_job_owner ou validate_application_update ausente. HALT.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                    WHERE t.tgrelid = 'public.applications'::regclass AND t.tgname = 'trg_zz_applications_update_guard'
                      AND t.tgenabled = 'O') THEN
        RAISE EXCEPTION 'PRE-CONDICAO P3: applications_update_guard (20261125000200) ausente ou desligado. HALT.';
    END IF;

    -- Funcao que grava carimbo, fora das daqui, passaria pelo guard sem verificar nada.
    SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname NOT IN ('verify_presence', 'record_presence_exception', 'register_departure_unverified')
       AND regexp_replace(p.prosrc, '--[^\r\n]*', '', 'g')
           ~* '\mupdate\s+(only\s+)?("?public"?\.)?"?applications"?\s[^;]*\m(worker_checkin_at|worker_checkout_at|company_checkin_confirmed_at|company_checkout_confirmed_at)\M\s*=';
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'PRE-CONDICAO P3: funcao(oes) gravam carimbo de presenca: %. Revisar. HALT.', v_bad;
    END IF;
END $$;

-- 1. Tentativas (sem coordenada)
CREATE TABLE IF NOT EXISTS public.presence_checks (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE RESTRICT,
    job_id         uuid NOT NULL,
    worker_id      uuid NOT NULL,
    kind           text NOT NULL CHECK (kind IN ('arrival', 'departure')),
    result         text NOT NULL CHECK (result IN ('verified', 'manual_exception', 'unverified',
                       'exception_requested', 'qr_invalid', 'qr_expired', 'gps_out_of_range',
                       'gps_low_accuracy', 'gps_unavailable', 'outside_window', 'invalid_input')),
    distance_m     integer,
    accuracy_m     integer,
    qr_ok          boolean,
    qr_kind        text CHECK (qr_kind IN ('rotating', 'static')),
    reason         text CHECK (reason IN ('sem_sinal_gps', 'gps_negado', 'qr_ilegivel',
                       'celular_sem_bateria', 'local_mudou', 'outro')),
    note           varchar(200),
    decided_by     uuid,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT presence_checks_exception_author
        CHECK (result <> 'manual_exception' OR (decided_by IS NOT NULL AND reason IS NOT NULL))
);
COMMENT ON TABLE public.presence_checks IS
    'Tentativas e desfechos da presenca verificada. NUNCA gravar coordenada do freela. Falhas purgadas em 90 dias.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_presence_checks_decided
    ON public.presence_checks (application_id, kind) WHERE result IN ('verified', 'manual_exception');

ALTER TABLE public.presence_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.presence_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.presence_checks TO authenticated;
GRANT ALL ON public.presence_checks TO service_role;
DROP POLICY IF EXISTS "presence_checks_select" ON public.presence_checks;
CREATE POLICY "presence_checks_select" ON public.presence_checks FOR SELECT TO authenticated
    USING (worker_id = (SELECT auth.uid()) OR public.is_job_owner(job_id));

-- 2. Internas (sem EXECUTE para cliente)
CREATE OR REPLACE FUNCTION public.internal_presence_distance_m(
    p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT 2 * 6371000.0 * asin(least(1.0, sqrt(
        power(sin(radians(p_lat2 - p_lat1) / 2), 2)
        + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2))));
$$;

-- Mesma regra do applications_update_guard: 12 h antes do inicio (data de Sao Paulo + entrada).
CREATE OR REPLACE FUNCTION public.internal_presence_window_open(p_start timestamptz, p_time text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT p_start IS NULL OR now() >= (((p_start AT TIME ZONE 'America/Sao_Paulo')::date
             + CASE WHEN p_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]' THEN left(p_time, 5)::time ELSE time '00:00' END)
           AT TIME ZONE 'America/Sao_Paulo') - interval '12 hours';
$$;

-- Token = base64url(site(16) || versao(4) || [passo(8)] || HMAC-SHA256[0:10]). p_step NULL = estatico.
-- Rotativo assina site||job||passo; estatico assina site||versao||'static'.
CREATE OR REPLACE FUNCTION public.internal_presence_token(p_site_id uuid, p_job_id uuid, p_step bigint)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT translate(encode(
        uuid_send(s.site_id) || int4send(s.version)
        || CASE WHEN p_step IS NULL THEN ''::bytea ELSE int8send(p_step) END
        || substring(extensions.hmac(
               CASE WHEN p_step IS NULL
                    THEN uuid_send(s.site_id) || int4send(s.version) || convert_to('static', 'UTF8')
                    ELSE uuid_send(s.site_id) || uuid_send(p_job_id) || int8send(p_step) END,
               s.secret, 'sha256') FROM 1 FOR 10),
        'base64'), '+/=' || chr(10), '-_')
      FROM public.company_site_secrets s
     WHERE s.site_id = p_site_id;
$$;

-- 'ok' | 'invalid' | 'expired'. Turno rotativo NAO aceita o impresso, e vice-versa.
CREATE OR REPLACE FUNCTION public.internal_presence_qr_check(p_qr text, p_site_id uuid, p_job_id uuid, p_qr_mode text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_raw  bytea;
    v_step bigint;
    v_now  bigint := floor(extract(epoch FROM now()) / 30)::bigint;
BEGIN
    IF p_qr IS NULL THEN RETURN 'invalid'; END IF;
    IF p_qr_mode = 'static' THEN
        RETURN CASE WHEN p_qr = public.internal_presence_token(p_site_id, NULL, NULL) THEN 'ok' ELSE 'invalid' END;
    END IF;
    IF p_qr !~ '^[A-Za-z0-9_-]{51}$' THEN RETURN 'invalid'; END IF;
    -- 51 caracteres base64url = 38 bytes; o passo ocupa os bytes 21..28.
    v_raw := decode(translate(p_qr, '-_', '+/') || '=', 'base64');
    v_step := ('x' || encode(substring(v_raw FROM 21 FOR 8), 'hex'))::bit(64)::bigint;
    -- Compara o token inteiro: site, versao e assinatura de uma vez.
    IF p_qr IS DISTINCT FROM public.internal_presence_token(p_site_id, p_job_id, v_step) THEN RETURN 'invalid'; END IF;
    IF v_step > v_now THEN RETURN 'invalid'; END IF;
    RETURN CASE WHEN v_step >= v_now - 1 THEN 'ok' ELSE 'expired' END;
END;
$$;

CREATE OR REPLACE FUNCTION public.internal_presence_notify_company(p_job_id uuid, p_title text, p_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_link text := '/company/jobs/' || p_job_id::text || '/candidates';
BEGIN
    IF to_regprocedure('public.notification_recipients_for_job(uuid)') IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, message, link)
        SELECT r, 'status_change', p_title, p_message, v_link
          FROM public.notification_recipients_for_job(p_job_id) AS r;
    ELSE
        INSERT INTO public.notifications (user_id, type, title, message, link)
        SELECT COALESCE(c.owner_id, c.id), 'status_change', p_title, p_message, v_link
          FROM public.jobs j JOIN public.companies c ON c.id = j.company_id
         WHERE j.id = p_job_id;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.internal_presence_distance_m(double precision, double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.internal_presence_window_open(timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.internal_presence_token(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.internal_presence_qr_check(text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.internal_presence_notify_company(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- 3. verify_presence. Ordem: dono, ja verificado, status, janela, QR, GPS.
--    Trava o turno antes da candidatura (mesma ordem de claim_shift_slot).
CREATE OR REPLACE FUNCTION public.verify_presence(
    p_application_id uuid, p_kind text, p_qr text,
    p_lat double precision, p_lng double precision, p_accuracy_m double precision)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_uid    uuid := (SELECT auth.uid());
    v_job    public.jobs%ROWTYPE;
    v_app    public.applications%ROWTYPE;
    v_site   public.company_sites%ROWTYPE;
    v_qr     text;
    v_result text;
    v_dist   double precision;
    v_acc    integer;
BEGIN
    IF v_uid IS NULL THEN RETURN jsonb_build_object('outcome', 'unauthenticated'); END IF;

    SELECT j.* INTO v_job FROM public.jobs j
     WHERE j.id = (SELECT a.job_id FROM public.applications a WHERE a.id = p_application_id AND a.worker_id = v_uid)
       FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'not_owner'); END IF;
    SELECT * INTO v_app FROM public.applications WHERE id = p_application_id AND worker_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'not_owner'); END IF;

    IF p_kind IS NULL OR p_kind NOT IN ('arrival', 'departure') THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;
    IF v_job.presence_mode <> 'qr_gps' THEN RETURN jsonb_build_object('outcome', 'not_qr_gps'); END IF;

    IF EXISTS (SELECT 1 FROM public.presence_checks c WHERE c.application_id = v_app.id AND c.kind = p_kind
                  AND c.result IN ('verified', 'manual_exception')) THEN
        RETURN jsonb_build_object('outcome', 'already_verified');
    END IF;

    IF v_job.status = 'deleted' THEN RETURN jsonb_build_object('outcome', 'invalid_status'); END IF;
    IF p_kind = 'arrival' THEN
        IF v_app.status NOT IN ('hired', 'in_progress') THEN
            RETURN jsonb_build_object('outcome', 'invalid_status');
        END IF;
    ELSE
        IF v_app.status <> 'in_progress' THEN RETURN jsonb_build_object('outcome', 'invalid_status'); END IF;
        IF v_app.worker_checkin_at IS NULL AND v_app.company_checkin_confirmed_at IS NULL THEN
            RETURN jsonb_build_object('outcome', 'no_arrival');
        END IF;
        -- Saida ja gravada sem verificacao nao e "promovida" depois (o horario seria outro).
        IF v_app.worker_checkout_at IS NOT NULL OR v_app.company_checkout_confirmed_at IS NOT NULL THEN
            RETURN jsonb_build_object('outcome', 'already_registered');
        END IF;
    END IF;

    IF (SELECT count(*) FROM public.presence_checks c WHERE c.application_id = v_app.id
           AND c.result NOT IN ('verified', 'manual_exception', 'unverified', 'exception_requested')
           AND c.created_at > now() - interval '10 minutes') >= 20 THEN
        RETURN jsonb_build_object('outcome', 'too_many_attempts');
    END IF;

    -- Numeros do aparelho: registrados (com teto, para caber em integer), nunca confiados.
    IF p_accuracy_m > 0 AND p_accuracy_m <> 'NaN'::double precision THEN
        v_acc := round(least(p_accuracy_m, 1000000::double precision));
    END IF;

    IF NOT public.internal_presence_window_open(v_job.start_date, v_job.work_start_time::text) THEN
        v_result := 'outside_window';
    ELSE
        SELECT * INTO v_site FROM public.company_sites WHERE id = v_job.site_id;
        v_qr := public.internal_presence_qr_check(p_qr, v_job.site_id, v_job.id, v_job.qr_mode);
        IF v_qr <> 'ok' THEN
            v_result := 'qr_' || v_qr;
        ELSIF p_lat IS NULL OR p_lng IS NULL OR v_acc IS NULL
              OR p_lat = 'NaN'::double precision OR p_lng = 'NaN'::double precision
              OR abs(p_lat) > 90 OR abs(p_lng) > 180 THEN
            v_result := 'invalid_input';
        ELSE
            v_dist := public.internal_presence_distance_m(p_lat, p_lng, v_site.lat::double precision, v_site.lng::double precision);
            IF p_accuracy_m > 150 THEN
                v_result := 'gps_low_accuracy';
            ELSIF v_dist > v_site.radius_m + least(p_accuracy_m, 50::double precision) THEN
                v_result := 'gps_out_of_range';
            ELSE
                v_result := 'verified';
            END IF;
        END IF;
    END IF;

    INSERT INTO public.presence_checks (application_id, job_id, worker_id, kind, result,
                                        distance_m, accuracy_m, qr_ok, qr_kind)
    VALUES (v_app.id, v_job.id, v_uid, p_kind, v_result, round(v_dist)::integer, v_acc,
            CASE WHEN v_qr IS NULL THEN NULL ELSE v_qr = 'ok' END, v_job.qr_mode);

    IF v_result = 'verified' THEN
        PERFORM set_config('app.presence_rpc', v_app.id::text, true);
        IF p_kind = 'arrival' THEN
            UPDATE public.applications
               SET status = 'in_progress',
                   worker_checkin_at = COALESCE(worker_checkin_at, now()),
                   company_checkin_confirmed_at = COALESCE(company_checkin_confirmed_at, now())
             WHERE id = v_app.id;
        ELSE
            UPDATE public.applications
               SET worker_checkout_at = now(), company_checkout_confirmed_at = now()
             WHERE id = v_app.id;
        END IF;
        PERFORM set_config('app.presence_rpc', '', true);
    END IF;

    RETURN jsonb_build_object('outcome', v_result, 'distance_m', round(v_dist)::integer,
                              'accuracy_m', v_acc, 'radius_m', v_site.radius_m);
END;
$$;

-- 4. Excecao decidida por quem OPERA o turno.
CREATE OR REPLACE FUNCTION public.record_presence_exception(
    p_application_id uuid, p_kind text, p_reason text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_uid  uuid := (SELECT auth.uid());
    v_job  public.jobs%ROWTYPE;
    v_app  public.applications%ROWTYPE;
    v_note text := NULLIF(btrim(p_note), '');
BEGIN
    IF v_uid IS NULL THEN RETURN jsonb_build_object('outcome', 'unauthenticated'); END IF;

    SELECT j.* INTO v_job FROM public.jobs j
     WHERE j.id = (SELECT a.job_id FROM public.applications a WHERE a.id = p_application_id) FOR SHARE;
    IF NOT FOUND OR NOT COALESCE(public.is_job_owner(v_job.id), false) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    SELECT * INTO v_app FROM public.applications WHERE id = p_application_id FOR UPDATE;
    IF v_app.worker_id = v_uid THEN RETURN jsonb_build_object('outcome', 'forbidden'); END IF;

    IF p_kind IS NULL OR p_kind NOT IN ('arrival', 'departure') OR p_reason IS NULL
       OR p_reason NOT IN ('sem_sinal_gps', 'gps_negado', 'qr_ilegivel', 'celular_sem_bateria', 'local_mudou', 'outro')
       OR length(v_note) > 200 THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;
    IF v_job.presence_mode <> 'qr_gps' THEN RETURN jsonb_build_object('outcome', 'not_qr_gps'); END IF;
    IF EXISTS (SELECT 1 FROM public.presence_checks c WHERE c.application_id = v_app.id AND c.kind = p_kind
                  AND c.result IN ('verified', 'manual_exception')) THEN
        RETURN jsonb_build_object('outcome', 'already_verified');
    END IF;

    IF v_job.status = 'deleted'
       OR (p_kind = 'arrival' AND v_app.status NOT IN ('hired', 'in_progress'))
       OR (p_kind = 'departure' AND v_app.status <> 'in_progress') THEN
        RETURN jsonb_build_object('outcome', 'invalid_status');
    END IF;
    IF p_kind = 'departure' AND v_app.company_checkin_confirmed_at IS NULL THEN
        RETURN jsonb_build_object('outcome', 'no_arrival');
    END IF;
    IF NOT public.internal_presence_window_open(v_job.start_date, v_job.work_start_time::text) THEN
        RETURN jsonb_build_object('outcome', 'outside_window');
    END IF;

    INSERT INTO public.presence_checks (application_id, job_id, worker_id, kind, result, reason, note, decided_by)
    VALUES (v_app.id, v_job.id, v_app.worker_id, p_kind, 'manual_exception', p_reason, v_note, v_uid);

    -- So a coluna da empresa: o ponto do freela nunca e preenchido em nome dele.
    IF p_kind = 'arrival' THEN
        UPDATE public.applications
           SET status = 'in_progress', company_checkin_confirmed_at = COALESCE(company_checkin_confirmed_at, now())
         WHERE id = v_app.id;
    ELSE
        UPDATE public.applications
           SET company_checkout_confirmed_at = COALESCE(company_checkout_confirmed_at, now())
         WHERE id = v_app.id;
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (v_app.worker_id, 'status_change',
            CASE WHEN p_kind = 'arrival' THEN 'Chegada confirmada' ELSE 'Saída confirmada' END,
            'O responsável confirmou sua presença manualmente.', '/my-jobs');

    RETURN jsonb_build_object('outcome', 'recorded');
END;
$$;

-- 5. Freela pede ajuda ao responsavel.
CREATE OR REPLACE FUNCTION public.request_presence_exception(p_application_id uuid, p_kind text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_app public.applications%ROWTYPE;
    v_job public.jobs%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN RETURN jsonb_build_object('outcome', 'unauthenticated'); END IF;
    SELECT * INTO v_app FROM public.applications WHERE id = p_application_id AND worker_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'not_owner'); END IF;
    IF p_kind IS NULL OR p_kind NOT IN ('arrival', 'departure') OR p_reason IS NULL
       OR p_reason NOT IN ('sem_sinal_gps', 'gps_negado', 'qr_ilegivel', 'celular_sem_bateria', 'local_mudou', 'outro') THEN
        RETURN jsonb_build_object('outcome', 'invalid_input');
    END IF;
    SELECT * INTO v_job FROM public.jobs WHERE id = v_app.job_id;
    IF v_job.presence_mode <> 'qr_gps' THEN RETURN jsonb_build_object('outcome', 'not_qr_gps'); END IF;
    IF EXISTS (SELECT 1 FROM public.presence_checks c WHERE c.application_id = v_app.id AND c.kind = p_kind
                  AND c.result IN ('verified', 'manual_exception')) THEN
        RETURN jsonb_build_object('outcome', 'already_verified');
    END IF;
    IF v_job.status = 'deleted' OR v_app.status NOT IN ('hired', 'in_progress')
       OR (p_kind = 'departure' AND v_app.status <> 'in_progress') THEN
        RETURN jsonb_build_object('outcome', 'invalid_status');
    END IF;
    -- Um aviso a cada 10 min por candidatura e momento.
    IF EXISTS (SELECT 1 FROM public.presence_checks c WHERE c.application_id = v_app.id AND c.kind = p_kind
                  AND c.result = 'exception_requested' AND c.created_at > now() - interval '10 minutes') THEN
        RETURN jsonb_build_object('outcome', 'already_requested');
    END IF;

    INSERT INTO public.presence_checks (application_id, job_id, worker_id, kind, result, reason)
    VALUES (v_app.id, v_job.id, v_uid, p_kind, 'exception_requested', p_reason);

    PERFORM public.internal_presence_notify_company(v_job.id, 'Pedido de confirmação de presença',
        CASE WHEN p_kind = 'arrival' THEN 'Um freela não conseguiu verificar a chegada e pede sua confirmação.'
             ELSE 'Um freela não conseguiu verificar a saída e pede sua confirmação.' END);

    RETURN jsonb_build_object('outcome', 'requested');
END;
$$;

-- 6. Saida sem verificacao: nao bloqueia, so marca. Freela grava o ponto dele; quem opera o
--    turno grava a confirmacao da empresa. Horario sempre do servidor.
CREATE OR REPLACE FUNCTION public.register_departure_unverified(p_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_uid    uuid := (SELECT auth.uid());
    v_job    public.jobs%ROWTYPE;
    v_app    public.applications%ROWTYPE;
    v_worker boolean;
BEGIN
    IF v_uid IS NULL THEN RETURN jsonb_build_object('outcome', 'unauthenticated'); END IF;
    SELECT j.* INTO v_job FROM public.jobs j
     WHERE j.id = (SELECT a.job_id FROM public.applications a WHERE a.id = p_application_id) FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'forbidden'); END IF;
    SELECT * INTO v_app FROM public.applications WHERE id = p_application_id FOR UPDATE;
    v_worker := v_app.worker_id = v_uid;
    IF NOT v_worker AND NOT COALESCE(public.is_job_owner(v_job.id), false) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF v_job.presence_mode <> 'qr_gps' THEN RETURN jsonb_build_object('outcome', 'not_qr_gps'); END IF;
    IF v_job.status = 'deleted' OR v_app.status <> 'in_progress' THEN
        RETURN jsonb_build_object('outcome', 'invalid_status');
    END IF;
    IF v_app.company_checkin_confirmed_at IS NULL
       AND (NOT v_worker OR v_app.worker_checkin_at IS NULL) THEN
        RETURN jsonb_build_object('outcome', 'no_arrival');
    END IF;
    IF (v_worker AND v_app.worker_checkout_at IS NOT NULL)
       OR (NOT v_worker AND v_app.company_checkout_confirmed_at IS NOT NULL) THEN
        RETURN jsonb_build_object('outcome', 'already_registered');
    END IF;

    IF v_worker THEN
        UPDATE public.applications SET worker_checkout_at = now() WHERE id = v_app.id;
    ELSE
        UPDATE public.applications SET company_checkout_confirmed_at = now() WHERE id = v_app.id;
    END IF;

    INSERT INTO public.presence_checks (application_id, job_id, worker_id, kind, result, decided_by)
    VALUES (v_app.id, v_job.id, v_app.worker_id, 'departure', 'unverified', v_uid);
    RETURN jsonb_build_object('outcome', 'registered');
END;
$$;

-- 7. QR
CREATE OR REPLACE FUNCTION public.get_presence_qr(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_job   public.jobs%ROWTYPE;
    v_epoch bigint := floor(extract(epoch FROM now()))::bigint;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN RETURN jsonb_build_object('outcome', 'unauthenticated'); END IF;
    IF NOT COALESCE(public.is_job_owner(p_job_id), false) THEN RETURN jsonb_build_object('outcome', 'forbidden'); END IF;
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
    IF v_job.presence_mode <> 'qr_gps' OR v_job.status = 'deleted' THEN
        RETURN jsonb_build_object('outcome', 'not_qr_gps');
    END IF;
    IF v_job.qr_mode <> 'rotating' THEN RETURN jsonb_build_object('outcome', 'static_mode'); END IF;
    RETURN jsonb_build_object('outcome', 'ok',
        'token', public.internal_presence_token(v_job.site_id, v_job.id, v_epoch / 30),
        'expires_in_s', 30 - v_epoch % 30,
        'site_name', (SELECT s.name FROM public.company_sites s WHERE s.id = v_job.site_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_site_static_qr(p_site_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_site public.company_sites%ROWTYPE;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN RETURN jsonb_build_object('outcome', 'unauthenticated'); END IF;
    SELECT * INTO v_site FROM public.company_sites WHERE id = p_site_id;
    IF NOT FOUND OR NOT COALESCE(public.is_company_owner(v_site.company_id), false) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    IF v_site.archived_at IS NOT NULL THEN RETURN jsonb_build_object('outcome', 'archived'); END IF;
    RETURN jsonb_build_object('outcome', 'ok', 'token', public.internal_presence_token(p_site_id, NULL, NULL),
        'site_name', v_site.name, 'address_text', v_site.address_text);
END;
$$;

CREATE OR REPLACE FUNCTION public.rotate_site_secret(p_site_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_company uuid;
    v_version integer;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN RETURN jsonb_build_object('outcome', 'unauthenticated'); END IF;
    SELECT company_id INTO v_company FROM public.company_sites WHERE id = p_site_id;
    IF NOT FOUND OR NOT COALESCE(public.is_company_owner(v_company), false) THEN
        RETURN jsonb_build_object('outcome', 'forbidden');
    END IF;
    UPDATE public.company_site_secrets
       SET secret = extensions.gen_random_bytes(32), version = version + 1, rotated_at = now()
     WHERE site_id = p_site_id
    RETURNING version INTO v_version;
    RETURN jsonb_build_object('outcome', 'rotated', 'version', v_version);
END;
$$;

-- 8. Retencao e LGPD
CREATE OR REPLACE FUNCTION public.purge_presence_checks()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_n integer;
BEGIN
    DELETE FROM public.presence_checks
     WHERE result NOT IN ('verified', 'manual_exception', 'unverified')
       AND created_at < now() - interval '90 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_presence_checks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_presence_checks() TO service_role;

CREATE OR REPLACE FUNCTION public.presence_checks_on_anonymize()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    DELETE FROM public.presence_checks
     WHERE worker_id = NEW.id AND result NOT IN ('verified', 'manual_exception', 'unverified');
    UPDATE public.presence_checks
       SET note = NULL, distance_m = NULL, accuracy_m = NULL
     WHERE worker_id = NEW.id;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.presence_checks_on_anonymize() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_zz_workers_presence_anonymize ON public.workers;
CREATE TRIGGER trg_zz_workers_presence_anonymize AFTER UPDATE OF anonymized_at ON public.workers
    FOR EACH ROW WHEN (OLD.anonymized_at IS NULL AND NEW.anonymized_at IS NOT NULL)
    EXECUTE FUNCTION public.presence_checks_on_anonymize();

-- 9. Grants das RPCs de cliente
DO $$
DECLARE
    v_f text;
BEGIN
    FOREACH v_f IN ARRAY ARRAY[
        'public.verify_presence(uuid,text,text,double precision,double precision,double precision)',
        'public.record_presence_exception(uuid,text,text,text)',
        'public.request_presence_exception(uuid,text,text)',
        'public.register_departure_unverified(uuid)',
        'public.get_presence_qr(uuid)', 'public.get_site_static_qr(uuid)', 'public.rotate_site_secret(uuid)']
    LOOP
        EXECUTE 'REVOKE ALL ON FUNCTION ' || v_f || ' FROM PUBLIC, anon';
        EXECUTE 'GRANT EXECUTE ON FUNCTION ' || v_f || ' TO authenticated';
    END LOOP;
END $$;

-- 10. validate_application_update: desvio so para a gravacao verificada (corpo do catalogo).
DO $$
DECLARE
    v_def text := pg_catalog.pg_get_functiondef('public.validate_application_update()'::regprocedure);
    v_pat text := 'v_is_worker[[:space:]]+:=';
BEGIN
    IF pg_catalog.strpos(v_def, 'app.presence_rpc') > 0 THEN
        RETURN;
    END IF;
    IF (SELECT count(*) FROM pg_catalog.regexp_matches(v_def, v_pat, 'g')) <> 1 THEN
        RAISE EXCEPTION 'ASSERCAO P3: validate_application_update mudou no catalogo. HALT.';
    END IF;
    EXECUTE pg_catalog.regexp_replace(v_def, '(' || v_pat || ')',
        E'-- presenca verificada: so verify_presence liga esta GUC (transacao-local, por candidatura).\n'
        || E'    IF pg_catalog.current_setting(''app.presence_rpc'', true) = OLD.id::text\n'
        || E'       AND NEW.worker_id = OLD.worker_id AND NEW.job_id = OLD.job_id THEN\n'
        || E'        RETURN NEW;\n    END IF;\n\n    \\1');
END $$;

-- 11. Guard do cliente direto
CREATE OR REPLACE FUNCTION public.applications_presence_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
        RETURN NEW;
    END IF;
    IF (NEW.worker_checkin_at IS DISTINCT FROM OLD.worker_checkin_at
        OR NEW.worker_checkout_at IS DISTINCT FROM OLD.worker_checkout_at
        OR NEW.company_checkin_confirmed_at IS DISTINCT FROM OLD.company_checkin_confirmed_at
        OR NEW.company_checkout_confirmed_at IS DISTINCT FROM OLD.company_checkout_confirmed_at)
       AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = OLD.job_id AND j.presence_mode = 'qr_gps')
    THEN
        RAISE EXCEPTION 'applications_presence_guard: este turno exige presenca verificada.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_zz_applications_presence_guard ON public.applications;
CREATE TRIGGER trg_zz_applications_presence_guard BEFORE UPDATE ON public.applications
    FOR EACH ROW EXECUTE FUNCTION public.applications_presence_guard();

-- 12. Purga diaria (degrada sem pg_cron)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule('presence-checks-purge', '30 6 * * *', 'SELECT public.purge_presence_checks();');
    ELSE
        RAISE WARNING 'pg_cron ausente: agendar public.purge_presence_checks() antes do piloto (retencao de 90 dias).';
    END IF;
END $$;

-- 13. Verificacao
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                WHERE a.attrelid = 'public.presence_checks'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                  AND a.attname ~* '(^|_)(lat|lng|lon|latitude|longitude|coord|geo|position)') THEN
        RAISE EXCEPTION 'VERIFICACAO P3: presence_checks tem coluna de coordenada. HALT.';
    END IF;
    IF pg_catalog.has_table_privilege('authenticated', 'public.presence_checks', 'INSERT,UPDATE,DELETE')
       OR pg_catalog.has_table_privilege('anon', 'public.presence_checks', 'SELECT') THEN
        RAISE EXCEPTION 'VERIFICACAO P3: presence_checks gravavel pelo cliente. HALT.';
    END IF;
    IF pg_catalog.has_function_privilege('authenticated', 'public.internal_presence_token(uuid,uuid,bigint)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',
            'public.verify_presence(uuid,text,text,double precision,double precision,double precision)', 'EXECUTE')
    THEN
        RAISE EXCEPTION 'VERIFICACAO P3: grants divergentes. HALT.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
                    WHERE t.tgrelid = 'public.applications'::regclass AND t.tgname = 'trg_zz_applications_presence_guard'
                      AND t.tgtype = 19 AND t.tgenabled = 'O' AND NOT p.prosecdef) THEN
        RAISE EXCEPTION 'VERIFICACAO P3: guard de presenca ausente ou DEFINER. HALT.';
    END IF;
END $$;

COMMIT;
