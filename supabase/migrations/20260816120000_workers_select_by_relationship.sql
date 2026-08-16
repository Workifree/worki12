-- Migration: Restringir SELECT em `workers` por VÍNCULO (fecha varredura de CPF/PIX por qualquer conta)
-- File: supabase/migrations/20260816120000_workers_select_by_relationship.sql
-- ADR: .harness/memory-bank/decisions/ADR-20260816-workers-select-por-vinculo.md
--
-- PROBLEMA (achado do gate de arquitetura, Onda 1 do spec `revisao-piloto`):
--   A policy vigente é permissiva total:
--     20260309000000_enable_rls_all_tables.sql  -> CREATE POLICY "Authenticated users can view
--                                                   worker profiles" ON workers FOR SELECT
--                                                   TO authenticated USING (true);
--     20260317140100_ensure_workers_select_policy.sql -> reafirma a mesma policy.
--   RLS no Postgres é ROW-level, não column-level: `USING (true)` libera TODAS as colunas da linha.
--   A tabela `workers` carrega dado pessoal sensível e dado de pagamento:
--     - cpf         (gravado em WorkerOnboarding.tsx:191; anonimizado em delete-account/index.ts:136)
--     - birth_date  (gravado em WorkerOnboarding.tsx:192)
--     - phone       (contato direto)
--     - pix_key     (chave de pagamento — R1 do piloto)
--   Consequência: QUALQUER conta autenticada (inclusive uma criada em 30 segundos, papel worker ou
--   company, sem nenhum vínculo) podia fazer `GET /rest/v1/workers?select=*` e varrer a base inteira
--   de freelas com CPF + chave PIX. Risco LGPD direto (dado pessoal + dado de pagamento), agravado
--   pela R1 que passou a coletar e trafegar `pix_key` como parte do fluxo central do piloto.
--
-- SOLUÇÃO (opção `a` do gate — escopo por relação, sem tocar em colunas):
--   Trocar `USING (true)` por `USING (public.can_view_worker_profile(id))`. O freela continua lendo a
--   PRÓPRIA linha (nada quebra em Dashboard/Profile/Sidebar/ProtectedRoute, inclusive `select('*')`),
--   e a empresa lê a linha do freela SOMENTE quando existe vínculo real:
--     (1) conexão de elenco em `team_connections` com status IN ('pending','accepted'); ou
--     (2) vínculo operacional: `applications` do freela em um `jobs` daquela empresa
--         (candidatura pull OU convite push — ambos criam linha em `applications`).
--   `blocked` (veto do freela) NÃO dá leitura: quem saiu/bloqueou a loja para de expor phone/pix_key.
--   A UI de elenco só renderiza 'accepted' e 'pending' (CompanyTeam filtra 'pending'), então excluir
--   'blocked' não quebra tela.
--
-- POR QUE FUNÇÃO SECURITY DEFINER E NÃO SUBQUERY INLINE NA POLICY:
--   Subquery inline dentro de uma policy é avaliada SOB A RLS das tabelas referenciadas
--   (team_connections, applications, jobs, companies) — o que (i) acopla esta policy às policies
--   daquelas tabelas, (ii) abre porta para recursão futura se alguma delas passar a referenciar
--   `workers`, e (iii) é mais lento. A função DEFINER isola a decisão: recebe um uuid, devolve um
--   boolean derivado de `auth.uid()`, e não devolve NENHUM dado. Padrão já usado no projeto
--   (accept_company_invite_by_token, 20260702120000).
--
-- NÃO TOCA SALDO/ESCROW (Article 8). Nenhuma RPC financeira, nenhuma tabela financeira.
--
-- service_role: INTACTO. Lição de 20260318000000_fix_force_rls_service_role.sql respeitada —
--   NÃO usamos FORCE ROW LEVEL SECURITY e NÃO usamos `REVOKE ALL ... FROM PUBLIC`. O owner da tabela
--   e o service_role continuam bypassando RLS. O `GRANT ALL ... TO service_role` é reafirmado abaixo
--   por segurança (idempotente).
--
-- Triggers/RPCs existentes que leem `workers`: TODOS são SECURITY DEFINER (rodam como owner, que
--   bypassa RLS sem FORCE RLS) — `recompute_worker_aggregates` / `recompute_my_aggregates`
--   (20260712000200), `set_review_direction` e `update_worker_rating_on_review` (20260622000200),
--   `accept_company_invite_by_token` (20260702120000), `increment_worker_view` (20260317140300),
--   triggers de notificação (20260702000000, 20260714000000). Nenhum é afetado.
--
-- Risk: MEDIUM (muda leitura de tabela central). Reversível em 1 comando — ver DOWN.
-- Backup required before production deploy: NO (nenhuma escrita de dado; só policy + função).
--
-- DOWN (rollback):
--   DROP POLICY IF EXISTS "workers_select_self_or_related" ON public.workers;
--   CREATE POLICY "Authenticated users can view worker profiles" ON public.workers
--       FOR SELECT TO authenticated USING (true);
--   DROP FUNCTION IF EXISTS public.can_view_worker_profile(uuid);
--   DROP INDEX IF EXISTS public.idx_applications_worker_job;
--   DROP INDEX IF EXISTS public.idx_jobs_company;

