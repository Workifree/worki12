-- Pendencias de banco: UPDATE de wallets pelo cliente, search_path dos contadores de visualizacao e
-- agregado de avaliacoes em UPDATE/DELETE.
-- File: supabase/migrations/20261126000500_pendencias_wallet_views_avaliacoes.sql
--
-- (1) authenticated ainda atualizava wallets.asaas_customer_id da propria carteira (20260311300000).
--     git grep (branch e main, 25/11/2026): nenhum cliente faz update/upsert em wallets; so
--     asaas-deposit e asaas-tokenize-card, com service_role.
-- (2) increment_worker_view / increment_job_view (esta nao esta nas migrations): so ALTER FUNCTION.
-- (3) rating_average/reviews_count so eram recalculados no INSERT. O gatilho novo cobre APENAS
--     UPDATE e DELETE (o INSERT segue com as funcoes vigentes), com a mesma formula e filtros de
--     20260622000200. Erro nele NAO e engolido: aborta a escrita em reviews.
--
-- Nenhum saldo e movido. Idempotente. Um unico DO: qualquer excecao desfaz tudo.

DO $migration$
DECLARE
    c_trigger CONSTANT text := 'trg_zz_reviews_rating_recalc';
    v_bad text;
    v_src text;
    v_cfg text;
    v_base text;
    v_role text;
    v_tab text;
    v_dir text;
    v_filtro text;
    v_n bigint;
    r record;
