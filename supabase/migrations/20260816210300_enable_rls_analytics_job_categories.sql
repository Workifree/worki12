-- Migration: CONDICIONAL — ligar RLS em `analytics_events` e `job_categories`
-- File: supabase/migrations/20260816210300_enable_rls_analytics_job_categories.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260816-rls-desligada-jobs-conversation.md
--
-- ############################################################################
-- ##  APLIQUE ESTA MIGRATION SOMENTE SE O CENSO MOSTRAR relrowsecurity = f   ##
-- ##  PARA `analytics_events` OU `job_categories`. Caso contrário, PULE.     ##
-- ############################################################################
--
-- POR QUE ELA EXISTE (hipótese a confirmar):
--   Toda a evidência aponta que 20260309000000_enable_rls_all_tables.sql NUNCA produziu efeito em
--   produção (ver cabeçalho de 20260816210000). Aquele arquivo é o ÚNICO lugar do repositório que
--   liga RLS em `jobs`, `Conversation`, `reviews`, `job_categories` e `analytics_events`.
--   `jobs` e `Conversation` estão comprovadamente sem RLS. `reviews` está COM RLS (logo alguém ligou
--   à mão pelo dashboard, tabela por tabela). Resta confirmar as outras duas — o advisor listou 6
--   tabelas e nenhuma delas é `analytics_events`/`job_categories`, o que sugere que estão OK.
--   Este arquivo é o remédio pronto caso o censo diga o contrário. É NO-OP se já estiverem ligadas.
--
--   `analytics_events` guarda comportamento por usuário (user_id, event_type, target_id) — sem RLS,
--   qualquer autenticado lê quem viu o perfil/turno de quem.
--   `job_categories` é dado de referência — o risco é nulo; entra só para zerar o advisor.
--
--   Impacto de produto = ZERO se aplicada: `services/analytics.ts` SEMPRE grava
--   `user_id: user.id` (linhas 27, 64, 88) e engole o erro; `CompanyOnboarding.tsx:47` só lê
--   `job_categories` autenticado.
--
--   Article 8 INTACTO.
--
-- Risk: VERY LOW. Backup required: NO.
--
-- DOWN (rollback):
--   ALTER TABLE public.analytics_events DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.job_categories   DISABLE ROW LEVEL SECURITY;
--
-- COMO VERIFICAR O EFEITO (read-only, depois de aplicar):
--   SELECT c.relname, c.relrowsecurity,
--          (SELECT count(*) FROM pg_policies p
--            WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies
--     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--    WHERE n.nspname='public' AND c.relname IN ('analytics_events','job_categories');
--   -- ESPERADO: analytics_events | t | 2   e   job_categories | t | 1
--
-- QUAL QUERY PROVA QUE O PRODUTO NÃO QUEBROU (read-only):
--   -- 1) O onboarding da empresa continua listando categorias:
--   BEGIN;
--     SELECT set_config('role','authenticated',true);
--     SELECT set_config('request.jwt.claims','{"sub":"<QUALQUER_UID>","role":"authenticated"}',true);
--     SELECT count(*) AS categorias_visiveis FROM public.job_categories;
--     -- ESPERADO: igual a `SELECT count(*) FROM public.job_categories` rodado como postgres.
--   ROLLBACK;
--   -- 2) Analytics é best-effort e engole erro (analytics.ts:34,70) — não há tela que quebre.

DO $$
BEGIN
    IF to_regclass('public.analytics_events') IS NOT NULL THEN
        DROP POLICY IF EXISTS "Users can insert analytics events"   ON public.analytics_events;
        DROP POLICY IF EXISTS "Users can view their own analytics"  ON public.analytics_events;
        DROP POLICY IF EXISTS "analytics_insert_self"               ON public.analytics_events;
        DROP POLICY IF EXISTS "analytics_select_self"               ON public.analytics_events;

        CREATE POLICY "analytics_insert_self" ON public.analytics_events
            FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
        CREATE POLICY "analytics_select_self" ON public.analytics_events
            FOR SELECT TO authenticated USING (user_id = auth.uid());

        ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.analytics_events NO FORCE ROW LEVEL SECURITY;
        REVOKE ALL ON public.analytics_events FROM anon;
        GRANT SELECT, INSERT ON public.analytics_events TO authenticated;
        GRANT ALL ON public.analytics_events TO service_role;
    END IF;

    IF to_regclass('public.job_categories') IS NOT NULL THEN
        DROP POLICY IF EXISTS "Authenticated users can view job categories" ON public.job_categories;
        DROP POLICY IF EXISTS "job_categories_select_authenticated"         ON public.job_categories;

        CREATE POLICY "job_categories_select_authenticated" ON public.job_categories
            FOR SELECT TO authenticated USING (true);

        ALTER TABLE public.job_categories ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.job_categories NO FORCE ROW LEVEL SECURITY;
        REVOKE ALL ON public.job_categories FROM anon;
        GRANT SELECT ON public.job_categories TO authenticated;
        GRANT ALL ON public.job_categories TO service_role;
    END IF;
END $$;