-- =============================================
-- 1. ÍNDICES DE SUPORTE
--    A policy roda por linha candidata; sem índice o EXISTS vira seq scan.
--    NÃO usamos CREATE INDEX CONCURRENTLY: migrations do Supabase rodam dentro de transação
--    (CONCURRENTLY é proibido em bloco transacional) e estas tabelas são pequenas no pré-piloto.
--    `IF NOT EXISTS` mantém a migration idempotente.
-- =============================================
CREATE INDEX IF NOT EXISTS idx_applications_worker_job
    ON public.applications (worker_id, job_id);

CREATE INDEX IF NOT EXISTS idx_jobs_company
    ON public.jobs (company_id);

-- team_connections já tem UNIQUE (company_id, worker_id) + idx_team_connections_worker
-- (20260622000000) — cobre o EXISTS de elenco.

-- =============================================
-- 2. FUNÇÃO DE VISIBILIDADE
--    Retorna APENAS boolean. Nunca devolve dado de worker.
--    STABLE: mesmo resultado dentro do statement -> o planner pode cachear por linha.
-- =============================================
CREATE OR REPLACE FUNCTION public.can_view_worker_profile(p_worker_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    -- Sem sessão (anon) -> nada.
    IF v_uid IS NULL OR p_worker_id IS NULL THEN
        RETURN false;
    END IF;

    -- (0) O próprio freela lê a própria linha (Profile, Dashboard, Sidebar, ProtectedRoute,
    --     DepositModal, onboarding). Mantém `select('*')` funcionando para o dono do dado.
    IF p_worker_id = v_uid THEN
        RETURN true;
    END IF;

    -- (1) Vínculo de elenco: empresa que tem conexão pending/accepted com este freela.
    --     'blocked' é veto explícito do freela -> NÃO concede leitura.
    --     `company_id = v_uid` cobre o caso canônico (companies.id = auth.uid(), trigger
    --     handle_new_user); `owner_id = v_uid` cobre registros com owner_id preenchido.
    IF EXISTS (
        SELECT 1
        FROM public.team_connections tc
        WHERE tc.worker_id = p_worker_id
          AND tc.status IN ('pending', 'accepted')
          AND (
                tc.company_id = v_uid
             OR tc.company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_id = v_uid)
          )
    ) THEN
        RETURN true;
    END IF;

    -- (2) Vínculo operacional: o freela tem candidatura OU convite de turno (ambos vivem em
    --     `applications`) em um turno desta empresa. Cobre CompanyJobCandidates, CompanyJobs,
    --     CompanyDashboard, CompanyMessages, ReceiptView, relatório de ordens e o BI financeiro.
    --     Sem filtro de status: histórico concluído/cancelado precisa continuar legível para
    --     recibo, relatório e BI.
    IF EXISTS (
        SELECT 1
        FROM public.applications a
        JOIN public.jobs j ON j.id = a.job_id
        WHERE a.worker_id = p_worker_id
          AND (
                j.company_id = v_uid
             OR j.company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_id = v_uid)
          )
    ) THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

COMMENT ON FUNCTION public.can_view_worker_profile(uuid) IS
    'Decide se auth.uid() pode ler a linha de um worker: o próprio freela, ou empresa com '
    'team_connections pending/accepted, ou empresa com applications do freela em turno seu. '
    'Retorna só boolean (não vaza dado). Usada na policy de SELECT de workers.';

-- Sem GRANT EXECUTE, a policy falha para `authenticated` (a função é chamada no contexto do caller).
GRANT EXECUTE ON FUNCTION public.can_view_worker_profile(uuid) TO authenticated, service_role;

-- =============================================
-- 3. POLICY DE SELECT
--    Policies permissivas são OR'd: enquanto a antiga `USING (true)` existir, nada muda.
--    Por isso ela é DROPADA aqui (junto com os nomes históricos alternativos).
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can view worker profiles" ON public.workers;
DROP POLICY IF EXISTS "Anyone authenticated can view worker profiles" ON public.workers;
DROP POLICY IF EXISTS "Workers can view their own profile" ON public.workers;
DROP POLICY IF EXISTS "workers_select_self_or_related" ON public.workers;

CREATE POLICY "workers_select_self_or_related" ON public.workers
    FOR SELECT TO authenticated
    USING (public.can_view_worker_profile(id));

-- =============================================
-- 4. GRANTS — reafirmação defensiva
--    NÃO fazer `REVOKE ALL ... FROM PUBLIC` aqui: 20260318000000 documenta que isso derrubou o
--    service_role. Revogamos apenas de `anon` (que nunca teve policy de SELECT nesta tabela) e
--    reafirmamos o acesso do service_role.
-- =============================================
REVOKE ALL ON public.workers FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.workers TO authenticated;
GRANT ALL ON public.workers TO service_role;

-- =============================================
-- DOWN (rollback manual — copiar/colar):
--   DROP POLICY IF EXISTS "workers_select_self_or_related" ON public.workers;
--   CREATE POLICY "Authenticated users can view worker profiles" ON public.workers
--       FOR SELECT TO authenticated USING (true);
--   DROP FUNCTION IF EXISTS public.can_view_worker_profile(uuid);
--   DROP INDEX IF EXISTS public.idx_applications_worker_job;
--   DROP INDEX IF EXISTS public.idx_jobs_company;
-- =============================================
