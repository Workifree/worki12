# Architecture — Worki

> Como as partes do sistema se compõem. Atualizar quando: introduzir camada, trocar tecnologia macro,
> adicionar serviço externo, mudar o fluxo de pagamento.

## Visão macro

SPA React 19 em Vite, servida pela Vercel como estático. Backend é Supabase (PostgreSQL + PostgREST +
Realtime + Auth + Storage + Edge Functions Deno). Pagamentos são intermediados pelo **Asaas** através de
Edge Functions; uma **carteira central** detém os fundos e o saldo por usuário vive no DB com **escrow**.

O frontend é uma camada fina sobre o Supabase: leituras são `supabase.from(...)` diretas
(`useState`+`useEffect`, sem React Query na prática); operações privilegiadas (pagamentos, admin, exclusão
de conta) passam por Edge Functions. A segurança dura mora em **RLS + RPCs atômicas** no Postgres.

Observabilidade via **Sentry** (erros + user context).

## Request flow

```
Browser (SPA React 19)
   │
   ├─→ React Router (App.tsx, React.lazy + Suspense)
   │      │
   │      └─→ <ProtectedRoute> — sessão (useAuth) + onboarding + isolamento de papel + TOS gate
   │              │
   │              └─→ <MainLayout> (worker) | <CompanyLayout> (empresa)
   │                      │
   │                      └─→ <Página> (pages/ | pages/company/)
   │                              │
   │                              ├─→ leitura: supabase.from('tabela').select() (PostgREST + RLS)
   │                              │
   │                              ├─→ carteira/escrow: walletService.* → RPC atômica no Postgres
   │                              │
   │                              └─→ privilegiado: services/api.ts invokeFunction() → Edge Function (Deno)
   │                                            │
   │                                            └─→ Asaas API (PIX/Boleto/Cartão)  +  service_role no DB
   │
   └─→ Realtime: NotificationContext escuta postgres_changes + canal broadcast 'new_notification'
```

## Camadas e responsabilidades

| Camada | Responsabilidade |
|---|---|
| `App.tsx` / `main.tsx` | Composição — router, providers (Auth, Notification, Toast, QueryClient), bootstrap. |
| `pages/`, `pages/company/`, `pages/worker/` | Telas de rota por papel. Lógica de tela + fetch direto. |
| `components/` | UI reutilizável cross-papel (cards, modais, navegação, guards). |
| `contexts/` | Estado global de sessão, notificações, toasts. |
| `services/` | Lógica de negócio não-UI: `walletService` (escrow prepago/postpago, ramificação por `kind`), `paymentMethodService` (tokenize, capture, release-hold de cartão), `teamConnectionService` (equipe/relações), `shiftInviteService` (convites push), `analytics`, `api` (edge functions). |
| `lib/` | Config e utilitários: `supabase` (client), `gamification`, `validation`, `logger`. |
| `types/` | Contrato de tipos do domínio (à mão — fonte da verdade). |
| `supabase/functions/` | Operações privilegiadas (Asaas, admin, notificações) — Deno + service_role. |
| `supabase/migrations/` | Schema + RLS + RPCs atômicas de escrow/carteira. |

## Camada de relações worker↔empresa (Slice 1: loop relacional)

**Antes do Slice 1:** relação transacional pura via `applications`. Toda interação passava por candidatura/contratação.

**Slice 1 (novo):** camada consentida permanente (`team_connections`):
- Empresa convida worker → status 'pending'
- Worker aceita → status 'accepted' (equipe permanente)
- Worker sai/bloqueia → status 'blocked'

Canais de convite: **link** (token via URL `/convite/:token`), **telefone** (Worki ID manual), **QR** (v1.1).
Após aceitação da equipe, convites de turno seguintes (push via `applications.status='invited'`) não re-pedem handshake
— lista fechada. Política de INSERT em `applications` garante que só membros aceitos podem ser convidados.

## Convite push de turno (Slice 1: operação freelancer)

Novo fluxo coexistente com pull (candidatura):
- **Pull:** worker se candidata a vaga aberta → empresa revisa → contrata (reserve_escrow se pré-pago)
- **Push:** empresa cria `applications` com `status='invited'` para worker da equipe aceita → worker aceita (→'hired')
  ou recusa (→'declined', neutro) → empresa procede (check-in/checkout) ou slot reabre

Máquina de estados: `invited` → `accepted` | `declined`. Aceite seta `status='hired'` (base do ciclo).
Transição validada em `shiftInviteService`, não só em RLS.

**Modelo de pagamento (Slice 1):** o fluxo **push** (criar turno → convite → aceite) **NÃO reserva escrow** — o
trigger `auto_reserve_escrow_on_hire` pula a reserva no aceite de convite (ADR-20260622). Só o **fluxo pull
legado** (candidatura → hired) ainda reserva no aceite (modelo prepago original, inalterado). O pagamento do
push é o **Slice 2: postpago** (cartão on-file + captura na conclusão, sem depósito antecipado).

## Modelo de pagamento (carteira central + escrow + postpago Slice 2)

