# ADR-20260712 — Pagamento agendado por turno (status 'scheduled' + data prevista)

## Status
ACEITO (proposto pelo owner, decisão de modelo pelo architect)

## Contexto

No mercado real (ex.: MoMA / eventos), o freela **não recebe na hora** — o pagamento é
**agendado** para uma data futura. A empresa precisa emitir um **"comprovante de agendamento"**
que dê respaldo ao freela de que será pago numa data prevista. Decisão do owner (aprovada):
modelar com **status `scheduled` + data prevista**.

Isto vive no **modo A** (pagamento externo registrado — ADR-20260630): é **auditoria/comprovante**,
**não move saldo** (Article 8 intacto), sem RPC, sem tocar `wallets`/`escrow_transactions`. Escrow
(modo B/C) permanece o caminho opt-in de liquidação real.

### Restrição crítica herdada de `shift_payments` (20260630000000)

- `paid_at` é `NOT NULL` **e imutável** (trigger `enforce_shift_payment_immutability`).
- Um pagamento `scheduled` **ainda não foi pago** → não tem `paid_at` real.
- Na efetivação é preciso gravar a **data real** do pagamento — mas `paid_at` é imutável.
- `status` **não** está na lista de colunas imutáveis do trigger → transições de status já são possíveis.
- O CHECK `shift_payments_void_consistency` e o CHECK inline de `status` **rejeitam** qualquer valor
  fora de `('recorded','voided')` → precisam ser reescritos para admitir `scheduled`.

## Decisão

Adotar a **opção (a)**: nova coluna `scheduled_for date` (a promessa) + tornar `paid_at` **NULLABLE**,
setando-o **apenas na efetivação** (`scheduled → recorded`), com o trigger de imutabilidade liberando
**exclusivamente** essa transição (NULL → data real, uma vez; depois congela).

### Máquina de estados (mesma linha, transição in-place)

```
INSERT ─► scheduled ──efetivar (empresa, seta paid_at)──► recorded ──estornar──► voided
              │                                                                    ▲
              └──────────────── cancelar (empresa) ────────────────────────────────┘
INSERT ─► recorded  (registro direto legado, inalterado) ──estornar──► voided
```

- `scheduled`: `scheduled_for` NOT NULL, `paid_at` NULL, sem confirmação, sem void. **Não conta como gasto no BI.**
- `recorded`: `paid_at` NOT NULL (data real da efetivação, ou registro direto). Entra no BI.
- `voided`: terminal/imutável.
- Transições válidas (só empresa): `scheduled→recorded`, `scheduled→voided`, `recorded→voided`.
  `recorded→scheduled` e qualquer saída de `voided` são **proibidas** (trigger).

### Dedupe

O UNIQUE parcial passa de `(job_id) WHERE status='recorded'` para
`(job_id) WHERE status IN ('scheduled','recorded')` — **um marcador ativo por turno**, impedindo
duas promessas ou promessa+pagamento em linhas separadas. N linhas `voided` seguem permitidas
(re-agendar / re-registrar após cancelamento). O BI (`status='recorded'`) segue correto:
promessa ≠ liquidação.

### Comprovante = mesma superfície do recibo (ReceiptView)

O `ReceiptView` (`/recibo/:jobId`) renderiza os dois estados:
- `scheduled` → título "Comprovante de Agendamento", mostra **"Pagamento agendado para {scheduled_for}"**,
  **não** oferece "Confirmar Recebimento" (nada foi recebido), disclaimer de respaldo (não é garantia
  nem documento fiscal).
- `recorded` → recibo atual (data real em `paid_at`, confirmação bilateral do freela).

## Consequências

### Positivas
- `paid_at` carrega sempre um **fato verdadeiro** (data real) — nunca uma data futura disfarçada.
- Auditoria coerente: a promessa (`scheduled_for`) e a liquidação (`paid_at`) são campos distintos.
- BI de gasto inalterado (filtra `recorded`); promessa não infla gasto.
- Reaproveita 100% da superfície de recibo, RLS bilateral e imutabilidade existentes.
- Zero impacto em saldo/escrow/RPC — Article 8/9/10 intactos.

### Negativas / Trade-offs
- `paid_at` deixa de ser `NOT NULL` (widening) — o invariante "sempre há data de pagamento" agora
  depende do CHECK por estado, não da coluna. Mitigado por `shift_payments_state_consistency`.
- O trigger ganhou um caso especial (a única mutação material permitida). Complexidade adicional
  concentrada e testável.
- Troca do UNIQUE parcial usa `CREATE UNIQUE INDEX` simples (não `CONCURRENTLY`) — lock breve.
  Aceitável por ser tabela de **baixo volume (piloto)**; se crescer, migrar para índice concorrente
  fora de transação. **Minor**, documentado.
