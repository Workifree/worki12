-- Migration: Conexões consentidas empresa↔freela ("minha equipe") — Slice 1 (loop relacional)
-- File: supabase/migrations/20260622000000_team_connections.sql
-- ADR: .harness/spec/v1-operacao-freelancer/adr-001-conexoes-convite.md
--
-- Modelo: aresta bilateral consentida (handshake UMA vez). A empresa adiciona o freela
-- (via QR / link / telefone) e o freela aceita uma vez. Convites de turno seguintes NÃO
-- re-pedem handshake (R2). O freela pode sair da equipe / bloquear uma loja.
--
-- Tipos (confirmados pelas migrations existentes):
--   companies.id  = auth.uid() do user 'hire' (trigger handle_new_user)  → UUID
--   workers.id    = auth.uid() do user 'work'                            → UUID
--   companies.owner_id = companies.id (= auth.uid())                     → UUID
-- Isolamento de papel (constitution Art. 1): empresa gerencia o lado dela; worker só aceita/bloqueia.
--
-- NÃO toca saldo/escrow. Sem RPC de saldo. Sem GRANT EXECUTE de RPC financeira.
--
-- DOWN (rollback): DROP TABLE IF EXISTS public.team_connections CASCADE;

-- =============================================
-- 1. TABELA
-- =============================================
CREATE TABLE IF NOT EXISTS public.team_connections (
    id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    worker_id     uuid        NOT NULL REFERENCES public.workers(id)   ON DELETE CASCADE,
    status        text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'accepted', 'blocked')),
    -- canal pelo qual a empresa adicionou o freela (auditoria / BI de aquisição)
    source        text        NOT NULL DEFAULT 'link'
                              CHECK (source IN ('qr', 'link', 'phone')),
    -- quem disparou o bloqueio (worker sai/bloqueia; empresa pode remover) — auditoria
    blocked_by    uuid,
    created_at    timestamptz NOT NULL DEFAULT now(),
    accepted_at   timestamptz,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    -- uma conexão por par empresa↔freela (idempotência do convite de equipe)
    CONSTRAINT team_connections_unique_pair UNIQUE (company_id, worker_id)
);

COMMENT ON TABLE  public.team_connections IS 'Aresta consentida empresa↔freela (roster "minha equipe"). Handshake 1x.';
COMMENT ON COLUMN public.team_connections.status     IS 'pending = empresa convidou, aguarda aceite do freela; accepted = na equipe; blocked = freela saiu/bloqueou.';
COMMENT ON COLUMN public.team_connections.source     IS 'Canal de origem da conexão: qr | link | phone.';
COMMENT ON COLUMN public.team_connections.blocked_by IS 'auth.uid() de quem bloqueou (worker ou company), para auditoria.';

-- =============================================
-- 2. ÍNDICES (tabela nova/vazia → CREATE INDEX simples é seguro)
-- =============================================
CREATE INDEX IF NOT EXISTS idx_team_connections_company
    ON public.team_connections (company_id, status);
CREATE INDEX IF NOT EXISTS idx_team_connections_worker
    ON public.team_connections (worker_id, status);

-- trigger utilitário de updated_at
CREATE OR REPLACE FUNCTION public.set_team_connections_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_connections_updated_at ON public.team_connections;
CREATE TRIGGER trg_team_connections_updated_at
    BEFORE UPDATE ON public.team_connections
    FOR EACH ROW
    EXECUTE FUNCTION public.set_team_connections_updated_at();

-- =============================================
-- 3. RLS
-- =============================================
ALTER TABLE public.team_connections ENABLE ROW LEVEL SECURITY;
-- NÃO usar FORCE ROW LEVEL SECURITY: a migration 20260318000000_fix_force_rls_service_role.sql
-- documenta que FORCE RLS + REVOKE bloqueia o service_role (Edge Functions deixam de acessar a
-- tabela). RLS normal já é suficiente — anon/authenticated continuam filtrados pelas policies, e o
-- service_role bypassa RLS por padrão (sem FORCE). Alinhado com workers/companies/applications/jobs.

-- Sem acesso anônimo (mesmo padrão de applications/companies/workers)
REVOKE ALL ON public.team_connections FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_connections TO authenticated;
-- service_role precisa de acesso explícito: o REVOKE acima pode atingir papéis que herdam de PUBLIC,
-- e Edge Functions (asaas-*, send-notification, admin-data) podem ler/gravar a equipe. Sem este GRANT,
-- o .from('team_connections') via service_role falha. (Espelha o GRANT ALL ... TO service_role da 20260318000000.)
GRANT ALL ON public.team_connections TO service_role;

-- ---- SELECT: cada lado vê as conexões em que participa ----
DROP POLICY IF EXISTS "tc_select_participants" ON public.team_connections;
CREATE POLICY "tc_select_participants" ON public.team_connections
    FOR SELECT TO authenticated
    USING (
        company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
        OR worker_id = auth.uid()
    );

-- ---- INSERT: SÓ a empresa cria a conexão (ela convida o freela) ----
-- O worker NÃO insere; ele apenas aceita (UPDATE) uma conexão existente.
-- WITH CHECK garante que a empresa só pode criar conexões para uma company que é dela,
-- e que a conexão nasce em 'pending' (não pode auto-aceitar pelo freela).
DROP POLICY IF EXISTS "tc_insert_company" ON public.team_connections;
CREATE POLICY "tc_insert_company" ON public.team_connections
    FOR INSERT TO authenticated
    WITH CHECK (
        company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
        AND status = 'pending'
    );

-- ---- UPDATE (empresa): pode reativar/gerenciar sua ponta; NÃO pode forjar 'accepted' ----
-- A empresa pode mexer na conexão dela, mas NÃO pode marcar 'accepted' (só o freela aceita).
-- Pode mover para 'pending' (reconvidar) ou 'blocked' (remover da equipe).
-- IMPORTANTE (segurança): o `blocked` é um veto explícito do FREELA (ele saiu/bloqueou a loja).
-- A empresa NÃO pode desfazer esse bloqueio reconvidando (blocked→pending). Por isso o USING
-- exclui linhas já `blocked` do escopo de UPDATE da empresa: uma conexão bloqueada fica fora do
-- alcance da empresa até o próprio freela reativá-la (ele controla a transição a partir de 'blocked').
DROP POLICY IF EXISTS "tc_update_company" ON public.team_connections;
CREATE POLICY "tc_update_company" ON public.team_connections
    FOR UPDATE TO authenticated
    USING (
        company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
        AND status <> 'blocked'
    )
    WITH CHECK (
        company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
        AND status IN ('pending', 'blocked')
    );

-- ---- UPDATE (worker): aceita (pending→accepted) ou bloqueia/sai (→blocked) ----
-- O worker só atua em conexões dele. WITH CHECK restringe os estados que ele pode setar.
DROP POLICY IF EXISTS "tc_update_worker" ON public.team_connections;
CREATE POLICY "tc_update_worker" ON public.team_connections
    FOR UPDATE TO authenticated
    USING (worker_id = auth.uid())
    WITH CHECK (
        worker_id = auth.uid()
        AND status IN ('accepted', 'blocked')
    );

-- ---- DELETE: apenas a empresa remove fisicamente (worker usa 'blocked', não delete) ----
DROP POLICY IF EXISTS "tc_delete_company" ON public.team_connections;
CREATE POLICY "tc_delete_company" ON public.team_connections
    FOR DELETE TO authenticated
    USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));
