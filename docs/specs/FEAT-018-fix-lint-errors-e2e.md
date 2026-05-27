# FEAT-018: Fix 5 Lint Errors in E2E Spec Files

**Issue:** #176 | **Priority:** P1 | **Created:** 2026-03-17 | **Status:** Draft

---

## Problem Statement

`npm run lint` retorna 5 erros em 2 arquivos E2E, todos `@typescript-eslint/no-unused-vars`. Variáveis são atribuídas mas nunca usadas. Isso bloqueia a CI pipeline para todos os PRs.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como desenvolvedor | quero que `npm run lint` passe com 0 erros | para que a CI não bloqueie PRs legítimos |

---

## Acceptance Criteria

**AC-1 (lint limpo):** Quando rodar `cd frontend && npm run lint`, então 0 erros são reportados.

**AC-2 (variáveis tratadas):** Dado que as 5 variáveis não utilizadas são identificadas, quando corrigidas, então são removidas ou prefixadas com `_` para indicar intencionalidade.

**AC-3 (E2E intactos):** Quando rodar os testes E2E (se disponíveis), então nenhum teste novo falha por causa das mudanças.

---

## Technical Design

### Data Access Tier
**Selected tier:** N/A — alteração exclusivamente em arquivos E2E.
**Rationale:** Arquivos de teste E2E não acessam dados.

### Components

**New files to create:**
Nenhum.

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `frontend/e2e/flow50-52-55.spec.ts` | Linha 227: `workerMsgText` não usado. Linha 228: `companyMsgText` não usado. | Prefixar com `_` ou remover atribuição |
| `frontend/e2e/full-app-test.spec.ts` | Linha 108: `senhaInput` não usado. Linha 168: `has404` não usado. Linha 286: `workerLoggedIn` não usado. | Prefixar com `_` ou remover atribuição |

### Edge Functions
None — uses direct Supabase client / walletService.

### Database Changes
Nenhuma — usa schema existente.

### State & Data Flow
Sem mudança — apenas correção de lint em arquivos E2E.

### UI / Interaction Notes
- N/A — arquivos de teste apenas

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | 5 erros de lint corrigidos em 2 arquivos E2E. `npm run lint` retorna 0 erros. | 1h | — |

**Total estimate:** 1h

**Deployment note:** Sem deploy adicional necessário.

---

## Out of Scope (v1)

- Não inclui: refatoração de testes E2E
- Não inclui: adição de novos testes E2E
- Não inclui: correção de warnings (apenas erros)
