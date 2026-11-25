-- Migration: AVISOS MULTICANAL (1/3) - outbox, entregas, preferencias, consentimento e fila
-- Spec: .harness/spec/avisos-multicanal/{spec.md,ADR.md}
--
-- Aditiva: so cria objetos novos. Nao altera funcao, trigger nem policy existente.
-- Article 8: nao toca saldo. Article 10: fila so por service_role.
-- Idempotente: pode ser reaplicada.
--
-- DOWN (rodar ANTES o DOWN de 000300 e 000200):
--   DROP VIEW public.notice_funnel_daily;
--   DROP FUNCTION public.internal_enqueue_notice(text,uuid,uuid,jsonb,timestamptz,text),
--     public.claim_notice_batch(integer,text[]), public.report_notice_result(uuid,text,text,text),
--     public.record_notice_event(text,text,text), public.record_notice_whatsapp_stop(text),
--     public.notice_unsubscribe(uuid,text), public.set_notice_preference(text,boolean,text,text),
--     public.register_push_subscription(text,text,text,text), public.mark_notice_opened(uuid),
--     public.internal_anonymize_notices(uuid), public.internal_purge_notices(),
--     public.internal_notice_quiet_until(timestamptz,time,time,text);
--   DROP TABLE public.notice_deliveries, public.notice_outbox, public.notice_preferences,
--     public.push_subscriptions, public.notice_channel_settings, public.notice_funnel_archive;
--   DROP FUNCTION public.notice_consents_append_only() CASCADE; DROP FUNCTION public.notice_preferences_check();
--   notice_consents NAO se apaga antes de 5 anos (prova de opt-in; ADR "Reversibilidade").

BEGIN;

-- 0. Pre-condicoes por catalogo
DO $$
BEGIN
    IF to_regclass('public.notifications') IS NULL OR to_regclass('auth.users') IS NULL THEN
        RAISE EXCEPTION 'PRE-CONDICAO avisos: notifications/auth.users ausente. HALT.';
    END IF;
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'notifications'
           AND column_name IN ('user_id', 'link', 'read_at', 'created_at')) <> 4 THEN
        RAISE EXCEPTION 'PRE-CONDICAO avisos: notifications sem user_id/link/read_at/created_at. HALT.';
    END IF;
    IF to_regclass('public.shift_call_targets') IS NULL
       OR to_regclass('public.shift_calls') IS NULL
       OR to_regclass('public.shift_attendance_confirmations') IS NULL THEN
        RAISE EXCEPTION 'PRE-CONDICAO avisos: tabelas de chamado/vespera ausentes. HALT.';
    END IF;
END $$;

-- 1. Tabelas ------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notice_outbox (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_kind      text NOT NULL CHECK (event_kind IN
                    ('shift_call_target','sos_call_target','attendance_request','shift_cancelled','payment_recorded')),
    event_id        uuid NOT NULL,
    recipient_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    notification_id uuid,
    payload         jsonb NOT NULL,
    urgency         text NOT NULL CHECK (urgency IN ('low','normal','urgent')),
    expires_at      timestamptz NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notice_outbox_evento_unico UNIQUE (event_kind, event_id, recipient_id),
    -- Conteudo minimo (ADR 7): lista FECHADA de chaves, todas texto curto, path relativo.
    CONSTRAINT notice_outbox_payload_fechado CHECK (
        jsonb_typeof(payload) = 'object'
        AND (payload - ARRAY['company_name','starts_at','city','path']) = '{}'::jsonb
        AND NOT jsonb_path_exists(payload, '$.* ? (@.type() != "string" && @.type() != "null")')
        AND length(payload::text) <= 800
        AND COALESCE(payload->>'path', '') ~ '^/([A-Za-z0-9_-][A-Za-z0-9_/-]*)?$'
    )
);
CREATE INDEX IF NOT EXISTS idx_notice_outbox_recipient ON public.notice_outbox (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notice_outbox_event ON public.notice_outbox (event_id);

CREATE TABLE IF NOT EXISTS public.notice_deliveries (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    outbox_id           uuid NOT NULL REFERENCES public.notice_outbox(id) ON DELETE CASCADE,
    channel             text NOT NULL CHECK (channel IN ('push','email','whatsapp')),
    status              text NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending','sending','sent','delivered','opened','failed','skipped_pref','skipped_quiet',
                        'skipped_cap','skipped_expired','skipped_channel_off','skipped_no_contact','superseded')),
    attempts            integer NOT NULL DEFAULT 0,
    next_attempt_at     timestamptz NOT NULL DEFAULT now(),
    claimed_at          timestamptz,
    provider_message_id text,
    last_error          text,
    sent_at             timestamptz,
    delivered_at        timestamptz,
    opened_at           timestamptz,
    CONSTRAINT notice_deliveries_um_por_canal UNIQUE (outbox_id, channel),
    CONSTRAINT notice_deliveries_provider_unico UNIQUE (channel, provider_message_id)
);
CREATE INDEX IF NOT EXISTS idx_notice_deliveries_due
    ON public.notice_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_notice_deliveries_sending
    ON public.notice_deliveries (claimed_at) WHERE status = 'sending';

