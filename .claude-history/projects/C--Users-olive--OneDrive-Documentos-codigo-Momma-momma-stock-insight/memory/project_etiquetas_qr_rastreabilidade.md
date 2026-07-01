---
name: Etiquetas QR — rastreabilidade fim-a-fim por UID
description: Sistema de identidade física rastreada por etiqueta QR (Momma). Source of truth de cada caixa do berço ao consumo via tabela etiquetas_qr + RPC bipar_etiqueta.
type: project
originSessionId: c8b1fac3-0347-4b22-b83b-3a0f5d6339c4
---
Sistema de rastreabilidade fim-a-fim por UID de etiqueta QR — cada etiqueta impressa vira uma entidade rastreada no banco. Mesma UID atravessa geração → separação → conferência → trânsito → recebimento.

**Why:** Política nova do CTO (2026-05-04): bip em TUDO de estoque/logística, etiqueta QR em todas as caixas, sistema sabe onde cada caixa está em todas as etapas. Substitui rastreio manual.

**How to apply:** Quando mexer em qualquer fluxo de logística/estoque que envolva caixas físicas (separação, conferência, entrada, saída, transferência), passar pela RPC `bipar_etiqueta` em vez de criar lógica nova de validação. A tabela `etiquetas_qr` é o source of truth.

## Schema (PR1 — 2026-05-04, stg ac279aa)

- `etiquetas_qr` (PK `uid` text): produto/lote/embalagem/qty/snapshots + status enum (gerada|em_separacao|separada|conferida|em_transito|recebida|consumida|descartada) + loja_origem_id/loja_atual_id + replaces_uid/replaced_by_uid + backfilled + qr_payload (JSON original)
- `etiquetas_qr_eventos` (append-only): timeline com tipo_evento, etapa, status_anterior/novo, loja, usuário, referencia (active_session/requisicao/movimentacao/nf), metadata jsonb
- View `view_etiqueta_timeline`: JOIN pronto pro frontend com eventos agregados como jsonb_agg

## RPCs

- `bipar_etiqueta(uid, etapa, contexto)` — ponto único de validação. Etapa: separacao|conferencia|entrada|saida|consumo|descarte. Faz: backfill automático se UID desconhecida + payload presente, máquina de transição de status, dedupe (mesmo bip 2x = erro), alerta lote vencido. Retorna `{ok, etiqueta, status_anterior, status_novo, alertas, backfilled, erro}`.
- `reposicao_etiqueta(uid_antiga, uid_nova)` — clona dados físicos, marca antiga como descartada com replaced_by_uid, nova com replaces_uid. Mantém audit trail.

## Pontos de integração

- **`src/pages/LabelPrinting.tsx:291`** — `handlePrint` async; INSERT batch em `etiquetas_qr` antes do PDF (snapshots produto/lote/validade/embalagem/qty + qr_payload). Falha = abort sem etiqueta órfã. Apenas `labelType==='produto'` toca a tabela.
- **`src/pages/EtiquetaTimeline.tsx`** + rota `/etiquetas/:uid` — header com dados + timeline visual. Lê de `view_etiqueta_timeline`.

## Decisão de arquitetura — PC vs Tablet (2026-05-06)

