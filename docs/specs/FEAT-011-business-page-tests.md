# FEAT-011: Testes para Páginas Críticas de Negócios

**Issue:** #126 | **Priority:** P2 | **Created:** 2026-03-16 | **Status:** Draft

---

## Problem Statement

Páginas com lógica crítica de negócios (Wallet, Dashboard, MyJobs) não possuem testes unitários. Mudanças nessas páginas podem introduzir regressões sem detecção automática. As páginas de wallet são especialmente críticas pois lidam com dinheiro real.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como desenvolvedor | quero testes unitários para páginas financeiras | para que regressões em fluxos de dinheiro sejam detectadas automaticamente |
| Como pipeline | quero cobertura de teste em lógica de negócios | para que PRs não passem sem validação |

---

## Acceptance Criteria

**AC-1 (Wallet testado):** Quando `Wallet.tsx` é testado, então verifica: exibição de saldo, modal de saque, validação de PIX key, cálculo de taxa.

**AC-2 (CompanyWallet testado):** Quando `CompanyWallet.tsx` é testado, então verifica: exibição de saldo, deposit modal, escrows ativos.

**AC-3 (MyJobs testado):** Quando `MyJobs.tsx` é testado, então verifica: tabs de status, check-in/out buttons, cancelar aplicação.

**AC-4 (testes passam):** Quando `npm test -- --run` é executado, então todos os testes novos e existentes passam.

---

## Technical Design

### Data Access Tier
**Selected tier:** N/A — testes unitários
**Rationale:** Testes mockam Supabase client e walletService.

### Components

**New files to create:**
| File Path | Type | Responsibility |
|-----------|------|---------------|
| `frontend/src/pages/__tests__/Wallet.test.tsx` | Test | Testes unitários para página Wallet |
| `frontend/src/pages/company/__tests__/CompanyWallet.test.tsx` | Test | Testes unitários para página CompanyWallet |
| `frontend/src/pages/__tests__/MyJobs.test.tsx` | Test | Testes unitários para página MyJobs |

**Existing files to modify:**
Nenhum.

### Edge Functions
None.

### Database Changes
Nenhuma.

### State & Data Flow
Testes usam mocks de `supabase` e `walletService` para simular cenários: saldo zero, saldo positivo, erro de rede, wallet não encontrada.

### UI / Interaction Notes
N/A — apenas testes.

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | `Wallet.test.tsx` criado com testes: renderiza saldo, modal de saque, validação PIX, cálculo de taxa 5%. Mocks de supabase e walletService. | 3h | — |
| T2 | `CompanyWallet.test.tsx` criado com testes: renderiza saldo empresa, deposit modal, lista de escrows. | 3h | — |
| T3 | `MyJobs.test.tsx` criado com testes: tabs de status, botões de check-in/out, cancelar aplicação. | 2h | — |

**Total estimate:** 8h

**Deployment note:** Sem deploy adicional necessário.

---

## Out of Scope (v1)

- Não inclui: Testes para Messages.tsx (realtime é complexo de mockar)
- Não inclui: Testes para Admin.tsx
- Não inclui: Testes de integração (apenas unitários)
- Não inclui: Testes para CompanyDashboard.tsx
