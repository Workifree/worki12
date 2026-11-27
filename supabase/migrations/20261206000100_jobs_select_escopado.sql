-- Leitura de turnos (jobs) escopada por quem opera ou participa.
-- ADR: .harness/memory-bank/decisions/ADR-20261127-leitura-de-turnos-do-encarregado.md
--
-- Problema: duas policies SELECT permissivas USING (true) ("Authenticated can view jobs" e
-- jobs_select_authenticated) deixavam qualquer conta autenticada ler todos os turnos de todas as empresas.
-- Remover so uma nao fecha nada (OR).
--
-- Regra nova (uma policy): operador do turno pelo seam (session_can_operate_job, o mesmo predicado das
-- policies de escrita) OU freela participante (session_is_job_participant: applications, shift_call_targets
-- ou shift_payments proprios). DEFINER no ramo do freela para evitar 42P17
-- (jobs -> applications -> is_job_owner -> jobs).
--
-- Ordem de deploy: esta migration ANTES de qualquer frontend; indices (20261206000200/000300) logo depois,
-- fora de transacao. Nenhum ajuste de frontend e obrigatorio.
--
-- DOWN (restaura o estado anterior, INCLUSIVE o furo):
--   DROP POLICY IF EXISTS jobs_select_scoped ON public.jobs;
--   CREATE POLICY jobs_select_authenticated ON public.jobs FOR SELECT TO authenticated USING (true);
--   DROP FUNCTION IF EXISTS public.session_is_job_participant(uuid);

CREATE OR REPLACE FUNCTION public.session_is_job_participant(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.applications a
                WHERE a.job_id = p_job_id AND a.worker_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.shift_call_targets t
                 JOIN public.shift_calls c ON c.id = t.call_id
                WHERE c.job_id = p_job_id AND t.worker_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.shift_payments sp
                WHERE sp.job_id = p_job_id AND sp.worker_id = (SELECT auth.uid()))
  );
$$;

REVOKE ALL ON FUNCTION public.session_is_job_participant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_is_job_participant(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.session_is_job_participant(uuid) IS
  'Ramo do freela na leitura de jobs. Sempre sobre auth.uid(). DEFINER para quebrar o ciclo jobs->applications->is_job_owner->jobs (42P17). ADR-20261127-leitura-de-turnos-do-encarregado.';

DROP POLICY IF EXISTS "Authenticated can view jobs" ON public.jobs;
DROP POLICY IF EXISTS jobs_select_authenticated ON public.jobs;
DROP POLICY IF EXISTS jobs_select_scoped ON public.jobs;

CREATE POLICY jobs_select_scoped ON public.jobs FOR SELECT TO authenticated USING (
     public.session_can_operate_job(company_id, responsible_id, ((start_date AT TIME ZONE 'America/Sao_Paulo'))::date)
  OR public.session_is_job_participant(id)
);

-- Verificacao final: falha a migration (e desfaz tudo) se o furo seguir aberto.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'jobs' AND cmd IN ('SELECT', 'ALL')
     AND lower(btrim(qual)) IN ('true', '(true)');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'jobs ainda tem % policy(s) de leitura USING(true)', v_n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'jobs' AND policyname = 'jobs_select_scoped') THEN
    RAISE EXCEPTION 'jobs_select_scoped nao foi criada';
  END IF;

  IF has_function_privilege('anon', 'public.session_is_job_participant(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon tem EXECUTE em session_is_job_participant';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.session_is_job_participant(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated sem EXECUTE em session_is_job_participant';
  END IF;
END $$;
