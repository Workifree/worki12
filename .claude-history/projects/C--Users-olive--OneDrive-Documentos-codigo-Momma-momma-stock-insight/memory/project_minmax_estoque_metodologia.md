---
name: min-max-de-estoque-por-demanda-perec-vel-3x-semana
description: "Metodologia world-class para calcular mínimo/máximo de estoque por produto×loja com base na venda real do Degust; modelo newsvendor, reposição seg/qua/sex"
metadata: 
  node_type: memory
  type: project
  originSessionId: fd7b2445-fbd1-48fa-9070-34ab2d82eb71
---

Projeto pra calcular automaticamente min/max de estoque por **produto × loja** a partir da venda
real puxada do Degust. Spec completa em `.harness/spec/min-max-estoque/spec.md`. Documento executivo
pra enviar em `docs/estrategia/logica-min-max-estoque.md`.

**ESCOPO (Pedro foi enfático — não esquecer):** NÃO é cálculo de requisição/quanto enviar — isso já é
feito pelo agente **repa** (`requisicao-automatica-ia`). Esta feature entrega o **min-max gravado nas
lojas**, cujo propósito é **a fábrica receber aviso ANTECIPADO** (via `alertas_estoque`) de que a loja
está chegando no limite, antes de faltar. É a camada de **alerta/visibilidade**, complementar ao repa.

**Fatos operacionais não óbvios (não estão no código), confirmados 2026-06-05:**
- Requisição/viagem vai **3x por semana: segunda, quarta e sexta** — todas as 6 lojas, calendário igual.
- **Lead time = mesmo dia:** sai de manhã, loja vende à tarde o que chegou de manhã.
- **Lojas abrem 7 dias (seg→dom), vendem sempre.**
- **Janelas não-uniformes:** seg cobre seg+ter (2d), qua cobre qua+qui (2d), **sex cobre sex+sáb+dom
  (3d) — a crítica, pois inclui o pico de sábado.** Um "mínimo fixo por dia" rompe toda sexta.

**Decisões tomadas pelo Pedro (2026-06-05):**
- Modelo: inventário **perecível = Newsvendor**, NÃO EOQ. Trava de shelf-life (`produtos_master.dias_validade`) é inviolável.
- Nível de serviço **por classe ABC**: A=99% (Z=2,33), B=95% (Z=1,65), C=90% (Z=1,28).
- Gravar nos campos **existentes** `estoque.quantidade_minima` / `quantidade_maxima` (já disparam `alertas_estoque`).
  - **CORRIGIDO 2026-06-05 (Pedro pegou mín=máx na sexta — janelas coincidem):**
  - `quantidade_minima` = **demanda PURA até a próxima viagem** (SEM margem) = "abaixo disso VAI faltar no ritmo normal". Janela dinâmica por dow.
  - `quantidade_maxima` = **nível cheio** = demanda do fds + `Z·σ·√3` (a margem mora SÓ no máx), travado por validade; `máx ≥ mín+1` (banda nunca-zero p/ σ≈0).
  - **A banda mín→máx É o estoque de segurança.** NUNCA pôr a margem nos dois lados — colapsa na sexta. Migration patch `motor_minmax_banda_min_max` + commit 5f0c7a2f.
- Entregável atual: **doc/spec primeiro**, validar antes de codar.

**Fundação que já existe (reusar):** RPC `get_scientific_metrics` (média sazonal por dia da semana,
volatilidade, tendência, safety_stock), `historico_vendas` com `dia_semana`, ABC em
`stock-calculations.ts`, `requisicao-automatica-ia`, DRP `drp_gerar_requisicoes`, `degust_vendas_diarias`.

**FÓRMULA FECHADA (2026-06-05), por dia da semana — NUNCA média comum:**
- `m(dia)` = média da venda DAQUELE dia da semana (seg×seg, sáb×sáb…), últimas 8 semanas.
- `minimo(D) = Σ m(dias até a próxima viagem) + Z·σ·√n` (dinâmico, recalc diário; pico = manhã de sábado, cobre sáb+dom).
- `maximo = m(sex)+m(sáb)+m(dom) + Z·σ·√3` (cheio de sexta, travado por validade).
- Z: A=2,33 / B=1,65 / C=1,28. σ = desvio-padrão diário global.

**COBERTURA TOTAL (2026-06-05 noite):** TODAS as 5 lojas têm Degust! **Asa Sul (2, Degust cód 4)
entrou em 30/abr** e **Asa Norte (3, cód 5) em 26/mai** — Pedro atualizou o token e elas apareceram;
backfill puxou tudo que a API tem. Volumes mapeados/dia REAIS (pós-reparo do congelamento):
**Asa Sul 230 (a maior!), Shopping 163, Águas Claras 125, Lago Sul 101, Asa Norte 144.**
Motor cobre **75 pares (15 produtos × 5 lojas)**: 60 histórico + 15 proxy (Asa Norte, 11 dias <21 →
proxy de rede, vira histórico sozinho com o tempo). Cron de sync é dinâmico sobre `degust_stores`
(commit do cron: ver landmine). Bombom morango Asa Sul: mín 103/máx 152 (o "25" da intuição original
era 4-6× menor que o fds real); na noite de 05/06 estava em RUPTURA (estoque 0).

**Validação real (Águas Claras, bombom de morango):** perfil seg 5,9 / sáb 24,0 (4×!) → min ~67 (fds)
/ max ~86. Confirma que média comum quebraria. Próximo passo: motor read-only (RPC/view) gerando
min/max dos ~70 produtos das 3 lojas antes de gravar em `estoque` e ligar alertas.

