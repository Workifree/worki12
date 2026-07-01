# Worki Project Memory

## Project
- ⚠️ [Pivô empresa-primeiro (jun/2026)](pivot-company-first-2026.md) — NÃO é mais marketplace: infra de operação de freelancer p/ empresa (convite push), pagamento postpago. Tese em `.harness/thesis.md`. Slice 1 = PR #195.
- Worki: React 19 + Vite + TS + Supabase + Asaas (era "marketplace de freelance" — ver pivô acima)
- **Asaas ONLY** - Stripe completely removed (user decision Mar 2026)
- Payment model: single central Asaas wallet, NO subaccounts
- Commits in Portuguese, NO Co-Authored-By lines
- Neo-brutalist design: green (#00A651) for workers, blue (#2563EB) for companies

## Payment Flow (Asaas Central Wallet)
- Company deposits via PIX → master wallet holds funds
- Escrow reserve locks company balance in DB (atomic RPC)
- Escrow release credits worker balance in DB (atomic RPC)
- Worker withdraws via PIX transfer from master account
- Platform fee: 5% on withdrawals (company fee TBD, likely 10% at escrow reserve)
- Atomic RPCs: reserve_escrow, release_escrow, refund_escrow, credit_deposit, update_wallet_balance

## Critical Deploy Notes
- **asaas-webhook MUST deploy with --no-verify-jwt** (Asaas sends no Supabase JWT)
- **admin-data MUST deploy with --no-verify-jwt** (has own auth check)
- All other functions deploy normally (gateway checks JWT)
- RPCs REQUIRE `GRANT EXECUTE ON FUNCTION ... TO service_role, authenticated`
- Without GRANTs, supabase-js .rpc() fails (uses PostgREST which needs schema cache)
- wallet_transactions unique constraint must be (wallet_id, reference_id) NOT reference_id alone
- Supabase project ref: vrklakcbkcsonarmhqhp

## Ralph (Autonomous Dev Loop)
- Installed globally at `~/.local/bin/ralph` and `~/.ralph/`
- Project config: `.ralphrc`, `.ralph/PROMPT.md`, `.ralph/fix_plan.md`, `.ralph/AGENT.md`
- Run with: `ralph` or `ralph --live` from project root
- jq installed manually at `~/.local/bin/jq.exe`
- tmux NOT available (Windows) - use `ralph --live` instead of `ralph --monitor`
- Permissions: `.claude/settings.local.json` has `Bash(*)` for autonomous execution

## Key Paths
- Frontend: `frontend/src/`
- Edge Functions: `supabase/functions/`
- Migrations: `supabase/migrations/`
- CLAUDE.md at project root for auto-context
- [Vercel Deploy Setup](vercel-deploy-setup.md) — frontend prod deploy: `npx vercel --prod --cwd frontend` (project "worki" = worki-opal.vercel.app; root links to stray "worki12")

## Current MVP Sprint (Mar 2026)
- Phase 1: Remove all Stripe (functions, packages, DB columns, docs)
- Phase 2: Audit Asaas payment flows
- Phase 3: MVP features (notifications, deploy config, TOS, SEO)
- Phase 4: Quality (tests, lint cleanup)
- Phase 5: Documentation

## Agentic Management System (Mar 2026)
- [Agentic Infrastructure](agentic_infrastructure.md) — 3-tier system: strategic roundtable + tactical architect + dynamic operational agents

## Known Issues
- `backend_legacy/` and `frontend-angular-backup/` are deprecated
- 10 react-hooks/exhaustive-deps warnings remaining
- Test coverage minimal (18 tests, 3 files)