CREATE TABLE IF NOT EXISTS public.notice_preferences (
    user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    push        boolean NOT NULL DEFAULT true,
    email       boolean NOT NULL DEFAULT true,
    whatsapp    boolean NOT NULL DEFAULT false,
    quiet_start time NOT NULL DEFAULT '22:00',
    quiet_end   time NOT NULL DEFAULT '07:00',
    tz          text NOT NULL DEFAULT 'America/Sao_Paulo',
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Append-only. SEM FK (retencao legal de 5 anos: sobrevive a exclusao da conta, anonimizado).
CREATE TABLE IF NOT EXISTS public.notice_consents (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      uuid NOT NULL,
    channel      text NOT NULL CHECK (channel IN ('push','email','whatsapp')),
    action       text NOT NULL CHECK (action IN ('opt_in','opt_out')),
    source       text NOT NULL CHECK (source IN ('app','email_link','whatsapp_stop','admin')),
    phone_e164   text,
    text_version text,
    ip           inet,
    created_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_notice_consents_user ON public.notice_consents (user_id, channel, id DESC);

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- O dispatcher faz POST nesta URL: so servicos de push conhecidos (evita SSRF).
    endpoint        text NOT NULL UNIQUE CHECK (
        length(endpoint) <= 1000 AND endpoint ~
        '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'),
    p256dh          text NOT NULL CHECK (length(p256dh) BETWEEN 1 AND 200),
    auth            text NOT NULL CHECK (length(auth) BETWEEN 1 AND 100),
    user_agent      text CHECK (length(user_agent) <= 300),
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_success_at timestamptz,
    failed_count    integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS public.notice_channel_settings (
    channel            text PRIMARY KEY CHECK (channel IN ('push','email','whatsapp')),
    enabled            boolean NOT NULL DEFAULT false,
    whatsapp_delay_min integer NOT NULL DEFAULT 10 CHECK (whatsapp_delay_min BETWEEN 0 AND 1440),
    daily_cap          integer NOT NULL CHECK (daily_cap >= 0)
);
-- push/email ligados no banco: quem os desliga e a falta de segredo na funcao. WhatsApp nasce DESLIGADO.
INSERT INTO public.notice_channel_settings (channel, enabled, daily_cap)
VALUES ('push', true, 6), ('email', true, 3), ('whatsapp', false, 2)
ON CONFLICT (channel) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.notice_funnel_archive (
    day        date NOT NULL,
    event_kind text NOT NULL,
    channel    text NOT NULL,
    status     text NOT NULL,
    total      bigint NOT NULL,
    PRIMARY KEY (day, event_kind, channel, status)
);

-- 2. RLS e grants -------------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['notice_outbox','notice_deliveries','notice_preferences','notice_consents',
                             'push_subscriptions','notice_channel_settings','notice_funnel_archive'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
        EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notice_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT SELECT ON public.notice_consents TO authenticated;

DROP POLICY IF EXISTS notice_preferences_dono ON public.notice_preferences;
CREATE POLICY notice_preferences_dono ON public.notice_preferences FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS push_subscriptions_dono ON public.push_subscriptions;
CREATE POLICY push_subscriptions_dono ON public.push_subscriptions FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS notice_consents_dono_le ON public.notice_consents;
CREATE POLICY notice_consents_dono_le ON public.notice_consents FOR SELECT TO authenticated
    USING (user_id = (SELECT auth.uid()));

-- Consentimento e imutavel: a unica mudanca aceita e anonimizar telefone/ip.
CREATE OR REPLACE FUNCTION public.notice_consents_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND (pg_catalog.to_jsonb(NEW) - ARRAY['phone_e164','ip']) = (pg_catalog.to_jsonb(OLD) - ARRAY['phone_e164','ip'])
       AND NEW.phone_e164 IS NULL AND NEW.ip IS NULL THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'notice_consents e append-only.' USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS trg_notice_consents_append_only ON public.notice_consents;
CREATE TRIGGER trg_notice_consents_append_only BEFORE UPDATE OR DELETE ON public.notice_consents
    FOR EACH ROW EXECUTE FUNCTION public.notice_consents_append_only();

-- Fuso invalido gravado por um usuario derrubaria o lote inteiro: barrado na escrita.
CREATE OR REPLACE FUNCTION public.notice_preferences_check()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = NEW.tz) THEN
        RAISE EXCEPTION 'notice_preferences: fuso desconhecido.' USING ERRCODE = '22023';
    END IF;
    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notice_preferences_check ON public.notice_preferences;
CREATE TRIGGER trg_notice_preferences_check BEFORE INSERT OR UPDATE ON public.notice_preferences
    FOR EACH ROW EXECUTE FUNCTION public.notice_preferences_check();

-- 3. Funcoes da fila ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.internal_enqueue_notice(
    p_event_kind text, p_event_id uuid, p_recipient_id uuid, p_payload jsonb,
    p_expires_at timestamptz, p_urgency text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_id    uuid;
    v_notif uuid;
BEGIN
    -- Aviso ja vencido (convite expirado, turno que comecou) nem entra na fila.
    IF p_recipient_id IS NULL OR p_expires_at IS NULL OR p_expires_at <= pg_catalog.now()
       OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_recipient_id) THEN
        RETURN NULL;
    END IF;

    INSERT INTO public.notice_outbox (event_kind, event_id, recipient_id, payload, expires_at, urgency)
    VALUES (p_event_kind, p_event_id, p_recipient_id, p_payload, p_expires_at, p_urgency)
    ON CONFLICT (event_kind, event_id, recipient_id) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Linha do sino criada na MESMA transacao (created_at = now()), quando ja existe.
    BEGIN
        SELECT n.id::text::uuid INTO v_notif FROM public.notifications n
         WHERE n.user_id = p_recipient_id AND n.created_at = pg_catalog.now() LIMIT 1;
        UPDATE public.notice_outbox SET notification_id = v_notif WHERE id = v_id;
    EXCEPTION WHEN invalid_text_representation THEN
        NULL; -- id de notifications nao e uuid: vinculo e opcional
    END;

    INSERT INTO public.notice_deliveries (outbox_id, channel, next_attempt_at)
    SELECT v_id, s.channel,
           CASE WHEN s.channel = 'whatsapp'
                THEN pg_catalog.now() + pg_catalog.make_interval(mins => s.whatsapp_delay_min)
                ELSE pg_catalog.now() END
      FROM public.notice_channel_settings s
     WHERE s.channel <> 'whatsapp' OR p_urgency = 'urgent'
    ON CONFLICT (outbox_id, channel) DO NOTHING;

    RETURN v_id;
END;
$$;

-- Fim do horario silencioso se p_now cair nele; NULL caso contrario.
CREATE OR REPLACE FUNCTION public.internal_notice_quiet_until(p_now timestamptz, p_start time, p_end time, p_tz text)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
    v_local timestamp := p_now AT TIME ZONE p_tz;
    v_t     time := v_local::time;
BEGIN
    IF p_start = p_end THEN RETURN NULL; END IF;
    IF p_start < p_end THEN
        IF v_t >= p_start AND v_t < p_end THEN RETURN (v_local::date + p_end) AT TIME ZONE p_tz; END IF;
    ELSIF v_t >= p_start THEN
        RETURN (v_local::date + 1 + p_end) AT TIME ZONE p_tz;
    ELSIF v_t < p_end THEN
        RETURN (v_local::date + p_end) AT TIME ZONE p_tz;
    END IF;
    RETURN NULL;
END;
$$;

-- FONTE UNICA das regras de envio. p_channels = canais que a funcao tem segredo para enviar (NULL = todos).
CREATE OR REPLACE FUNCTION public.claim_notice_batch(p_limit integer DEFAULT 50, p_channels text[] DEFAULT NULL)
RETURNS TABLE (delivery_id uuid, channel text, event_kind text, event_id uuid, recipient_id uuid,
               payload jsonb, urgency text, expires_at timestamptz, email text, phone text,
               subscriptions jsonb, attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
    r            record;
    v_pref       public.notice_preferences%ROWTYPE;
    v_set        public.notice_channel_settings%ROWTYPE;
    v_responded  boolean;
    v_dead       boolean;
    v_gone       boolean;
    v_read       boolean;
    v_status     text;
    v_email      text;
    v_phone      text;
    v_subs       jsonb;
    v_quiet      timestamptz;
    v_count      integer;
    v_taken      integer := 0;
BEGIN
    -- Serializa dispatchers: o teto por pessoa nao pode ser contado em paralelo.
    IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('worki.notice_claim')) THEN
        RETURN;
    END IF;

    -- Funcao que morreu no meio do envio: devolve a fila (conta como tentativa).
    UPDATE public.notice_deliveries d
       SET status = CASE WHEN d.attempts >= 4 THEN 'failed' ELSE 'pending' END,
           attempts = d.attempts + 1, last_error = 'envio interrompido', next_attempt_at = pg_catalog.now()
     WHERE d.status = 'sending' AND d.claimed_at < pg_catalog.now() - interval '10 minutes';

    FOR r IN
        SELECT d.id AS did, d.channel AS ch, d.attempts AS att, o.id AS oid, o.event_kind AS kind,
               o.event_id AS eid, o.recipient_id AS rid, o.payload AS pl, o.urgency AS urg,
               o.expires_at AS exp, o.notification_id AS nid, o.created_at AS ocreated
          FROM public.notice_deliveries d
          JOIN public.notice_outbox o ON o.id = d.outbox_id
         WHERE d.status = 'pending' AND d.next_attempt_at <= pg_catalog.now()
         ORDER BY (o.urgency = 'urgent') DESC, d.next_attempt_at
         LIMIT 500
           FOR UPDATE OF d SKIP LOCKED
    LOOP
        EXIT WHEN v_taken >= LEAST(GREATEST(p_limit, 1), 200);
        v_status := NULL; v_responded := false; v_dead := r.exp <= pg_catalog.now();
        v_email := NULL; v_phone := NULL; v_subs := NULL;

        IF r.kind IN ('shift_call_target','sos_call_target') THEN
            SELECT t.response IS NOT NULL,
                   c.status <> 'open' OR c.expires_at <= pg_catalog.now()
                   OR NOT public.job_is_active(c.job_id)
              INTO v_responded, v_gone
              FROM public.shift_call_targets t JOIN public.shift_calls c ON c.id = t.call_id
             WHERE t.id = r.eid;
            IF NOT FOUND THEN v_dead := true; v_responded := false;
            ELSE v_dead := v_dead OR v_responded OR v_gone; END IF;
        ELSIF r.kind = 'attendance_request' THEN
            SELECT s.response IS NOT NULL, NOT public.job_is_active(s.job_id)
              INTO v_responded, v_gone
              FROM public.shift_attendance_confirmations s WHERE s.id = r.eid;
            IF NOT FOUND THEN v_dead := true; v_responded := false;
            ELSE v_dead := v_dead OR v_responded OR v_gone; END IF;
        END IF;

        -- (1) vencido / ja respondido   (5) WhatsApp superado por leitura ou resposta
        IF r.ch = 'whatsapp' AND v_responded THEN
            v_status := 'superseded';
        ELSIF v_dead THEN
            v_status := 'skipped_expired';
        ELSIF r.ch = 'whatsapp' THEN
            v_read := EXISTS (SELECT 1 FROM public.notice_deliveries x
                               WHERE x.outbox_id = r.oid AND x.opened_at IS NOT NULL)
                   OR EXISTS (SELECT 1 FROM public.notifications n
                               WHERE n.user_id = r.rid AND n.read_at IS NOT NULL
                                 AND (n.id::text = r.nid::text
                                      OR (n.link = r.pl->>'path' AND n.created_at >= r.ocreated
                                          AND n.created_at < r.ocreated + interval '1 minute')));
            IF v_read THEN v_status := 'superseded'; END IF;
        END IF;

        IF v_status IS NULL THEN
            SELECT * INTO v_set FROM public.notice_channel_settings s WHERE s.channel = r.ch;
            IF NOT COALESCE(v_set.enabled, false) OR (p_channels IS NOT NULL AND NOT r.ch = ANY (p_channels)) THEN
                v_status := 'skipped_channel_off';
            END IF;
        END IF;

        -- (2) preferencia e opt-in
        IF v_status IS NULL THEN
            SELECT * INTO v_pref FROM public.notice_preferences p WHERE p.user_id = r.rid;
            IF NOT FOUND THEN
                v_pref.push := true; v_pref.email := true; v_pref.whatsapp := false;
                v_pref.quiet_start := '22:00'; v_pref.quiet_end := '07:00'; v_pref.tz := 'America/Sao_Paulo';
            END IF;
            IF NOT (CASE r.ch WHEN 'push' THEN v_pref.push WHEN 'email' THEN v_pref.email ELSE v_pref.whatsapp END) THEN
                v_status := 'skipped_pref';
            ELSIF r.ch = 'whatsapp' THEN
                SELECT CASE WHEN k.action = 'opt_in' THEN k.phone_e164 END INTO v_phone
                  FROM public.notice_consents k
                 WHERE k.user_id = r.rid AND k.channel = 'whatsapp' ORDER BY k.id DESC LIMIT 1;
                IF v_phone IS NULL THEN v_status := 'skipped_pref'; END IF;
            END IF;
        END IF;

        -- contato
        IF v_status IS NULL AND r.ch = 'email' THEN
            SELECT NULLIF(u.email, '') INTO v_email FROM auth.users u WHERE u.id = r.rid;
            IF v_email IS NULL THEN v_status := 'skipped_no_contact'; END IF;
        ELSIF v_status IS NULL AND r.ch = 'push' THEN
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'id', q.id, 'endpoint', q.endpoint, 'p256dh', q.p256dh, 'auth', q.auth))
              INTO v_subs
              FROM (SELECT * FROM public.push_subscriptions s WHERE s.user_id = r.rid
                     ORDER BY s.created_at DESC LIMIT 10) q;
            IF v_subs IS NULL THEN v_status := 'skipped_no_contact'; END IF;
        END IF;

        -- (3) horario silencioso: urgente passa
        IF v_status IS NULL AND r.urg <> 'urgent' THEN
            v_quiet := public.internal_notice_quiet_until(pg_catalog.now(), v_pref.quiet_start, v_pref.quiet_end, v_pref.tz);
            IF v_quiet IS NOT NULL THEN
                IF v_quiet >= r.exp THEN
                    v_status := 'skipped_quiet'; -- venceria antes do fim do silencio
                ELSE
                    UPDATE public.notice_deliveries d SET next_attempt_at = v_quiet WHERE d.id = r.did;
                    CONTINUE;
                END IF;
            END IF;
        END IF;

        -- (4) teto em 24h: urgente conta, mas so e barrado no WhatsApp
        IF v_status IS NULL AND (r.urg <> 'urgent' OR r.ch = 'whatsapp') THEN
            SELECT pg_catalog.count(*) INTO v_count
              FROM public.notice_deliveries d JOIN public.notice_outbox o ON o.id = d.outbox_id
             WHERE o.recipient_id = r.rid AND d.channel = r.ch AND d.id <> r.did
               AND d.status IN ('sending','sent','delivered','opened')
               AND COALESCE(d.sent_at, d.claimed_at) > pg_catalog.now() - interval '24 hours';
            IF v_count >= v_set.daily_cap THEN v_status := 'skipped_cap'; END IF;
        END IF;

        IF v_status IS NOT NULL THEN
            UPDATE public.notice_deliveries d SET status = v_status WHERE d.id = r.did;
            CONTINUE;
        END IF;

        UPDATE public.notice_deliveries d SET status = 'sending', claimed_at = pg_catalog.now() WHERE d.id = r.did;
        v_taken := v_taken + 1;
        delivery_id := r.did; channel := r.ch; event_kind := r.kind; event_id := r.eid; recipient_id := r.rid;
        payload := r.pl; urgency := r.urg; expires_at := r.exp; email := v_email;
        phone := CASE WHEN r.ch = 'whatsapp' THEN v_phone END; subscriptions := v_subs; attempts := r.att;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- Falha: novas tentativas em 1, 5, 30 e 120 min; a falha seguinte a 4a vira 'failed'.
