---
name: project_cuba_gelato_1a1
description: "Produtos unitários (cuba, naked, vulcão, dressed) contam sempre 1:1 no scanner; trigger no banco força quantidade=1"
metadata: 
  node_type: memory
  type: project
  originSessionId: a0221c8c-e5e4-4627-ab92-9ccc444319b5
---

Famílias **unitárias** (1 caixa = 1 item) contam **1 por etiqueta**, nunca caixa de N: **cuba** de gelato, **naked**, **vulcão**, **dressed** (bolos/tortas). Match por nome: `lower(unaccent(nome)) ~ '\m(cuba|naked|vulcao|dressed)\M'` (unaccent p/ casar "vulcão"; está no schema public). Vale em qualquer loja/setor.

**Trava (ponto único = coluna de etiquetas_qr que TODOS os fluxos de entrada/contagem leem: bipar_etiqueta, bipar_lote_scanner, Scanner.tsx, EntradaBipModal):** trigger `trg_enforce_produto_unitario` BEFORE INSERT/UPDATE → função `enforce_produto_unitario_etiqueta()` força `quantidade_interna=1`, `tipo_embalagem='unidade'`, `embalagem_nome='un'`, `quantidade_disponivel=LEAST(coalesce(...,1),1)`. NÃO mexi em RPCs nem na geração (`LabelPrinting`). **Para nova categoria: só adicionar a palavra na alternância do regex.** Migrations: `20260604143910` (cuba) → `20260604145552` (+naked, renomeia enforce_cuba→enforce_produto_unitario) → `20260604164527` (+vulcao+dressed, +unaccent).

**Por quê:** itens etiquetados como caixa (qtd 2/8/12/34/40...) inflavam o estoque ao bipar.

**Correções de dados 2026-06-04 (só fábrica/loja 1):**
- **Cubas** = RESET (iam rebipar fisicamente os mesmos QR): zerei estoque/estoque_lotes + 1475 etiquetas → `status='gerada'` + 1:1. Backup `bkp_reset_cubas_fabrica_20260604_*`.
- **Nakeds** (65→14) e **vulcão+dressed** (716→71) = só ACERTO de contagem, SEM reset/rebipar: normalizei etiquetas p/ 1:1 (status intacto) e recalculei estoque/estoque_lotes = nº de etiquetas `recebida` por (produto,lote). Lojas 2-4 intactas (sem etiqueta dessas famílias, não infladas). Backups `bkp_fix_naked_fabrica_20260604_*` e `bkp_fix_vulcao_dressed_fabrica_20260604_*`.

Padrão de acerto: tudo em DO block com guard `app.skip_lote_reconcile='1'` transaction-local (ver [[project_estoque_lotes_reconcile_landmine]]). Detalhe técnico: `UPDATE...FROM` não deixa referenciar a tabela-alvo no JOIN — usei subquery correlacionada. Relacionado: [[project_etiquetas_qr_rastreabilidade]], [[project_scanner_recontagem_idempotencia]].
