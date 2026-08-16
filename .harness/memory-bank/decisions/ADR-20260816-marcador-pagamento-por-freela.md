# ADR-20260816 — Marcador de pagamento (modo A) é por (turno, freela), não por turno

## Status
ACEITO — 2026-08-16 (harness-architect, gate de contrato de pagamento/auditoria financeira).
**Corrige** a granularidade adotada em `20260630000000_shift_payments.sql` §"DECISÃO DO ARCHITECT — UNIQUE
PARCIAL" e mantida em `20260712000000_shift_payment_scheduled.sql` §3.
**Não revoga** o `ADR-20260630-pagamento-opcional-piloto` — refina a leitura do que "job_id único por turno
pago" significava. Article 8/9/10 intactos: nada de saldo, RPC ou `wallets`/`escrow_transactions` é tocado.

## Contexto

Achado do `harness-evaluator` na revisão pré-piloto (severidade ALTO, tipo (c) — modelagem).

O produto trata "turno com mais de um freela" como estado normal:
- O painel pós-criação de `CompanyCreateJob` (`frontend/src/pages/company/CompanyCreateJob.tsx:539-588`)
  lista o Elenco inteiro com um botão "Convidar" por freela e conclui com **"N convites enviados"** — a
  criação de turno **convida vários de propósito**.
- Nada fecha o slot: `shiftInviteService.respondToInvite` seta `status='hired'` sem checar se o turno já tem
  alguém contratado; não existe `jobs.positions`, nem transição de `jobs.status` para "preenchido".
- `CompanyJobs.tsx:65` resume "Fulano +N" para o card do turno.

Mas o marcador de pagamento do modo A é único por turno:
`UNIQUE (job_id) WHERE status IN ('scheduled','recorded')` (`uq_shift_payments_job_active`).

O beco resultante, em ordem:
1. Empresa contrata Ana e Bia para o mesmo turno; paga as duas por PIX, fora do app.
2. Registra o pagamento da Ana → OK.
3. Registra o da Bia → Postgres 23505 → `alreadyRecorded` → toast *"Este turno já tem um pagamento
   registrado. Veja o recibo."* — **falso para a Bia**, e o recibo que ela veria é o da Ana.
4. Como `CompanyJobCandidates.handleRecordPayment` só marca `applications.status='completed'` **depois** de
   um INSERT bem-sucedido, a Bia fica presa em `hired`/`in_progress`: sem recibo, sem conclusão, sem
   fechamento do ciclo. O recibo bilateral é exatamente a promessa que o piloto existe para provar.
5. Colateral: `shiftInviteService.dismissFromShift` bloqueia por `job_id` sem `worker_id` — pagar a Ana trava
   dispensar a Bia.

Limitação de endereçamento na mesma linha: o recibo é endereçado por `job_id` (`/recibo/:jobId`) e
`getReceipt` filtra `status IN ('scheduled','recorded')`. Com dois freelas, o endereço não é único.

## Intenção original do modelo — o que a arqueologia mostra

**O UNIQUE por `job_id` não foi uma decisão de produto "1 turno = 1 freela". Foi uma premissa 1:1 não
examinada, herdada de uma frase do ADR-20260630 escrita para outro fim.** Quatro evidências:

1. **O HALT que originou o índice era sobre a dimensão temporal, não a de identidade.**
   `20260630000000_shift_payments.sql` §DECISÃO registra: *"HALT resolveu '1 registro por turno, índice
   parcial p/ re-registro após void'"*, e toda a justificativa que segue trata de **estorno → novo registro**.
   A pergunta "e se o turno tiver dois freelas?" nunca aparece — nem no cabeçalho, nem no plano, nem no ADR.

2. **A justificativa cita um contrato de dedupe que fala de FONTE, não de PESSOA.**
   O índice foi ancorado em *"casa com o contrato de dedupe do BI (job_id disjunto entre escrow e marcador)"*.
   No ADR-20260630 esse `job_id` resolve **anti-dupla-contagem entre trilhos**: *"um turno é pago por
   exatamente uma fonte (external OU worki-rail)"*. "Uma **fonte** por turno" foi materializado como "uma
   **linha** por turno". São coisas diferentes; a colagem é o erro.

