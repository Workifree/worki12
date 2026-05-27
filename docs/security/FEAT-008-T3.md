# Security Audit: FEAT-008-T3

**Date:** 2026-03-16
**Feature:** Modificar CompanyProfile.tsx com secao Zona de Perigo (mesmo padrao de T2)
**PR:** #102
**Auditor:** security-auditor agent
**Threat Model:** This PR adds account deletion UI to `CompanyProfile.tsx`. The deletion flow calls the `delete-account` edge function (audited separately in FEAT-008-T1). Attack surface is the frontend invocation: could a user bypass the confirmation modal? Could the function be called with tampered parameters? The edge function handles all server-side validation — this PR is purely frontend UI.

---

## OWASP Results

| Check | Status | Details |
|-------|--------|---------|
| A01 Access Control | PASS | `CompanyProfile.tsx` is inside `ProtectedRoute` (verified `App.tsx:157` — `/company/profile`). The `getProfile()` function at line 67 calls `supabase.auth.getUser()` and queries companies with `.eq('id', user.id)` — company can only see their own profile. The `handleDeleteAccount` at line 190 calls `supabase.functions.invoke('delete-account', { body: {} })` — the edge function extracts userId from JWT, not from body. Empty body `{}` is correct — no user-controlled parameters sent. After successful deletion: `supabase.auth.signOut()` then `navigate('/login')`. |
| A02 Cryptographic Failures | PASS | No secrets in diff. No new environment variables referenced. `logError` imported from `../../lib/logger` — does not expose keys. |
| A03 Injection | PASS | No new queries added beyond the existing profile fetch. `handleDeleteAccount` sends empty body `{}`. The `deleteConfirmText` state is only compared with `=== 'EXCLUIR'` (line 571) — never used in queries or rendered unsafely. No `dangerouslySetInnerHTML`. |
| A04 Insecure Design | PASS | Confirmation modal requires typing "EXCLUIR" — the button is `disabled={deleteConfirmText !== 'EXCLUIR' || deleting}` (line 571). This prevents accidental deletion. However, this is a UX guard only — the real protection is the edge function's JWT validation and escrow check. The `deleting` state prevents double-click. The UI correctly displays consequences: anonymized data, cancelled jobs/applications, and blocked by pending payments. |
| A05 Misconfiguration | PASS | No edge functions created or modified in this PR (the edge function is in PR #100). No CORS changes. |
| A07 Authentication | PASS | Inside `ProtectedRoute`. `supabase.auth.getUser()` called in `getProfile()` at mount. `supabase.functions.invoke()` automatically sends the user's JWT via the Supabase client. After deletion, `supabase.auth.signOut()` clears the session. |
| A09 Logging | PASS | `logError('Erro ao excluir conta da empresa', error)` at line 192 — uses structured logger, context string only. No passwords/tokens logged. Error toast shows `error.message` (from edge function response) — this is user-facing error text, not sensitive data. |

---

## Dependency Audit

`npm audit`: 0 critical, 4 high (pre-existing rollup/undici, not introduced by this PR), 1 moderate

---

## Secrets Scan

No secrets found in changed files. No new imports of API keys or service role keys. Verified: `frontend/src/lib/supabase.ts` uses only `VITE_SUPABASE_ANON_KEY`.

---

## Migration Risk Assessment

No SQL migrations in this PR. N/A.

---

## Findings

Nenhuma vulnerabilidade encontrada.

---

## VERDICT: SHIP

Nenhuma vulnerabilidade critica ou alta encontrada. Feature aprovada para producao.
