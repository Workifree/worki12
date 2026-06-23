# ADR-20260622 — Pagamento postpago (modelo Uber): cartão on-file + pré-autorização/captura

## Status
ACEITO — 2026-06-22 (architect, gate de Slice 2, branch `feat/v1-loop-relacional`, stack sobre Slice 1).
Complementa o ADR-20260622-aceite-convite-invited-hired (que deixou o early-return de escrow no aceite
de convite como ponto de integração deste Slice). Toca **ponto sensível** (constitution Art. 8, 9, 10 +
`architecture.md` "Pontos sensíveis": *mudar a direção postpago→prepago e o contrato das RPCs de escrow*).

## Contexto

O owner decidiu (2026-06) que o piloto roda **postpago, modelo Uber**: a empresa não deposita nada antes.
Cadastra **um método uma vez** (cartão on-file) e, na **conclusão** do turno, o Worki cobra esse método e
paga o freela. Onde o Asaas suportar, há **pré-autorização (hold) no aceite + captura na conclusão** — o
freela vê convite com garantia, sem depósito. Worki **não adianta dinheiro** (não é crédito).

O fluxo PRÉ-PAGO (PULL legado: deposita → `reserve_escrow` → `release_escrow`) é o que existe hoje e
**permanece inalterado** — empresas que já depositaram continuam funcionando. O fluxo PUSH (Slice 1:
empresa convida freela conhecido) hoje **não reserva nada** no aceite (o trigger `auto_reserve_escrow_on_hire`
pula — ADR anterior). Este Slice substitui esse "não fazer nada" por **autorizar o hold** no aceite e
**capturar** na conclusão.

O spike (Slice 0) confirmou que o **Asaas suporta postpago nativamente** — sem segundo gateway, Article 6
intacto: `tokenizeCreditCard` → `POST /v3/payments` com `authorizeOnly:true` → `captureAuthorizedPayment`.
Hold de 3 dias (até 25 com elegibilidade de MCC). Ambos exigem `remoteIp`.

## Decisão

