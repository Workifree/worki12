-- Migration: Convite push em applications (empresa convida freela conhecido) — Slice 1
-- File: supabase/migrations/20260622000100_invite_columns_applications.sql
-- ADR: .harness/spec/v1-operacao-freelancer/adr-001-conexoes-convite.md
--
-- Decisão (Opção A do recon): ESTENDER `applications` em vez de criar `job_invitations`.
-- Razão: a application já é a aresta worker↔job e carrega todo o lifecycle (check-in/out,
-- confirmações). Um convite aceito VIRA a application do turno — sem join/migração de dados.
--
-- Modelo PUSH: no convite, a EMPRESA cria a application (status 'invited'). Hoje só o worker
-- insere (modelo pull). Esta migration adiciona uma policy de INSERT para a empresa, COM
-- restrições fortes (ver abaixo) para não furar o isolamento de papel (constitution Art. 1).
--
-- Novos status: 'invited' (empresa convidou, aguarda resposta) e 'declined' (freela recusou,
-- NEUTRO — zero punição, R7). Os status legados (pending/reviewing/interview/hired/
-- in_progress/completed/rejected) seguem intactos — o caminho pull não muda.
--
-- NÃO toca saldo/escrow. A reserva de escrow no aceite é Slice 2 (postpago). Aqui o aceite
-- só muda status. Sem RPC de saldo, sem GRANT EXECUTE financeiro.
--
-- DOWN (rollback):
--   DROP POLICY IF EXISTS "applications_insert_company_invite" ON public.applications;
--   ALTER TABLE public.applications
--     DROP COLUMN IF EXISTS invited_by_company_at,
--     DROP COLUMN IF EXISTS invitation_responded_at,
--     DROP COLUMN IF EXISTS invitation_response,
--     DROP COLUMN IF EXISTS invitation_expires_at;

-- =============================================
-- 1. COLUNAS DE CONVITE (todas nullable — backfill desnecessário; linhas antigas = pull)
-- =============================================
ALTER TABLE public.applications
    ADD COLUMN IF NOT EXISTS invited_by_company_at   timestamptz,
    ADD COLUMN IF NOT EXISTS invitation_responded_at timestamptz,
    ADD COLUMN IF NOT EXISTS invitation_response     text
        CHECK (invitation_response IS NULL OR invitation_response IN ('accepted', 'declined')),
    -- janela de expiração do convite (R8): slot reabre quando passa
    ADD COLUMN IF NOT EXISTS invitation_expires_at   timestamptz;

COMMENT ON COLUMN public.applications.invited_by_company_at IS 'Quando a empresa criou o convite push. NULL = application veio do fluxo pull (worker se candidatou).';
COMMENT ON COLUMN public.applications.invitation_response   IS 'Resposta do freela ao convite: accepted | declined (NULL enquanto pendente).';
COMMENT ON COLUMN public.applications.invitation_expires_at IS 'Expiração do convite (R8): após esta data o slot reabre.';

-- índice parcial para o operador listar convites pendentes por job
CREATE INDEX IF NOT EXISTS idx_applications_invited
    ON public.applications (job_id)
    WHERE invited_by_company_at IS NOT NULL;

-- =============================================
-- 2. RLS — INSERT pela empresa (NOVO) + INSERT pelo worker (preservado)
-- =============================================
-- Garantias de segurança da policy de INSERT da empresa:
--   (a) o job tem de pertencer a uma company do usuário autenticado
--       (job_id IN jobs de companies WHERE owner_id = auth.uid()) — não dá para convidar
--       em job alheio;
--   (b) o convidado tem de estar na EQUIPE ACEITA da empresa
--       (existe team_connections accepted entre essa company e esse worker) — não dá para
--       convidar estranho, espelhando R1/R2 (lista fechada);
--   (c) a application nasce como convite explícito (status='invited' AND invited_by_company_at
--       NOT NULL) — a empresa NÃO pode usar esta porta para forjar 'hired'/'accepted'.
-- A empresa nunca insere com worker_id = auth.uid() (ela não é worker) → isolamento mantido.

DROP POLICY IF EXISTS "applications_insert_company_invite" ON public.applications;
CREATE POLICY "applications_insert_company_invite" ON public.applications
    FOR INSERT TO authenticated
    WITH CHECK (
        status = 'invited'
        AND invited_by_company_at IS NOT NULL
        AND job_id IN (
            SELECT j.id
            FROM public.jobs j
            WHERE j.company_id IN (
                SELECT c.id FROM public.companies c WHERE c.owner_id = auth.uid()
            )
        )
        AND EXISTS (
            SELECT 1
            FROM public.team_connections tc
            JOIN public.jobs j2 ON j2.id = applications.job_id
            WHERE tc.worker_id  = applications.worker_id
              AND tc.company_id = j2.company_id
              AND tc.status     = 'accepted'
        )
    );

-- IMPORTANTE: a policy de INSERT do worker (pull) já existe
-- ("Workers can insert applications" WITH CHECK worker_id = auth.uid(), migration
-- 20260317160000). Em RLS, basta UMA policy permissiva passar (são OR-ed), então as duas
-- coexistem sem conflito: worker insere as suas; empresa insere convites.

-- =============================================
-- 3. RLS — UPDATE (resposta do freela ao convite)
-- =============================================
-- As policies de UPDATE existentes já cobrem:
--   - worker atualiza as próprias applications ("Workers can update own applications",
--     USING worker_id = auth.uid()) → o freela responde ao convite (invited→accepted/declined);
--   - empresa atualiza applications dos jobs dela (policies do fluxo de candidatura).
-- Nenhuma policy nova de UPDATE é necessária aqui. Validação de transição de status
-- (ex.: só de 'invited' para 'accepted'/'declined') fica na camada de service (não-RLS),
-- pois RLS não enxerga o valor antigo no WITH CHECK de UPDATE de forma confiável aqui.
