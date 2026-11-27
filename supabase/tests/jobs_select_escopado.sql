-- Teste: leitura de turnos (jobs) escopada. ADR-20261127-leitura-de-turnos-do-encarregado.
-- File: supabase/tests/jobs_select_escopado.sql
-- NAO e migration. Rodar a mao, DEPOIS de aplicar 20261206000100_jobs_select_escopado.sql.
--
-- PARTE 1: catalogo, read-only, falha com ASSERT/EXCEPTION. Pode rodar em producao.
-- PARTE 2: FIXTURES SINTETICAS dentro de BEGIN ... ROLLBACK (nada persiste). ESCREVE (como superusuario)
--   empresas, membros, turnos, applications, chamados e pagamentos de mentira, e troca de papel com
--   SET LOCAL ROLE + request.jwt.claims. Rodar em branch/QA/staging; em producao so com aceite explicito do operador
--   (e a transacao inteira e desfeita, mas ha triggers de escrita no caminho).
-- Escrita SEM execucao previa pos-migration: a primeira rodada faz parte da verificacao. Se um INSERT de fixture
-- falhar por trigger/CHECK nao previsto, o erro aponta a linha; ajustar a fixture, nao afrouxar a assercao.

-- ============================================================================
-- PARTE 1 — CATALOGO (read-only; cada bloco FALHA se o esperado nao vale)
-- ============================================================================
DO $$
DECLARE v_n int; v_name text;
BEGIN
  -- 1.1 jobs nao tem policy de leitura USING(true)
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname='public' AND tablename='jobs' AND cmd IN ('SELECT','ALL') AND lower(btrim(qual)) IN ('true','(true)');
  ASSERT v_n = 0, format('1.1 jobs ainda tem %s policy USING(true)', v_n);

  -- 1.2 EXATAMENTE 1 policy de leitura, e e jobs_select_scoped
  SELECT count(*), min(policyname) INTO v_n, v_name FROM pg_policies
   WHERE schemaname='public' AND tablename='jobs' AND cmd IN ('SELECT','ALL');
  ASSERT v_n = 1 AND v_name = 'jobs_select_scoped', format('1.2 esperado 1 policy jobs_select_scoped; achei % (%)', v_n, v_name);

  -- 1.3 funcao: DEFINER, search_path vazio, anon sem EXECUTE, authenticated e service_role com
  ASSERT (SELECT prosecdef FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='session_is_job_participant'),
         '1.3 session_is_job_participant nao e DEFINER';
  ASSERT (SELECT proconfig::text LIKE '%search_path=""%' FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='session_is_job_participant'),
         '1.3 search_path nao e vazio';
  ASSERT NOT has_function_privilege('anon', 'public.session_is_job_participant(uuid)', 'EXECUTE'), '1.3 anon tem EXECUTE';
  ASSERT has_function_privilege('authenticated', 'public.session_is_job_participant(uuid)', 'EXECUTE'), '1.3 authenticated sem EXECUTE';
  ASSERT has_function_privilege('service_role', 'public.session_is_job_participant(uuid)', 'EXECUTE'), '1.3 service_role sem EXECUTE';

  -- 1.4 RLS ligada
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='public.jobs'::regclass), '1.4 RLS desligada em jobs';

  -- 1.5 M1: nao existe INSERT de candidatura pull por freela
  ASSERT NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='applications'
                      AND cmd='INSERT' AND policyname='Workers can insert applications'),
         '1.5 policy "Workers can insert applications" ainda existe';
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname='public' AND tablename='applications' AND cmd IN ('INSERT','ALL');
  ASSERT v_n = 1, format('1.5 applications deve ter so applications_insert_company_invite como INSERT; tem %s', v_n);

  RAISE NOTICE 'PARTE 1 OK';
END $$;

-- ============================================================================
-- PARTE 2 — COMPORTAMENTO POR PAPEL, COM FIXTURES (BEGIN ... ROLLBACK)
-- ============================================================================
BEGIN;

