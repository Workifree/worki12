---
name: Torre de Controle ≠ Requisição (flows independentes)
description: Requisição é pedido isolado; TdC é supply chain ponta-a-ponta — features podem criar requisições sem disparar expedição
type: project
originSessionId: 3244567b-5f09-4631-b3aa-8f25baf0b353
---
**Requisição** = pedido isolado de uma loja. Estados: aberta para separação → em separação → finalizada. Vive em `/logistica`.

**Torre de Controle** = visão ponta-a-ponta do supply chain: separação → expedição → trânsito → conferência na loja. Agrupa N requisições numa expedição, mas existe independente da requisição.

**Why:** misturar os dois (ex: "criar uma requisição inicia uma expedição automaticamente") acopla flows que precisam ficar separados — o usuário pode querer só gerar requisições e parar (deixá-las em `/logistica`), ou só expedir requisições já existentes, sem ter que recriá-las.

**How to apply:** features novas em TdC (ex: DRP/Plano de Reposição) **podem CRIAR requisições** mas a expedição é passo opcional separado. DRP fica como aba landing em TdC, não dentro de uma expedição. "Gerar Requisições" e "Iniciar Expedição" são CTAs distintos com modal de bifurcação entre eles.