**TESTE EM PRODUÇÃO (2026-06-05):** 37 pares (produto×loja) gravados em `estoque.quantidade_minima/maxima`
via UPDATE direto — produtos escolhidos pelo Pedro: bombons morango (1028) e uva (1029), doces no pote
(1031/1341/1342), 5 fatias (1047-1051), bolos no pote ativos com venda (1036/1037/1038/1039). Ex.: bombom
morango Águas Claras mín 78 / máx 100. Frontend: commit `ac3e253e` em stg adiciona badge "Mín", campo
"Quantidade Mínima" e badge vermelho "Abaixo do mínimo" na Produtos.page (modo Gerenciar) — precisa
deploy pra aparecer em produção.

**LANDMINE descoberta:** ao calcular demanda de `degust_vendas_diarias` SEMPRE aplicar
`degust_product_mapping.qty_multiplier` (join por degust_codigo) — "BOMBOM CAIXA 5 UND" = 5 un (mudou o
mín do bombom AC de 67→78). Bolos no pote no cadastro se chamam "BOLO POTE *" (sem "no"). Bolo Pote
Chocolate (1035) não tem venda Degust = cold-start; Bolo Pote Morango (1040) e Prestígio (1034) estão
INATIVOS (não tocar). Save da Produtos.page tinha `quantidade_minima || 5` que corrompia mín 0 — corrigido
pra `?? 0` no mesmo commit.

**MOTOR NO AR (2026-06-05, migration 20260605200000 + commit 8dc3e2e9):** função
`recalcular_minmax_estoque()` + pg_cron `minmax_recalculo_diario` diário 05:05 BRT. Escopo =
tabela `minmax_escopo_produtos` (15 produtos; adicionar produto lá = motor cobre). Log em
`minmax_execucoes`. Implementa: janela dinâmica por dow (em dia de viagem mín=máx POR DESIGN —
sexta abaixo do enchimento de fds = aviso na hora de carregar o caminhão; prova: bombom AC ter=44
/ sex=105), demanda censurada (dia `sem_estoque` em alertas_estoque assume ≥ média limpa do dow),
cold-start proxy de rede (<21d calendário ou <3d com venda → perfil do produto nas lojas confiáveis
× porte; σ=√μ Poisson; sem venda em loja nenhuma = sem_dados, não inventa), qty_multiplier, trava
validade. Pares sem_dados mantêm valor manual (motor não toca) — lixo legado 5/100 do Bolo Chocolate
foi limpo manualmente (0/1). Validades preenchidas: fatias/bombons 3d, bolos no pote 5d (só ativos).

**Bolo Pote Chocolate (1035) VENDE** — a "morte" era dado desatualizado (ver
[[project_degust_sync_congelamento_landmine]]): PDV recriou o botão como "CHOCOLATE C/BRIG NOVO"
(628/633, ~280un/8sem) sem mapeamento. Pedro confirmou 2026-06-05 "então vende": mapeado→1035,
backfill feito, **de volta ao escopo do motor**. KITs (387 etc.): Pedro não pediu, esquecer.

**BOLOS NO POTE — achado de forense (2026-06-05):** os AVULSOS (Pistache/Morango/Banoffee/Cenoura/
Brownie) pararam de vender em ~12-20/abril nas 3 lojas Degust ao mesmo tempo; **só os KITs continuam**
(volume baixo, ~1-2/dia em AC). Brasília Shopping: zero bolos desde 20/abr. NÃO existe botão genérico
"bolo no pote" sem sabor no PDV (hipótese do Pedro descartada). Banoffee vendia ~4/dia em AC até
18/abr e morreu — Pedro vai confirmar se saiu do cardápio ou se é ruptura; AC tem 16 un "em estoque"
no sistema sem venda há 7 semanas (possível estoque fantasma). Melhoria proposta: detecção de
"produto adormecido" no motor (vendia forte → zerou → flag pra revisão humana).

**FÁBRICA FICA FORA do min/max de loja (Pedro, 2026-06-05):** lógica é DIFERENTE — mínimo da fábrica
deve considerar a demanda agregada DAS LOJAS (sai da fábrica pras lojas, como a página de produção),
e lá as coisas ficam CONGELADAS (validades diferentes). Deixar quieto por enquanto; UI esconde
Mín/alerta quando storeId=1. Não aplicar o motor de loja na fábrica.

**Modo Consulta em Produtos (commit 9611cb22):** 3º modo no switcher (Contagem | Consulta | Gerenciar,
desktop e mobile) — tabela só-leitura agrupada por setor (Produto | Estoque | Mín | Máx | Situação
OK/Abaixo do mínimo/Sem estoque), substitui a lista impressa/PDF pra consulta de estoque sem
interferir na tela de quem opera. Na fábrica a tabela mostra só Produto+Estoque.

**Pendências (v2):** calendário de viagens parametrizável (hardcoded seg/qua/sex na função), XYZ,
UI de override/auditoria, tela de alertas de estoque baixo, Z reduzido no fds p/ validade 3d
(newsvendor), lógica própria da fábrica (demanda das lojas + congelados), deploy do front
(commits ac3e253e + 9611cb22 ainda não deployados).

Ver [[feedback_thorough_forensics]] e [[project_momma_business_validade]] (validade 3-5d é cap obrigatório).
