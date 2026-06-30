# `.harness/` — Worki Development Harness (v3.5; Claude + Gemini 3 no frontend)

Harness de desenvolvimento spec-driven para o Worki, portado do projeto Momma (v3.5) e adaptado à realidade
do Worki: estrutura plana de páginas, isolamento por papel (worker/empresa), Asaas-only com escrow atômico,
design neo-brutalista. **Roteamento Claude para tudo, com uma exceção: a construção de UI usa Gemini 3**
(`harness-frontend-builder` → `scripts/gemini-dispatch.sh`, fallback Claude).

## O que é

Um sistema de orquestração para mudanças de código em que o **Claude Code (esta sessão) é o orquestrador** e
delega para subagents `harness-*` especializados, seguindo um pipeline com gate de aprovação humana. O objetivo
é que toda mudança não-trivial passe por: clarificação → plano aprovado → implementação → revisão independente
→ avaliação cética → commit/PR.

## Estrutura

```
.harness/
├── constitution.md         # princípios imutáveis (Articles) — lidos antes de qualquer decisão
├── harness.config.yaml      # roles → modelo (opus/sonnet/haiku), invariants, limits
├── MODELS.md                # view legível do routing de modelos
├── structure.json           # contrato de estrutura (required/forbidden)
├── VERSION / .framework-version
├── memory-bank/             # conhecimento do projeto (lido pelos agentes)
│   ├── product.md  architecture.md  tech.md  structure.md
│   ├── design-system.md  patterns.md  glossary.md
│   └── decisions/          # ADRs (escritos pelo harness-architect)
├── playbooks/
│   ├── feature-or-fix.md   # flow canônico (Fases 0–5)
│   └── refactor.md         # flow de refatoração (comportamento preservado)
├── spec/<slug>/spec.md     # specs versionadas por mudança (sobrevivem à sessão)
├── tasks/                  # PRDs/breakdowns de features L/XL
└── reports/                # relatórios de avaliação/revisão
```

Os subagents `harness-*` ficam em `.claude/agents/`. O protocolo do orquestrador está no `CLAUDE.md` da raiz.

## Como usar

Fale naturalmente com o Claude Code. Gatilhos:

- **"implementar/criar/adicionar X"** → pipeline de feature (`playbooks/feature-or-fix.md`)
- **"corrigir/bug em X / X não funciona"** → pipeline de fix (3 perguntas obrigatórias primeiro)
- **"refatorar/simplificar/extrair X"** → playbook de refactor

O orquestrador percorre as fases, faz UMA pausa obrigatória para você aprovar o plano (Fase 2), e só então
implementa. Specs ficam salvas em `.harness/spec/`.

## Princípios

1. HALT obrigatório no humano entre plano e implementação.
2. Spec é artefato versionado — sobrevive à sessão.
3. Branch isolado por mudança — nunca commit direto em `main`.
4. `cd frontend && npm run build` + `lint` verdes antes do commit.
5. O builder nunca aprova o próprio trabalho — o evaluator existe para isso.
6. Subagents não chamam subagents; o orquestrador encadeia tudo.

> Portado em 2026-06-15 do harness v3.5 (Momma). Diferenças principais: Claude para tudo exceto a UI
> (Gemini 3 só no frontend-builder), estrutura plana (sem FSD), domínio Asaas/escrow em vez de estoque/lotes.
