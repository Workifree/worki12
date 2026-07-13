-- Consolida e protege o cálculo de XP/agregados do worker (review do harness-architect).
-- (Aplicada em prod via MCP; versionada aqui para não haver drift.)
--
-- DOWN (rollback): não recria os triggers legados (eram buggy); reexpor recompute a
-- authenticated NÃO é recomendado.

-- 1) Remove triggers/função LEGADOS de XP. `award_xp_on_job_completion` NÃO era
--    SECURITY DEFINER → quando a EMPRESA concluía o turno o UPDATE em workers era
--    bloqueado pelo RLS (invoker sem permissão na linha do worker) = causa REAL de
--    "XP/ganhos/turnos não aumentavam". E coexistindo com o recompute novo, incrementava
--    por cima (dupla contagem). Fica só o recompute SECURITY DEFINER.
DROP TRIGGER IF EXISTS trigger_award_xp_on_completion ON public.applications;
DROP TRIGGER IF EXISTS trigger_award_xp_on_completion_insert ON public.applications;
DROP FUNCTION IF EXISTS public.award_xp_on_job_completion();

-- 2) Least-privilege: recompute_worker_aggregates(uuid) aceita worker arbitrário e é
--    SECURITY DEFINER — não pode ficar exposta a PUBLIC/anon/authenticated via PostgREST.
REVOKE EXECUTE ON FUNCTION public.recompute_worker_aggregates(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_worker_aggregates(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recompute_worker_aggregates(uuid) FROM authenticated;

-- 3) Wrapper seguro para o CLIENT: worker recomputa o PRÓPRIO XP (auth.uid()) após editar
--    o perfil (foto/especialidades mudam o bônus). Só a própria linha.
CREATE OR REPLACE FUNCTION public.recompute_my_aggregates()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RETURN; END IF;
    PERFORM public.recompute_worker_aggregates(auth.uid());
END;
$$;
REVOKE EXECUTE ON FUNCTION public.recompute_my_aggregates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_my_aggregates() TO authenticated;

-- 4) Backfill de limpeza (recompute canônico apaga dupla contagem anterior).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.workers LOOP
    PERFORM public.recompute_worker_aggregates(r.id);
  END LOOP;
END $$;
