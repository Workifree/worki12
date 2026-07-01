---
name: degust-sync-landmine-do-congelamento-de-dias-parciais-corrigida
description: degust-sync-sales congelava dias sincronizados no meio do dia pra sempre (Lago Sul 11× e Shopping 6× subnotificados) e descartava produto não mapeado; fix v23 + cron diário + reparo
metadata: 
  node_type: memory
  type: project
  originSessionId: fd7b2445-fbd1-48fa-9070-34ab2d82eb71
---

**Descoberta 2026-06-05 (pergunta inocente do Pedro "atualizado live?" → forense):**

**Landmine 1 — congelamento de dias parciais (CORRIGIDA, function v23, commit 126024cf):**
`degust-sync-sales` só buscava dias SEM cache (`missingDates = allDates.filter(!cachedSet)`). Dia
sincronizado no meio do dia (alguém abrindo a tela de vendas) ficava **congelado parcial pra sempre**.
Lago Sul: TODOS os dias congelados ~09h34-11h34; Shopping: ~12h23-12h46. Resultado: volume mapeado
real era **Lago Sul 101/dia (não 9!) e Shopping 163/dia (não 26!)** — 11× e 6× subnotificados.
Águas Claras estava limpa (backfill retroativo). Fix: parâmetro `forceRefresh` re-busca tudo no
range (upsert sobrescreve). **Reparo executado**: 56 dias × 3 lojas re-buscados da API.

**Landmine 2 — produto não mapeado era DESCARTADO no sync (CORRIGIDA):**
`.filter(sale => productMap[degust_codigo])` jogava fora venda de código novo sem mapeamento —
"zero códigos não mapeados" era ilusão (eram descartados, não inexistentes). Agora salva com
`produto_master_id null`; mapear depois + backfill recupera.

**Cron novo `degust_sync_diario` (07:30 UTC = 04:30 BRT):** re-sincroniza D-3..D-1 com force nas 3
lojas ANTES do motor minmax (05:05). Migration `20260605210000`. Auth = anon key no header (pública).

**Consequência — bolos no pote NÃO morreram em abril:** o PDV RECRIOU os botões como
"BOLO NO POTE * NOVO" + variantes "PROM" (códigos 624-633) + "ACIMA DE 3 UNIDADE" (634, genérico).
Os códigos novos não tinham mapeamento → vendas descartadas → "morte" aparente. Mapeei 8 códigos
(624/629→1036 Banoffee, 626/630→1037 Brownie, 627/632→1039 Cenoura [Degust tem typo CEMOURA],
625/631→1038 Pistache) + backfill de 638 linhas. **Decisões do Pedro (2026-06-05):**
- ✅ Chocolate VENDE (era só dado desatualizado) — mapeei 628/633→1035, backfill feito, 1035 voltou
  ao escopo do motor (45 pares, 15 produtos × 3 lojas, 100% histórico).
- ❌ **KITs: Pedro NÃO pediu, esquecer** — 387 "CHOC C/BRIG KIT" fica mapeado como está (1040
  inativo), não mexer sem novo pedido.
- 634 "ACIMA DE 3 UNIDADE" (desconto por quantidade, sem sabor) — fica sem mapeamento, vendas agora
  são guardadas com produto_master_id null (recuperável se um dia decidir atribuir).

**Regra aprendida:** integração de PDV em cache precisa de (a) janela de re-sync forçado pra dias
recentes, (b) NUNCA descartar venda não mapeada, (c) monitorar códigos novos sem mapeamento (PDV
recria botões sem avisar). Ver [[project_minmax_estoque_metodologia]] e
[[feedback_thorough_forensics]].
