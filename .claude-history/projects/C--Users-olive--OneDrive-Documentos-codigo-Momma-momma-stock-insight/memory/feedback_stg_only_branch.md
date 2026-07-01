---
name: Trabalhar sempre em stg — NUNCA trocar de branch
description: Usuário trabalha exclusivamente em stg. Não criar branches novas. Se uma branch diferente aparecer durante a sessão, é processo externo (CI/hook/agent) — voltar imediatamente para stg.
type: feedback
---

Sempre commitar em `stg`. **Não criar branches novas** sob nenhuma circunstância.

**Why:** O usuário trabalha diretamente em stg como branch única de desenvolvimento. Criar outras branches (feature/fix/etc) causa fragmentação e retrabalho — ele explicitou várias vezes: "pare de criar outras branches".

**How to apply:**
- Se `git branch --show-current` retornar qualquer branch ≠ `stg`, executar `git checkout stg` imediatamente antes de qualquer edição.
- Nunca executar `git checkout -b` ou `git switch -c` para criar nova branch.
- Se houver conflito com arquivos modificados, NÃO usar `git stash` sem permissão — preferir commitar em stg ou ler o arquivo destino e reaplicar manualmente.
- Durante a sessão, checks periódicos de branch podem ser necessários se operações automáticas (linter, agent, pre-commit hook) mudarem de branch.
- Ao commitar, sempre verificar `git branch --show-current` antes.