- "Reagendar" não é transição: exige `void` + novo `scheduled` (mantém a filosofia append-only de
  auditoria). Pode surpreender quem espera editar a data — decisão consciente.

## Alternativas rejeitadas

- **(b) `paid_at` NOT NULL, `paid_at = scheduled_for` provisório**: gravaria um **fato falso** (data
  futura como "data paga") e, sendo imutável, **travaria a data real** na efetivação. Corrompe o
  significado de auditoria. Rejeitada.
- **(c) Tabela separada `payment_schedules`**: duplicaria RLS, imutabilidade e dedupe; quebraria a
  unicidade "1 marcador ativo por turno" entre duas tabelas; e o ReceiptView teria de unir duas
  fontes. Mais superfície, sem ganho. Rejeitada.
- **Reagendamento in-place (mutar `scheduled_for`)**: violaria a imutabilidade material da declaração;
  contradiz o padrão "correção = estorno lógico + novo registro". Rejeitada.

## Gatilhos de reabertura
- Se o piloto exigir **reagendamento frequente** com histórico da própria promessa → considerar
  `scheduled_for` mutável com trilha de auditoria (nova tabela de eventos) — reabrir este ADR.
- Se `scheduled` precisar **entrar no BI** como "compromisso a pagar" (fluxo de caixa projetado) →
  o BI passa a unir `recorded` + `scheduled` com rótulos distintos — reabrir.
- Se a tabela crescer a ponto do lock do índice importar → migrar UNIQUE para `CONCURRENTLY`.
- Se algum dia o agendado precisar **mover saldo** (escrow com data futura) → sai do modo A, vira
  fluxo B/C e exige gate de escrow (ADR próprio).

## Contrato para frontend / service

### `types/index.ts`
```ts
export type ShiftPaymentStatus = 'scheduled' | 'recorded' | 'voided';

export interface ShiftPayment {
  // ...campos atuais...
  scheduled_for: string | null; // NOVO — data prevista (YYYY-MM-DD) quando scheduled
  paid_at: string | null;       // ALTERADO — agora nullable (NULL enquanto scheduled)
}
```

### `paymentRecordService`
- **`scheduleExternalPayment(params)`** — NOVO. `params: { jobId, workerId, applicationId,
  source, amount, scheduledFor: string /*YYYY-MM-DD*/, note? }`. INSERT com
  `status='scheduled'`, `scheduled_for=scheduledFor`, `paid_at=null`. Reutiliza a **mesma
  validação defensiva de "turno concluído"** de `recordExternalPayment` (checkin+checkout
  confirmados). 23505 → `{ alreadyActive: true }` (já há marcador ativo — scheduled ou recorded).
- **`effectivateScheduledPayment(paymentId, paidAt?)`** — NOVO. UPDATE
  `{ status: 'recorded', paid_at: paidAt ?? now }`. Só a empresa dona (RLS + trigger). Transição
  `scheduled→recorded`.
- **`voidPayment(paymentId, reason)`** — INALTERADO no código; passa a cobrir também
  `scheduled→voided` (RLS `sp_update_company` já inclui `scheduled` no USING).
- **`getPaymentByJob` / `getReceipt`** — ALTERAR o filtro de `.eq('status','recorded')` para
  `.in('status',['scheduled','recorded'])` + `.maybeSingle()` (o UNIQUE ativo garante ≤1),
  para que o comprovante de agendamento apareça.

### `ReceiptView`
- Ramificar por `payment.status`:
  - `scheduled`: título "Comprovante de Agendamento"; bloco "Pagamento agendado para
    {formatDateOnly(scheduled_for)}"; ocultar "Data do pagamento"; **sem** botão "Confirmar
    Recebimento"; disclaimer "respaldo de que o pagamento será feito na data prevista — não é
    garantia de pagamento nem documento fiscal".
  - `recorded`: comportamento atual (usa `paid_at`, confirmação bilateral).
- Ação "Efetivar pagamento" (company) pode viver em `CompanyJobCandidates` ou no próprio ReceiptView
  para o viewer empresa.

### Ponto em aberto (para clarifier/humano)
- `scheduleExternalPayment` **exige turno concluído** (herdado de `recordExternalPayment`) —
  default adotado por consistência de auditoria. Se o produto quiser agendar **no ato da
  contratação** (antes do turno), relaxar a guarda (mantendo `application` válida como lastro).

## Referências
- Migration: `supabase/migrations/20260712000000_shift_payment_scheduled.sql`
- Base: `supabase/migrations/20260630000000_shift_payments.sql`
- ADR-mãe (modo A): `.harness/memory-bank/decisions/ADR-20260630-pagamento-opcional-piloto.md`
- Service: `frontend/src/services/paymentRecordService.ts` · Tela: `frontend/src/pages/ReceiptView.tsx`
