---
name: project_saida_estoque_requisicao
description: "Finalizar requisição agora dá baixa de estoque por etiqueta bipada, atribuída a quem separou"
metadata: 
  node_type: memory
  type: project
  originSessionId: 98ee8ed3-91df-43d9-a376-a2012cc0f904
---

Feature (2026-06-15, stg): ao **finalizar a requisição** na `PaginaPicking` (`finalizarPicking`, rota `/separacao/:requisicaoId`), dispara a RPC `dar_saida_requisicao(p_requisicao_id)` que gera **1 movimentação de saída por etiqueta QR bipada** daquela requisição (`motivo='saida_requisicao'`), debitando a loja que separou (`etiqueta.loja_atual_id` = fábrica), por lote, **atribuída a quem BIPOU cada etiqueta** (`etiquetas_qr.separada_por`, não quem finalizou). Migration `supabase/migrations/20260615153000_saida_estoque_requisicao.sql`.

Pontos-chave:
- Ponte requisição↔etiquetas = `etiquetas_qr_eventos.referencia_id` (carimbado pelo `PickingBipModal` no bip), recuperada via `DISTINCT ON (etiqueta_uid) ORDER BY created_at DESC` — exclui etiquetas reseparadas para outra req. Ver [[project_etiquetas_qr_rastreabilidade]].
- Idempotente: `EXISTS` por-etiqueta + índice único parcial `uq_movimentacoes_saida_requisicao_etiqueta` + handler `unique_violation`; carimbo `requisicoes.saida_estoque_at/_por` só no 1º disparo.
- Cálculo de saldo SEQUENCIAL (re-lê `estoque` por etiqueta) por causa do trigger set-absoluto `atualizar_estoque_e_alertas`; motivo `saida_requisicao` adicionado ao whitelist de `tg_movimentacoes_sync_estoque_lotes` (preserva guard `app.skip_lote_reconcile` — ver [[project_estoque_lotes_reconcile_landmine]]). Saldo insuficiente → zera + alerta (Article 6).
- Etiqueta transiciona `separada/gerada → em_transito` na saída; recebimento (`bipar_etiqueta('entrada')`) aceita `em_transito`.
- UI: badge "Saída Requisição" + filtro por operador em `Movimentacoes.page.tsx`; `SaidaRequisicaoResumoDialog` (quem separou o quê) abre após finalizar.
- **Migration APLICADA no banco vivo em 2026-06-15** via MCP apply_migration (name `saida_estoque_requisicao`) + verificada (RPC/colunas/índices/whitelist OK). **Frontend ainda NÃO deployado** (mudanças em stg, não commitadas/pushadas) → RPC fica dormente até o deploy Vercel. Front usa `(supabase.rpc as any)` até regenerar tipos. Deploy de frontend é decisão do CTO ([[feedback_prod_deploy_explicit_only]]).
- **Desconexão digital×bip (fix 2026-06-17, stg):** a separação digital (checkbox `coletado`/`quantidade_enviada`/lote em `requisicoes_itens`) NÃO cria etiqueta nem move estoque — só o bip QR move. Item marcado sem bipar aparece "separado" e nunca dá baixa (silencioso). Caso real req 742: 22 marcados, 14 bipados → só 14 saídas. Fix: `finalizarPicking` virou 2 handlers — **"Finalizar"** (`finalizarSemSaida`, só status, zero baixa) e **"Finalizar e dar saída"** (`finalizarComSaida` → `executarFinalizacaoComSaida` = lógica original). `finalizarComSaida` roda `detectarNaoBipados()` e, se houver itens marcados sem bip, abre AlertDialog ("Voltar e bipar"/"Dar saída só dos bipados") — NÃO baixa às cegas. `SaidaRequisicaoResumoDialog` ganhou `max-h-[90vh]`+scroll (estava cortando). Testes em `PaginaPicking.finalizar.test.tsx` (5/5).
- **`embalagens.quantidade_interna` é NÃO-confiável** p/ conversão caixa→unidade (ex.: TARTELETE cadastro=84 vs etiqueta real=4) — nunca usar p/ baixa automática; quantidade real vem da etiqueta bipada (`etiquetas_qr.quantidade_interna`). Por isso a baixa de não-bipados NÃO foi automatizada.
- Correção retroativa 742 (2026-06-17): lançada saída de BOLO POTE CENOURA (1 cx=12 un, lote FEFO) via `INSERT...SELECT` lendo saldo atomicamente (trigger é set-absoluto — hardcodar saldo corromperia estoque). Bombons morango/uva tinham estoque 0 → sem baixa.
