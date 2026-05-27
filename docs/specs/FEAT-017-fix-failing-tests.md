# FEAT-017: Fix 5 Failing Tests

**Issue:** #175 | **Priority:** P1 | **Created:** 2026-03-17 | **Status:** Draft

---

## Problem Statement

5 testes estão falhando em 4 arquivos de teste, bloqueando a CI pipeline. Os testes referenciam texto de UI antigo que foi alterado durante o desenvolvimento. 189 testes passam, 5 falham. Isso reduz a confiança na suite de testes e bloqueia PRs.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como desenvolvedor | quero que todos os 194 testes passem | para que a CI não bloqueie PRs legítimos |
| Como QA | quero que os testes reflitam o comportamento atual do app | para que falhas reais sejam detectadas |

---

## Acceptance Criteria

**AC-1 (todos passam):** Quando rodar `cd frontend && npm run test -- --run`, então todos os 194 testes passam (0 falhas).

**AC-2 (ProtectedRoute TOS):** Dado que os testes de `ProtectedRoute.test.tsx` e `ProtectedRoute.onboarding.test.tsx` estão atualizados, quando executados, então passam com os mocks corretos para TOS gate e onboarding gate.

**AC-3 (CompanyJobCandidates):** Dado que o teste de `CompanyJobCandidates.test.tsx` usa o texto atualizado, quando executado, então busca "Confirmar Entrega" em vez de "Finalizar Job".

**AC-4 (build intacto):** Quando rodar `cd frontend && npm run build`, então o build passa com 0 erros.

---

## Technical Design

### Data Access Tier
**Selected tier:** N/A — alteração exclusivamente em arquivos de teste.
**Rationale:** Testes não acessam dados reais.

### Components

**New files to create:**
Nenhum.

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `frontend/src/components/__tests__/ProtectedRoute.test.tsx` | 1 falha — loading state assertion desatualizada | Atualizar assertion para refletir comportamento atual |
| `frontend/src/components/ProtectedRoute.onboarding.test.tsx` | 1 falha — mock de empresa com onboarding_completed=true não funciona | Atualizar mock para refletir lógica atual |
| `frontend/src/components/ProtectedRoute.test.tsx` | 2 falhas — mocks TOS desatualizados | Atualizar mocks de TOS gate |
| `frontend/src/pages/company/CompanyJobCandidates.test.tsx` | 1 falha — busca "Finalizar Job" que foi renomeado | Alterar para "Confirmar Entrega" |

### Edge Functions
None — uses direct Supabase client / walletService.

### Database Changes
Nenhuma — usa schema existente.

### State & Data Flow
Sem mudança no state ou data flow — apenas correções em arquivos de teste para refletir o comportamento atual dos componentes.

### UI / Interaction Notes
- **Loading state:** N/A — testes apenas
- **Empty state:** N/A
- **Error state:** N/A
- **Responsive:** N/A
- **Design pattern:** N/A — arquivo de testes

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | Todos os 4 arquivos de teste corrigidos. `npm run test -- --run` retorna 194/194 passando. | 2h | — |

**Total estimate:** 2h

**Deployment note:** Sem deploy adicional necessário.

---

## Out of Scope (v1)

- Não inclui: adição de novos testes
- Não inclui: refatoração de testes existentes que já passam
- Não inclui: aumento de cobertura de testes
