-- Migration: LIGAR RLS em `public.jobs` (Fase 1 — fecha o vetor de ESCRITA)
-- File: supabase/migrations/20260816210000_enable_rls_jobs.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260816-rls-desligada-jobs-conversation.md
--
-- ============================================================================
-- PROBLEMA (evidência de produção, advisor `policy_exists_rls_disabled` = ERROR)
-- ============================================================================
--   pg_class:              public.jobs.relrowsecurity = FALSE
--   pg_policies:           2 policies ("Authenticated can view jobs", "Company owner can manage jobs")
--   has_table_privilege:   authenticated = SELECT, UPDATE, DELETE (e INSERT)
--
--   No PostgreSQL as policies só são consultadas quando RLS está LIGADA na relação.
--   `relforcerowsecurity` sozinho NÃO liga nada. Logo as 2 policies são INERTES:
--   QUALQUER conta autenticada pode `UPDATE` ou `DELETE` QUALQUER turno de QUALQUER empresa.
--
--   Como isso aconteceu: o único `ALTER TABLE jobs ENABLE ROW LEVEL SECURITY` do repositório está em
--   20260309000000_enable_rls_all_tables.sql, que (pelo censo de policies) NÃO produziu efeito em
--   produção — as 4 policies daquele arquivo não existem lá; as 2 que existem vêm de
--   20260317160000. Depois disso, 20260317150000 rodou `FORCE ROW LEVEL SECURITY` (que sem ENABLE
--   é no-op) e 20260318000000 rodou `NO FORCE`. Ninguém nunca rodou ENABLE.
--
-- ============================================================================
-- POR QUE É CRÍTICO: `jobs.company_id` é ÂNCORA DE AUTORIZAÇÃO DE 5 CAMINHOS
-- ============================================================================
--   Quem consegue escrever `jobs.company_id = <meu uid>` se auto-promove a "empresa dona do turno":
--   (1) public.can_view_worker_profile(uuid) — branch (2), 20260816120000:
--         `applications` do freela em `jobs` desta empresa  ⇒  libera a linha INTEIRA de `workers`
--         (cpf, birth_date, phone, pix_key). A trava aplicada hoje ganha porta lateral.
--   (2) applications SELECT  — "Companies can view applications for their jobs" (20260317160000)
--   (3) applications UPDATE  — "Companies can update their job application fields" (20260311100000)
--         + validate_application_update() usa `EXISTS(SELECT 1 FROM jobs WHERE id=NEW.job_id
--         AND company_id=auth.uid())` para decidir v_is_company ⇒ atacante confirma checkin/checkout
--         e conclui turno alheio.
--   (4) "Conversation"/"Message" — policies ancoradas em jobs.company_id (20260309000000/20260317012423)
--   (5) reserve_escrow(p_job_id,...) valida dono pelo `jobs.company_id`, e
--         auto_reserve_escrow_on_hire() lê `jobs.budget` + `jobs.company_id` para o valor reservado.
--         ⇒ `jobs.budget` gravável por terceiros = valor de reserva prepago é input não-confiável.
--
-- ============================================================================
-- DECISÃO — FASE 1: ligar RLS SEM apertar SELECT
-- ============================================================================
--   O vetor real é ESCRITA (UPDATE/DELETE). SELECT de `jobs` já é `USING (true)` para authenticated
--   desde 20260317160000 — ligar RLS mantendo `USING (true)` reproduz BIT A BIT o comportamento de
--   leitura de hoje. Nenhuma tela pode quebrar por leitura.
--
--   Isso é decisivo por um motivo não óbvio: várias policies de OUTRAS tabelas fazem subquery em
--   `jobs` (`job_id IN (SELECT id FROM jobs WHERE company_id = auth.uid())`). Subquery dentro de
--   policy é avaliada SOB A RLS da tabela referenciada. Com `jobs` SELECT permissivo, essas policies
--   não mudam de semântica. Se apertássemos SELECT de `jobs` no mesmo passo, mudaríamos em silêncio
--   applications, Conversation, Message e shift_payments de uma vez. NÃO fazemos isso a dias do piloto.
--   Apertar SELECT é Fase 3 (ver ADR, "Fases").
--
--   As 2 policies legadas são SUBSTITUÍDAS por 4 explícitas (uma por comando). Motivo:
--   "Company owner can manage jobs" é `FOR ALL` ancorada SÓ em `companies.owner_id = auth.uid()`.
--   Se algum registro tiver `owner_id` NULL (bug histórico corrigido por 20260318100000, cujo
--   backfill pode não ter rodado em prod pelo mesmo motivo da 20260309000000), a empresa perderia o
--   controle dos próprios turnos NO MOMENTO em que RLS ligar. As policies novas usam ancoragem DUPLA
--   (`company_id = auth.uid()` OR `company_id IN (SELECT id FROM companies WHERE owner_id=auth.uid())`),
--   o mesmo padrão defensivo de can_view_worker_profile. É superconjunto estrito da legada.
--
--   Sem função SECURITY DEFINER nova aqui de propósito: o termo dominante (`company_id = auth.uid()`)
--   não toca tabela nenhuma, e o fallback lê `companies`, cuja policy de SELECT é `USING (true)`
--   (20260317160000:23). Menos objeto DEFINER para auditar.
--
--   NÃO usamos FORCE ROW LEVEL SECURITY (lição de 20260318000000: derrubou o service_role).
--   Article 8 INTACTO: nenhuma tabela/RPC financeira tocada.
--
-- Risk: MEDIUM-LOW. Reversível em 1 comando (ver DOWN).
-- Backup required: NO (nenhuma escrita de dado; só policy + flag + grants).
--
-- ============================================================================
-- DOWN (rollback — copiar/colar se algo quebrar)
-- ============================================================================
--   ALTER TABLE public.jobs DISABLE ROW LEVEL SECURITY;
--   -- (as policies podem ficar; ficam inertes de novo, exatamente como hoje)
--
-- ============================================================================
-- COMO VERIFICAR O EFEITO (read-only, rodar DEPOIS de aplicar)
-- ============================================================================
--  V1. RLS ligada, FORCE desligada:
--      SELECT relname, relrowsecurity, relforcerowsecurity
--      FROM pg_class WHERE oid = 'public.jobs'::regclass;
--      -- ESPERADO: jobs | t | f
--
--  V2. Exatamente 4 policies, uma por comando:
--      SELECT policyname, cmd, roles, qual, with_check
--      FROM pg_policies WHERE schemaname='public' AND tablename='jobs' ORDER BY cmd, policyname;
--      -- ESPERADO: jobs_delete_company_owner(DELETE), jobs_insert_company_owner(INSERT),
--      --           jobs_select_authenticated(SELECT), jobs_update_company_owner(UPDATE)
--      --           roles = {authenticated} nas 4. NENHUMA policy legada sobrando.
--
--  V3. anon segue sem privilégio nenhum:
--      SELECT has_table_privilege('anon','public.jobs','SELECT')  AS anon_select,
--             has_table_privilege('anon','public.jobs','UPDATE')  AS anon_update,
--             has_table_privilege('authenticated','public.jobs','SELECT') AS auth_select,
--             has_table_privilege('authenticated','public.jobs','INSERT') AS auth_insert,
--             has_table_privilege('authenticated','public.jobs','UPDATE') AS auth_update,
--             has_table_privilege('authenticated','public.jobs','DELETE') AS auth_delete;
--      -- ESPERADO: f | f | t | t | t | t
--
--  V4. advisor: `policy_exists_rls_disabled` e `rls_disabled_in_public` some para `jobs`.
--
-- ============================================================================
-- QUAL QUERY PROVA QUE O PRODUTO NÃO QUEBROU (read-only)
-- ============================================================================
--  P0. Baseline — pegue a empresa real com mais turnos (rode ANTES e DEPOIS; tem que dar igual):
--      SELECT j.company_id, count(*) AS turnos
--      FROM public.jobs j GROUP BY 1 ORDER BY 2 DESC LIMIT 5;
--
--  P1. A empresa continua LENDO os N turnos dela (simula a sessão dela; read-only):
--      BEGIN;
--        SELECT set_config('role','authenticated',true);
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<COMPANY_ID>","role":"authenticated"}', true);
--        SELECT count(*) AS turnos_visiveis_da_empresa
--          FROM public.jobs WHERE company_id = '<COMPANY_ID>';   -- ESPERADO: = N de P0
--        SELECT count(*) AS turnos_visiveis_no_total FROM public.jobs; -- ESPERADO: total da base
--      ROLLBACK;
--
--  P2. O freela continua lendo o turno do convite/recibo pelo embed (mesma simulação, freela real):
--      BEGIN;
--        SELECT set_config('role','authenticated',true);
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<WORKER_ID>","role":"authenticated"}', true);
--        SELECT count(*) AS turnos_do_freela
--          FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
--         WHERE a.worker_id = '<WORKER_ID>';   -- ESPERADO: = nº de applications do freela
--      ROLLBACK;
--
--  P3. O vetor está fechado — prova só por catálogo (read-only, sem escrever):
--      SELECT cmd, qual FROM pg_policies
--       WHERE tablename='jobs' AND cmd IN ('UPDATE','DELETE');
--      -- ESPERADO: as duas quals contêm `company_id = auth.uid()` — nunca `true`.
--
--  P4. (OPCIONAL, exige sessão com escrita; SEMPRE dentro de BEGIN/ROLLBACK)
--      BEGIN;
--        SELECT set_config('role','authenticated',true);
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<WORKER_ID>","role":"authenticated"}', true);
--        UPDATE public.jobs SET company_id = '<WORKER_ID>';  -- ESPERADO: UPDATE 0
--        DELETE FROM public.jobs;                            -- ESPERADO: DELETE 0
--      ROLLBACK;
--      BEGIN;
--        SELECT set_config('role','authenticated',true);
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<COMPANY_ID>","role":"authenticated"}', true);
--        UPDATE public.jobs SET title = title WHERE company_id = '<COMPANY_ID>'; -- ESPERADO: UPDATE N (>0)
--      ROLLBACK;
-- ============================================================================

