# QA Report: FEAT-012-T1

**Date:** 2026-03-15
**Feature:** Modificar Jobs.tsx — migrar filtros para useSearchParams e adicionar filtros avancados
**PR:** #113
**Tester:** qa-tester agent

---

## Build Results

| Check | Result | Details |
|-------|--------|---------|
| `npm run build` | FAIL | 2 TypeScript errors in Jobs.tsx:89 and Jobs.tsx:105 — `PostgrestError` passed where `string` expected |
| `npm run test` | PASS | 35/35 passing |
| `npm run lint` | PASS | 0 errors |

---

## VERDICT: BLOCK

Build falha com erros TypeScript em Jobs.tsx (arquivo modificado por este PR).

**Bloqueadores:**
| # | Tipo | Problema | Arquivo | Correcao |
|---|------|----------|---------|----------|
| 1 | Build | `Jobs.tsx:89` — PostgrestError nao e assignavel a string | Jobs.tsx:89 | Usar `error.message` ou converter para string |
| 2 | Build | `Jobs.tsx:105` — mesmo erro | Jobs.tsx:105 | Mesmo fix |
