-- Migration: Impedir worker de forjar auto-convite em applications — Slice 1 (loop relacional)
-- File: supabase/migrations/20260622000400_block_worker_self_invite.sql
-- ADR: .harness/spec/v1-operacao-freelancer/adr-001-conexoes-convite.md
--
-- CONTEXTO (finding HIGH do security-review do Slice 1):
--   A policy de INSERT do worker PRÉ-EXISTENTE ("Workers can insert applications", migration
--   20260317160000) usa apenas WITH CHECK (worker_id = auth.uid()) — não restringe `status`.
--   Com as colunas de convite (20260622000100) e o status 'invited' agora válidos, um worker
--   poderia inserir a própria application com status='invited' e invited_by_company_at=now(),
--   FORJANDO um convite que a empresa nunca enviou. Isso furaria o modelo PUSH (só a empresa
--   convida — R1) e poderia, no aceite, levar a 'hired' pela exceção de convite (20260622000300).
--
--   FIX: recriar a policy de INSERT do worker adicionando ao WITH CHECK que ele NÃO pode nascer
--   como convite — status NOT IN ('invited','declined') E invited_by_company_at IS NULL.
--   (O caminho de convite continua sendo só o da empresa: policy
--   "applications_insert_company_invite" da 20260622000100, OR-ed com esta.)
--
--   Objeto PRÉ-EXISTENTE já deployado → NOVA migration (não edição in-place).
--
-- NÃO toca saldo/escrow. Idempotente (DROP ... IF EXISTS + CREATE). Reversível (DOWN abaixo).
--
-- DOWN (rollback) — restaurar a policy permissiva da 20260317160000:
--   DROP POLICY IF EXISTS "Workers can insert applications" ON public.applications;
--   CREATE POLICY "Workers can insert applications" ON public.applications
--     FOR INSERT TO authenticated WITH CHECK (worker_id = auth.uid());

DROP POLICY IF EXISTS "Workers can insert applications" ON public.applications;

CREATE POLICY "Workers can insert applications"
ON public.applications FOR INSERT TO authenticated
WITH CHECK (
    worker_id = auth.uid()
    -- Worker se candidata pelo fluxo PULL: a linha NÃO pode nascer como convite.
    -- 'invited'/'declined' são estados do fluxo PUSH (empresa convida / freela recusa).
    AND status NOT IN ('invited', 'declined')
    -- Reforço: a marca de convite só a empresa pode pôr (policy de INSERT da empresa).
    AND invited_by_company_at IS NULL
);
