-- Migration: TEMPO REAL - publicacao supabase_realtime + avisos que faltavam
--
-- RLS no postgres_changes: INSERT/UPDATE so chegam a quem passa na policy de SELECT. DELETE NAO e
-- filtrado por RLS, mas com replica identity default (e RLS ligada) leva so a PK. Todas as tabelas
-- publicadas aqui tem PK de um uuid opaco; replica identity NAO muda.
--
--   publicada                        quem recebe (policy de SELECT vigente)
--   applications                     o proprio freela; quem opera o turno (is_job_owner)
--   shift_calls                      quem opera o turno; alvos do chamado
--   shift_call_targets               o proprio freela; quem opera o turno (SOS: so os aceitos)
--   shift_payments                   o proprio freela; quem opera o turno
--   team_connections                 o proprio freela; membro confirmado da empresa
--   shift_attendance_confirmations   o proprio freela; quem opera o turno
--   job_live_signals (nova)          quem opera o turno; freela com candidatura ou chamado nele
--
--   NAO publicada: jobs (SELECT USING(true): qualquer conta logada receberia ao vivo os turnos de
--   todas as empresas; no lugar vai job_live_signals, sem conteudo), workers/companies (PII),
--   service_terms (CPF e IP; o aceite acompanha shift_payments), company_members (hash de convite).
--
-- Avisos que faltavam (trigger SECURITY DEFINER, falha vira WARNING e nunca derruba o gesto):
--   aceite com nome e turno (claim_shift_slot, texto trocado no corpo do catalogo, com assercao);
--   aceite/recusa de convite direto (sem chamado); chegada e saida registradas pelo freela;
--   recebimento confirmado pelo freela; turno alterado (data/horario/local/valor) -> freelas.
--
-- DOWN:
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.applications, public.shift_calls,
--     public.shift_call_targets, public.shift_payments, public.team_connections,
--     public.shift_attendance_confirmations, public.job_live_signals;
--   DROP TRIGGER trg_zy_live_job_signal ON public.jobs;
--   DROP TRIGGER trg_zy_live_job_changed ON public.jobs;
--   DROP TRIGGER trg_zy_live_invite_answer ON public.applications;
--   DROP TRIGGER trg_zy_live_attendance ON public.applications;
--   DROP TRIGGER trg_zy_live_receipt_confirmed ON public.shift_payments;
--   DROP TRIGGER trg_zy_live_drop_client_accept ON public.notifications;
--   claim_shift_slot: replace inverso das duas expressoes internal_live_accept_*.
--   DROP FUNCTION public.live_job_signal(), public.live_notify_job_changed(),
--     public.live_notify_invite_answer(), public.live_notify_attendance(),
--     public.live_notify_receipt_confirmed(), public.live_drop_client_accept_notice(),
--     public.internal_live_accept_title(uuid), public.internal_live_accept_message(uuid, uuid),
--     public.internal_live_worker_name(uuid), public.internal_live_job_label(uuid),
--     public.internal_live_notify_company(uuid, text, text, text);
--   DROP TABLE public.job_live_signals;

BEGIN;

DO $$
BEGIN
    IF to_regprocedure('public.notification_recipients_for_job(uuid)') IS NULL
       OR to_regprocedure('public.is_job_owner(uuid)') IS NULL
       OR to_regprocedure('public.claim_shift_slot(uuid)') IS NULL THEN
        RAISE EXCEPTION 'PRE-CONDICAO tempo-real: funcao base ausente. HALT.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        RAISE EXCEPTION 'PRE-CONDICAO tempo-real: publicacao supabase_realtime ausente. HALT.';
    END IF;
END $$;

