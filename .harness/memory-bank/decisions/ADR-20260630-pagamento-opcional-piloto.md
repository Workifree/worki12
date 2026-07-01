# ADR-20260630 — Pagamento pelo Worki é OPCIONAL no piloto (controle+dado > trilho financeiro)

## Status
ACEITO — 2026-06-30 (architect, gate de contrato de pagamento). Formaliza decisão do owner (jun/2026).
**SUPERA parcialmente** o `ADR-20260622-pagamento-postpago.md` (postpago/hold obrigatório via cartão) e os
requisitos R4/R7/R9 do spec, que passam de **obrigatórios** a **opção de conveniência**. NÃO revoga o
postpago: ele fica preservado como caminho opt-in e como base da fase de expansão (reabrível por gate).
Toca **ponto sensível** (`architecture.md` "Pontos sensíveis" + constitution Art. 8/9) — por isso este ADR.

> **Escopo desta etapa:** só ADR + revisão de docs (spec/architecture). NENHUM código de saldo/escrow,
> migration ou RPC muda aqui. Trabalho de implementação decorrente fica listado como subsequente, com gate.

## Contexto

O `ADR-20260622-pagamento-postpago` estabeleceu o piloto como **postpago obrigatório (modelo Uber)**: a
empresa cadastra cartão on-file (R4), o aceite do convite dispara pré-autorização/hold (R7), e a conclusão
captura o cartão e paga o freela (R9). O pagamento pelo Worki era **pré-requisito** do fluxo push.

O owner revisou o modelo (jun/2026, memória `mvp-model-revised-2026-06.md` + tese seção "Postura de
pagamento no piloto"). A tese amadureceu: o **wedge do dia 1 é controle + dado** (histórico, recibo,
avaliação, fechar a vaga pelo app, dono da relação), **não o trilho financeiro**. A régua-mestra do piloto
é *menos fricção que WhatsApp+PIX*; exigir cartão on-file e cobrança obrigatória adiciona fricção e um
gate de adoção (cadastro de cartão) antes de a empresa sentir o valor. Take permanece **0**.

A operação real (MOMMA e similares) já paga o freela direto — por PIX/dinheiro, na hora ou no fim do mês.
Forçar esse dinheiro a passar pelo Worki no dia 1 não fortalece o cavalo (entrada) nem a carga (moat de
reputação); só cria atrito. O que fortalece a carga é o **registro** de que o trabalho aconteceu e foi pago
— independente de por onde o dinheiro passou.

## Decisão

### 1. Pagamento pelo Worki é OPCIONAL, com três modos coexistentes

O ciclo de contratação (convite → aceite → check-in/checkout → confirmação → avaliação) **fecha pelo Worki
sempre**. O **pagamento** tem três modos, escolhidos por turno/período:

| Modo | Movimenta saldo no Worki? | Take | Substrato |
|---|---|---|---|
| **A. Pagamento externo (default do piloto)** | **NÃO** | 0 | Worki só **registra** que houve pagamento fora (PIX/dinheiro) e emite recibo. Nenhuma RPC de saldo. |
| **B. PIX-único → distribuição (opt-in, conveniência)** | **SIM** | 0 | Empresa faz **1 PIX ao Worki**; o Worki **distribui automaticamente** aos freelas do período via RPC atômica idempotente. |
| **C. Postpago cartão on-file (opt-in / futuro)** | **SIM** | 0 | O fluxo do `ADR-20260622` — cartão on-file + hold/captura. Preservado como opção; **não é o default**. |

O **default do piloto é o modo A** (pagamento externo registrado). B é a conveniência quando há muitas
contas/muitos freelas. C deixa de ser o trilho padrão e vira opt-in / semente da fase de expansão.

### 2. "Registrar pagamento externo" (modo A) — registro sem movimento de saldo

Quando o pagamento é direto, o Worki grava um **marcador de pagamento por turno** (fonte da verdade do
gasto, independente do escrow) e **emite recibo**. Este marcador:
- **NÃO** cria linha em `escrow_transactions`, **NÃO** chama nenhuma RPC de saldo, **NÃO** toca `wallets`.
- Carrega: turno (`job_id`), freela, valor pago, quando, e o **método declarado** (`external_pix` |
  `cash` | `other`) + quem confirmou (empresa e/ou freela).
