---
name: project_estoque_lotes_reconcile_landmine
description: Trigger sync_estoque_from_lotes corrompe estoque ao forçar estoque=SUM(lotes); guard app.skip_lote_reconcile aplicado só p/ bip
metadata: 
  node_type: memory
  type: project
  originSessionId: 343b92e8-1eea-4456-8338-458665043851
---

Estoque tem DOIS caminhos conflitantes de atualização que brigam pelo `estoque.quantidade_atual`:
1. **Movimentações** (`atualizar_estoque_e_alertas`, trigger AFTER INSERT em `movimentacoes`) → seta `estoque = quantidade_nova`. É o modelo simples/correto (bip e contagem).
2. **Reconciliador** `sync_estoque_from_lotes` (trigger AFTER INS/UPD/DEL em `estoque_lotes`) → força `estoque = SUM(estoque_lotes)` criando uma movimentação `motivo='sync_lote_auto'`.

**O bug (25/05/2026, contagem por bipagem na Fábrica/loja 1):** cada caixa bipada (`scanner_lote`) dispara `tg_movimentacoes_sync_estoque_lotes` (atualiza `estoque_lotes`), que cascateia em `sync_estoque_from_lotes`. Como `estoque` ainda não tinha sido atualizado pela própria movimentação (ordem alfabética dos triggers: o reconciliador roda ANTES do `trigger_atualizar_estoque`), ele via diferença e criava lançamento `sync_lote_auto` fantasma → **dobrava entradas dos minis** (saldo salvou por last-write-wins, mas histórico virou lixo: +15.120 fantasma) e **destruía avulso sem lote** (FATIA CHOCOMELO: saídas-fantasma de 13; BOLO POTE BROWNIE zerado por saída-fantasma de 528). O modelo de negócio TEM avulso sem lote, então `estoque=SUM(lotes)` é uma invariante FALSA.

**Fix aplicado** (migration `20260525190955_fix_sync_lote_auto_phantom_movimentacoes`): flag transacional `app.skip_lote_reconcile`. `tg_movimentacoes_sync_estoque_lotes` faz `set_config('app.skip_lote_reconcile','1',true)` antes de tocar `estoque_lotes`; `sync_estoque_from_lotes` retorna cedo se a flag='1'. Resultado: bip não cria mais fantasma; edições diretas de lote (não setam flag) seguem reconciliando como antes.

**Why:** a reconciliação automática assumia regra que o negócio não tem (estoque=soma dos lotes), apagando estoque avulso legítimo da contagem manual.

**Fixes seguintes (mesmo dia, contagem por bip):**
- **Performance**: RPC `bipar_lote_scanner(p_loja_id,p_tipo,p_itens jsonb)` processa o lote inteiro numa transação (antes ~3 round-trips/caixa no front → 283 caixas levavam 4-5 min). Frontend `Scanner.tsx` `processBatch` chama 1× e mapeia `resultados` por `id`.
- **usuario_id**: bip antes deixava `movimentacoes.usuario_id` NULL (perfil vazio na lista). RPC preenche via `get_usuario_id_from_auth(auth.uid())` — CUIDADO: essa função tem 2 overloads (`()` e `(uuid)`); chamar sem arg dá "function is not unique" (quebrou em prod). Sempre passar `auth.uid()`. Chamada dentro de try → NULL nunca derruba a entrada.
- **qty autoritativa**: RPC usa `COALESCE(NULLIF(etiqueta.quantidade_disponivel,0), NULLIF(quantidade_interna,0), qty_front)` — garante +40 (conteúdo real da caixa), não +1.
- **estoque_lotes por loja**: `tg_movimentacoes_sync_estoque_lotes` agora chaveia por `(lote,produto,LOJA)` (antes ignorava loja_id → linhas com loja_id NULL co-misturando lojas, lote invisível na visão por loja). PK de estoque_lotes é só `id` (sem unique em lote+produto+loja).
- **bipagem idempotente**: RPC respeita `ok=false` de `bipar_etiqueta` (bip duplicado) → não relança, devolve "já contada". Antes re-bipar a mesma etiqueta dobrava a contagem.
- Migrations: `20260525110000` (guarda), `20260525120000` (RPC), `20260525130000` (lote por loja + idempotência). Commits locais na stg, **não pushados** (CTO decide deploy). Vercel deploya frontend no push pra stg.

**Regra de negócio (CTO):** contagem de estoque por bip = SÓ no Scanner (Produtos). **Picking = separação, NÃO movimenta estoque/contagem.** Conferência = etapa final de receber uma requisição (entrada). Saída real da Fábrica numa transferência vem de bip de saída/expedição, não do picking.

**Picking FECHADO (26/05, commit f2df79ce em stg):** `finalizarPicking` baixava estoque indevidamente (decrementava estoque_lotes + estoque + log em `movimentacoes_estoque` legada) e gerava `sync_lote_auto` fantasma. Bloco removido — picking só atualiza status + Torre de Controle.

**RESOLUÇÃO do risco residual (2026-05-27, commits `8a1b7d88` + `d9883e7d` em stg, migrations `20260527131000`/`20260527132000`):** o double-path foi eliminado. Nova RPC `ajustar_lote_contagem(p_lote_id,p_produto_master_id,p_loja_id,p_delta,p_motivo)` é o ponto único: trava `estoque` (FOR UPDATE), calcula delta, insere UMA movimentação (`motivo='contagem_caixa'`) e deixa os triggers sincronizarem — **nenhum** `UPDATE estoque_lotes` direto. `Produtos.page.tsx` (commitChange ramo-lote) e `shared/ui/BatchList.tsx` (processBatchUpdate) agora chamam a RPC; `lote_id` sempre vivo ou NULL. O `tg_movimentacoes_sync_estoque_lotes` passou a reconhecer também `contagem_caixa`, `ajuste_lote_manual`, `saida_inteira`, `retirada_avulsa`, `adicao_avulsa` (antes só `scanner_lote` — saída do scanner NÃO baixava estoque_lotes → drift; verificado: nenhum desses fluxos faz UPDATE direto → sem dupla contagem). UI de contagem filtra `quantidade>0` (caixa vazia some).

**How to apply:**
- Risco residual do double-path: **RESOLVIDO** (ver acima). Todo ajuste de lote/caixa na contagem flui por movimentação.
- `update_estoque_quantity_from_lotes` existe mas está SEM trigger plugado (código morto).
- Limpeza pendente: ~279 linhas `sync_lote_auto` fantasma na loja 1 (não afetam saldo, poluem auditoria). BOLO POTE BROWNIE (pid 1037, loja 1) ficou em 0 por causa de saída-fantasma; em 25/05 foi bipado e está em 12 (lote L25052026 reconciliado p/ loja 1). 1 linha estoque_lotes com loja_id NULL ainda pendente de revisão.
- Relaciona-se com [[project_etiquetas_qr_rastreabilidade]] e [[feedback_thorough_forensics]].
