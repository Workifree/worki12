# Playbook: feature / fix

> Flow canônico de mudança no Worki. Lido pelo orchestrator (Claude Code) ao receber pedido de feature ou fix.
> Visão alta em `CLAUDE.md`.
>
> **Mesmo playbook, dois entrypoints.** O tipo (`feature` vs `fix`) é fixado na Fase 0 a partir do trigger e
> influencia: prefixo de branch, prefixo de commit, perguntas obrigatórias, e probabilidade de invocar
> `harness-debugger`.

## Quando este playbook dispara

### Trigger feature
- "nova feature", "feature: <desc>", "implementar <X>", "adicionar <X>", "criar <X>"
- → tipo=`feature`, branch=`feat/<slug>`, commit=`feat(<escopo>): ...`

### Trigger fix
- "corrigir <X>", "consertar <X>", "fix: <desc>", "bug em <X>", "<X> não funciona", "quebrou", "regressão"
- → tipo=`fix`, branch=`fix/<slug>`, commit=`fix(<escopo>): ...`

### Catch-all
Qualquer pedido de mudança não-trivial (>3 linhas, >1 arquivo, ou cruza camadas) sem trigger explícito.
Inferir o tipo pelas pistas ("bug/quebrado/errado/regressão" → fix; senão → feature).

**NÃO dispara** para: pergunta informativa; carve-out trivial (≤3 linhas, 1 arquivo, regra óbvia, sem UI);
pesquisa/exploração pura.

## Princípios

1. **HALT obrigatório no humano** entre Fase 2 e Fase 3. Sem aprovação, sem código.
2. **Spec é artefato versionado** em `.harness/spec/<slug>/spec.md` — sobrevive à sessão.
3. **Branch isolado por mudança** — nunca commitar direto em `main`.
4. **Build + lint verdes antes do commit** (`cd frontend && npm run build && npm run lint`) — não-negociável.
5. **PR é o ponto de aprovação humana final** — orchestrator NÃO faz merge.

## Fase 0 — Bearings (silencioso)

```bash
git status -sb
git branch --show-current
git diff --quiet || echo "working tree dirty — perguntar antes"
```

Context load (Read, não Bash):
- `.harness/constitution.md`
- `.harness/memory-bank/product.md`, `glossary.md`, `architecture.md`
- `.harness/memory-bank/structure.md` (se menciona arquivos/rotas)
- `.harness/memory-bank/tech.md` (se menciona deps/stack)
- `.harness/memory-bank/design-system.md` (se menciona UI/tela)

### Decisões da Fase 0

| Sinal | Ação |
|---|---|
| Trigger feature | tipo=`feature`, branch=`feat/`, commit=`feat` |
| Trigger fix | tipo=`fix`, branch=`fix/`, commit=`fix`, forçar perguntas de reprodução na Fase 1 |
| Working tree dirty | Perguntar: commit/stash/discard antes de prosseguir |
| Já em branch feat/fix | Confirmar continuar nela ou criar nova |
| Menciona "UI/tela/componente/design" | Fase 3 usa `harness-frontend-builder` |
| Toca empresa vs worker | Fixar o papel; rota em `pages/company/*` ou `pages/*` |
| Toca pagamento/carteira/escrow (`walletService`, `asaas-*`, `wallets`, `escrow_transactions`) | Tier 2; envolver `harness-architect` na Fase 2 |
| Toca migration / RPC de saldo | `harness-architect` gate obrigatório antes do builder |
| fix E root-cause não óbvio | `harness-debugger` (RCA) ANTES da Fase 2; incorporar na spec |
| fix E root-cause óbvio (typo, off-by-one) | Pular debugger, clarification mínima → plan |

Output Fase 0 (interno): tipo, tier (0/1/2), tags (`ui`/`payment`/`debug`/`migration`/`mobile`), papel
(worker/company/ambos), needs_debugger.

## Fase 1 — Clarification

Invocar `harness-clarifier` (ou conduzir direto se trivial).

### Princípios
- Até 10 perguntas no total, em rodadas de ≤4 (limite do `AskUserQuestion`).
- Cada pergunta com **opção recomendada** marcada "(Recomendado)", posicionada primeiro, baseada no memory-bank.
- Pular perguntas óbvias. Nunca perguntar o que está no `glossary.md`/`constitution.md`.
- **Se tipo=fix**: as 3 primeiras perguntas são OBRIGATÓRIAS (reprodução, impacto, root-cause hypothesis).

### Bloco obrigatório fix (perguntas 1-3)
1. **Reprodução** — passos determinísticos / reproduzido localmente / intermitente (→ aciona `harness-debugger`).
2. **Impacto** — só worker / só empresa / todos os usuários / só pagamentos / só dev.
3. **Root-cause hypothesis** — sim (valida com Read) / não (→ RCA) / typo trivial (pula RCA).

