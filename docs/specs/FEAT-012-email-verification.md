# FEAT-012: Verificação de Email no Login

**Issue:** #127 | **Priority:** P3 | **Created:** 2026-03-16 | **Status:** Draft

---

## Problem Statement

O signup mostra mensagem "Verifique seu email para confirmar", mas o fluxo de login não verifica se `email_confirmed_at` está preenchido. Se a confirmação não é exigida, usuários podem se cadastrar com emails falsos, não recebendo notificações por email e não podendo recuperar senha.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como operador | quero que apenas usuários com email verificado possam usar o sistema | para que comunicações por email funcionem |
| Como worker | quero ser avisado se meu email não foi confirmado | para que eu possa verificar antes de perder notificações |

---

## Acceptance Criteria

**AC-1 (erro tratado):** Quando um usuário tenta fazer login sem email confirmado, então vê toast `'Por favor, verifique seu email antes de fazer login.'` tipo error.

**AC-2 (verificação Supabase):** Quando a configuração do Supabase project é verificada, então `email_confirm` está habilitado no dashboard.

**AC-3 (catch existente):** Quando o erro "Email not confirmed" ocorre no login (`Login.tsx`), então é tratado no catch exibindo a mensagem apropriada em português.

---

## Technical Design

### Data Access Tier
**Selected tier:** Direct Supabase client
**Rationale:** Erro retornado por `supabase.auth.signInWithPassword()`.

### Components

**New files to create:**
Nenhum.

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `frontend/src/pages/Login.tsx` | Catch genérico de erro de login | Adicionar tratamento específico para erro "Email not confirmed" com toast em português |

### Edge Functions
None.

### Database Changes
Nenhuma.

### State & Data Flow
1. Usuário tenta login com `supabase.auth.signInWithPassword()`
2. Se email não confirmado, Supabase retorna erro com mensagem "Email not confirmed"
3. Frontend detecta essa mensagem no catch e exibe toast específico
4. Usuário permanece na página de login

### UI / Interaction Notes
- **Loading state:** Sem mudança
- **Empty state:** N/A
- **Error state:** Toast `'Por favor, verifique seu email antes de fazer login.'` tipo error
- **Responsive:** Sem mudança

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | `Login.tsx` modificado com tratamento de erro "Email not confirmed". Toast em português exibido. Build e lint passam. | 1h | — |

**Total estimate:** 1h

**Deployment note:** Verificar no Supabase Dashboard que `email_confirm` está habilitado.

---

## Out of Scope (v1)

- Não inclui: Reenvio de email de confirmação
- Não inclui: Mudanças na configuração do Supabase
- Não inclui: Verificação de email no signup flow
