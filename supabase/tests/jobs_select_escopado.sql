-- Teste: leitura de turnos (jobs) escopada. ADR-20261127-leitura-de-turnos-do-encarregado.
-- File: supabase/tests/jobs_select_escopado.sql
-- NAO e migration. Rodar a mao, DEPOIS de aplicar 20261206000100_jobs_select_escopado.sql.
--
-- PARTE 1 e READ-ONLY (so catalogo) e pode rodar em producao.
-- PARTE 2 roda em BEGIN ... ROLLBACK, sem escrita de dado: so troca de papel (SET LOCAL ROLE) e claims.
--   Os ids de cada persona sao descobertos como superusuario ANTES de trocar de papel. Persona que nao
--   existe nos dados vira RAISE NOTICE 'SKIP ...' (nao e aprovacao; registrar no relatorio). Falha = EXCEPTION.
--   Rodar em producao so se o operador aceitar (nao escreve nada; ROLLBACK ao fim).
-- Escrita SEM execucao previa contra o banco pos-migration: a primeira rodada faz parte da verificacao.

-- ============================================================================
-- PARTE 1 — CATALOGO (read-only)
-- ============================================================================

-- 1.1 jobs nao pode ter policy de leitura USING(true). esperado: 0 linhas.
SELECT policyname, cmd, qual FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'jobs' AND cmd IN ('SELECT','ALL')
   AND lower(btrim(qual)) IN ('true','(true)');

-- 1.2 unica policy de SELECT em jobs = jobs_select_scoped. esperado: 1 linha.
SELECT policyname, roles, qual FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'jobs' AND cmd = 'SELECT';

-- 1.3 funcao: DEFINER, search_path vazio, anon SEM EXECUTE, authenticated e service_role COM.
--     esperado: definer=true, anon_exec=false, auth_exec=true, svc_exec=true, config={search_path=""}.
SELECT p.proname, p.prosecdef AS definer, p.proconfig AS config,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc_exec
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'session_is_job_participant';

-- 1.4 RLS ligada em jobs. esperado: true.
SELECT relrowsecurity FROM pg_class WHERE oid = 'public.jobs'::regclass;

-- 1.5 indices de apoio (apos 000200/000300). esperado: 2 linhas.
SELECT indexname FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname IN ('idx_shift_call_targets_worker_call','idx_shift_payments_job_worker');

-- 1.6 nenhum indice de apoio invalido (CONCURRENTLY interrompido deixa indisvalid=false). esperado: 0 linhas.
SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
 WHERE c.relname IN ('idx_shift_call_targets_worker_call','idx_shift_payments_job_worker') AND NOT i.indisvalid;

-- ============================================================================
-- PARTE 2 — COMPORTAMENTO POR PAPEL (BEGIN ... ROLLBACK)
-- ============================================================================
BEGIN;

CREATE TEMP TABLE _jt (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON _jt TO PUBLIC;

-- Descoberta das personas (como superusuario).
DO $$
DECLARE
  v_company uuid; v_owner uuid; v_enc uuid; v_enc_unconf uuid; v_worker uuid; v_worker_free uuid; v_other_owner uuid;
BEGIN
  -- empresa com mais turnos
  SELECT j.company_id INTO v_company FROM public.jobs j GROUP BY j.company_id ORDER BY count(*) DESC LIMIT 1;
  SELECT COALESCE(c.owner_id, c.id) INTO v_owner FROM public.companies c WHERE c.id = v_company;
  -- outra empresa (dono diferente, com turnos)
  SELECT COALESCE(c.owner_id, c.id) INTO v_other_owner FROM public.companies c
   WHERE c.id <> v_company AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.company_id = c.id)
     AND COALESCE(c.owner_id, c.id) <> v_owner LIMIT 1;
  SELECT cm.user_id INTO v_enc FROM public.company_members cm
   WHERE cm.company_id = v_company AND cm.role = 'encarregado' AND cm.status = 'active' AND cm.confirmed_at IS NOT NULL LIMIT 1;
  SELECT cm.user_id INTO v_enc_unconf FROM public.company_members cm
   WHERE cm.company_id = v_company AND cm.role = 'encarregado' AND cm.status = 'active' AND cm.confirmed_at IS NULL LIMIT 1;
  -- freela com vinculo (application) em turno dessa empresa
  SELECT a.worker_id INTO v_worker FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
   WHERE j.company_id = v_company AND a.worker_id <> v_owner LIMIT 1;
  -- freela sem NENHUM vinculo (nem application, alvo ou pagamento) e que nao e operador de empresa
  SELECT w.id INTO v_worker_free FROM public.workers w
   WHERE NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.worker_id = w.id)
     AND NOT EXISTS (SELECT 1 FROM public.shift_call_targets t WHERE t.worker_id = w.id)
     AND NOT EXISTS (SELECT 1 FROM public.shift_payments p WHERE p.worker_id = w.id)
     AND NOT EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id = w.id)
     AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = w.id OR c.owner_id = w.id)
   LIMIT 1;
  INSERT INTO _jt VALUES ('company', v_company::text), ('owner', v_owner::text), ('other_owner', v_other_owner::text),
    ('enc', v_enc::text), ('enc_unconf', v_enc_unconf::text), ('worker', v_worker::text), ('worker_free', v_worker_free::text);