**PC = Bluetooth/USB scanner. Tablet Android = Câmera.** Não tentar usar
scanner USB no tablet — Chrome Android tem [bug WontFix de keydown](https://bugs.chromium.org/p/chromium/issues/detail?id=118639)
que perde chars em rate alto, corrompendo QR de payloads grandes. Tentamos:
keydown global + scancode físico + parser permissivo em 8 camadas + lookup
reverso por pid+lote — todas parciais. WebHID resolveria mas precisa HTTPS
(CTO recusou).

Solução final: detectar device via `navigator.userAgent` (regex
`/Android|iPad|iPhone|Mobile|Tablet/i`) e setar `initialMode` automaticamente.
Operador pode trocar manualmente, mas o default é o que funciona pro device.

## Status atual

Ciclo fim-a-fim completo (PR1 + PR2 + PR3 todos em prod stg):

- ✅ PR1 fundação — migration `20260504000000_create_etiquetas_qr.sql` (commit `ac279aa`)
- ✅ PR2 separação por bip — migration `20260504010000_add_bip_to_separation_and_movements.sql` (commit `5d94c11`); active_session_items.qr_uid_bipado/bipado_at/bipado_por; hook `useEtiquetaScanner`; modal `SeparacaoBipModal`; rota `/logistica/separacao-bip/:sessionId`
- ✅ PR3 recebimento por bip — mesma migration; movimentacoes.etiqueta_qr_uid (FK); trigger `trg_movimentacoes_link_etiqueta` atualiza etiquetas_qr.ultima_movimentacao_id; modal `EntradaBipModal`; rota `/logistica/recebimento`; botão "Receber por bip" em Logistica.page
- ✅ PR4 conferência amarrada (commit `6a7af85`) — `RequisicaoConferenciaModal.handleDarSaida` chama `bipar_etiqueta(uid,'saida')` por caixa, INSERT movimentação 1:1 com etiqueta_qr_uid quando há UID. Backward compat: caixas sem UID seguem agrupadas.
- ✅ PR5 FAB Separar com bip — botão flutuante em `Requisicao.page` aparece quando há sessão ativa (isSessionMode + currentSessionId), navega pra `/logistica/separacao-bip/:sessionId`.
- ✅ PR7 Bip nativo em PaginaPicking (commit `9c29dff`) — botão "Bipar" na toolbar da Lista de Separação (rota `/separacao/:requisicaoId`), abre `PickingBipModal` que reusa `updateItemEnviada` + RPC `bipar_etiqueta(separacao)`. Soma quantidade da embalagem em `requisicoes_itens.quantidade_enviada`, alimenta `selectedBatches` automaticamente do lote do QR. Removido `/logistica/recebimento` (duplicado — recebimento agora vive em StoreExpeditionTracker).
- ✅ PR8 Câmera robusta no celular (commit `e6193e4`) — pré-checagem isSecureContext + getUserMedia, retry DOM, fallback de facingMode, `describeCameraError` em pt-BR, overlay `CameraScannerStatus` com botão "Tentar de novo".
- ✅ PR9 Backfill aceita chaves longas + cooldown câmera (commit `36b9a83`) — RPC `bipar_etiqueta` lê COALESCE(`pid`,`p`) etc; `useEtiquetaScanner` ignora silenciosamente leituras idênticas em 1500ms.
- ✅ PR10 Conferência via RPC + PR11 Recebimento na loja amarrado + PR12 Scanner avulso unificado + PR13 Modo padrão por loja (commit `6500b88`) — RequisicaoConferenciaModal.handleScan agora chama `bipar_etiqueta(conferencia)`; StoreExpeditionTracker.handleScan detecta QR estruturado e aciona RPC `entrada` + INSERT movimentação com `etiqueta_qr_uid`; Scanner.tsx (rota `/scanner`) chama RPC `entrada/saida` + corrige coluna; modo padrão = Bluetooth se `selectedStore.id===1` (Fábrica), senão Câmera.

E2E validado em prod: ciclo gerada→separada→conferida→em_transito→recebida com 5 eventos + 2 movimentações vinculadas. Status final loja_atual_id muda corretamente para a loja destino.

## Decisões importantes (não esquecer em PR2/PR3)

1. **Backfill ao bipar UID antiga:** RPC cria row retroativa com loja_origem=NULL e backfilled=true. Usuário não bloqueia.
2. **Não subdividir caixa:** etiqueta = caixa inteira. Consumo unitário continua em `estoque` separado.
3. **Reposição:** SEMPRE nova UID com replaces_uid apontando pra antiga (audit trail intacto). Nunca reimprimir mesma UID.
4. **Snapshots ficam congelados:** mudança em produtos_master/lotes não afeta etiqueta histórica (defensivo).
5. **RLS:** SELECT autenticado, INSERT autenticado (impressão), UPDATE/DELETE bloqueados — única via é via RPC SECURITY DEFINER.

## Não confundir

- `etiquetas_qr` (NOVA) ≠ `lotes` (existente, lote físico de produção/recebimento)
- UID gerado em LabelPrinting usa `crypto.randomUUID().split('-')[0]` (8 chars) — não confundir com `lotes.id` (UUID completo)
- QR codifica via hex (`encodeHex`) por causa de teclado ABNT2 vs US — pattern já existente em `RequisicaoConferenciaModal`
