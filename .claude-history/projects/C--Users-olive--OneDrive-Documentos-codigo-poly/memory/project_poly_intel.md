---
name: Poly-Intel Project (PRD v4)
description: Trading system for Polymarket. 3 features + Wallet Finder/Backtester (internal GodEye replacement). Pure on-chain, no LLM.
type: project
originSessionId: d633400a-7231-497a-bcf8-1120cb787b1f
---
Poly-Intel: smart trading system for Polymarket. Three independent features + Phase 0 tooling.

**Feature 1: Smart Copy** (validated: $500→$1127 case)
- Bucket 1 (60% = $240): auto-copy 3 wallets selected via internal Backtester
- Bucket 2 (40% = $160): operator GO/SKIP when 3+ qualified wallets converge

**Feature 2: Insider Scanner** (validated: Harvard Law 2024 study)
- 6-criteria scoring on geopolitics niche markets
- HIGH (≥6) / MEDIUM (4-5) / LOW (≤3)
- Budget: 20% active + 20% reserve

**Feature 3: News Arbitrage** — NOT in MVP, needs research

**Phase 0 tooling: Wallet Finder & Backtester** (replaces GodEye/PolySmartWallet/Squawkr/PolyCopSim)
- Fetches COMPLETE wallet history via Polymarket Data API `/trades?user=ADDR&offset=N` (paginated, up to 10K trades)
- Finder: filters leaderboard wallets by win rate, G/L, avg trade, freq, hedging, markets
- Backtester: simulates copy with 120s delay, computes ROI w/ vs w/o delay = edge retention
- Internal 100-pt Copyability Score (replaces closed GodEye): edge retention 25pts + win rate band 15pts + G/L 15pts + trade size 10pts + frequency 10pts + hedging 5pts + market diversity 10pts + ROI positive 10pts, minus red flags (fast-markets-only, winrate>90%, no-drawdowns)
- Classification: APROVADA (ROI>0 + 50+ resolved + retention>50%) / PROMISSORA / REJEITADA

**Stack:** Next.js + Vercel + Supabase (Postgres + Edge Functions + pg_cron). Free tier.

**DB tables (7):** wallets (+ copyability_score, backtest_id), snapshots, signals, insider_alerts, trades, wallet_analysis, backtest_results

**Edge functions (6):** watchtower, insider-scanner, paper-trade (executor), resolve-trades, wallet-finder, wallet-backtester

**Business rules:** R-01..R-16 all enforced

**Frontend routes (8):** Home | Smart Copy | Insider | Wallets | Positions | Performance | Decisions | Settings

**Production:** https://poly-intel-six.vercel.app · Supabase: iwfaocdhipivofbfmdhe
