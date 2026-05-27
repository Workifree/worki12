# FEAT-008: Conversation UPDATE Policy

**Issue:** #123 | **Priority:** P2 | **Created:** 2026-03-16 | **Status:** Draft

---

## Problem Statement

A tabela `"Conversation"` tem RLS habilitado com policies de SELECT e INSERT, mas não possui policy de UPDATE. O campo `islocked` só pode ser modificado via service_role (edge functions). Se alguma funcionalidade futura precisar atualizar conversas via frontend, falhará silenciosamente.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como desenvolvedor | quero que a cobertura de RLS para Conversation seja completa | para que futuras features de atualização de conversa não falhem silenciosamente |

---

## Acceptance Criteria

**AC-1 (policy criada):** Quando a migration é aplicada, então existe policy de UPDATE para `"Conversation"` permitindo que participantes atualizem conversas das quais participam.

**AC-2 (pattern consistente):** Quando a policy de UPDATE é verificada, então usa o mesmo pattern de participação da policy de SELECT (via `application_uuid → applications → worker_id/job.company_id`).

**AC-3 (islocked protegido):** Quando um participante tenta atualizar `islocked` via frontend, então a atualização é limitada a campos não-sensíveis (não é possível desbloquear uma conversa bloqueada via frontend — isso requer service_role).

---

## Technical Design

### Data Access Tier
**Selected tier:** N/A — migration de banco de dados
**Rationale:** Mudança de RLS policy.

### Components

**New files to create:**
| File Path | Type | Responsibility |
|-----------|------|---------------|
| `supabase/migrations/{TIMESTAMP}_conversation_update_policy.sql` | Migration | Adicionar policy de UPDATE para tabela Conversation |

**Existing files to modify:**
Nenhum.

### Edge Functions
None.

### Database Changes
```sql
-- Migration: Adicionar UPDATE policy para Conversation
-- Risk: LOW
-- Backup required: NO
--
-- DOWN (rollback):
-- DROP POLICY IF EXISTS "Participants can update conversations" ON "Conversation";

-- UP (apply):
CREATE POLICY "Participants can update conversations" ON "Conversation"
    FOR UPDATE TO authenticated
    USING (
        application_uuid IN (
            SELECT id FROM applications
            WHERE worker_id = auth.uid()
               OR job_id IN (SELECT id FROM jobs WHERE company_id = auth.uid())
        )
    )
    WITH CHECK (
        application_uuid IN (
            SELECT id FROM applications
            WHERE worker_id = auth.uid()
               OR job_id IN (SELECT id FROM jobs WHERE company_id = auth.uid())
        )
    );
```

### State & Data Flow
Nenhuma mudança no frontend. A policy apenas habilita a possibilidade de UPDATE via frontend no futuro.

### UI / Interaction Notes
N/A — mudança puramente de banco de dados.

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | Migration criada em `supabase/migrations/{TIMESTAMP}_conversation_update_policy.sql` com policy de UPDATE seguindo pattern de participação. DOWN script incluso. | 1h | — |

**Total estimate:** 1h

**Deployment note:** Aplicar migration via `supabase migration up` após merge.

---

## Out of Scope (v1)

- Não inclui: Restrição de colunas atualizáveis (Supabase RLS não suporta column-level restrictions diretamente)
- Não inclui: Frontend usando UPDATE em Conversation
- Não inclui: Testes de RLS