END $$;

-- Helper: troca para authenticated com o uid dado.
CREATE FUNCTION pg_temp.as_user(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(uuid) TO PUBLIC;

-- 2.1 Gestor/dono: ve TODOS os turnos da empresa (inclui deleted) e NENHUM de outra empresa sem vinculo.
DO $$
DECLARE v_company uuid := (SELECT v::uuid FROM _jt WHERE k='company');
        v_owner uuid := (SELECT v::uuid FROM _jt WHERE k='owner');
        v_total int; v_seen int; v_foreign int;
BEGIN
  SELECT count(*) INTO v_total FROM public.jobs WHERE company_id = v_company;
  PERFORM pg_temp.as_user(v_owner);
  SELECT count(*) INTO v_seen FROM public.jobs WHERE company_id = v_company;
  -- turnos de outras empresas visiveis (dono pode ter outras empresas ou ser freela: so conta de empresa sem relacao)
  SELECT count(*) INTO v_foreign FROM public.jobs j
   WHERE j.company_id <> v_company
     AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = j.company_id AND (c.owner_id = v_owner OR c.id = v_owner));
  RESET ROLE;
  IF v_seen <> v_total THEN RAISE EXCEPTION '2.1 Gestor viu % de % turnos da empresa', v_seen, v_total; END IF;
  RAISE NOTICE '2.1 OK: Gestor viu %/% turnos; de outras empresas (sem vinculo seu) viu %', v_seen, v_total, v_foreign;
  IF v_foreign > 0 THEN
    -- so e erro se o dono nao tem vinculo de freela/membro nessas empresas
    IF EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id = v_owner AND cm.company_id <> v_company)
       OR EXISTS (SELECT 1 FROM public.applications a WHERE a.worker_id = v_owner) THEN
      RAISE NOTICE '2.1 aviso: dono tem outros vinculos; v_foreign nao conclusivo';
    ELSE
      RAISE EXCEPTION '2.1 Gestor viu % turnos de outras empresas', v_foreign;
    END IF;
  END IF;
END $$;

-- 2.2 Encarregado confirmado: so os que e responsavel + os cobertos na data; nenhum de outro responsavel sem cobertura.
DO $$
DECLARE v_company uuid := (SELECT v::uuid FROM _jt WHERE k='company');
        v_enc uuid := (SELECT NULLIF(v,'')::uuid FROM _jt WHERE k='enc');
        v_total int; v_seen int; v_expected int;
