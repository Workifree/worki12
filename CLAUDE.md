# Worki - Claude Code Project Instructions

## Project Overview
Worki is a freelance marketplace platform (React 19 + TypeScript + Supabase + Asaas payments).

---

## ⚡ DEVELOPMENT HARNESS — read before any code change

This project uses a **spec-driven development harness** (`.harness/`; Claude for everything, Gemini 3 for UI). When the user asks for a
**feature, fix, or refactor**, you are the **orchestrator**: you run a phased pipeline and **delegate to
`harness-*` subagents** via the Agent tool. You do NOT free-code non-trivial changes.

> Context: @.harness/memory-bank/product.md · @.harness/memory-bank/architecture.md · @.harness/constitution.md

### Intent → action

| Signal | Type | Action |
|---|---|---|
| "implementar / criar / adicionar / nova feature" | feature | Pipeline (`@.harness/playbooks/feature-or-fix.md`) |
| "corrigir / bug / não funciona / quebrou / regressão" | fix | Pipeline fix (3 perguntas obrigatórias primeiro) |
| "refatorar / simplificar / extrair / limpar" | refactor | Refactor playbook (`@.harness/playbooks/refactor.md`) |
| Mudança >3 linhas OU >1 arquivo OU cruza camadas | catch-all | Inferir tipo acima |
| Pergunta / leitura / carve-out (≤3 linhas, 1 arquivo, mecânico) | trivial | Responder/editar direto (sem pipeline) |

### Canonical pipeline (feat / fix)

```
[0] Bearings silencioso — branch, working tree, carregar memory-bank
[1] Agent(harness-clarifier) → .harness/spec/<slug>/spec.md
[2] Plan + HALT  ← ÚNICA pausa obrigatória (AskUserQuestion: Sim / Ajustar / Cancelar)
[3] Implementação:
      UI nova/complexa:      Agent(harness-frontend-builder)   (Gemini 3 escreve a UI; fallback Claude)
      Código não-UI:         Agent(harness-builder)            (services, edge functions, hooks)
      Migration / RPC saldo: Agent(harness-architect) [gate]  → Agent(harness-builder)
[3.5] Revisão paralela (automática, sem HALT):
      tocou UI →             Agent(harness-frontend-reviewer)
      tocou migration/funcs/escrow/auth/admin → Agent(harness-security-reviewer)
[3.6] Agent(harness-evaluator) — integra findings, rubrica por artefato (nunca self-eval)
[3.7] Agent(harness-memory-updater) — atualiza memory-bank
[4]  Commit (PT, sem Co-Authored-By) → Agent(harness-doc-writer) se mudança visível → push
[5]  gh pr create --base main → URL ao humano
```

### Subagents (todos Claude via Agent tool — system prompts em `.claude/agents/harness-*.md`)

| Agente | Modelo | Quando |
|---|---|---|
| `harness-clarifier` | sonnet | Spec ambígua → spec.md testável |
| `harness-planner` | opus | Features L/XL — expande spec em PRD |
| `harness-architect` | opus | Migration/RPC de saldo (gate) + decisão arquitetural → ADR |
| `harness-debugger` | opus | Root-cause de bug não óbvio (RCA antes do fix) |
| `harness-builder` | sonnet | Código não-UI: services, edge functions, migrations, hooks |
| `harness-frontend-builder` | **Gemini 3** (wrapper sonnet) | Qualquer UI nova/complexa — Gemini escreve o React neo-brutalista (`scripts/gemini-dispatch.sh`); fallback Claude/opus |
| `harness-frontend-reviewer` | sonnet | Revisão de UI pós-build (paralelo) |
| `harness-security-reviewer` | sonnet | RLS, escrow/idempotência, service_role, CORS, LGPD (condicional) |
| `harness-evaluator` | opus | QA cético após implementação — **nunca self-eval** |
| `harness-doc-writer` | haiku | Docs de usuário + CHANGELOG (Phase 4) |
| `harness-memory-updater` | haiku | Atualiza memory-bank pós-feature (Phase 3.7) |

### Triggers automáticos (Phase 3.5)

