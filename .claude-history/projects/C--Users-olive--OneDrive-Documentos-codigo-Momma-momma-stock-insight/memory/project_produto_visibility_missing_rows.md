---
name: project_produto_visibility_missing_rows
description: Produtos sem linhas em produto_loja_visibility somem da busca do frontend mesmo com ativo=true
metadata: 
  node_type: memory
  type: project
  originSessionId: 0a1348fc-f923-44e5-a206-f70da40022cc
---

Produto com `produtos_master.ativo = true` mas **sem nenhuma linha** em `produto_loja_visibility` fica **invisível na busca do frontend** em todas as lojas. A visibilidade por loja é o gate real de exibição, não o flag `ativo`.

Vários produtos cadastrados em ~2026-05-19 ficaram assim (cubas 1441/1442/1443 "Cuba de Paçoca/Pipoca/Romeu e Julieta", Canjica 1445, Curau 1444) — `vis: []`. Sintoma do usuário: "criei o produto mas não vejo ele ao pesquisar".

**Why:** o cadastro de produto que originou esses itens não populou `produto_loja_visibility`. Frontend filtra por essa tabela.

**How to apply:** ao diagnosticar "produto sumido/não aparece", checar `produto_loja_visibility` ANTES de recriar — quase sempre é falta de linhas, não falta do produto. Fix = inserir `(produto_master_id, loja_id, ativo=true)` para as lojas desejadas (loja 1=Fábrica, 2-6 lojas), nunca duplicar o produto. Padrão de insert seguro usa `WHERE NOT EXISTS` no cross join produtos×lojas. Vale investigar/corrigir o fluxo de cadastro que omite essas linhas. Relacionado a [[feedback_only_active_products]].
