---
name: project_lote_duplicacao_setnull_landmine
description: "Scanner travava entrada por \"lote morto\" — lotes duplicados + FK ON DELETE SET NULL orfanizam o id de lote congelado no QR"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1abe304f-0d47-4f5a-86cb-7830a180ffa9
---

Bug de produção (2026-05-26): dar entrada/saída no Scanner (`/scanner`, fila de processamento → botões Entradas/Saídas) travava alguns itens com `violates foreign key constraint movimentacoes_lote_id_fkey`.

**Causa-raiz (verificada com dado real):**
1. O QR congela o `id` do lote no momento da impressão (`qr_payload.l`).
2. `lotes` é duplicado em massa por código: `handleAddBatch` em `src/shared/ui/BatchList.tsx:144` faz `insert` de lote NOVO toda vez (sem find-or-create). Mesmo código (a data, ex. `L25052026`) vira dezenas de ids — `L14052026` tinha 53 ids.
3. Lotes duplicados são deletados (`src/components/logistica/BatchList.tsx:142`).
4. A FK `etiquetas_qr.lote_id` é `ON DELETE SET NULL` → ao deletar o lote, a LINHA da etiqueta tem `lote_id` zerado, mas o QR impresso continua apontando o id morto. → 1146 etiquetas com `lote_id` de linha NULL, 959 delas ainda com código+QR preenchidos.
5. `movimentacoes.lote_id` FK é NO ACTION → ao gravar o id morto, o banco rejeita → trava.
Os modais de Recebimento (`EntradaBipModal`, `RequisicaoChegadaModal`) NÃO travam porque usam o `lote_id` da LINHA da etiqueta (NULL/válido), não o do QR. Só o `Scanner.tsx` usava `data.lid` cru do QR.

**Frente A — FEITO (commit `f2c2c924` em stg):** migration `20260526120000_scanner_resolver_lote_vivo.sql`. Nova RPC `resolver_lote_etiqueta(uid)`: lote da linha se vivo → re-vincula por código+validade(+produto) → senão NULL (nunca devolve id inexistente). `bipar_lote_scanner` usa o resolver e marca `duplicado:true`. `Scanner.tsx`: avulsa adição/retirada também resolvem lote vivo; duplicado vira card âmbar "Já demos entrada". Prova: das 1146 órfãs, 0 resolvem para id inválido.

**Frente B — FEITO (commit `48a736aa` em stg):** migration `20260526143000_lote_idempotente_e_backfill.sql`. Descoberta: `lotes` NÃO tem duplicata real (cada produto+código é único); a divergência vinha de dois `BatchList` gerando formatos diferentes pro mesmo lote físico — `components/logistica/BatchList.tsx` usa `L{ddMMyyyy}` (9 chars), `shared/ui/BatchList.tsx` usava `L{ddMMyyyy}{HHmm}` (13 chars). RPC `find_or_create_lote` (normaliza 13→9, reaproveita existente) é o ponto único de criação; ambos BatchList passaram a usá-la. `deleteBatch` bloqueia remover lote com etiquetas. Backfill re-vinculou 308 das 1146 órfãs (838 sem lote vivo ficam só com código no texto). UNIQUE(produto_id, codigo) adicionada.

**Frente C — FEITO (2026-05-27, commit `8a1b7d88` em stg, migration `20260527130000`):** causa-raiz fechada de vez. (1) **FK hardening**: `movimentacoes_lote_id_fkey` NO ACTION → **SET NULL** (gravar id morto nunca mais dá `23503`; histórico sobrevive) e `estoque_lotes_lote_id_fkey` → **CASCADE**. (2) **Lote delete-free**: removida a exclusão de lote nos DOIS `BatchList` (`components/logistica` apagava `lotes`; `shared/ui` apagava `estoque_lotes` direto). Lote = identidade permanente; "remover" não existe mais — a caixa só se MOVE (entrada/saída). Verificado: das 908 etiquetas com `lote_id` NULL restantes, 0 re-vinculáveis (lotes deletados de vez), mas o SET NULL as neutralizou (bipar gera movimentação com lote_id=NULL, sem crash).

**Reset câmara fria fábrica (2026-05-27, data op, NÃO commit):** loja 1, setor `Câmara Fria`+`CÂMARA FRIA` (grafia duplicada no cadastro). DO block com `app.skip_lote_reconcile=1`: deletou 212 `estoque_lotes` (887 un), zerou 40 `estoque`, resetou 389 etiquetas (todas já `gerada`, re-bipáveis), 0 fantasma. **347 lotes preservados** (delete-free). Pronto pra re-bipar do zero.

**Resta (opcional, não-bloqueante):** 60 colisões históricas após normalizar; 16 produtos com SUM(estoque_lotes)>estoque (drift pré-existente, ~5274 un) — não reconciliados (CTO escolheu fechar o gap do trigger, não o reconcile pontual). Relacionado: [[project_etiquetas_qr_rastreabilidade]], [[project_estoque_lotes_reconcile_landmine]].
