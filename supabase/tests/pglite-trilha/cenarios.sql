-- Cenarios da trilha de bonus (rodados por run.mjs). Blocos separados por "--== nome"; cada um roda
-- em transacao com ROLLBACK. Falha = RAISE EXCEPTION.
-- "Relogio simulado": os carimbos do servidor nascem com clock_timestamp(); um turno HONESTO e
-- simulado adiantando o carimbo para o instante declarado (qa.relogio), como dono do banco.
CREATE SCHEMA qa;

CREATE FUNCTION qa.como(p uuid) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', CASE WHEN p IS NULL THEN '' ELSE json_build_object('sub', p)::text END, true) $$;

CREATE FUNCTION qa.ok(p_cond boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS
$$ BEGIN IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'cenario: %', p_msg; END IF; END $$;

CREATE TABLE qa.ctx (co uuid, dono uuid, op uuid, adm uuid, enr uuid);

-- empresa + operador membro + inscricao aceita; p_params sobrepoe a trilha (rajada desligada por padrao,
-- porque no teste todos os recibos fecham no mesmo segundo)
CREATE FUNCTION qa.preparar(p_params jsonb DEFAULT '{}'::jsonb, p_cap integer DEFAULT NULL,
                            p_briefing text DEFAULT NULL) RETURNS qa.ctx
LANGUAGE plpgsql AS $$
DECLARE c qa.ctx; r jsonb;
BEGIN
    c.co := gen_random_uuid(); c.dono := gen_random_uuid(); c.op := gen_random_uuid(); c.adm := gen_random_uuid();
    UPDATE public.bonus_program_settings SET enabled = true WHERE id;
    INSERT INTO public.companies (id, owner_id, name, default_briefing) VALUES (c.co, c.dono, 'QA', p_briefing);
    INSERT INTO public.company_members (company_id, user_id, role, status) VALUES (c.co, c.op, 'manager', 'active');
    PERFORM qa.como(NULL);
    PERFORM public.admin_bonus_track_params_update('eventos', '{"burst_count": 50}'::jsonb || p_params, c.adm);
    IF p_cap IS NOT NULL THEN UPDATE public.bonus_tracks SET cap_cents = p_cap WHERE key = 'eventos'; END IF;
    r := public.admin_bonus_enrollment_create('eventos', c.op, c.co, 'Operadora QA', c.adm);
    PERFORM qa.ok(r->>'outcome' = 'ok', 'inscricao: ' || r::text);
    c.enr := (r->>'enrollment_id')::uuid;
    PERFORM public.admin_bonus_enrollment_ack(c.enr, 'Patrao', 'whatsapp', c.adm);
    PERFORM qa.como(c.op);
    r := public.bonus_accept_enrollment('operadora@pix.com');
    PERFORM qa.ok(r->>'outcome' = 'ok', 'aceite: ' || r::text);
    DELETE FROM qa.ctx; INSERT INTO qa.ctx VALUES (c.*);
    RETURN c;
END $$;

CREATE FUNCTION qa.freela(p_pix text DEFAULT NULL, p_fone text DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO public.workers (id, full_name, pix_key, phone) VALUES (gen_random_uuid(), 'Freela QA', p_pix, p_fone) RETURNING id $$;

-- proxima segunda-feira + n dias (datas futuras estaveis dentro da mesma semana)
CREATE FUNCTION qa.dia(n integer) RETURNS date LANGUAGE sql AS
$$ SELECT date_trunc('week', (now() AT TIME ZONE 'America/Sao_Paulo'))::date + 7 + n $$;

CREATE FUNCTION qa.turno(p_dia date, p_ini time DEFAULT '18:00', p_fim time DEFAULT '22:00') RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE c qa.ctx; v uuid;
BEGIN
    SELECT * INTO c FROM qa.ctx;
    PERFORM qa.como(c.op);
    INSERT INTO public.jobs (company_id, title, status, start_date, work_start_time, work_end_time, created_at)
    VALUES (c.co, 'Turno QA', 'open', (p_dia + p_ini) AT TIME ZONE 'America/Sao_Paulo', p_ini, p_fim, now() - interval '30 days')
    RETURNING id INTO v;
    RETURN v;
END $$;

CREATE FUNCTION qa.relogio(p_subject uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    ALTER TABLE public.bonus_server_stamps DISABLE TRIGGER trg_bonus_stamps_append_only;
    UPDATE public.bonus_server_stamps SET stamped_at = declared_at WHERE subject_id = p_subject AND declared_at IS NOT NULL;
    ALTER TABLE public.bonus_server_stamps ENABLE TRIGGER trg_bonus_stamps_append_only;
END $$;

-- turno honesto completo: quatro carimbos pelos atores certos + recibo dos dois lados.
-- p_ci/p_co = horarios reais (timestamptz); NULL = os do turno.
CREATE FUNCTION qa.executar(p_job uuid, p_w uuid, p_ci timestamptz DEFAULT NULL, p_co timestamptz DEFAULT NULL,
                            p_confirmar boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE c qa.ctx; j record; a uuid; sp uuid; v_ci timestamptz; v_co timestamptz;
BEGIN
    SELECT * INTO c FROM qa.ctx;
    SELECT * INTO j FROM public.jobs WHERE id = p_job;
    v_ci := COALESCE(p_ci, j.start_date);
    v_co := COALESCE(p_co, v_ci + CASE WHEN j.work_end_time > j.work_start_time THEN j.work_end_time - j.work_start_time
                                       ELSE interval '24 hours' - (j.work_start_time - j.work_end_time) END);
    PERFORM qa.como(c.op);
    INSERT INTO public.applications (job_id, worker_id, status) VALUES (p_job, p_w, 'hired') RETURNING id INTO a;
    PERFORM qa.como(p_w);  UPDATE public.applications SET worker_checkin_at = v_ci WHERE id = a;
    PERFORM qa.como(c.op); UPDATE public.applications SET company_checkin_confirmed_at = v_ci + interval '3 minutes' WHERE id = a;
    PERFORM qa.como(p_w);  UPDATE public.applications SET worker_checkout_at = v_co WHERE id = a;
    PERFORM qa.como(c.op); UPDATE public.applications SET company_checkout_confirmed_at = v_co + interval '3 minutes', status = 'completed' WHERE id = a;
    PERFORM qa.relogio(a);
    INSERT INTO public.shift_payments (job_id, worker_id, company_id, application_id, status, recorded_by)
    VALUES (p_job, p_w, c.co, a, 'recorded', c.op) RETURNING id INTO sp;
    IF p_confirmar THEN
        PERFORM qa.como(p_w); UPDATE public.shift_payments SET worker_confirmed_at = clock_timestamp() WHERE id = sp;
        PERFORM public.bonus_evaluate_enrollment(c.enr);     -- a LEITURA (C4): o gancho so carimba
    END IF;
    PERFORM qa.como(c.op);
    RETURN a;
END $$;

CREATE FUNCTION qa.motivo(p_app uuid) RETURNS text LANGUAGE sql AS
$$ SELECT COALESCE(exclusion_reason, 'contou') FROM public.bonus_shift_ledger WHERE application_id = p_app $$;
CREATE FUNCTION qa.flags(p_app uuid) RETURNS text[] LANGUAGE sql AS
$$ SELECT flags FROM public.bonus_shift_ledger WHERE application_id = p_app $$;
CREATE FUNCTION qa.aw(p_key text, p_tier integer DEFAULT 1) RETURNS public.bonus_awards LANGUAGE sql AS $$
    SELECT a.* FROM public.bonus_awards a JOIN public.bonus_milestones m ON m.id = a.milestone_id, qa.ctx c
     WHERE a.enrollment_id = c.enr AND m.key = p_key AND a.tier = p_tier $$;
CREATE FUNCTION qa.disponivel_agora() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"validation_hours": 0}'::jsonb $$;
-- simula o corte ja passado (scheduled_for e imutavel pelo guard)
CREATE FUNCTION qa.vencer_pedido(p uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    ALTER TABLE public.bonus_payouts DISABLE TRIGGER trg_bonus_payouts_guard;
    UPDATE public.bonus_payouts SET scheduled_for = current_date - 7 WHERE id = p;
    ALTER TABLE public.bonus_payouts ENABLE TRIGGER trg_bonus_payouts_guard;
END $$;

--== aceite: 2 awards, idempotente, contador de 19, ligar bloqueado por dependencias
DO $t$
DECLARE c qa.ctx; r jsonb;
BEGIN
    c := qa.preparar();
    PERFORM public.bonus_evaluate_enrollment(c.enr);
    PERFORM public.bonus_evaluate_enrollment(c.enr);
    PERFORM qa.ok((SELECT count(*) = 2 AND sum(amount_cents) = 1000 FROM public.bonus_awards WHERE enrollment_id = c.enr), 'A3/A19');
    r := public.bonus_get_my_trail();
    PERFORM qa.ok((r->>'total_milestones')::int = 19 AND (r->>'done_milestones')::int = 2, '2 de 19: ' || (r->>'done_milestones'));
    PERFORM qa.como(NULL);
    r := public.admin_bonus_set_enabled(true, c.adm);
    PERFORM qa.ok(r->>'outcome' = 'dependencies_missing' AND r->>'missing' ~ 'E2' AND r->>'missing' !~ 'LGPD'
        AND r->>'missing' ~ 'trg_zz_applications_insert_guard' AND r->>'missing' ~ 'trg_zz_applications_update_guard',
        'dependencias: ' || r::text);
END $t$;

--== tres ganchos: criador do turno, briefing e recibo; dono/concierge e programa desligado nao geram
DO $t$
DECLARE c qa.ctx; w uuid; j uuid; a uuid;
BEGIN
    c := qa.preparar();
    PERFORM qa.como(c.dono);
    INSERT INTO public.jobs (company_id, status, start_date) VALUES (c.co, 'open', now() + interval '2 days');
    UPDATE public.companies SET default_briefing = 'texto curto' WHERE id = c.co;
    PERFORM qa.como(NULL);
    INSERT INTO public.jobs (company_id, status, start_date) VALUES (c.co, 'open', now() + interval '2 days');
    PERFORM qa.ok((SELECT count(*) = 0 FROM public.bonus_attributions) AND (SELECT count(*) = 0 FROM public.bonus_events), 'A6 dono/servico');
    UPDATE public.companies SET default_briefing = '' WHERE id = c.co;
    PERFORM qa.como(c.op);
    UPDATE public.companies SET default_briefing = 'calça jeans e camisa branca passada' WHERE id = c.co;
    j := qa.turno(qa.dia(0));
    PERFORM qa.ok((SELECT job_created_at > now() - interval '1 minute' FROM public.bonus_attributions WHERE job_id = j), 'A1-d: created_at forjado ignorado');
    w := qa.freela();
    a := qa.executar(j, w);
    PERFORM qa.ok(qa.motivo(a) = 'contou', 'gancho do recibo: ' || COALESCE(qa.motivo(a), 'sem linha'));
    PERFORM qa.ok((qa.aw('briefing')).id IS NOT NULL AND (qa.aw('first_job')).id IS NOT NULL AND (qa.aw('first_complete')).id IS NOT NULL
        AND (qa.aw('first_fast_receipt')).id IS NOT NULL, 'marcos pelos ganchos');
    UPDATE public.bonus_program_settings SET enabled = false WHERE id;
    j := qa.turno(qa.dia(1));
    PERFORM qa.ok(NOT EXISTS (SELECT 1 FROM public.bonus_attributions WHERE job_id = j), 'desligado nao captura');
END $t$;

--== identidade: dono, vetado, organizacao e operador removido
DO $t$
DECLARE c qa.ctx; r jsonb; a uuid; v_org uuid := gen_random_uuid(); u uuid := gen_random_uuid(); j uuid; n int;
BEGIN
    c := qa.preparar();
    PERFORM qa.como(NULL);
    r := public.admin_bonus_enrollment_create('eventos', c.dono, c.co, 'Dono', c.adm);
    PERFORM qa.ok(r->>'outcome' = 'identity_required', 'dono: ' || r::text);
    INSERT INTO public.company_members (company_id, user_id, role, status) VALUES (c.co, u, 'manager', 'active');
    PERFORM public.admin_bonus_veto_add(u, 'socio', c.adm);
    PERFORM qa.ok(public.admin_bonus_enrollment_create('eventos', u, c.co, 'V', c.adm)->>'outcome' = 'identity_required', 'vetado');
    PERFORM public.admin_bonus_veto_remove(u, c.adm);
    UPDATE public.companies SET organization_id = v_org WHERE id = c.co;
    INSERT INTO public.organization_members (organization_id, user_id, role, status) VALUES (v_org, u, 'operator', 'active');
    PERFORM qa.ok(public.admin_bonus_enrollment_create('eventos', u, c.co, 'O', c.adm)->>'outcome' = 'identity_required', 'organizacao');
    PERFORM qa.ok(public.admin_bonus_enrollment_create('lojas', u, c.co, 'L', c.adm)->>'outcome' = 'track_not_open', 'lojas');
    j := qa.turno(qa.dia(0));
    UPDATE public.company_members SET status = 'removed' WHERE company_id = c.co AND user_id = c.op;
    SELECT count(*) INTO n FROM public.bonus_awards;
    a := qa.executar(j, qa.freela());
    PERFORM qa.ok(qa.motivo(a) = 'operator_not_member', '#13: ' || qa.motivo(a));
    PERFORM qa.ok((SELECT count(*) = n FROM public.bonus_awards), '#13 removido nao acumula marco');
END $t$;

--== AF1: vetado, mesma pessoa, mesmo PIX do operador, PIX de vetado (silencioso)
DO $t$
DECLARE c qa.ctx; vet uuid; w uuid; a uuid; r jsonb;
BEGIN
    c := qa.preparar();
    vet := qa.freela('socio@pix.com');
    PERFORM public.admin_bonus_veto_add(vet, 'socio', c.adm);
    a := qa.executar(qa.turno(qa.dia(0)), vet);                      PERFORM qa.ok(qa.motivo(a) = 'vetoed_worker', 'veto');
    a := qa.executar(qa.turno(qa.dia(1)), qa.freela(' OPERADORA@pix.com '));
    PERFORM qa.ok(qa.motivo(a) = 'same_identity', 'mesmo pix');
    a := qa.executar(qa.turno(qa.dia(2)), qa.freela('Socio@Pix.com')); PERFORM qa.ok(qa.motivo(a) = 'vetoed_worker', 'pix de vetado');
    INSERT INTO public.workers (id, full_name) VALUES (c.op, 'ela mesma');
    PERFORM qa.ok(public.bonus_worker_exclusion(c.enr, c.op) = 'same_identity', 'mesma pessoa');
    PERFORM qa.como(c.op);
    r := public.bonus_get_my_trail();
    PERFORM qa.ok(r::text !~ '(vetoed|same_identity|exclusion|flags|payout_block)', 'AF7 payload');
    PERFORM qa.ok((SELECT count(*) = 0 FROM public.bonus_shift_ledger WHERE counted), 'nada contou');
END $t$;

--== AF2: tolerancias, duracao do servidor, antecedencia, divergencia de relogio, antes do inicio
DO $t$
DECLARE c qa.ctx; j uuid; a uuid; s timestamptz; w uuid;
BEGIN
    c := qa.preparar();
    j := qa.turno(qa.dia(0)); SELECT start_date INTO s FROM public.jobs WHERE id = j;
    a := qa.executar(j, qa.freela(), s - interval '5 hours', s + interval '4 hours');
    PERFORM qa.ok(qa.motivo(a) = 'implausible_times', 'fora da tolerancia: ' || qa.motivo(a));
    j := qa.turno(qa.dia(1)); SELECT start_date INTO s FROM public.jobs WHERE id = j;
    a := qa.executar(j, qa.freela(), s - interval '2 hours', s + interval '4 hours');
    PERFORM qa.ok(qa.motivo(a) = 'contou', 'dentro da tolerancia: ' || qa.motivo(a));
    j := qa.turno(qa.dia(2)); SELECT start_date INTO s FROM public.jobs WHERE id = j;
    a := qa.executar(j, qa.freela(), s, s + interval '40 minutes');
    PERFORM qa.ok(qa.motivo(a) = 'short_duration', 'curto: ' || qa.motivo(a));
    j := qa.turno(qa.dia(3)); SELECT start_date INTO s FROM public.jobs WHERE id = j;
    a := qa.executar(j, qa.freela(), s - interval '170 minutes', s);
    PERFORM qa.ok(qa.motivo(a) = 'implausible_times', 'check-out no/antes do inicio nunca conta: ' || qa.motivo(a));
    -- antecedencia: turno que comeca em 30 minutos
    j := qa.turno((now() AT TIME ZONE 'America/Sao_Paulo')::date + 1);
    UPDATE public.jobs SET start_date = now() + interval '30 minutes',
        work_start_time = ((now() + interval '30 minutes') AT TIME ZONE 'America/Sao_Paulo')::time,
        work_end_time = ((now() + interval '270 minutes') AT TIME ZONE 'America/Sao_Paulo')::time WHERE id = j;
    UPDATE public.jobs SET start_date = ((((start_date AT TIME ZONE 'America/Sao_Paulo')::date) + work_start_time) AT TIME ZONE 'America/Sao_Paulo') WHERE id = j;
    a := qa.executar(j, qa.freela());
    PERFORM qa.ok(qa.motivo(a) = 'no_lead_time', 'antecedencia: ' || qa.motivo(a));
END $t$;

--== turno cruzando a meia-noite conta
DO $t$
DECLARE c qa.ctx; a uuid; d date;
BEGIN
    c := qa.preparar();
    d := qa.dia(4);
    a := qa.executar(qa.turno(d, '22:00', '03:00'), qa.freela());
    PERFORM qa.ok(qa.motivo(a) = 'contou', 'meia-noite: ' || qa.motivo(a));
    PERFORM qa.ok((SELECT shift_date = d AND duration_minutes = 300 FROM public.bonus_shift_ledger WHERE application_id = a), 'data e duracao');
END $t$;

--== AF3: tetos por dia, por semana e por freela na semana
DO $t$
DECLARE c qa.ctx; a uuid; w uuid;
BEGIN
    c := qa.preparar('{"max_counted_per_day": 2, "max_counted_per_week": 4}');
    w := qa.freela();
    a := qa.executar(qa.turno(qa.dia(0), '08:00', '12:00'), w);              PERFORM qa.ok(qa.motivo(a) = 'contou', '1');
    a := qa.executar(qa.turno(qa.dia(0), '13:00', '17:00'), qa.freela());    PERFORM qa.ok(qa.motivo(a) = 'contou', '2');
    a := qa.executar(qa.turno(qa.dia(0), '18:00', '22:00'), qa.freela());    PERFORM qa.ok(qa.motivo(a) = 'day_cap', 'dia: ' || qa.motivo(a));
    a := qa.executar(qa.turno(qa.dia(1), '09:00', '14:00'), w);              PERFORM qa.ok(qa.motivo(a) = 'contou', '2o do freela');
    a := qa.executar(qa.turno(qa.dia(2), '10:00', '15:00'), w);              PERFORM qa.ok(qa.motivo(a) = 'worker_week_cap', '3o do freela: ' || qa.motivo(a));
    a := qa.executar(qa.turno(qa.dia(2), '16:00', '20:00'), qa.freela());    PERFORM qa.ok(qa.motivo(a) = 'contou', '4');
    a := qa.executar(qa.turno(qa.dia(3)), qa.freela());                      PERFORM qa.ok(qa.motivo(a) = 'week_cap', 'semana: ' || qa.motivo(a));
    a := qa.executar(qa.turno(qa.dia(7)), w);                                PERFORM qa.ok(qa.motivo(a) = 'contou', 'semana seguinte volta');
    BEGIN
        PERFORM public.admin_bonus_track_params_update('eventos', '{"max_per_worker_week": 3}', c.adm);
        RAISE EXCEPTION 'aceitou 3';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
END $t$;

--== AF4: rajada, freela unico, padrao repetido, PIX e telefone compartilhados, agenda alterada, stuck desligada
DO $t$
DECLARE c qa.ctx; a uuid; w uuid; j uuid;
BEGIN
    c := qa.preparar('{"single_worker_min_shifts": 2, "single_worker_pct": 60, "pattern_count": 2}');
    w := qa.freela();
    a := qa.executar(qa.turno(qa.dia(0)), w);   PERFORM qa.ok(cardinality(qa.flags(a)) = 0, '1o sem flag');
    a := qa.executar(qa.turno(qa.dia(7)), w);
    PERFORM qa.ok(qa.flags(a) @> ARRAY['single_worker', 'repeat_pattern'], 'unico/padrao: ' || qa.flags(a)::text);
    a := qa.executar(qa.turno(qa.dia(8), '09:00', '13:00'), qa.freela('dup@pix.com', '11 97777-0000'));
    a := qa.executar(qa.turno(qa.dia(9), '10:00', '15:00'), qa.freela('DUP@pix.com', '+55 (11) 97777-0000'));
    PERFORM qa.ok(qa.flags(a) @> ARRAY['shared_pix', 'shared_phone'], 'compartilhados: ' || qa.flags(a)::text);
    j := qa.turno(qa.dia(10), '11:00', '15:00');
    UPDATE public.jobs SET work_start_time = '12:00', work_end_time = '16:00', start_date = start_date + interval '1 hour' WHERE id = j;
    a := qa.executar(j, qa.freela());
    PERFORM qa.ok('schedule_changed' = ANY (qa.flags(a)), 'agenda alterada');
    PERFORM qa.ok(NOT EXISTS (SELECT 1 FROM public.bonus_shift_ledger WHERE 'stuck_times' = ANY (flags)), 'stuck desligada por padrao');
    PERFORM qa.ok((SELECT count(*) > 0 FROM public.bonus_awards x WHERE public.bonus_award_phase(x.state, x.available_at, x.evidence) = 'in_review'), 'marco em conferencia');
END $t$;

--== AF4: rajada e stuck_times quando ligada
DO $t$
DECLARE c qa.ctx; a uuid; j uuid;
BEGIN
    c := qa.preparar('{"burst_count": 3, "stuck_times_enabled": 1, "stuck_minutes": 240}');
    a := qa.executar(qa.turno(qa.dia(0), '18:00', '21:00'), qa.freela());
    PERFORM qa.ok('stuck_times' = ANY (qa.flags(a)), 'stuck ligada');
    a := qa.executar(qa.turno(qa.dia(1)), qa.freela());
    a := qa.executar(qa.turno(qa.dia(2)), qa.freela());
    PERFORM qa.ok('burst' = ANY (qa.flags(a)), 'rajada: ' || qa.flags(a)::text);
END $t$;

--== M5 + estorno dentro da janela (M2) + C5 + reconquista + pendencias com carimbo que falta
DO $t$
DECLARE c qa.ctx; a1 uuid; a2 uuid; r jsonb; l uuid; w uuid; j uuid; ap uuid;
BEGIN
    c := qa.preparar();
    a1 := qa.executar(qa.turno(qa.dia(0)), qa.freela());
    PERFORM qa.como(c.op);
    UPDATE public.shift_payments SET status = 'voided' WHERE application_id = a1;
    PERFORM qa.ok(NOT ('voided_after' = ANY (qa.flags(a1))), 'o gancho nao sinaliza: so carimba');
    r := public.bonus_get_my_trail();
    PERFORM qa.ok('voided_after' = ANY (qa.flags(a1)), 'voided_after na leitura');
    PERFORM qa.ok(r::text !~ 'in_review' AND NOT (r ? 'in_review_cents') AND NOT (r ? 'finalizing'), 'M5 chaves');
    PERFORM qa.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'milestones') m WHERE m->>'award_state' = 'validating'
        AND (m->>'available_at' IS NULL OR m->>'release_text' IS NOT NULL)) AND r->>'release_text' IS NULL,
        'LOW-8: dentro da janela, conferencia identica a janela normal');
    SELECT id INTO l FROM public.bonus_shift_ledger WHERE application_id = a1;
    PERFORM qa.como(NULL);
    PERFORM public.admin_bonus_decide_shift(l, 'not_count', c.adm, NULL);
    PERFORM qa.ok((qa.aw('first_complete')).state = 'not_counted', 'sem outra base cai');
    a2 := qa.executar(qa.turno(qa.dia(1)), qa.freela());
    PERFORM qa.ok((qa.aw('first_complete')).state = 'earned', 'reconquista');
    -- pendencia: turno ja comecado, so com o check-in do freela
    j := qa.turno(qa.dia(2));
    UPDATE public.jobs SET start_date = now() - interval '1 hour' WHERE id = j;
    w := qa.freela();
    INSERT INTO public.applications (job_id, worker_id, status, worker_checkin_at) VALUES (j, w, 'hired', now()) RETURNING id INTO ap;
    PERFORM qa.como(c.op);
    r := public.bonus_get_my_trail();
    PERFORM qa.ok(r->'pending_shifts'->0->'missing_stamps' = '["worker_checkout","company_checkin","company_checkout","payment_record","receipt_confirmation"]'::jsonb,
        'pending_shifts: ' || (r->'pending_shifts')::text);
END $t$;

--== C5 com evidencia reescrita e B2: recibo estornado fora de conquistas futuras
DO $t$
DECLARE c qa.ctx; a1 uuid; a2 uuid; a3 uuid; l uuid; x public.bonus_awards;
BEGIN
    c := qa.preparar();
    a1 := qa.executar(qa.turno(qa.dia(0)), qa.freela());
    a2 := qa.executar(qa.turno(qa.dia(1)), qa.freela());
    SELECT id INTO l FROM public.bonus_shift_ledger WHERE application_id = a1;
    UPDATE public.bonus_shift_ledger SET flags = ARRAY['burst'], review = 'open', flagged_at = now(), review_due_at = now() + interval '48 hours' WHERE id = l;
    PERFORM public.admin_bonus_decide_shift(l, 'not_count', c.adm, 'qa');
    x := qa.aw('first_complete');
    PERFORM qa.ok(x.state = 'earned' AND NOT (x.evidence->'ledger_ids' @> jsonb_build_array(l::text)), 'evidencia reescrita');
    -- estorno FORA da janela: sem flag, mas nao sustenta marco novo (B2)
    ALTER TABLE public.bonus_shift_ledger DISABLE TRIGGER trg_bonus_ledger_guard;
    UPDATE public.bonus_shift_ledger SET completed_at = now() - interval '10 days' WHERE application_id = a2;
    ALTER TABLE public.bonus_shift_ledger ENABLE TRIGGER trg_bonus_ledger_guard;
    UPDATE public.shift_payments SET status = 'voided' WHERE application_id = a2;
    PERFORM public.bonus_evaluate_enrollment(c.enr);
    PERFORM public.bonus_evaluate_enrollment(c.enr);
    PERFORM qa.ok((SELECT review = 'none' FROM public.bonus_shift_ledger WHERE application_id = a2), 'fora da janela nao sinaliza');
    PERFORM qa.ok((SELECT count(*) = 1 FROM public.bonus_admin_log WHERE action = 'alert_voided_late'), 'LOW-1: alerta unico de estorno tardio');
    a3 := qa.executar(qa.turno(qa.dia(2)), qa.freela());
    a1 := qa.executar(qa.turno(qa.dia(3)), qa.freela());
    PERFORM qa.ok((qa.aw('shifts_3')).id IS NULL, 'B2: estornado nao conta para 3 turnos');
END $t$;

--== B1: um (turno, freela) so entra uma vez no livro
DO $t$
DECLARE c qa.ctx; a uuid;
BEGIN
    c := qa.preparar();
    a := qa.executar(qa.turno(qa.dia(0)), qa.freela());
    BEGIN
        INSERT INTO public.bonus_shift_ledger (enrollment_id, application_id, job_id, worker_id, job_created_at, shift_date,
            checkout_at, completed_at, receipt_fast, counted)
        SELECT enrollment_id, gen_random_uuid(), job_id, worker_id, job_created_at, shift_date, checkout_at, completed_at, true, true
          FROM public.bonus_shift_ledger WHERE application_id = a;
        RAISE EXCEPTION 'duplicou';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
END $t$;

--== colecao completa + convites diretos + chamado preenchido + velocidade (teto R$300 respeitado)
DO $t$
DECLARE c qa.ctx; w uuid[] := '{}'; v uuid; i int; call uuid; r jsonb; tc uuid; s int;
BEGIN
    c := qa.preparar();
    UPDATE public.companies SET default_briefing = 'calça jeans e camisa branca passada' WHERE id = c.co;
    PERFORM qa.como(c.op);
    -- 5 convites por LINK (invited_by NULL) nao contam
    FOR i IN 1..5 LOOP
        v := qa.freela(); PERFORM qa.como(v);
        INSERT INTO public.team_connections (company_id, worker_id, status, source, invited_by) VALUES (c.co, v, 'accepted', 'link', NULL);
    END LOOP;
    PERFORM public.bonus_evaluate_enrollment(c.enr);
    PERFORM qa.ok((qa.aw('invite_5')).id IS NULL AND (qa.aw('elenco_accepted_3')).id IS NULL, 'link nao conta');
    FOR i IN 1..5 LOOP
        v := qa.freela(); w := array_append(w, v);
        PERFORM qa.como(c.op);
        INSERT INTO public.team_connections (company_id, worker_id, status, source, invited_by) VALUES (c.co, v, 'pending', 'phone', c.op) RETURNING id INTO tc;
        -- aceite escrito pela EMPRESA nao vale; o do proprio freela vale
        IF i <= 3 THEN PERFORM qa.como(v); UPDATE public.team_connections SET status = 'accepted' WHERE id = tc; END IF;
    END LOOP;
    PERFORM public.bonus_evaluate_enrollment(c.enr);
    PERFORM qa.ok((qa.aw('invite_5')).id IS NOT NULL AND (qa.aw('elenco_accepted_3')).id IS NOT NULL, 'marcos 4 e 6');
    PERFORM qa.executar(qa.turno(qa.dia(0)), w[1]);
    PERFORM qa.executar(qa.turno(qa.dia(1), '09:00', '13:00'), w[1]);
    PERFORM qa.executar(qa.turno(qa.dia(2)), w[2]);
    PERFORM qa.como(c.op);
    INSERT INTO public.shift_calls (company_id, created_by, status) VALUES (c.co, c.op, 'open') RETURNING id INTO call;
    PERFORM qa.como(w[3]);
    INSERT INTO public.shift_call_targets VALUES (call, w[3], 'accepted');
    UPDATE public.shift_calls SET status = 'filled', first_claim_at = now() WHERE id = call;
    PERFORM public.bonus_evaluate_enrollment(c.enr);
    PERFORM qa.ok((qa.aw('first_call_filled')).id IS NOT NULL, 'chamado preenchido');
    PERFORM qa.ok((qa.aw('repeat_worker')).id IS NOT NULL AND (qa.aw('collection')).id IS NOT NULL, 'colecao');
    PERFORM qa.ok((qa.aw('velocity', 1)).id IS NOT NULL, 'velocidade tier 1');
    PERFORM qa.executar(qa.turno(qa.dia(3)), w[4]);
    PERFORM qa.executar(qa.turno(qa.dia(7)), w[5]);
    SELECT sum(a.amount_cents) INTO s FROM public.bonus_awards a JOIN public.bonus_milestones m ON m.id = a.milestone_id WHERE m.key = 'velocity';
    PERFORM qa.ok(s = 2500, 'tier 2 paga a diferenca: ' || s);
    SELECT sum(amount_cents) INTO s FROM public.bonus_awards WHERE state <> 'not_counted';
    PERFORM qa.ok(s <= 30000, 'teto');
END $t$;

--== constancia: avaliada so depois de ends_at, sem lacuna maior que o limite
DO $t$
DECLARE c qa.ctx; i int; j uuid; d date; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
    c := qa.preparar();
    ALTER TABLE public.bonus_enrollments DISABLE TRIGGER trg_bonus_enrollments_guard;
    UPDATE public.bonus_enrollments SET starts_at = now() - interval '70 days' WHERE id = c.enr;
    FOR i IN 1..6 LOOP
        d := hoje - (50 - i * 8);                       -- um turno a cada 8 dias, ultimo ha 2 dias
        j := qa.turno(d);
        UPDATE public.bonus_attributions SET job_created_at = now() - interval '60 days' WHERE job_id = j;
        PERFORM qa.executar(j, qa.freela());
    END LOOP;
    PERFORM qa.ok((SELECT count(*) = 6 FROM public.bonus_shift_ledger WHERE counted), 'seis contaveis: ' ||
        (SELECT string_agg(COALESCE(exclusion_reason, 'ok'), ',') FROM public.bonus_shift_ledger));
    PERFORM qa.ok((qa.aw('constancy')).id IS NULL, 'antes de ends_at nao concede');
    UPDATE public.bonus_enrollments SET ends_at = now() - interval '1 hour' WHERE id = c.enr;
    ALTER TABLE public.bonus_enrollments ENABLE TRIGGER trg_bonus_enrollments_guard;
    PERFORM public.bonus_evaluate_enrollment(c.enr);
    PERFORM qa.ok((qa.aw('constancy')).id IS NOT NULL, 'constancia');
END $t$;

--== teto pelo caminho REAL (trilha com teto baixo): avaliacao nao quebra e nunca passa do teto
DO $t$
DECLARE c qa.ctx; a uuid; s int;
BEGIN
    c := qa.preparar('{}', 3000);
    a := qa.executar(qa.turno(qa.dia(0)), qa.freela());
    PERFORM public.bonus_evaluate_enrollment(c.enr);
    PERFORM public.bonus_evaluate_enrollment(c.enr);
    SELECT sum(amount_cents) INTO s FROM public.bonus_awards WHERE enrollment_id = c.enr;
    PERFORM qa.ok(qa.motivo(a) = 'contou' AND s <= 3000 AND s > 1000, 'teto real: ' || s);
END $t$;

--== ATAQUE A1: freela fantasma no dia 1 (carimbos escritos de uma vez)
DO $t$
DECLARE c qa.ctx; fantasma uuid; j uuid; a uuid; sp uuid; s timestamptz; v int; caso int; ci timestamptz; co timestamptz; ator uuid;
BEGIN
    c := qa.preparar(qa.disponivel_agora());
    FOR caso IN 1..4 LOOP
        fantasma := qa.freela();
        j := qa.turno(qa.dia(caso)); SELECT start_date INTO s FROM public.jobs WHERE id = j;
        ci := s; co := s + interval '4 hours';
        IF caso = 3 THEN ci := now() - interval '4 hours'; co := now(); END IF;       -- declara "agora"
        PERFORM qa.como(c.op);
        -- INSERT ja preenchido (casos 1, 2, 3) numa tacada so
        INSERT INTO public.applications (job_id, worker_id, status, worker_checkin_at, worker_checkout_at,
            company_checkin_confirmed_at, company_checkout_confirmed_at)
        VALUES (j, fantasma, 'completed', ci, co, ci, co) RETURNING id INTO a;
        INSERT INTO public.shift_payments (job_id, worker_id, company_id, application_id, status, recorded_by)
        VALUES (j, fantasma, c.co, a, 'recorded', c.op) RETURNING id INTO sp;
        ator := CASE WHEN caso = 1 THEN c.op ELSE fantasma END;                      -- 1: operadora forja o recibo
        PERFORM qa.como(ator);
        IF caso = 4 THEN                                                              -- conluio: sessoes certas, tempo falso
            PERFORM qa.como(c.op); DELETE FROM public.shift_payments WHERE id = sp; DELETE FROM public.applications WHERE id = a;
            INSERT INTO public.applications (job_id, worker_id, status) VALUES (j, fantasma, 'hired') RETURNING id INTO a;
            PERFORM qa.como(fantasma); UPDATE public.applications SET worker_checkin_at = ci, worker_checkout_at = co WHERE id = a;
            PERFORM qa.como(c.op); UPDATE public.applications SET company_checkin_confirmed_at = ci, company_checkout_confirmed_at = co, status = 'completed' WHERE id = a;
            INSERT INTO public.shift_payments (job_id, worker_id, company_id, application_id, status, recorded_by)
            VALUES (j, fantasma, c.co, a, 'recorded', c.op) RETURNING id INTO sp;
            PERFORM qa.como(fantasma);
        END IF;
        UPDATE public.shift_payments SET worker_confirmed_at = now() WHERE id = sp;
        PERFORM public.bonus_evaluate_enrollment(c.enr);
        PERFORM qa.ok(qa.motivo(a) IS NOT NULL AND qa.motivo(a) <> 'contou', 'A1 caso ' || caso || ': ' || COALESCE(qa.motivo(a), 'sem linha'));
        RAISE NOTICE 'A1 caso %: %', caso, qa.motivo(a);
    END LOOP;
    PERFORM qa.como(c.op);
    PERFORM public.bonus_evaluate_enrollment(c.enr);
    SELECT sum(amount_cents) INTO v FROM public.bonus_awards WHERE enrollment_id = c.enr;
    PERFORM qa.ok(v <= 2000, 'A1: fantasma rendeu ' || v || ' centavos');            -- aceite + "1o turno publicado"
    PERFORM qa.ok((SELECT count(*) = 0 FROM public.bonus_shift_ledger WHERE counted), 'A1 livro');
    -- o cliente nao escreve no relogio
    PERFORM qa.ok(NOT has_table_privilege('authenticated', 'public.bonus_server_stamps', 'INSERT')
        AND NOT has_table_privilege('service_role', 'public.bonus_server_stamps', 'UPDATE'), 'A1 grants');
END $t$;

--== ATAQUE A1b: reescrever o horario declarado depois do carimbo
DO $t$
DECLARE c qa.ctx; w uuid; j uuid; a uuid; sp uuid; s timestamptz;
BEGIN
    c := qa.preparar();
    w := qa.freela(); j := qa.turno(qa.dia(0)); SELECT start_date INTO s FROM public.jobs WHERE id = j;
    a := qa.executar(j, w, NULL, NULL, false);
    UPDATE public.applications SET worker_checkout_at = s + interval '8 hours' WHERE id = a;
    SELECT id INTO sp FROM public.shift_payments WHERE application_id = a;
    PERFORM qa.como(w); UPDATE public.shift_payments SET worker_confirmed_at = now() WHERE id = sp;
    PERFORM public.bonus_evaluate_enrollment(c.enr);
    PERFORM qa.ok(qa.motivo(a) = 'clock_mismatch', 'A1b: ' || COALESCE(qa.motivo(a), 'sem linha'));
END $t$;

--== ATAQUE M4: turno atribuido movido para outra empresa
DO $t$
DECLARE c qa.ctx; outra uuid := gen_random_uuid(); j uuid; a uuid; j2 uuid;
BEGIN
    c := qa.preparar();
    INSERT INTO public.companies (id, owner_id, name) VALUES (outra, gen_random_uuid(), 'Outra');
    j := qa.turno(qa.dia(0));
    UPDATE public.jobs SET company_id = outra WHERE id = j;
    a := qa.executar(j, qa.freela());
    PERFORM public.bonus_evaluate_enrollment(c.enr);
    PERFORM qa.ok(qa.motivo(a) IS NULL, 'M4: turno movido nao entra no livro');
    PERFORM qa.ok((qa.aw('first_complete')).id IS NULL, 'M4 sem marco');
    j2 := qa.turno(qa.dia(1)); a := qa.executar(j2, qa.freela(), NULL, NULL, true);
    UPDATE public.jobs SET company_id = outra WHERE id = j2;
    PERFORM qa.ok(NOT EXISTS (SELECT 1 FROM public.bonus_compute_support(c.enr) s JOIN public.bonus_milestones m ON m.id = s.o_milestone_id
        WHERE m.key IN ('first_complete', 'first_checkin_out')), 'M4 suporte ignora turno movido');
    PERFORM qa.como(c.op);
    PERFORM qa.ok((SELECT (x->'progress'->>'current')::int = 0 FROM jsonb_array_elements(public.bonus_get_my_trail()->'milestones') x
        WHERE x->>'key' = 'shifts_3'), 'M4 progresso');
END $t$;

--== ATAQUE A2: trocar a chave PIX depois de ganhar com a propria "freela"
DO $t$
DECLARE c qa.ctx; w uuid; a uuid; r jsonb;
BEGIN
    c := qa.preparar(qa.disponivel_agora());
    w := qa.freela('laranja@pix.com');
    a := qa.executar(qa.turno(qa.dia(0)), w);
    PERFORM qa.ok(qa.motivo(a) = 'contou', 'contou com chave diferente');
    PERFORM qa.como(c.op);
    PERFORM qa.ok(public.bonus_set_pix_key('Laranja@pix.com')->>'outcome' = 'ok', 'troca aceita em silencio');
    PERFORM qa.ok((SELECT review = 'open' AND 'shared_pix' = ANY (flags) FROM public.bonus_shift_ledger WHERE application_id = a), 'A2 sinalizou');
    r := public.bonus_request_payout();
    PERFORM qa.ok(r->>'outcome' IN ('nothing_available', 'below_minimum'), 'A2 pedido nao leva o turno: ' || r::text);
    PERFORM qa.ok(r::text !~ '(pix_match|shared|identity)', 'resposta neutra');
END $t$;

--== ATAQUE A2b + M1: chave coincide DEPOIS do pedido; mark_paid bloqueia; antes do corte recusa
DO $t$
DECLARE c qa.ctx; w uuid; a uuid; r jsonb; p uuid; v0 int; v1 int;
BEGIN
    c := qa.preparar(qa.disponivel_agora());
    w := qa.freela('limpo@pix.com');
    a := qa.executar(qa.turno(qa.dia(0)), w);
    PERFORM qa.como(c.op);
    r := public.bonus_request_payout();
    PERFORM qa.ok(r->>'outcome' = 'ok', 'pedido: ' || r::text);
    p := (r->>'payout_id')::uuid; v0 := (r->>'amount_cents')::int;
    PERFORM qa.como(NULL);
    r := public.admin_bonus_mark_payout_paid(p, c.adm, 'cedo');
    PERFORM qa.ok(r->>'outcome' = 'not_payable_yet' AND (SELECT status = 'requested' FROM public.bonus_payouts WHERE id = p), 'M1: ' || r::text);
    PERFORM qa.vencer_pedido(p);
    PERFORM qa.como(c.op);
    PERFORM qa.ok(public.bonus_cancel_payout()->>'outcome' = 'too_late', 'M1 sem cancelar depois do corte');
    UPDATE public.workers SET pix_key = 'operadora@pix.com' WHERE id = w;
    PERFORM qa.como(NULL);
    r := public.admin_bonus_mark_payout_paid(p, c.adm, 'qa');
    PERFORM qa.ok(r->>'outcome' = 'blocked_review' AND r->>'message' ~ 'NÃO PAGUE', 'A2 mark_paid: ' || r::text);
    SELECT amount_cents INTO v1 FROM public.bonus_payouts WHERE id = p;
    PERFORM qa.ok(v1 < v0 AND v1 = (SELECT COALESCE(sum(amount_cents), 0) FROM public.bonus_awards WHERE payout_id = p), 'award fora do pedido');
    r := public.admin_bonus_mark_payout_paid(p, c.adm, 'resto');
    PERFORM qa.ok(r->>'outcome' = 'ok', 'o resto paga: ' || r::text);
    PERFORM qa.ok(public.admin_bonus_mark_payout_paid(p, c.adm, 'qa')->>'outcome' = 'already_paid', 'idempotente');
    BEGIN UPDATE public.bonus_payouts SET paid_note = 'x' WHERE id = p; RAISE EXCEPTION 'B4 payout mutavel';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN UPDATE public.bonus_awards SET state = 'earned', payout_id = NULL WHERE payout_id = p; RAISE EXCEPTION 'award pago mutavel';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN UPDATE public.bonus_admin_log SET action = 'x'; RAISE EXCEPTION 'B4 log mutavel';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN DELETE FROM public.bonus_awards; RAISE EXCEPTION 'delete';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.admin_bonus_mark_payout_paid(p, NULL, NULL); RAISE EXCEPTION 'sem ator';
    EXCEPTION WHEN null_value_not_allowed THEN NULL; END;
END $t$;

--== ATAQUE A2c + B3: coincidencia em marco sem turno e operador vetado bloqueiam o pedido com alerta
DO $t$
DECLARE c qa.ctx; v uuid; i int; tc uuid;
BEGIN
    c := qa.preparar(qa.disponivel_agora());
    FOR i IN 1..5 LOOP
        v := qa.freela(CASE WHEN i = 1 THEN 'um@pix.com' END);
        PERFORM qa.como(c.op);
        INSERT INTO public.team_connections (company_id, worker_id, status, source, invited_by) VALUES (c.co, v, 'pending', 'phone', c.op);
        IF i = 1 THEN tc := v; END IF;
    END LOOP;
    PERFORM public.bonus_evaluate_enrollment(c.enr);
    PERFORM qa.ok((qa.aw('invite_5')).id IS NOT NULL, 'marco de convite');
    UPDATE public.workers SET pix_key = 'operadora@pix.com' WHERE id = tc;
    PERFORM qa.como(c.op);
    PERFORM qa.ok(public.bonus_request_payout()->>'outcome' = 'nothing_available', 'bloqueado neutro');
    PERFORM qa.ok((SELECT payout_block_reason = 'pix_match' FROM public.bonus_enrollments WHERE id = c.enr)
        AND EXISTS (SELECT 1 FROM public.bonus_admin_log WHERE action = 'alert_payability'), 'alerta no admin');
    UPDATE public.workers SET pix_key = 'outra@pix.com' WHERE id = tc;
    PERFORM public.admin_bonus_veto_add(c.op, 'virou socio', c.adm);
    PERFORM qa.como(c.op);
    PERFORM public.bonus_request_payout();
    PERFORM qa.ok((SELECT payout_block_reason = 'identity' FROM public.bonus_enrollments WHERE id = c.enr), 'B3 identidade');
END $t$;

--== M3: anonymize_account REAL executa e apaga os dados de pessoa da trilha
DO $t$
DECLARE c qa.ctx; r jsonb; p uuid; sentinela text := 'Patrao Fulano';
BEGIN
    c := qa.preparar(qa.disponivel_agora());
    PERFORM qa.executar(qa.turno(qa.dia(0)), qa.freela());
    PERFORM qa.como(c.op);
    p := (public.bonus_request_payout()->>'payout_id')::uuid;
    PERFORM qa.ok(p IS NOT NULL, 'pedido aberto');
    PERFORM public.admin_bonus_veto_add(gen_random_uuid(), 'x', c.adm);
    PERFORM qa.como(NULL);
    r := public.anonymize_account(c.op);
    PERFORM qa.ok(r->>'outcome' = 'anonymized', 'retorno: ' || r::text);
    PERFORM qa.ok((SELECT display_name = 'anonimizado' AND pix_key IS NULL AND pix_key_normalized IS NULL AND status = 'cancelled'
        AND company_ack_by_label IS NULL AND company_ack_note IS NULL FROM public.bonus_enrollments WHERE id = c.enr), 'inscricao');
    PERFORM qa.ok((SELECT status = 'cancelled' AND pix_key_snapshot = 'anonimizado' AND paid_note IS NULL FROM public.bonus_payouts WHERE id = p), 'pedido');
    PERFORM qa.ok(NOT EXISTS (SELECT 1 FROM public.bonus_awards WHERE enrollment_id = c.enr AND state = 'in_payout'), 'awards voltam');
    PERFORM qa.ok(NOT EXISTS (SELECT 1 FROM public.bonus_admin_log WHERE detail::text ~ ('(whatsapp|Patrao|' || c.op::text || ')')), 'rastro apagado');
    -- a excecao das guardas nao vale para sessao de usuario
    PERFORM qa.como(c.op);
    BEGIN UPDATE public.bonus_enrollments SET display_name = 'x' WHERE id = c.enr; RAISE EXCEPTION 'guard aberto';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $t$;

--== M3: a sonda LGPD executa de verdade (comentario no corpo nao passa) e nao deixa residuo
DO $t$
DECLARE r text; n1 int; n2 int;
BEGIN
    SELECT count(*) INTO n1 FROM public.company_members;
    PERFORM qa.ok(public.bonus_lgpd_probe() IS NULL, 'sonda passa: ' || COALESCE(public.bonus_lgpd_probe(), ''));
    SELECT count(*) INTO n2 FROM public.company_members;
    PERFORM qa.ok(n1 = n2 AND (SELECT count(*) = 0 FROM public.bonus_enrollments), 'sem residuo');
    EXECUTE $f$ CREATE OR REPLACE FUNCTION public.anonymize_account(p_user_id uuid) RETURNS jsonb LANGUAGE sql AS
        $b$ -- PERFORM public.bonus_anonymize_person(p_user_id, bonus_enrollments)
            SELECT '{"outcome":"anonymized"}'::jsonb $b$ $f$;
    r := public.bonus_lgpd_probe();
    PERFORM qa.ok(r ~ 'NAO anonimizou', 'so comentario nao passa: ' || COALESCE(r, 'passou'));
END $t$;

--== MEDIUM-2: a confirmacao do recibo nunca falha por causa da trilha
DO $t$
DECLARE c qa.ctx; w uuid; a uuid; sp uuid;
BEGIN
    c := qa.preparar();
    -- motor sabotado com query_canceled (que WHEN OTHERS NAO captura): se algum gancho o chamasse,
    -- a confirmacao falharia
    EXECUTE $f$ CREATE OR REPLACE FUNCTION public.bonus_evaluate_enrollment(p_enrollment_id uuid) RETURNS jsonb
        LANGUAGE plpgsql AS $b$ BEGIN RAISE EXCEPTION USING ERRCODE = '57014', MESSAGE = 'cancelado'; END $b$ $f$;
    w := qa.freela(); a := qa.executar(qa.turno(qa.dia(0)), w, NULL, NULL, false);
    SELECT id INTO sp FROM public.shift_payments WHERE application_id = a;
    PERFORM qa.como(w); UPDATE public.shift_payments SET worker_confirmed_at = now() WHERE id = sp;
    PERFORM qa.ok((SELECT worker_confirmed_at IS NOT NULL FROM public.shift_payments WHERE id = sp)
        AND EXISTS (SELECT 1 FROM public.bonus_server_stamps WHERE subject_id = sp AND kind = 'receipt_confirmed'), 'confirmou e carimbou');
    UPDATE public.shift_payments SET status = 'voided' WHERE id = sp;      -- estorno idem
    -- espera por trava estourada (lock_timeout) dentro do gancho: engolida
    EXECUTE $f$ CREATE OR REPLACE FUNCTION public.bonus_put_stamp(p_subject uuid, p_kind text, p_job uuid, p_declared timestamptz)
        RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RAISE EXCEPTION USING ERRCODE = '55P03', MESSAGE = 'lock timeout'; END $b$ $f$;
    w := qa.freela(); a := qa.executar(qa.turno(qa.dia(1)), w, NULL, NULL, false);
    SELECT id INTO sp FROM public.shift_payments WHERE application_id = a;
    PERFORM qa.como(w); UPDATE public.shift_payments SET worker_confirmed_at = now() WHERE id = sp;
    PERFORM qa.ok((SELECT worker_confirmed_at IS NOT NULL FROM public.shift_payments WHERE id = sp), 'confirmou com trava estourada');
    -- tabela da trilha indisponivel
    ALTER TABLE public.bonus_attributions RENAME TO bonus_attributions_x;
    UPDATE public.shift_payments SET status = 'voided' WHERE id = sp;
    PERFORM qa.ok((SELECT status = 'voided' FROM public.shift_payments WHERE id = sp), 'estorno com tabela ausente');
END $t$;

--== MEDIUM-1: coincidencia depois da aprovacao que nao pode reabrir bloqueia; aprovada ja vendo o motivo, nao
DO $t$
DECLARE c qa.ctx; a1 uuid; a2 uuid; l uuid; r jsonb;
BEGIN
    c := qa.preparar(qa.disponivel_agora());
    a1 := qa.executar(qa.turno(qa.dia(0)), qa.freela('dup@pix.com'));
    a2 := qa.executar(qa.turno(qa.dia(1)), qa.freela('dup@pix.com'));
    SELECT id INTO l FROM public.bonus_shift_ledger WHERE application_id = a2;
    PERFORM qa.como(NULL);
    PERFORM public.admin_bonus_decide_shift(l, 'approve', c.adm, NULL);       -- viu "PIX repetido entre freelas"
    PERFORM qa.como(c.op);
    -- agora a chave do OPERADOR passa a ser a deles: a1 reabre; a2 ja tem shared_pix e nao reabre -> bloqueia
    PERFORM public.bonus_set_pix_key('dup@pix.com');
    -- o award que citava a2 precisa existir para sustentar o bloqueio
    PERFORM qa.ok(EXISTS (SELECT 1 FROM public.bonus_awards w WHERE w.enrollment_id = c.enr
        AND w.evidence->'ledger_ids' @> jsonb_build_array(l::text)) IS NOT NULL, 'setup');
    UPDATE public.bonus_awards SET evidence = jsonb_build_object('ledger_ids', jsonb_build_array(l::text))
     WHERE id = (qa.aw('first_fast_receipt')).id;
    r := public.bonus_request_payout();
    PERFORM qa.ok(r->>'outcome' = 'nothing_available' AND (SELECT payout_block_reason = 'pix_match' FROM public.bonus_enrollments WHERE id = c.enr),
        'MEDIUM-1 bloqueia: ' || r::text);
    -- se o dono aprovou JA vendo esse motivo, nao bloqueia
    UPDATE public.bonus_shift_ledger SET approved_exclusion = 'same_identity' WHERE id = l;
    PERFORM qa.como(NULL);
    PERFORM public.bonus_recheck_payability(c.enr);
    PERFORM qa.ok((SELECT payout_block_reason IS NULL FROM public.bonus_enrollments WHERE id = c.enr), 'aprovado vendo o motivo');
END $t$;

--== MEDIUM-1b: o motivo visto e gravado pela propria decisao
DO $t$
DECLARE c qa.ctx; a uuid; w uuid; l uuid;
BEGIN
    c := qa.preparar(qa.disponivel_agora());
    w := qa.freela('w@pix.com'); a := qa.executar(qa.turno(qa.dia(0)), w);
    PERFORM qa.como(c.op); PERFORM public.bonus_set_pix_key('w@pix.com');
    SELECT id INTO l FROM public.bonus_shift_ledger WHERE application_id = a;
    PERFORM qa.como(NULL);
    PERFORM public.admin_bonus_decide_shift(l, 'approve', c.adm, NULL);
    PERFORM public.bonus_recheck_payability(c.enr);
    PERFORM qa.ok((SELECT approved_exclusion = 'same_identity' AND review = 'approved' FROM public.bonus_shift_ledger WHERE id = l)
        AND (SELECT payout_block_reason IS NULL FROM public.bonus_enrollments WHERE id = c.enr), 'nao reabre nem bloqueia');
END $t$;

--== LOW-1: estorno tambem sinaliza linha ja aberta e reabre linha aprovada (dentro da janela)
DO $t$
DECLARE c qa.ctx; a1 uuid; a2 uuid; l uuid;
BEGIN
    c := qa.preparar('{"burst_count": 2}');
    a1 := qa.executar(qa.turno(qa.dia(0)), qa.freela());
    a2 := qa.executar(qa.turno(qa.dia(1)), qa.freela());                     -- burst: aberta
    UPDATE public.shift_payments SET status = 'voided' WHERE application_id = a2;
    PERFORM public.bonus_evaluate_enrollment(c.enr);
    PERFORM qa.ok(qa.flags(a2) @> ARRAY['burst', 'voided_after'], 'aberta ganha o motivo: ' || qa.flags(a2)::text);
    a1 := qa.executar(qa.turno(qa.dia(2)), qa.freela());
    SELECT id INTO l FROM public.bonus_shift_ledger WHERE application_id = a1;
    PERFORM public.admin_bonus_decide_shift(l, 'approve', c.adm, NULL);
    UPDATE public.shift_payments SET status = 'voided' WHERE application_id = a1;
    PERFORM public.bonus_evaluate_enrollment(c.enr);
    PERFORM qa.ok((SELECT review = 'open' AND 'voided_after' = ANY (flags) FROM public.bonus_shift_ledger WHERE id = l), 'aprovada reabre');
END $t$;

--== LOW-2: inscricao cancelada com pedido aberto segue revalidada e o pedido zerado sai da lista
DO $t$
DECLARE c qa.ctx; a uuid; w uuid; p uuid; antes int;
BEGIN
    c := qa.preparar(qa.disponivel_agora());
    w := qa.freela('antes@pix.com'); a := qa.executar(qa.turno(qa.dia(0)), w);
    PERFORM qa.como(c.op); p := (public.bonus_request_payout()->>'payout_id')::uuid;
    PERFORM qa.como(NULL);
    PERFORM public.admin_bonus_enrollment_cancel(c.enr, c.adm);
    SELECT amount_cents INTO antes FROM public.bonus_payouts WHERE id = p;
    UPDATE public.workers SET pix_key = 'operadora@pix.com' WHERE id = w;   -- passa a coincidir
    PERFORM public.admin_bonus_refresh();
    PERFORM qa.ok((SELECT amount_cents < antes FROM public.bonus_payouts WHERE id = p), 'cancelada reavaliada');
    -- tudo em conferencia: pedido zera e sai da lista de 'requested'
    PERFORM public.admin_bonus_veto_add(c.op, 'qa', c.adm);
    UPDATE public.bonus_awards SET evidence = jsonb_build_object('ledger_ids',
        (SELECT jsonb_agg(l.id::text) FROM public.bonus_shift_ledger l WHERE l.enrollment_id = c.enr)) WHERE payout_id = p;
    PERFORM public.admin_bonus_refresh();
    PERFORM qa.ok((SELECT status = 'cancelled' AND amount_cents = 0 FROM public.bonus_payouts WHERE id = p), 'pedido zerado some');
END $t$;

--== LOW-3 e LOW-5: chave do operador igual a telefone ou CPF do freela; tolerancia de relogio >= 1
DO $t$
DECLARE c qa.ctx; a uuid; w uuid;
BEGIN
    c := qa.preparar();
    PERFORM qa.como(c.op); PERFORM public.bonus_set_pix_key('+55 (11) 96666-5555');
    a := qa.executar(qa.turno(qa.dia(0)), qa.freela('outra@pix.com', '11 96666-5555'));
    PERFORM qa.ok(qa.motivo(a) = 'same_identity', 'telefone: ' || qa.motivo(a));
    PERFORM public.bonus_set_pix_key('123.456.789-09');
    w := qa.freela('mais@pix.com'); UPDATE public.workers SET cpf = '12345678909' WHERE id = w;
    a := qa.executar(qa.turno(qa.dia(1)), w);
    PERFORM qa.ok(qa.motivo(a) = 'same_identity', 'cpf: ' || qa.motivo(a));
    BEGIN PERFORM public.admin_bonus_track_params_update('eventos', '{"clock_tolerance_min": 0}', c.adm); RAISE EXCEPTION 'aceitou 0';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    BEGIN UPDATE public.bonus_tracks SET params = params || '{"clock_tolerance_min": 0}' WHERE key = 'lojas'; RAISE EXCEPTION 'check';
    EXCEPTION WHEN check_violation THEN NULL; END;
END $t$;

--== LOW-6: pendencia avisa carimbo retroativo divergente
DO $t$
DECLARE c qa.ctx; j uuid; ap uuid; w uuid; r jsonb;
BEGIN
    c := qa.preparar();
    j := qa.turno(qa.dia(0));
    UPDATE public.jobs SET start_date = now() - interval '3 hours' WHERE id = j;
    w := qa.freela();
    INSERT INTO public.applications (job_id, worker_id, status) VALUES (j, w, 'hired') RETURNING id INTO ap;
    PERFORM qa.como(c.op);
    UPDATE public.applications SET company_checkin_confirmed_at = now() - interval '3 hours' WHERE id = ap;
    r := public.bonus_get_my_trail()->'pending_shifts'->0;
    PERFORM qa.ok(jsonb_array_length(r->'warnings') = 1 AND r->'warnings'->>0 ~ 'confirmação de chegada é diferente', 'aviso: ' || r::text);
END $t$;

--== LOW-7: briefing que ja existiu nao vale de novo
DO $t$
DECLARE c qa.ctx; t text := 'calça jeans e camisa branca passada';
BEGIN
    c := qa.preparar('{}', NULL, t);                                          -- preenchido antes do aceite
    UPDATE public.companies SET default_briefing = NULL WHERE id = c.co;
    UPDATE public.companies SET default_briefing = t WHERE id = c.co;
    PERFORM qa.ok((SELECT count(*) = 0 FROM public.bonus_events), 'pre-preenchido');
END $t$;

--== LOW-7b: preenchido pelo dono durante a trilha, apagado e regravado pela operadora
DO $t$
DECLARE c qa.ctx; t text := 'calça jeans e camisa branca passada';
BEGIN
    c := qa.preparar();
    PERFORM qa.como(c.dono); UPDATE public.companies SET default_briefing = t WHERE id = c.co;
    PERFORM qa.como(c.op);
    UPDATE public.companies SET default_briefing = '' WHERE id = c.co;
    UPDATE public.companies SET default_briefing = t WHERE id = c.co;
    PERFORM qa.ok((SELECT count(*) = 0 FROM public.bonus_events), 'regravado');
END $t$;

--== LOW-8: sem data futura o texto e unico e nao revela conferencia
DO $t$
DECLARE c qa.ctx; a uuid; r jsonb;
BEGIN
    c := qa.preparar(qa.disponivel_agora() || '{"burst_count": 2}');
    a := qa.executar(qa.turno(qa.dia(0)), qa.freela());
    a := qa.executar(qa.turno(qa.dia(1)), qa.freela());
    PERFORM qa.como(c.op); r := public.bonus_get_my_trail();
    PERFORM qa.ok(r::text !~ '(in_review|conferência|48h|libera em)', 'texto');
    PERFORM qa.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'milestones') m
        WHERE m->>'release_text' IS NOT NULL AND m->>'release_text' <> 'estamos finalizando'), 'texto unico');