### Banco de perguntas (feature)
- **Papel alvo** — worker, empresa, ou ambos? (define `pages/` vs `pages/company/`)
- **Definição de pronto** — happy path + edge cases (Recomendado) / só happy path (MVP).
- **Out-of-scope explícito.**
- **Mudança de schema** — nova tabela / colunas novas / só lê / só client. (Se mexe em saldo → RPC atômica.)
- **RLS** — nova policy / ajustar existente / herda.
- **Pagamento** — toca carteira/escrow/Asaas? (Se sim → architect na Fase 2; idempotência obrigatória.)
- **Tipo de UI** — página nova / componente reutilizável / refinamento / só backend.
- **Rota e proteção** — `<ProtectedRoute>` (default sim) + isolamento de papel correto.
- **Mobile** — precisa funcionar bem no celular? (default sim.)
- **Testes** — Vitest co-located / E2E Playwright / smoke manual.

### Output Fase 1 — `.harness/spec/<slug>/spec.md`

```md
# <Title> — spec

## Context
<problema/oportunidade, 2-3 parágrafos. Por que importa para o Worki?>

## Requirements
- [ ] R1: <requisito funcional concreto>

## Acceptance criteria
- [ ] A1: <DADO + QUANDO + ENTÃO — verificável>

## Out-of-scope
- ...

## Clarifications log
- Q1 → A1
```

## Fase 2 — Plan & Approval (HALT)

```md
# Plan — <nome>

## Branch alvo
`feat/<slug>` (ou `fix/<slug>`)

## Tipo & Tier & Papel
feature|fix · 0|1|2 · worker|company|ambos

## Files to touch
| Path | Razão | Camada |
|---|---|---|
| frontend/src/pages/company/X.tsx | criar página | pages |
| frontend/src/services/x.ts | lógica | services |
| supabase/migrations/<ts>_x.sql | nova tabela + RLS | data |
| supabase/functions/x/index.ts | edge function | functions |
| frontend/src/types/index.ts | atualizar interfaces | types |

## Steps (ordenados)
1. Migration (+ RLS, + RPC atômica se mexe em saldo, + GRANT EXECUTE)
2. Edge function (se operação privilegiada — CORS preflight + auth)
3. Service / lógica (walletService etc.)
4. Tipos em types/index.ts (à mão)
5. UI (página/componente) — registrar rota em App.tsx sob ProtectedRoute
6. Testes (Vitest co-located / E2E)

## Subagents por step
- migration/RPC: harness-architect (gate) → harness-builder
- edge function/service: harness-builder
- UI: harness-frontend-builder
- final: harness-frontend-reviewer ∥ harness-security-reviewer → harness-evaluator

## Test strategy
- Unit: Vitest co-located (jsdom).
- E2E: Playwright se fluxo crítico (pagamento, candidatura, check-in/checkout).
- Build smoke: `cd frontend && npm run build` DEVE passar.

## Risk assessment
| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| RLS quebra isolamento de papel | M | A | Testar como worker E como empresa antes do merge |
| RPC de saldo sem GRANT/idempotência | B | A | Architect revisa; reference_id estável; UNIQUE (wallet_id, reference_id) |
| Edge function sem CORS preflight | M | M | Verificar OPTIONS + origens local/prod |

## Rollback
`git revert <hash>` + migration de rollback (se aplicável).

## Estimate: S | M | L
```

### Pergunta de aprovação (AskUserQuestion)
- "Sim — prosseguir (Recomendado)" — cria branch + implementa conforme plan.
- "Ajustar — texto livre" — refina e re-pergunta.
- "Cancelar" — aborta; spec fica salva.

## Fase 3 — Implementation

### Loop por step
1. Invocar subagent apropriado via Agent tool.
2. Após retorno, validar:
   - `cd frontend && npm run lint`
   - `cd frontend && npm run build` (tsc -b + vite)
   - `cd frontend && npm run test` (arquivos relevantes)
3. Se falha:
   - 1ª falha do mesmo critério: feedback ao builder, retry.
   - 2ª falha: `harness-architect` para parecer técnico.
   - 3ª falha: HALT `BLOCKED` ao humano.
4. Atualizar checkboxes em `spec.md`.

### Phase 3.5 — Revisão especializada em paralelo (automático, sem HALT)

Após o builder completar os steps e o build local estar verde, disparar em paralelo:

**harness-frontend-reviewer** — SE o diff toca UI:
- `frontend/src/components/**`, `frontend/src/pages/**`, `frontend/src/layouts/**`
- Verifica: TS strict, design neo-brutalista (bordas/sombras/cores por papel), mobile-first, padrões React.