-- =============================================
-- 1. POLICIES PRIMEIRO, ENABLE POR ÚLTIMO
--    Nunca deixar a tabela com RLS ligada e sem policy (mesmo por um instante).
-- =============================================
DROP POLICY IF EXISTS "Authenticated can view jobs"            ON public.jobs;
DROP POLICY IF EXISTS "Company owner can manage jobs"          ON public.jobs;
DROP POLICY IF EXISTS "Anyone can view open jobs"              ON public.jobs;
DROP POLICY IF EXISTS "Authenticated users can view jobs"      ON public.jobs;
DROP POLICY IF EXISTS "Companies can create their own jobs"    ON public.jobs;
DROP POLICY IF EXISTS "Companies can update their own jobs"    ON public.jobs;
DROP POLICY IF EXISTS "Companies can delete their own jobs"    ON public.jobs;
DROP POLICY IF EXISTS "jobs_select_authenticated"              ON public.jobs;
DROP POLICY IF EXISTS "jobs_insert_company_owner"              ON public.jobs;
DROP POLICY IF EXISTS "jobs_update_company_owner"              ON public.jobs;
DROP POLICY IF EXISTS "jobs_delete_company_owner"              ON public.jobs;

-- SELECT: idêntico ao comportamento de hoje (Fase 1 não aperta leitura — ver cabeçalho).
CREATE POLICY "jobs_select_authenticated" ON public.jobs
    FOR SELECT TO authenticated
    USING (true);

