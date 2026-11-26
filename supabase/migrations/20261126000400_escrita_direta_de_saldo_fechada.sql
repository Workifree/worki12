-- Fecha a escrita direta do cliente nas tabelas de saldo (falha pre-existente em producao).
-- File: supabase/migrations/20261126000400_escrita_direta_de_saldo_fechada.sql
--
-- FALHA:
--   (1) escrow_transactions tem policies de INSERT/UPDATE e grant total que so exigem carteira propria:
--       o cliente forja 'reserved' com qualquer amount (ou reabre um 'refunded' trocando job_id) e
--       chama refund_escrow, que credita saldo; escrow falso tambem ocupa job alheio e e pago pelo
--       gatilho de conclusao.
--   (2) INSERT em wallets so exige user_id = auth.uid(): quem nao tem carteira cria com qualquer saldo.
--
-- Escritas diretas do frontend (branch e main, 26/11/2026): so WalletService.getOrCreateWallet,
-- insert {user_id, balance: 0, user_type}. Nenhuma em escrow_transactions/wallet_transactions.
-- Edge Functions escrevem com service_role.
--
-- wallets usa trigger SECURITY INVOKER lendo current_user (padrao de 20261125000100): vale mesmo que
-- exista outra policy permissiva criada fora do repositorio; WITH CHECK nao daria essa garantia e
-- GRANT por coluna nao restringe o VALOR de balance. A funcao NUNCA pode virar SECURITY DEFINER.
-- UPDATE de wallets por authenticated nao e alterado aqui.
--
-- ATENCAO: nenhuma linha e alterada. Escrows/carteiras forjados ANTES desta migration continuam la
-- (e um 'reserved' forjado ainda e estornavel). Auditar antes/depois de aplicar:
--   SELECT e.* FROM public.escrow_transactions e
--    WHERE NOT EXISTS (SELECT 1 FROM public.wallet_transactions t
--                       WHERE t.wallet_id = e.company_wallet_id AND t.reference_id = e.job_id::text
--                         AND t.type IN ('escrow_reserve', 'escrow_authorize'));
--   SELECT w.id, w.balance FROM public.wallets w WHERE w.balance <> 0
--      AND NOT EXISTS (SELECT 1 FROM public.wallet_transactions t WHERE t.wallet_id = w.id);
--
-- Idempotente. Um unico DO: assercao que falhe desfaz tudo.

DO $migration$
DECLARE
    c_razao CONSTANT text[] := ARRAY['escrow_transactions', 'wallet_transactions'];
    c_colunas_wallet CONSTANT text[] := ARRAY[
        'id', 'user_id', 'user_type', 'balance', 'created_at', 'updated_at', 'asaas_account_status'];
    v_tab text;
    v_role text;
    v_priv text;
    v_bad text;
    v_roles text;
    r record;
