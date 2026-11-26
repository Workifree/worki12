-- Migration: AVISOS MULTICANAL (2/3) - produtores dos 5 eventos + LGPD
--
-- Os produtores sao triggers AFTER nas tabelas de ORIGEM (mesmo commit do evento: rollback do evento
-- apaga o aviso). Nenhuma funcao existente de negocio e reescrita: claim_shift_slot, create_sos_call,
-- notify_* e as travas de 20261126000700/000800 ficam intactas. (Nao e o trigger em `notifications`
-- rejeitado no ADR.) create_sos_call e coberta pelo INSERT em shift_call_targets (origin='sos').
--
-- Falha ao ENFILEIRAR nunca derruba o evento (aceite, pagamento, cancelamento): RAISE WARNING.
--
-- Unica edicao de funcao existente: anonymize_account ganha UMA linha (corpo editado a partir do
-- catalogo, com assercao, como em 20261123000200).
--
-- DOWN:
--   DROP TRIGGER trg_yy_notice_shift_call_target ON public.shift_call_targets;
--   DROP TRIGGER trg_yy_notice_attendance ON public.shift_attendance_confirmations;
--   DROP TRIGGER trg_yy_notice_cancel ON public.applications;
--   DROP TRIGGER trg_yy_notice_payment ON public.shift_payments;
--   DROP FUNCTION public.notice_on_shift_call_target(), public.notice_on_attendance_request(),
--     public.notice_on_application_cancel(), public.notice_on_shift_payment(), public.internal_notice_job(uuid);
--   anonymize_account: remover a linha "PERFORM public.internal_anonymize_notices(p_user_id);"
--     (DO com pg_get_functiondef + replace + EXECUTE).

BEGIN;

DO $$
BEGIN
    IF to_regprocedure('public.internal_enqueue_notice(text,uuid,uuid,jsonb,timestamptz,text)') IS NULL THEN
        RAISE EXCEPTION 'PRE-CONDICAO avisos: aplicar 20261201000100 antes. HALT.';
    END IF;
    IF to_regprocedure('public.notification_recipients_for_job(uuid)') IS NULL
       OR to_regprocedure('public.sos_shift_starts_at(timestamptz,text)') IS NULL
       OR to_regprocedure('public.job_is_active(uuid)') IS NULL
       OR to_regprocedure('public.is_job_owner(uuid)') IS NULL
       OR to_regprocedure('public.anonymize_account(uuid)') IS NULL THEN
        RAISE EXCEPTION 'PRE-CONDICAO avisos: funcao base ausente. HALT.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                    AND table_name = 'shift_call_targets' AND column_name = 'origin') THEN
        RAISE EXCEPTION 'PRE-CONDICAO avisos: shift_call_targets.origin ausente. HALT.';
    END IF;
END $$;

