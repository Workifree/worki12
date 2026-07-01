---
name: Copyability Score (internal GodEye replacement)
description: Our 0-100 composite score for evaluating copy-trading candidates. GodEye is closed/invite-only; we built our own in supabase/functions/_shared/copyability.ts.
type: project
originSessionId: d633400a-7231-497a-bcf8-1120cb787b1f
---
GodEye's Copyability Score is proprietary and their platform is invite-only. PRD v4 removed GodEye as a dependency and we replicated the concept internally.

**Location:** `supabase/functions/_shared/copyability.ts` — function `calcCopyabilityScore()`

**100-pt weighted composite:**
- Edge retention (backtest ROI with delay / baseline ROI): 25 pts ← most important
- Win rate in [55%, 80%] band: 15 pts
- Gain/Loss ratio ≥ 2.0: 15 pts
- Trade size practicality (avg < $15K): 10 pts
- Reasonable frequency (<50/day, not a bot): 10 pts
- Low hedging (<30%): 5 pts
- Market diversity (≥5 markets): 10 pts
- ROI with delay positive: 10 pts

**Red flag penalties (-15 pts each):**
- `fast-markets-only` — wallet only trades crypto 5min/15min markets (can't be copied with delay)
- `winrate-too-high` — win rate > 90% (likely exploit/bot)
- `no-drawdowns` — zero max drawdown with 20+ resolved trades (suspicious)

**Classification thresholds (`classifyBacktest()`):**
- APROVADA: ROI>0 + 50+ resolved + edge_retention>50% + win_rate>50%
- PROMISSORA: ROI>0 + (resolved≥20 OR edge_retention≥30%)
- REJEITADA: ROI<0 w/ 20+ resolved OR edge_retention<20% OR win_rate<40%

**Why:** Profitable wallets aren't necessarily copyable — a wallet with $100K positions, 5min reaction time, and erratic sizing is profitable but uncopyable by a $400 operator with a 120s poll delay. This score surfaces the copyable ones.

**How to apply:** When a user asks about wallet quality scoring, refer to this score. When updating criteria or weights, modify calcCopyabilityScore() and re-run backtester to compare scores.
