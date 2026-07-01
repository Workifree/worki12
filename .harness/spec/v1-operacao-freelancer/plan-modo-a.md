# Plano de implementação — Piloto #1: Marcador de pagamento externo (modo A) + recibo

> **Fonte:** ADR-20260630-pagamento-opcional-piloto (decisão-mãe) · spec `v1-operacao-freelancer` (R9 + rodapé "Fonte da verdade do GASTO") · diagnóstico do evaluator.
> **Autor:** harness-planner · **Data:** 2026-06-30 · **Estado:** aguardando HALT (aprovação humana).
> **Escala estimada:** **L** (1 migration nova + tipos + service novo + UI de 2 pontos + tela de recibo; cruza empresa e freela via RLS). Não é XL: não move saldo, não tem RPC de escrow, não tem edge function.

---

## 1. Objetivo e escopo

### Objetivo
Permitir que a empresa, ao **confirmar a conclusão de um turno**, **registre que o pagamento foi feito por fora do Worki** (PIX/dinheiro), gerando um **marcador de pagamento por turno** (fonte da verdade do gasto no modo A) e um **recibo** consultável in-app pelos dois lados. Tudo **sem mover saldo** — é auditoria/registro, não liquidação.

Este é o **default do piloto** (modo A do ADR). Substitui, no caminho externo, a captura de escrow como evidência de gasto.

### Entra neste plano (in-scope)
- Tabela nova `shift_payments` (marcador de pagamento por turno) + RLS empresa+freela + imutabilidade.
- Tipos à mão em `types/index.ts`.
- Service novo `paymentRecordService` (registrar, ler por turno, ler recibo).
- UI: botão/modal **"Registrar pagamento"** pós-conclusão em `CompanyJobCandidates.tsx` (empresa).
- **Recibo** in-app: tela renderizável a partir do marcador, acessível empresa e freela.
- Deixar o gasto do modo A **consultável** (marcador legível por query filtrável por empresa/período/`job_id`) para o BI consumir depois.

### NÃO entra (out-of-scope — explícito)
- **BI unificado (escrow ∪ marcador)** e ajuste do gatilho de alerta de teto → **item #2** do piloto (contrato no ADR "Impacto no BI"). Aqui só garantimos que o dado existe e é consultável; **não** alteramos `financialBIService.ts`.
- **PIX-único → distribuição (modo B)** → **item #7** (RPC atômica, ADR próprio).
- **Postpago / cartão on-file (modo C)** → permanece opt-in, intocado.
- **Confirmação de recebimento pelo freela como gate** — pode entrar como campo opcional (ver §4), mas o registro **não depende** dela no v1.
- **Recibo fiscal (nota/NF-e, série fiscal)** — recibo v1 é **declaratório informal**, não documento fiscal.
- **Edge function** — não há operação privilegiada; INSERT autenticado sob RLS basta (Article 10 satisfeito por não haver service_role).
- **Pagamento parcial/parcelado** por turno — decisão de produto a confirmar (§4); recomendação é **1 registro por turno** no v1.

---

## 2. Desenho da tabela `shift_payments` — **PROPOSTA (architect valida no gate)**

> Marcado como proposta. O schema final, constraints e RLS são responsabilidade do **harness-architect** no gate. Segue o padrão de identidade já consolidado no projeto: `companies.id = companies.owner_id = auth.uid() = jobs.company_id = wallets.user_id`; freela = `applications.worker_id = auth.uid()`.