BEGIN
  IF v_enc IS NULL THEN RAISE NOTICE '2.2 SKIP: nao ha encarregado confirmado na empresa escolhida'; RETURN; END IF;
  SELECT count(*) INTO v_total FROM public.jobs WHERE company_id = v_company;
  -- esperado calculado SEM o seam: responsavel = eu, ou cobertura ativa de quem e o responsavel na data local
  SELECT count(*) INTO v_expected FROM public.jobs j
   WHERE j.company_id = v_company AND j.responsible_id IS NOT NULL
     AND (j.responsible_id = v_enc
          OR EXISTS (SELECT 1 FROM public.responsibility_coverages rc
                      WHERE rc.company_id = v_company AND rc.to_user_id = v_enc AND rc.from_user_id = j.responsible_id
                        AND rc.revoked_at IS NULL
                        AND ((j.start_date AT TIME ZONE 'America/Sao_Paulo')::date) BETWEEN rc.starts_on AND rc.ends_on
                        AND EXISTS (SELECT 1 FROM public.company_members cf WHERE cf.company_id = v_company
                                     AND cf.user_id = rc.from_user_id AND cf.role = 'encarregado'
                                     AND cf.status = 'active' AND cf.confirmed_at IS NOT NULL)));
  PERFORM pg_temp.as_user(v_enc);
  SELECT count(*) INTO v_seen FROM public.jobs WHERE company_id = v_company;
  RESET ROLE;
  -- participacao como freela pode somar turnos; encarregado normalmente nao tem. Tolerancia explicita:
  IF EXISTS (SELECT 1 FROM public.applications WHERE worker_id = v_enc) THEN
    RAISE NOTICE '2.2 aviso: encarregado tambem e freela; comparacao nao conclusiva (viu %, esperado % + participacao)', v_seen, v_expected;
  ELSIF v_seen <> v_expected THEN
    RAISE EXCEPTION '2.2 Encarregado viu % turnos, esperado % (total da empresa %)', v_seen, v_expected, v_total;
  END IF;
  IF v_total > 0 AND v_seen = v_total AND v_expected < v_total THEN
    RAISE EXCEPTION '2.2 Encarregado enxerga a empresa inteira (furo aberto)';
  END IF;
  RAISE NOTICE '2.2 OK: Encarregado viu % de % (esperado %)', v_seen, v_total, v_expected;
END $$;

-- 2.3 Encarregado NAO confirmado: zero da empresa.
DO $$
DECLARE v_company uuid := (SELECT v::uuid FROM _jt WHERE k='company');
        v_u uuid := (SELECT NULLIF(v,'')::uuid FROM _jt WHERE k='enc_unconf');
        v_seen int;
BEGIN
  IF v_u IS NULL THEN RAISE NOTICE '2.3 SKIP: nao ha encarregado nao confirmado na empresa escolhida'; RETURN; END IF;
  PERFORM pg_temp.as_user(v_u);
  SELECT count(*) INTO v_seen FROM public.jobs WHERE company_id = v_company;
  RESET ROLE;
  IF v_seen <> 0 THEN RAISE EXCEPTION '2.3 Encarregado nao confirmado viu % turnos', v_seen; END IF;
  RAISE NOTICE '2.3 OK: nao confirmado viu 0';
END $$;

-- 2.4 Freela COM vinculo: ve exatamente o conjunto de turnos de applications + alvos + pagamentos proprios.
DO $$
DECLARE v_w uuid := (SELECT NULLIF(v,'')::uuid FROM _jt WHERE k='worker');
        v_expected int; v_seen int; v_extra int;
BEGIN
  IF v_w IS NULL THEN RAISE NOTICE '2.4 SKIP: nao ha freela com application'; RETURN; END IF;
  SELECT count(*) INTO v_expected FROM (
      SELECT job_id FROM public.applications WHERE worker_id = v_w
      UNION SELECT c.job_id FROM public.shift_call_targets t JOIN public.shift_calls c ON c.id = t.call_id WHERE t.worker_id = v_w
      UNION SELECT job_id FROM public.shift_payments WHERE worker_id = v_w) s;
  PERFORM pg_temp.as_user(v_w);
  SELECT count(*) INTO v_seen FROM public.jobs;
  RESET ROLE;
  IF v_seen <> v_expected THEN RAISE EXCEPTION '2.4 Freela viu % turnos, esperado % (vinculo proprio)', v_seen, v_expected; END IF;
  RAISE NOTICE '2.4 OK: freela viu % turnos (= vinculos)', v_seen;
END $$;

-- 2.5 Freela SEM vinculo: zero.
DO $$
DECLARE v_w uuid := (SELECT NULLIF(v,'')::uuid FROM _jt WHERE k='worker_free'); v_seen int;
BEGIN
  IF v_w IS NULL THEN RAISE NOTICE '2.5 SKIP: nao ha freela sem vinculo'; RETURN; END IF;
  PERFORM pg_temp.as_user(v_w);
  SELECT count(*) INTO v_seen FROM public.jobs;
  RESET ROLE;
  IF v_seen <> 0 THEN RAISE EXCEPTION '2.5 Freela sem vinculo viu % turnos', v_seen; END IF;
  RAISE NOTICE '2.5 OK: freela sem vinculo viu 0';
