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
| `services/` | Lógica de negócio não-UI: `walletService` (escrow prepago/postpago, ramificação por `kind`), `paymentMethodService` (tokenize, capture, release-hold de cartão), `paymentRecordService` (modo A — registro de pagamento externo, sem mover saldo), `teamConnectionService` (equipe/relações), `shiftInviteService` (convites push), `analytics`, `api` (edge functions). |
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

**Guarda de consentimento no DELETE (migração `20260816000000`):** A política UPDATE já impedia a empresa de mudar `status='blocked'`,
mas DELETE não tinha a mesma proteção — a empresa podia deletar a linha bloqueada e reconvidar, anulando o veto do freela.
A policy `tc_delete_company` passou a exigir `(status <> 'blocked' OR blocked_by = auth.uid())`: apenas a pessoa que gravou o bloqueio
pode deletá-lo. Veto do freela é indelével para a empresa; bloqueio feito pela própria empresa pode ser removido (evita auto-trancamento).

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

## Cancelamento de turno (Slice 5: notificação obrigatória — bidirecional desde 20260816)

**Antes (até 20260714):** só o worker podia cancelar turno após aceite (status `hired` | `in_progress` → `cancelled`).

**Agora (20260816150000):** tanto **worker** quanto **empresa** podem cancelar:
- **Worker:** cancela convite/turno (`cancelApplication` em client) → empresa é notificada (título: "Turno cancelado pelo freela").
- **Empresa:** desfaz convite (`cancelInvite` no `shiftInviteService`, estado `invited`) ou dispensa do turno (`dismissFromShift`,
  estados `hired`/`in_progress`) → **freela é notificado** (título diferenciado: "Convite de turno cancelado" se era `invited`,
  "Turno cancelado pela empresa" se era `hired`/`in_progress`).
- **Ator desconhecido** (service_role, `delete-account`, cron): **ambos** são notificados com texto neutro
  ("O turno foi cancelado"), sem atribuir culpa.

**Trigger `trg_notify_counterpart_on_application_cancel` (SECURITY DEFINER, search_path='', migração 20260816150000):**
Substitui o antigo `trg_notify_company_on_worker_cancel` (20260714). Ramifica por `auth.uid()`:
```
AFTER UPDATE ON applications
WHEN (NEW.status='cancelled' AND OLD.status IN ('invited', 'hired', 'in_progress'))
→ Se auth.uid() = NEW.worker_id:     INSERT para empresa (link: '/company/jobs/<job_id>/candidates')
→ Se auth.uid() = jobs.company_id:  INSERT para freela (link: '/my-jobs')
→ Se auth.uid() IS NULL (ator desconhecido): INSERT para AMBOS
```

**Conhecimento reutilizável:** `auth.uid()` **funciona corretamente** dentro de `SECURITY DEFINER` (o DEFINER muda o ROLE de execução,
não as claims do JWT que vivem em `request.jwt.claims`). Precedentes: `validate_application_update`, `enforce_shift_payment_immutability`.

**Guarda em `dismissFromShift`:** não se pode dispensar um freela que já tem `shift_payments` ativo (`scheduled`/`recorded`), 
porque o UNIQUE parcial `(job_id, worker_id) WHERE status IN ('scheduled','recorded')` barra um novo marcador para o mesmo freela+turno.
Empresa precisa estornar o pagamento antigo (voided) primeiro, ou dispensar outro freela.

**Princípio:** saldo intacto (Article 8) — refund de escrow (Slice 1 prepago) é manual, disparado por empresa via
`refundEscrow` se desejado. Cancelamento não toca `shift_payments` — empresa estorna em operação separada.

## Modelo de pagamento (carteira central + escrow + postpago Slice 2)

> ⚠️ **REVISADO por ADR-20260630-pagamento-opcional-piloto (2026-06-30).** No piloto o pagamento pelo Worki é
> **OPCIONAL**. Três modos coexistem: **(A) pagamento externo registrado** — default do piloto, Worki registra
> PIX/dinheiro fora + recibo, **sem mover saldo** (novo marcador de pagamento por turno, fora de
> `escrow_transactions`); **(B) PIX-único → distribuição** — conveniência opt-in, 1 PIX da empresa distribuído
> a N freelas via RPC atômica idempotente; **(C) postpago cartão on-file** — o fluxo descrito abaixo, agora
> **opt-in / semente da expansão**, não o trilho padrão. Article 8/9 seguem valendo para B/C (todo movimento
> de saldo por RPC atômica). O modo A não toca saldo. O BI de gasto passa a unir escrow (B/C) + marcador (A).
> Diagramas abaixo = caminho postpago histórico, preservado.

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