BEGIN
    -- ---------------------------------------------------------------- pre-condicoes
    -- FORCE RLS faria as funcoes DEFINER (dono da tabela) dependerem das policies removidas.
    SELECT string_agg(c.relname::text, ', ') INTO v_bad
      FROM pg_catalog.pg_class c
     WHERE c.oid IN ('public.wallets'::regclass, 'public.escrow_transactions'::regclass,
                     'public.wallet_transactions'::regclass)
       AND (NOT c.relrowsecurity OR c.relforcerowsecurity);
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'pre-condicao: RLS desligada ou FORCE RLS em %', v_bad;
    END IF;

    -- Funcao INVOKER que escreve no razao quebraria com o REVOKE (comentarios ignorados).
    SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND NOT p.prosecdef
       AND regexp_replace(p.prosrc, '--[^\r\n]*', '', 'g')
           ~* '[[:<:]](insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+(public\.)?(escrow_transactions|wallet_transactions)[[:>:]]';
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'pre-condicao: funcao INVOKER escreve no razao: %', v_bad;
    END IF;

    -- Coluna extra com default (ou gerada) chegaria preenchida ao guard e quebraria o cadastro legitimo.
    SELECT string_agg(a.attname::text, ', ') INTO v_bad
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.wallets'::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND (a.atthasdef OR a.attidentity <> '')
       AND a.attname::text <> ALL (c_colunas_wallet);
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'pre-condicao: coluna de wallets com default fora da lista permitida: %', v_bad;
    END IF;

    -- Trigger BEFORE INSERT que rode DEPOIS do guard (ordem alfabetica) poderia reescrever o saldo.
    -- tgtype: 2=BEFORE, 4=INSERT
    SELECT string_agg(t.tgname::text, ', ') INTO v_bad
      FROM pg_catalog.pg_trigger t
     WHERE t.tgrelid = 'public.wallets'::regclass AND NOT t.tgisinternal
       AND (t.tgtype & 6) = 6
       AND t.tgname::text COLLATE "C" > 'trg_zz_wallets_insert_guard';
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'pre-condicao: trigger BEFORE INSERT em wallets roda depois do guard: %', v_bad;
    END IF;

    -- ---------------------------------------------------------------- policies de escrita do razao
    FOR r IN
        SELECT p.tablename, p.policyname, p.cmd, p.permissive, p.roles, p.qual
          FROM pg_catalog.pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename::text = ANY (c_razao)
           AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
        -- ALL tambem concedia SELECT: recria a leitura com o mesmo predicado, tipo e papeis.
        IF r.cmd = 'ALL' AND r.qual IS NOT NULL THEN
            SELECT string_agg(CASE WHEN x = 'public' THEN 'PUBLIC' ELSE quote_ident(x) END, ', ')
              INTO v_roles FROM unnest(r.roles::text[]) x;
            EXECUTE format('CREATE POLICY %I ON public.%I AS %s FOR SELECT TO %s USING (%s)',
                           left(r.policyname, 50) || ' (select)', r.tablename, r.permissive, v_roles, r.qual);
        END IF;
    END LOOP;

    -- ---------------------------------------------------------------- grants
    -- REVOKE na tabela tambem derruba os privilegios por coluna correspondentes.
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.escrow_transactions, public.wallet_transactions
        FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.escrow_transactions, public.wallet_transactions
        TO service_role;

    REVOKE DELETE, TRUNCATE ON public.wallets FROM PUBLIC, anon, authenticated;
    REVOKE INSERT, UPDATE ON public.wallets FROM PUBLIC, anon;
    GRANT INSERT ON public.wallets TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallets TO service_role;

    -- ---------------------------------------------------------------- guard de criacao de carteira
    CREATE OR REPLACE FUNCTION public.wallets_insert_guard()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = ''
    AS $guard$
    BEGIN
        -- Servidor: funcao SECURITY DEFINER (dono), service_role, cron/manutencao.
        IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
            RETURN NEW;
        END IF;

        -- COALESCE: balance NULL tambem cai na recusa.
        IF NOT COALESCE(NEW.balance = 0, false) THEN
            RAISE EXCEPTION 'wallets_insert_guard: carteira nova nasce com saldo zero.'
                USING ERRCODE = '42501';
        END IF;

        -- Lista de permitidos: demais asaas_* e qualquer coluna futura tem de vir NULL.
        IF pg_catalog.jsonb_strip_nulls(
               pg_catalog.to_jsonb(NEW)
               - ARRAY['id', 'user_id', 'user_type', 'balance', 'created_at', 'updated_at', 'asaas_account_status']
           ) <> '{}'::jsonb THEN
            RAISE EXCEPTION 'wallets_insert_guard: coluna nao permitida na criacao.'
                USING ERRCODE = '42501';
        END IF;

        -- asaas_account_status tem DEFAULT em producao (chega preenchida): o valor do cliente e
        -- descartado. populate_record ignora a chave onde a coluna nao existe (20260305000000).
        NEW := pg_catalog.jsonb_populate_record(
            NEW, '{"asaas_account_status": {"general": "PENDING"}}'::jsonb);
        NEW.created_at := pg_catalog.now();
        NEW.updated_at := pg_catalog.now();
        RETURN NEW;
    END;
    $guard$;

    DROP TRIGGER IF EXISTS trg_zz_wallets_insert_guard ON public.wallets;
    CREATE TRIGGER trg_zz_wallets_insert_guard
        BEFORE INSERT ON public.wallets
        FOR EACH ROW EXECUTE FUNCTION public.wallets_insert_guard();

    -- ---------------------------------------------------------------- assercoes finais
    SELECT string_agg(p.tablename || '.' || p.policyname, ', ') INTO v_bad
      FROM pg_catalog.pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename::text = ANY (c_razao) AND p.cmd <> 'SELECT';
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'assercao: policy de escrita restante: %', v_bad;
    END IF;

    -- has_*_privilege enxerga PUBLIC e heranca; pega REVOKE que virou no-op (outro grantor).
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_tab IN ARRAY c_razao LOOP
            FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
                IF has_table_privilege(v_role, 'public.' || v_tab, v_priv) THEN
                    RAISE EXCEPTION 'assercao: % ainda tem % em %', v_role, v_priv, v_tab;
                END IF;
            END LOOP;
            IF has_any_column_privilege(v_role, 'public.' || v_tab, 'INSERT, UPDATE') THEN
                RAISE EXCEPTION 'assercao: % ainda escreve coluna em %', v_role, v_tab;
            END IF;
        END LOOP;
        IF has_table_privilege(v_role, 'public.wallets', 'DELETE')
           OR has_table_privilege(v_role, 'public.wallets', 'TRUNCATE')
           OR has_table_privilege(v_role, 'public.wallets', 'UPDATE')
           OR has_column_privilege(v_role, 'public.wallets', 'balance', 'UPDATE') THEN
            RAISE EXCEPTION 'assercao: % ainda apaga ou altera saldo em wallets', v_role;
        END IF;
    END LOOP;
    IF has_any_column_privilege('anon', 'public.wallets', 'INSERT, UPDATE') THEN
        RAISE EXCEPTION 'assercao: anon ainda escreve em wallets';
    END IF;
    IF NOT has_table_privilege('authenticated', 'public.wallets', 'INSERT') THEN
        RAISE EXCEPTION 'assercao: authenticated perdeu INSERT em wallets';
    END IF;
    FOREACH v_tab IN ARRAY c_razao || 'wallets'::text LOOP
        IF NOT (has_table_privilege('service_role', 'public.' || v_tab, 'INSERT')
                AND has_table_privilege('service_role', 'public.' || v_tab, 'UPDATE')) THEN
            RAISE EXCEPTION 'assercao: service_role sem escrita em %', v_tab;
        END IF;
    END LOOP;

    -- View gravavel sem security_invoker escreveria como o dono, contornando REVOKE e RLS.
    SELECT string_agg(DISTINCT v.oid::regclass::text, ', ') INTO v_bad
      FROM pg_catalog.pg_depend d
      JOIN pg_catalog.pg_rewrite w ON w.oid = d.objid AND d.classid = 'pg_catalog.pg_rewrite'::regclass
      JOIN pg_catalog.pg_class v ON v.oid = w.ev_class AND v.relkind = 'v'
     WHERE d.refobjid IN ('public.wallets'::regclass, 'public.escrow_transactions'::regclass,
                          'public.wallet_transactions'::regclass)
       AND NOT COALESCE(v.reloptions::text ~* 'security_invoker=(true|on|1)', false)
       AND pg_catalog.pg_relation_is_updatable(v.oid, true) <> 0
       AND (has_table_privilege('anon', v.oid, 'INSERT, UPDATE, DELETE')
            OR has_table_privilege('authenticated', v.oid, 'INSERT, UPDATE, DELETE'));
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'assercao: view gravavel por cliente sobre tabela de saldo: %', v_bad;
    END IF;

    IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p
         WHERE p.oid = 'public.wallets_insert_guard()'::regprocedure) THEN
        RAISE EXCEPTION 'assercao: wallets_insert_guard nao pode ser SECURITY DEFINER';
    END IF;
    -- tgtype 7 = ROW + BEFORE + INSERT
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger t
         WHERE t.tgrelid = 'public.wallets'::regclass AND t.tgname = 'trg_zz_wallets_insert_guard'
           AND t.tgfoid = 'public.wallets_insert_guard()'::regprocedure
           AND t.tgtype = 7 AND t.tgenabled = 'O' AND t.tgqual IS NULL) THEN
        RAISE EXCEPTION 'assercao: trigger de wallets ausente ou divergente';
    END IF;
END
$migration$;

NOTIFY pgrst, 'reload schema';

-- DOWN (rollback). ATENCAO: reabre a falha (cliente volta a forjar saldo).
--   DROP TRIGGER IF EXISTS trg_zz_wallets_insert_guard ON public.wallets;
--   DROP FUNCTION IF EXISTS public.wallets_insert_guard();
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.escrow_transactions, public.wallet_transactions
--     TO anon, authenticated;
--   GRANT DELETE, TRUNCATE ON public.wallets TO anon, authenticated;
--   GRANT INSERT, UPDATE ON public.wallets TO anon;
--   Policies removidas (conferidas no catalogo real):
--   CREATE POLICY "Users can insert their escrow" ON public.escrow_transactions FOR INSERT TO public
--     WITH CHECK (company_wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));
--   CREATE POLICY "Users can update their escrow" ON public.escrow_transactions FOR UPDATE TO public
--     USING (company_wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));
--   NOTIFY pgrst, 'reload schema';
