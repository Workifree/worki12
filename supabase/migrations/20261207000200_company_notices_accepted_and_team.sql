-- Avisos externos (E-mail Resend + Web Push mobile) para EMPRESAS (Gestor e Encarregado responsável):
--   1. `shift_accepted`: freela aceitou convite ou pegou vaga em chamado de turno.
--   2. `team_member_waiting`: novo membro da equipe entrou pelo link e aguarda confirmação ("É essa pessoa?").

ALTER TABLE public.notice_outbox DROP CONSTRAINT IF EXISTS notice_outbox_event_kind_check;
ALTER TABLE public.notice_outbox
  ADD CONSTRAINT notice_outbox_event_kind_check
  CHECK (event_kind = ANY (ARRAY[
    'shift_call_target'::text,
    'sos_call_target'::text,
    'attendance_request'::text,
    'shift_cancelled'::text,
    'payment_recorded'::text,
    'shift_accepted'::text,
    'team_member_waiting'::text
  ]));

CREATE OR REPLACE FUNCTION public.notice_on_application_hired()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_job     record;
  v_uid     uuid := (SELECT auth.uid());
  v_rcp     uuid;
  v_payload jsonb;
BEGIN
  IF NEW.status <> 'hired' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'hired' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_job FROM public.internal_notice_job(NEW.job_id);
  IF v_job.company_name IS NULL AND v_job.starts_at IS NULL THEN
    RETURN NEW;
  END IF;

  v_payload := pg_catalog.jsonb_build_object(
    'company_name', v_job.company_name,
    'city', v_job.city,
    'starts_at', v_job.starts_at,
    'path', '/company/jobs/' || NEW.job_id || '/candidates'
  );

  FOR v_rcp IN SELECT x FROM public.notification_recipients_for_job(NEW.job_id) AS x LOOP
    IF v_rcp IS DISTINCT FROM NEW.worker_id AND v_rcp IS DISTINCT FROM v_uid THEN
      PERFORM public.internal_enqueue_notice(
        'shift_accepted',
        NEW.id,
        v_rcp,
        v_payload,
        COALESCE(v_job.deadline, pg_catalog.now() + interval '24 hours'),
        'normal'
      );
    END IF;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notice_on_application_hired: % %', SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_yy_notice_application_hired ON public.applications;
CREATE TRIGGER trg_yy_notice_application_hired
  AFTER INSERT OR UPDATE OF status ON public.applications
  FOR EACH ROW
  WHEN (NEW.status = 'hired')
  EXECUTE FUNCTION public.notice_on_application_hired();

CREATE OR REPLACE FUNCTION public.notice_on_member_waiting_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_company_name text;
  v_owner_id     uuid;
  v_rcp          uuid;
  v_payload      jsonb;
BEGIN
  IF NEW.status <> 'active' OR NEW.user_id IS NULL OR NEW.confirmed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.user_id IS NOT NULL AND OLD.status = 'active' THEN
    RETURN NEW;
  END IF;

  SELECT c.company_name, c.owner_id
    INTO v_company_name, v_owner_id
    FROM public.companies c
   WHERE c.id = NEW.company_id;

  v_payload := pg_catalog.jsonb_build_object(
    'company_name', COALESCE(v_company_name, 'Sua empresa'),
    'path', '/company/configuracoes/equipe'
  );

  FOR v_rcp IN
    SELECT DISTINCT u_id FROM (
      SELECT v_owner_id AS u_id
      UNION
      SELECT cm.user_id AS u_id
        FROM public.company_members cm
       WHERE cm.company_id = NEW.company_id
         AND cm.status = 'active'
         AND cm.role = 'manager'
         AND cm.confirmed_at IS NOT NULL
         AND cm.user_id IS NOT NULL
    ) managers
    WHERE u_id IS NOT NULL AND u_id IS DISTINCT FROM NEW.user_id
  LOOP
    PERFORM public.internal_enqueue_notice(
      'team_member_waiting',
      NEW.id,
      v_rcp,
      v_payload,
      pg_catalog.now() + interval '7 days',
      'normal'
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notice_on_member_waiting_confirmation: % %', SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_yy_notice_member_waiting ON public.company_members;
CREATE TRIGGER trg_yy_notice_member_waiting
  AFTER INSERT OR UPDATE OF user_id, status ON public.company_members
  FOR EACH ROW
  WHEN (NEW.status = 'active' AND NEW.user_id IS NOT NULL AND NEW.confirmed_at IS NULL)
  EXECUTE FUNCTION public.notice_on_member_waiting_confirmation();