3. **O trilho de dinheiro sempre foi por freela.** `escrow_transactions` tem `application_id` e é lido como
   `escrowStatusMap[application_id]` em `CompanyJobCandidates.tsx:207-222` — N freelas por turno **já** eram
   suportados nos modos B/C. O marcador do modo A **regrediu** a granularidade do projeto, não a expressou.

4. **O próprio consumidor já assume o par (turno, freela).** `CompanyJobCandidates.tsx:746-749` e `:1028-1031`
   casam o marcador com o card por `shiftPayment.worker_id === app.worker_id`. O frontend foi escrito com
   semântica por freela enquanto o banco impunha semântica por turno. E `worker_id` é `NOT NULL` com FK — a
   coluna existe, só ficou fora da chave.

Conclusão: **deliberado** = o índice ser *parcial* (permitir re-registro após `voided`); **acidental** = a
ausência de `worker_id` na chave.

## Decisão

### 1. A chave de dedupe passa a ser `(job_id, worker_id)`

`uq_shift_payments_job_active` → `uq_shift_payments_job_worker_active`:
`UNIQUE (job_id, worker_id) WHERE status IN ('scheduled','recorded')`.

Invariante novo: **no máximo um marcador ATIVO por (turno, freela)**. Continuam impossíveis: duas promessas
para o mesmo freela no mesmo turno, promessa + registro em linhas separadas, e pagar duas vezes o mesmo
freela pelo mesmo turno (a idempotência do 23505 → `alreadyRecorded`/`alreadyActive` é preservada, só que
por par). N linhas `voided` seguem permitidas.

Migration: `supabase/migrations/20260816220000_shift_payments_unique_por_freela.sql`.

### 2. É um alargamento — por isso é seguro sobre as 4 linhas em produção

O índice antigo é **estritamente mais forte** que o novo: toda linha que satisfaz `UNIQUE(job_id)` satisfaz
`UNIQUE(job_id, worker_id)`. Logo a criação **não pode falhar por dado existente** e **nenhuma linha muda de
estado**. A migration cria o índice novo **antes** de dropar o antigo, na mesma transação — nunca existe um
instante sem proteção de duplicidade.

Nada mais é tocado: sem `ALTER COLUMN`, sem mudar CHECK, RLS, GRANT, o trigger
`enforce_shift_payment_immutability` (que protege as colunas materiais) ou o trigger de notificação. O
receio de "o trigger de imutabilidade reagir à mudança de constraint" não se aplica: ele só roda em UPDATE de
linha, e nenhuma linha é atualizada.

### 3. Ordem de aplicação: **frontend primeiro, migration depois**

Esta é a parte que decide se a mudança ajuda ou atrapalha. Quatro leituras do client assumem "≤1 marcador
ativo por job" e usam `.maybeSingle()`. Com dois marcadores ativos, `.maybeSingle()` vira erro PGRST116, que
os services tratam como `null` — a UI ficaria **cega para os dois freelas**: ambos os cards voltariam a
oferecer "Registrar Pagamento" e `/recibo/:jobId` diria "não encontrado" para um pagamento que existe. Isso é
**pior** que o beco atual, que ao menos falha alto.

Por isso, a sequência (mesmo método de dois passos usado em `can_view_worker_profile` na leva de 16/08:
uma variável por vez):
1. **Passo 1 — frontend worker-aware.** Compatível com o banco **atual** (a consulta por freela devolve ≤1
   linha hoje e continuará devolvendo ≤1 depois). Pode ir a produção e ser verificado sozinho.
2. **Passo 2 — migration.** Vira um puro destravamento, sem exigir nenhuma outra mudança de client.

Se o relógio do piloto acabar entre 1 e 2, o passo 1 sozinho já converte o beco silencioso em erro honesto
("outro freela deste turno já tem pagamento ativo") com contorno operacional (um turno por pessoa).

### 4. O recibo continua endereçado por `job_id`, resolvido pelo espectador

`/recibo/:jobId` **não muda de contrato**. Motivo duro: o trigger
`notify_worker_on_shift_payment` (`20260816140000`) já gravou notificações **em produção** com
`link = '/recibo/<job_id>'`; trocar o parâmetro para o id do pagamento quebraria links já entregues ao freela.

