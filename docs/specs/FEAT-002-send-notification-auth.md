# FEAT-002: Autenticação na Edge Function send-notification

**Issue:** #117 | **Priority:** P0 | **Created:** 2026-03-16 | **Status:** Draft

---

## Problem Statement

A edge function `send-notification` (`supabase/functions/send-notification/index.ts`) não possui nenhuma verificação de autenticação. Aceita qualquer request com `type` e `userId` no body, criando notificações in-app e enviando emails via Resend API. Um atacante pode invocar esta função para enviar spam de emails, criar notificações falsas e causar custos com a API do Resend.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como operador do sistema | quero que apenas chamadas internas (service_role) possam enviar notificações | para que atacantes externos não consigam enviar spam ou gerar custos |
| Como worker/empresa | quero receber apenas notificações legítimas do sistema | para que não receba emails falsos que comprometam minha confiança na plataforma |

---

## Acceptance Criteria

**AC-1 (sem auth header):** Quando a função `send-notification` é chamada sem Authorization header, então retorna HTTP 401 com body `{"error": "Authorization header required"}`.

**AC-2 (token não service_role):** Quando a função é chamada com um JWT válido de usuário normal (não service_role), então retorna HTTP 403 com body `{"error": "Service role required"}`.

**AC-3 (service_role válido):** Quando a função é chamada com service_role key no header Authorization, então processa normalmente (envia email e cria notificação).

**AC-4 (deploy flag):** A função deve continuar com deploy flag `--no-verify-jwt` para permitir validação interna customizada (Supabase não diferencia service_role de user JWT no gateway).

---

## Technical Design

### Data Access Tier
**Selected tier:** Edge Function (`supabase/functions/send-notification/`)
**Rationale:** Esta é uma edge function existente que precisa de validação interna de autenticação.

### Components

**New files to create:**
Nenhum.

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `supabase/functions/send-notification/index.ts` | Aceita qualquer request sem verificação de auth | Adicionar verificação de Authorization header e validação de service_role antes de processar |

### Edge Functions
| Function Name | Deploy Flags | Auth | Request Body | Response |
|--------------|-------------|------|-------------|----------|
| `send-notification` | `--no-verify-jwt` | Valida internamente que caller é service_role | `{ type: string, userId: string, data: object }` | `{ success: boolean, emailSent: boolean }` |

### Database Changes
Nenhuma — usa schema existente.

### State & Data Flow
1. Request chega na edge function
2. Verificar presença do header `Authorization`
3. Extrair o token do header
4. Verificar se o token é o service_role key (comparar com `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`)
5. Se não for service_role → retornar 403
6. Se for service_role → processar normalmente (comportamento atual)

### UI / Interaction Notes
- **Loading state:** N/A — edge function, sem UI
- **Empty state:** N/A
- **Error state:** Retorna JSON com erro HTTP 401 ou 403
- **Responsive:** N/A

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | `supabase/functions/send-notification/index.ts` modificado com verificação de Authorization header e validação de service_role key. Requests sem auth retornam 401, requests com JWT normal retornam 403. | 2h | — |

**Total estimate:** 2h

**Deployment note:** Deploy `send-notification` com `--no-verify-jwt` após merge. Verificar que chamadas internas (de outras edge functions e triggers) continuam funcionando.

---

## Out of Scope (v1)

- Não inclui: Rate limiting na função
- Não inclui: IP allowlist
- Não inclui: Logging de tentativas de acesso não autorizado (será feito em issue de logging separado)
- Não inclui: Testes automatizados para a edge function (issue #130 separado)
