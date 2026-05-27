# QA Report: FEAT-008-T3

**Date:** 2026-03-15
**Feature:** Modificar CompanyProfile.tsx com secao Zona de Perigo (mesmo padrao de T2)
**PR:** #102
**Tester:** qa-tester agent

---

## Build Results

| Check | Result | Details |
|-------|--------|---------|
| `npm run build` | PASS | Built in 18.60s, 0 errors |
| `npm run test` | PASS | 31/31 passing (3 test files) |
| `npm run lint` | PASS | 0 errors |

---

## Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| AC-2 | Botao "Excluir minha empresa" em /company/profile | FAIL | `CompanyProfile.tsx` — grep for "Zona de Perigo", "deleteModal", "Excluir minha empresa", "handleDeleteAccount", "EXCLUIR" returned 0 matches. The feature was NOT implemented. |
| AC-5 | Exclusao bem-sucedida — empresa (UI) | FAIL | No `handleDeleteAccount` function found in CompanyProfile.tsx |
| AC-6 | Toast de erro quando Edge Function retorna 400 | FAIL | No error handling for delete-account in CompanyProfile.tsx |

---

## Root Cause

The PR branch `feature/FEAT-008-T3-company-profile-delete-account` does NOT modify `CompanyProfile.tsx`. The changed files are `JobLifecycleStepper.tsx` and `CompanyJobCandidates.tsx` — which are unrelated to this issue. The "Zona de Perigo" section with delete account functionality was never implemented in CompanyProfile.tsx.

---

## VERDICT: BLOCK

0 criterios validados de 3. Nao pode prosseguir.

**Bloqueadores:**
| # | Tipo | Problema | Arquivo | Correcao |
|---|------|----------|---------|----------|
| 1 | AC-2 | Secao "Zona de Perigo" nao existe em CompanyProfile.tsx | CompanyProfile.tsx | Adicionar secao identicaa de Profile.tsx com texto "Excluir minha empresa" |
| 2 | AC-5 | handleDeleteAccount nao implementado | CompanyProfile.tsx | Copiar handler de Profile.tsx |
| 3 | AC-6 | Toast de erro nao implementado | CompanyProfile.tsx | Copiar pattern de Profile.tsx |