### 1. Substrato: estender `escrow_transactions`, não criar tabela nova
O escrow já é a aresta financeira por turno (application_id, valor, wallets, RLS por papel, índice "um
ativo por job"). O postpago é o **mesmo conceito** (valor garantido até a conclusão) sobre substrato
diferente (hold no cartão, não saldo pré-pago). Tabela nova duplicaria RLS/índice/auto-liberação. Decisão:
+ coluna `kind` (`prepaid`|`postpaid`, default `prepaid` → toda linha existente preservada),
`asaas_payment_id`, `authorized_at`, `captured_at`; CHECK de `status` vira superset.

### 2. Modelo de estados (coexistente; prepago intacto)
```
PRE-PAGO  (pull legado, kind='prepaid'):   reserved ──► released | refunded        (NÃO MUDA)
POST-PAGO (push Slice 2, kind='postpaid'): authorized ──► captured/released
                                           authorized ──► refunded (cancel/no-show: libera o hold)
```
- `authorized`: hold no cartão (Asaas `authorizeOnly`). **Saldo do DB NÃO muda** — o lock é no cartão.
- `captured`/`released`: captura confirmada; o worker é creditado no mesmo passo atômico.
- `refunded`: hold liberado/estornado antes da captura (cancelamento/no-show).

### 3. `payment_methods` — cartão on-file (PCI/Article 10)
Tabela nova: `company_id` (= auth.uid()), `asaas_credit_card_token` (token **opaco** — o PAN nunca toca o
banco), `brand`/`last4`/`holder_name`, `is_default` (índice parcial único: 1 default por empresa), UNIQUE
`(company_id, token)`. RLS por dono (espelha `team_connections`); REVOKE anon + GRANT service_role.

### 4. RPCs atômicas idempotentes (estado no DB; a chamada Asaas é da Edge Function)
- `authorize_escrow_postpago(job, application, amount, asaas_payment_id, company_user_id)` → grava escrow
  `authorized`/`postpaid`. **Sem saldo.** Idempotente por `asaas_payment_id` (retorna o existente).
- `capture_escrow_postpago(job, worker_wallet_id)` → `authorized`→`released`, **credita o worker** (reusa
  type `escrow_release`, `reference_id = job_id`, UNIQUE `(wallet_id, reference_id)` → sem crédito duplo).
  `WHERE status='authorized'` impede double-capture. O crédito de saldo (`UPDATE wallets`) é guardado por
  `INSERT ... ON CONFLICT DO NOTHING RETURNING id INTO v_txn_id` + `IF v_txn_id IS NOT NULL` — **nunca**
  por `IF FOUND` (ver Negativas: FOUND mente após ON CONFLICT, creditaria em dobro num retry/corrida).
- `release_hold_postpago(job, reason)` → `authorized`→`refunded`, **sem saldo**, retorna `asaas_payment_id`
  para a Edge Function liberar/deletar o hold no Asaas. Loga auditoria com type `escrow_void` (amount 0).
Todas `SET search_path=''`, schema-qualificadas, `GRANT EXECUTE ... TO service_role, authenticated`.

### 5. Autorização NÃO em trigger
O hold (chamada de rede ao Asaas) é responsabilidade **explícita** do service/Edge Function, **nunca** de
trigger Postgres — I/O externo em transação de banco é proibido (sem retry, prende conexão, transação do
UPDATE refém da latência/erro do Asaas). O trigger `auto_reserve_escrow_on_hire` **continua só pulando** no
aceite de convite (migration 20260622000900 atualiza só o comentário; runtime idêntico ao Slice 1).

### 6. Fallback sem ADR
Se a habilitação de pré-auth em produção for negada, ou o hold de 3 dias não couber no agendamento:
**charge-on-demand** — tokeniza + captura direto na conclusão (sem `authorizeOnly`), pulando o estado
`authorized` (escrow nasce `captured`/`released`). Ainda só Asaas → **não exige novo ADR** (já previsto
no plan).

## Contrato das Edge Functions (para o builder — Deno, NÃO implementado aqui)

> Padrão obrigatório (todas): `getCorsHeaders(req)` + preflight `OPTIONS`; `supabaseAdmin.auth.getUser(token)`
> a partir do header `Authorization`; `getAsaasHeaders()` + `ASAAS_API_URL` do `_shared/asaas.ts`;
> `isRateLimited(user.id, '<bucket>', …)`; `service_role` só no Deno; erros `{ error }` status 400.
> Deploy **normal** (com verify-jwt) — são chamadas autenticadas pela empresa (não webhook).

### `asaas-tokenize-card` (cadastro do método — chamada pela empresa)
- **Input:** `{ holderName, number, expiryMonth, expiryYear, ccv, holderInfo: { name, email, cpfCnpj, postalCode, addressNumber, phone }, remoteIp }`
  (o PAN trafega só nesta chamada, server→Asaas; nunca persiste no DB).
- **Faz:** garante `wallets.asaas_customer_id` (cria customer se faltar, como `asaas-deposit`); `POST
  /v3/creditCard/tokenizeCreditCard` (exige `remoteIp` — pegar de `x-forwarded-for`/`x-real-ip`); grava em
  `payment_methods` (token + brand/last4/holderName, `is_default=true`; desmarcar default antigo).
- **Output:** `{ success, paymentMethodId, brand, last4 }`. Idempotente: UNIQUE `(company_id, token)`.
- **Falha:** cartão recusado/inválido → `{ error }` 400. Não cria `payment_methods` sem token válido.

### `asaas-authorize-payment` (no ACEITE do convite — chamada pelo service `respondToInvite('accepted')`)
- **Input:** `{ jobId, applicationId }` (worker = `auth.uid()` do chamador; valor = `jobs.budget`).
- **Auth/guards:** caller é o worker da application; application está `hired` por aceite de convite
  (`invited_by_company_at NOT NULL`); a empresa do job tem `payment_methods` default.
- **Faz:** `POST /v3/payments` com `billingType:'CREDIT_CARD'`, `creditCardToken` (default da empresa),
  `value: budget`, `authorizeOnly:true`, `customer`, `externalReference: jobId`, `remoteIp`, `dueDate`.
  Espera status `AUTHORIZED`. Depois `supabaseAdmin.rpc('authorize_escrow_postpago', { p_job_id, p_application_id, p_amount, p_asaas_payment_id: payment.id, p_company_user_id })`.
- **Output:** `{ success, escrowId, asaasPaymentId, status:'authorized' }`.
- **Idempotência:** repetir não cria 2º hold — a RPC casa pelo `asaas_payment_id`; o índice parcial
  `idx_escrow_one_authorized_per_job` veta 2 holds ativos no mesmo turno (`23505` → tratar como já-autorizado).
- **Falha/fallback:** se a conta não tem pré-auth habilitada (erro do Asaas) → **não** chamar a RPC de
  authorize; cair no charge-on-demand (capturar só na conclusão). Decidir por flag/env, não por novo gateway.

### `asaas-capture-payment` (na CONCLUSÃO — chamada pela empresa, espelha `asaas-checkout`)
- **Input:** `{ jobId, workerId }`.
- **Auth/guards:** caller é dono do job (`jobs.company_id === user.id`); application `completed` **ou**
  `company_checkout_confirmed_at` setado (igual ao `asaas-checkout` atual).
- **Faz:** lê o escrow `authorized`/`postpaid` do job (`asaas_payment_id`); `POST
  /v3/payments/{id}/captureAuthorizedPayment`; get-or-create wallet do worker; `supabaseAdmin.rpc(
  'capture_escrow_postpago', { p_job_id, p_worker_wallet_id })` (credita o worker, idempotente).
  - **Fallback charge-on-demand:** se não houver hold (`authorized`) — cobrança direta com o token e, em
    seguida, gravar o escrow já `captured`/`released` + crédito (a RPC de captura pode ganhar um caminho
    "sem hold" OU usar `authorize_escrow_postpago` seguido de `capture_escrow_postpago` na mesma função).
- **Output:** `{ success }`. **Idempotência:** recapturar não credita 2× (UNIQUE `(wallet_id, reference_id)`
  + `WHERE status='authorized'`).
- **Auto-processamento (R9):** após a janela de carência pós-conclusão, um cron/Edge dispara a mesma
  captura (protege o freela da inação da empresa). Mesma idempotência cobre a corrida cron×empresa.

### `asaas-release-hold` (cancelamento / no-show ANTES da captura)
- **Input:** `{ jobId, reason }`. **Auth:** dono do job.
- **Faz:** `supabaseAdmin.rpc('release_hold_postpago', { p_job_id, p_reason })` (marca `refunded`, retorna
  `asaas_payment_id`); depois libera/deleta o hold no Asaas (`DELETE /v3/payments/{id}` ou refund da
  pré-auth). **Idempotência:** `WHERE status='authorized'` — não estorna um já capturado.

### Expiração do hold (3 dias)
Se o turno acontece além do hold de 3 dias e a captura falha por hold expirado: tratar como charge-on-demand
no momento da captura (nova cobrança com o token), OU re-autorizar perto da data. Decisão operacional do
builder/owner conforme a elegibilidade de MCC (estender p/ 25 dias) confirmada com o Asaas (ação externa do plan).

## Consequências

### Positivas
- Postpago real (modelo Uber) sem 2º gateway — Article 6 intacto; `escrow_transactions` reusado.
- Prepago legado 100% preservado (`kind='prepaid'` default; RPCs e índice `reserved` inalterados).
- Idempotência forte em todo o ciclo (hold por `asaas_payment_id`; crédito por `(wallet_id, reference_id)`).
- Pagamento fora de trigger → sem I/O externo em transação; falha do Asaas não trava o aceite no banco.
- Ponto de integração único e explícito para a Edge Function (as 3 RPCs novas).

### Negativas / Trade-offs
- `escrow_transactions` agora carrega dois fluxos (prepaid/postpaid) — mais estados no mesmo objeto.
  Mitigação: `kind` discrimina; índices parciais separam o "ativo" de cada fluxo; comentários no schema.
- Reversibilidade **difícil** (objeto financeiro em produção + contrato de RPC) → por isso este ADR. DOWN
  documentado em cada migration (drop de colunas/constraint/índice/funções; CHECK de status/type restaurado).
- O `captured` é transitório no DB (a RPC já marca `released` no mesmo passo) — `captured_at` fica como
  trilha de auditoria; quem quiser o estado intermediário lê `captured_at IS NOT NULL`.
- Dependência operacional: pré-auth em produção exige habilitação do Asaas (ação externa). Fallback
  charge-on-demand mitiga (mesmo gateway, sem ADR).
- **Armadilha de implementação (corrigida no review do Slice 2, 2026-06-23):** detectar "inseriu de fato"
  em PL/pgSQL após `INSERT ... ON CONFLICT DO NOTHING` **não** pode usar `FOUND` — `FOUND` é TRUE mesmo
  quando o conflito suprimiu a linha, então o `UPDATE wallets SET balance` rodava 2× num retry/recaptura
  (worker creditado em dobro: era BLOCKER de integridade financeira). Padrão correto e obrigatório para
  qualquer crédito guardado por idempotência: `... ON CONFLICT DO NOTHING RETURNING id INTO v_txn_id;` e
  só mover saldo quando `v_txn_id IS NOT NULL`. Vale para futuras RPCs que combinem upsert idempotente +
  movimento de saldo.

## Alternativas rejeitadas
- **Tabela `postpago_payments` separada:** duplicaria RLS, índice "um ativo por job" e a auto-liberação;
  desconectaria do `application_id`/`job_id` que o lifecycle já usa. Rejeitada (sem ganho, mais superfície).
- **Autorizar/capturar dentro de trigger:** I/O de rede ao Asaas em transação Postgres — sem retry, prende
  conexão, acopla o UPDATE da application à latência/erro do gateway. Rejeitada (regra dura).
- **Debitar saldo do DB no `authorized` (espelhar prepago):** no postpago não há saldo pré-depositado;
  debitar criaria saldo negativo/fantasma e violaria o CHECK `balance >= 0`. Rejeitada.
- **Segundo gateway/PSP para hold:** violaria Article 6 (Asaas-only). Asaas já suporta nativamente. Rejeitada.

## Referências
- Spec: `.harness/spec/v1-operacao-freelancer/spec.md` (R4, R9, A3, A5, A9)
- Plan: `.harness/spec/v1-operacao-freelancer/plan.md` (Slice 2; spike Slice 0)
- ADR anterior: `.harness/memory-bank/decisions/ADR-20260622-aceite-convite-invited-hired.md`
- Constitution: Art. 6 (Asaas-only), 8 (saldo só por RPC + GRANT), 9 (idempotência), 10 (service_role/PCI).
- Migrations: `20260622000600_payment_methods.sql`, `20260622000700_escrow_postpago_states.sql`,
  `20260622000800_postpago_escrow_rpcs.sql`, `20260622000900_postpago_no_escrow_in_trigger.sql`
- Triggers/RPCs reusados: `reserve_escrow`/`release_escrow`/`refund_escrow` (intactos),
  `auto_reserve_escrow_on_hire` (só comentário), `asaas-checkout`/`asaas-deposit` (padrão de Edge Function).
