---
name: project-harness-v5-learning-loop
description: Harness v5 (2026-06-16) — loop de aprendizado ACE + verificação visual. Direção e estado da evolução do harness.
metadata: 
  node_type: memory
  type: project
  originSessionId: b08dcb6f-4c13-4a31-a62a-e2575f87bda2
---

Harness v5 (decidido 2026-06-16): dois upgrades sobre o v4, baseados em pesquisa SOTA (ACE/Stanford, Musk algorithm, Playwright MCP) + análise do retrabalho real (135% taxa de fix/feature; 36% dos defeitos são visuais; loop de aprendizado não existia).

**Construído (parte 1-5):**
- `.harness/learnings/{frontend,security,runtime,data}.md` — playbook ACE append-only, 1 por gate, entradas com glob + helpful/harmful counters. Seed feito dos defeitos reais do git. README explica formato.
- Cada gate lê seu learnings ANTES de revisar (frontend-reviewer→frontend.md, security→security.md, builder/evaluator→runtime+data).
- `harness-memory-updater` virou **Curator ACE**: dedup + append-only + propõe guards. Nunca reescreve (anti context-collapse).
- `harness-git-miner` (novo agente sonnet): varre git por feat→fix-mesmos-arquivos, propõe learnings automático.
- CLAUDE.md: loop "você sinaliza defeito → debugger RCA → builder fix → memory-updater grava delta → gate aprende". + tabela de TIERING Musk (carve-out/S/M/L-XL não pagam pipeline inteiro).

**Parte 6 — revisor de frontend SOTA estático (decisão CTO: SEM Playwright/MCP/render):**
`harness-frontend-reviewer` virou opus + tool Bash. RODA lint/tsc/build + grep validators de defeitos conhecidos (bege, token shadcn, grid sem base mobile, bg-white sem dark, FSD, a11y, h-screen, Tooltip-no-toque) + diff contra página canônica (NotasFiscais.page.tsx) + revisão adversarial por 5 lentes (design system/responsivo/dark/React/a11y) + lê learnings/frontend.md. Emite smoke_checklist cirúrgico (3-5 itens) para o resíduo irredutível que não dá pra ver sem render (posição pixel-exata). Não usa browser — pega os defeitos estruturais (maioria dos 36%), sinaliza o resto pro humano olhar em 30s.

**Por que não é Ralph nem mais agentes:** Ralph é greenfield/no-gates (anti-padrão p/ ERP brownfield financeiro). Berkeley MAST + Cognition: falhas multi-agente são coordenação, não capacidade. Lever = context engineering (learnings no gate certo) + olhos, não headcount. Ver [[feedback_harness_delegation_enforcement]].