END $t$;

--== M-A: cancelar materializa o conquistado antes (inclusive com o programa desligado)
DO $t$
DECLARE c qa.ctx; w uuid; a uuid; sp uuid; r jsonb; desligado boolean;
BEGIN
    c := qa.preparar();
    w := qa.freela(); a := qa.executar(qa.turno(qa.dia(0)), w, NULL, NULL, false);
    SELECT id INTO sp FROM public.shift_payments WHERE application_id = a;
    PERFORM qa.como(w); UPDATE public.shift_payments SET worker_confirmed_at = now() WHERE id = sp;
    PERFORM qa.ok(qa.motivo(a) IS NULL, 'ainda nao materializado');
    UPDATE public.bonus_program_settings SET enabled = false WHERE id;
    PERFORM qa.como(NULL);
    r := public.admin_bonus_enrollment_cancel(c.enr, c.adm);
    PERFORM qa.ok(r->>'outcome' = 'ok' AND qa.motivo(a) = 'contou' AND (qa.aw('first_complete')).state = 'earned'
        AND (SELECT status = 'cancelled' FROM public.bonus_enrollments WHERE id = c.enr), 'M-A: ' || r::text);
END $t$;

--== M-A + L-B: avaliacao falhando nao cancela, aparece no refresh, bloqueia o pagamento e vira alerta
DO $t$
DECLARE c qa.ctx; w uuid; a uuid; sp uuid; r jsonb; p uuid;
BEGIN
    c := qa.preparar(qa.disponivel_agora());
    a := qa.executar(qa.turno(qa.dia(0)), qa.freela());
    PERFORM qa.como(c.op); p := (public.bonus_request_payout()->>'payout_id')::uuid;
    PERFORM qa.vencer_pedido(p);
    w := qa.freela(); a := qa.executar(qa.turno(qa.dia(1)), w, NULL, NULL, false);
    SELECT id INTO sp FROM public.shift_payments WHERE application_id = a;
    PERFORM qa.como(w); UPDATE public.shift_payments SET worker_confirmed_at = now() WHERE id = sp;
    EXECUTE $f$ CREATE OR REPLACE FUNCTION public.bonus_record_application(p_enrollment_id uuid, p_application_id uuid)
        RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RAISE EXCEPTION 'quebrado'; END $b$ $f$;
    PERFORM qa.como(NULL);
    r := public.admin_bonus_enrollment_cancel(c.enr, c.adm);
    PERFORM qa.ok(r->>'outcome' = 'evaluation_failed' AND (SELECT status = 'active' FROM public.bonus_enrollments WHERE id = c.enr),
        'nao cancela com falha: ' || r::text);
    r := public.admin_bonus_refresh();
    PERFORM qa.ok(r->'failed'->0->>'enrollment_id' = c.enr::text
        AND (SELECT payout_block_reason = 'evaluation_failed' FROM public.bonus_enrollments WHERE id = c.enr), 'L-B: ' || r::text);
    r := public.admin_bonus_mark_payout_paid(p, c.adm, 'qa');
    PERFORM qa.ok(r->>'outcome' = 'blocked_review' AND r->>'reason' = 'evaluation_failed'
        AND (SELECT status = 'requested' FROM public.bonus_payouts WHERE id = p), 'nao paga: ' || r::text);
    PERFORM qa.ok(EXISTS (SELECT 1 FROM public.admin_bonus_alerts() x WHERE x.kind = 'alert_payability'
        AND x.enrollment_id = c.enr AND x.block_reason_at_alert = 'evaluation_failed' AND x.operator_name = 'Operadora QA'), 'M-B alerta');
