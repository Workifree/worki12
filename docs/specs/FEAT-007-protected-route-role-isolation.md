# FEAT-007: ProtectedRoute com Isolamento de Role

**Issue:** #122 | **Priority:** P2 | **Created:** 2026-03-16 | **Status:** Draft

---

## Problem Statement

O `ProtectedRoute` (`frontend/src/components/ProtectedRoute.tsx`) verifica autenticação, onboarding e TOS, mas não verifica o role (user_type) do usuário. Um worker que conhece a URL pode navegar para `/company/dashboard`, `/company/create`, etc. e vice-versa. Embora não haja vazamento de dados (queries usam `auth.uid()`), o usuário vê uma página vazia/confusa com a UI do role errado.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como worker | quero ser redirecionado para meu dashboard se acesso uma URL de empresa | para que não veja uma página vazia com UI azul |
| Como empresa | quero ser redirecionado para meu dashboard se acesso uma URL de worker | para que não fique confuso com a interface errada |

---

## Acceptance Criteria

**AC-1 (worker bloqueado de company):** Quando um usuário com `user_type=work` acessa qualquer rota `/company/*`, então é redirecionado para `/dashboard`.

**AC-2 (company bloqueado de worker):** Quando um usuário com `user_type=hire` acessa rota worker (`/dashboard`, `/jobs`, `/my-jobs`, `/wallet`, `/messages`, `/profile`, `/notifications`), então é redirecionado para `/company/dashboard`.

**AC-3 (toast informativo):** Quando o redirect acontece, então o usuário vê o toast `'Você não tem permissão para acessar esta página.'` com tipo `'error'`.

**AC-4 (rotas compartilhadas preservadas):** Quando um usuário acessa rotas compartilhadas (`/help`, `/terms`, `/privacy`, `/analytics`), então não é redirecionado independente do role.

---

## Technical Design

### Data Access Tier
**Selected tier:** N/A — lógica de roteamento frontend
**Rationale:** Verificação de role no componente de rota protegida.

### Components

**New files to create:**
Nenhum.

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `frontend/src/components/ProtectedRoute.tsx` | Verifica auth + onboarding + TOS, mas não verifica role | Adicionar verificação de `user_type` vs. path pattern. Se worker acessa `/company/*` → redirect. Se company acessa rotas worker → redirect. |
| `frontend/src/App.tsx` | Rotas agrupadas mas sem distinção de role | Pode precisar de ajuste para passar prop `allowedRole` ao ProtectedRoute, ou lógica fica direto no ProtectedRoute baseada no path |

### Edge Functions
None.

### Database Changes
Nenhuma — usa schema existente.

### State & Data Flow
1. ProtectedRoute já obtém `user_metadata.user_type` durante auth check
2. Após auth check passar, verificar se pathname começa com `/company/` e user_type é `work` → redirect para `/dashboard` + toast
3. Verificar se pathname é rota worker-only e user_type é `hire` → redirect para `/company/dashboard` + toast
4. Rotas compartilhadas (/help, /terms, /privacy, /analytics) não são afetadas

### UI / Interaction Notes
- **Loading state:** Sem mudança (loader existente continua)
- **Empty state:** N/A
- **Error state:** Toast `'Você não tem permissão para acessar esta página.'` tipo error
- **Responsive:** Sem mudança

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | `ProtectedRoute.tsx` modificado com lógica de role isolation baseada em pathname. Workers redirecionados de `/company/*`, companies redirecionadas de rotas worker. Toast informativo em português. Build e lint passam. Testes existentes atualizados se necessário. | 3h | — |

**Total estimate:** 3h

**Deployment note:** Sem deploy adicional necessário.

---

## Out of Scope (v1)

- Não inclui: Rotas separadas por ProtectedRoute com prop `allowedRole` (simplificação: lógica baseada em pathname)
- Não inclui: Admin role isolation
- Não inclui: Testes E2E para verificação de role
