---
name: project_custos_fichas_construtor_2026_06
description: "Build de custeio completo das fichas técnicas (sobremesas Momma) no construtor, precificado por NF — junho 2026"
metadata: 
  node_type: memory
  type: project
  originSessionId: ce83c6be-f709-4b3b-962d-f6b70002eeb7
---

Custeei e GRAVEI no construtor (`fichas_tecnicas`+`ficha_tecnica_itens`) todo o portfólio de sobremesas, com preço vindo das notas fiscais (`itens_nota_fiscal`, compra mais recente). ~75 fichas com `observacoes='auto-custo NF 2026-06'`, zero com custo R$0.

**Motor de custo (NÃO mexer sem entender):** `compute_item_cost` + `recompute_ficha_cost` (cascateia pros pais via sub_receita) + triggers em INSERT/UPDATE/DELETE de item E em UPDATE de preço de insumo. `tipo` ∈ {insumo, sub_receita, embalagem}; `status` ∈ {rascunho, aprovada, obsoleta}. Espelho frontend em `src/features/producao/model/custoModel.ts`. Custo insumo = `preco_custo × qtd × ratio` (g↔kg automático; un/l não-padrão usa 1/fator_conversao). Sub-receita = `(sub.custo_calculado/sub.rendimento) × qtd`.

**Convenções usadas:** todos os itens em gramas (`unidade='g'`); insumos novos com `unidade_compra='kg'`, `fator_conversao=1000`, `preco_custo` em R$/kg. Produtos finais vendáveis: `rendimento=1 'un'` (custo_calculado = custo por unidade). Fatias de torta: `rendimento=12 'fatia'` (custo/12 = por fatia).

**Correções de insumo aplicadas (afetam fichas antigas tb):** OVO → kg/R$16,49 (era un/0,75, errado); Adoçante Stevia (#28) fator 600→30 (R$0,633/g real); CREME DE LEITE FRESCO 0,017→0,0332/g; FARINHA DE AMÊNDOAS 0→67,80; FERMENTO 0→27,13; GOMA XANTANA 0→56,90; cremeria 0→39; FARINHA DE COCO 0,81→16,20. +26 insumos novos criados.

**Custos finais (por unidade):** Bolo no Pote: Choc R$6,27 / Pistache R$10,52 / Cenoura R$6,19 / Brownie+DdL R$9,23 / Banoffe R$6,33. Fatia (por fatia 183g): Churros R$5,81 / Cenoura R$6,18 / Cookies R$6,62 / Pinacolada R$6,16 / Tiramissù R$6,79. Bombons (brig PRETO 51%): Uva R$1,88 / Morango R$2,68. Dresseds 19 (MINI/P/M/G × prestígio/choc/pistache/nozes/casadinho). Nakeds 20 (5 sabores × 4 tam). 9 Minis (casquinha 12g choc51 + 25g recheio).

**Escopo total gravado (153 fichas aprovadas, só 6 sem custo):** sobremesas (bolos no pote, fatias, bombons, 19 dresseds, 20 nakeds, 11 minis), **22 gelatos/sorbets** (= sub Calda Base #37 R$18,48/L + sabor; Pistache 44/L é o + caro), tarteletes, brigadeiros limão/maracujá, caseirinhos banana/milho, granola, cheesecake, pão de mel, geleias morango/frutas vermelhas, torta morango/smore, mini smore, 6 mini box. Correções de insumo extras: LEITE LEITISSIMO #16 e LEITE DE COCO #20 tinham fator/preço errados (corrigidos).

**Fase 2 — CMV → produtos_master (pra curva ABC, jun/2026):** atrelei as fichas a `produtos_master.produto_master_id` e populei `produtos_master.preco_custo` com o CMV real por unidade de venda. **Regras de conversão (a unidade de venda ≠ o lote da ficha):** (1) bolo no pote/bombom/mini/dressed/naked/vulcão/tortas/tarteletes = **1 receita = 1 produto** → preco_custo = custo_calculado da ficha; (2) **fatia** = custo/12 (torta rende 12 fatias de ~183g); (3) **gelato/sorbet = bola de 100g** → preco_custo = custo/(rendimento_L × 10); (4) **doce no pote / canjica / curau = 200ml** → recheio_custo/g × 200; (5) **mini caseirinho** = massa_custo/g × 117g; (6) **vulcão** = massa 600g + recheio 460g + topping; (7) **mini** = casquinha 12g choc51 + recheio (Pistache=18g brig+5g triturado; demais 25g). **DRESSED ≠ NAKED são produtos distintos mesmo no mesmo sabor (ex: Casadinho)** — montar os dois. Resultado: **25/26 produtos COM VENDA custeados**, 104 fichas atreladas. Recheios novos da Laura: Creme de Ninho, Creme de Avelã, Creme de Brigadeiro Low Carb, Creme de Cappuccino.

**Pendências (faltam receitas do CTO/Laura):** Mini Kinder, Docinho Misto, Brownie Bites, Mini Nozes (recheio); Box Mousse de Chocolate (composição, só tem peso 1,3kg/400g); Mini Box Pavê (gramatura mini); sabores de gelato sem ficha (Cajá, Cocada, Galak, Cupuaçu, Ice Blue, Tapioca, Goiaba, sorbet Morango/Amora, Caramelo Salgado, Choc Branco c/ FV/Crocante, Fior c/ brownie+ddl). NÃO precisam: overnight, bebidas/café, vegaball. Legados zerados a limpar: Coulis de Morango #33 (dup), Dressed Cake P/M/G #57/58/59 (placeholders).

Relacionado: [[project_fichas_tecnicas_construtor_verdade]], [[feedback_mini_vs_bombom_frutas]].
