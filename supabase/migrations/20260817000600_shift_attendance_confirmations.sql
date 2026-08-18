-- Migration: Confirmação de véspera (D-1) — tabela-evento `shift_attendance_confirmations` (F4)
-- File: supabase/migrations/20260817000600_shift_attendance_confirmations.sql
-- Spec: .harness/spec/confirmacao-vespera/spec.md (R1, R6 — REVISADOS pelo gate)
-- DDL aprovado (fonte normativa): .harness/spec/confirmacao-vespera/ddl-aprovado.md
-- ADR: .harness/memory-bank/decisions/ADR-20260817-confirmacao-vespera-log-evento.md
--
-- ============================================================================
-- POR QUE TABELA NOVA (e não 4 colunas em `applications`, como a spec original propôs)
-- ============================================================================
--   A spec original propunha `attendance_confirmation_requested_at/_response/_responded_at/
--   _request_count` direto em `applications`. O gate reprovou por TRÊS motivos (ADR, seção
--   Contexto):
--
--   1. Contador + cooldown são agregados sobre uma SEQUÊNCIA de pedidos (1:N), não um par
--      pergunta/resposta 1:1 — um segundo pedido sobrescreveria o `requested_at` do primeiro e
--      apagaria a latência de resposta ao primeiro (o dado que alimenta o BI/ranking futuro).
--
--   2. `applications` tem `GRANT SELECT, INSERT, UPDATE ... TO authenticated` de TABELA
--      (20260317150000) e a policy de UPDATE do freela não restringe coluna nenhuma. Colunas
--      novas nasceriam graváveis pelo client via PostgREST direto — o freela poderia forjar o
--      próprio pedido, reescrever a resposta e zerar o contador. Tapar isso exigiria estender
--      `validate_application_update` com imutabilidade de 4 colunas.
--
--   3. Escrever em `applications` acorda `trg_validate_application_update` (ancoragem SIMPLES)
--      enquanto esta feature autoriza por `is_job_owner` (ancoragem DUPLA) — para uma empresa
--      ancorada via `companies.owner_id`, a RPC autorizaria e o trigger derrubaria com EXCEPTION.
--
--   O precedente certo é `shift_call_targets` (20260817000100), não o par `invitation_*`:
--   confirmação de véspera é TENTATIVA (mede-se quem foi chamado, quem respondeu, em quanto
--   tempo), não CONTRATO. Guardar o log integral é o que permite medir taxa de confirmação por
--   freela depois — histórico não se reconstrói retroativamente.
--
-- ============================================================================
-- TODA MUTAÇÃO É RPC/TRIGGER `SECURITY DEFINER` — mesmo padrão de `shift_calls`
-- ============================================================================
--   Só existe policy de SELECT. INSERT/UPDATE só acontecem dentro de
--   `request_attendance_confirmation` / `respond_attendance_confirmation` /
--   `request_attendance_confirmations_due` (20260817000700), todas SECURITY DEFINER com
--   autorização explícita no corpo — a máquina de estados fica em um lugar auditável e não há
--   superfície de escrita pelo client (RLS desligada por definição dentro de DEFINER).
--
-- Article 8 INTACTO: nenhuma tabela/RPC de saldo tocada. Nenhum escrow envolvido.
-- Risk: LOW-MEDIUM (tabela nova; nenhuma tabela/trigger existente muda de semântica).
--
-- ============================================================================
-- DOWN (rollback)
-- ============================================================================
--   DROP TRIGGER IF EXISTS trg_notify_worker_on_attendance_request ON public.shift_attendance_confirmations;
--   DROP FUNCTION IF EXISTS public.notify_worker_on_attendance_request();
--   DROP TABLE IF EXISTS public.shift_attendance_confirmations;
--   DROP FUNCTION IF EXISTS public.job_is_active(uuid);
--   DROP FUNCTION IF EXISTS public.job_local_date(uuid);
--
-- ============================================================================
-- COMO VERIFICAR (read-only, depois de aplicar)
-- ============================================================================
--   V1. Tabela com RLS ligada e FORCE desligada:
--       SELECT relrowsecurity, relforcerowsecurity FROM pg_class
--        WHERE oid = 'public.shift_attendance_confirmations'::regclass;
--       -- ESPERADO: t | f
--
--   V2. Só 1 policy (SELECT); nenhuma de INSERT/UPDATE/DELETE:
--       SELECT policyname, cmd FROM pg_policies
--        WHERE tablename = 'shift_attendance_confirmations';
--       -- ESPERADO: 1 linha, cmd = SELECT
--
--   V3. anon sem privilégio; authenticated só com SELECT:
--       SELECT has_table_privilege('anon','public.shift_attendance_confirmations','SELECT')          AS anon_sel,
--              has_table_privilege('authenticated','public.shift_attendance_confirmations','SELECT') AS auth_sel,
--              has_table_privilege('authenticated','public.shift_attendance_confirmations','INSERT') AS auth_ins,
--              has_table_privilege('authenticated','public.shift_attendance_confirmations','UPDATE') AS auth_upd;
--       -- ESPERADO: f | t | f | f
--
--   V4. `job_local_date` resolve o fuso corretamente (turno às 23h America/Sao_Paulo não vira o
--       dia seguinte por estar em UTC no timestamptz cru):
--       SELECT public.job_local_date('<JOB_ID_COM_START_DATE_23H_LOCAL>');
-- ============================================================================

