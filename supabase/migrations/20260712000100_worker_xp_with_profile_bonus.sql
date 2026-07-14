-- XP coerente: fonte única de verdade recompute_worker_aggregates(worker).
-- xp = turnos_concluidos*100 + bônus de perfil (foto +50, especialidades +75).
-- Chamada pelo trigger de conclusão E via wrapper recompute_my_aggregates (migration
-- seguinte) quando o perfil muda. SECURITY DEFINER + search_path='' + idempotente.
-- (Aplicada em prod via MCP; versionada aqui para não haver drift — ADR pagamento/xp.)

CREATE OR REPLACE FUNCTION public.recompute_worker_aggregates(p_worker_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count int; v_earnings numeric; v_bonus int; v_xp int;
BEGIN
  IF p_worker_id IS NULL THEN RETURN; END IF;

  SELECT COUNT(*)::int, COALESCE(SUM(j.budget), 0)
    INTO v_count, v_earnings
  FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE a.worker_id = p_worker_id AND a.status = 'completed';

  SELECT
    (CASE WHEN w.avatar_url IS NOT NULL AND w.avatar_url <> '' THEN 50 ELSE 0 END)
    + (CASE WHEN (w.primary_role IS NOT NULL AND w.primary_role <> '')
               OR (w.roles IS NOT NULL AND jsonb_typeof(w.roles) = 'array' AND jsonb_array_length(w.roles) > 0)
            THEN 75 ELSE 0 END)
    INTO v_bonus
  FROM public.workers w WHERE w.id = p_worker_id;

  v_xp := v_count * 100 + COALESCE(v_bonus, 0);

  UPDATE public.workers SET
    completed_jobs_count = v_count,
    earnings_total       = v_earnings,
    xp                   = v_xp,
    level                = public.worker_level_for_xp(v_xp)
  WHERE id = p_worker_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_worker_aggregates(uuid) TO service_role;

-- Trigger de conclusão delega para a função única.
CREATE OR REPLACE FUNCTION public.update_worker_completion_aggregates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.recompute_worker_aggregates(NEW.worker_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.workers LOOP
    PERFORM public.recompute_worker_aggregates(r.id);
  END LOOP;
END $$;