- É o insumo do BI de gasto quando o dinheiro não passou pelo Worki (ver seção "Impacto no BI").
- É **auditoria**, não dinheiro: sem `ON DELETE CASCADE` a partir de tabela financeira; imutável após
  confirmação (correção via novo registro/estorno lógico, não UPDATE destrutivo).

> **Direção arquitetural, não schema final:** o marcador será uma **tabela nova** (ex.: `shift_payments` ou
> `payment_records`) com RLS por empresa e por freela (ambos os lados veem o próprio registro), `job_id`
> único por turno pago, e um `status`/`source` que discrimina external vs. worki-rail. O schema exato,
> constraints e RLS são **trabalho subsequente com gate architect** (ver "Trabalho subsequente").

### 3. "Pagar via Worki" (modos B e C) — continua 100% sob Article 8/9

Qualquer centavo que **entre ou se mova dentro do Worki** segue as regras duras, sem exceção:
- **PIX-único → distribuição (B):** o crédito do PIX da empresa e cada repasse ao freela passam por **RPC
  Postgres atômica** (`SECURITY DEFINER`, `SET search_path=''`, `GRANT EXECUTE ... TO service_role,
  authenticated`). A distribuição a N freelas é **um lote idempotente**: cada repasse tem `reference_id`
  estável (ex.: `payout_batch_id:worker_id` ou `period:worker_id`), respeitando UNIQUE
  `(wallet_id, reference_id)` — reprocessar o lote nunca paga em dobro (Article 9). Saldo nunca negativo.
- **Postpago (C):** inalterado — as RPCs `authorize_escrow_postpago`/`capture_escrow_postpago`/
  `release_hold_postpago` do `ADR-20260622` seguem válidas para quem opta pelo cartão on-file.
- O **modo A não toca nada disso** — é a fronteira: registro ≠ movimento de saldo.

### 4. R4/R7/R9 deixam de ser obrigatórios; a máquina de estados perde o acoplamento a pagamento

O aceite do convite (R7) e a conclusão (R9) **não disparam mais cobrança obrigatoriamente**. O ciclo
avança por **confirmação da relação** (aceite, check-in/checkout, confirmação da empresa, avaliação);
o pagamento é um passo **paralelo e opcional** que anexa um registro (modo A) ou dispara uma RPC (B/C).
A confirmação de conclusão **não depende** de captura de cartão bem-sucedida.

## Consequências

### Positivas
- **Menos fricção de adoção:** empresa entra e roda o loop sem cadastrar cartão nem depositar. Alinha com a
  régua-mestra ("menos trabalho que zap+PIX") e com a métrica polar (turnos que passam pelo Worki).
- **Wedge correto no dia 1:** o valor entregue é controle + dado (recibo/histórico/avaliação), que é o moat.
- **Article 6/7/8/9/10 intactos:** nada de novo gateway, nada de subconta, e todo movimento de saldo real
  (B/C) continua por RPC atômica idempotente. O modo A simplesmente **não move saldo**.
- **Postpago preservado, não jogado fora:** o investimento do Slice 2 vira opção/semente da fase de
  expansão, reabrível sem retrabalho.

### Negativas / Trade-offs
- **Fonte da verdade do gasto se bifurca:** BI de gasto não pode mais assumir `escrow_transactions` como
  única fonte (ver "Impacto no BI"). Precisa unir escrow (B/C) + marcador de pagamento externo (A). Mais
  superfície de query e risco de dupla contagem se um turno for registrado nas duas fontes — mitigado por
  `job_id` único como pagamento e por rótulo de fonte.
- **Registro externo é auto-declarado:** o valor "pago fora" é o que a empresa (e idealmente o freela)
  declara — o Worki não tem prova bancária no modo A. Aceitável no piloto embedded/confiável; é dado de
  controle, não liquidação garantida. A confirmação bilateral (empresa declara + freela confirma) reduz
  divergência.
- **Reversibilidade difícil:** muda contrato de pagamento em doc de produto e cria uma nova fonte de verdade
  financeira (marcador) — por isso este ADR. Reabrir o postpago obrigatório é decisão consciente (gate).
