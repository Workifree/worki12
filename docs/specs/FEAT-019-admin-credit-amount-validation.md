# FEAT-019: Admin Credit Amount Validation

**Issue:** #177 | **Priority:** P1 | **Created:** 2026-03-17 | **Status:** Draft

---

## Problem Statement

A ação `admin_credit` em `supabase/functions/admin-data/index.ts:240-251` aceita o campo `amount` do body sem validar que seja positivo ou numérico. O RPC `credit_deposit` aceita valores negativos, o que subtrai do saldo do usuário. Um admin pode acidentalmente debitar carteiras.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como admin | quero que o sistema rejeite amounts inválidos no admin_credit | para que não debite acidentalmente carteiras de usuários |
| Como usuário | quero que minha carteira não possa ser debitada via admin_credit | para que meu saldo esteja protegido contra erros |

---

## Acceptance Criteria

**AC-1 (amount negativo):** Quando `admin_credit` recebe `amount <= 0`, então retorna status 400 com mensagem `"Amount must be positive"`.

**AC-2 (amount não numérico):** Quando `admin_credit` recebe `amount` não numérico (string, null, undefined, boolean), então retorna status 400 com mensagem `"Amount must be a number"`.

**AC-3 (amount válido):** Quando `admin_credit` recebe `amount > 0` e numérico, então funciona normalmente creditando o saldo.

**AC-4 (create_deposit validation):** Quando `create_deposit` recebe `amount <= 0`, então retorna status 400 com mensagem `"Amount must be positive"` (mesma validação aplicada).

---

## Technical Design

### Data Access Tier
**Selected tier:** Edge Function
**Rationale:** Modificação direta na edge function `admin-data/index.ts` que já existe.

### Components

**New files to create:**
Nenhum.

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `supabase/functions/admin-data/index.ts` | `admin_credit` aceita qualquer amount sem validação. `create_deposit` aceita qualquer amount. | Adicionar validação `typeof amount !== 'number'` → 400 e `amount <= 0` → 400 em ambas as ações |

### Edge Functions
| Function Name | Deploy Flags | Auth | Request Body | Response |
|--------------|-------------|------|-------------|----------|
| `supabase/functions/admin-data/` | `--no-verify-jwt` | Own auth check (admin email list) | `{ action: 'admin_credit', user_id, amount }` | `{ success, credited, new_balance }` ou `{ error }` |

### Database Changes
Nenhuma — usa schema existente.

### State & Data Flow
Sem mudança no data flow. A validação é adicionada na edge function antes de chamar o RPC. Se o amount for inválido, retorna erro 400 imediatamente sem chamar o RPC.

### UI / Interaction Notes
- **Loading state:** N/A — edge function backend
- **Empty state:** N/A
- **Error state:** Admin vê erro 400 no response da API
- **Responsive:** N/A
- **Design pattern:** N/A — backend

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | `supabase/functions/admin-data/index.ts` modificado com validação de amount em `admin_credit` e `create_deposit`. Retorna 400 para amount <= 0 ou não numérico. | 1h | — |

**Total estimate:** 1h

**Deployment note:** Deploy `admin-data` com `--no-verify-jwt` após merge.

---

## Out of Scope (v1)

- Não inclui: limite máximo de amount (cap)
- Não inclui: logs de auditoria para ações admin
- Não inclui: confirmação em duas etapas para créditos admin
- Não inclui: validação no frontend Admin.tsx (validação server-side é suficiente)