BEGIN
    -- ================================================================ pre-condicoes
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            RAISE EXCEPTION 'pre-condicao: role % ausente', v_role;
        END IF;
    END LOOP;
    FOREACH v_tab IN ARRAY ARRAY['wallets', 'reviews', 'workers', 'companies'] LOOP
        IF pg_catalog.to_regclass('public.' || v_tab) IS NULL THEN
            RAISE EXCEPTION 'pre-condicao: tabela public.% ausente', v_tab;
        END IF;
    END LOOP;

    -- Funcao INVOKER que atualize wallets quebraria com o REVOKE.
    SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND NOT p.prosecdef
       AND regexp_replace(p.prosrc, '--[^\r\n]*', '', 'g')
           ~* '([[:<:]]update[[:space:]]+(only[[:space:]]+)?(public\.)?wallets[[:>:]])|([[:<:]]insert[[:space:]]+into[[:space:]]+(public\.)?wallets[[:>:]][^;]*[[:<:]]do[[:space:]]+update[[:>:]])';
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'pre-condicao: funcao INVOKER atualiza wallets: %', v_bad;
    END IF;

    -- Colunas do agregado: precisam existir; NOT NULL sem default impediria "voltar ao padrao".
    FOREACH v_tab IN ARRAY ARRAY['workers', 'companies'] LOOP
        IF (SELECT count(*) FROM pg_catalog.pg_attribute a
             WHERE a.attrelid = ('public.' || v_tab)::regclass AND NOT a.attisdropped
               AND a.attname IN ('rating_average', 'reviews_count')) <> 2 THEN
            RAISE EXCEPTION 'pre-condicao: colunas de agregado ausentes em %', v_tab;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                    WHERE a.attrelid = ('public.' || v_tab)::regclass AND a.attname = 'rating_average'
                      AND a.attnotnull AND NOT a.atthasdef) THEN
            RAISE EXCEPTION 'pre-condicao: %.rating_average e NOT NULL sem default', v_tab;
        END IF;
    END LOOP;
    IF (SELECT count(*) FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = 'public.reviews'::regclass AND NOT a.attisdropped
           AND a.attname IN ('reviewed_id', 'rating', 'direction')) <> 3 THEN
        RAISE EXCEPTION 'pre-condicao: colunas de reviews ausentes';
    END IF;

    -- A formula e os filtros vigentes no BANCO precisam ser os que este arquivo replica
    -- (comparacao sem comentarios, sem espacos e sem o prefixo public.).
    FOREACH v_dir IN ARRAY ARRAY['worker', 'company'] LOOP
        v_filtro := CASE v_dir WHEN 'worker' THEN '(directionisnullordirection=''worker'')'
                               ELSE 'direction=''company''' END;
        SELECT replace(regexp_replace(lower(regexp_replace(p.prosrc, '--[^\r\n]*', '', 'g')),
                                      '[[:space:]]+', '', 'g'), 'public.', '')
          INTO v_src
          FROM pg_catalog.pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname = 'update_' || v_dir || '_rating_on_review' AND p.pronargs = 0;
        v_base := 'fromreviewswherereviewed_id::text=new.reviewed_id::textand' || v_filtro || ')';
        IF v_src IS NULL
           OR strpos(v_src, 'selectround(avg(rating)::numeric,1)' || v_base) = 0
           OR strpos(v_src, 'selectcount(*)' || v_base) = 0
           OR strpos(v_src, CASE v_dir WHEN 'worker' THEN 'ifnew.directionisdistinctfrom''company''then'
                                       ELSE 'ifnew.direction=''company''then' END) = 0 THEN
            RAISE EXCEPTION 'pre-condicao: update_%_rating_on_review ausente ou com formula/filtro divergente', v_dir;
        END IF;
    END LOOP;

    -- O recalculo tem de ter a ultima palavra: nenhum AFTER ROW de UPDATE/DELETE que escreva a
    -- media pode rodar depois dele. tgtype: 1=ROW, 2=BEFORE, 8=DELETE, 16=UPDATE, 64=INSTEAD
    SELECT string_agg(t.tgname::text, ', ') INTO v_bad
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
     WHERE t.tgrelid = 'public.reviews'::regclass AND NOT t.tgisinternal
       AND (t.tgtype & 67) = 1 AND (t.tgtype & 24) <> 0
       AND t.tgname::text COLLATE "C" > c_trigger
       AND p.prosrc ~* 'rating_average|reviews_count';
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'pre-condicao: trigger de agregado roda depois do recalculo: %', v_bad;
    END IF;

    -- Terceiros (ex.: update_average_rating) nao sao tocados; apenas denunciados.
    FOR r IN
        SELECT t.tgname, p.oid::regprocedure AS funcao, pg_catalog.pg_get_triggerdef(t.oid) AS def
          FROM pg_catalog.pg_trigger t
          JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
         WHERE t.tgrelid = 'public.reviews'::regclass AND NOT t.tgisinternal
           AND t.tgname <> c_trigger
           AND p.proname NOT IN ('update_worker_rating_on_review', 'update_company_rating_on_review')
           AND p.prosrc ~* 'rating_average|reviews_count'
    LOOP
        RAISE WARNING 'outro gatilho escreve o agregado (conferir): % -> % :: %', r.tgname, r.funcao, r.def;
    END LOOP;

    -- ================================================================ (1) wallets
    DROP POLICY IF EXISTS "Users can update own wallet safe fields" ON public.wallets;
    -- REVOKE na tabela tambem derruba os privilegios por coluna.
    REVOKE UPDATE ON public.wallets FROM PUBLIC, anon, authenticated;
    GRANT UPDATE ON public.wallets TO service_role;

    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF has_table_privilege(v_role, 'public.wallets', 'UPDATE')
           OR has_any_column_privilege(v_role, 'public.wallets', 'UPDATE') THEN
            RAISE EXCEPTION 'assercao: % ainda atualiza wallets', v_role;
        END IF;
    END LOOP;
    IF NOT has_table_privilege('service_role', 'public.wallets', 'UPDATE') THEN
        RAISE EXCEPTION 'assercao: service_role sem UPDATE em wallets';
    END IF;

    -- ================================================================ (2) contadores
    FOR r IN
        SELECT p.oid, p.oid::regprocedure AS assinatura, p.prosrc, p.proconfig, l.lanname
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_language l ON l.oid = p.prolang
         WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
           AND p.proname IN ('increment_job_view', 'increment_worker_view')
    LOOP
        SELECT substr(c, length('search_path=') + 1) INTO v_cfg
          FROM unnest(r.proconfig) c WHERE c LIKE 'search\_path=%';
        IF NOT FOUND THEN v_cfg := NULL; END IF;

        IF v_cfg = '""' THEN
            CONTINUE; -- ja fixo e vazio
        END IF;

        -- Sem comentarios e literais.
        v_src := regexp_replace(regexp_replace(r.prosrc, '--[^\r\n]*', '', 'g'), '''[^'']*''', '''''', 'g');
        IF COALESCE(replace(replace(v_cfg, '"', ''), ' ', '') IN ('public', 'public,pg_temp'), false)
           OR (r.lanname IN ('sql', 'plpgsql')
               AND v_src ~* '[[:<:]](from|join|update|into)[[:space:]]+(only[[:space:]]+)?(public|pg_catalog)\.'
               -- nenhuma referencia sem schema (na duvida, nao mexe)
               AND regexp_replace(v_src,
                     '[[:<:]](from|join|update|into)[[:space:]]+(only[[:space:]]+)?(public|pg_catalog)\.', '', 'gi')
                   !~* '[[:<:]](from|join|update|into)[[:space:]]+["a-z_]') THEN
            -- pg_temp por ultimo: tabela temporaria nao sombreia as de public.
            EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.assinatura);
            IF (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = r.oid) IS DISTINCT FROM r.prosrc
               OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                               WHERE p.oid = r.oid AND 'search_path=public, pg_temp' = ANY (p.proconfig)) THEN
                RAISE EXCEPTION 'assercao: search_path ou corpo divergente em %', r.assinatura;
            END IF;
        ELSE
            RAISE WARNING 'NAO alterada (nomes sem schema ou search_path inesperado: %): %', v_cfg, r.assinatura;
        END IF;
    END LOOP;

    -- ================================================================ (3) agregado de avaliacoes
    CREATE OR REPLACE FUNCTION public.reviews_rating_recalc()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $recalc$
    DECLARE
        v_workers text[] := '{}';
        v_companies text[] := '{}';
        v_id text;
        v_count bigint;
        v_avg numeric;
    BEGIN
        IF TG_OP = 'UPDATE' THEN
            -- Edicao de comentario (inclusive anonimizacao) nao muda agregado.
            IF OLD.rating IS NOT DISTINCT FROM NEW.rating
               AND OLD.reviewed_id IS NOT DISTINCT FROM NEW.reviewed_id
               AND OLD.direction IS NOT DISTINCT FROM NEW.direction THEN
                RETURN NULL;
            END IF;
            IF NEW.direction IS DISTINCT FROM 'company' THEN
                v_workers := v_workers || NEW.reviewed_id::text;
            ELSE
                v_companies := v_companies || NEW.reviewed_id::text;
            END IF;
        END IF;
        IF OLD.direction IS DISTINCT FROM 'company' THEN
            v_workers := v_workers || OLD.reviewed_id::text;
        ELSE
            v_companies := v_companies || OLD.reviewed_id::text;
        END IF;

        FOR v_id IN SELECT DISTINCT x FROM unnest(v_workers) x WHERE x IS NOT NULL ORDER BY x LOOP
            SELECT count(*), round(avg(rating)::numeric, 1) INTO v_count, v_avg
              FROM public.reviews
             WHERE reviewed_id::text = v_id AND (direction IS NULL OR direction = 'worker');
            IF v_count = 0 THEN
                UPDATE public.workers SET rating_average = DEFAULT, reviews_count = 0 WHERE id::text = v_id;
            ELSE
                UPDATE public.workers SET rating_average = v_avg, reviews_count = v_count WHERE id::text = v_id;
            END IF;
        END LOOP;

        FOR v_id IN SELECT DISTINCT x FROM unnest(v_companies) x WHERE x IS NOT NULL ORDER BY x LOOP
            SELECT count(*), round(avg(rating)::numeric, 1) INTO v_count, v_avg
              FROM public.reviews
             WHERE reviewed_id::text = v_id AND direction = 'company';
            IF v_count = 0 THEN
                UPDATE public.companies SET rating_average = DEFAULT, reviews_count = 0 WHERE id::text = v_id;
            ELSE
                UPDATE public.companies SET rating_average = v_avg, reviews_count = v_count WHERE id::text = v_id;
            END IF;
        END LOOP;

        RETURN NULL;
    END;
    $recalc$;

    REVOKE EXECUTE ON FUNCTION public.reviews_rating_recalc() FROM PUBLIC, anon, authenticated;

    DROP TRIGGER IF EXISTS trg_zz_reviews_rating_recalc ON public.reviews;
    CREATE TRIGGER trg_zz_reviews_rating_recalc
        AFTER UPDATE OR DELETE ON public.reviews
        FOR EACH ROW EXECUTE FUNCTION public.reviews_rating_recalc();

    -- tgtype 25 = ROW + AFTER + DELETE + UPDATE (sem INSERT: nao duplica o efeito vigente)
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger t
         WHERE t.tgrelid = 'public.reviews'::regclass AND t.tgname = c_trigger
           AND t.tgfoid = 'public.reviews_rating_recalc()'::regprocedure
           AND t.tgtype = 25 AND t.tgenabled = 'O' AND t.tgqual IS NULL) THEN
        RAISE EXCEPTION 'assercao: trigger de recalculo ausente ou divergente';
    END IF;

    -- ---------------------------------------------------------------- reconciliacao
    -- Somente linhas com reviews_count divergente (inclui count > 0 sem avaliacao).
    FOREACH v_dir IN ARRAY ARRAY['worker', 'company'] LOOP
        v_tab := CASE v_dir WHEN 'worker' THEN 'workers' ELSE 'companies' END;
        v_filtro := CASE v_dir WHEN 'worker' THEN '(rv.direction IS NULL OR rv.direction = ''worker'')'
                               ELSE 'rv.direction = ''company''' END;

        EXECUTE format(
            'UPDATE public.%1$I t SET rating_average = DEFAULT, reviews_count = 0
              WHERE t.reviews_count IS DISTINCT FROM 0
                AND NOT EXISTS (SELECT 1 FROM public.reviews rv
                                 WHERE rv.reviewed_id::text = t.id::text AND %2$s)', v_tab, v_filtro);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        RAISE NOTICE 'reconciliacao %: % linha(s) sem avaliacao', v_tab, v_n;

        EXECUTE format(
            'UPDATE public.%1$I t SET rating_average = s.m, reviews_count = s.n
               FROM (SELECT rv.reviewed_id::text AS id, count(*) AS n, round(avg(rv.rating)::numeric, 1) AS m
                       FROM public.reviews rv WHERE %2$s GROUP BY 1) s
              WHERE t.id::text = s.id AND t.reviews_count IS DISTINCT FROM s.n', v_tab, v_filtro);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        RAISE NOTICE 'reconciliacao %: % linha(s) com contagem divergente', v_tab, v_n;

        EXECUTE format(
            'SELECT count(*) FROM public.%1$I t
              WHERE t.reviews_count IS DISTINCT FROM
                    (SELECT count(*) FROM public.reviews rv WHERE rv.reviewed_id::text = t.id::text AND %2$s)',
            v_tab, v_filtro) INTO v_n;
        IF v_n <> 0 THEN
            RAISE EXCEPTION 'assercao: % linha(s) de % seguem divergentes', v_n, v_tab;
        END IF;
    END LOOP;
END
$migration$;

NOTIFY pgrst, 'reload schema';

-- DOWN (rollback). A reconciliacao nao e revertida (os valores anteriores eram incoerentes).
--   DROP TRIGGER IF EXISTS trg_zz_reviews_rating_recalc ON public.reviews;
--   DROP FUNCTION IF EXISTS public.reviews_rating_recalc();
--   GRANT UPDATE (asaas_customer_id) ON public.wallets TO authenticated;
--   CREATE POLICY "Users can update own wallet safe fields" ON public.wallets FOR UPDATE TO authenticated
--     USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
--   search_path: restaurar o proconfig anotado no catalogo antes de aplicar.
--   NOTIFY pgrst, 'reload schema';