### Fluxo prepago (Slice 1 — pull legado; intacto)

```
Empresa deposita (PIX) ──→ asaas-deposit ──→ Asaas ──webhook──→ credit_deposit (RPC) ──→ wallets.balance↑ (empresa)
Empresa contrata worker (pull) ──→ reserve_escrow (RPC) ──→ trava saldo em escrow_transactions
Turno confirmado         ──→ releaseEscrow (edge function) ──→ release_escrow (RPC) ──→ credita wallets.balance do worker
Cancelamento             ──→ refund_escrow (RPC, atômico) ──→ devolve saldo à empresa
Worker saca (PIX)        ──→ asaas-withdraw ──→ transferência da conta master ──→ wallets.balance↓ (worker)
```

**Kind:** `escrow_transactions.kind = 'prepaid'` (default histórico).

### Fluxo postpago (Slice 2 — push com cartão on-file; NOVO)

```
Empresa cadastra cartão ──→ asaas-tokenize-card ──→ token opaco Asaas em payment_methods (NUNCA PAN/CVV)
Empresa convida worker ──→ application.status='invited' ──→ Worker aceita (→'hired') ──→ SEM reserva
Worker faz check-in/checkout ──→ Empresa confirma conclusão (confirma turno + autoriza pagamento)
Confirma conclusão ──→ asaas-authorize-payment ──→ authorize_escrow_postpago (RPC, pré-autorização/hold) ──→ escrow.status='authorized'
Captura autorização ──→ asaas-capture-payment ──→ capture_escrow_postpago (RPC) ──→ escrow.status='captured' + credita worker
Cancelamento/no-show ──→ asaas-release-hold ──→ release_hold_postpago (RPC, type='escrow_void') ──→ devolve crédito à empresa
```

**Kind:** `escrow_transactions.kind = 'postpaid'`. Fluxo: `authorized` → `captured` → `released`, ou `authorized` → `refunded` (cancel).

### Estrutura de dados

- **`payment_methods`** (nova tabela): `(id, company_id, asaas_credit_card_token, brand, last4, is_default, created_at)`.
  RLS por `company_id`. NUNCA carrega PAN/CVV (Article 10).
- **`escrow_transactions`** (estendida):
  - `kind`: `'prepaid'` (default) | `'postpaid'`
  - `status`: `'reserved' | 'authorized' | 'captured' | 'released' | 'refunded'`
  - `asaas_payment_id`: id do hold/charge no Asaas (NULL para prepago)
  - `authorized_at`, `captured_at`: timestamps das transições
- **`wallet_transactions`** (novo type): `'escrow_authorize'` | `'escrow_void'` para rastrear holds.

### Princípios

- **Carteira central:** uma conta master Asaas; NÃO há subcontas. Saldo por usuário é só DB.
- **Atomicidade:** todas as operações de escrow (reserve/release/authorize/capture/release_hold/refund) são RPCs Postgres atômicas.
- **Idempotência:** `wallet_transactions` UNIQUE `(wallet_id, reference_id)` evita crédito duplicado. Postpago usa `reference_id` estável
  (`job_id:worker_id:attempt_#`) para retry-safe.
- **Taxa de plataforma:** 5% no saque (worker), TBD no escrow (empresa).
- **Coexistência:** prepago e postpago rodam em paralelo por `kind`. Ramificação acontece em `walletService.releaseOrCaptureEscrow(jobId, workerId, kind)`
  que despacha para `asaas-checkout` (prepago) ou `asaas-capture-payment` (postpago).

## Segurança

- **RLS é a primeira linha de defesa** — filtros no client são só UX. Toda tabela tem políticas por papel.
- **Isolamento de papel** no frontend via `ProtectedRoute` (worker ⇎ company) — espelha o RLS do DB.
- **`service_role` nunca no frontend** — só dentro de Edge Functions (`Deno.env`).
- **CORS:** toda Edge Function trata preflight `OPTIONS`; funções Asaas aceitam origens de prod + local
  (`localhost:5173`).
- **JWT:** `asaas-webhook` e `admin-data` fazem deploy `--no-verify-jwt` (webhook não traz JWT Supabase;
  admin-data tem checagem própria). As demais validam o JWT do gateway.

## Rating bidirecional (Slice 1: confiança)

Worker avalia company e vice-versa. Implementado via coluna `reviews.direction` ('worker' | 'company'):
- `direction='worker'` → company avalia worker → atualiza `workers.rating_average/reviews_count` (trigger `update_worker_rating_on_review`)
- `direction='company'` → worker avalia company → atualiza `companies.rating_average/reviews_count` (trigger `update_company_rating_on_review`)

Antes de Slice 1, ambos os reviews iam para a mesma tabela; inferencialmente "o id não existia em workers" era tratado como
empresa, mas sem explicitação. Slice 1 torna direction mandatório e consultável. Trigger `set_review_direction()` (BEFORE INSERT)
auto-preenche direction pela presença do `reviewed_id` em companies/workers, mantendo compatibilidade com clients que não enviam
direction. Backfill resolveu reviews legados (≥2 migrations para worker e company ratings).

