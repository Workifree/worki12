-- Migration: Chamado de Turno — `shift_calls` + `shift_call_targets` (F1)
-- File: supabase/migrations/20260817000100_shift_calls.sql
-- Spec: .harness/spec/chamado-de-turno/spec.md (R2, R3, R5, R7, R9, R12)
--
-- ============================================================================
-- POR QUE TABELAS NOVAS (e não estender `applications`)
-- ============================================================================
--   O pedido do cliente (entrevista 17/08/2026) é disparar a MESMA vaga para vários freelas e
--   ficar com o primeiro que aceitar. A modelagem óbvia — criar uma `applications` 'invited'
--   por convidado e cancelar as perdedoras — é inviável neste schema por DOIS motivos duros:
--
--   (1) `applications_job_worker_unique UNIQUE (job_id, worker_id)` + 'cancelled' irreversível
--       ⇒ os perdedores ficariam PERMANENTEMENTE inelegíveis àquele turno. Se o vencedor
--       desistir e a vaga reabrir, justamente os 7 que foram chamados não podem ser rechamados.
--
--   (2) Apagar as linhas perdedoras (para liberar o UNIQUE) destruiria o histórico de "quem foi
--       chamado, quem respondeu, em quanto tempo" — que é o insumo do BI de operação e do
--       ranking da descoberta automática. É o dado mais valioso que a feature produz.
--
--   Portanto: a TENTATIVA vive aqui (`shift_call_targets`); o CONTRATO continua em
--   `applications`, criado só para quem efetivamente ocupou a vaga. `applications` segue sendo
--   o que a ADR-001 quis que fosse — a aresta worker↔turno com o lifecycle, não o log de convite.
--
--   Um chamado com UM alvo é exatamente o convite individual de hoje: um gesto só, não dois
--   fluxos (R2). `shiftInviteService.inviteWorkerToShift` passa a delegar para cá.
--
-- ============================================================================
-- RECURSÃO DE POLICY — por que as duas funções SECURITY DEFINER existem
-- ============================================================================
--   A policy natural de `shift_calls` (SELECT) precisa saber "sou alvo deste chamado?" → leria
--   `shift_call_targets`. E a policy de `shift_call_targets` precisa saber "sou dono do turno
--   deste chamado?" → leria `shift_calls`. Subquery dentro de policy é avaliada SOB a RLS da
--   tabela referenciada ⇒ A→B→A = recursão infinita (erro 42P17 em runtime, não no CREATE).
--
--   Quebramos o ciclo com duas funções SECURITY DEFINER MÍNIMAS, que não vazam nada além do
--   fato de pertencimento que a própria policy já iria conceder:
--     - `shift_call_job_id(call_id)`   → devolve SÓ o job_id do chamado (um uuid).
--     - `is_shift_call_target(call_id)` → devolve SÓ um booleano sobre o PRÓPRIO auth.uid().
--   Nenhuma das duas aceita "por qual usuário perguntar" — `is_shift_call_target` é sempre sobre
--   quem chama. Não há como usá-las para varrer dado alheio.
--
--   `is_job_owner` NÃO é DEFINER de propósito: `jobs` e `companies` já têm SELECT `USING (true)`
--   para authenticated (20260816210000 / 20260317160000), então como INVOKER ela devolve o mesmo
--   resultado sem criar mais um objeto privilegiado para auditar. Ela repete a ANCORAGEM DUPLA
--   (`company_id = auth.uid()` OR via `companies.owner_id`) que 20260816210000 documentou como
--   necessária — há linhas em produção nos dois formatos. É também a costura por onde o
--   multi-unidade/gerente (F3) vai passar: muda esta função, muda todo mundo junto.
--
-- Article 8 INTACTO: nenhuma tabela/RPC de saldo tocada. Nenhum escrow envolvido.
-- Risk: MEDIUM-LOW (tabelas novas; nada existente muda de semântica).
--
-- ============================================================================
-- DOWN (rollback)
-- ============================================================================
--   DROP TABLE IF EXISTS public.shift_call_targets;
--   DROP TABLE IF EXISTS public.shift_calls;
--   DROP FUNCTION IF EXISTS public.is_shift_call_target(uuid);
--   DROP FUNCTION IF EXISTS public.shift_call_job_id(uuid);
--   DROP FUNCTION IF EXISTS public.is_job_owner(uuid);
--
-- ============================================================================
-- COMO VERIFICAR (read-only, depois de aplicar)
-- ============================================================================
--   V1. Tabelas com RLS ligada e FORCE desligada:
--       SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
--        WHERE oid IN ('public.shift_calls'::regclass,'public.shift_call_targets'::regclass);
--       -- ESPERADO: ambas t | f
--
--   V2. Policies (2 em shift_calls, 2 em shift_call_targets; NENHUMA de UPDATE/DELETE):
--       SELECT tablename, policyname, cmd FROM pg_policies
--        WHERE tablename IN ('shift_calls','shift_call_targets') ORDER BY 1,3;
--       -- ESPERADO: shift_call_targets INSERT+SELECT, shift_calls INSERT+SELECT.
--       -- Toda mutação de estado passa pelas RPCs (20260817000200) — de propósito.
--
--   V3. anon sem privilégio; authenticated sem UPDATE/DELETE:
--       SELECT has_table_privilege('anon','public.shift_calls','SELECT')          AS anon_sel,
--              has_table_privilege('authenticated','public.shift_calls','SELECT') AS auth_sel,
--              has_table_privilege('authenticated','public.shift_calls','INSERT') AS auth_ins,
--              has_table_privilege('authenticated','public.shift_calls','UPDATE') AS auth_upd,
--              has_table_privilege('authenticated','public.shift_calls','DELETE') AS auth_del;
--       -- ESPERADO: f | t | t | f | f
--
--   V4. Sem recursão de policy (o teste que pega o erro 42P17, que só aparece em runtime):
--       BEGIN;
--         SELECT set_config('role','authenticated',true);
--         SELECT set_config('request.jwt.claims','{"sub":"<QUALQUER_UUID>","role":"authenticated"}',true);
--         SELECT count(*) FROM public.shift_calls;          -- ESPERADO: 0 linhas, SEM erro
--         SELECT count(*) FROM public.shift_call_targets;   -- ESPERADO: 0 linhas, SEM erro
--       ROLLBACK;
-- ============================================================================