-- INSERT: só a empresa dona (ancoragem dupla).
CREATE POLICY "jobs_insert_company_owner" ON public.jobs
    FOR INSERT TO authenticated
    WITH CHECK (
        company_id = auth.uid()
        OR company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_id = auth.uid())
    );

-- UPDATE: só a empresa dona, e não pode transferir o turno para outra empresa (WITH CHECK).
CREATE POLICY "jobs_update_company_owner" ON public.jobs
    FOR UPDATE TO authenticated
    USING (
        company_id = auth.uid()
        OR company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_id = auth.uid())
    )
    WITH CHECK (
        company_id = auth.uid()
        OR company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_id = auth.uid())
    );

-- DELETE: só a empresa dona. (shift_payments.job_id é ON DELETE RESTRICT — auditoria protegida.)
CREATE POLICY "jobs_delete_company_owner" ON public.jobs
    FOR DELETE TO authenticated
    USING (
        company_id = auth.uid()
        OR company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_id = auth.uid())
    );

-- =============================================
-- 2. LIGAR RLS (o interruptor que nunca foi ligado)
-- =============================================
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs NO FORCE ROW LEVEL SECURITY;  -- service_role/owner seguem bypassando

-- =============================================
-- 3. GRANTS — reafirmação defensiva e idempotente
--    NÃO fazer `REVOKE ALL ... FROM PUBLIC` (20260318000000: derruba service_role).
-- =============================================
REVOKE ALL ON public.jobs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;

COMMENT ON TABLE public.jobs IS
    'Turnos/vagas. RLS LIGADA em 2026-08-16 (ADR-20260816-rls-desligada-jobs-conversation). '
    'jobs.company_id é âncora de autorização de applications, Conversation, Message, '
    'can_view_worker_profile e reserve_escrow — NUNCA deixar UPDATE aberto nesta tabela.';