| Coluna | Tipo | Constraint / nota |
|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` |
| `job_id` | `uuid` | **`NOT NULL REFERENCES jobs(id)`** `ON DELETE RESTRICT` `[architect ajustou: RESTRICT explícito — auditoria não some em cascata com o turno]`. **UNIQUE PARCIAL** `WHERE status='recorded'` (não UNIQUE simples — permite re-registrar após void; ver §Idempotência). |
| `company_id` | `uuid` | `NOT NULL REFERENCES companies(id)` `ON DELETE RESTRICT` `[architect ajustou: RESTRICT]`. Dono do registro; base do RLS empresa. |
| `worker_id` | `uuid` | `NOT NULL REFERENCES workers(id)` `ON DELETE RESTRICT` `[architect ajustou: ganha FK → workers(id) p/ integridade referencial + proteção de auditoria; o plano listava só jobs/applications/companies]`. Freela pago; base do RLS worker (`= auth.uid()`). |
| `application_id` | `uuid` | `REFERENCES applications(id)` `ON DELETE SET NULL` (nullable) `[architect ajustou: SET NULL — preserva o recibo se a candidatura sumir]`. Liga ao ciclo/turno específico p/ evidência. |
| `source` | `text` | `NOT NULL CHECK (source IN ('external_pix','cash','other'))`. Método **declarado** (não prova bancária). |
| `amount` | `numeric(12,2)` | `NOT NULL CHECK (amount > 0)`. Valor declarado pago. |
| `paid_at` | `timestamptz` | `NOT NULL`. Quando o pagamento aconteceu (declarado). Carimbo de período do BI (fallback = conclusão). |
| `recorded_by` | `uuid` | `NOT NULL DEFAULT auth.uid()`. Quem registrou (empresa no v1). |
| `worker_confirmed_at` | `timestamptz` | nullable. Se/quando o freela confirmou recebimento (bilateral opcional — ver §4). |
| `note` | `text` | nullable. Observação livre (ex.: "pago em 2x", referência PIX). |
| `status` | `text` | `NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','voided'))`. Correção = estorno lógico (novo status `voided`), **nunca UPDATE destrutivo do valor**. |
| `voided_at` / `void_reason` | `timestamptz` / `text` | nullable. Trilha do estorno lógico. |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()`. |

### Idempotência (Article 9, adaptado — não é `wallet_transactions`)
- **`[architect DECIDIU: UNIQUE PARCIAL]`** `CREATE UNIQUE INDEX ... ON shift_payments (job_id) WHERE status = 'recorded'`. No máximo UMA linha `recorded` por turno; N linhas `voided` permitidas. Um turno é pago por **exatamente uma** fonte ativa no modo A. Casa com o dedupe do BI (`job_id` disjunto entre escrow e marcador; se ambos, escrow tem precedência).
- **Justificativa da decisão:** UNIQUE simples impediria a correção — como correção = estorno lógico (`voided`) + novo registro, o parcial deixa o par estorna-e-recadastra funcionar sem violar a constraint. Não é `wallet_transactions` → não usa `(wallet_id, reference_id)` (Article 9 adaptado).

### RLS (empresa + freela veem o próprio registro)
- **SELECT:** `company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())` **OR** `worker_id = auth.uid()`. Ambos os lados leem — base do recibo bilateral.
- **INSERT:** `WITH CHECK (company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid()))` — só a empresa dona registra (v1). Se produto decidir que o freela também registra, expandir aqui.
- **UPDATE:** restrito ao estorno lógico (`status`, `voided_at`, `void_reason`, e `worker_confirmed_at` pelo freela). **Colunas de valor/fonte/paid_at NÃO são atualizáveis** — imutabilidade. Preferir política de UPDATE mínima + `CHECK`/trigger que rejeite mudança de colunas materiais (architect define a forma: coluna-a-coluna via trigger `BEFORE UPDATE` que compara OLD/NEW, padrão já usado no projeto).
- **DELETE:** **negado** (sem policy DELETE) — auditoria não se apaga; correção via `voided`.
- `REVOKE ALL FROM anon` · `GRANT SELECT, INSERT, UPDATE ON ... TO authenticated` · `GRANT ALL ... TO service_role` (padrão do projeto; service_role para leitura futura do BI/edge, embora o modo A não precise dele para escrever).

### Imutabilidade / auditoria (ADR §2)
- Sem `ON DELETE CASCADE` a partir de tabela financeira (`escrow_transactions`/`wallets` não referenciam esta tabela; a FK vai de `shift_payments → jobs`, não o contrário).
- Correção = novo registro ou `status='voided'` + `void_reason`, nunca UPDATE destrutivo do `amount`/`source`/`paid_at`. Trigger `BEFORE UPDATE` bloqueia mutação das colunas materiais.
- `updated_at` **não** necessário se o registro é imutável salvo estorno; um `voided_at` basta. (Architect confirma.)

---

## 3. Camadas e steps (ordem canônica)

> Ordem: migration → tipos → service → UI (registrar) → recibo → consultabilidade p/ BID. Cada step com arquivo-alvo e tamanho.

### Step 1 — Migration `shift_payments` (+ RLS + imutabilidade) — **M** — gate architect
- **Arquivo:** `supabase/migrations/<ts>_shift_payments.sql` (criar).
- **Conteúdo:** tabela §2, índices (`job_id` UNIQUE/parcial, `company_id`, `worker_id`, `paid_at`), RLS empresa+freela, trigger de imutabilidade, GRANT/REVOKE. **DOWN:** `DROP TABLE IF EXISTS public.shift_payments CASCADE;`
- **Done:** aplica sem erro; empresa insere o próprio registro e lê; freela lê o próprio; nenhum dos dois lê registro do outro (isolamento); UPDATE de `amount`/`source` é rejeitado; DELETE negado; **nenhuma** referência a `wallets`/`escrow_transactions`/RPC de saldo.

### Step 2 — Tipos à mão — **S**
- **Arquivo:** `frontend/src/types/index.ts` (modificar).
- **Conteúdo:** `interface ShiftPayment` (campos §2), `type PaymentSource = 'external_pix' | 'cash' | 'other'`, `type ShiftPaymentStatus = 'recorded' | 'voided'`.
- **Done:** `types/index.ts` reflete o schema; build TS verde.

### Step 3 — Service `paymentRecordService` — **M**
- **Arquivo:** `frontend/src/services/paymentRecordService.ts` (criar). Padrão: `supabase.from(...)` direto (Article 5), `logError`, imports relativos, tipos à mão (espelha `spendLimitService.ts`).
- **API proposta:**
  - `recordExternalPayment({ jobId, workerId, applicationId, source, amount, paidAt, note }): Promise<{ success; payment?; error? }>` — INSERT idempotente (trata violação de UNIQUE `job_id` → retorna `alreadyRecorded`). **Não** toca saldo, **não** chama RPC.
  - `getPaymentByJob(jobId): Promise<ShiftPayment | null>` — para a UI saber se o turno já foi registrado (esconder/mostrar botão) e para o recibo.
  - `getReceipt(paymentId | jobId)` — retorna o marcador + dados de exibição (empresa, freela, turno, valor, fonte, data) para renderizar o recibo (join leve com `jobs`, `companies`, worker profile — só leitura sob RLS).
  - `confirmReceiptByWorker(paymentId)` — seta `worker_confirmed_at` (se produto habilitar confirmação bilateral; senão fica dormant).
  - `voidPayment(paymentId, reason)` — estorno lógico (`status='voided'`).
- **Done:** funções tipadas, sem `any`; registrar e reler funcionam sob RLS; build+lint verdes.

### Step 4 — UI "Registrar pagamento" (empresa) — **M** — gate frontend-reviewer
- **Arquivo:** `frontend/src/pages/company/CompanyJobCandidates.tsx` (modificar) — âncora `handleConfirmDelivery` (linha ~103) e o modal de confirmação de entrega (linha ~503+).
- **Comportamento:**
  - No modo A (default do piloto), **confirmar conclusão NÃO chama `WalletService.releaseOrCaptureEscrow`** — em vez disso apresenta o modal **"Registrar pagamento"**: fonte (`external_pix`/`cash`/`other`), valor (pré-preenchido com o valor do turno), data (`paid_at`, default agora), nota opcional.
  - Ao confirmar → `paymentRecordService.recordExternalPayment(...)` → marca `applications.status='completed'` → toast → oferece "Ver recibo" e o fluxo de avaliação (R10) segue igual.
  - Coexistência: se o turno for de um caminho postpago (`escrow.kind='postpaid'`, opt-in C), manter o caminho de captura atual. A escolha modo A vs C por turno é decisão de produto (§4) — no v1 o default é A. **Não** quebrar o caminho de escrow existente.
  - Design neo-brutalista (Article 13): bordas pretas 2px, sombra offset sólida, caixa-alta nos CTAs, cor empresa. Reusar o estilo do modal de confirmação já presente no arquivo.
- **Guardas de gasto sem lastro:** botão só habilita se o turno está **concluído** (checkout/confirmação — ver §4 sobre pré-requisito); rótulo explícito "Pagamento feito por fora do Worki — registro declaratório".
- **Done:** empresa registra pós-conclusão; botão some/vira "Ver recibo" quando `getPaymentByJob` já retorna registro; sem regressão no caminho escrow.

### Step 5 — Recibo in-app (renderizável) — **M** — gate frontend-reviewer
- **Decisão v1 (proposta):** recibo = **tela in-app renderizável** (rota dedicada), **não** PDF. Conteúdo mínimo:
  - Cabeçalho "RECIBO DE PAGAMENTO — registro Worki (declaratório)".
  - Empresa (nome), Freela (nome), Turno (função, data/hora, local), Valor pago, Fonte declarada (PIX/dinheiro/outro), Data do pagamento (`paid_at`), Identificador do registro (`id` curto), carimbo de emissão.
  - **Disclaimer explícito:** "O Worki registra a declaração de pagamento entre as partes; o dinheiro não passou pela plataforma. Não é documento fiscal." (mitiga o risco de "afirmação de pagamento").
  - Botão imprimir (window.print / CSS print) como aproximação de "salvar PDF" sem lib nova.
- **Arquivo:** `frontend/src/pages/ReceiptView.tsx` (criar, cross-papel — acessível empresa e freela, RLS garante) + rota em `frontend/src/App.tsx` sob `<ProtectedRoute>` (modificar). Rota proposta: `/recibo/:jobId` ou `/recibo/:paymentId`.
- **Done:** empresa e freela abrem o recibo do próprio turno; quem não é parte recebe vazio (RLS); disclaimer presente; layout neo-brutalista imprimível.

### Step 6 — Gasto consultável para o BI (sem tocar BI) — **S**
- **Não** altera `financialBIService.ts` (item #2). Apenas **garante** que o marcador é consultável: índice por `company_id` + `paid_at`, `job_id` disjunto documentado, e um comentário no service/migration apontando o contrato do ADR ("BI-1 soma escrow released/captured ∪ marcador external por `job_id` disjunto; escrow tem precedência em anomalia").
- **Arquivo:** coberto pela migration (índices) + docstring no `paymentRecordService`. Deixa um TODO rastreável para o item #2.
- **Done:** query "gasto externo do período por empresa" roda sob RLS filtrando `paid_at` + `status='recorded'`; documentação do contrato de dedupe presente.

### Step 7 — Testes + smoke — **S/M**
- **Vitest co-located:** `paymentRecordService.test.ts` (idempotência por `job_id`, mapeamento de tipos, rejeição de void inexistente).
- **Smoke manual:** registrar como empresa, ver recibo como empresa e como freela (2 contas), verificar isolamento cruzado, verificar que saldo/`wallets` **não** mudou.
- **Done:** `cd frontend && npm run build` + `npm run lint` verdes (A9).

---

## 4. Decisões de produto a confirmar no HALT

> **✅ HALT RESOLVIDO (2026-06-30, owner):**
> 1. Recibo = **tela in-app + `window.print`** (sem PDF lib).
> 2. **Empresa registra + freela confirma recebimento** (bilateral ATIVO): `worker_confirmed_at` deixa de ser dormant — freela dá 1 toque "recebi". **Não bloqueia** o ciclo/avaliação (é sinal de confiança). RLS de UPDATE deve permitir o freela setar `worker_confirmed_at` no próprio registro.
> 3. Fontes = `external_pix` + `cash` + `other` (proposta mantida).
> 4. Registrar **EXIGE turno concluído** (checkout/confirmação antes de habilitar).
> 5. **1 registro por turno** (`UNIQUE job_id`, índice parcial p/ re-registro após void).
> 6. Recibo **informal**, sem série fiscal (id curto como referência).
> 7. Confirmação bilateral **não bloqueia** ciclo/avaliação.
> 8. Piloto roda **só modo A** (sem toggle de modo no v1).

1. **Recibo = tela in-app (com imprimir) ou PDF gerado?** Proposta: tela in-app + `window.print` no v1 (sem lib de PDF). Confirmar.
2. **Quem registra o pagamento?** Só a empresa (proposta v1) ou o freela também pode registrar/confirmar recebimento? Se bilateral, `worker_confirmed_at` vira fluxo ativo (mitiga "freela alega não-pagamento").
3. **Fontes aceitas:** `external_pix` + `cash` + `other` cobre? Adicionar "transferência bancária" / "cheque"? Proposta: os três + `other` com nota livre.
4. **Registrar pagamento exige turno concluído?** Proposta: sim — exige checkout/confirmação de conclusão antes de habilitar o registro (evita registro sem lastro de trabalho). Confirmar se pode registrar antes (ex.: pago adiantado).
5. **Um registro por turno, ou permitir parcial/múltiplo?** Proposta: **1 por turno** (`UNIQUE job_id`), correção via estorno lógico + novo registro. Confirmar (pagamento em 2x mudaria o modelo para 1:N).
6. **Recibo precisa de número/série fiscal?** Proposta: **não** no MVP — recibo declaratório informal com `id` curto como referência. Confirmar (se precisar de sequência, muda schema).
7. **Confirmação bilateral bloqueia o ciclo/avaliação?** Proposta: **não** — registro e avaliação seguem independentes da confirmação do freela; a confirmação é sinal de confiança, não gate.
8. **Escolha do modo (A vs C) por turno:** no v1 o default é A e não há UI de toggle de modo. Confirmar que o piloto roda **só modo A** por ora (toggle de modo = trabalho separado do ADR §Trabalho subsequente #4).

---

## 5. Risk matrix

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| **Registro sem lastro** — Worki afirma um pagamento que não ocorreu | M | A | Pré-requisito de turno concluído (§4.4); recibo com **disclaimer declaratório** explícito ("dinheiro não passou pelo Worki, não é documento fiscal"); confirmação bilateral opcional do freela (`worker_confirmed_at`) como sinal de verdade. |
| **Freela alega não-pagamento** (sem garantia de recebimento no modo A) | M | M | Confirmação bilateral opcional (freela confirma recebimento); trilha imutável de quem/quando registrou (`recorded_by`, `paid_at`); é a natureza do modo A por decisão do owner (ADR — reabrir postpago é o gatilho se calote virar material). |
| **RLS cruzada empresa/freela** — um lado vê registro do outro | M | A | SELECT restrito a `company owner OR worker_id=auth.uid()`; testar como empresa E como freela com contas distintas; espelhar isolamento; security-reviewer no gate. |
| **Mutação/apagamento de auditoria** (UPDATE destrutivo do valor, DELETE) | B | A | Imutabilidade por trigger `BEFORE UPDATE` (bloqueia colunas materiais); DELETE sem policy (negado); correção só via `voided` + `void_reason`. |
| **Dupla contagem no BI** (turno com escrow E marcador) | B | M | `UNIQUE(job_id)` no marcador; contrato de dedupe do ADR (escrow tem precedência); documentado no Step 6 para o item #2 consumir. |
| **Contaminar o trilho financeiro** (marcador virar linha de escrow) | B | A | Tabela **separada**, sem FK para/de `escrow_transactions`/`wallets`, sem RPC de saldo, sem service_role para escrever — Article 8 intacto (alternativa "escrow com status external" foi **rejeitada** no ADR). |
| **Regressão no caminho postpago (C)** ao alterar `handleConfirmDelivery` | B | M | Ramificar por `escrow.kind`; manter `releaseOrCaptureEscrow` no caminho C; smoke dos dois caminhos; frontend-reviewer. |

---

## 6. Gates (Phase 3.5)

| Gate | Dispara? | Motivo |
|---|---|---|
| **harness-architect** (gate) | **SIM — obrigatório** | Migration nova de **auditoria financeira** (mesmo sem mover saldo). Valida schema/constraints/RLS/imutabilidade de `shift_payments`, o UNIQUE de idempotência (`job_id` vs parcial) e a fronteira "registro ≠ saldo" (Article 8). ADR-mãe já lista isto como "gate architect antes do builder". |
| **harness-security-reviewer** | **SIM** | Toca `supabase/migrations/**` + RLS cruzada empresa/freela + imutabilidade/auditoria + LGPD (dados de pagamento entre pessoas). Verifica isolamento de papel e ausência de service_role no front. |
| **harness-frontend-reviewer** | **SIM** | Toca `pages/company/CompanyJobCandidates.tsx`, nova `pages/ReceiptView.tsx` e `App.tsx` (UI neo-brutalista, isolamento de papel no ProtectedRoute). |
| harness-builder | — | Executa migration (pós-architect), tipos, service; e a UI vai ao **harness-frontend-builder** (Gemini). |

### Sequência de execução sugerida (pós-aprovação)
1. `harness-architect` valida/ajusta o schema §2 → libera a migration.
2. `harness-builder`: Step 1 (migration) → Step 2 (tipos) → Step 3 (service) → Step 6 (índices/docstring) → Step 7 (testes service).
3. `harness-frontend-builder`: Step 4 (registrar) + Step 5 (recibo + rota).
4. Paralelo: `harness-frontend-reviewer` (UI) + `harness-security-reviewer` (migration/RLS) → `harness-evaluator`.

---

## Rollback
`git revert <hash>` + migration DOWN: `DROP TABLE IF EXISTS public.shift_payments CASCADE;`. Sem impacto em saldo/escrow (nenhuma RPC tocada), sem dado financeiro real a reconciliar — só o registro declaratório é descartado.