-- Dados minimos do turno. starts_at vai no payload; deadline = ate quando o aviso ainda serve
-- (sem horario valido: fim do dia local do turno).
CREATE OR REPLACE FUNCTION public.internal_notice_job(p_job_id uuid)
RETURNS TABLE (company_name text, city text, starts_at timestamptz, deadline timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT pg_catalog.left(c.name, 80), pg_catalog.left(c.city, 60), s.at,
           CASE WHEN j.work_start_time::text ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN s.at
                ELSE ((pg_catalog.date_trunc('day', s.at AT TIME ZONE 'America/Sao_Paulo') + interval '1 day')
                      AT TIME ZONE 'America/Sao_Paulo') END
      FROM public.jobs j
      LEFT JOIN public.companies c ON c.id = j.company_id
     CROSS JOIN LATERAL (SELECT public.sos_shift_starts_at(j.start_date::timestamptz, j.work_start_time::text) AS at) s
     WHERE j.id = p_job_id;
$$;

CREATE OR REPLACE FUNCTION public.notice_on_shift_call_target()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_call public.shift_calls%ROWTYPE;
    v_job  record;
BEGIN
    IF NEW.response IS NOT NULL THEN RETURN NEW; END IF;
    SELECT * INTO v_call FROM public.shift_calls c WHERE c.id = NEW.call_id;
    IF v_call.status <> 'open' THEN RETURN NEW; END IF;
    SELECT * INTO v_job FROM public.internal_notice_job(v_call.job_id);
    PERFORM public.internal_enqueue_notice(
        CASE WHEN NEW.origin = 'sos' THEN 'sos_call_target' ELSE 'shift_call_target' END,
        NEW.id, NEW.worker_id,
        pg_catalog.jsonb_build_object('company_name', v_job.company_name, 'city', v_job.city,
            'starts_at', v_job.starts_at, 'path', '/my-jobs'),
        v_call.expires_at,
        CASE WHEN NEW.origin = 'sos' OR v_job.starts_at <= pg_catalog.now() + interval '6 hours'
             THEN 'urgent' ELSE 'normal' END);
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notice_on_shift_call_target: % %', SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notice_on_attendance_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job record;
BEGIN
    IF NEW.response IS NOT NULL THEN RETURN NEW; END IF;
    SELECT * INTO v_job FROM public.internal_notice_job(NEW.job_id);
    PERFORM public.internal_enqueue_notice('attendance_request', NEW.id, NEW.worker_id,
        pg_catalog.jsonb_build_object('company_name', v_job.company_name, 'city', v_job.city,
            'starts_at', v_job.starts_at, 'path', '/my-jobs'),
        v_job.deadline, 'normal');
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notice_on_attendance_request: % %', SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;

-- Mesma regra de ator de notify_counterpart_on_application_cancel.
CREATE OR REPLACE FUNCTION public.notice_on_application_cancel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_job     record;
    v_uid     uuid := (SELECT auth.uid());
    v_actor   text;
    v_rcp     uuid;
    v_payload jsonb;
BEGIN
    SELECT * INTO v_job FROM public.internal_notice_job(NEW.job_id);
    v_actor := CASE WHEN v_uid = NEW.worker_id THEN 'worker'
                    WHEN v_uid IS NOT NULL AND public.is_job_owner(NEW.job_id) THEN 'company'
                    ELSE 'unknown' END;
    v_payload := pg_catalog.jsonb_build_object('company_name', v_job.company_name, 'city', v_job.city,
                    'starts_at', v_job.starts_at);
    IF v_actor <> 'worker' THEN
        PERFORM public.internal_enqueue_notice('shift_cancelled', NEW.id, NEW.worker_id,
            v_payload || pg_catalog.jsonb_build_object('path', '/my-jobs'), v_job.deadline, 'normal');
    END IF;
    IF v_actor <> 'company' THEN
        FOR v_rcp IN SELECT x FROM public.notification_recipients_for_job(NEW.job_id) AS x LOOP
            IF v_rcp IS DISTINCT FROM NEW.worker_id AND v_rcp IS DISTINCT FROM v_uid THEN
                PERFORM public.internal_enqueue_notice('shift_cancelled', NEW.id, v_rcp,
                    v_payload || pg_catalog.jsonb_build_object('path', '/company/jobs/' || NEW.job_id || '/candidates'),
                    v_job.deadline, 'normal');
            END IF;
        END LOOP;
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notice_on_application_cancel: % %', SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notice_on_shift_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job record;
BEGIN
    IF NEW.status <> 'recorded' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD.status IS NOT DISTINCT FROM 'recorded' THEN RETURN NEW; END IF;
    END IF;
    SELECT * INTO v_job FROM public.internal_notice_job(NEW.job_id);
    -- sem valor no conteudo (ADR 7)
    PERFORM public.internal_enqueue_notice('payment_recorded', NEW.id, NEW.worker_id,
        pg_catalog.jsonb_build_object('company_name', v_job.company_name, 'city', v_job.city,
            'starts_at', v_job.starts_at, 'path', '/recibo/' || NEW.job_id),
        pg_catalog.now() + interval '30 days', 'low');
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notice_on_shift_payment: % %', SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_yy_notice_shift_call_target ON public.shift_call_targets;
CREATE TRIGGER trg_yy_notice_shift_call_target AFTER INSERT ON public.shift_call_targets
    FOR EACH ROW EXECUTE FUNCTION public.notice_on_shift_call_target();

DROP TRIGGER IF EXISTS trg_yy_notice_attendance ON public.shift_attendance_confirmations;
CREATE TRIGGER trg_yy_notice_attendance AFTER INSERT ON public.shift_attendance_confirmations
    FOR EACH ROW EXECUTE FUNCTION public.notice_on_attendance_request();

DROP TRIGGER IF EXISTS trg_yy_notice_cancel ON public.applications;
CREATE TRIGGER trg_yy_notice_cancel AFTER UPDATE OF status ON public.applications
    FOR EACH ROW
    WHEN (NEW.status = 'cancelled' AND OLD.status IN ('invited','hired','in_progress'))
    EXECUTE FUNCTION public.notice_on_application_cancel();

DROP TRIGGER IF EXISTS trg_yy_notice_payment ON public.shift_payments;
CREATE TRIGGER trg_yy_notice_payment AFTER INSERT OR UPDATE ON public.shift_payments
    FOR EACH ROW EXECUTE FUNCTION public.notice_on_shift_payment();

DO $$
DECLARE f text;
BEGIN
    REVOKE ALL ON FUNCTION public.internal_notice_job(uuid) FROM PUBLIC, anon, authenticated;
    FOREACH f IN ARRAY ARRAY['public.notice_on_shift_call_target()', 'public.notice_on_attendance_request()',
                             'public.notice_on_application_cancel()', 'public.notice_on_shift_payment()'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
    END LOOP;
END $$;

-- LGPD: anonymize_account limpa as tabelas novas (edicao do corpo do CATALOGO).
DO $mig$
DECLARE
    v_def text := pg_get_functiondef('public.anonymize_account(uuid)'::regprocedure);
    v_pat text := 'RETURN jsonb_build_object[(][[:space:]]*''outcome'',[[:space:]]+''anonymized''';
    v_hit text;
    v_n   integer;
BEGIN
    IF position('internal_anonymize_notices' IN v_def) > 0 THEN
        RAISE NOTICE 'anonymize_account ja limpa os avisos.';
        RETURN;
    END IF;
    SELECT count(*) INTO v_n FROM regexp_matches(v_def, v_pat, 'g');
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'ASSERCAO avisos (LGPD): % retorno(s) "anonymized" em anonymize_account (esperado 1). HALT.', v_n;
    END IF;
    v_hit := (regexp_match(v_def, v_pat))[1];
    EXECUTE replace(v_def, v_hit,
        'PERFORM public.internal_anonymize_notices(p_user_id);' || chr(10) || chr(10) || '    ' || v_hit);
END
$mig$;

-- Verificacao
DO $$
DECLARE v_n integer;
BEGIN
    SELECT count(*) INTO v_n FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE t.tgname IN ('trg_yy_notice_shift_call_target','trg_yy_notice_attendance',
                        'trg_yy_notice_cancel','trg_yy_notice_payment')
       AND t.tgenabled = 'O' AND p.prosecdef;
    IF v_n <> 4 THEN RAISE EXCEPTION 'VERIFICACAO: esperava 4 produtores DEFINER, achei %. HALT.', v_n; END IF;
    IF position('internal_anonymize_notices' IN pg_get_functiondef('public.anonymize_account(uuid)'::regprocedure)) = 0 THEN
        RAISE EXCEPTION 'VERIFICACAO: anonymize_account nao limpa os avisos. HALT.';
    END IF;
END $$;

COMMIT;
