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
-- Tambem remove a policy de INSERT "Workers can insert applications" (worker_id = auth.uid(), status <> invited/declined,
-- qualquer job_id): com a leitura via participacao, ela deixaria o freela se auto-conceder leitura de QUALQUER turno
-- por uuid (INSERT de application em job alheio). O frontend nao tem INSERT de candidatura pull (fluxo push); o
-- convite da empresa segue por applications_insert_company_invite e o aceite por claim_shift_slot (DEFINER).
--
-- Indices: nenhum novo. applications tem UNIQUE (job_id, worker_id); shift_calls tem idx_shift_calls_job e
-- shift_call_targets tem UNIQUE (call_id, worker_id) (o EXISTS entra por call_id); shift_payments tem idx_shift_payments_job.
--
-- Ordem de deploy: esta migration ANTES de qualquer frontend. Nenhum ajuste de frontend e obrigatorio.
--
-- DOWN (restaura o estado anterior, INCLUSIVE o furo):
--   DROP POLICY IF EXISTS jobs_select_scoped ON public.jobs;
--   CREATE POLICY jobs_select_authenticated ON public.jobs FOR SELECT TO authenticated USING (true);
--   DROP FUNCTION IF EXISTS public.session_is_job_participant(uuid);
--   CREATE POLICY "Workers can insert applications" ON public.applications FOR INSERT TO authenticated
--     WITH CHECK ((worker_id = auth.uid()) AND (status <> ALL (ARRAY['invited','declined'])) AND (invited_by_company_at IS NULL));

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
                WHERE c.job_id = p_job_id AND t.worker_id = (SELECT auth.uid())
                  -- SOS e descoberta fora do elenco: o alvo so le o turno enquanto o chamado esta aberto e nao
                  -- expirado, ou depois de aceitar. Recusou/perdeu/expirou = perde a leitura. Alvo 'team' mantem.
                  AND (COALESCE(c.origin, 'team') <> 'sos'
                       OR t.response = 'accepted'
                       OR (c.status = 'open' AND c.expires_at > now())))
    OR EXISTS (SELECT 1 FROM public.shift_payments sp
                WHERE sp.job_id = p_job_id AND sp.worker_id = (SELECT auth.uid()))
  );
$$;

REVOKE ALL ON FUNCTION public.session_is_job_participant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_is_job_participant(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.session_is_job_participant(uuid) IS
  'Ramo do freela na leitura de jobs. Sempre sobre auth.uid(). DEFINER para quebrar o ciclo jobs->applications->is_job_owner->jobs (42P17). ADR-20261127-leitura-de-turnos-do-encarregado.';

DROP POLICY IF EXISTS "Workers can insert applications" ON public.applications;
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
   WHERE schemaname = 'public' AND tablename = 'jobs' AND cmd IN ('SELECT', 'ALL');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'jobs deve ter exatamente 1 policy de leitura, tem %', v_n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'jobs' AND cmd = 'SELECT'
                    AND policyname = 'jobs_select_scoped' AND lower(btrim(qual)) NOT IN ('true', '(true)')) THEN
    RAISE EXCEPTION 'a unica policy de leitura de jobs nao e jobs_select_scoped (ou e USING(true))';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.jobs'::regclass) THEN
    RAISE EXCEPTION 'RLS desligada em jobs';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'applications' AND cmd = 'INSERT'
                AND policyname = 'Workers can insert applications') THEN
    RAISE EXCEPTION 'policy de INSERT de candidatura pull ainda existe';
  END IF;

  IF has_function_privilege('anon', 'public.session_is_job_participant(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon tem EXECUTE em session_is_job_participant';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.session_is_job_participant(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated sem EXECUTE em session_is_job_participant';
  END IF;
END $$;