END $t$;

--== M-B: estorno tardio aparece nos alertas com o turno
DO $t$
DECLARE c qa.ctx; a uuid;
BEGIN
    c := qa.preparar(qa.disponivel_agora());
    a := qa.executar(qa.turno(qa.dia(0)), qa.freela());
    UPDATE public.shift_payments SET status = 'voided' WHERE application_id = a;
    PERFORM public.bonus_evaluate_enrollment(c.enr);
    PERFORM qa.ok(EXISTS (SELECT 1 FROM public.admin_bonus_alerts(10) x WHERE x.kind = 'alert_voided_late' AND x.enrollment_id = c.enr
        AND x.ledger_id = (SELECT id FROM public.bonus_shift_ledger WHERE application_id = a)), 'estorno tardio');
    PERFORM qa.ok(NOT has_function_privilege('authenticated', 'public.admin_bonus_alerts(integer)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.bonus_materialize_enrollment(uuid)', 'EXECUTE'), 'grants');
END $t$;

--== papeis: authenticated nao le tabela nem chama admin; anon nao chama nada
SET LOCAL ROLE authenticated;
DO $t$ BEGIN
    BEGIN PERFORM * FROM public.bonus_awards; RAISE EXCEPTION 'leu'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM * FROM public.bonus_server_stamps; RAISE EXCEPTION 'leu'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.admin_bonus_refresh(); RAISE EXCEPTION 'admin'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.bonus_recheck_payability(gen_random_uuid()); RAISE EXCEPTION 'interna'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    IF public.bonus_get_my_trail()->>'status' IS NULL THEN RAISE EXCEPTION 'rpc do operador'; END IF;
END $t$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $t$ BEGIN
    BEGIN PERFORM public.bonus_get_my_trail(); RAISE EXCEPTION 'anon'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $t$;
