# Glossary — Worki

> Termos de domínio (pt-BR). Subagents leem isto para não perguntar o óbvio nem inventar nomes.
> Adicionar termo quando um conceito novo de negócio aparecer.

**Worker (trabalhador)** — Usuário que executa diárias/freelas. Tabela `workers`. Cor verde `#00A651`.
Tem nível/XP (gamificação), verificação de identidade, carteira própria.

**Company (empresa)** — Usuário que publica vagas e contrata. Tabela `companies`. Cor azul `#2563EB`.
Deposita na carteira, contrata (dispara escrow), confirma conclusão.

**Job (vaga/turno)** — Publicação de trabalho criada pela empresa. Tabela `jobs` (title, description,
location, start_date, budget, company_id, views, candidates_count).

**Application (candidatura / convite)** — Vínculo worker↔job. Tabela `applications` (job_id, worker_id, status,
`worker_checkin_at`, `company_checkout_confirmed_at`, `invited_by_company_at`, `invitation_response`, `invitation_expires_at`).
Carrega o ciclo de check-in/checkout. Status pode ser 'pending' (candidatura), 'invited' (convite push da empresa),
'declined' (recusa neutra), ou fases do ciclo ('hired', 'in_progress', 'completed', etc.).

**Carteira (wallet)** — Saldo do usuário no DB. Tabela `wallets` (user_id, balance, user_type, asaas_customer_id).
NÃO é subconta Asaas — é só registro no DB sobre a carteira central.

**Carteira central / conta master** — A única conta Asaas que detém os fundos de todos. Saldo por usuário
é derivado no DB, não no Asaas.

**Escrow (garantia)** — Mecanismo que trava o valor da empresa até a conclusão do trabalho, então libera ao
worker. Tabela `escrow_transactions` (job_id, application_id, amount, status: `reserved|released|refunded`).

**Reserve / Release / Refund** — Operações de escrow, sempre atômicas (RPCs `reserve_escrow`,
`release_escrow`, `refund_escrow`). Reserve trava saldo da empresa; release credita o worker; refund devolve à empresa.

**⚠️ Depósito (deposit) — REMOVIDO (piloto)** — Antes da Onda 2 do piloto, era top-up da carteira da empresa via Asaas (PIX/Boleto/Cartão) para prefundir escrow. Edge function `asaas-deposit` + RPC `credit_deposit`. No piloto (Onda 2), modo A é pagamento externo registrado, sem dinheiro na plataforma.

**Saque (withdraw)** — Worker transfere saldo para conta/PIX própria via `asaas-withdraw` (transferência da
conta master). Taxa de plataforma de 5%.

**Check-in / Checkout** — Marca presença no turno. Worker faz check-in (`worker_checkin_at`); empresa confirma
o checkout (`company_checkout_confirmed_at`) → libera escrow. Pode cruzar a meia-noite (já tratado).

**Asaas** — Gateway de pagamento brasileiro, **único** da plataforma (Stripe foi removido). Helper em
`supabase/functions/_shared/asaas.ts`.

**RPC atômica** — Função Postgres que muda saldo de forma transacional. Requer
`GRANT EXECUTE ... TO service_role, authenticated`. Ex.: `update_wallet_balance`, `credit_deposit`.

**RLS (Row Level Security)** — Políticas de acesso por linha no Postgres. Primeira linha de defesa; filtro no
client é só UX.

**Isolamento de papel** — Worker e company não acessam as rotas/dados um do outro. Garantido por
`ProtectedRoute` (frontend) + RLS (DB).

**TOS gate** — Bloqueio de acesso até o usuário aceitar os Termos (`accepted_tos`). Implementado em
`ProtectedRoute` + `TosGateModal`.

**Onboarding** — Fluxo inicial separado por papel (`WorkerOnboarding`/`CompanyOnboarding`). `onboarding_completed`
controla o redirecionamento.

**Gamificação** — XP/níveis do worker. `frontend/src/lib/gamification.ts` (LEVELS, calculateLevel, addXP).

**Match score** — Pontuação de aderência worker↔vaga exibida no `JobCard`.

**Notificação** — Registro em `notifications`; entregue em tempo real via `NotificationContext` (Supabase
Realtime `postgres_changes` + canal broadcast `new_notification`).

**Chat / Mensageria** — Conversa worker↔empresa. O frontend usa a tabela **`Conversation`** (capital C),
não `messages` (`supabase.from('Conversation')` em `hooks/useJobApplication.ts`, `pages/company/CompanyJobCandidates.tsx`).
Telas: `Messages` (worker) e `CompanyMessages` (empresa). Há uma tabela `messages` no DB, mas o chat usa `Conversation`.

