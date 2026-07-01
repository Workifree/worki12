---
name: project_fichas_tecnicas_construtor_verdade
description: "Fichas Técnicas — o Construtor (canvas) é a fonte da verdade; modal espelha; ingredientes = insumos, não produtos_master"
metadata: 
  node_type: memory
  type: project
  originSessionId: a0c49dbf-f9b3-4d8e-9547-7f9b5b62aaab
---

Na feature **Fichas Técnicas** (`/producao/fichas-tecnicas`), o **Construtor de Ficha** (canvas, `RecipeConfigurator` + `useRecipeGraph`) é a **fonte da verdade**. O modal Editar/Nova (`FichaModal` em `src/pages/producao/FichasTecnicas.tsx`) deve **espelhar** o construtor, não divergir.

Modelo de dados real de ingredientes em `ficha_tecnica_itens`: cada item é **insumo** (`insumo_id`), **sub-receita** (`sub_ficha_id`) ou **esboço** (texto livre em `observacao` + `preco_unitario_esboco`). Ingredientes = **`insumos`** (matéria-prima), NUNCA `produtos_master`. O `produto_master_id` da ficha é só o **produto final** que a receita gera (aba Geral "Atrelar Produto Final"), não ingrediente.

**Custo — a VERDADE é o banco (triggers Postgres), NÃO o frontend.** Triggers `ficha_item_recompute_trg` (INSERT/UPDATE/DELETE em `ficha_tecnica_itens`) e `insumo_price_recompute_trg` (UPDATE preco/fator em `insumos`) chamam `recompute_ficha_cost(ficha_id)` → `compute_item_cost(item_id)`, com cascata pra sub-receitas. **Nunca recalcular custo no client** (redundante e conflita). Fórmula de `compute_item_cost` (espelhada no front em `src/hooks/producao/custoModel.ts`):
- insumo → `preco_custo × qtd × ratio`, onde `ratio` converte `unidade_do_item → unidade_compra`: pares físicos padrão (g↔kg, mL↔L, mg↔g) usam conversão automática (ex. mL→L=0,001) e **IGNORAM `fator_conversao`**; pares não-padrão (espiga, pack, un…) usam `ratio = 1/fator_conversao` (= "quantos {unidade_producao} em 1 {unidade_compra}").
- sub-receita → `(custo_calculado / rendimento_quantidade) da sub-ficha × qtd`
- esboço → `preco_unitario_esboco × qtd`

`preco_custo` = preço por `unidade_compra` (sync da NF). `custoModel.ts` é só pra EXIBIR ao vivo enquanto edita; o trigger persiste. Validado nos itens do Curau (ficha 78): total R$22,73 bate. Armadilha histórica: o frontend antigo usava `preco/fator_conversao` (modelo errado) e mostrava preços enganosos; `fator_conversao` NÃO é "total recebido na NF".

**Why:** o CTO definiu explicitamente que "o construtor é o principal, de lá que vem a verdade". O modal antigo listava só `produtos_master`, então ficha criada no construtor (com `insumo_id`) aparecia **vazia** no modal.

**How to apply:** ao mexer em qualquer editor de ficha, ingredientes vêm de `insumos`; suporte aos 3 tipos (insumo/sub-receita/esboço); use os helpers de custo compartilhados; extração por foto (IA) entra como **esboço de texto** pra atrelar depois. Bug recorrente nessa área: handlers `onChange` de campo numérico passando 1 arg a setters de `(idx, campo, valor)` ou gravando string em estado `number` — sempre converter com `Number(...)`.
