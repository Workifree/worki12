# QA Report: FEAT-002-T3

**Date:** 2026-03-15
**Feature:** Modificar CompanyJobDetails para exibir contador de workers em andamento
**PR:** #72
**Tester:** qa-tester agent

---

## Build Results

| Check | Result | Details |
|-------|--------|---------|
| `npm run build` | PASS | Built in 14.39s, 0 errors |
| `npm run test` | PASS | 31/31 passing (3 test files) |
| `npm run lint` | PASS | 0 errors |

---

## Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| AC-1 | activeWorkersCount state | PASS | `CompanyJobDetails.tsx:38` — `useState(0)` |
| AC-2 | Contador "Em andamento" no painel Performance | PASS | Lines 241-245: "Em andamento" with `activeWorkersCount` value |
| AC-3 | Click navega para candidatos | PASS | Line 242: `navigate(/company/jobs/${id}/candidates)` when count > 0 |
| AC-4 | Nao clicavel quando count === 0 | PASS | Line 241-242: conditional `cursor-pointer hover:bg-white` and onClick only fires when `activeWorkersCount > 0` |

---

## Regression

31 tests passing, 0 failing.

---

## VERDICT: SHIP

Todos os criterios validados. Build/lint/tests passando.
