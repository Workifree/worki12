# Security Audit: FEAT-011-T1/T2

**Date:** 2026-03-16
**Feature:** Password Change Flow -- Security section in Profile.tsx (worker) and CompanyProfile.tsx (company)
**PR:** #110
**Issues:** #57 (T1), #58 (T2)
**Auditor:** security-auditor agent
**Threat Model:** This feature allows authenticated users (workers and companies) to change their password from their profile page. The data flow is: user enters new password in frontend -> `supabase.auth.updateUser({ password })` is called with the user's JWT session. No new tables, no new edge functions, no new RLS policies. The attack surface is limited to client-side validation bypass and credential-related concerns.

---

## OWASP Results

| Check | Status | Details |
|-------|--------|---------|
| A01 Access Control | PASS | Both `/profile` and `/company/profile` are wrapped in `ProtectedRoute` (App.tsx:130). `ProtectedRoute.tsx` checks session via `supabase.auth.getSession()` and redirects unauthenticated users (line 93). Profile.tsx additionally calls `supabase.auth.getUser()` at mount (line 104) and redirects to `/login` if null (line 105). Worker profile data is fetched with `.eq('id', user.id)` (Profile.tsx:110), preventing IDOR. CompanyProfile.tsx fetches with `.eq('id', user.id)` (line 74). `supabase.auth.updateUser()` operates only on the currently authenticated user's session -- no IDOR possible as the API does not accept a target user ID parameter. |
| A02 Cryptographic Failures | PASS | No hardcoded secrets found in any changed file. `frontend/src/lib/supabase.ts` uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (env vars, not hardcoded). No `service_role`, `sk_live`, `sk_test`, or Asaas keys found anywhere in `frontend/src/`. No `.env` files committed. |
| A03 Injection | PASS | No SQL injection risk -- `supabase.auth.updateUser()` is a Supabase Auth SDK call, not a raw SQL query. No `dangerouslySetInnerHTML` in any changed file. No `eval`, `exec`, `spawn`, or `new Function` in changed code. No RPC calls with user-interpolated strings. |
| A04 Insecure Design | PASS | Password change uses `supabase.auth.updateUser({ password })` which delegates all validation to Supabase Auth server-side (minimum length, complexity). Client-side validation (8 char minimum, confirmation match) at Profile.tsx lines 233-238 and CompanyProfile.tsx (diff lines +131-136) provides UX feedback but is NOT the security boundary -- Supabase Auth enforces its own rules server-side and returns errors for weak passwords. No financial operations, no escrow changes, no amount handling in this feature. No state machine bypass possible. |
| A05 Misconfiguration | PASS | No new edge functions introduced. No CORS configuration changes. No new deployment configuration. EscrowStatusBadge.tsx and JobLifecycleStepper.tsx are pure presentational components with no data access or security-relevant configuration. |
| A07 Authentication | PASS | Password change requires an active authenticated session (enforced by ProtectedRoute + supabase.auth.getUser() at component mount). No custom session storage -- Supabase Auth handles session management. No `localStorage.*token` or `sessionStorage.*token` patterns found. `supabase.auth.updateUser()` requires the current session JWT, which Supabase validates server-side. |
| A09 Logging | PASS | Failed password change errors are logged via `logError('Erro ao alterar senha', pwError)` (Profile.tsx diff line +244, CompanyProfile.tsx diff line +141). The `logError` function (logger.ts) sends to Sentry in production and console.error in dev only. The error object from Supabase Auth does NOT contain the password itself -- it contains error codes and messages. No password values are logged. |

---

## Dependency Audit

`npm audit`: 0 critical, 4 high, 1 moderate

High vulnerabilities are in:
- `rollup` (4.0.0-4.58.0): Arbitrary File Write via Path Traversal -- build-time only, not runtime
- `undici` (7.0.0-7.23.0): Multiple HTTP/WebSocket issues -- transitive dev dependency
- `minimatch`: ReDoS -- transitive dev dependency

**None of these are introduced by this PR.** All are pre-existing in the dependency tree and affect build-time/dev tooling only, not the runtime application.

---

## Secrets Scan

No secrets found in any changed file. Verified:
- `frontend/src/lib/supabase.ts` uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (environment variables, not hardcoded values)
- No `service_role` key anywhere in `frontend/src/`
- No `.env` files committed in recent history
- No hardcoded `password = "..."` patterns found

---

## Migration Risk Assessment

**NONE** -- No SQL migration files in this PR. No new tables, no column changes, no RLS policies modified.

---

## Findings

| # | Severity | Category | Description | File:Line | Attack Scenario | Remediation |
|---|----------|----------|-------------|-----------|-----------------|-------------|
| 1 | INFO | A04 | No rate limiting on password change | Profile.tsx (handleChangePassword), CompanyProfile.tsx (handleChangePassword) | An attacker with a valid session could rapidly call `supabase.auth.updateUser()` in a loop. However, Supabase Auth has its own built-in rate limiting on auth endpoints (GoTrue rate limits). | No action required -- Supabase Auth handles rate limiting server-side. |
| 2 | INFO | A07 | No current password verification before change | Both Profile.tsx and CompanyProfile.tsx | A user who leaves their session open on a shared computer could have their password changed without knowing the current one. | This is explicitly documented as out-of-scope in the spec ("Verificacao da senha atual antes de trocar -- fora do escopo"). Supabase Auth `updateUser` requires an active session, which provides implicit authentication. Acceptable for MVP. |

No CRITICAL, HIGH, or WARNING findings.

---

## VERDICT: SHIP

Nenhuma vulnerabilidade critica ou alta encontrada. Feature aprovada para producao.

**Summary:**
- Password change uses `supabase.auth.updateUser()` which delegates all security enforcement to Supabase Auth server-side
- Both pages are behind ProtectedRoute with session validation
- No new attack surface: no edge functions, no new tables, no RLS changes, no financial operations
- Pure presentational components (EscrowStatusBadge, JobLifecycleStepper) have zero security impact
- All INFO-level observations are either handled by Supabase Auth or explicitly out of scope per the feature spec