-- =============================================
-- 1. HELPERS
-- =============================================

-- Helper de data local — uma expressão canônica para "que dia é este turno". `jobs.start_date`
-- é timestamptz (confirmado em produção 17/08/2026) — sem SET timezone, `::date` cru usaria UTC
-- do servidor e produziria off-by-one perto da meia-noite local.
CREATE OR REPLACE FUNCTION public.job_local_date(p_job_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET timezone = 'America/Sao_Paulo'
AS $$ SELECT j.start_date::timestamptz::date FROM public.jobs j WHERE j.id = p_job_id; $$;

COMMENT ON FUNCTION public.job_local_date(uuid) IS
    'Data local (America/Sao_Paulo) do início do turno. "Véspera" é conceito de data local, '
    'não de CURRENT_DATE cru (UTC no servidor Postgres do Supabase). Usado pela varredura D-1 e '
    'pelas RPCs desta feature para "job_past".';

REVOKE ALL ON FUNCTION public.job_local_date(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_local_date(uuid) TO authenticated, service_role;

-- Helper "o turno ainda existe e não foi cancelado?" — MESMO predicado que 20260817000500 já usa
-- inline dentro do lock de `claim_shift_slot` (status <> 'deleted'). Extraído aqui como função
-- (L4 do gate) porque esta feature (RPC manual + varredura em lote) não tem lock de `jobs` no
-- caminho — não há corrida de aceite a proteger, então uma leitura solta é segura e reutilizável.
--
-- ASSIMETRIA DE PROPÓSITO: `claim_shift_slot` NÃO foi reescrita para chamar este helper — trocaria
-- a leitura TRAVADA (`FOR UPDATE`, necessária pela corrida de aceite) por uma leitura solta,
-- reabrindo exatamente a janela de corrida que 20260817000500 fechou. Mesmo predicado, dois
-- lugares, de propósito.
--
-- L11 (achado do security-reviewer, 18/08/2026): SECURITY DEFINER de PROPÓSITO — NÃO simplificar
-- para INVOKER. `request_attendance_confirmations_due` roda via pg_cron SEM SESSÃO (auth.uid()
-- IS NULL). Como INVOKER, o resultado dependeria da policy de SELECT de `jobs` avaliada para um
-- contexto sem sessão — hoje `USING (true)` (20260816210000/20260317160000) não faria diferença,
-- mas o `ADR-20260816-rls-desligada-jobs-conversation.md` planeja APERTAR esse SELECT na Fase 3
-- via `can_view_job(uuid)`. Quando isso acontecer, um `job_is_active` INVOKER passaria a devolver
-- `false` para tudo dentro da varredura noturna (sem sessão = sem match na policy nova) — a
-- feature morre em silêncio, sem erro/exceção/log, e o sintoma (ninguém recebe confirmação de
-- véspera) aparece meses depois, longe da causa. DEFINER desacopla este predicado da policy de
-- SELECT de `jobs`: continua correto com sessão (RPC manual) e sem sessão (cron), hoje e depois
-- da Fase 3. Não há custo de segurança — devolve só um booleano de "existe e não foi
-- soft-deletado", nenhum conteúdo de `jobs` vaza.
CREATE OR REPLACE FUNCTION public.job_is_active(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.jobs j WHERE j.id = p_job_id AND j.status <> 'deleted'
    );
$$;

COMMENT ON FUNCTION public.job_is_active(uuid) IS
    'O turno ainda existe (não foi soft-deletado, status <> ''deleted'')? MESMO predicado que '
    '20260817000500 usa inline dentro do lock de claim_shift_slot — NÃO reescrever '
    'claim_shift_slot para chamar este helper (trocaria leitura travada por leitura solta no '
    'caminho da corrida). SECURITY DEFINER de PROPÓSITO (L11): request_attendance_confirmations_due '
    'roda via pg_cron sem sessão (auth.uid() IS NULL) — DEFINER desacopla o predicado da policy de '
    'SELECT de jobs, que o ADR-20260816-rls-desligada-jobs-conversation.md planeja apertar na Fase 3 '
    '(can_view_job). NÃO trocar de volta para INVOKER.';

REVOKE ALL ON FUNCTION public.job_is_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_is_active(uuid) TO authenticated, service_role;

-- =============================================
-- 2. TABELA `shift_attendance_confirmations` — uma linha por PEDIDO
-- =============================================
CREATE TABLE IF NOT EXISTS public.shift_attendance_confirmations (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
    -- denormalizados de colunas IMUTÁVEIS (validate_application_update trava job_id/worker_id):
    -- as policies leem daqui sem join, e não podem divergir.
    job_id         uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    worker_id      uuid NOT NULL,
    source         text NOT NULL CHECK (source IN ('auto','manual')),
    requested_by   uuid,                       -- NULL sempre que source='auto'
    requested_at   timestamptz NOT NULL DEFAULT now(),
    response       text CHECK (response IS NULL OR response IN ('confirmed','cannot_attend')),
    responded_at   timestamptz,
    CONSTRAINT sac_response_pair CHECK ((response IS NULL) = (responded_at IS NULL)),
    CONSTRAINT sac_author CHECK (
        (source = 'manual' AND requested_by IS NOT NULL) OR
        (source = 'auto'   AND requested_by IS NULL)
    )
);

COMMENT ON TABLE public.shift_attendance_confirmations IS
    'Log de pedidos de confirmação de véspera (F4) — uma linha por PEDIDO, não por application. '
    'Precedente: shift_call_targets (tentativa, não contrato). Toda mutação passa por RPC/trigger '
    'SECURITY DEFINER (20260817000700) — só há policy de SELECT.';
COMMENT ON COLUMN public.shift_attendance_confirmations.source IS
    '''auto'' = varredura D-1 (request_attendance_confirmations_due, cap 1 por índice único). '
    '''manual'' = botão da empresa (request_attendance_confirmation, cap 2 no total).';

-- Idempotência da varredura por ÍNDICE, não por convenção de WHERE ... IS NULL: duas execuções
-- simultâneas do cron não duplicam pedido nem notificação.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sac_auto_once
    ON public.shift_attendance_confirmations (application_id) WHERE source = 'auto';
CREATE INDEX IF NOT EXISTS idx_sac_application ON public.shift_attendance_confirmations (application_id);
CREATE INDEX IF NOT EXISTS idx_sac_job         ON public.shift_attendance_confirmations (job_id);
CREATE INDEX IF NOT EXISTS idx_sac_worker_open ON public.shift_attendance_confirmations (worker_id)
    WHERE response IS NULL;
-- CONCURRENTLY é desnecessário (tabela nasce vazia) e quebraria a transação da migration.

-- =============================================
-- 3. RLS — Policies ANTES do ENABLE. Só SELECT: toda mutação é RPC/trigger DEFINER.
-- =============================================
DROP POLICY IF EXISTS "sac_select" ON public.shift_attendance_confirmations;
CREATE POLICY "sac_select" ON public.shift_attendance_confirmations
    FOR SELECT TO authenticated
    USING (worker_id = (SELECT auth.uid()) OR public.is_job_owner(job_id));

ALTER TABLE public.shift_attendance_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_attendance_confirmations NO FORCE ROW LEVEL SECURITY;

-- NÃO fazer `REVOKE ALL ... FROM PUBLIC` (lição de 20260318000000: derruba service_role).
REVOKE ALL  ON public.shift_attendance_confirmations FROM anon;   -- nunca FROM PUBLIC
GRANT SELECT ON public.shift_attendance_confirmations TO authenticated;
GRANT ALL    ON public.shift_attendance_confirmations TO service_role;

-- =============================================
-- 4. NOTIFICAÇÃO DO PEDIDO — trigger AFTER INSERT (UMA cópia do texto)
-- =============================================
-- Por que TRIGGER e não INSERT inline nas RPCs (ADR, decisão 4): o pedido tem DOIS caminhos de
-- escrita (RPC manual da empresa + varredura em lote), e o texto de produto não pode existir em
-- duas cópias — 20260816201322 (acentos perdidos no transporte) é a cicatriz viva disso. A
-- resposta (respond_attendance_confirmation) tem um único escritor, então fica inline na RPC
-- (20260817000700) — a regra é o número de escritores, não o papel do destinatário.
CREATE OR REPLACE FUNCTION public.notify_worker_on_attendance_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET timezone = 'America/Sao_Paulo'
AS $$
DECLARE v_when text;
BEGIN
    SELECT to_char(public.job_local_date(NEW.job_id), 'DD/MM') INTO v_when;
    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (
        NEW.worker_id,
        'status_change',
        'Confirma seu turno de ' || COALESCE(v_when, 'amanhã') || '?',
        'A empresa precisa saber se você vai. Responda com um toque em Meus Turnos — '
        || 'se não puder ir, avisar agora ajuda todo mundo.',
        '/my-jobs'
    );
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_worker_on_attendance_request() IS
    'AFTER INSERT em shift_attendance_confirmations: notifica o freela do pedido de confirmação. '
    'Cópia única do texto de produto — os dois escritores (RPC manual + varredura em lote) '
    'passam por aqui, evitando divergência de texto entre os dois caminhos (ver 20260816201322).';

DROP TRIGGER IF EXISTS trg_notify_worker_on_attendance_request ON public.shift_attendance_confirmations;
CREATE TRIGGER trg_notify_worker_on_attendance_request
    AFTER INSERT ON public.shift_attendance_confirmations
    FOR EACH ROW EXECUTE FUNCTION public.notify_worker_on_attendance_request();

-- EXECUTE em função de TRIGGER: lição 20260816201420 / 20260816201457 (advisor 0028 é falso
-- positivo aqui — a função só roda disparada pelo trigger, mas sem o GRANT o INSERT do client
-- (via RPC SECURITY DEFINER, que herda privilégio de quem chama a função, não do dono) falha).
REVOKE ALL ON FUNCTION public.notify_worker_on_attendance_request() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_worker_on_attendance_request() TO authenticated, service_role;
