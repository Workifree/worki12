---
name: Momma é loja de doces saudáveis (não padaria), validade uniforme 5d
description: Modelo de negócio Momma + shelf-life 5 dias para todos os produtos no DRP — restrição dura em cálculos de distribuição
type: project
originSessionId: 3244567b-5f09-4631-b3aa-8f25baf0b353
---
Momma é **loja de doces saudáveis**. NÃO é padaria.

Produtos: fatias de bolo, tortas, bombons de frutas, sobremesas individuais. Validade: **considerar uniforme 5 dias** em DRP/forecast (decisão CTO 2026-05-04, simplificação V1 — não modelar exceções por produto).

**Why:** confundi com padaria numa proposta de DRP, que tem premissas opostas (padaria estoca, doces frescos não). Erro material — algoritmo errado superproduz/superenvia e gera perda. CTO definiu shelf-life uniforme 5d pra simplificar V1.

**How to apply:** em DRP/forecast aplicar cap por shelf-life **5d** como restrição implícita: bloqueia/avisa quando horizonte de planejamento > 5d. Nunca propor "estoque de 2 semanas". Não criar coluna `shelf_life_days` em `produtos_master` por enquanto — constante no código basta. Pack size também ignorado em V1 (operador converte unidades→caixas mentalmente; QR code etiqueta tem o dado mas DRP não usa ainda).
