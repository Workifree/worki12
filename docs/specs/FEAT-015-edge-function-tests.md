# FEAT-015: Testes para Edge Functions de Pagamento

**Issue:** #130 | **Priority:** P3 | **Created:** 2026-03-16 | **Status:** Draft

---

## Problem Statement

As edge functions Deno que processam todas as operações financeiras (`asaas-checkout`, `asaas-deposit`, `asaas-withdraw`, `asaas-webhook`) não possuem testes. Estas funções são o código mais crítico do sistema — lidam com dinheiro real, webhooks externos e dados sensíveis. Mudanças podem quebrar fluxos de pagamento sem detecção automática.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como desenvolvedor | quero testes para edge functions financeiras | para que mudanças em fluxos de pagamento sejam validadas automaticamente |
| Como operador | quero garantia de que webhooks de pagamento processam corretamente | para que depósitos e saques não falhem silenciosamente |

---

## Acceptance Criteria

**AC-1 (webhook testado):** Quando testes são criados para `asaas-webhook`, então validam: dedup (23505 constraint), UUID validation, amount validation, IP check.

**AC-2 (withdraw testado):** Quando testes são criados para `asaas-withdraw`, então validam: balance check, fee calculation (5%), rollback on failure.

**AC-3 (checkout testado):** Quando testes são criados para `asaas-checkout`, então validam: job ownership, application status check.

**AC-4 (mocks usados):** Quando os testes rodam, então usam mocks para Asaas API e Supabase client (não fazem chamadas reais).

---

## Technical Design

### Data Access Tier
**Selected tier:** Edge Functions (Deno runtime)
**Rationale:** Testes para edge functions Deno.

### Components

**New files to create:**
| File Path | Type | Responsibility |
|-----------|------|---------------|
| `supabase/functions/asaas-webhook/index.test.ts` | Test | Testes unitários para webhook |
| `supabase/functions/asaas-withdraw/index.test.ts` | Test | Testes unitários para withdraw |
| `supabase/functions/asaas-checkout/index.test.ts` | Test | Testes unitários para checkout |

**Existing files to modify:**
Nenhum.

### Edge Functions
Testes apenas — sem modificação de funções existentes.

### Database Changes
Nenhuma.

### State & Data Flow
Testes criam mocks de `Deno.env`, `supabase.from()`, `supabase.rpc()` e `fetch()` (para Asaas API). Cada teste verifica cenários de sucesso e falha.

### UI / Interaction Notes
N/A — apenas testes.

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | `asaas-webhook/index.test.ts` com testes: dedup, UUID validation, amount > 0, IP check. Mocks de supabase e fetch. | 3h | — |
| T2 | `asaas-withdraw/index.test.ts` com testes: balance check, fee calc 5%, rollback. Mocks de supabase e Asaas API. | 3h | — |
| T3 | `asaas-checkout/index.test.ts` com testes: job ownership, application status. Mocks de supabase. | 2h | — |

**Total estimate:** 8h

**Deployment note:** Sem deploy adicional. Testes rodam com `deno test` no diretório de cada função.

---

## Out of Scope (v1)

- Não inclui: Testes para `send-notification` (será coberto após FEAT-002)
- Não inclui: Testes para `delete-account`
- Não inclui: Testes de integração com Asaas real
- Não inclui: CI pipeline para testes Deno