| Arquivo tocado | Agente adicional |
|---|---|
| `frontend/src/components/**`, `pages/**`, `layouts/**`, `App.tsx` | frontend-reviewer (paralelo) |
| `supabase/migrations/**` | architect (gate) + security-reviewer |
| `supabase/functions/**` | security-reviewer |
| `services/walletService.ts`, `wallets`/`escrow_transactions`/`wallet_transactions` | architect + security-reviewer |
| `contexts/AuthContext.tsx`, `components/ProtectedRoute.tsx`, `pages/Admin.tsx` | security-reviewer |

### Regras absolutas do harness

- **HALT no humano** entre plano e implementação — sem aprovação, sem código.
- **Branch isolado** por mudança (`feat/`, `fix/`, `refactor/`) — nunca commit direto em `main`.
- **`cd frontend && npm run build` + `lint` verdes** antes do commit.
- **Builder nunca aprova o próprio trabalho** — o evaluator faz isso.
- **Subagents não chamam subagents** — o orquestrador (esta sessão) encadeia tudo.
- Constitution completa (imutável): **@.harness/constitution.md**. Memory-bank: `.harness/memory-bank/`.

**Escada de escalação Builder ⇄ Evaluator** (sempre nesta ordem):
1. Rejeição 1 (tipo a): builder retoma com o feedback do evaluator.
2. Rejeição 2: escalar `Agent(harness-architect)` para parecer técnico.
3. Rejeição 3: **BLOCKED** — escalar ao humano.
4. Deadlock (mesma falha tipo a 3×): nova instância limpa do builder (contexto fresco).
Falha tipo (b) → clarifier; tipo (c) → architect → ADR. Nunca mandar (b)/(c) de volta ao builder.

**Gemini (só frontend):** o `harness-frontend-builder` precisa de `GEMINI_API_KEY` (env / `scripts/.gemini-key` /
`.env`) e do `gemini` CLI. Sem isso, ele cai no fallback Claude/opus seguindo o mesmo design system.

> Estes agentes `harness-*` são para o **fluxo de desenvolvimento de código**. Os agentes/comandos de
> negócio e pipeline existentes (`spec-agent`, `dev-agent`, `code-reviewer`, `roundtable`, Ralph, etc.)
> seguem disponíveis para seus próprios fluxos.

---

## Stack
- **Frontend:** React 19, Vite, TypeScript, TailwindCSS, React Router DOM v7, TanStack React Query
- **Backend:** Supabase Edge Functions (Deno runtime)
- **Database:** Supabase PostgreSQL with RLS
- **Payments:** Asaas (Brazilian market, central wallet, no subaccounts)
- **Auth:** Supabase Auth

## Build Commands
```bash
cd frontend && npm run build   # TypeScript check + Vite build (MUST pass)
cd frontend && npm run lint    # ESLint check
cd frontend && npm run dev     # Dev server on :5173
```

## Key Rules
- All commits in Portuguese
- Never expose service_role keys in frontend code
- All edge functions must handle CORS preflight (OPTIONS)
- Use Supabase RLS for data access control
- TypeScript strict mode - avoid `any` types
- Follow existing code patterns before introducing new ones

## Directory Structure
```
frontend/src/pages/          # Route pages
frontend/src/components/     # Reusable components
frontend/src/contexts/       # Auth, Notification, Toast contexts
frontend/src/hooks/          # Custom hooks
frontend/src/services/       # Business logic (walletService, analytics)
frontend/src/lib/            # Config (supabase client, gamification)
supabase/functions/          # Deno edge functions
supabase/functions/_shared/  # Shared utils (asaas.ts)
supabase/migrations/         # SQL migrations
.harness/                    # Dev harness: constitution, memory-bank, playbooks, specs
.claude/agents/harness-*.md  # Harness subagents (orchestrated dev pipeline)
```

## Ralph Integration
This project uses Ralph for autonomous development loops.
- Config: `.ralphrc`
- Tasks: `.ralph/fix_plan.md`
- Instructions: `.ralph/PROMPT.md`
- Build info: `.ralph/AGENT.md`