A desambiguação passa a ser por identidade do espectador:
- **Freela:** a RLS (`sp_select_participants`) só devolve as linhas dele ⇒ `(job_id, worker_id=auth.uid())`
  resolve para exatamente um marcador ativo. Nada a fazer no link.
- **Empresa:** a RLS devolve as N linhas do turno ⇒ a UI passa a linkar `/recibo/<job_id>?worker=<worker_id>`
  (a empresa sempre chega ao recibo a partir do card de um freela específico). Sem o parâmetro (link antigo),
  resolve de forma determinística (marcador ativo mais antigo) e a tela mostra de quem é o recibo.

O `?worker=` é **filtro de exibição, nunca autorização** — quem autoriza é a RLS. Passar um `worker_id`
alheio não vaza nada: a policy não devolve a linha.

## Alternativas rejeitadas

- **(a) Impor "1 turno = 1 freela" e bloquear o convite duplo.** Rejeitada. Exigiria desfazer capacidade que
  acabou de ser entregue em **quatro** pontos (painel pós-criação de `CompanyCreateJob`, `InviteToShiftModal`,
  o picker de reconvite em `CompanyJobCandidates`, e o botão "Contratar" do fluxo pull), custo comparável ao
  da correção certa, para **entregar menos produto**. E contraria a operação real do cliente do piloto (um
  bar escala 3 garçons para o mesmo sábado — é o caso típico, não a exceção). Pior: não resolve turnos que já
  estejam duplamente ocupados hoje (query A5 da migration mede isso).
- **(c) Só melhorar a mensagem de erro (escape hatch textual).** Rejeitada como solução: a mensagem deixa de
  mentir, mas o 2º freela continua sem recibo e o turno dele continua sem conclusão — que é exatamente a
  promessa do piloto. Vale como parte do passo 1, não como decisão.
- **(d) Endereçar o recibo por `shift_payments.id` (`/recibo/:paymentId`).** Modelagem mais limpa, rejeitada
  **agora** por quebrar links de notificação já persistidos em produção. Fica como limpeza pós-piloto, se e
  quando um backfill de `notifications.link` valer o custo.
- **(e) Registrar o pagamento agregado do turno (uma linha, N freelas).** Rejeitada: destrói o recibo
  individual (o documento é da pessoa), impede a confirmação bilateral por freela (`worker_confirmed_at` é
  singular) e diverge da granularidade de `escrow_transactions`.

## Consequências

### Positivas
- O beco some: cada freela do turno tem seu registro, seu recibo, sua confirmação bilateral e sua conclusão.
- A granularidade do modo A volta a bater com a de `escrow_transactions` (modos B/C) — uma regra mental só.
- `dismissFromShift` deixa de ser bloqueado pelo pagamento de outro freela (com a correção do passo 1).
- Idempotência preservada por par; nenhum caminho novo de pagamento em dobro.
- Mudança de baixa reversibilidade **mecânica** (é um índice), aplicável e revertível em segundos.

### Negativas / Trade-offs
- **`orderReportService` fica sub-granular.** `OrderRow` é uma linha **por turno** e o mapa
  `paymentByJob` colapsa N marcadores em 1 (`orderReportService.ts:264-270, 302-327`). Com dois freelas, o
  relatório/CSV mostra um pagamento e um nome, e `valorTotal` **subconta**. Não quebra (não usa
  `.maybeSingle()`), mas é uma limitação conhecida — o certo é a linha virar (turno, freela). Fora do escopo
  pré-piloto: o relatório foi entregue há dois commits e tem testes próprios.
- **Reverter fica condicionado ao dado.** Depois que existir um turno com 2 marcadores ativos, recriar o
  índice antigo exige estornar os excedentes primeiro (`voided` — nunca DELETE). O DOWN da migration
  documenta a checagem.
- **Mais superfície de leitura no client** (mapa por worker em vez de um objeto único) — trocado por
  correção; é o mesmo shape que `escrowStatusMap`/`escrowKindMap` já usam ao lado.
