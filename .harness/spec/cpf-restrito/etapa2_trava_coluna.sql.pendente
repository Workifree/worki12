-- RASCUNHO da etapa 2 de cpf-restrito. NAO e migration: fora de supabase/migrations de proposito.
-- Aplicar SOMENTE depois que o frontend da etapa 1 estiver publicado em producao (main + Vercel),
-- porque o select('*') do site antigo em workers passa a falhar com 42501.
-- Nome final sugerido: supabase/migrations/<timestamp>_cpf_trava_coluna.sql
--
-- Opcao escolhida: privilegio por coluna (ver ADR, opcao A). Retira SELECT de cpf/birth_date de
-- anon/authenticated; mantem INSERT/UPDATE (o freela ainda grava pela policy de self).
-- Nao afetados: funcoes SECURITY DEFINER de postgres (render/generate/accept_service_term,
-- bonus_worker_exclusion, anonymize_account, get_shift_worker_payment_card, get_my_worker_profile)
-- e service_role (delete-account, admin-data).
--
-- Pre-checagem obrigatoria no catalogo antes de aplicar (deve voltar zero linhas que leiam cpf/
-- birth_date ou workers.* sob INVOKER):
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND NOT p.prosecdef
--      AND p.prosrc ~* 'workers' AND p.prosrc ~* '(cpf|birth_date|w\.\*|workers\.\*|select \*)';

-- Pre-condicoes e trava (idempotente: pode reaplicar).
DO $$
DECLARE
    v_cols text;
    v_sig text;
    v_oid oid;
BEGIN
    FOREACH v_sig IN ARRAY ARRAY['public.get_my_worker_profile()', 'public.set_my_worker_identity(text,date)'] LOOP
        v_oid := to_regprocedure(v_sig);
        IF v_oid IS NULL THEN
            RAISE EXCEPTION 'PRECONDICAO cpf-restrito etapa 2: etapa 1 nao aplicada (% ausente). HALT.', v_sig;
        END IF;
        IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid)
           OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
           OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'PRECONDICAO cpf-restrito etapa 2: % sem DEFINER ou com grants errados. HALT.', v_sig;
        END IF;
    END LOOP;

    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'workers'
           AND column_name IN ('cpf', 'birth_date')) <> 2 THEN
        RAISE EXCEPTION 'PRECONDICAO cpf-restrito etapa 2: workers.cpf/birth_date ausentes. HALT.';
    END IF;

    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
      INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'workers'
       AND column_name NOT IN ('cpf', 'birth_date');

    EXECUTE 'REVOKE SELECT ON public.workers FROM anon, authenticated';
    EXECUTE format('GRANT SELECT (%s) ON public.workers TO authenticated', v_cols);
END;
$$;

COMMENT ON COLUMN public.workers.cpf IS
    'Sem SELECT para authenticated (cpf-restrito etapa 2). Ler via get_my_worker_profile (self) ou '
    'funcoes DEFINER (termo de servico). Coluna nova em workers precisa de GRANT SELECT (col) explicito.';

-- Assercoes finais por catalogo. has_column_privilege enxerga tambem PUBLIC e heranca de papel.
DO $post$
DECLARE
    v_col record;
BEGIN
    FOR v_col IN
        SELECT a.attname, a.attnum FROM pg_attribute a
         WHERE a.attrelid = 'public.workers'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    LOOP
        IF v_col.attname IN ('cpf', 'birth_date') THEN
            IF has_column_privilege('authenticated', 'public.workers'::regclass, v_col.attnum, 'SELECT') THEN
                RAISE EXCEPTION 'VERIFICACAO etapa 2: authenticated ainda le workers.%. HALT.', v_col.attname;
            END IF;
        ELSIF NOT has_column_privilege('authenticated', 'public.workers'::regclass, v_col.attnum, 'SELECT') THEN
            RAISE EXCEPTION 'VERIFICACAO etapa 2: authenticated sem SELECT em workers.%. HALT.', v_col.attname;
        END IF;
    END LOOP;
    IF has_any_column_privilege('anon', 'public.workers', 'SELECT') THEN
        RAISE EXCEPTION 'VERIFICACAO etapa 2: anon ainda tem SELECT em workers. HALT.';
    END IF;
END;
$post$;

NOTIFY pgrst, 'reload schema';

-- DOWN:
--   GRANT SELECT ON public.workers TO authenticated;
--   NOTIFY pgrst, 'reload schema';
--   (anon: so restaurar o SELECT se o catalogo mostrava o privilegio antes de aplicar.)
