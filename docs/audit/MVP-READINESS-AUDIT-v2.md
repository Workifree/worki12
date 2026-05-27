# MVP Readiness Audit v2 -- Worki

**Date:** 2026-03-17
**Auditor:** MVP Readiness Auditor Agent (opus)
**Commit:** 72b09df
**Branch:** main
**Previous Audit:** 2026-03-16 (v1 -- 15 findings, all fixed)

---

## Executive Summary

**Overall Readiness:** Launch with Caveats

Worki has made remarkable progress since the v1 audit. All 15 original findings were addressed: Message RLS policies are in place, send-notification has auth, legacy edge functions were removed, console.error instances replaced with logError, ProtectedRoute has role isolation, security headers deployed, and 27 test files with 189 passing tests exist. The codebase is well-structured with atomic RPCs for financial operations, rate limiting on sensitive endpoints, and proper error monitoring via Sentry.

This v2 audit focuses on **new gaps not covered by the first audit**. The findings are fewer and mostly P1/P2, reflecting a maturing codebase. The most critical new finding is the delete-account function allowing workers with positive wallet balances to delete their accounts, causing irrecoverable fund loss.

**By the numbers:**
- P0 (Blockers): 1 issue
- P1 (Critical): 3 issues
- P2 (Important): 4 issues
- P3 (Nice-to-have): 2 issues
- Total effort estimate: 24h

---

## Feature Map

### Worker Journey
| Step | Screen | Route | Status | Notes |
|------|--------|-------|--------|-------|
| 1 | Landing Page | / | OK | SEO-optimized, hero, features, CTAs |
| 2 | Sign Up | /login?type=work | OK | Password strength meter, email verification message |
| 3 | Onboarding | /worker/onboarding | OK | Multi-step, sets onboarding_completed |
| 4 | Dashboard | /dashboard | OK | React Query, stats, recommendations |
| 5 | Browse Jobs | /jobs | OK | Filters, search, categories |
| 6 | My Jobs | /my-jobs | OK | Tabs, check-in/out, cancel |
| 7 | Wallet | /wallet | OK | Balance, withdraw PIX, 5% fee, sync |
| 8 | Profile | /profile | OK | Edit, password change, delete account |
| 9 | Messages | /messages | OK | Real-time, typing indicator, RLS |
| 10 | Notifications | /notifications | OK | Filters, pagination, mark read |
| 11 | Password Reset | /esqueci-senha + /redefinir-senha | OK | Full flow |

### Company Journey
| Step | Screen | Route | Status | Notes |
|------|--------|-------|--------|-------|
| 1 | Sign Up | /login?type=hire | OK | Password strength, email verification |
| 2 | Onboarding | /company/onboarding | OK | Multi-step with TOS |
| 3 | Dashboard | /company/dashboard | OK | React Query, stats |
| 4 | Create Job | /company/create | OK | 3-step wizard, balance check, escrow |
| 5 | Manage Jobs | /company/jobs | OK | List, status filters |
| 6 | Job Details | /company/jobs/:id | OK | Full detail view |
| 7 | Candidates | /company/jobs/:id/candidates | OK | Hire, check-in/out confirm, delivery, review |
| 8 | Wallet | /company/wallet | OK | Balance, deposit via PIX, escrow view |
| 9 | Messages | /company/messages | OK | Same engine as worker |
| 10 | Profile | /company/profile | OK | Edit, password, delete account |
| 11 | Analytics | /company/analytics | OK | Charts, stats |
| 12 | Worker Profile | /company/worker/:id | OK | Public view of worker |

### Admin
| Screen | Route | Status | Notes |
|--------|-------|--------|-------|
| Admin Panel | /admin | OK | Dashboard, Users, Escrows tabs; email-based auth check |

---

## Audit Results

### 1. Core Features 9/10

The app covers every step of both worker and company journeys. Job creation, application, hiring, check-in/out, delivery confirmation, escrow release, and reviews are all functional. The wallet flow for both roles is complete with PIX deposit and withdrawal.

**What's excellent:**
- Complete job lifecycle with 4-step stepper (Hired -> Arrival -> Departure -> Delivery)
- Escrow per-candidate status badges
- Background Asaas balance sync on wallet load
- CPF/CNPJ validation with checksum on deposits and withdrawals

**Minor gap:**
- `CompanyJobDetails.tsx` lists without empty state handling -- if a job has no applications, the candidates section may render without a helpful message (file lacks explicit empty state check per the scan).

### 2. Auth & Authorization 9/10

Auth is solid: sign up, login, logout, password reset, onboarding gates, TOS gate, role isolation in ProtectedRoute, and email verification messaging all work. Session persistence via onAuthStateChange is properly implemented.

**What's excellent:**
- Role isolation prevents workers from accessing `/company/*` and vice versa
- TOS gate modal blocks access until acceptance (skips during onboarding)
- Admin uses email allowlist on both frontend and backend

