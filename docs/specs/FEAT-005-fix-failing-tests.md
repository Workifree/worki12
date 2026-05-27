# FEAT-005: Corrigir 8 Testes Falhando (ToastProvider)

**Issue:** #120 | **Priority:** P1 | **Created:** 2026-03-16 | **Status:** Draft

---

## Problem Statement

8 testes estão falhando em 4 arquivos de teste porque os testes do ProtectedRoute não envolvem o componente com `ToastProvider`. O `TosGateModal` (renderizado dentro de ProtectedRoute) usa `useToast()`, causando erro `"useToast must be used within a ToastProvider"`. 160 testes passam mas 8 falham, indicando regressão após adição do TOS gate.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como desenvolvedor | quero que todos os 168 testes passem | para que o CI bloqueie PRs com regressões reais |
| Como pipeline | quero `npm test -- --run` com 0 falhas | para que QA agent não bloqueie por falsos positivos |

---

## Acceptance Criteria

**AC-1 (ToastProvider nos testes):** Quando os testes do ProtectedRoute rodam, então o componente é envolvido com `ToastProvider` no wrapper de teste.

**AC-2 (zero falhas):** Quando `cd frontend && npm test -- --run` é executado, então 0 testes falham (168 de 168 passam, ou mais se novos testes forem adicionados).

**AC-3 (CompanyJobCandidates corrigido):** Quando o teste `CompanyJobCandidates.test.tsx` roda, então passa sem erro de ToastProvider.

---

## Technical Design

### Data Access Tier
**Selected tier:** N/A — correção de testes
**Rationale:** Não envolve data fetching.

### Components

**New files to create:**
Nenhum.

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `frontend/src/components/__tests__/ProtectedRoute.test.tsx` | Renderiza ProtectedRoute sem ToastProvider | Envolver com `<ToastProvider>` no render wrapper |
| `frontend/src/components/ProtectedRoute.onboarding.test.tsx` | Renderiza ProtectedRoute sem ToastProvider | Envolver com `<ToastProvider>` no render wrapper |
| `frontend/src/components/ProtectedRoute.test.tsx` | Renderiza ProtectedRoute sem ToastProvider | Envolver com `<ToastProvider>` no render wrapper |
| `frontend/src/pages/company/CompanyJobCandidates.test.tsx` | Renderiza sem ToastProvider | Envolver com `<ToastProvider>` no render wrapper |

### Edge Functions
None.

### Database Changes
Nenhuma — usa schema existente.

### State & Data Flow
Sem mudança funcional. Os testes são modificados para incluir o `ToastProvider` no wrapper de renderização, assim como o app real faz via `App.tsx`.

### UI / Interaction Notes
N/A — apenas testes.

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | 4 arquivos de teste corrigidos com `<ToastProvider>` no wrapper. `npm test -- --run` passa com 0 falhas. | 2h | — |

**Total estimate:** 2h

**Deployment note:** Sem deploy adicional necessário.

---

## Out of Scope (v1)

- Não inclui: Novos testes para ProtectedRoute
- Não inclui: Configuração do CI/GitHub Actions (verificar se step de testes bloqueia PRs)
- Não inclui: Testes para TosGateModal
