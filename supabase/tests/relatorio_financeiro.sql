-- Teste de catalogo: relatorio financeiro e planilha (ADR-20261127). Roda APOS a migration
-- 20261205000200, somente leitura (so DO com asserts). Falha com EXCEPTION.
DO $t$
DECLARE r record; v_def text;
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
        AND proname IN ('get_financial_report', 'get_payment_sheet')) <> 2 THEN
    RAISE EXCEPTION 'faltam RPCs';
  END IF;

  -- 1. DEFINER, search_path vazio, grants sem anon
  FOR r IN SELECT p.oid, p.proname, p.prosecdef, p.proconfig
             FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('get_financial_report', 'get_payment_sheet') LOOP
    IF NOT r.prosecdef THEN RAISE EXCEPTION '% nao e SECURITY DEFINER', r.proname; END IF;
    IF NOT (r.proconfig @> ARRAY['search_path=""']) THEN RAISE EXCEPTION '% sem search_path vazio', r.proname; END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN RAISE EXCEPTION '% executavel por anon', r.proname; END IF;
    IF NOT has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN RAISE EXCEPTION '% sem EXECUTE p/ authenticated', r.proname; END IF;
    IF NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN RAISE EXCEPTION '% sem EXECUTE p/ service_role', r.proname; END IF;
  END LOOP;

  -- 2. get_financial_report nunca referencia PII
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_financial_report';
  IF v_def ~* '\mcpf\M|pix_key' THEN RAISE EXCEPTION 'get_financial_report referencia cpf/pix_key'; END IF;

  -- 3. get_payment_sheet: Gestor-only e grava log
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_payment_sheet';
  IF v_def NOT LIKE '%is_company_owner%' THEN RAISE EXCEPTION 'get_payment_sheet sem is_company_owner'; END IF;
  IF v_def NOT LIKE '%payment_sheet_exports%' THEN RAISE EXCEPTION 'get_payment_sheet nao grava log'; END IF;
  IF v_def LIKE '%internal_company_confirmed_operator%' THEN RAISE EXCEPTION 'planilha nao pode admitir encarregado'; END IF;

  -- 4. tabela de log
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.payment_sheet_exports'::regclass) THEN
    RAISE EXCEPTION 'payment_sheet_exports sem RLS';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
               AND table_name = 'payment_sheet_exports' AND column_name IN ('cpf', 'pix_key', 'full_name')) THEN
    RAISE EXCEPTION 'payment_sheet_exports com coluna de PII';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.conrelid = 'public.payment_sheet_exports'::regclass AND c.contype = 'f'
                AND c.conkey @> ARRAY[(SELECT attnum FROM pg_attribute
                      WHERE attrelid = 'public.payment_sheet_exports'::regclass AND attname = 'generated_by')]) THEN
    RAISE EXCEPTION 'generated_by nao pode ter FK';
  END IF;
  IF has_table_privilege('anon', 'public.payment_sheet_exports', 'SELECT')
     OR has_table_privilege('authenticated', 'public.payment_sheet_exports', 'INSERT')
     OR has_table_privilege('authenticated', 'public.payment_sheet_exports', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.payment_sheet_exports', 'DELETE')
     OR has_table_privilege('service_role', 'public.payment_sheet_exports', 'UPDATE')
     OR has_table_privilege('service_role', 'public.payment_sheet_exports', 'DELETE') THEN
    RAISE EXCEPTION 'grants indevidos em payment_sheet_exports';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'payment_sheet_exports' AND cmd = 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'payment_sheet_exports' AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'policies de payment_sheet_exports devem ser so SELECT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.payment_sheet_exports'::regclass
                   AND tgname = 'trg_payment_sheet_exports_immutable' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'trigger de imutabilidade ausente';
  END IF;
END
$t$;
SELECT 'relatorio_financeiro: catalogo OK' AS resultado;
