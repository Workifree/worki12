# Security Audit: FEAT-008-T1

**Date:** 2026-03-16
**Feature:** Criar Edge Function delete-account com anonimizacao e delecao de auth user (LGPD)
**PR:** #100
**Auditor:** security-auditor agent
**Threat Model:** This is a HIGH-VALUE target. The `delete-account` edge function permanently destroys user data: it anonymizes worker/company records, cancels applications, marks jobs as deleted, deletes messages, and removes the auth.users record. Attack vectors: (1) An attacker calling the function without valid JWT to delete arbitrary accounts; (2) An attacker manipulating the request body to target another user's account; (3) A company bypassing escrow checks to delete their account while holding escrowed funds; (4) Race conditions between deletion steps.

---

## OWASP Results

| Check | Status | Details |
|-------|--------|---------|
| A01 Access Control | PASS | `delete-account/index.ts:19-20` — checks for `Authorization` header, returns 401 if missing. Line 24-28 — validates JWT via `supabaseAdmin.auth.getUser(token)`, returns 401 if invalid. Line 30 — `userId = user.id` extracted from the validated JWT, NOT from request body. This is critical and correctly implemented: the function can ONLY delete the account of the authenticated user. No IDOR possible — there is no way to pass another user's ID. Escrow check at lines 37-62: for companies, queries `escrow_transactions` with `status = 'reserved'` for the company's jobs, returns 400 if active escrow exists. Worker applications cancelled at line 65-68 scoped by `worker_id = userId`. Company applications cancelled at lines 70-82 scoped by `job_id IN (company's jobs)`. Anonymization at lines 85-108 scoped by `.eq('id', userId)`. Message deletion at line 111 scoped by `.eq('senderid', userId)`. Auth deletion at line 114 uses `admin.deleteUser(userId)` — same JWT-derived userId. |
| A02 Cryptographic Failures | PASS | `SUPABASE_SERVICE_ROLE_KEY` used at line 12 via `Deno.env.get()` — server-side only, correct. Not exposed in any frontend file. No hardcoded secrets in diff. |
| A03 Injection | PASS | All queries use Supabase parameterized client (`.eq()`, `.in()`, `.update()`, `.delete()`). No raw SQL. No string interpolation in queries. No `eval()`, `exec()`, or `new Function()`. |
| A04 Insecure Design | PASS | Escrow check correctly blocks company deletion when reserved escrow exists (lines 37-62). Anonymization pattern is correct for LGPD: PII fields (full_name, phone, cpf, bio, pix_key, avatar_url, city for workers; name, cnpj, address, email, website for companies) are set to null or placeholder text. `wallet_transactions` are NOT deleted — financial records preserved for audit trail. The function does NOT accept any user-controlled parameters beyond the JWT — no amount, no target ID, no action type. The only action is "delete my own account." |
| A05 Misconfiguration | PASS | CORS OPTIONS handler at line 5-7 returns `corsHeaders` from shared `_shared/asaas.ts`. Verified: `corsHeaders` uses `CORS_ORIGIN` env var in production (not wildcard). JWT validation present. The function SHOULD be deployed WITHOUT `--no-verify-jwt` (the issue spec confirms this at the bottom: "SEM --no-verify-jwt"). |
| A07 Authentication | PASS | JWT extracted from Authorization header at line 19. Validated via `supabaseAdmin.auth.getUser(token)` at line 24. Returns 401 for missing header AND invalid token. No custom session storage. |
| A09 Logging | WARNING | `console.error('Erro ao deletar auth user:', deleteError)` at line 116 — logs the deleteError object which may contain user metadata. `console.error('delete-account error:', error)` at line 124 — logs the full error. While these are server-side logs (not exposed to client), the error objects could contain sensitive data (user IDs, email). Recommendation: use structured logging with sanitized fields. **Severity: LOW** — server-side only, does not expose data to clients. |

---

## Dependency Audit

`npm audit`: 0 critical, 4 high (pre-existing rollup/undici, not introduced by this PR), 1 moderate

---

## Secrets Scan

No secrets found in changed files. `SUPABASE_SERVICE_ROLE_KEY` accessed via `Deno.env.get()` at line 12 — server-side environment variable, correct pattern. No hardcoded keys. Verified: `frontend/src/lib/supabase.ts` uses only `VITE_SUPABASE_ANON_KEY`.

---

## Findings

| # | Severity | Category | Description | File:Line | Attack Scenario | Remediation |
|---|----------|----------|-------------|-----------|-----------------|-------------|
| 1 | WARNING | A09 | Server-side console.error logs may include sensitive data from error objects | supabase/functions/delete-account/index.ts:116,124 | No direct attack — but if logs are aggregated to a logging service, user metadata could leak | Sanitize error logs: `console.error('delete-account error:', { message: error.message })` instead of logging full error object |

---

## VERDICT: SHIP

Nenhuma vulnerabilidade critica ou alta encontrada. Feature aprovada para producao.

**Deploy Note:** This function MUST be deployed with JWT verification enabled (standard deploy, NOT `--no-verify-jwt`):
```
supabase functions deploy delete-account
```

**Security strengths of this implementation:**
1. userId derived exclusively from JWT — no IDOR possible
2. Escrow check blocks company deletion with active reserved funds
3. Anonymization preserves financial records (wallet_transactions untouched)
4. No user-controlled parameters accepted — only "delete my own account"
5. CORS properly configured via shared headers