- **Recibo em dois regimes:** recibo de pagamento externo (declaratório) vs. recibo de pagamento pelo Worki
  (com trilha Asaas) têm garantias diferentes; a UI/documento deve deixar claro qual é qual.

## Impacto nos requisitos e contratos

| Item | Antes (postpago obrigatório) | Depois (este ADR) |
|---|---|---|
| **R3.5 check-in/checkout** | Passo do ciclo; insumo de horas reais p/ BI | **Inalterado como ciclo.** Ganha peso: com pagamento fora do Worki, check-in/checkout + confirmação viram a **evidência primária** de que o turno aconteceu (base do registro e do recibo), já que não há mais captura de cartão como prova. |
| **R4 (cartão on-file obrigatório)** | Pré-requisito: empresa cadastra cartão 1x | **Vira opt-in (modo C).** Não é gate de adoção. Default do piloto não pede cartão. |
| **R7 (reserva/hold no aceite)** | Aceite → hold no cartão obrigatório | **Deixa de ser obrigatório.** Aceite confirma a relação e a agenda; hold só no modo C. Recusa continua neutra. |
| **R9 (captura na conclusão)** | Conclusão → captura obrigatória do cartão | **Vira opcional.** Conclusão confirma o turno e habilita o **registro de pagamento** (modo A) OU a captura/distribuição (C/B). Auto-processamento de captura só se aplica ao modo C. |
| **Modelo de pagamento (spec/arch)** | Postpago é o trilho | **Três modos coexistentes** (A default, B/C opt-in). Postpago = evolução da expansão. |
| **Contrato BI de gasto (BI-1..BI-5)** | Gasto = `escrow_transactions.status IN ('released','captured')` | **Fonte da verdade se amplia** (ver abaixo). Escrow deixa de ser a única fonte. |

### Impacto no BI de gasto (BI-1..BI-5) — a mudança de contrato mais crítica

O rodapé do spec define gasto como `escrow_transactions` com `status IN ('released','captured')`. **No modo
A (default do piloto) NÃO existe linha de escrow** — logo o BI enxergaria gasto **zero** para turnos pagos
fora, o que é falso e quebra R12/R13/R14/R15.

**Direção arquitetural (sem projetar schema final):**
- A **fonte da verdade do gasto passa a ser a UNIÃO de duas fontes**, discriminadas por rótulo:
  1. **Trilho Worki (B/C):** `escrow_transactions` com `status IN ('released','captured')` — como hoje.
  2. **Pagamento externo (A):** o novo **marcador de pagamento por turno** (valor pago + data + `source`
     external). Carimbo de período = a data do pagamento declarado (fallback data de conclusão do turno).
- **Anti-dupla-contagem:** `job_id` é a chave de dedupe — um turno é pago por **exatamente uma** fonte
  (external OU worki-rail). O BI soma escrow + marcador com `job_id` disjuntos; se ambos existirem para o
  mesmo turno (anomalia), o marcador worki-rail (escrow) tem precedência e o external é ignorado na soma.
- **BI-1 (gasto acumulado):** `SUM(escrow released/captured)` + `SUM(marcador external do período)`.
- **BI-2 (gasto+horas por freela):** idem, agrupado por freela; horas continuam de check-in/checkout
  (real) ou `estimated_hours` (fallback) — **inalterado**, e ganha relevância (única evidência de esforço
  no modo A).
- **BI-3 (ratio custo/hora, custo-%-faturamento):** numerador passa a ser o gasto unificado; denominador
  inalterado.
- **BI-4 (custo de no-show):** inalterado na heurística; note que no modo A não há hold a liberar, então
  no-show = turno aceito sem checkout **e sem registro de pagamento**.
- **BI-5 (concentração→vínculo):** inalterado (deriva de horas/dias, não de pagamento).
- **Alerta de teto (R12):** o gatilho de avaliação deixa de ser só "após captura/liberação de escrow" —
  passa a ser **após qualquer registro de gasto** (captura/liberação OU marcador de pagamento externo
  confirmado), mantendo a idempotência por `link` já especificada. O gasto acumulado usa a fonte unificada.

> Estes ajustes de BI são **contrato para o builder do slice financeiro**, não implementação aqui. Enquanto
> o marcador não existir, o BI reflete **apenas o trilho Worki** (documentar como limitação conhecida).