**`service_role`** — Chave privilegiada do Supabase. NUNCA no frontend; só em Edge Functions.

**`--no-verify-jwt`** — Flag de deploy de Edge Function que dispensa o JWT do gateway Supabase. Usada em
`asaas-webhook` (Asaas não envia JWT) e `admin-data` (tem auth própria).

**Team connections (conexões de equipe)** — Aresta consentida empresa↔worker (tabela `team_connections`). 
Modelo handshake 1x: empresa adiciona freela via link/QR/telefone → status 'pending'; freela aceita → 'accepted'; 
freela pode sair/bloquear → 'blocked'. Convites de turno posteriores não re-pedem handshake (lista fechada).

**Convite push / convite de turno** — Empresa cria application com status='invited' para worker da sua equipe 
(pré-existente em `team_connections`). Worker aceita (→'hired') ou recusa (→'declined', neutro). Pull (candidatura) 
e push (convite) coexistem: pull = worker se candidata; push = empresa convida conhecida.

**Convite por link / token** — Empresa gera link de convite de equipe (token gerado pelo `TeamConnectionService`); 
worker clica, autoriza (`/convite/:token`), entra na equipe accepted. Slice 1 também suporta convite por telefone (Worki ID) 
e QR (v1.1).

**Postpago (Slice 2)** — Modelo de pagamento para turno via convite push: empresa cadastra cartão on-file (tokenização Asaas),
convida freela (sem reserva de saldo antecipado); no aceite, nada muda; na conclusão, autoriza um hold (pré-autorização)
no cartão, depois captura o pagamento transferindo o valor ao worker. Coexiste com prepago (pull legado).
Tabela `escrow_transactions.kind='postpaid'`; estados `authorized` → `captured` → `released` ou `authorized` → `refunded`.

**Pré-autorização / Hold (autorizeOnly)** — Bloqueio temporário de crédito no cartão (Asaas `authorizeOnly=true`).
Não debita na hora; expira em 24-72h se não capturado. Slice 2 usa hold + captura para garantir
que o crédito ao worker só ocorre quando o turno é confirmado (segurança contra chargebacks).

**Captura (capture)** — Transformação de um hold autorizado em cobrança real. `asaas-capture-payment` invoca
Asaas `POST /payments/{id}/capture` → RPC `capture_escrow_postpago` credita worker. Idempotente.

**`payment_methods`** — Tabela com métodos de pagamento on-file da empresa. Campos: `id, company_id, asaas_credit_card_token,
brand, last4, is_default`. NUNCA carrega PAN ou CVV (Article 10 — PCI). Token é opaco, gerado pelo Asaas.

**Escrow `kind`** — Campo em `escrow_transactions` indicando tipo: `'prepaid'` (pull legado, saldo pré-depositado) ou 
`'postpaid'` (push Slice 2, hold no cartão). Determina o fluxo de pagamento (`walletService.releaseOrCaptureEscrow` ramifica por `kind`).

**Escrow `status` postpago** — Estados no fluxo postpago: `'authorized'` (hold criado), `'captured'` (cobrança real),
`'released'` (crédito transferido ao worker), `'refunded'` (hold cancelado em no-show/cancelamento).
Prepago usa `'reserved' | 'released' | 'refunded'` (sem authorized/captured).

**`escrow_void`** — Tipo de `wallet_transactions` novo no Slice 2. Registra a reversão de um hold não capturado
(cancel/no-show). Move crédito de volta à empresa.

**Review direction (direção de avaliação)** — Campo em `reviews.direction` ('worker' | 'company') indicando quem é avaliado.
Possibilita rating bidirecional: worker avalia company (→direction='company'); company avalia worker (→direction='worker').
Triggers de rating (`update_worker_rating_on_review`, `update_company_rating_on_review`) atualizam a tabela correta.

**⚠️ Teto de gasto / Spend limit — REMOVIDO (piloto)** — Antes da Onda 2, era limite mensal em `company_spend_limits`. Alerta in-app via `spendLimitService`. Reabertura: opt-in por gatilho do ADR-20260630.

**⚠️ BI (Business Intelligence) — REMOVIDO (piloto)** — Página `/company/financeiro` e services `financialBIService`/`spendLimitService` foram removidos na Onda 2. Indicadores derivados (BI-1 a BI-5) estão documentados em `patterns.md` como histórico. Reabertura: opt-in futuro.

**⚠️ company_monthly_revenue — REMOVIDO (piloto)** — Antes: tabela com faturamento declarado pela empresa (input para BI-3). Não toca saldo (Article 8). Reabertura: opt-in futuro se BI-3 for reaberto.

