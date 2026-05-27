# Security Audit: FEAT-013-T1

**Date:** 2026-03-16
**Feature:** Criar migration SQL para adicionar onboarding_completed em companies com backfill
**PR:** #111
**Auditor:** security-auditor agent
**Threat Model:** This migration adds a `BOOLEAN` column `onboarding_completed` to the `companies` table and backfills existing companies with complete data. The column controls the onboarding gate in `ProtectedRoute`. If an attacker could manipulate this column, they could bypass onboarding requirements. However, RLS on the `companies` table already limits writes to the row owner, and the column is used only in a read context by `ProtectedRoute`.

---

## OWASP Results

| Check | Status | Details |
|-------|--------|---------|
| A01 Access Control | PASS | The `onboarding_completed` column is read by `ProtectedRoute.tsx:38-50` via `supabase.from('companies').select('onboarding_completed').eq('id', authUser.id).single()`. The `.eq('id', authUser.id)` ensures users can only read their own onboarding status. RLS on `companies` table prevents cross-user reads/writes. The column is `BOOLEAN DEFAULT FALSE NOT NULL` — new companies default to incomplete onboarding (secure default). |
| A02 Cryptographic Failures | PASS | No secrets in migration. SQL file contains only DDL and DML statements. |
| A03 Injection | PASS | Migration uses standard SQL `ALTER TABLE` and `UPDATE` with fixed string comparisons — no dynamic input, no parameterized user data. `WHERE name IS NOT NULL AND name <> '' AND name <> '[Empresa Deletada]'` uses only literal strings. |
| A04 Insecure Design | PASS | Secure default: `DEFAULT FALSE` means all new companies must complete onboarding before accessing protected routes. Backfill logic is conservative: only companies with non-empty, non-deleted names are marked as completed. Companies named '[Empresa Deletada]' (anonymized via delete-account) are NOT marked as completed — correct, since these are deleted accounts. |
| A05 Misconfiguration | PASS | No edge functions. Migration is idempotent: `ADD COLUMN IF NOT EXISTS` prevents errors on re-run. |
| A07 Authentication | N/A | Migration is applied via `supabase db push` or `supabase migration up` — not exposed to end users. |
| A09 Logging | N/A | No logging in SQL migration. |

---

## Dependency Audit

`npm audit`: 0 critical, 4 high (pre-existing, not introduced by this PR), 1 moderate

---

## Secrets Scan

No secrets found. SQL file contains only DDL/DML statements and comments.

---

## Migration Risk Assessment

| Operation | Risk | Reason |
|-----------|------|--------|
| `ALTER TABLE companies ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE NOT NULL` | LOW | Idempotent. `DEFAULT FALSE` means existing rows get the default value automatically. `NOT NULL` with `DEFAULT` is safe — no rows will break. Reversible with `ALTER TABLE companies DROP COLUMN IF EXISTS onboarding_completed`. |
| `UPDATE companies SET onboarding_completed = TRUE WHERE name IS NOT NULL AND name <> '' AND name <> '[Empresa Deletada]'` | LOW-MEDIUM | Data mutation on existing rows. `WHERE` clause is precise — only companies with valid names. However, this is a one-way update (cannot easily identify which rows were updated vs. which were already TRUE). |

**Down migration:** Present in file comments at line 6:
```sql
-- DOWN (rollback):
-- ALTER TABLE companies DROP COLUMN IF EXISTS onboarding_completed;
```

**Overall migration risk: LOW** — Column addition with default is safe. Backfill UPDATE has a precise WHERE clause. Down migration documented in comments. `IF NOT EXISTS` ensures idempotency.

---

## Findings

Nenhuma vulnerabilidade encontrada.

---

## VERDICT: SHIP

Nenhuma vulnerabilidade critica ou alta encontrada. Feature aprovada para producao.

**Migration Notes:**
- Apply via `supabase db push` or `supabase migration up`
- Backup not required (LOW risk — additive column with default, no data loss possible)
- Rollback: `ALTER TABLE companies DROP COLUMN IF EXISTS onboarding_completed;`