## Alternativas consideradas

- **Manter postpago obrigatório (status quo do ADR-20260622):** rejeitada pelo owner — adiciona fricção de
  cadastro de cartão antes do valor, contra a régua-mestra do piloto; o calote é ~inexistente no embedded,
  então a garantia upfront paga pouco e cobra caro em adoção.
- **Registrar pagamento externo dentro de `escrow_transactions` (linha `external`/`paid`, sem tocar saldo):**
  rejeitada — polui a tabela financeira com linhas que não representam movimento de saldo, arrisca as RPCs e
  o CHECK de status/o índice "um ativo por job", e confunde auditoria (o que é dinheiro do Worki vs. o que é
  só registro). Separar em marcador próprio mantém `escrow_transactions` = movimento real de saldo.
- **Abolir o postpago e o escrow do piloto de vez:** rejeitada — jogaria fora o Slice 2 e o trilho que a
  fase de expansão vai precisar; a decisão é tornar **opcional**, não remover.
- **Pagamento sempre pelo Worki, mas take 0 (sem modo externo):** rejeitada — ainda força cadastro de
  método/depósito, mantendo a fricção que o owner quer eliminar no dia 1.

## Reversibilidade / gatilho de reabrir o postpago obrigatório

Esta decisão é **reversível por nova decisão consciente**, não por deriva. Reabrir o **postpago (modo C)
como obrigatório** — ou mudar a distribuição/marcador — exige **gate `harness-architect` + novo ADR**, e
dispara quando qualquer um destes sinais aparecer no piloto/expansão:
1. **Calote/atraso material** no pagamento externo (freela reclama que não recebeu / empresa some) — sinal
   de que a garantia upfront (hold) volta a pagar sua fricção.
2. **Expansão para além de relações confiáveis** (empresa #2/#3 não-embedded, marketplace semi-aberto) —
   quando o pressuposto "todos se conhecem, calote ~zero" deixa de valer.
3. **Monetização entra** (take rate > 0 / cartão-parcela como receita) — exige que o dinheiro passe pelo
   trilho para cobrar/floatar.
Até um desses disparar, o default é o modo A (externo registrado), com B/C opt-in. Article 6 (Asaas-only) e
Article 7 (carteira central) permanecem válidos para B/C.

## Trabalho subsequente (com gate — NÃO implementado aqui)

1. **Migration do marcador de pagamento** (tabela nova, ex.: `shift_payments`): RLS por empresa+freela,
   `job_id` único, `source`/`status`, `amount`, `paid_at`, confirmadores. **Sem** `ON DELETE CASCADE` de
   tabela financeira; imutável pós-confirmação. → **gate architect** (é auditoria financeira, mesmo sem
   mover saldo) antes do builder.
2. **RPC de distribuição PIX-único (modo B):** crédito do PIX (reuso de `credit_deposit`) + lote de repasses
   idempotentes por `reference_id` estável. → **gate architect** (Article 8/9) — provavelmente ADR próprio.
3. **Contrato de BI unificado** (escrow ∪ marcador) e ajuste do gatilho de alerta de teto. → contrato no
   spec do slice financeiro; builder implementa no `FinancialBIService`.
4. **UI de "registrar pagamento" + recibo** (modo A) e toggle de modo de pagamento por turno/período. →
   frontend-builder, sob design neo-brutalista.

## Referências
- Owner (jun/2026): `~/.claude/.../memory/mvp-model-revised-2026-06.md` (item 1 e 5).
- Tese: `.harness/thesis.md` — seção "Postura de pagamento no piloto (revisado jun/2026 — owner)".
- Spec revisado: `.harness/spec/v1-operacao-freelancer/spec.md` (R4, R7, R9, workflow, rodapé de BI).
- ADR superado parcialmente: `.harness/memory-bank/decisions/ADR-20260622-pagamento-postpago.md`.
- Architecture: `.harness/memory-bank/architecture.md` — "Modelo de pagamento" e "Pontos sensíveis".
- Constitution: Art. 6 (Asaas-only), 7 (carteira central), 8 (saldo só por RPC + GRANT), 9 (idempotência),
  10 (service_role só em Edge Function).