**⚠️ Idempotência de alerta (Slice 3) — REMOVIDO (piloto)** — Padrão histórico em `/company/financeiro?alert=<companyId>:<YYYYMM>:<threshold>`. Alerta de teto não existe mais na Onda 2.

**Modo A / Pagamento externo registrado (Slice 3)** — Default do piloto (ADR-20260630). Empresa paga worker direto
(PIX/dinheiro, fora do Worki); o Worki registra o pagamento em `shift_payments` (marcador de auditoria, SEM mover saldo).
Confirmação bilateral: empresa declara → worker confirma no recibo (`ReceiptView`). **Nunca toca `wallets` ou `escrow_transactions`.**

**Modo B / PIX-único → distribuição (Slice 3 futuro)** — Opt-in de conveniência. Empresa faz 1 PIX ao Worki; o Worki
distribui automaticamente a N freelancers via RPC atômica idempotente. Entra saldo em `wallets`; cada repasse tem
`reference_id` estável para idempotência.

**Modo C / Postpago cartão on-file (Slice 2 — agora opt-in)** — Fluxo original do `ADR-20260622`. Empresa cadastra cartão;
no aceite de convite, hold no cartão; na conclusão, captura. Reservado para expansão além de relações confiáveis.

**Recibo / Receipt** — Documento gerado após registro de pagamento externo (modo A). Página `ReceiptView` (`/recibo/:jobId`)
exibe detalhes do turno, valor, método (PIX/dinheiro/outro), confirmação bilateral, para auditoria/arquivo.

**Shift payment / Marcador de pagamento** — Registro em `shift_payments` indicando que um turno foi pago fora do Worki
(modo A). Tabela: `(id, job_id, worker_id, company_id, application_id, amount, source, paid_at, status, scheduled_for, recorded_by,
worker_confirmed_at, voided_at, void_reason, note, created_at)`. Status: `scheduled | recorded | voided`. UNIQUE `(job_id)` WHERE 
`status IN ('scheduled','recorded')` garante 1 marcador ativo por turno. NUNCA move saldo.

**Pagamento agendado (scheduled)** — Status novo de `shift_payments` (modo A). Empresa cria promessa: data prevista (`scheduled_for`), 
`status='scheduled'`, `paid_at=null`. Comprovante de agendamento no ReceiptView. Transições: `scheduled→recorded` (efetivar, `paid_at` 
setado UMA vez) ou `scheduled→voided` (cancelar). BI NÃO conta promessas (SÓ `recorded`). Zero impacto em saldo.

**Efetivação de agendamento** — Transição `scheduled→recorded` de um `shift_payment`. Empresa seta `paid_at` (data real do pagamento). 
Depois imutável. Torna-se `recorded` e entra no BI de gasto. Service: `paymentRecordService.effectivateScheduledPayment`.

**Comprovante de agendamento** — Documento exibido no ReceiptView quando `shift_payment.status='scheduled'`. Mostra "Pagamento agendado 
para {scheduled_for}", sem "Confirmar Recebimento" (nada recebido ainda). Respaldo ao freela; não é garantia de pagamento nem documento fiscal.

**Agregados do worker** — Campos derivados e recomputados: `xp`, `level`, `completed_jobs_count`, `earnings_total`. Função canônica: 
`recompute_worker_aggregates(worker_id)` (SECURITY DEFINER, service_role only). Fórmula: `xp = completed_jobs_count*100 + bônus_perfil 
(+50 foto, +75 especialidades)`. Chamada pelo trigger de conclusão DE turno E por cliente via `recompute_my_aggregates()` após editar perfil. 
Landmark: trigger legado `award_xp_on_job_completion` NÃO era DEFINER → RLS bloqueava UPDATE do freela quando empresa concluía turno (causa 
real de "XP não sobe") = foi removido.

**Briefing padrão** — Campo `companies.default_briefing` (text). Empresa cadastra UMA vez (ex.: "calça jeans, boa apresentação, barba feita"). 
Ao criar turno, pré-preenche a descrição; empresa ajusta/incrementa por turno (ex.: "camisa verde"). Operacional, NÃO toca saldo.

**Meus Recebimentos** — Página do worker (`/recebimentos`, `MeusRecebimentos.tsx`) que exibe todos os `shift_payments` registrados pela empresa (modo A — pagamento externo). Agrupa por status: `scheduled` (promessas), `recorded` sem confirmação do worker, `recorded` confirmado, `voided`. **NÃO exibe saldo** (Article 8) — é histórico de auditoria/comprovantes. Rota substitui a antiga `/wallet` (removida). **Limitação:** sem notificação push quando empresa registra novo pagamento — worker descobre ao abrir a página.