- **Não fecha o slot.** Continua possível convidar 5 freelas para um turno de 1 pessoa. Isso é uma lacuna de
  *produto* (não existe `jobs.positions`), independente desta decisão, e fica registrada abaixo.

## Frontend pendente (passo 1 — descrito, não implementado aqui)

| Arquivo | Mudança |
|---|---|
| `frontend/src/services/paymentRecordService.ts` | `getPaymentByJob(jobId)` → aceitar `workerId` e filtrar por ele (`.eq('worker_id', workerId)`); manter `.maybeSingle()` só com o filtro presente. Adicionar `listActivePaymentsByJob(jobId)` (sem `maybeSingle`) para a tela da empresa. |
| `frontend/src/services/paymentRecordService.ts` | `getReceipt(jobId, workerId?)`: sem `workerId`, resolver pelo espectador — se o usuário é o freela, filtrar `worker_id = auth.uid()`; se é a empresa, usar o `workerId` do query param e, na ausência, ordenar por `created_at` e pegar o primeiro. **Nunca** `.maybeSingle()` sem filtro de freela. |
| `frontend/src/services/shiftInviteService.ts` | `dismissFromShift`: a checagem de marcador ativo passa a filtrar também `worker_id` da application (`current.worker_id` — incluir na projeção do `select`). Trocar `.maybeSingle()` por `.limit(1)`. Ajustar o texto do bloqueio para "este freela já tem pagamento…". |
| `frontend/src/pages/company/CompanyJobCandidates.tsx` | Estado `shiftPayment: ShiftPayment \| null` → `paymentByWorker: Record<string, ShiftPayment>`, alimentado por `listActivePaymentsByJob`. `renderCompletionAction` e o bloco de `status==='completed'` passam a olhar `paymentByWorker[app.worker_id]`. Todos os `navigate('/recibo/…')` da empresa ganham `?worker=${app.worker_id}`. Corrigir os toasts `alreadyRecorded`/`alreadyActive` para "**este freela** já tem pagamento registrado/agendado neste turno". |
| `frontend/src/pages/ReceiptView.tsx` | Ler `?worker=` via `useSearchParams` e repassar a `getReceipt`. Exibir o nome do freela no cabeçalho do documento (já vem em `receipt.worker`) para que um turno com N recibos nunca seja ambíguo. |
| Testes (`paymentRecordService.test.ts`, `CompanyJobCandidates.test.tsx`, `ReceiptView.test.tsx`) | Caso novo: turno com **dois** freelas — cada um vê/registra o próprio marcador; o card do freela B não exibe o recibo do freela A; o toast de duplicidade cita o freela. |

Fora do passo 1, com prioridade após o piloto: granularidade de `orderReportService` e a lacuna de
"fechar o slot" (`jobs.positions` / travar `hired` acima da lotação).

## Ir / não ir antes do piloto

**IR** — passo 1 (frontend) e passo 2 (migration), nesta ordem, ambos antes do piloto. A migration é
mecanicamente trivial e provada por queries; o risco real está inteiro no client, e está enumerado.
**NÃO IR** com a migration sozinha, em nenhuma hipótese: sem o passo 1 ela troca um erro alto por uma UI
cega. Se só houver tempo para um, é o passo 1.

## Referências
- Migration: `supabase/migrations/20260816220000_shift_payments_unique_por_freela.sql` (queries de prova no cabeçalho)
- Origem da granularidade: `supabase/migrations/20260630000000_shift_payments.sql` §DECISÃO DO ARCHITECT
- Extensão que a manteve: `supabase/migrations/20260712000000_shift_payment_scheduled.sql` §3
- Contrato de links do recibo: `supabase/migrations/20260816140000_notify_worker_on_shift_payment.sql` §LINKS
- Decisão-mãe do modo A: `.harness/memory-bank/decisions/ADR-20260630-pagamento-opcional-piloto.md`
- Spec: `.harness/spec/revisao-piloto/spec.md`
- Estado de produção: `supabase/migrations/APLICACAO-2026-08-16.md`
- Constitution: Art. 8 (saldo só por RPC — intacto), 9 (idempotência), 2 (tipos à mão), 5 (fetch direto)