**Gap found:**
- Admin page (`/admin`) is a public route (not inside `<ProtectedRoute>`) -- the component handles its own auth via email check, which is correct, but it means the admin login form is **exposed to all users**. Not a security vulnerability (the backend validates), but exposes attack surface for brute-force attempts against admin accounts. The in-memory rate limiter does not cover admin login attempts since login goes directly to Supabase Auth, not through a rate-limited edge function.

### 3. Data & Database 9/10

All tables have RLS enabled. Financial operations use atomic RPCs (reserve_escrow, release_escrow, refund_escrow, credit_deposit, update_wallet_balance). Unique constraints prevent double-processing. Non-negative balance CHECK constraint on wallets.

**What's excellent:**
- Atomic escrow operations with proper locking (`FOR UPDATE`)
- Dedup on wallet_transactions via `(wallet_id, reference_id)` unique index
- One-active-escrow-per-job via partial unique index
- Message and Conversation RLS policies properly scoped to participants

**Gap found:**
- The `admin_credit` action in `admin-data/index.ts:241-251` does not validate that `amount` is a positive number. A negative amount passed to `credit_deposit` RPC would subtract from the user's balance. This is admin-only but could cause accidental data corruption.

### 4. Error Handling 8/10

Error handling is significantly improved from v1. Only 1 instance of `console.error` remains in production code (ErrorBoundary -- acceptable). Every page has toast feedback on actions. Try-catch coverage is good across async operations.

**What's excellent:**
- ErrorBoundary wraps the entire app with user-friendly error UI and Sentry reporting
- Centralized `logError`/`logWarn` with Sentry integration in production
- `invokeFunction` helper standardizes edge function error handling with Sentry capture
- 404 catch-all route exists

**Gaps found:**
- 5 test files fail (5 tests out of 194) -- 4 in ProtectedRoute tests, 1 in CompanyJobCandidates. These are test sync issues (tests reference outdated UI text like "Finalizar Job"), not production bugs. But failing tests in CI will block PRs.
- 5 lint errors in E2E test files (unused variables in `flow50-52-55.spec.ts` and `full-app-test.spec.ts`). These will cause CI lint step to fail.

### 5. Security 8/10

Security posture is strong for an MVP. No secrets in frontend code. All edge functions have CORS handling and JWT validation (except asaas-webhook and admin-data which have their own auth). Webhook validates auth token and IP (blocks in production). Rate limiting on deposit/withdraw/checkout.

**What's excellent:**
- Asaas webhook validates `asaas-access-token` header and IP range
- Rate limiting on financial endpoints (5 req/min deposit, 3 req/min withdraw, 5 req/min checkout)
- CPF/CNPJ checksum validation prevents invalid documents
- Email HTML escaping in templates prevents XSS
- `sourcemap: 'hidden'` in Vite config prevents source map exposure
- Security headers deployed: X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy

**Gaps found:**
- `delete-account/index.ts`: Workers with positive wallet balance can delete their accounts. The function checks for **company** active escrows (lines 48-74) but **never checks worker balance**. A worker with R$500 in their wallet can delete their account, losing the money permanently. The Asaas master wallet retains the funds with no way to reconcile. This is a **P0 financial risk**.
- `admin-data/index.ts:240-251`: The `admin_credit` action accepts any amount without validating it's positive. Negative amounts would debit user wallets through the `credit_deposit` RPC.
- NPM audit shows 5 vulnerabilities (4 high, 1 moderate) in `undici` -- fixable via `npm audit fix`.

### 6. Infrastructure 8/10

Build succeeds with 0 errors. CI/CD via GitHub Actions (lint + build + test on PRs, Netlify deploy on push to main). Sentry configured for error monitoring. Environment variables documented in `.env.example`. Bundle size is reasonable (137KB gzipped main chunk).

**What's excellent:**
- GitHub Actions CI with lint, TypeScript check, build, and tests
- Netlify staging deploy on push to main
- Lazy loading for all pages (code splitting)
- Sentry DSN configured via env var

**Gap:**
- No `supabase/config.toml` file in the repo. While migrations exist, the Supabase project configuration (auth settings, storage, realtime settings) is not version-controlled. This makes environment recreation difficult.

### 7. User Experience 8/10

Neo-brutalist design is consistent across all pages. Responsive design with mobile breakpoints. Brazilian locale formatting for dates and currency. Onboarding flows for both roles. Legal pages (Terms, Privacy) exist.

**What's excellent:**
- Consistent neo-brutalist design language throughout
- Mobile-responsive with bottom navigation
- Brazilian Portuguese UI with pt-BR date/currency formatting
- Confirmation dialogs on destructive actions (delivery, delete account)
- Password strength indicator on sign-up
- Help page with FAQ

