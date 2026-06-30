# Modelos — Worki

Standalone. Quase tudo roda em **Claude** (via Agent tool). **Exceção: construção de frontend usa Gemini 3** —
é o melhor construtor de UI e foi o que fez o frontend do Worki até agora. Sem ralph dispatcher.

## Provedores

| Provider | Auth | Habilitado | Uso |
|---|---|---|---|
| **claude** | session (Claude Code nativo) | Sim | Tudo: implementação não-UI, reasoning, revisão, docs |
| **gemini** | `GEMINI_API_KEY` (via `scripts/gemini-dispatch.sh`) | Sim | **Apenas** construção de UI React/TSX (frontend-builder) |

> Chave Gemini vem do ambiente (`GEMINI_API_KEY` / `scripts/.gemini-key` / `.env`), **nunca** em plaintext no
> repo. Requer o `gemini` CLI (`npm install -g @google/gemini-cli`).

## Tiers de Effort

| Tier | CLI | Modelo | Quando usar |
|---|---|---|---|
| `low` | claude | `haiku` | Docs, CHANGELOG, updates incrementais de memory-bank |
| `medium` | claude | `sonnet` | Implementação não-UI + revisões especializadas |
| `high` | claude | `opus` | Pensamento profundo (planner, evaluator, architect, debugger) |
| `design` | gemini | `gemini-3-pro-preview` | Construção de UI React/TSX (despacho via gemini-dispatch.sh) |

> O frontmatter `model:` de cada agente em `.claude/agents/harness-*.md` fixa o default Claude. O
> frontend-builder é um subagent Claude/sonnet que **despacha para o Gemini**; o `model:` dele é o do wrapper.

## Roles habilitados

| Role | Motor | Fallback | Papel |
|---|---|---|---|
| `harness-planner` | claude/opus | — | Expande spec em PRD para features L/XL |
| `harness-evaluator` | claude/opus | — | QA cético independente (nunca self-eval) |
| `harness-architect` | claude/opus | — | ADR + revisão de migration/escrow/contrato |
| `harness-debugger` | claude/opus | — | Root-cause analysis com evidência |
| `harness-frontend-builder` | **gemini/3-pro-preview** (wrapper claude/sonnet) | claude/opus | Escreve a UI React/TSX neo-brutalista |
| `harness-builder` | claude/sonnet | — | Código não-UI (services, edge functions, migrations, hooks) |
| `harness-clarifier` | claude/sonnet | — | Resolve ambiguidade → spec.md testável |
| `harness-frontend-reviewer` | claude/sonnet | — | Revisão de UI pós-build (paralelo) |
| `harness-security-reviewer` | claude/sonnet | — | RLS/escrow/service_role/CORS/LGPD (condicional) |
| `harness-doc-writer` | claude/haiku | — | Docs de usuário + CHANGELOG (Phase 4) |
| `harness-memory-updater` | claude/haiku | — | Atualiza memory-bank pós-feature (Phase 3.7) |

## Princípios de routing neste projeto

1. **UI nova → `harness-frontend-builder`.** Gemini 3 escreve o React/TSX completo seguindo o design
   neo-brutalista; o subagent Claude monta o contexto, despacha, grava e verifica (lint/build). Fallback
   Claude/opus se o Gemini estiver indisponível.
2. **Reasoning profundo → claude/opus.** Planner, evaluator, architect, debugger.
3. **Implementação não-UI / revisão → claude/sonnet.** Builder e reviewers.
4. **Docs/memory → claude/haiku.** Barato para texto derivado de diff.
5. **Sem dispatcher async.** Toda invocação é síncrona via Agent tool; o Gemini é chamado por bash dentro do frontend-builder.
6. **Subagents não chamam subagents.** O orchestrator (sessão principal) encadeia todos.

## Fonte única de verdade

`harness.config.yaml` é a definição. Este `MODELS.md` é uma view legível dela.
