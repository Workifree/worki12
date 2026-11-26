-- Com os DOIS hardenings de applications aplicados: a sequencia REAL de escritas do app, com o papel
-- authenticated (o guard distingue por current_user), usando o relogio de verdade. Cada "--== passo" e
-- uma transacao propria, como no app (o guard grava now() nos carimbos do freela). Banco descartavel:
-- nada e desfeito. Como o teste dura milissegundos, o turno "comecou ha 3h" e a duracao minima e 0.
CREATE TABLE qa.h (w uuid, j uuid, a uuid, sp uuid);

--== passo: empresa publica o turno e convida; candidatura forjada e recusada
DO $t$
DECLARE
    c qa.ctx; w uuid; j uuid; a uuid;
    v_local timestamp := date_trunc('minute', (now() - interval '3 hours') AT TIME ZONE 'America/Sao_Paulo');
BEGIN
    c := qa.preparar('{"min_shift_minutes": 0}');
    w := qa.freela('real@pix.com');
    PERFORM qa.como(c.op);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.jobs (company_id, title, status, start_date, work_start_time, work_end_time)
    VALUES (c.co, 'Turno real', 'open', v_local AT TIME ZONE 'America/Sao_Paulo', v_local::time, (v_local + interval '4 hours')::time)
    RETURNING id INTO j;
    INSERT INTO public.applications (job_id, worker_id, status, invited_by_company_at) VALUES (j, w, 'invited', now()) RETURNING id INTO a;
    BEGIN
        INSERT INTO public.applications (job_id, worker_id, status, invited_by_company_at, worker_checkin_at)
        VALUES (j, gen_random_uuid(), 'invited', now(), now());
        RAISE EXCEPTION 'forja aceita';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
    UPDATE public.bonus_attributions SET job_created_at = now() - interval '6 hours' WHERE job_id = j;
    INSERT INTO qa.h VALUES (w, j, a, NULL);
END $t$;

--== passo: freela aceita o convite
DO $t$ DECLARE h qa.h; BEGIN
    SELECT * INTO h FROM qa.h; PERFORM qa.como(h.w); SET LOCAL ROLE authenticated;
    UPDATE public.applications SET status = 'hired', invitation_response = 'accepted', invitation_responded_at = now() WHERE id = h.a;
END $t$;

--== passo: freela faz check-in (MyJobs.handleCheckin; o guard impoe a hora do servidor)
DO $t$ DECLARE h qa.h; BEGIN
    SELECT * INTO h FROM qa.h; PERFORM qa.como(h.w); SET LOCAL ROLE authenticated;
    UPDATE public.applications SET worker_checkin_at = now() - interval '90 minutes', status = 'in_progress' WHERE id = h.a;
END $t$;

--== passo: empresa confirma a chegada (handleConfirmCheckin)
DO $t$ DECLARE h qa.h; c qa.ctx; BEGIN
    SELECT * INTO h FROM qa.h; SELECT * INTO c FROM qa.ctx; PERFORM qa.como(c.op); SET LOCAL ROLE authenticated;
    UPDATE public.applications SET company_checkin_confirmed_at = now(), status = 'in_progress' WHERE id = h.a;
END $t$;

--== passo: freela faz checkout (MyJobs.handleCheckout)
DO $t$ DECLARE h qa.h; BEGIN
    SELECT * INTO h FROM qa.h; PERFORM qa.como(h.w); SET LOCAL ROLE authenticated;
    UPDATE public.applications SET worker_checkout_at = now() WHERE id = h.a;
END $t$;

--== passo: empresa confirma a saida
DO $t$ DECLARE h qa.h; c qa.ctx; BEGIN
    SELECT * INTO h FROM qa.h; SELECT * INTO c FROM qa.ctx; PERFORM qa.como(c.op); SET LOCAL ROLE authenticated;
    UPDATE public.applications SET company_checkout_confirmed_at = now() WHERE id = h.a;
END $t$;

--== passo: empresa registra o pagamento e conclui o turno
DO $t$ DECLARE h qa.h; c qa.ctx; v uuid; BEGIN
    SELECT * INTO h FROM qa.h; SELECT * INTO c FROM qa.ctx; PERFORM qa.como(c.op); SET LOCAL ROLE authenticated;
    INSERT INTO public.shift_payments (job_id, worker_id, company_id, application_id, status, recorded_by)
    VALUES (h.j, h.w, c.co, h.a, 'recorded', c.op) RETURNING id INTO v;
    UPDATE public.applications SET status = 'completed' WHERE id = h.a;
    RESET ROLE;
    UPDATE qa.h SET sp = v;
END $t$;

--== passo: freela confirma o recibo (paymentRecordService.confirmReceiptByWorker)
DO $t$ DECLARE h qa.h; BEGIN
    SELECT * INTO h FROM qa.h; PERFORM qa.como(h.w); SET LOCAL ROLE authenticated;
    UPDATE public.shift_payments SET worker_confirmed_at = now() WHERE id = h.sp;
    RESET ROLE;
    PERFORM qa.ok((SELECT count(*) = 0 FROM public.bonus_shift_ledger), 'o recibo nao roda o motor');
    PERFORM qa.ok((SELECT count(*) = 4 FROM public.bonus_server_stamps WHERE subject_id = h.a), 'quatro carimbos do servidor');
END $t$;

--== passo: a operadora abre a tela; a leitura grava o livro e concede
DO $t$ DECLARE h qa.h; c qa.ctx; r jsonb; BEGIN
    SELECT * INTO h FROM qa.h; SELECT * INTO c FROM qa.ctx; PERFORM qa.como(c.op); SET LOCAL ROLE authenticated;
    r := public.bonus_get_my_trail();
    RESET ROLE;
    PERFORM qa.ok(qa.motivo(h.a) = 'contou', 'sequencia real: ' || COALESCE(qa.motivo(h.a), 'sem linha'));
    PERFORM qa.ok((qa.aw('first_complete')).id IS NOT NULL AND r->>'status' = 'active', 'marco do turno completo');
END $t$;

--== passo: guards habilitados saem das dependencias; desabilitado volta a bloquear
DO $t$ DECLARE c qa.ctx; r jsonb; BEGIN
    SELECT * INTO c FROM qa.ctx; PERFORM qa.como(NULL);
    r := public.admin_bonus_set_enabled(true, c.adm);
    PERFORM qa.ok(r->>'missing' !~ 'trg_zz', 'guards presentes: ' || r::text);
    ALTER TABLE public.applications DISABLE TRIGGER trg_zz_applications_update_guard;
    r := public.admin_bonus_set_enabled(true, c.adm);
    PERFORM qa.ok(r->>'missing' ~ 'trg_zz_applications_update_guard', 'tgenabled conferido');
END $t$;
