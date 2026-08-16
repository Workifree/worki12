-- Migration: TRANCAR (não dropar) tabelas legadas do schema Prisma
-- File: supabase/migrations/20260816210200_lockdown_legacy_prisma_tables.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260816-rls-desligada-jobs-conversation.md
--
-- ============================================================================
-- PROBLEMA (evidência de produção, advisor `rls_disabled_in_public` = ERROR)
-- ============================================================================
--   public."FreelancerReview"            RLS off, 0 policies, anon TEM SELECT, authenticated SELECT/UPDATE/DELETE
--   public."ClientReview"                RLS off, 0 policies, anon TEM SELECT, authenticated SELECT/UPDATE/DELETE
--   public."_FreelancerProfileToSkill"   RLS off, 0 policies, sem grants
--   public."_JobToSkill"                 RLS off, 0 policies, sem grants
--   public."User"                        legado Prisma, documentado como VAZIO em 20260319000000
--
--   "FreelancerReview"/"ClientReview" com SELECT para `anon` = avaliações legíveis SEM CONTA.
--   Se tiverem dado, é vazamento pré-autenticação (LGPD). Se estiverem vazias, é só ruído de
--   advisor — mas o GRANT continua errado.
--
-- ============================================================================
-- EVIDÊNCIA DE QUE SÃO MORTAS (verificada no repositório, 2026-08-16)
-- ============================================================================
--   `grep -rni "FreelancerReview|ClientReview|FreelancerProfileToSkill|JobToSkill|FreelancerProfile"`
--   em `frontend/src`, `supabase/functions` e `supabase/migrations` → ZERO ocorrências.
--   Nenhum código, nenhuma policy, nenhum trigger, nenhuma FK do schema vivo aponta para elas.
--   As avaliações vivas estão em `public.reviews` (direction 'worker'|'company', 20260622000200).
--
-- ============================================================================
-- DECISÃO: TRANCAR AGORA, DROPAR DEPOIS DO PILOTO
-- ============================================================================
--   `ENABLE ROW LEVEL SECURITY` sem NENHUMA policy = deny-all para anon/authenticated
--   (RLS ligada + zero policy = nenhuma linha visível), + `REVOKE ALL` de anon e authenticated.
--   service_role mantém acesso (bypassa RLS) para eventual perícia/export.
--
--   NÃO dropamos agora de propósito: DROP é irreversível e a dias do piloto não se troca um risco
--   de leitura (já zerado pelo REVOKE) por um risco de perda de dado. O DROP é um passo separado,
--   pós-piloto, depois de conferir a contagem (query abaixo) e exportar o que houver.
--
--   Article 8 INTACTO. Zero impacto de produto (nenhum call site).
--
-- Risk: VERY LOW.
-- Backup required: NO — mas RODE A CONTAGEM ABAIXO ANTES e guarde o número.
--
-- ============================================================================
-- RODAR ANTES (read-only) — quanto dado existe nessas tabelas:
-- ============================================================================
--   SELECT 'FreelancerReview' AS t, count(*) FROM public."FreelancerReview"
--   UNION ALL SELECT 'ClientReview', count(*) FROM public."ClientReview"
--   UNION ALL SELECT '_FreelancerProfileToSkill', count(*) FROM public."_FreelancerProfileToSkill"
--   UNION ALL SELECT '_JobToSkill', count(*) FROM public."_JobToSkill";
--   -- Se vier tudo 0: confirma "resquício morto" e o DROP pós-piloto é trivial.
--   -- Se vier > 0 em FreelancerReview/ClientReview: houve exposição a `anon`; registrar no ADR.
--
--   CENSO COMPLETO (rode também — se aparecer tabela fora desta lista, ME AVISE antes de aplicar):
--   SELECT c.relname, c.relrowsecurity AS rls_on,
--          (SELECT count(*) FROM pg_policies p
--            WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies,
--          has_table_privilege('anon', c.oid, 'SELECT')          AS anon_select,
--          has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select,
--          has_table_privilege('authenticated', c.oid, 'UPDATE') AS auth_update,
--          has_table_privilege('authenticated', c.oid, 'DELETE') AS auth_delete
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relkind = 'r'
--    ORDER BY c.relrowsecurity, c.relname;
--
-- ============================================================================
-- DOWN (rollback — copiar/colar)
-- ============================================================================
--   ALTER TABLE public."FreelancerReview"          DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public."ClientReview"              DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public."_FreelancerProfileToSkill" DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public."_JobToSkill"               DISABLE ROW LEVEL SECURITY;
--   -- Os GRANTs a anon NÃO são restaurados: nunca deveriam ter existido.
--
-- ============================================================================
-- COMO VERIFICAR O EFEITO (read-only, DEPOIS de aplicar)
-- ============================================================================
--   SELECT c.relname, c.relrowsecurity AS rls_on,
--          (SELECT count(*) FROM pg_policies p
--            WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies,
--          has_table_privilege('anon', c.oid, 'SELECT')          AS anon_select,
--          has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select,
--          has_table_privilege('service_role', c.oid, 'SELECT')  AS svc_select
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname='public'
--      AND c.relname IN ('FreelancerReview','ClientReview','_FreelancerProfileToSkill','_JobToSkill','User');
--   -- ESPERADO por linha: rls_on = t | policies = 0 | anon_select = f | auth_select = f | svc_select = t
--
-- ============================================================================
-- QUAL QUERY PROVA QUE O PRODUTO NÃO QUEBROU
-- ============================================================================
--   Não há query de produto para provar: ZERO call sites (evidência acima).
--   O contra-teste é que as avaliações VIVAS continuam intactas:
--     SELECT direction, count(*) FROM public.reviews GROUP BY 1;
--     -- ESPERADO: mesmos números de antes (a base tinha 8 avaliações em 16/08).
--   E o smoke do app: abrir o perfil público de uma empresa (/empresa/:id) e o perfil do freela e
--   confirmar que a seção de avaliações continua renderizando (usa get_profile_reviews, 20260816130000).
-- ============================================================================

DO $$
DECLARE
    v_tables text[] := ARRAY[
        'FreelancerReview',
        'ClientReview',
        '_FreelancerProfileToSkill',
        '_JobToSkill',
        'User'                       -- legado Prisma, documentado como vazio em 20260319000000
        -- Se o CENSO acima listar outra tabela legada com RLS off, adicione aqui e reaplique.
    ];
    v_t text;
BEGIN
    FOREACH v_t IN ARRAY v_tables LOOP
        IF to_regclass(format('public.%I', v_t)) IS NOT NULL THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_t);
            EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', v_t);
            EXECUTE format('REVOKE ALL ON public.%I FROM anon', v_t);
            EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', v_t);
            EXECUTE format('GRANT ALL ON public.%I TO service_role', v_t);
            EXECUTE format(
                'COMMENT ON TABLE public.%I IS %L', v_t,
                'LEGADO Prisma — sem call site em frontend/src nem supabase/functions (verificado 2026-08-16). '
                'Trancada (RLS on, zero policy, sem grant a anon/authenticated) por '
                'ADR-20260816-rls-desligada-jobs-conversation. DROP previsto para depois do piloto.'
            );
            RAISE NOTICE 'Tabela legada trancada: public.%', v_t;
        ELSE
            RAISE NOTICE 'Tabela legada ausente (nada a fazer): public.%', v_t;
        END IF;
    END LOOP;
END $$;