-- 1. Sinal de mudanca de turno: so ids e hora. Nenhum conteudo, nenhum dado pessoal.
CREATE TABLE IF NOT EXISTS public.job_live_signals (
    job_id     uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
    company_id uuid NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.job_live_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_live_signals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.job_live_signals TO authenticated;
GRANT ALL ON public.job_live_signals TO service_role;

DROP POLICY IF EXISTS jls_select_related ON public.job_live_signals;
CREATE POLICY jls_select_related ON public.job_live_signals FOR SELECT TO authenticated
USING (
    public.is_job_owner(job_id)
    OR EXISTS (SELECT 1 FROM public.applications a
                WHERE a.job_id = job_live_signals.job_id AND a.worker_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.shift_call_targets t
                 JOIN public.shift_calls c ON c.id = t.call_id
                WHERE c.job_id = job_live_signals.job_id AND t.worker_id = (SELECT auth.uid()))
);

CREATE OR REPLACE FUNCTION public.live_job_signal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    c_ruido constant text[] := ARRAY['views', 'candidates_count'];
BEGIN
    IF NEW.company_id IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF (pg_catalog.to_jsonb(NEW) - c_ruido) = (pg_catalog.to_jsonb(OLD) - c_ruido) THEN
            RETURN NEW;
        END IF;
    END IF;
    INSERT INTO public.job_live_signals (job_id, company_id, changed_at)
    VALUES (NEW.id, NEW.company_id, pg_catalog.clock_timestamp())
    ON CONFLICT (job_id) DO UPDATE SET company_id = EXCLUDED.company_id, changed_at = EXCLUDED.changed_at;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_job_signal: % %', SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_zy_live_job_signal ON public.jobs;
CREATE TRIGGER trg_zy_live_job_signal AFTER INSERT OR UPDATE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.live_job_signal();

-- 2. Helpers de texto e destinatarios (internos).
CREATE OR REPLACE FUNCTION public.internal_live_worker_name(p_worker_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT COALESCE((SELECT NULLIF(pg_catalog.left(pg_catalog.btrim(w.full_name), 80), '')
                       FROM public.workers w WHERE w.id = p_worker_id), 'Um freela');
$$;

-- "<titulo>" de DD/MM
CREATE OR REPLACE FUNCTION public.internal_live_job_label(p_job_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT COALESCE((SELECT '"' || COALESCE(pg_catalog.left(j.title, 120), 'sem título') || '"'
                        || COALESCE(' de ' || pg_catalog.to_char(
                               (j.start_date::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date, 'DD/MM'), '')
                       FROM public.jobs j WHERE j.id = p_job_id), '"sem título"');
$$;

CREATE OR REPLACE FUNCTION public.internal_live_accept_title(p_worker_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT public.internal_live_worker_name(p_worker_id) || ' aceitou o turno';
$$;

CREATE OR REPLACE FUNCTION public.internal_live_accept_message(p_worker_id uuid, p_job_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT public.internal_live_worker_name(p_worker_id) || ' aceitou o turno '
           || public.internal_live_job_label(p_job_id) || '.';
$$;

CREATE OR REPLACE FUNCTION public.internal_live_notify_company(p_job_id uuid, p_type text, p_title text, p_message text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    INSERT INTO public.notifications (user_id, type, title, message, link)
    SELECT r, p_type, p_title, p_message, '/company/jobs/' || p_job_id::text || '/candidates'
      FROM public.notification_recipients_for_job(p_job_id) AS r
     WHERE r IS NOT NULL;
$$;

-- 3. Aceite pelo chamado: o aviso ja existe (mesmos destinatarios); so passa a dizer quem e qual turno.
DO $$
DECLARE
    v_def   text := pg_catalog.pg_get_functiondef('public.claim_shift_slot(uuid)'::regprocedure);
    c_title constant text := '''Vaga preenchida no turno''';
    c_msg   constant text := '''Um freela aceitou o chamado e ocupou uma vaga do turno.''';
BEGIN
    IF pg_catalog.strpos(v_def, 'internal_live_accept_title') > 0 THEN
        RETURN;
    END IF;
    IF (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, c_title, ''))) <> pg_catalog.length(c_title)
       OR (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, c_msg, ''))) <> pg_catalog.length(c_msg) THEN
        RAISE EXCEPTION 'tempo-real: claim_shift_slot mudou no catalogo (texto do aviso nao encontrado 1x). HALT.';
    END IF;
    v_def := pg_catalog.replace(v_def, c_title, 'public.internal_live_accept_title(v_uid)');
    v_def := pg_catalog.replace(v_def, c_msg, 'public.internal_live_accept_message(v_uid, v_call.job_id)');
    EXECUTE v_def;
END $$;

-- 4. Convite direto (sem chamado) respondido pelo freela. No aceite pela RPC o alvo do chamado
--    ainda esta pendente neste instante, entao este trigger se cala (a RPC avisa).
CREATE OR REPLACE FUNCTION public.live_notify_invite_answer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF (SELECT auth.uid()) IS DISTINCT FROM NEW.worker_id THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM public.shift_call_targets t JOIN public.shift_calls c ON c.id = t.call_id
                WHERE c.job_id = NEW.job_id AND t.worker_id = NEW.worker_id AND t.response IS NULL) THEN
        RETURN NEW;
    END IF;
    IF NEW.status = 'hired' THEN
        PERFORM public.internal_live_notify_company(NEW.job_id, 'status_change',
            public.internal_live_accept_title(NEW.worker_id),
            public.internal_live_accept_message(NEW.worker_id, NEW.job_id));
    ELSE
        PERFORM public.internal_live_notify_company(NEW.job_id, 'status_change',
            public.internal_live_worker_name(NEW.worker_id) || ' não vai pegar o turno',
            public.internal_live_worker_name(NEW.worker_id) || ' recusou o convite para o turno '
                || public.internal_live_job_label(NEW.job_id) || '.');
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_notify_invite_answer: % %', SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_zy_live_invite_answer ON public.applications;
CREATE TRIGGER trg_zy_live_invite_answer AFTER UPDATE OF status ON public.applications
    FOR EACH ROW WHEN (OLD.status = 'invited' AND NEW.status IN ('hired', 'declined'))
    EXECUTE FUNCTION public.live_notify_invite_answer();

-- O client antigo (respondToInvite) insere "Freela aceitou o turno" so para o dono. O aviso agora
-- nasce no banco; o do client e descartado em silencio (o client nao le a linha de volta).
-- SECURITY INVOKER de proposito: current_user precisa ser o papel da sessao.
CREATE OR REPLACE FUNCTION public.live_drop_client_accept_notice()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF current_user = 'authenticated' THEN RETURN NULL; END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_zy_live_drop_client_accept ON public.notifications;
CREATE TRIGGER trg_zy_live_drop_client_accept BEFORE INSERT ON public.notifications
    FOR EACH ROW WHEN (NEW.title = 'Freela aceitou o turno' AND NEW.message = 'Um freela aceitou seu convite de turno.')
    EXECUTE FUNCTION public.live_drop_client_accept_notice();

-- 5. Chegada e saida registradas pelo FREELA (o carimbo da empresa nao gera aviso para ela mesma).
CREATE OR REPLACE FUNCTION public.live_notify_attendance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_name text;
BEGIN
    IF (SELECT auth.uid()) IS DISTINCT FROM NEW.worker_id THEN RETURN NEW; END IF;
    v_name := public.internal_live_worker_name(NEW.worker_id);
    IF OLD.worker_checkin_at IS NULL AND NEW.worker_checkin_at IS NOT NULL THEN
        PERFORM public.internal_live_notify_company(NEW.job_id, 'status_change',
            v_name || ' registrou a chegada',
            v_name || ' registrou a chegada no turno ' || public.internal_live_job_label(NEW.job_id) || '.');
    END IF;
    IF OLD.worker_checkout_at IS NULL AND NEW.worker_checkout_at IS NOT NULL THEN
        PERFORM public.internal_live_notify_company(NEW.job_id, 'status_change',
            v_name || ' registrou a saída',
            v_name || ' registrou a saída do turno ' || public.internal_live_job_label(NEW.job_id) || '.');
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_notify_attendance: % %', SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_zy_live_attendance ON public.applications;
CREATE TRIGGER trg_zy_live_attendance AFTER UPDATE OF worker_checkin_at, worker_checkout_at ON public.applications
    FOR EACH ROW EXECUTE FUNCTION public.live_notify_attendance();

-- 6. Freela confirmou que recebeu.
CREATE OR REPLACE FUNCTION public.live_notify_receipt_confirmed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_name text;
BEGIN
    IF (SELECT auth.uid()) IS DISTINCT FROM NEW.worker_id THEN RETURN NEW; END IF;
    v_name := public.internal_live_worker_name(NEW.worker_id);
    PERFORM public.internal_live_notify_company(NEW.job_id, 'payment',
        v_name || ' confirmou o recebimento',
        v_name || ' confirmou que recebeu o pagamento do turno ' || public.internal_live_job_label(NEW.job_id) || '.');
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_notify_receipt_confirmed: % %', SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_zy_live_receipt_confirmed ON public.shift_payments;
CREATE TRIGGER trg_zy_live_receipt_confirmed AFTER UPDATE OF worker_confirmed_at ON public.shift_payments
    FOR EACH ROW WHEN (OLD.worker_confirmed_at IS NULL AND NEW.worker_confirmed_at IS NOT NULL)
    EXECUTE FUNCTION public.live_notify_receipt_confirmed();

-- 7. Turno alterado: avisa quem foi convidado ou contratado (cancelamento ja tem aviso proprio).
CREATE OR REPLACE FUNCTION public.live_notify_job_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    INSERT INTO public.notifications (user_id, type, title, message, link)
    SELECT a.worker_id, 'status_change', 'Turno alterado',
           'A empresa alterou data, horário, local ou valor do turno '
               || public.internal_live_job_label(NEW.id) || '. Confira antes de ir.',
           '/my-jobs'
      FROM public.applications a
     WHERE a.job_id = NEW.id AND a.status IN ('invited', 'hired', 'in_progress');
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'live_notify_job_changed: % %', SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_zy_live_job_changed ON public.jobs;
CREATE TRIGGER trg_zy_live_job_changed AFTER UPDATE ON public.jobs
    FOR EACH ROW WHEN (
        NEW.status IS DISTINCT FROM 'deleted' AND OLD.status IS DISTINCT FROM 'deleted'
        AND (NEW.start_date IS DISTINCT FROM OLD.start_date
          OR NEW.work_start_time IS DISTINCT FROM OLD.work_start_time
          OR NEW.work_end_time IS DISTINCT FROM OLD.work_end_time
          OR NEW.location IS DISTINCT FROM OLD.location
          OR NEW.budget IS DISTINCT FROM OLD.budget))
    EXECUTE FUNCTION public.live_notify_job_changed();

REVOKE ALL ON FUNCTION public.live_job_signal(), public.live_notify_invite_answer(),
    public.live_drop_client_accept_notice(), public.live_notify_attendance(),
    public.live_notify_receipt_confirmed(), public.live_notify_job_changed(),
    public.internal_live_worker_name(uuid), public.internal_live_job_label(uuid),
    public.internal_live_accept_title(uuid), public.internal_live_accept_message(uuid, uuid),
    public.internal_live_notify_company(uuid, text, text, text)
    FROM PUBLIC, anon, authenticated;

-- 8. Publicacao (idempotente; tabela ausente derruba a migration).
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['applications', 'shift_calls', 'shift_call_targets', 'shift_payments',
                             'team_connections', 'shift_attendance_confirmations', 'job_live_signals']
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables
                        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
            IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
                     WHERE c.oid = pg_catalog.to_regclass('public.' || t)) THEN
                RAISE EXCEPTION 'tempo-real: % sem RLS, nao pode ser publicada. HALT.', t;
            END IF;
            EXECUTE pg_catalog.format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;

COMMIT;
