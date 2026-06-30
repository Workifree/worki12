# Playbook: refactor

> Workflow dedicado para refatorações — transformações que preservam comportamento existente sem adicionar
> features. Mais curto que feature/fix; aprovação necessária mas clarification simplificada.

## Quando dispara

- "refatorar <X>", "simplificar <X>", "limpar <X>", "extrair componente de <X>", "dividir <arquivo>"
- Tech debt explícito: "página X está grande demais", "extrair lógica de Y"

**Páginas grandes conhecidas (candidatas):**
- `frontend/src/pages/Admin.tsx` (~767 linhas)
- `frontend/src/pages/Profile.tsx` (~703), `pages/company/CompanyProfile.tsx` (~696)
- `frontend/src/pages/MyJobs.tsx` (~610), `pages/company/CompanyJobCandidates.tsx` (~613)
- `frontend/src/pages/company/CompanyCreateJob.tsx` (~558), `CompanyMessages.tsx` (~538)

**NÃO dispara** para: adição de funcionalidade junto com limpeza (→ feature); renomeação trivial (≤3 linhas → carve-out direto).

---

## Princípios

1. **Comportamento preservado** — se algum teste/fluxo de comportamento quebrar, o refactor falhou.
2. **Build verde antes e depois** — invariante bloqueante (`cd frontend && npm run build`).
3. **Sem features novas** — se surgir oportunidade, parar e criar spec separada.
4. **Escopo mínimo** — um arquivo/componente por sessão de refactor.

---

## Fase 0 — Bearings (silencioso)

```bash
git status -sb
git branch --show-current
cd frontend && npm run build   # confirmar verde ANTES de começar
cd frontend && npm run test    # se há testes cobrindo o alvo
```

Se o build NÃO está verde antes: **HALT** — reportar ao humano. Não refatorar sobre build quebrado.

---

## Fase 1 — Clarification (3 perguntas, sem AskUserQuestion se óbvio)

1. **Escopo** — qual arquivo/componente/serviço é o alvo? (path específico)
2. **Motivação** — arquivo grande / acoplamento / duplicação / performance?
3. **Coverage** — há teste cobrindo o comportamento a preservar?
   - Sim → prosseguir
   - Não → builder adiciona testes de caracterização ANTES de refatorar

Salvar em `.harness/spec/<slug>/spec.md`:
```markdown
# Refactor — <nome>

## Alvo
`frontend/src/pages/X.tsx` (N linhas)

## Motivação
<por quê>

## O que NÃO muda
<comportamento preservado — lista de critérios>

## Estratégia
<extração de componente / extração de hook / split em arquivos>
```

---

## Fase 2 — Plan & Approval (HALT)

```markdown
# Plan — Refactor: <nome>

## Branch: `refactor/<slug>`

## Gate de entrada
- [ ] cd frontend && npm run build: VERDE ← verificar antes de criar branch

## Estratégia
<o que extrai para onde, quais interfaces novas>

## Files
| Path | Ação |
|---|---|
| frontend/src/pages/X.tsx | reduzir de N para M linhas |
| frontend/src/components/XSub.tsx | criar (extraído) |
| frontend/src/hooks/useXLogic.ts | criar (lógica extraída) |

## Gate de saída
- [ ] Comportamento idêntico ao original
- [ ] cd frontend && npm run build: VERDE
- [ ] cd frontend && npm run test: VERDE (sem regressão)
- [ ] cd frontend && npm run lint: VERDE

## Estimate: S | M
```

Aprovação padrão: Sim / Ajustar / Cancelar.

---

## Fase 3 — Implementation

```
1. git checkout -b refactor/<slug>
2. Adicionar testes de caracterização SE coverage insuficiente → npm run test VERDE
3. harness-builder (mode=refactor): extrair/reorganizar — sem comportamento novo, sem API nova
4. cd frontend && npm run build: VERDE (sem regressão)
5. cd frontend && npm run test + lint: VERDE
```

### Deadlock (refactor)
- Testes quebram após extração → builder desfaz e tenta granularidade menor.
- Continuam quebrando após 2 tentativas → BLOCKED, reportar ao humano.

### Revisão (recomendado)
Refactor de UI → `harness-frontend-reviewer` (design system + padrões preservados). Caso geral →
`harness-evaluator` com rubrica de refactor:
```
□ Comportamento preservado?
□ Interfaces públicas (exports/rotas) não quebradas?
□ Sem código morto remanescente?
□ Nomenclatura melhorou?
```

---

## Fase 4 — Commit + Push

```bash
git add <arquivos específicos>
git commit -m "refactor(<escopo>): <descrição>"   # PT, sem Co-Authored-By
git push -u origin refactor/<slug>
```

Sem sync de docs (refactor não muda comportamento de usuário). Se mudou interface pública/rota → verificar docs.

---

## Fase 5 — PR

```bash
gh pr create --base main --head refactor/<slug> \
  --title "refactor(<escopo>): <descrição>" \
  --body "$(cat <<'EOF'
## Summary
- Extrai X de Y para melhorar manutenibilidade
- Sem mudança de comportamento

## Test plan
- [x] Build verde antes E depois
- [x] Comportamento preservado verificado

## Files
- `frontend/src/pages/Y.tsx`: N→M linhas
- `frontend/src/components/YSub.tsx`: criado (extraído)
EOF
)"
```

---

## Anti-patterns

- Adicionar feature "já que estou aqui" → parar, criar spec de feature.
- Refatorar sem build verde de entrada.
- Extrair para abstração prematura (3 usos justificam, 2 não).
- Mudar nomes públicos/rotas sem atualizar todos os importadores.