**harness-security-reviewer** — SE o diff toca áreas sensíveis:
- `supabase/migrations/**`, `supabase/functions/**`
- `frontend/src/services/walletService.ts`, qualquer toque em `wallets`/`escrow_transactions`/`wallet_transactions`
- `frontend/src/contexts/AuthContext.tsx`, `components/ProtectedRoute.tsx`, `pages/Admin.tsx`
- Qualquer arquivo com `service_role`, `auth.uid()`, `RLS`, `escrow`, `reference_id`, CORS.

**Integração:** ambos reportam findings → contexto para o evaluator. Se algum reviewer retorna FAIL → builder
corrige antes do evaluator. Se a mudança não toca UI nem áreas sensíveis → pular ambos, ir direto ao evaluator.

### Phase 3.6 — Evaluator com rubrica por artefato

Invocar `harness-evaluator` com: spec.md + findings dos reviewers + tipo de artefato (componente / página /
service / migration / edge function / feature completa). O evaluator copia
`.harness/templates/verification.template.md` → `.harness/spec/<slug>/verification.md` e marca os critérios
com **IDs estáveis** (C-BUILD-GREEN, C-ESCROW-ATOMIC, C-ROLE-ISOLATION, ...) — reavaliados a cada iteração.

Classificação de falhas (routing obrigatório):
- **(a) implementável com iteração** → volta ao builder (máx 3x).
- **(b) precisa clarificação** → volta ao humano via clarifier.
- **(c) decisão arquitetural** → escala ao architect → ADR.

Deadlock break: mesma falha (a) sem resolver após 3 iterações → nova instância limpa do builder.

### Phase 3.7 — Memory updater (automático)

Após evaluator PASS, invocar `harness-memory-updater` com o diff. Atualiza `patterns.md`, `glossary.md`,
`tech.md`, `design-system.md` conforme necessário. Incremental — nunca sobrescreve.

### Smoke check antes de fechar Fase 3

```bash
cd frontend && npm run lint
cd frontend && npm run build
cd frontend && npm run test
```

Se feature toca fluxo crítico de pagamento/candidatura, rodar/atualizar E2E: `cd frontend && npm run test:e2e`.

### Manual smoke (se toca UI)

- **Página NOVA ou fluxo de pagamento/escrow → GATE OBRIGATÓRIO (HALT):** pedir ao humano para validar
  visualmente em `cd frontend && npm run dev` (porta 5173) com um roteiro de 3-5 ações do happy path.
  Esperar `OK manual` antes da Fase 4. É o ponto de irreversibilidade visível ao usuário — não pular.
- **Refinamento de UI existente → recomendado, não bloqueante:** sugerir o smoke; prosseguir se o humano dispensar.

## Fase 4 — Commit + Push

```bash
git status
git diff --cached
git commit -m "<tipo>(<escopo>): <descrição>"   # em português, SEM Co-Authored-By
git push -u origin <branch>
```

Regras: sem `--no-verify`/`--force`/`--amend` em commits pushed sem autorização. Sem `git add -A`/`git add .` —
apenas paths específicos. (Phase 4 pode invocar `harness-doc-writer` se houve mudança visível ao usuário.)

## Fase 5 — Pull Request

```bash
gh pr create --base main --head <branch> \
  --title "<tipo>(<escopo>): <descrição curta>" \
  --body "$(cat <<'EOF'
## Summary
- <bullet>

## Spec
.harness/spec/<slug>/spec.md

## Test plan
- [x] cd frontend && npm run lint
- [x] cd frontend && npm run build
- [x] cd frontend && npm run test
- [x] Smoke manual: <descrição>

## Notes
<decisões não óbvias, riscos aceitos, follow-ups>
EOF
)"
```

Output final ao humano: URL do PR + resumo.

## Critérios de paragem (BLOCKED)

| Condição | Ação |
|---|---|
| Ambiguidade após 2 rodadas de clarification | BLOCKED — pedir mais contexto |
| Plan rejeitado 2× | Reformular do zero, re-clarification |
| Build/test falhando após 3 iterações builder ⇄ evaluator | Escalar architect |
| Push rejeitado pelo remote | HALT, mostrar erro, NÃO `--force` |
| Humano diz "para"/"cancela" | Salvar estado na spec, abortar |

## Anti-patterns

- Pular Fase 2 (approval) "porque o plan é óbvio" — NUNCA.
- Mexer em saldo sem RPC atômica / sem idempotência — quebra dinheiro.
- Edge function nova sem CORS preflight — browser bloqueia.
- Auto-avaliar o próprio código (evaluator existe para isso).
- Introduzir React Query numa feature isolada (o projeto usa useState/useEffect).
- Reintroduzir Stripe/outro gateway, ou expor `service_role` no frontend.
- Misturar rota worker/company (fura o isolamento de papel).
