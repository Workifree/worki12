---
name: Apenas produtos ativos
description: NUNCA alterar produtos inativos em produtos_master — source of truth são apenas itens ativos
type: feedback
---

Ao alterar dados em `produtos_master`, trabalhar APENAS com registros `ativo = true`. Inativos não devem ser tocados, alterados, nem receber dados novos.

**Why:** `produtos_master` com `ativo = true` é a única source of truth do sistema. Inativos são lixo legado e não devem receber atualizações.

**How to apply:** Sempre incluir `WHERE ativo = true` em qualquer UPDATE/INSERT que afete `produtos_master`. Nunca assumir que todos os registros da tabela são válidos.