CREATE TEMP TABLE _f (k text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid()) ON COMMIT DROP;  -- pessoas/empresas
CREATE TEMP TABLE _j (label text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid()) ON COMMIT DROP; -- turnos
GRANT SELECT ON _f, _j TO PUBLIC;

INSERT INTO _f(k) VALUES ('gestor'),('gestor_b'),('enc_ok'),('enc_unconf'),('enc_removed'),('enc_cov'),
  ('w_app'),('w_team'),('w_sos_open'),('w_sos_exp'),('w_sos_closed'),('w_sos_decl'),('w_sos_acc'),('w_void'),('w_none'),
  ('co_a'),('co_b'),('org_a'),('org_b');

-- helper: id de fixture
CREATE FUNCTION pg_temp.f(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM _f WHERE k = p $$;
CREATE FUNCTION pg_temp.j(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM _j WHERE label = p $$;

-- helper: labels de turno-fixture VISIVEIS para o usuario (troca de papel real; volta ao superusuario)
CREATE FUNCTION pg_temp.vis(p_uid uuid) RETURNS text AS $$
DECLARE r text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT COALESCE(string_agg(l.label, ',' ORDER BY l.label), '') INTO r
    FROM _j l WHERE EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = l.id);
  EXECUTE 'RESET ROLE';
  RETURN r;
END $$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.expect(p_what text, p_got text, p_want text) RETURNS void AS $$
BEGIN
  IF p_got IS DISTINCT FROM p_want THEN
    RAISE EXCEPTION '% — viu [%], esperado [%]', p_what, p_got, p_want;
  END IF;
  RAISE NOTICE 'OK % = [%]', p_what, p_got;
END $$ LANGUAGE plpgsql;

-- helper: cria chamado + alvo (fixture)
CREATE FUNCTION pg_temp.mkcall(p_job text, p_origin text, p_status text, p_exp timestamptz, p_worker text, p_resp text)
RETURNS void AS $$
DECLARE v_call uuid;
BEGIN
  INSERT INTO public.shift_calls(job_id, company_id, created_by, slots, expires_at, status, origin)
  VALUES (pg_temp.j(p_job), pg_temp.f('co_a'), pg_temp.f('gestor'), 1, p_exp, p_status, p_origin)
  RETURNING id INTO v_call;
  INSERT INTO public.shift_call_targets(call_id, worker_id, response, responded_at)
  VALUES (v_call, pg_temp.f(p_worker), p_resp, CASE WHEN p_resp IS NULL THEN NULL ELSE now() END);
END $$ LANGUAGE plpgsql;

-- ---- fixtures (como superusuario) ----
DO $$
DECLARE
  d0 date := current_date + 10;   -- inicio da janela de cobertura (enc_cov -> enc_ok): d0 .. d0+2
  ts timestamptz;
  v_call uuid;
BEGIN
  INSERT INTO public.organizations(id, name, created_by) VALUES (pg_temp.f('org_a'), 'ZZ org a', pg_temp.f('gestor')),
                                                               (pg_temp.f('org_b'), 'ZZ org b', pg_temp.f('gestor_b'));
  INSERT INTO public.companies(id, name, organization_id, owner_id) VALUES
    (pg_temp.f('co_a'), 'ZZ empresa A', pg_temp.f('org_a'), pg_temp.f('gestor')),
    (pg_temp.f('co_b'), 'ZZ empresa B', pg_temp.f('org_b'), pg_temp.f('gestor_b'));

  -- membros: confirmado, nao confirmado, removido, e o "de" da cobertura (ativo e confirmado)
  INSERT INTO public.company_members(company_id, user_id, role, status, created_by, confirmed_at, removed_at) VALUES
    (pg_temp.f('co_a'), pg_temp.f('enc_ok'),      'encarregado', 'active',  pg_temp.f('gestor'), now(), NULL),
    (pg_temp.f('co_a'), pg_temp.f('enc_unconf'),  'encarregado', 'active',  pg_temp.f('gestor'), NULL,  NULL),
    (pg_temp.f('co_a'), pg_temp.f('enc_removed'), 'encarregado', 'removed', pg_temp.f('gestor'), now(), now()),
    (pg_temp.f('co_a'), pg_temp.f('enc_cov'),     'encarregado', 'active',  pg_temp.f('gestor'), now(), NULL);

  -- coberturas: enc_cov -> enc_ok em [d0, d0+2]; gestor -> enc_ok (inerte: "de" e Gestor) em d0+20
  INSERT INTO public.responsibility_coverages(company_id, from_user_id, to_user_id, starts_on, ends_on, created_by) VALUES
    (pg_temp.f('co_a'), pg_temp.f('enc_cov'), pg_temp.f('enc_ok'), d0, d0 + 2, pg_temp.f('gestor')),
    (pg_temp.f('co_a'), pg_temp.f('gestor'),  pg_temp.f('enc_ok'), d0 + 20, d0 + 20, pg_temp.f('gestor'));

  -- turnos: (label, empresa, responsavel, dia)
  INSERT INTO _j(label) VALUES ('a_enc_ok'),('a_enc_unconf'),('a_resp_null'),('a_enc_removed'),('a_gestor'),
    ('a_cov_before'),('a_cov_start'),('a_cov_mid'),('a_cov_end'),('a_cov_after'),('a_cov_from_gestor'),('b_gestor');

  INSERT INTO public.jobs(id, company_id, title, responsible_id, start_date)
  SELECT pg_temp.j(x.label), pg_temp.f(x.co), 'ZZ ' || x.label,
         CASE WHEN x.resp IS NULL THEN NULL ELSE pg_temp.f(x.resp) END,
         ((x.day::text || ' 12:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo')
    FROM (VALUES
      ('a_enc_ok',          'co_a', 'enc_ok',     (d0 + 40)),
      ('a_enc_unconf',      'co_a', 'enc_unconf', (d0 + 41)),
      ('a_resp_null',       'co_a', NULL,         (d0 + 42)),
      ('a_enc_removed',     'co_a', 'enc_removed',(d0 + 43)),
      ('a_gestor',          'co_a', 'gestor',     (d0 + 44)),
      ('a_cov_before',      'co_a', 'enc_cov',    (d0 - 1)),   -- borda: um dia ANTES da janela
      ('a_cov_start',       'co_a', 'enc_cov',    (d0)),       -- borda: primeiro dia
      ('a_cov_mid',         'co_a', 'enc_cov',    (d0 + 1)),
      ('a_cov_end',         'co_a', 'enc_cov',    (d0 + 2)),   -- borda: ultimo dia
      ('a_cov_after',       'co_a', 'enc_cov',    (d0 + 3)),   -- borda: um dia DEPOIS
      ('a_cov_from_gestor', 'co_a', 'gestor',     (d0 + 20)),  -- cobertura com "de" = Gestor e inerte
      ('b_gestor',          'co_b', 'gestor_b',   (d0 + 45))
    ) AS x(label, co, resp, day);

  -- freelas
  INSERT INTO public.workers(id) SELECT id FROM _f WHERE k LIKE 'w\_%';

  -- w_app: application (invited) em a_gestor
  INSERT INTO public.applications(job_id, worker_id, status) VALUES (pg_temp.j('a_gestor'), pg_temp.f('w_app'), 'invited');

  -- chamados (um por turno): team encerrado; sos aberto; sos expirado; sos cancelado; sos recusado; sos aceito
  PERFORM pg_temp.mkcall('a_enc_unconf', 'team', 'cancelled', now() + interval '1 day', 'w_team',      NULL);
  PERFORM pg_temp.mkcall('a_resp_null',  'sos',  'open',      now() + interval '1 hour', 'w_sos_open',   NULL);
  PERFORM pg_temp.mkcall('a_enc_removed','sos',  'open',      now() - interval '1 hour', 'w_sos_exp',    NULL);
  PERFORM pg_temp.mkcall('a_cov_before', 'sos',  'cancelled', now() + interval '1 hour', 'w_sos_closed', NULL);
  PERFORM pg_temp.mkcall('a_cov_after',  'sos',  'open',      now() + interval '1 hour', 'w_sos_decl',   'declined');
  PERFORM pg_temp.mkcall('a_cov_mid',    'sos',  'filled',    now() - interval '1 hour', 'w_sos_acc',    'accepted');

  -- w_void: so um shift_payments voided
  INSERT INTO public.shift_payments(job_id, company_id, worker_id, source, amount, status, voided_at, void_reason)
  VALUES (pg_temp.j('a_cov_end'), pg_temp.f('co_a'), pg_temp.f('w_void'), 'cash', 10, 'voided', now(), 'fixture');
END $$;

-- ---- assertions ----

-- 2.1 Gestor/dono: todos os turnos da empresa A, nenhum da B
SELECT pg_temp.expect('2.1 Gestor A', pg_temp.vis(pg_temp.f('gestor')),
  'a_cov_after,a_cov_before,a_cov_end,a_cov_from_gestor,a_cov_mid,a_cov_start,a_enc_ok,a_enc_removed,a_enc_unconf,a_gestor,a_resp_null');

-- 2.2 Gestor de OUTRA empresa: ve so o da B, nada da A
SELECT pg_temp.expect('2.2 Gestor B', pg_temp.vis(pg_temp.f('gestor_b')), 'b_gestor');

-- 2.3 Encarregado confirmado: os dele + cobertura nas bordas (d0 e d0+2 entram; d0-1 e d0+3 nao);
--     cobertura com "de" = Gestor e inerte; responsible_id NULL, de removido e de nao confirmado ficam de fora.
SELECT pg_temp.expect('2.3 Encarregado confirmado', pg_temp.vis(pg_temp.f('enc_ok')),
  'a_cov_end,a_cov_mid,a_cov_start,a_enc_ok');

-- 2.4 Encarregado NAO confirmado e REMOVIDO: zero
SELECT pg_temp.expect('2.4a Encarregado nao confirmado', pg_temp.vis(pg_temp.f('enc_unconf')), '');
SELECT pg_temp.expect('2.4b Encarregado removido',       pg_temp.vis(pg_temp.f('enc_removed')), '');

-- 2.5 Freelas (M2: SOS so enquanto aberto e nao expirado, ou apos aceitar; team mantem)
SELECT pg_temp.expect('2.5a freela com application',               pg_temp.vis(pg_temp.f('w_app')),        'a_gestor');
SELECT pg_temp.expect('2.5b freela alvo team (chamado encerrado)', pg_temp.vis(pg_temp.f('w_team')),       'a_enc_unconf');
SELECT pg_temp.expect('2.5c freela alvo SOS aberto',               pg_temp.vis(pg_temp.f('w_sos_open')),   'a_resp_null');
SELECT pg_temp.expect('2.5d freela alvo SOS expirado',             pg_temp.vis(pg_temp.f('w_sos_exp')),    '');
SELECT pg_temp.expect('2.5e freela alvo SOS cancelado',            pg_temp.vis(pg_temp.f('w_sos_closed')), '');
SELECT pg_temp.expect('2.5f freela alvo SOS recusado',             pg_temp.vis(pg_temp.f('w_sos_decl')),   '');
SELECT pg_temp.expect('2.5g freela alvo SOS aceito',               pg_temp.vis(pg_temp.f('w_sos_acc')),    'a_cov_mid');
SELECT pg_temp.expect('2.5h freela so com shift_payments voided',  pg_temp.vis(pg_temp.f('w_void')),       'a_cov_end');
SELECT pg_temp.expect('2.5i freela sem vinculo',                   pg_temp.vis(pg_temp.f('w_none')),       '');

-- 2.6 M1: freela sem vinculo NAO consegue se auto-conceder leitura inserindo application em turno alheio
DO $$
DECLARE v_failed boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.f('w_none'), 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.applications(job_id, worker_id, status) VALUES (pg_temp.j('a_gestor'), pg_temp.f('w_none'), 'pending');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_failed THEN RAISE EXCEPTION '2.6 freela inseriu application em turno alheio (M1 aberto)'; END IF;
  PERFORM pg_temp.expect('2.6 apos INSERT barrado, freela sem vinculo ve', pg_temp.vis(pg_temp.f('w_none')), '');
END $$;

-- 2.7 Encarregado: INSERT ... RETURNING e UPDATE ... RETURNING no proprio turno (RETURNING exige SELECT)
DO $$
DECLARE v_id uuid; v_ok boolean; v_failed boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.f('enc_ok'), 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.jobs(company_id, title, start_date)
  VALUES (pg_temp.f('co_a'), 'ZZ criado pelo encarregado', now() + interval '60 days') RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION '2.7 INSERT RETURNING nao devolveu o turno do Encarregado'; END IF;
  UPDATE public.jobs SET title = 'ZZ editado' WHERE id = v_id RETURNING true INTO v_ok;
  IF v_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '2.7 UPDATE RETURNING nao devolveu linha'; END IF;
  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'OK 2.7 Encarregado confirmado: INSERT/UPDATE RETURNING';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.f('enc_unconf'), 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.jobs(company_id, title, start_date)
    VALUES (pg_temp.f('co_a'), 'ZZ nao deveria', now() + interval '61 days');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_failed THEN RAISE EXCEPTION '2.7 Encarregado nao confirmado criou turno'; END IF;
  RAISE NOTICE 'OK 2.7 nao confirmado barrado';
END $$;

-- 2.8 Sem 42P17: joins como freela; leitura das tabelas que cruzam jobs como Gestor e Encarregado
DO $$
DECLARE n1 int; n2 int; n4 int; n5 int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.f('w_app'), 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n1 FROM public.applications a JOIN public.jobs j ON j.id = a.job_id;
  SELECT count(*) INTO n5 FROM public.shift_payments p JOIN public.jobs j ON j.id = p.job_id;
  SELECT count(*) INTO n4 FROM public.applications a WHERE public.is_job_owner(a.job_id);
  EXECUTE 'RESET ROLE';
  IF n1 <> 1 THEN RAISE EXCEPTION '2.8 applications x jobs devolveu % (esperado 1)', n1; END IF;
  IF n4 <> 0 THEN RAISE EXCEPTION '2.8 freela nao opera turno: is_job_owner devolveu % linhas', n4; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.f('w_sos_open'), 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n2 FROM public.shift_call_targets t JOIN public.shift_calls c ON c.id = t.call_id JOIN public.jobs j ON j.id = c.job_id;
  EXECUTE 'RESET ROLE';
  IF n2 <> 1 THEN RAISE EXCEPTION '2.8 targets x calls x jobs devolveu % (esperado 1)', n2; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.f('gestor'), 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n5 FROM public.applications;       SELECT count(*) INTO n5 FROM public.shift_calls;
  SELECT count(*) INTO n5 FROM public.shift_call_targets; SELECT count(*) INTO n5 FROM public.shift_payments;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.f('enc_ok'), 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n5 FROM public.applications;       SELECT count(*) INTO n5 FROM public.shift_calls;
  SELECT count(*) INTO n5 FROM public.shift_call_targets; SELECT count(*) INTO n5 FROM public.shift_payments;
  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'OK 2.8 sem 42P17';
END $$;

-- 2.9 anon real: sem EXECUTE na funcao (insufficient_privilege) e sem turnos
DO $$
DECLARE n int; v_denied boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM public.session_is_job_participant(pg_temp.j('a_gestor'));
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN EXECUTE 'RESET ROLE'; RAISE EXCEPTION '2.9 anon executou session_is_job_participant'; END IF;
  v_denied := false;
  BEGIN
    SELECT count(*) INTO n FROM public.jobs;
    IF n <> 0 THEN EXECUTE 'RESET ROLE'; RAISE EXCEPTION '2.9 anon viu % turnos', n; END IF;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'OK 2.9 anon: funcao negada; jobs %', CASE WHEN v_denied THEN 'negado por GRANT' ELSE '0 linhas (sem policy)' END;
END $$;

ROLLBACK;