- **`workers.pix_key`** (coluna existente, agora central no modo A): chave PIX do freela (CPF/CNPJ/e-mail/telefone/aleatória), coletada no onboarding
  (`WorkerOnboarding` R1.1) e normalizada (`normalizePixKeyForStorage` em `lib/validation.ts`). Exibida para empresa com `team_connections` aceita/pendente (R1.2, R1.3) 
  e no modal de "Registrar Pagamento" (R1.4). **Jamais** exposta a quem não tem vínculo (policy de SELECT em `workers` bloqueia).
- **`payment_methods`** (nova tabela): `(id, company_id, asaas_credit_card_token, brand, last4, is_default, created_at)`.
  RLS por `company_id`. NUNCA carrega PAN/CVV (Article 10).
- **`shift_payments`** (modo A — pagamento externo registrado): `(id, job_id, worker_id, company_id, application_id, amount, source, paid_at, status, scheduled_for, recorded_by, worker_confirmed_at, voided_at, void_reason, note, created_at)`.
  Status: `scheduled | recorded | voided`. `scheduled_for` (data prevista) é material/imutável; `paid_at` é nullable (NULL em scheduled, setado na efetivação) e depois imutável.
  UNIQUE parcial `(job_id, worker_id) WHERE status IN ('scheduled','recorded')` — garante 1 marcador ativo por (turno, freela). Turno com N freelas tem N marcadores, um por freela. ADR-20260816.
  RLS bilateral: empresa (registra/efetiva/cancela), worker (confirma recebimento em recorded). **NUNCA toca saldo** (auditoria, não liquidação).
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

## Agregados do worker (Slice 4: engajamento)

Campos derivados (`xp`, `level`, `completed_jobs_count`, `earnings_total`) são **recomputados canonicamente** por uma única função Postgres
`recompute_worker_aggregates(worker_id)` (SECURITY DEFINER, search_path='', idempotente).

**Fórmula (XP):** `xp = completed_jobs_count * 100 + profile_bonus`
- `completed_jobs_count` = COUNT de `applications` com `status='completed'` (source de verdade)
- `profile_bonus` = 50 (foto/avatar_url) + 75 (especialidades: primary_role OU roles array) = até +125
- `level` derivado via função `worker_level_for_xp(xp)`
- `earnings_total` = SUM dos budgets dos turnos concluídos (agregado de exibição, não saldo — Article 8 intacto)

**Fontes de chamada:**
1. **Trigger `trg_worker_completion_aggregates` (AFTER INSERT/UPDATE OF status ON applications WHEN status→'completed')** — empresa conclui turno, recomputa do worker.
2. **Cliente via `recompute_my_aggregates()` (SECURITY DEFINER)** — após worker editar foto/especialidades no perfil (mudou bônus).

**Segurança:**
- `recompute_worker_aggregates(uuid)` é SECURITY DEFINER com search_path='', **sem GRANT a PUBLIC/anon/authenticated** — só service_role e trigger interno.
- Cliente acessa via wrapper `recompute_my_aggregates()` (auth-scoped, trabalha sobre `auth.uid()` apenas) — GRANT EXECUTE TO authenticated.
- Landmine corrigido: trigger legado `award_xp_on_job_completion` NÃO era SECURITY DEFINER → quando a empresa concluía o turno, o RLS bloqueava o UPDATE em workers (invoker não tinha permissão na linha do worker) = causa real de "XP não sobe"; **foi removido** e substituído pelo novo que é DEFINER.

## Pagamento agendado (Slice 3: modo A pós-turno)

`shift_payments` (modo A — pagamento externo registrado) ganhou suporte a **agendamento** com status `scheduled` + data prevista.

**Máquina de estados (mesma linha):**
```
INSERT → scheduled (promessa) ──efetivar──► recorded (realizado) ──estornar──► voided
             │                                                                   ▲
             └─────────────────── cancelar ───────────────────────────────────┘
INSERT → recorded (direto legado) ──estornar──► voided
```

**Colunas novas:**
- `scheduled_for date` — data prevista do pagamento (imutável; reagendar = void + novo). NULL em registros diretos (`recorded` sem agendamento prévio).
- `paid_at` — agora **NULLABLE** (era NOT NULL). NULL enquanto `scheduled`; setado **UMA vez** na efetivação (`scheduled→recorded`) e depois imutável. Timestamps reais (nunca data futura disfarçada).