## Camada de inteligência financeira (Slice 3: operação)

Empresa acessa BI sobre gasto mensal, horas por freela, ratio de custo, no-show estimado e concentração de horas (risco de vínculo).

**Tabelas novas:**
- **`company_spend_limits`** — teto de gasto mensal por empresa (scope='' = empresa inteira em v1). Campos: `amount`, `alert_thresholds` (default [80,90,100]), `financial_contact_email/phone`. RLS por owner. Não toca saldo (Article 8).
- **`company_monthly_revenue`** — faturamento mensal declarado pela empresa (input para custo-%-faturamento). Campo: `amount`, `year_month` (DATE ancorada no dia 1). RLS por owner.

**Policy adicional:**
- **`notifications` INSERT** — nova policy `WITH CHECK (auth.uid() = user_id)` (migration 20260623000200) destrava a inserção de alerta in-app pelo cliente (spendLimitService.evaluateSpendAlert).

**Fluxo de alerta (R12):**
1. Empresa configura teto em `company_spend_limits` (RLS permite owner criar/editar).
2. Alerta é **best-effort, post-pagamento:** após releaseEscrow bem-sucedido, chama `spendLimitService.evaluateSpendAlert` (não bloqueia).
3. Service computa gasto acumulado (BI-1) via query direto em `escrow_transactions` (não materializado), compara com teto.
4. Se cruzou limiar (80/90/100 ou OVER), insere notificação idempotente em `notifications` com link estável `/company/financeiro?alert=<companyId>:<YYYYMM>:<threshold>`.
5. Idempotência: SELECT-before-INSERT verifica link existente antes de inserir.
6. Notificação chega em tempo real via Realtime (NotificationContext).
7. WhatsApp = Slice 4 (pendente).

**BI (Business Intelligence) — derivado de escrow_transactions, sem views:**
- **BI-1: Gasto acumulado** — SUM(amount) WHERE status IN ('released','captured') no período (COALESCE(captured_at, released_at, created_at)).
- **BI-2: Gasto + horas por freela** — agrupado por worker_id. Horas reais se checkout_at/checkin_at existem; fallback jobs.estimated_hours.
- **BI-3: Ratio custo/hora + custo-%-faturamento** — custo/horas; custo/faturamento declarado (null se não informado).
- **BI-4: Custo de no-show estimado** — heurística v1, rotulado como estimativa (application com status='hired'/invitation_response='accepted', turno passou, sem checkout).
- **BI-5: Flag de concentração de horas/dias** — worker flagged se >= 150h AND >= 20 dias (constantes de produto em service, não DB). Sinaliza risco de vínculo trabalhista.

**Services:**
- **`spendLimitService`** — CRUD de teto + revenue, `evaluateSpendAlert(companyId, now?)` idempotente (fora da RPC, best-effort).
- **`financialBIService`** — 4 queries paralelas (getAccumulatedSpend, getSpendByWorker, getCostRatio, getNoShowCost, getConcentrationFlags), método `getAllBI` reutiliza para evitar dupla execução. Sem React Query (Article 5).

**UI:**
- Nova página `pages/company/CompanyFinancial` (`/company/financeiro`) com cards de BI, alertas, input de faturamento, config de teto.

## Dependências externas

| Dependência | Uso | Crítico? |
|---|---|---|
| Supabase | Backend completo (DB, auth, realtime, storage, functions) | Sim |
| Asaas | Pagamentos (PIX/Boleto/Cartão), carteira master | Sim — sem Asaas, sem fluxo financeiro |
| Vercel | Hosting do frontend (`worki-opal.vercel.app`) | Sim — deploy alvo |
| Sentry | Observabilidade de erros | Não — degrada silenciosamente |
| Anthropic / Claude Code | Implementação (orquestrador deste harness) | Não-runtime; só desenvolvimento |

## Pontos de extensão

- **Nova página:** criar em `pages/` (worker) ou `pages/company/` (empresa); registrar rota em `App.tsx`
  sob `ProtectedRoute`; adicionar ao `Sidebar`/`BottomNav` se navegável.
- **Nova tabela:** migration com RLS + (se mexe em saldo) RPC atômica com `GRANT EXECUTE`; atualizar
  `types/index.ts` à mão.
- **Nova operação privilegiada:** nova Edge Function (CORS preflight + validação de auth + Asaas se aplicável).
- **Nova notificação:** inserir em `notifications` (dispara Realtime) ou via `send-notification`.

## Pontos sensíveis (exigem ADR antes de mudar)

- Substituir Supabase por outro backend.
- Reintroduzir qualquer gateway além do Asaas (Stripe foi removido por decisão do owner).
- Adotar subcontas Asaas em vez da carteira central.
- Mudar o contrato das RPCs de escrow ou a constraint de idempotência de `wallet_transactions`.
- Mover lógica privilegiada do Edge Function para o frontend.
- Trocar o modelo de isolamento de papel (worker/company).
- Mudar a direção postpago (Slice 1) para prepago — Slice 2 trata dessa migração.
