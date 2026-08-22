-- Migration: F13 Fase 2 — unificacao do seam de autorizacao de empresa + alinhamento das policies
-- File: supabase/migrations/20260818100200_seam_multi_unidade.sql
-- Contrato: .harness/spec/multi-unidade/ddl-aprovado.md §5.3
-- ADR gatilho: ADR-20260817-seam-autorizacao-empresa.md, decisao 3 ("contrato de manutencao
--   conjunta": is_job_owner e is_company_owner mudam na MESMA migration). Esta e essa migration.
--
-- TRES coisas acontecem aqui, e so aqui:
--   1. is_company_owner ganha a branch de multi-unidade E perde a branch nua `= auth.uid()`
--      (que autorizava qualquer sessao a se dizer empresa passando o proprio uuid — furo do gate
--      do F8). A substituta exige que a linha em companies EXISTA.
--   2. is_job_owner passa a DELEGAR para is_company_owner com corpo BEGIN ATOMIC, registrando a
--      dependencia em pg_depend (DROP FUNCTION is_company_owner passa a falhar com 2BP01 em vez
--      de quebrar 4 policies em runtime).
--   3. As policies que ainda ancoravam inline (team_connections, jobs, applications,
--      shift_payments, companies) passam a chamar a funcao. Sem isso a autorizacao fica
--      ASSIMETRICA — o modo de falha silencioso que o ADR-20260817 nomeia.
--
-- NAO E UM NO-OP para o dado existente: team_connections, applications e shift_payments ancoram
-- hoje SO por owner_id e passam a ter tambem a ancoragem por companies.id. Rodar Q0 e Q1 do
-- portao (ddl-aprovado.md §6) ANTES de aplicar.
--
-- Article 8: nenhuma tabela de saldo, nenhuma RPC de escrow, nenhum trigger financeiro tocado.
-- shift_payments tem SO a RLS alterada; enforce_shift_payment_immutability fica intacto.
--
-- DOWN: bloco no final, com o corpo ANTERIOR das duas funcoes e das 13 policies.

-- =============================================
-- 1. O SEAM
-- =============================================

-- 1.1 is_company_owner — BEGIN ATOMIC para registrar a dependencia em
-- session_operates_company_membership (20260818100000).
CREATE OR REPLACE FUNCTION public.is_company_owner(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
BEGIN ATOMIC
    SELECT (SELECT auth.uid()) IS NOT NULL
       AND p_company_id IS NOT NULL
       AND (
             EXISTS (
                SELECT 1 FROM public.companies c
                 WHERE c.id = p_company_id
                   AND (c.owner_id = (SELECT auth.uid()) OR c.id = (SELECT auth.uid()))
             )
          OR public.session_operates_company_membership(p_company_id)
       );
END;

COMMENT ON FUNCTION public.is_company_owner(uuid) IS
    'A sessao atual opera esta empresa? QUATRO caminhos: (a) companies.owner_id = auth.uid(); '
    '(b) companies.id = auth.uid() (linhas legadas com owner_id NULL) — note que AMBOS exigem '
    'que a linha em companies EXISTA: a branch nua `p_company_id = auth.uid()` foi REMOVIDA em '
    '20260818100200 porque autorizava qualquer sessao a se dizer empresa passando o proprio uuid '
    '(furo do gate do F8); (c) company_members ativo (gerente da unidade); (d) organization_members '
    'ativo owner/operator da organizacao dona da unidade (socio ve toda a rede). (c)/(d) via '
    'session_operates_company_membership (DEFINER, evita recursao 42P17). PAR de is_job_owner, que '
    'DELEGA para esta desde 20260818100200 — as duas mudam juntas, sempre. '
    'Ver ADR-20260818-multi-unidade-hierarquia-empresa.md.';

-- 1.2 is_job_owner — delega. BEGIN ATOMIC: o corpo e parseado no CREATE e a dependencia fica
-- registrada (o que o ADR-20260817 decisao 2 adiou explicitamente para este momento).
CREATE OR REPLACE FUNCTION public.is_job_owner(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
BEGIN ATOMIC
    SELECT EXISTS (
        SELECT 1 FROM public.jobs j
         WHERE j.id = p_job_id
           AND public.is_company_owner(j.company_id)
    );
END;

COMMENT ON FUNCTION public.is_job_owner(uuid) IS
    'A sessao atual opera este turno? DELEGA para public.is_company_owner(jobs.company_id) desde '
    '20260818100200 — a ancoragem deixou de ser reimplementada aqui. Corpo BEGIN ATOMIC de '
    'proposito: registra dependencia em pg_depend, entao DROP FUNCTION is_company_owner falha alto '
    '(2BP01) em vez de quebrar as policies de shift_calls/shift_call_targets em runtime.';

-- =============================================
-- 2. companies — UPDATE pelo operador da unidade + protecao das colunas de hierarquia
-- =============================================
-- Consolida as duas policies de UPDATE (owner_id, 20260317160000; id, 20260318000000) numa so.
DROP POLICY IF EXISTS "Company owner can update own company"   ON public.companies;
DROP POLICY IF EXISTS "Companies can update own profile by id" ON public.companies;
DROP POLICY IF EXISTS "companies_update_operator"              ON public.companies;
CREATE POLICY "companies_update_operator" ON public.companies
    FOR UPDATE TO authenticated
    USING (public.is_company_owner(id))
    WITH CHECK (public.is_company_owner(id));

-- RLS nao restringe COLUNA. A protecao de owner_id/organization_id e por trigger.
CREATE OR REPLACE FUNCTION public.enforce_company_hierarchy_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Sem sessao (service_role, cron, migration) => nao interfere.
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
        IF NOT public.is_organization_operator(OLD.organization_id) THEN
            RAISE EXCEPTION
                'Apenas socio/operador da organizacao pode alterar owner_id ou organization_id da unidade'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_company_hierarchy_immutability() IS
    'Gerente (company_members ativo) edita a unidade dele (briefing, endereco) mas NAO pode '
    'mover a unidade de organizacao nem trocar o dono. RLS nao restringe coluna; por isso trigger. '
    'Nao toca saldo (Article 8).';

DROP TRIGGER IF EXISTS trg_enforce_company_hierarchy_immutability ON public.companies;
CREATE TRIGGER trg_enforce_company_hierarchy_immutability
    BEFORE UPDATE ON public.companies
    FOR EACH ROW EXECUTE FUNCTION public.enforce_company_hierarchy_immutability();

REVOKE ALL ON FUNCTION public.enforce_company_hierarchy_immutability() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_company_hierarchy_immutability() TO authenticated, service_role;

-- =============================================
-- 3. jobs — 3 policies inline -> is_company_owner (fecha o furo do F8)
-- =============================================
DROP POLICY IF EXISTS "jobs_insert_company_owner" ON public.jobs;
CREATE POLICY "jobs_insert_company_owner" ON public.jobs
    FOR INSERT TO authenticated
    WITH CHECK (public.is_company_owner(company_id));

DROP POLICY IF EXISTS "jobs_update_company_owner" ON public.jobs;
CREATE POLICY "jobs_update_company_owner" ON public.jobs
    FOR UPDATE TO authenticated
    USING (public.is_company_owner(company_id))
    WITH CHECK (public.is_company_owner(company_id));

DROP POLICY IF EXISTS "jobs_delete_company_owner" ON public.jobs;
CREATE POLICY "jobs_delete_company_owner" ON public.jobs
    FOR DELETE TO authenticated
    USING (public.is_company_owner(company_id));

-- jobs_select_authenticated (USING true) NAO muda — decisao preexistente (20260816210000).

-- =============================================
-- 4. team_connections — 4 policies de empresa; guardas de veto do freela PRESERVADAS
-- =============================================
DROP POLICY IF EXISTS "tc_select_participants" ON public.team_connections;
CREATE POLICY "tc_select_participants" ON public.team_connections
    FOR SELECT TO authenticated
    USING (
        public.is_company_owner(company_id)
        OR worker_id = (SELECT auth.uid())
    );

DROP POLICY IF EXISTS "tc_insert_company" ON public.team_connections;
CREATE POLICY "tc_insert_company" ON public.team_connections
    FOR INSERT TO authenticated
    WITH CHECK (
        public.is_company_owner(company_id)
        AND status = 'pending'
    );

DROP POLICY IF EXISTS "tc_update_company" ON public.team_connections;
CREATE POLICY "tc_update_company" ON public.team_connections
    FOR UPDATE TO authenticated
    USING (
        public.is_company_owner(company_id)
        AND status <> 'blocked'
    )
    WITH CHECK (
        public.is_company_owner(company_id)
        AND status IN ('pending', 'blocked')
    );

-- Veto do freela indelevel para a empresa (20260816000000) — regra INALTERADA.
DROP POLICY IF EXISTS "tc_delete_company" ON public.team_connections;
CREATE POLICY "tc_delete_company" ON public.team_connections
    FOR DELETE TO authenticated
    USING (
        public.is_company_owner(company_id)
        AND (status <> 'blocked' OR blocked_by = (SELECT auth.uid()))
    );

-- tc_update_worker NAO muda (lado do freela).

-- =============================================
-- 5. applications — SELECT e INSERT da empresa -> is_job_owner
-- =============================================
DROP POLICY IF EXISTS "Companies can view applications for their jobs" ON public.applications;
CREATE POLICY "Companies can view applications for their jobs"
ON public.applications FOR SELECT TO authenticated
USING (public.is_job_owner(job_id));

-- Guardas de lista fechada e de estado de convite INALTERADAS (20260622000100).
DROP POLICY IF EXISTS "applications_insert_company_invite" ON public.applications;
CREATE POLICY "applications_insert_company_invite" ON public.applications
    FOR INSERT TO authenticated
    WITH CHECK (
        status = 'invited'
        AND invited_by_company_at IS NOT NULL
        AND public.is_job_owner(job_id)
        AND EXISTS (
            SELECT 1
              FROM public.team_connections tc
              JOIN public.jobs j2 ON j2.id = applications.job_id
             WHERE tc.worker_id  = applications.worker_id
               AND tc.company_id = j2.company_id
               AND tc.status     = 'accepted'
        )
    );

-- "Workers can insert applications" e "Workers can update own applications" NAO mudam.
-- NAO existe policy de UPDATE da empresa em applications, e NAO se cria uma aqui: as transicoes
-- da empresa passam por RPC SECURITY DEFINER / service_role.

-- =============================================
-- 6. shift_payments — SO a RLS. Trigger de imutabilidade e colunas INTOCADOS (Article 8).
-- =============================================
DROP POLICY IF EXISTS "sp_select_participants" ON public.shift_payments;
CREATE POLICY "sp_select_participants" ON public.shift_payments
    FOR SELECT TO authenticated
    USING (
        public.is_company_owner(company_id)
        OR worker_id = (SELECT auth.uid())
    );

DROP POLICY IF EXISTS "sp_insert_company" ON public.shift_payments;
CREATE POLICY "sp_insert_company" ON public.shift_payments
    FOR INSERT TO authenticated
    WITH CHECK (
        public.is_company_owner(company_id)
        AND recorded_by = (SELECT auth.uid())     -- passa a gravar QUAL pessoa registrou
        AND status IN ('scheduled', 'recorded')
        AND worker_confirmed_at IS NULL
        AND voided_at IS NULL
        AND void_reason IS NULL
    );

DROP POLICY IF EXISTS "sp_update_company" ON public.shift_payments;
CREATE POLICY "sp_update_company" ON public.shift_payments
    FOR UPDATE TO authenticated
    USING (
        public.is_company_owner(company_id)
        AND status IN ('scheduled', 'recorded')
    )
    WITH CHECK (
        public.is_company_owner(company_id)
        AND status IN ('scheduled', 'recorded', 'voided')
    );

-- sp_update_worker NAO muda. Continua SEM policy de DELETE (auditoria nao se apaga).

-- ============================================================================
-- DOWN (rollback) — nao depende de dado; seguro enquanto nao houver company_members ativo:
--
--   -- 1. Seam de volta (corpo string, sem dependencia registrada — como era):
--   CREATE OR REPLACE FUNCTION public.is_job_owner(p_job_id uuid)
--   RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
--   AS $f$
--       SELECT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job_id
--         AND (j.company_id = (SELECT auth.uid())
--              OR j.company_id IN (SELECT c.id FROM public.companies c
--                                   WHERE c.owner_id = (SELECT auth.uid()))));
--   $f$;
--   CREATE OR REPLACE FUNCTION public.is_company_owner(p_company_id uuid)
--   RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
--   AS $f$
--       SELECT (SELECT auth.uid()) IS NOT NULL AND p_company_id IS NOT NULL
--          AND (p_company_id = (SELECT auth.uid())
--               OR EXISTS (SELECT 1 FROM public.companies c
--                           WHERE c.id = p_company_id AND c.owner_id = (SELECT auth.uid())));
--   $f$;
--   (nesta ordem: is_job_owner PRIMEIRO, para soltar a dependencia registrada.)
--
--   -- 2. Trigger de hierarquia:
--   DROP TRIGGER  IF EXISTS trg_enforce_company_hierarchy_immutability ON public.companies;
--   DROP FUNCTION IF EXISTS public.enforce_company_hierarchy_immutability();
--
--   -- 3. Policies: recriar as versoes de 20260317160000 / 20260318000000 (companies),
--   --    20260816210000 (jobs), 20260622000000 + 20260816000000 (team_connections),
--   --    20260317160000 + 20260622000100 (applications), 20260712000000 (shift_payments).
--   --    Todas ancoradas em `company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())`.
-- ============================================================================
