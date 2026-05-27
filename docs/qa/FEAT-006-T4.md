# QA Report: FEAT-006-T4

**Date:** 2026-03-15
**Feature:** Testes unitarios para Worker Rating — perfil publico e review duplicado
**PR:** #95
**Tester:** qa-tester agent

---

## Build Results

| Check | Result | Details |
|-------|--------|---------|
| `npm run build` | PASS | Built in 11.85s, 0 errors |
| `npm run test` | FAIL | 35/39 passing, 4 failing in CompanyJobCandidates.test.tsx |
| `npm run lint` | PASS | 0 errors |

---

## Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| AC-1 | 4 testes existem e passam | FAIL | `CompanyJobCandidates.test.tsx` has 5 tests total (4 for FEAT-001-T2 "Confirmar Entrega" + 1 for duplicate review 23505). 4 tests FAIL because the "Confirmar Entrega" button does not exist in this branch (FEAT-001-T2 code not merged). Only the 23505 duplicate review test passes. |
| AC-2 | npm run test -- --run passa com 0 falhas | FAIL | 4 failures in CompanyJobCandidates.test.tsx. Error: `getByText('Confirmar Entrega')` at line 216 — element not found because FEAT-001-T2 is a separate unmerged branch. |
| AC-3 | npm run lint passa | PASS | 0 errors |

---

## Test Failure Details

### Failing Tests (all in CompanyJobCandidates.test.tsx)
1. **"modal de confirmacao abre ao clicar botao Confirmar Entrega"** — Line 149: `getByText('Confirmar Entrega')` — button does not exist on this branch
2. **"modal fecha ao clicar Cancelar sem chamar releaseEscrow"** — Line 163: same button not found
3. **"toast de sucesso aparece apos releaseEscrow retornar sucesso"** — Line 186: same button not found
4. **"toast de erro aparece quando releaseEscrow retorna success=false"** — Line 216: same button not found

### Root Cause
The test file includes tests for the FEAT-001-T2 "Confirmar Entrega" modal, but FEAT-001-T2 is implemented on a separate branch (`feature/FEAT-001-T2-escrow-release-separate`) that has not been merged into this branch. The tests reference UI elements that do not exist in the CompanyJobCandidates component on this branch.

### Missing Tests per Spec
The issue spec calls for these 4 tests:
1. `renderiza "(7 avaliacoes)" quando reviews_count=7` — NOT FOUND in test file
2. `renderiza "---" quando rating_average=0` — NOT FOUND in test file
3. `cada review exibe data formatada em portugues` — NOT FOUND in test file
4. `handleSubmitReview chama addToast com mensagem de duplicado quando code=23505` — FOUND and PASSING

Only 1 of 4 required tests is present. The other 3 (for WorkerPublicProfile) are missing entirely.

---

## VERDICT: BLOCK

4 criterios falhando. Nao pode prosseguir.

**Bloqueadores:**
| # | Tipo | Problema | Arquivo | Correcao |
|---|------|----------|---------|----------|
| 1 | Test failures | 4 tests fail because they test FEAT-001-T2 features not present on this branch | CompanyJobCandidates.test.tsx:149,163,186,216 | Remove FEAT-001-T2 tests from this PR or rebase onto FEAT-001-T2 branch |
| 2 | Missing tests | 3 of 4 spec-required tests missing (WorkerPublicProfile reviews_count, rating empty state, date format) | WorkerPublicProfile.test.tsx | Create the 3 missing tests per spec |