**Dedupe:** UNIQUE parcial `(job_id, worker_id) WHERE status IN ('scheduled','recorded')` = **um marcador ativo por (turno, freela)**, impedindo duas promessas ou promessa+pagamento **do mesmo freela** no mesmo turno. N linhas `voided` permitidas (re-agendar/re-registrar). Turno com N freelas tem N marcadores. ADR-20260816.

**Trigger `enforce_shift_payment_immutability` reescrito:**
- Material columns (job_id, company_id, worker_id, application_id, source, amount, recorded_by, note, created_at, **scheduled_for**) → imutáveis sempre.
- `paid_at` → imutável, EXCETO na única transição permitida: `scheduled→recorded` (NULL→data real, uma vez).
- Transições válidas (só empresa): `scheduled→recorded` (efetivar), `scheduled→voided` (cancelar), `recorded→voided` (estornar). Qualquer outra é rejeitada.
- Partição por papel: empresa efetiva/cancela/estorna; worker só confirma recebimento em `recorded`.

**BI e comprovante:**
- BI de gasto conta **SÓ** `recorded` (promessa ≠ liquidação — `scheduled` não infla gasto).
- `ReceiptView` reutilizável: ramifica por status (scheduled → "Comprovante de Agendamento", recorded → recibo bilateral).
- ZERO impacto em saldo/escrow/RPC — Article 8 intacto.

## Briefing padrão (Slice 3: operação)

`companies.default_briefing` (text, nullable) — a empresa cadastra UMA vez o briefing padrão do negócio (ex.: "calça jeans, barba feita, camisa branca").
Ao criar um turno, pré-preenche o campo Briefing; empresa ajusta/incrementa por turno (ex.: "camisa verde" para estoquista). Simples editável, NÃO toca saldo (Article 8).

## Segurança

- **RLS é a primeira linha de defesa** — filtros no client são só UX. Toda tabela tem políticas por papel.
- **Isolamento de papel** no frontend via `ProtectedRoute` (worker ⇎ company) — espelha o RLS do DB.
- **`service_role` nunca no frontend** — só dentro de Edge Functions (`Deno.env`).
- **CORS:** toda Edge Function trata preflight `OPTIONS`; funções Asaas aceitam origens de prod + local
  (`localhost:5173`).
- **JWT:** `asaas-webhook` e `admin-data` fazem deploy `--no-verify-jwt` (webhook não traz JWT Supabase;
  admin-data tem checagem própria). As demais validam o JWT do gateway.

### SELECT em `workers` restrito por vínculo (Onda 1 — Revisão Piloto)

Migração `20260816120000` substituiu `USING (true)` por `USING (public.can_view_worker_profile(id))`. A tabela `workers` carrega dado sensível
(CPF, telefone, PIX, data de nascimento) — **qualquer conta autenticada podia varrer a base inteira**. A nova policy restringe a leitura a três branches:

1. **Self:** o próprio freela lê a própria linha (Profile, Dashboard, onboarding, Sidebar, etc.). Mantém `select('*')` funcionando.
2. **Vínculo de elenco:** empresa com `team_connections` status `'pending'` ou `'accepted'` com este freela. `'blocked'` (veto do freela) **NÃO** concede leitura.
3. **Vínculo operacional:** empresa que tem `applications` do freela em um turno dela (pull OU push — ambos criam linha). Cobre CompanyJobCandidates, relatório de ordens, BI financeiro, recibos históricos.

**Efeito colateral:** DELETE/UPDATE sob RLS que não casa com USING retorna 0 linhas sem erro, não EXCEPTION. O padrão
`removeFromTeam(workerId)` em `teamConnectionService` exige `.select('id')` (sem `maybeSingle()`) e checa `!data || data.length === 0` para distinguir "removido com sucesso" de "negado por RLS".

**RPC de leitura `get_profile_reviews(reviewed_id, direction)` (migração `20260816130000`):** com a política nova, um freela lendo reviews de uma empresa
(no perfil público da empresa) não conseguia resolver os nomes de freelas que avaliaram — sua policy impedia ler linhas de outros freelas.
`get_profile_reviews` é SECURITY DEFINER e resolve nomes sem expor dados pessoais (mascaramento: "Carlos S." para terceiros, nome completo só para o dono do perfil).

## Notificações de pagamento (Onda 1 — Revisão Piloto, modo A)

O modo A (pagamento externo registrado) é **loop bilateral:** empresa declara pagamento em `shift_payments` e freela confirma recebimento.
Antes, o side do freela nunca era avisado — faltava aviso de "pagamento foi registrado, confirme no recibo". Sem isso, o loop só fecha se freela
abrir `/recebimentos` por conta própria.