**Gap:**
- No CSP (Content-Security-Policy) header in `_headers` file. While X-Frame-Options and other headers are set, CSP is the most effective XSS mitigation and is missing.

### 8. Testing 7/10

Test coverage has improved dramatically: 27 test files with 189 passing tests. Critical paths (wallet, escrow, auth, job candidates) have dedicated tests. Vitest configured with jsdom. E2E tests exist via Playwright.

**What's excellent:**
- walletService.test.ts covers financial operations
- Wallet.test.tsx, CompanyWallet.test.tsx, MyJobs.test.tsx cover critical UI flows
- asaas-webhook, asaas-withdraw, asaas-checkout have dedicated test files
- ProtectedRoute tests cover auth, onboarding, TOS, and role isolation
- ErrorBoundary, JobCard, NotificationBell, DepositModal all have tests

**Gap:**
- 5 tests currently failing (4 ProtectedRoute + 1 CompanyJobCandidates) -- test assertions reference old UI text ("Finalizar Job") that was changed during development. Tests need updating to match current UI.
- 5 lint errors in E2E spec files block CI pipeline.

---

## Critical Path to Launch

### Phase 1: Blockers (P0) -- 4h
1. **[AUDIT-v2-01]** Block account deletion when worker has positive wallet balance -- prevent irrecoverable fund loss

### Phase 2: Critical (P1) -- 8h
2. **[AUDIT-v2-02]** Fix 5 failing tests (ProtectedRoute + CompanyJobCandidates) -- unblock CI pipeline
3. **[AUDIT-v2-03]** Fix 5 lint errors in E2E spec files -- unblock CI pipeline
4. **[AUDIT-v2-04]** Validate admin_credit amount is positive in admin-data edge function

### Phase 3: Quality (P2) -- 8h
5. **[AUDIT-v2-05]** Add Content-Security-Policy header to `_headers` file
6. **[AUDIT-v2-06]** Run `npm audit fix` to resolve undici vulnerabilities
7. **[AUDIT-v2-07]** Add `supabase/config.toml` for version-controlled project configuration
8. **[AUDIT-v2-08]** Add rate limiting to admin login (currently Supabase Auth has no per-endpoint rate limiting for `/admin`)

### Phase 4: Polish (P3) -- 4h
9. **[AUDIT-v2-09]** Add empty state for job details candidates section in CompanyJobDetails
10. **[AUDIT-v2-10]** Move `/admin` route inside ProtectedRoute or add dedicated AdminRoute component to hide login form from non-admin users

---

## What's Working Well

1. **Atomic financial operations** -- All escrow/wallet operations use PostgreSQL RPCs with proper locking, dedup, and rollback. This is production-grade.
2. **Comprehensive auth flow** -- Sign up, login, password reset, email verification, onboarding gates, TOS gates, and role isolation all work end-to-end.
3. **Error monitoring** -- Sentry integration with centralized `logError`/`logWarn` means production errors will be caught and reported.
4. **Rate limiting** -- Financial endpoints (deposit, withdraw, checkout) have in-memory rate limiting to prevent abuse.
5. **Security headers** -- HSTS, X-Frame-Options, X-Content-Type-Options, and Referrer-Policy are all deployed.
6. **RLS on all tables** -- Every table has row-level security with appropriate policies for each operation.
7. **Test coverage growth** -- From 18 tests in v1 to 189 tests in v2, covering critical paths.
8. **CI/CD pipeline** -- Automated lint, build, test on PRs with staging deploy on merge.
9. **Webhook security** -- Asaas webhook validates auth token AND IP range (enforced in production).
10. **Code splitting** -- All pages lazy-loaded with Suspense fallback for fast initial loads.

---

## Appendix: All Findings

| # | Priority | Category | Title | Effort | Issue |
|---|----------|----------|-------|--------|-------|
| 1 | P0 | Security | Worker delete-account sem verificacao de saldo positivo | 4h | #174 |
| 2 | P1 | Testing | 5 testes falhando bloqueiam CI pipeline | 2h | #175 |
| 3 | P1 | Testing | 5 erros de lint em arquivos E2E spec bloqueiam CI | 1h | #176 |
| 4 | P1 | Security | admin_credit aceita amount negativo sem validacao | 1h | #177 |
| 5 | P2 | Security | Falta Content-Security-Policy header | 2h | #178 |
| 6 | P2 | Security | Vulnerabilidades npm undici (4 high) | 1h | #179 |
| 7 | P2 | Infrastructure | Falta supabase/config.toml para config versionada | 2h | #180 |
| 8 | P2 | Security | Admin login sem rate limiting dedicado | 2h | #181 |
| 9 | P3 | UX | CompanyJobDetails sem empty state para candidatos | 1h | #182 |
| 10 | P3 | Auth | Rota /admin exposta como rota publica | 1h | #183 |
