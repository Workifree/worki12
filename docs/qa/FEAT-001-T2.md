# QA Report: FEAT-001-T2

**Date:** 2026-03-15
**Feature:** Modificar CompanyJobCandidates para separar escrow release de avaliacao
**PR:** #75
**Tester:** qa-tester agent

---

## Build Results

| Check | Result | Details |
|-------|--------|---------|
| `npm run build` | PASS | Built in 12.14s, 0 errors |
| `npm run test` | PASS | 31/31 passing (3 test files) |
| `npm run lint` | PASS | 0 errors |

---

## Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| AC-1 | Liberacao de escrow sem avaliacao | PASS | `CompanyJobCandidates.tsx:126-146` — `handleConfirmDelivery` calls `WalletService.releaseEscrow()` directly without requiring review. Line 128: `WalletService.releaseEscrow(app.job_id, app.id, app.worker_id)`. No review dependency. |
| AC-2 | Botao de avaliacao separado | PASS | `CompanyJobCandidates.tsx:435-441` — "Avaliar" button only renders when `app.status === 'completed'`. Lines 422-430: "Confirmar Entrega" button renders for `hired`/`in_progress` with check-in/checkout confirmed. Mutually exclusive conditions. |
| AC-3 | Badge de status do escrow para a empresa | PASS | `CompanyJobCandidates.tsx:326` — `<EscrowStatusBadge escrowStatus={escrowStatusMap[app.id] ?? null} />` rendered per-candidate. `escrowStatusMap` is `Record<string, 'reserved' \| 'released'>` at line 52. Fetched per-application from `escrow_transactions` at lines 89-99. |
| AC-5 | Idempotencia — botao nao aparece para completed | PASS | `CompanyJobCandidates.tsx:386` — "Confirmar Entrega" button only inside `(app.status === 'hired' \|\| app.status === 'in_progress')` block. Line 435: `app.status === 'completed'` shows only "Avaliar". No "Confirmar Entrega" for completed. |
| AC-7 | Saldo insuficiente exibido como toast de erro | PASS | `CompanyJobCandidates.tsx:372-374` — `companyBalance <= 0` triggers `addToast('Saldo insuficiente. Deposite fundos na sua carteira para contratar.', 'error')`. Line 129-130: `releaseEscrow` failure triggers `addToast('Erro ao liberar pagamento. Tente novamente.', 'error')`. |

---

## Financial Flow Results

| Check | Status | Evidence |
|-------|--------|----------|
| Balance integrity | PASS | `CompanyJobCandidates.tsx:102-103` — company balance fetched from DB via `WalletService.getOrCreateWallet(user.id, 'company')`. Line 53: `companyBalance` state stores fetched value. |
| Escrow state per-item | PASS | `CompanyJobCandidates.tsx:52` — `escrowStatusMap: Record<string, 'reserved' \| 'released'>` keyed by `application_id`. Lines 89-99: fetches from `escrow_transactions` per job, builds per-application map. NOT shared state. |
| Amount validation | PASS | Amount not passed from client. `walletService.ts:145-153` — `releaseEscrow` calls `asaas-checkout` edge function which determines amount server-side. |
| Authorization | PASS | `CompanyJobCandidates.tsx:63-64` — auth check on mount, redirects to `/login` if no user. Line 67: job fetched with `.eq('company_id', user.id)` ensuring ownership. Line 68: redirects to `/company/jobs` if not owner. |

---

## Edge Case Results

| Category | Test | Status | Evidence |
|----------|------|--------|----------|
| XSS | dangerouslySetInnerHTML | PASS | Not used anywhere in changed file |
| Auth | Unauthenticated access | PASS | `CompanyJobCandidates.tsx:63-64` — redirects to `/login` if no user |
| Empty State | No candidates | PASS | `CompanyJobCandidates.tsx:283-287` — "Nenhum candidato encontrado." in Portuguese |
| Double Submit | Confirm Delivery button disabled | PASS | `CompanyJobCandidates.tsx:494` — `disabled={releasing}`. Line 497: Shows `<Loader2 className="animate-spin" />` during processing |
| Double Submit | Review button disabled | PASS | `CompanyJobCandidates.tsx:558` — `disabled={submittingReview}` |
| Shared State | Escrow status | PASS | `Record<string, 'reserved' \| 'released'>` at line 52, not single useState |

---

## Regression

31 tests passing, 0 failing. No regression detected.

---

## VERDICT: SHIP

Todos os 5 criterios validados. Build/lint/tests passando. Fluxo financeiro validado com escrow per-item, auth check, e protecao contra double-submit. Pronto para auditoria de seguranca.