**Migração `20260816140000` — função `notify_worker_on_shift_payment()` (SECURITY DEFINER, search_path=''):**
Dispara em 4 eventos distintos via 2 triggers (INSERT e UPDATE):

| Evento | Transição | Título | Link | Mensagem |
|---|---|---|---|---|
| Agendamento | INSERT com status='scheduled' | "Pagamento agendado" | `/recibo/:job_id` | "agendou o pagamento de R$ X para DATA. Você não precisa fazer nada agora." |
| Registro | INSERT com status='recorded' | "Pagamento registrado — confirme" | `/recibo/:job_id` | "registrou o pagamento de R$ X... Abra o recibo e confirme." |
| Efetivação | UPDATE `scheduled→recorded` | "Pagamento efetivado — confirme" | `/recibo/:job_id` | "marcou como pago o valor de R$ X... Abra o recibo e confirme." |
| Estorno | UPDATE `{scheduled\|recorded}→voided` | "Agendamento cancelado" / "Registro estornado" | `/recebimentos` | "cancelou o agendamento" / "estornou o registro"... |

**Por que `/recebimentos` no estorno (não `/recibo/:job_id`):** A rota `getReceipt()` filtra por `status IN ('scheduled','recorded')`;
uma linha `voided` devolveria tela vazia naquele link. Usar `/recebimentos` (lista de pagamentos históricos) oferece contexto útil.

**Por que trigger (não INSERT no client):** A policy vigente permite empresa notificar worker com `team_connections.status='accepted'`,
mas se o freela **sair do Elenco ou bloquear** a empresa depois do turno, o INSERT seria negado silenciosamente — exatamente para quem
tem atrito e mais precisa da trilha. Trigger SECURITY DEFINER não passa por essa RLS, garantindo a notificação.
**Landmark pattern:** notificação à contraparte = garantia do produto, não cortesia da UI — mesmo de `trg_notify_counterpart_on_application_cancel`.

## Rating bidirecional (Slice 1: confiança)

Worker avalia company e vice-versa. Implementado via coluna `reviews.direction` ('worker' | 'company'):
- `direction='worker'` → company avalia worker → atualiza `workers.rating_average/reviews_count` (trigger `update_worker_rating_on_review`)
- `direction='company'` → worker avalia company → atualiza `companies.rating_average/reviews_count` (trigger `update_company_rating_on_review`)

Antes de Slice 1, ambos os reviews iam para a mesma tabela; inferencialmente "o id não existia em workers" era tratado como
empresa, mas sem explicitação. Slice 1 torna direction mandatório e consultável. Trigger `set_review_direction()` (BEFORE INSERT)
auto-preenche direction pela presença do `reviewed_id` em companies/workers, mantendo compatibilidade com clients que não enviam
direction. Backfill resolveu reviews legados (≥2 migrations para worker e company ratings).

## Perfil público da empresa (Onda 1 — Revisão Piloto)

Nova rota **`/empresa/:id`** (`pages/CompanyPublicProfile.tsx`) sob `<MainLayout>` (papel worker), fora de `/company/*`.
Exibe: nome, logo, capa, setor, descrição, endereço, briefing padrão, avaliações recebidas de freelas (via `components/ProfileReviews` com `reviewerRole="worker"`).
**Objetivo:** o freela consegue abrir o perfil da empresa a partir do convite pendente (`InviteTakeover`), da **Carteira de Clientes** (lista de empresas em `team_connections`),
ou do cabeçalho do chat, **antes de aceitar** o convite — assimetria de confiança que equilibra o fluxo push.
Gera prova social: "o que outros freelas disseram sobre esta empresa?" (via `get_profile_reviews` com mascaramento de nomes de avaliadores).

## Estado do banco de produção (Onda 1 — Revisão Piloto)

As migrations da Onda 1 (revisão pré-piloto) foram aplicadas em produção (`vrklakcbkcsonarmhqhp`) no dia 16/08/2026.
Ver `supabase/migrations/APLICACAO-2026-08-16.md` para: divergência de timestamp entre repositório e histórico do banco,
verificações executadas contra dados reais, e lacunas declaradas (ramo de vínculo operacional não exercitado, funções legadas fora do escopo).

Próximas mudanças de schema/RLS/RPC exigem revisão deste estado.

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
- Tornar o pagamento pelo Worki **obrigatório** de novo (reabrir postpago/hold como default), criar o marcador
  de pagamento externo, ou a RPC de distribuição PIX-único — ver ADR-20260630 (pagamento opcional no piloto)
  e seus gatilhos de reabertura.
