# FEAT-001: Message Table RLS (Row Level Security)

**Issue:** #116 | **Priority:** P0 | **Created:** 2026-03-16 | **Status:** Draft

---

## Problem Statement

A tabela `"Message"` (PascalCase, legado Prisma) não possui Row Level Security (RLS) habilitado. Qualquer usuário autenticado pode potencialmente ler, inserir ou modificar todas as mensagens do sistema via chamada direta ao Supabase client. Em um marketplace com negociações financeiras, isso é um risco grave de privacidade.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como worker | quero que minhas mensagens sejam visíveis apenas para mim e a empresa da conversa | para que conversas privadas de negociação não vazem para outros usuários |
| Como empresa | quero que apenas participantes da conversa possam enviar mensagens | para que ninguém externo injete mensagens falsas em minhas conversas |

---

## Acceptance Criteria

**AC-1 (RLS habilitado):** Quando a migration é aplicada, então `ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY` está presente e executada.

**AC-2 (SELECT restrito):** Quando um usuário autenticado faz SELECT em `"Message"`, então só vê mensagens de conversas das quais participa (via `conversation_id` → `"Conversation".application_uuid` → `applications.worker_id = auth.uid()` OR `applications.job_id IN (SELECT id FROM jobs WHERE company_id = auth.uid())`).

**AC-3 (INSERT restrito):** Quando um usuário autenticado faz INSERT em `"Message"`, então só pode inserir em conversas das quais participa, seguindo o mesmo padrão de verificação de participação.

**AC-4 (não autenticado bloqueado):** Quando um usuário não autenticado tenta acessar `"Message"`, então recebe erro de permissão (RLS bloqueia por padrão para roles não listados).

---

## Technical Design

### Data Access Tier
**Selected tier:** Direct Supabase client (frontend já usa `supabase.from("Message")`)
**Rationale:** Mensagens são acessadas diretamente pelo frontend via Supabase client. RLS é a barreira de segurança correta para este tier.

### Components

**New files to create:**
| File Path | Type | Responsibility |
|-----------|------|---------------|
| `supabase/migrations/{TIMESTAMP}_message_rls.sql` | Migration | Habilitar RLS e criar policies SELECT/INSERT para tabela `"Message"` |

**Existing files to modify:**
Nenhum — esta é uma mudança puramente de banco de dados.

### Edge Functions
None — uses direct Supabase client.

### Database Changes
```sql
-- Migration: Habilitar RLS na tabela Message
-- Risk: LOW
-- Backup required: NO
--
-- DOWN (rollback):
-- DROP POLICY IF EXISTS "Participants can view messages" ON "Message";
-- DROP POLICY IF EXISTS "Participants can insert messages" ON "Message";
-- ALTER TABLE "Message" DISABLE ROW LEVEL SECURITY;

-- UP (apply):
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;

-- SELECT: participantes da conversa podem ver mensagens
CREATE POLICY "Participants can view messages" ON "Message"
    FOR SELECT TO authenticated
    USING (
        conversation_id IN (
            SELECT id FROM "Conversation"
            WHERE application_uuid IN (
                SELECT id FROM applications
                WHERE worker_id = auth.uid()
                   OR job_id IN (SELECT id FROM jobs WHERE company_id = auth.uid())
            )
        )
    );

-- INSERT: participantes da conversa podem enviar mensagens
CREATE POLICY "Participants can insert messages" ON "Message"
    FOR INSERT TO authenticated
    WITH CHECK (
        conversation_id IN (
            SELECT id FROM "Conversation"
            WHERE application_uuid IN (
                SELECT id FROM applications
                WHERE worker_id = auth.uid()
                   OR job_id IN (SELECT id FROM jobs WHERE company_id = auth.uid())
            )
        )
    );
```

### State & Data Flow
Nenhuma mudança no frontend. O frontend já usa `supabase.from("Message")` para ler e inserir mensagens. Com RLS habilitado, as queries automaticamente filtram apenas mensagens acessíveis ao usuário autenticado. Nenhuma alteração de código é necessária.

### UI / Interaction Notes
- **Loading state:** Sem mudança
- **Empty state:** Sem mudança
- **Error state:** Se um usuário tentar acessar mensagens de uma conversa da qual não participa, receberá resultado vazio (não erro) — comportamento padrão do RLS SELECT
- **Responsive:** Sem mudança

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | Migration SQL criada em `supabase/migrations/{TIMESTAMP}_message_rls.sql` com RLS habilitado, policies SELECT e INSERT, e DOWN script completo | 2h | — |

**Total estimate:** 2h

**Deployment note:** Aplicar migration via `supabase migration up` após merge. Verificar que mensagens existentes continuam visíveis para participantes.

---

## Out of Scope (v1)

- Não inclui: Policy de UPDATE para `"Message"` (mensagens não são editáveis no app atual)
- Não inclui: Policy de DELETE para `"Message"` (mensagens não são deletáveis no app atual)
- Não inclui: Mudanças na tabela `"Conversation"` (issue #123 separado)
- Não inclui: Testes automatizados para RLS policies