END $$;

-- 2.6 Dono de OUTRA empresa: zero turnos da empresa escolhida.
DO $$
DECLARE v_company uuid := (SELECT v::uuid FROM _jt WHERE k='company');
        v_o uuid := (SELECT NULLIF(v,'')::uuid FROM _jt WHERE k='other_owner'); v_seen int;
BEGIN
  IF v_o IS NULL THEN RAISE NOTICE '2.6 SKIP: nao ha segunda empresa com turnos'; RETURN; END IF;
  PERFORM pg_temp.as_user(v_o);
  SELECT count(*) INTO v_seen FROM public.jobs WHERE company_id = v_company;
  RESET ROLE;
  IF v_seen <> 0 THEN RAISE EXCEPTION '2.6 Dono de outra empresa viu % turnos alheios', v_seen; END IF;
  RAISE NOTICE '2.6 OK: dono de outra empresa viu 0 da empresa alheia';
END $$;

-- 2.7 Sem 42P17: joins como freela (se algum der recursao, o DO aborta com o erro).
DO $$
DECLARE v_w uuid := (SELECT NULLIF(v,'')::uuid FROM _jt WHERE k='worker'); n1 int; n2 int; n3 int; n4 int;
BEGIN
  IF v_w IS NULL THEN RAISE NOTICE '2.7 SKIP: sem freela com vinculo'; RETURN; END IF;
  PERFORM pg_temp.as_user(v_w);
  SELECT count(*) INTO n1 FROM public.applications a JOIN public.jobs j ON j.id = a.job_id;
  SELECT count(*) INTO n2 FROM public.shift_call_targets t JOIN public.shift_calls c ON c.id = t.call_id JOIN public.jobs j ON j.id = c.job_id;
  SELECT count(*) INTO n3 FROM public.shift_payments p JOIN public.jobs j ON j.id = p.job_id;
  SELECT count(*) INTO n4 FROM public.applications a WHERE public.is_job_owner(a.job_id) OR true;
  RESET ROLE;
  RAISE NOTICE '2.7 OK: sem 42P17 (applications x jobs=%, targets x calls x jobs=%, payments x jobs=%, is_job_owner=%)', n1, n2, n3, n4;
END $$;

-- 2.8 Sem 42P17 como Gestor e Encarregado nas tabelas que cruzam jobs (is_job_owner INVOKER le jobs sob a nova RLS).
DO $$
DECLARE v_o uuid := (SELECT v::uuid FROM _jt WHERE k='owner');
        v_e uuid := (SELECT NULLIF(v,'')::uuid FROM _jt WHERE k='enc'); n int;
BEGIN
  PERFORM pg_temp.as_user(v_o);
  SELECT count(*) INTO n FROM public.applications;
  SELECT count(*) INTO n FROM public.shift_calls;
  SELECT count(*) INTO n FROM public.shift_call_targets;
  SELECT count(*) INTO n FROM public.shift_payments;
  RESET ROLE;
  IF v_e IS NOT NULL THEN
    PERFORM pg_temp.as_user(v_e);
    SELECT count(*) INTO n FROM public.applications;
    SELECT count(*) INTO n FROM public.shift_calls;
    SELECT count(*) INTO n FROM public.shift_call_targets;
    SELECT count(*) INTO n FROM public.shift_payments;
    RESET ROLE;
  END IF;
  RAISE NOTICE '2.8 OK: applications/shift_calls/shift_call_targets/shift_payments legiveis por Gestor e Encarregado sem 42P17';
END $$;

-- 2.9 anon: nenhum turno (sem policy) e sem EXECUTE na funcao.
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO n FROM public.jobs;
    IF n <> 0 THEN RAISE EXCEPTION '2.9 anon viu % turnos', n; END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    n := 0; -- negado por GRANT tambem e aceitavel
  END;
  RESET ROLE;
  IF has_function_privilege('anon', 'public.session_is_job_participant(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '2.9 anon tem EXECUTE em session_is_job_participant';
  END IF;
  RAISE NOTICE '2.9 OK: anon sem acesso';
END $$;

ROLLBACK;
