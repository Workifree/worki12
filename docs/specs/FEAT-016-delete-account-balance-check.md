# FEAT-016: Worker Delete Account Balance Check

**Issue:** #174 | **Priority:** P0 | **Created:** 2026-03-17 | **Status:** Draft

---

## Problem Statement

A edge function `delete-account/index.ts` verifica escrow ativo para empresas (linhas 48-74) mas não verifica saldo positivo para workers. Um worker com R$ 500 na carteira pode deletar a conta, perdendo o dinheiro permanentemente. Os fundos ficam retidos na conta master Asaas sem possibilidade de reconciliação. Empresas com saldo positivo (sem escrow ativo) também podem deletar sem aviso.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como worker | quero ser impedido de deletar minha conta se tenho saldo positivo | para que não perca meu dinheiro permanentemente |
| Como empresa | quero ser impedida de deletar minha conta se tenho saldo positivo | para que não perca meus créditos depositados |

---

## Acceptance Criteria

**AC-1 (happy path — worker saldo zero):** Dado que um worker com saldo = 0 está autenticado, quando tenta deletar a conta via edge function `delete-account`, então a exclusão funciona normalmente e retorna `{ success: true }`.

**AC-2 (bloqueio — worker saldo positivo):** Quando um worker com saldo > 0 chama a edge function `delete-account`, então recebe status 400 com mensagem `"Você tem saldo disponível na sua carteira. Saque seus fundos antes de deletar sua conta."` e a conta NÃO é deletada.

**AC-3 (bloqueio — empresa saldo positivo):** Quando uma empresa com saldo > 0 (sem escrow ativo) chama a edge function `delete-account`, então recebe status 400 com mensagem `"Você tem saldo disponível na sua carteira. Saque seus fundos antes de deletar sua conta."` e a conta NÃO é deletada.

**AC-4 (frontend feedback):** Quando o backend retorna erro 400 com mensagem de saldo, então o frontend exibe a mensagem de erro retornada pelo backend no toast de erro.

---

## Technical Design

### Data Access Tier
**Selected tier:** Edge Function
**Rationale:** A funcionalidade já existe como edge function `delete-account/index.ts` — modificação direta no mesmo arquivo.

### Components

**New files to create:**
Nenhum.

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `supabase/functions/delete-account/index.ts` | Verifica escrow ativo para empresas mas não verifica saldo para nenhum role | Adicionar verificação de saldo positivo para workers (após detecção de role) e para empresas (antes da verificação de escrow) |

### Edge Functions
| Function Name | Deploy Flags | Auth | Request Body | Response |
|--------------|-------------|------|-------------|----------|
| `supabase/functions/delete-account/` | none (JWT required) | JWT required — userId extraído do token | nenhum body necessário | `{ success: true }` ou `{ error: string }` |

### Database Changes
Nenhuma — usa schema existente.

### State & Data Flow
O flow não muda do ponto de vista do frontend. A edge function `delete-account` já é chamada pelo frontend quando o user confirma exclusão. O que muda é: antes de prosseguir com a exclusão, a function agora consulta `wallets` table para verificar se o saldo é > 0. Se for, retorna erro 400. O frontend já exibe o erro retornado em toast.

### UI / Interaction Notes
- **Loading state:** Sem mudança — o frontend já tem loading durante a chamada.
- **Empty state:** N/A
- **Error state:** O toast exibe a mensagem retornada pelo backend: `"Você tem saldo disponível na sua carteira. Saque seus fundos antes de deletar sua conta."`
- **Responsive:** Sem mudança.
- **Design pattern:** Sem mudança visual — apenas nova mensagem de erro.

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | `supabase/functions/delete-account/index.ts` modificado com verificação de saldo para workers e empresas. Retorna 400 se saldo > 0. | 2h | — |
| T2 | Verificação no frontend de que a mensagem de erro do backend é exibida no toast (confirmar que Profile.tsx já faz isso). Se não, modificar. | 1h | T1 |

**Total estimate:** 3h

**Deployment note:** Deploy `delete-account` após merge — sem flags especiais (JWT required por padrão).

---

## Out of Scope (v1)

- Não inclui: saque automático antes da exclusão
- Não inclui: email de aviso sobre saldo antes de deletar
- Não inclui: período de grace (cooling off) para exclusão
- Não inclui: admin ability to force-delete accounts with balance