CREATE OR REPLACE FUNCTION public.report_notice_result(
    p_delivery_id uuid, p_status text, p_provider_message_id text DEFAULT NULL, p_error text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_att integer;
    v_new text;
BEGIN
    IF p_status NOT IN ('sent','failed','skipped_channel_off','skipped_no_contact') THEN
        RAISE EXCEPTION 'report_notice_result: status invalido' USING ERRCODE = '22023';
    END IF;
    SELECT d.attempts INTO v_att FROM public.notice_deliveries d
     WHERE d.id = p_delivery_id AND d.status = 'sending' FOR UPDATE;
    IF NOT FOUND THEN RETURN 'ignored'; END IF;

    v_new := CASE WHEN p_status <> 'failed' THEN p_status WHEN v_att >= 4 THEN 'failed' ELSE 'pending' END;
    UPDATE public.notice_deliveries d
       SET status = v_new,
           attempts = d.attempts + CASE WHEN p_status IN ('sent','failed') THEN 1 ELSE 0 END,
           next_attempt_at = CASE WHEN v_new = 'pending'
               THEN pg_catalog.now() + pg_catalog.make_interval(mins => (ARRAY[1,5,30,120])[v_att + 1])
               ELSE d.next_attempt_at END,
           provider_message_id = COALESCE(p_provider_message_id, d.provider_message_id),
           last_error = pg_catalog.left(p_error, 200),
           sent_at = CASE WHEN p_status = 'sent' THEN pg_catalog.now() ELSE d.sent_at END
     WHERE d.id = p_delivery_id;
    RETURN v_new;
END;
$$;

-- Desligar por fora do app (link de descadastro, bounce, reclamacao, "PARAR").
CREATE OR REPLACE FUNCTION public.notice_unsubscribe(p_user_id uuid, p_channel text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_channel NOT IN ('push','email','whatsapp') THEN
        RAISE EXCEPTION 'canal invalido' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN RETURN false; END IF;
    INSERT INTO public.notice_preferences (user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.notice_preferences p
       SET push = p.push AND p_channel <> 'push',
           email = p.email AND p_channel <> 'email',
           whatsapp = p.whatsapp AND p_channel <> 'whatsapp'
     WHERE p.user_id = p_user_id;
    -- Idempotente: so registra se o ultimo estado nao era opt_out.
    IF COALESCE((SELECT k.action FROM public.notice_consents k
                  WHERE k.user_id = p_user_id AND k.channel = p_channel ORDER BY k.id DESC LIMIT 1), '') <> 'opt_out' THEN
        INSERT INTO public.notice_consents (user_id, channel, action, source)
        VALUES (p_user_id, p_channel, 'opt_out',
                CASE p_channel WHEN 'whatsapp' THEN 'whatsapp_stop' ELSE 'email_link' END);
    END IF;
    RETURN true;
END;
$$;

-- Webhooks de provedor. Estado so avanca: sent -> delivered -> opened.
CREATE OR REPLACE FUNCTION public.record_notice_event(p_channel text, p_provider_message_id text, p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_id  uuid;
    v_rid uuid;
BEGIN
    SELECT d.id, o.recipient_id INTO v_id, v_rid
      FROM public.notice_deliveries d JOIN public.notice_outbox o ON o.id = d.outbox_id
     WHERE d.channel = p_channel AND d.provider_message_id = p_provider_message_id;
    IF NOT FOUND THEN RETURN false; END IF;

    IF p_status = 'delivered' THEN
        UPDATE public.notice_deliveries d SET delivered_at = COALESCE(d.delivered_at, pg_catalog.now()),
               status = CASE WHEN d.status = 'sent' THEN 'delivered' ELSE d.status END WHERE d.id = v_id;
    ELSIF p_status = 'opened' THEN
        UPDATE public.notice_deliveries d SET opened_at = COALESCE(d.opened_at, pg_catalog.now()),
               status = CASE WHEN d.status IN ('sent','delivered') THEN 'opened' ELSE d.status END WHERE d.id = v_id;
    ELSIF p_status IN ('bounced','complaint','failed') THEN
        UPDATE public.notice_deliveries d SET status = 'failed', last_error = p_status WHERE d.id = v_id;
        IF p_status IN ('bounced','complaint') THEN
            PERFORM public.notice_unsubscribe(v_rid, p_channel);
        END IF;
    ELSE
        RETURN false;
    END IF;
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_notice_whatsapp_stop(p_phone_e164 text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_uid uuid;
    v_n   integer := 0;
BEGIN
    FOR v_uid IN SELECT DISTINCT k.user_id FROM public.notice_consents k
                  WHERE k.channel = 'whatsapp' AND k.phone_e164 = p_phone_e164
    LOOP
        IF public.notice_unsubscribe(v_uid, 'whatsapp') THEN v_n := v_n + 1; END IF;
    END LOOP;
    RETURN v_n;
END;
$$;

-- 4. RPCs do cliente ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_notice_preference(
    p_channel text, p_enabled boolean, p_phone text DEFAULT NULL, p_text_version text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
BEGIN
    IF v_uid IS NULL THEN RETURN pg_catalog.jsonb_build_object('outcome', 'unauthenticated'); END IF;
    IF p_channel IS NULL OR p_channel NOT IN ('push','email','whatsapp') OR p_enabled IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'invalid_input');
    END IF;
    IF p_channel = 'whatsapp' AND p_enabled
       AND (p_phone IS NULL OR p_phone !~ '^\+[1-9][0-9]{7,14}$' OR COALESCE(pg_catalog.length(p_text_version), 0) NOT BETWEEN 1 AND 40) THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'phone_and_consent_required');
    END IF;

    INSERT INTO public.notice_preferences (user_id) VALUES (v_uid) ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.notice_preferences p
       SET push = CASE WHEN p_channel = 'push' THEN p_enabled ELSE p.push END,
           email = CASE WHEN p_channel = 'email' THEN p_enabled ELSE p.email END,
           whatsapp = CASE WHEN p_channel = 'whatsapp' THEN p_enabled ELSE p.whatsapp END
     WHERE p.user_id = v_uid;

    INSERT INTO public.notice_consents (user_id, channel, action, source, phone_e164, text_version)
    VALUES (v_uid, p_channel, CASE WHEN p_enabled THEN 'opt_in' ELSE 'opt_out' END, 'app',
            CASE WHEN p_channel = 'whatsapp' AND p_enabled THEN p_phone END,
            pg_catalog.left(p_text_version, 40));
    RETURN pg_catalog.jsonb_build_object('outcome', 'ok');
END;
$$;

-- RPC (e nao upsert direto): o mesmo navegador pode trocar de conta e o endpoint e UNIQUE. A linha so
-- muda de dono para quem apresenta as MESMAS chaves (prova de que esta naquele navegador).
CREATE OR REPLACE FUNCTION public.register_push_subscription(
    p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_n   integer;
BEGIN
    IF v_uid IS NULL THEN RETURN pg_catalog.jsonb_build_object('outcome', 'unauthenticated'); END IF;
    BEGIN
        INSERT INTO public.push_subscriptions AS s (user_id, endpoint, p256dh, auth, user_agent)
        VALUES (v_uid, p_endpoint, p_p256dh, p_auth, pg_catalog.left(p_user_agent, 300))
        ON CONFLICT (endpoint) DO UPDATE
           SET user_id = excluded.user_id, user_agent = excluded.user_agent, failed_count = 0,
               p256dh = excluded.p256dh, auth = excluded.auth
         WHERE s.user_id = excluded.user_id OR (s.p256dh = excluded.p256dh AND s.auth = excluded.auth);
        GET DIAGNOSTICS v_n = ROW_COUNT;
    EXCEPTION WHEN check_violation OR not_null_violation THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'invalid_input');
    END;
    IF v_n = 0 THEN RETURN pg_catalog.jsonb_build_object('outcome', 'conflict'); END IF;
    -- no maximo 10 aparelhos por pessoa
    DELETE FROM public.push_subscriptions s WHERE s.user_id = v_uid AND s.endpoint <> p_endpoint
       AND s.id NOT IN (SELECT x.id FROM public.push_subscriptions x WHERE x.user_id = v_uid
                          AND x.endpoint <> p_endpoint ORDER BY x.created_at DESC LIMIT 9);
    RETURN pg_catalog.jsonb_build_object('outcome', 'ok');
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_notice_opened(p_event_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n integer;
BEGIN
    UPDATE public.notice_deliveries d
       SET opened_at = COALESCE(d.opened_at, pg_catalog.now()),
           status = CASE WHEN d.status IN ('sent','delivered') THEN 'opened' ELSE d.status END
      FROM public.notice_outbox o
     WHERE o.id = d.outbox_id AND d.channel = 'push' AND d.status IN ('sent','delivered','opened')
       AND o.event_id = p_event_id AND o.recipient_id = (SELECT auth.uid());
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n > 0;
END;
$$;

-- 5. LGPD e retencao ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.internal_anonymize_notices(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    DELETE FROM public.push_subscriptions s WHERE s.user_id = p_user_id;
    DELETE FROM public.notice_preferences p WHERE p.user_id = p_user_id;
    DELETE FROM public.notice_outbox o WHERE o.recipient_id = p_user_id;
    UPDATE public.notice_consents k SET phone_e164 = NULL, ip = NULL
     WHERE k.user_id = p_user_id AND (k.phone_e164 IS NOT NULL OR k.ip IS NOT NULL);
END;
$$;

-- 90 dias: guarda o agregado (sem destinatario) e apaga a fila.
CREATE OR REPLACE FUNCTION public.internal_purge_notices()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    -- corte em dia inteiro: um dia nunca e agregado em duas passadas
    v_cut timestamptz := pg_catalog.date_trunc('day', pg_catalog.now() - interval '90 days');
    v_n   integer;
BEGIN
    INSERT INTO public.notice_funnel_archive AS a (day, event_kind, channel, status, total)
    SELECT (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date, o.event_kind, d.channel, d.status, pg_catalog.count(*)
      FROM public.notice_outbox o JOIN public.notice_deliveries d ON d.outbox_id = o.id
     WHERE o.created_at < v_cut
     GROUP BY 1, 2, 3, 4
    ON CONFLICT (day, event_kind, channel, status) DO UPDATE SET total = a.total + excluded.total;
    DELETE FROM public.notice_outbox o WHERE o.created_at < v_cut;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;

-- 6. Metricas -----------------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.notice_funnel_daily WITH (security_invoker = true) AS
SELECT (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
       o.event_kind, d.channel,
       count(*) AS enqueued,
       count(*) FILTER (WHERE d.sent_at IS NOT NULL) AS sent,
       count(*) FILTER (WHERE d.delivered_at IS NOT NULL) AS delivered,
       count(*) FILTER (WHERE d.opened_at IS NOT NULL) AS opened,
       count(*) FILTER (WHERE d.status = 'failed') AS failed,
       count(*) FILTER (WHERE d.status = 'skipped_pref') AS skipped_pref,
       count(*) FILTER (WHERE d.status = 'skipped_quiet') AS skipped_quiet,
       count(*) FILTER (WHERE d.status = 'skipped_cap') AS skipped_cap,
       count(*) FILTER (WHERE d.status = 'skipped_expired') AS skipped_expired,
       count(*) FILTER (WHERE d.status = 'skipped_channel_off') AS skipped_channel_off,
       count(*) FILTER (WHERE d.status = 'skipped_no_contact') AS skipped_no_contact,
       count(*) FILTER (WHERE d.status = 'superseded') AS superseded,
       -- aceite e tempo de resposta atribuidos ao canal que chegou PRIMEIRO
       count(*) FILTER (WHERE first.id = d.id AND t.response = 'accepted') AS accepted_first_channel,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM t.responded_at - t.notified_at))
           FILTER (WHERE first.id = d.id AND t.responded_at IS NOT NULL) AS median_response_seconds
  FROM public.notice_outbox o
  JOIN public.notice_deliveries d ON d.outbox_id = o.id
  LEFT JOIN public.shift_call_targets t
    ON t.id = o.event_id AND o.event_kind IN ('shift_call_target','sos_call_target')
  LEFT JOIN LATERAL (
       SELECT x.id FROM public.notice_deliveries x
        WHERE x.outbox_id = o.id AND x.sent_at IS NOT NULL
        ORDER BY COALESCE(x.delivered_at, x.sent_at), x.channel LIMIT 1) first ON true
 GROUP BY 1, 2, 3;

REVOKE ALL ON public.notice_funnel_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notice_funnel_daily TO service_role;

-- 7. Grants das funcoes -------------------------------------------------------------------------

DO $$
DECLARE f text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.internal_enqueue_notice(text,uuid,uuid,jsonb,timestamptz,text)',
        'public.internal_notice_quiet_until(timestamptz,time,time,text)',
        'public.claim_notice_batch(integer,text[])',
        'public.report_notice_result(uuid,text,text,text)',
        'public.record_notice_event(text,text,text)',
        'public.record_notice_whatsapp_stop(text)',
        'public.notice_unsubscribe(uuid,text)',
        'public.internal_anonymize_notices(uuid)',
        'public.internal_purge_notices()',
        'public.set_notice_preference(text,boolean,text,text)',
        'public.register_push_subscription(text,text,text,text)',
        'public.mark_notice_opened(uuid)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END LOOP;
END $$;

-- internal_enqueue_notice NEM service_role precisa: so triggers DEFINER (dono) chamam.
REVOKE ALL ON FUNCTION public.internal_enqueue_notice(text,uuid,uuid,jsonb,timestamptz,text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.set_notice_preference(text,boolean,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_push_subscription(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notice_opened(uuid) TO authenticated;
-- trigger functions das tabelas que o cliente escreve
GRANT EXECUTE ON FUNCTION public.notice_preferences_check() TO authenticated, service_role;

-- 8. Verificacao
DO $$
DECLARE v_bad text;
BEGIN
    SELECT string_agg(t, ', ') INTO v_bad
      FROM unnest(ARRAY['notice_outbox','notice_deliveries','notice_channel_settings','notice_funnel_archive']) t
     WHERE has_table_privilege('authenticated', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE')
        OR has_table_privilege('anon', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE')
        OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = ('public.' || t)::regclass);
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFICACAO: cliente alcanca %. HALT.', v_bad; END IF;

    IF has_table_privilege('authenticated', 'public.notice_consents', 'INSERT, UPDATE, DELETE') THEN
        RAISE EXCEPTION 'VERIFICACAO: cliente escreve em notice_consents. HALT.';
    END IF;
    IF has_function_privilege('authenticated', 'public.internal_enqueue_notice(text,uuid,uuid,jsonb,timestamptz,text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.claim_notice_batch(integer,text[])', 'EXECUTE')
       OR has_function_privilege('anon', 'public.set_notice_preference(text,boolean,text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'VERIFICACAO: EXECUTE indevido nas funcoes de aviso. HALT.';
    END IF;
END $$;

COMMIT;