-- =============================================
-- 1. HELPERS DE AUTORIZAÇÃO
-- =============================================

-- INVOKER de propósito (ver cabeçalho). Costura do multi-unidade (F3).
CREATE OR REPLACE FUNCTION public.is_job_owner(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.jobs j
        WHERE j.id = p_job_id
          AND (
                j.company_id = (SELECT auth.uid())
             OR j.company_id IN (
                    SELECT c.id FROM public.companies c WHERE c.owner_id = (SELECT auth.uid())
                )
          )
    );
$$;

COMMENT ON FUNCTION public.is_job_owner(uuid) IS
    'A sessão atual opera este turno? Ancoragem DUPLA (jobs.company_id = auth.uid() OU via '
    'companies.owner_id) — há linhas em produção nos dois formatos (ver 20260816210000). '
    'SECURITY INVOKER: jobs/companies já têm SELECT USING(true), não precisa de privilégio extra. '
    'Ponto único de mudança quando entrar multi-unidade/gerente.';

-- DEFINER mínimo: quebra o ciclo de policy targets→calls. Devolve só um uuid.
CREATE OR REPLACE FUNCTION public.shift_call_job_id(p_call_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT sc.job_id FROM public.shift_calls sc WHERE sc.id = p_call_id;
$$;

COMMENT ON FUNCTION public.shift_call_job_id(uuid) IS
    'job_id de um chamado, SEM passar pela RLS de shift_calls — existe só para quebrar a '
    'recursão de policy shift_call_targets→shift_calls. Não devolve nenhum outro campo.';

-- DEFINER mínimo: quebra o ciclo de policy calls→targets. Sempre sobre auth.uid().
CREATE OR REPLACE FUNCTION public.is_shift_call_target(p_call_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.shift_call_targets t
        WHERE t.call_id = p_call_id
          AND t.worker_id = (SELECT auth.uid())
    );
$$;

COMMENT ON FUNCTION public.is_shift_call_target(uuid) IS
    'A sessão atual é alvo deste chamado? SEM passar pela RLS de shift_call_targets — existe só '
    'para quebrar a recursão de policy shift_calls→shift_call_targets. Não aceita "por qual '
    'usuário perguntar": é sempre sobre auth.uid(), então não serve para varrer dado alheio.';

REVOKE ALL ON FUNCTION public.is_job_owner(uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.shift_call_job_id(uuid)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_shift_call_target(uuid)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_job_owner(uuid)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.shift_call_job_id(uuid)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_shift_call_target(uuid) TO authenticated, service_role;

-- =============================================
-- 2. TABELA `shift_calls` — o disparo
-- =============================================
CREATE TABLE IF NOT EXISTS public.shift_calls (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    -- snapshot da empresa dona no momento do disparo (índice/consulta; a autoridade é jobs)
    company_id  uuid NOT NULL,
    -- quem apertou o botão. Hoje = dono da conta; com multi-unidade (F3), o gerente.
    created_by  uuid NOT NULL,
    -- snapshot de jobs.slots no disparo (o turno pode ser editado depois; o histórico não muda)
    slots       integer NOT NULL CHECK (slots >= 1),
    -- motivo da quebra — vira o relatório que o sócio já usa hoje (faltas × quebra de escala)
    reason      text NOT NULL DEFAULT 'outro'
                CHECK (reason IN ('falta','demissao','pico_previsto','evento','ferias','folga','reforco','outro')),
    message     text,
    -- Quantos freelas receberam este disparo. DESNORMALIZADO de propósito: a policy de
    -- `shift_call_targets` só deixa o freela ver a PRÓPRIA linha, então ele não teria como
    -- contar os concorrentes — e "outros também receberam" é informação que ele merece ter
    -- antes de decidir (R8). Escrito uma vez, no disparo; nunca atualizado.
    targets_count integer NOT NULL DEFAULT 1 CHECK (targets_count >= 1),
    status      text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','filled','cancelled','expired')),
    expires_at  timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    closed_at   timestamptz,
    -- métrica-chave do produto: quanto tempo do disparo até o primeiro aceite
    first_claim_at timestamptz
);

COMMENT ON TABLE  public.shift_calls IS
    'Disparo de um turno para 1..N freelas do elenco, com primeiro-aceite (F1). Um chamado com '
    'um alvo = o convite individual. Estado muda SÓ por RPC (20260817000200) — não há policy de '
    'UPDATE/DELETE de propósito.';
COMMENT ON COLUMN public.shift_calls.slots IS
    'Snapshot de jobs.slots no disparo. A contagem de preenchimento em runtime lê jobs.slots '
    '(fonte da verdade); esta coluna preserva o histórico do que foi pedido na hora.';
COMMENT ON COLUMN public.shift_calls.reason IS
    'Motivo da quebra. Alimenta o BI de operação: o sócio-operador controla gasto com freela '
    'cruzando com nível de falta e quebra de escala (entrevista 17/08/2026).';
COMMENT ON COLUMN public.shift_calls.first_claim_at IS
    'Primeiro aceite. (first_claim_at - created_at) é o tempo de preenchimento — a métrica que '
    'prova o ROI da feature ("de 2 horas para 6 minutos").';

CREATE INDEX IF NOT EXISTS idx_shift_calls_job
    ON public.shift_calls (job_id);
CREATE INDEX IF NOT EXISTS idx_shift_calls_company_open
    ON public.shift_calls (company_id, created_at DESC)
    WHERE status = 'open';

-- =============================================
-- 3. TABELA `shift_call_targets` — quem foi chamado
-- =============================================
CREATE TABLE IF NOT EXISTS public.shift_call_targets (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id      uuid NOT NULL REFERENCES public.shift_calls(id) ON DELETE CASCADE,
    worker_id    uuid NOT NULL,
    notified_at  timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,
    -- 'closed' = a vaga encheu antes deste alvo responder. NÃO é recusa e NÃO é punição (R5):
    -- o freela continua elegível a ser chamado de novo para o MESMO turno se a vaga reabrir.
    response     text CHECK (response IS NULL OR response IN ('accepted','declined','closed')),
    UNIQUE (call_id, worker_id)
);

COMMENT ON TABLE public.shift_call_targets IS
    'Um freela chamado num disparo. É a TENTATIVA — o contrato do turno continua em applications, '
    'criado só para quem ocupou a vaga. Guardar as tentativas (inclusive as perdidas) é o que '
    'permite medir tempo de resposta e taxa de aceite por freela.';
COMMENT ON COLUMN public.shift_call_targets.response IS
    'NULL = pendente. accepted = ocupou a vaga. declined = recusou (NEUTRO, zero punição — R6/R7 '
    'do Slice 1). closed = a vaga encheu antes de responder (também neutro).';

CREATE INDEX IF NOT EXISTS idx_shift_call_targets_worker_pending
    ON public.shift_call_targets (worker_id)
    WHERE response IS NULL;
CREATE INDEX IF NOT EXISTS idx_shift_call_targets_call
    ON public.shift_call_targets (call_id);

-- =============================================
-- 4. RLS
--    Policies PRIMEIRO, ENABLE por último (nunca deixar tabela com RLS ligada e sem policy).
--    Só SELECT e INSERT: toda transição de estado é RPC (SECURITY DEFINER), nunca UPDATE do
--    client. Isso mantém a máquina de estados em UM lugar auditável.
-- =============================================

DROP POLICY IF EXISTS "shift_calls_select"          ON public.shift_calls;
DROP POLICY IF EXISTS "shift_calls_insert_company"  ON public.shift_calls;
DROP POLICY IF EXISTS "shift_call_targets_select"   ON public.shift_call_targets;
DROP POLICY IF EXISTS "shift_call_targets_insert"   ON public.shift_call_targets;

-- Empresa dona do turno vê os chamados dela; freela vê os chamados em que é alvo.
CREATE POLICY "shift_calls_select" ON public.shift_calls
    FOR SELECT TO authenticated
    USING (
        public.is_job_owner(job_id)
        OR public.is_shift_call_target(id)
    );

-- Só a empresa dona dispara, e só para o turno dela, sempre como 'open' e em nome próprio.
-- `company_id` tem de bater com o dono real do turno (não é campo livre).
CREATE POLICY "shift_calls_insert_company" ON public.shift_calls
    FOR INSERT TO authenticated
    WITH CHECK (
        public.is_job_owner(job_id)
        AND created_by = (SELECT auth.uid())
        AND status = 'open'
        AND company_id = (SELECT j.company_id FROM public.jobs j WHERE j.id = job_id)
    );

-- Freela vê os próprios alvos; empresa vê todos os alvos dos chamados dos turnos dela.
CREATE POLICY "shift_call_targets_select" ON public.shift_call_targets
    FOR SELECT TO authenticated
    USING (
        worker_id = (SELECT auth.uid())
        OR public.is_job_owner(public.shift_call_job_id(call_id))
    );

-- Empresa monta a lista de alvos. Duas travas:
--   (a) o chamado tem de ser de um turno dela;
--   (b) o alvo tem de estar no ELENCO ACEITO (team_connections 'accepted') — lista fechada,
--       espelhando R1/R2 do Slice 1 e a policy applications_insert_company_invite.
-- O alvo nasce sempre pendente (response IS NULL): a empresa não pode forjar um aceite.
CREATE POLICY "shift_call_targets_insert" ON public.shift_call_targets
    FOR INSERT TO authenticated
    WITH CHECK (
        response IS NULL
        AND responded_at IS NULL
        AND public.is_job_owner(public.shift_call_job_id(call_id))
        AND EXISTS (
            SELECT 1
            FROM public.team_connections tc
            WHERE tc.worker_id  = shift_call_targets.worker_id
              AND tc.status     = 'accepted'
              AND tc.company_id = (
                    SELECT j.company_id
                    FROM public.jobs j
                    WHERE j.id = public.shift_call_job_id(shift_call_targets.call_id)
                )
        )
    );

ALTER TABLE public.shift_calls        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_calls        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.shift_call_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_call_targets NO FORCE ROW LEVEL SECURITY;

-- =============================================
-- 5. GRANTS
--    Sem UPDATE/DELETE para authenticated: a máquina de estados é das RPCs.
--    NÃO fazer `REVOKE ALL ... FROM PUBLIC` (lição de 20260318000000: derruba service_role).
-- =============================================
REVOKE ALL ON public.shift_calls        FROM anon;
REVOKE ALL ON public.shift_call_targets FROM anon;
GRANT SELECT, INSERT ON public.shift_calls        TO authenticated;
GRANT SELECT, INSERT ON public.shift_call_targets TO authenticated;
GRANT ALL    ON public.shift_calls        TO service_role;
GRANT ALL    ON public.shift_call_targets TO service_role;
