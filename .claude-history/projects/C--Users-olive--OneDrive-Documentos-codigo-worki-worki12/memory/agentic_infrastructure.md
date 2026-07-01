---
name: agentic-infrastructure
description: Three-tier agentic management system for Worki - strategic roundtable with Chief of Staff + 7 specialists, tactical architect, and dynamic operational agents per plan
type: project
---

## Agentic Management Infrastructure (Built Mar 2026)

Three-tier architecture: Strategic → Tactical → Build → Run → Feedback Loop

**Strategic Layer (fixed, permanent):**
- `/project:roundtable` — Chief of Staff coordinates 7 specialist subagents
- Specialists: strategy-advisor (opus), growth-analyst (sonnet), finance-analyst (sonnet), yc-advisor (opus), vc-fundraising (sonnet), product-advisor (sonnet), market-researcher (sonnet)
- ALL agents have WebSearch + WebFetch + Bash (can query Supabase DB and search web)
- 3 mandatory protocols on ALL agents: Data Integrity, Evidence-Based Cases, Active Challenge
- YC Advisor is permanent devil's advocate (finds 3+ reasons why ideas can fail)
- Output: strategic plan saved to `docs/plans/{name}/strategic-plan.md`

**Tactical Layer (fixed, CEO-driven):**
- `/project:tactical {plan-name}` — Architect reads strategic plan, designs operational infrastructure with CEO
- Back-and-forth until CEO approves
- Output: action plan saved to `docs/plans/{name}/action-plan.md`

**Build Layer:**
- `/project:build {plan-name}` — Builder creates agent files and commands from action plan
- Creates: `.claude/agents/plan-{name}-*.md` + exec/kpi commands

**Database:**
- `agent_memory` table — shared context (business_context, metrics, config)
- `agent_kpis` table — KPI tracking per plan
- Migration: `20260329000000_agent_management.sql`
- Seed: `scripts/seed-agent-memory.sql`

**Why:** CEO operates as strategic orchestrator, agents amplify speed and analytical breadth. Human always decides at strategic+tactical. Operational automates what it can.

**How to apply:** When user mentions roundtable, strategic planning, or agent infrastructure, reference this system. Plans live in `docs/plans/`. Agent specs live in `.claude/agents/`.
