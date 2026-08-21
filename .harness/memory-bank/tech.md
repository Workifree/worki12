# Tech — Worki

> Atualizar quando: subir versão major de framework, trocar build tool, adicionar lib que afeta padrão
> (state, routing, UI, pagamentos). Mudanças minor ficam só no `frontend/package.json`.

> ⚠️ Todo o app frontend vive em `frontend/`. Comandos npm rodam a partir de `frontend/`, não da raiz.

## Frontend

- **Framework:** React 19.2.0 (SPA, `"type": "module"`)
- **Build tool:** Vite 7.2.4
- **TypeScript:** ~5.9.3 — `strict: true`, `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports` (config em `frontend/tsconfig.app.json`)
- **Router:** React Router DOM 7.12.0 (client-side, `BrowserRouter` em `App.tsx`, `React.lazy` + `Suspense`)
- **Erros/observabilidade:** Sentry React 10.42.0 (`@sentry/react`) — `setUser` no `AuthContext`,
  `captureException` em `services/api.ts` e `lib/logger.ts`

## State + data

- **Padrão real de fetch:** `useState` + `useEffect` + chamada direta `supabase.from(...).select(...)`.
  TanStack React Query 5.90.20 está no `package.json` e um `QueryClient` é montado em `App.tsx`, mas
  **as páginas NÃO usam `useQuery` na prática.** Seguir o padrão existente (useState/useEffect) ao
  implementar features novas, salvo decisão explícita de migrar.
- **Services de negócio:** `walletService` (escrow), `paymentMethodService` (cartão on-file), **`paymentRecordService`** (modo A — registro de pagamento externo + agendamento, sem mover saldo), `teamConnectionService` (equipe), `shiftInviteService` (convites push), **`teamListService`** (agrupamento organizacional de elenco — F2), **`jobSeriesService`** (série de turnos EAGER — F3), **`linkRiskService`** (contagem de turnos por semana/freela — F5), **`serviceTermService`** (renderização e aceite de termo — F6), **`certificationService`** (certificações e capacitações — F8).
- **Toda query autenticada começa com** `supabase.auth.getUser()` → redireciona para `/login` se `null`.
- **Backend:** Supabase (PostgREST + Realtime + Auth + Storage + Edge Functions Deno)
- **Supabase JS:** 2.91.0 — client em `frontend/src/lib/supabase.ts` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
- **Tipos:** escritos À MÃO em `frontend/src/types/index.ts` (NÃO há codegen de tipos do Supabase).
  Ao mudar schema, atualizar as interfaces manualmente.
- **Auth:** `AuthContext` (`frontend/src/contexts/AuthContext.tsx`) — `{ user, loading, signOut }`, hook `useAuth()`
- **Notificações:** `NotificationContext` — Realtime via `postgres_changes` + canal broadcast `new_notification`
- **Toast:** `ToastContext` — `addToast(message, type)`, auto-dismiss 3s

## UI / Design

- **Styling:** TailwindCSS 3.4.17 (config em `frontend/tailwind.config.js`) — design **neo-brutalista**
  (ver `design-system.md`)
- **Cores tokens:** `primary #00A651` (verde worker), `accent #111111` (preto brutalista), `border rgba(0,0,0,.1)`,
  `glass-surface`/`glass-border`
- **Ícones:** Lucide React 0.562.0
- **QR code:** `qrcode.react` 4.2.0 (geração em `<QRCodeSVG>` para links de convite); **`html5-qrcode` 2.3.8** (leitura de QR/Worki ID via câmera, aba QR em team connections)
- **Util:** `clsx` + `tailwind-merge` + `class-variance-authority`; datas via `date-fns`
- **Recurrence (F3):** `frontend/src/lib/recurrence.ts` — função pura `generateOccurrenceDates(params)` que calcula array de datas de uma série (diária/semanal). Usa componentes locais (nunca `toISOString()`). `referenceDate` injetável para testes determinísticos. Constante `MAX_SERIES_OCCURRENCES=60`.
- **Fonte:** Inter (sans-serif), pesos pesados (`font-black`, `uppercase`)
- **Componentes novos (Slice 4):**
  - **`ProfileReviews`** — lista avaliações recebidas (estrelas + comentário). Props: `reviewedId`, `reviewerRole` ('company' | 'worker'). Filtra por `direction` inverso (worker que avalia company = direction='company'). Neo-brutalista com border 2px + sombra offset.

## Pagamentos — Asaas (único gateway)

- Helper compartilhado: `supabase/functions/_shared/asaas.ts` (+ `getCorsHeaders()`)
- Modelo: **carteira central** (sem subcontas); saldo por usuário no DB (`wallets.balance`)
- Tipos de pagamento: PIX, Boleto, Cartão de Crédito
- **Fluxos prepago (Slice 1):** `asaas-deposit` (depósito); saque `asaas-withdraw`; checkout `asaas-checkout`; sync `asaas-sync`; webhook `asaas-webhook`
- **Fluxos postpago (Slice 2):** `asaas-tokenize-card` (salva cartão); `asaas-authorize-payment` (pré-autorização); `asaas-capture-payment` (captura hold); `asaas-release-hold` (cancela hold)
- **Endpoints Asaas utilizados:**
  - `POST /v3/creditCard` — tokenizar cartão (Slice 2)
  - `POST /v3/payments` com `authorizeOnly=true` — pré-autorização/hold (Slice 2)
  - `POST /v3/payments/{id}/capture` — capturar hold autorizado (Slice 2)
  - `DELETE /v3/payments/{id}` — cancelar charge/hold (Slice 2)
- **Env para postpago:** `ASAAS_POSTPAGO_MODE` (`'authorize' | 'charge_on_demand'`; default: `'charge_on_demand'`). Fallback: se hold não aprovado ou expirado, captura em charge_on_demand.
- Lógica de carteira no frontend: `frontend/src/services/walletService.ts`; novo `paymentMethodService.ts` para cartão on-file

## Edge Functions (Deno, `supabase/functions/`)

| Função | Papel | Deploy |
|---|---|---|
| `_shared/` | `asaas.ts`, `email.ts`, `rate-limit.ts` | (lib) |
| `admin-data` | dados de admin (auth própria) | **`--no-verify-jwt`** |
| `asaas-checkout` | liberar escrow prepago → release_escrow RPC | normal |
| `asaas-deposit` | depósito/top-up de carteira | normal |
| `asaas-sync` | reconciliar status de transação | normal |
| `asaas-webhook` | receber webhook Asaas (sem JWT Supabase) | **`--no-verify-jwt`** |
| `asaas-withdraw` | saque (transferência PIX) | normal |
| `asaas-tokenize-card` | tokenizar cartão (Slice 2) → payment_methods | normal |
| `asaas-authorize-payment` | pré-autorizar pagamento postpago → authorize_escrow_postpago RPC | normal |
| `asaas-capture-payment` | capturar hold postpago → capture_escrow_postpago RPC | normal |
| `asaas-release-hold` | liberar hold (cancel/no-show) → release_hold_postpago RPC | normal |
| `delete-account` | exclusão de conta | normal |
| `send-notification` | enviar notificação | normal |
| `expire-invites` | marcar convites expirados como declined (batch automático) | normal |
| `attendance-confirmation-service` | (futuro) reconciliação de respostas de presença | normal |

## Banco de dados

- **PostgreSQL + RLS** em todas as tabelas. 55+ migrations em `supabase/migrations/`.
- **RPCs atômicas (escrow prepago/postpago):**
  - Prepago: `reserve_escrow`, `release_escrow`, `refund_escrow`, `credit_deposit`, `update_wallet_balance`
  - Postpago (Slice 2): `authorize_escrow_postpago`, `capture_escrow_postpago`, `release_hold_postpago`
  - Todas **requerem** `GRANT EXECUTE ... TO service_role, authenticated`.
- **Constraint crítica:** `wallet_transactions` UNIQUE deve ser `(wallet_id, reference_id)`, não `reference_id` só.
  Idempotência postpago usa `reference_id` estável tipo `job_id:worker_id:attempt_#`.
- **Config tables (Slice 3, sem RPC de saldo — Article 8):**
  - **`company_spend_limits`** (20260623000000) — teto mensal por empresa. Campos: `company_id, period='month', amount, alert_thresholds[]` (default [80,90,100]), `scope` ('' = empresa inteira, v1 single-store), `financial_contact_email/phone`. RLS por owner. Sem saldo.
  - **`company_monthly_revenue`** (20260623000100) — faturamento mensal declarado (input para BI-3). Campos: `company_id, year_month` (DATE dia 1), `amount`. Upsert (company_id, year_month). RLS por owner.
  - **`companies.default_briefing`** (20260710000100) — texto de briefing padrão do negócio (pré-preenche turno). Simples, NÃO toca saldo.
- **Mudanças em shift_payments (Slice 3, modo A + agendamento):**
  - **20260712000000** — novo status `scheduled`, coluna `scheduled_for date` (promessa imutável), `paid_at` agora nullable (NULL em scheduled, setado na efetivação). UNIQUE parcial `(job_id) WHERE status IN ('scheduled','recorded')` (histórico; **ver 20260816220000 abaixo**). Trigger reescrito para liberar SÓ transição `scheduled→recorded` de `paid_at`. Máquina de estados: `scheduled→recorded|voided`, `recorded→voided`. ZERO impacto em saldo/escrow.
  - **20260816220000** — índice UNIQUE trocado de `(job_id)` para `(job_id, worker_id)` com predicado parcial `WHERE status IN ('scheduled','recorded')`. Razão: turno pode ter N freelas (painel pós-criação convida vários); índice antigo regrediu granularidade já existente em `escrow_transactions` (por freela). **Ordem obrigatória:** frontend adaptado primeiro (passo 1: Passo 1 de `paymentRecordService` + `CompanyJobCandidates`), migration depois (passo 2). Sem o passo 1, `.maybeSingle()` falha com PGRST116 (UI fica cega). ADR-20260816-marcador-pagamento-por-freela.md.
- **Notificação de cancelamento (bidirecional, Onda 1 — Revisão Piloto):**
  - **20260714000000** — trigger `trg_notify_company_on_worker_cancel` (SECURITY DEFINER, search_path='') em `applications`. **[SUBSTITUÍDO em 20260816150000]**
  - **20260816150000** — trigger unificado `trg_notify_counterpart_on_application_cancel` (SECURITY DEFINER, search_path='') substitui o anterior. Ramifica por `auth.uid()`: 
    - `auth.uid() = worker_id` → notifica empresa
    - `auth.uid() = company_id` (do job) → notifica freela **[NOVO — empresa agora pode dispensar]**
    - `auth.uid() IS NULL` (service_role/cron/delete-account) → notifica ambos com texto neutro
    Covers cancelamento de convite ('invited'), turno ('hired'/'in_progress'), e cancelamento após exclusão de conta. ADR-20260816-notificacao-contraparte-por-trigger.md.
- **RLS que estava desligada em produção (Onda 1 — Revisão Piloto, 20260816):**
  - **`20260816210000_enable_rls_jobs`** — RLS de `jobs` estava DESLIGADA (policies existiam mas eram inertes); ligada. SELECT mantido `USING (true)` (Fase 1) para não quebrar subqueries de outras tabelas que referenciam `jobs`. UPDATE/DELETE agora protegidas: 4 policies novas com ancoragem dupla (`company_id = auth.uid()` OR via `companies.owner_id`). ADR-20260816-rls-desligada-jobs-conversation.md.
  - **`20260816210100_enable_rls_conversation_message`** — RLS de `public."Conversation"` e `public."Message"` ligada (estavam desligadas). `anon` revogado de ambas. Função `can_access_conversation()` (SECURITY DEFINER) como ponto único de decisão. ADR-20260816-rls-desligada-jobs-conversation.md.
- **RLS de `workers` restrita por vínculo (Onda 1 — Revisão Piloto, 20260816):**
  - **`20260816120000_workers_select_by_relationship`** — policy SELECT em `workers` trocada de `USING (true)` para `USING (public.can_view_worker_profile(id))`. Razão: `workers` contém dados sensíveis (CPF, telefone, PIX key); qualquer conta autenticada podia varrer a base inteira. Agora restrita a: (1) self (freela lê próprio perfil), (2) elenco via `team_connections` status 'pending'/'accepted', (3) vínculo operacional via `applications` em `jobs` da empresa. Função SECURITY DEFINER evita recursão de RLS. ADR-20260816-workers-select-por-vinculo.md.
- **Policy adicional (20260623000200):**
  - **`notifications` INSERT** — `WITH CHECK (auth.uid() = user_id)` destrava alerta in-app inserido pelo cliente (`spendLimitService.evaluateSpendAlert`).
- Tabelas principais: `workers` (estendida F7: `availability_days jsonb`), `companies` (estendida F5: `link_risk_alert_enabled`, `link_risk_alert_threshold`), `jobs` (estendida com `series_id`, `series_occurrence_date`, `status` soft-delete), `applications`, `wallets`, `wallet_transactions`,
  `escrow_transactions`, `notifications`, `analytics_events`, `payment_methods`, **`company_spend_limits`** (nova), **`company_monthly_revenue`** (nova), **`shift_payments`** (estendida com scheduled + scheduled_for), **`job_series`** (F3 — config de série recorrente), **`shift_calls`**, **`shift_call_targets`** (F1 — chamado de turno primeiro-aceite), **`team_lists`**, **`team_list_members`** (F2 — listas do elenco), **`shift_attendance_confirmations`** (F4 — tabela-evento de confirmação de véspera), **`service_terms`** (F6 — termo com aceite eletrônico, FK 1:1 com shift_payments), **`worker_certifications`** + **`worker_trainings`** (F8 — metadados de certificação/treinamento com conferência perecível).
- **Estado do banco em produção:** **`supabase/migrations/APLICACAO-2026-08-16.md`** registra o estado real de 16/08/2026 (revisão pré-piloto), incluindo divergências entre timestamps de aplicação vs. nome de arquivo, verificações executadas, e lacunas declaradas. Este é o censo oficial — o repositório de migrations é referência de schema, mas não é a fonte da verdade do estado atual de produção (políticas podem ter sido ligadas/desligadas manualmente pelo dashboard).
- **RPCs de agregados do worker (Slice 4):**
  - **`recompute_worker_aggregates(uuid)`** — recomputa `xp`, `level`, `completed_jobs_count`, `earnings_total`. SECURITY DEFINER, service_role only, idempotente. Fórmula: `xp = completed_jobs_count*100 + bônus_perfil` (foto +50, especialidades +75).
  - **`recompute_my_aggregates()`** — wrapper auth-scoped para cliente recomputar próprios agregados após editar perfil. GRANT EXECUTE TO authenticated.
  - **Trigger `trg_worker_completion_aggregates`** (AFTER INSERT/UPDATE status ON applications WHEN →'completed') — chama `recompute_worker_aggregates(worker_id)` (SECURITY DEFINER).
  - **Landmark:** trigger legado `award_xp_on_job_completion` NÃO era DEFINER → RLS bloqueava UPDATE do freela quando empresa concluía turno (causa real de "XP não sobe") = **foi removido**.
- **Escala recorrente (F3 — Onda 1, Revisão Piloto):**
  - **`20260817000400_job_series.sql`** — tabela `job_series` (config de série: recurrence_type, weekdays[], range, job_template, status='active'|'stopped'). Colunas novas em `jobs`: `series_id uuid`, `series_occurrence_date date` (nullable, só preenchida para ocorrências). RLS via `is_company_owner(company_id)` (ancoragem dupla, padrão F1/F2). Máximo 60 ocorrências por série (CHECK SQL + trigger de statement + validação client). 2 triggers guardas: `limit_series_occurrences` (statement), `validate_series_configuration` (row). RPCs SECURITY DEFINER (search_path=''):
    - `create_job_series` (INVOKER) — cria série + materializa N `jobs` em transação única (datas vêm do client via `lib/recurrence.ts`).
    - `update_job_series_future` — edita ocorrências futuras sem freela ativo. Param `p_dry_run` para pré-visualização.
    - `stop_job_series` — marca série como stopped, soft-deleta ocorrências futuras (`status='deleted'`). Param `p_dry_run`.
  - **`20260817000500_claim_shift_slot_job_status.sql`** — `claim_shift_slot` (RPC F1) passa a checar `jobs.status <> 'deleted'` antes de permitir aceite (defesa contra série parada).
  - **Dados: Soft delete de turno:** Cancelamento/exclusão via `UPDATE jobs SET status='deleted'` + `deleted_at`, **nunca `DELETE`**. Preserva `shift_calls` (métrica ROI), `escrow_transactions` (auditoria), evita RESTRICT em `shift_payments`. Padrão reutilizável.
  - **Padrão: Operações em massa DEFINER:** RPCs de alteração em lote (`update_job_series_future`, `stop_job_series`) usam SECURITY DEFINER porque predicados incluem ancoragem dupla (INVOKER veria RLS simples, contagem mentira). Sempre: lógica de seleção no banco, client monta parâmetros, RPC ramifica e devolve `outcome` estruturado.
- **Chat:** o frontend lê/escreve a tabela **`Conversation`** (capital C — ex.: `supabase.from('Conversation')`
  em `hooks/useJobApplication.ts`, `pages/company/CompanyJobCandidates.tsx`). Existe também uma tabela
  `messages` no DB, mas **o chat do frontend usa `Conversation`** — não confundir. RLS ligada em produção a partir de **20260816** (`enable_rls_conversation_message`); antes era desligada — `anon` podia listar todas as conversas. UPDATE em `Message` (campo `read_at`) ficou quebrado até essa migration (query afetava 0 linhas, silenciosamente).
- **Confirmação de Véspera (F4 — Onda 1, Revisão Piloto):**
  - **`20260817000600_shift_attendance_confirmations.sql`** — tabela-evento `shift_attendance_confirmations` (id uuid PK, job_id, worker_id, request_sent_at, worker_responded_at, response text, confirmation_status text, metadata jsonb, created_at). Índice composto `(job_id, worker_id)` sem UNIQUE (múltiplas tentativas permitidas). RLS **SELECT-only**; INSERT/UPDATE via RPC DEFINER. Trigger `notify_worker_on_attendance_request` (SECURITY DEFINER) dispara notificação ao receber requisição.
  - **Helpers SECURITY DEFINER (migração 20260817000600, usados por cron/triggers):**
    - `job_local_date(job_id uuid) → date` — retorna data local do turno (UTC convertido por fuso em `settings.app_timezone`). Consulta `jobs` sem depender de RLS do invoker. SECURITY DEFINER obrigatório (cron roda sem sessão).
    - `job_is_active(job_id uuid) → boolean` — retorna true se turno não foi deletado, não está no passado, tem freelas. SECURITY DEFINER obrigatório.
  - **`20260817000700_attendance_confirmation_rpcs.sql`** — RPCs SECURITY DEFINER:
    - `request_attendance_confirmation(job_id uuid, worker_id uuid)` — empresa pede confirmação ao freela para turno de até 7 dias. Insere em `shift_attendance_confirmations` + notificação bilateral.
    - `respond_attendance_confirmation(confirmation_id uuid, response_text text)` — freela responde (Confirmo/Não consigo). Seta `worker_responded_at`, `response`, `confirmation_status`.
    - `request_attendance_confirmations_due(company_id uuid) → TABLE(job_id uuid, worker_id uuid, ...)` — retorna confirmações pendentes para a empresa (leitura). Usado por UI worker (`MyJobs`) para destacar "⚠️ Confirme presença em X turno(s)".
  - **`20260817000800_schedule_attendance_confirmations.sql`** — agendador Postgres (protegido, **MANDATÓRIO para promessa**):
    ```sql
    -- Valida extensão antes de agendar (graceful fallback)
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
      SELECT cron.schedule('request_attendance_confirmations_7d', '20 * * * *', $$SELECT batch_request_attendance_confirmations_7d();$$);
    END IF;
    ```
    RPC `batch_request_attendance_confirmations_7d` (SECURITY DEFINER) roda todo dia 20h UTC (madrugada Brasil, máximo alcance). **pg_cron disponível (1.6.4) mas não instalado em produção** — é pré-requisito de entrega (não TODO de backlog). Feature sem cron: empresa clica manualmente = comportamento humano que F4 existe para **substituir** (feedback architect/evaluator). Clique é fallback; automação é padrão. Runbook: ops habilita pg_cron antes de validar F4.
  - **Padrão: Tabela-evento RLS SELECT-only** — `shift_attendance_confirmations` permite só leitura via PostgREST; mutation via RPCs DEFINER. Evita escrita direta do client e garante auditoria. Ver `patterns.md` §Tentativa é evento.
  - **Padrão: Escolha de timing depende do alcance necessário** — expiração preguiçosa (F1) funciona sem agendador; cron-dependent (F4) é obrigatório. Ver `patterns.md` §Escolha de timing.
  - **Padrão: SECURITY DEFINER para consumidor sem sessão** — helpers `job_local_date`, `job_is_active` são DEFINER porque cron/triggers os chamam sem `auth.uid()`. Se fossem INVOKER, RLS simples em `jobs` retornaria NULL silenciosamente. Ver `patterns.md` §Predicado sem sessão.
- **Guarda de risco de vínculo (F5 — Onda 1, Revisão Piloto):**
  - **`20260817000900_link_risk_guard.sql`** — `companies.link_risk_alert_enabled` (boolean, default true) + `link_risk_alert_threshold` (integer 1..7, default 2). RPC `count_worker_shifts_by_week` (SECURITY DEFINER, search_path='') — devolve array de (worker_id, week_start date, shift_count int). Semana corrida dom-sáb, data local Brasil. Conta DESTA empresa (ancoragem dupla), NUNCA cross-company. Exclui soft-deleted e turno-alvo. Porquê DEFINER: fuso local + ancoragem dupla + READ futuro de jobs. Índices: `idx_applications_job_status`, `idx_jobs_company_start_date`. **Nunca bloqueia** — só avisa (decisão owner). ADR-20260818-guarda-vinculo-contagem-no-banco.md.
- **Termo de prestação de serviço (F6 — Onda 1, Revisão Piloto):**
  - **`20260817001100_service_terms.sql`** — tabela `service_terms` (FK 1:1 `shift_payment_id`, denormalizados job_id/worker_id/company_id para RLS, term_text, amount cópia, accepted_at, accepted_ip, accepted_user_agent). RPC `accept_service_term` (SECURITY DEFINER, search_path='') — re-renderiza + grava term_text + accepted_at atomicamente (congelamento). Função `render_service_term_text` (SECURITY INVOKER) — monta 4 seções (turno, equipamento, cláusulas, não-responsabilidade). Trigger `enforce_service_term_immutability` — `term_text` imutável após `accepted_at` (nem service_role). FK COMPOSTA `(id, job_id, worker_id, company_id)` em shift_payments garante denormalizados casam. **Aceite + confirmação de recebimento = um gesto na UI**, dois eventos no DB. ADR-20260818-termo-congelado-no-aceite.md.
- **Disponibilidade do freela (F7 — Onda 1, Revisão Piloto):**
  - **`20260817001200_worker_availability_days.sql`** — coluna `workers.availability_days jsonb` (array 0-6, seg-dom). CHECK `<@ ARRAY[0..6]::int[]` (containment). Null = sem restrição. Uso: `ShiftCallModal`, `InviteSeriesModal` — badges de indisponibilidade. Padrão: JSONB GRID com validação semântica no banco, mask no client. ADR-20260821-disponibilidade-grade-jsonb.md.
- **Certificações e capacitações (F8 — Onda 1, Revisão Piloto):**
  - **`20260817001300_worker_certifications_trainings.sql`** — duas tabelas com modelos **diferentes**, não simétricas. `worker_certifications` (do freela, sobre ele): `id, worker_id, title, issuer, registration_number, issued_at, expires_at, verified_by_company_id, verified_at, verified_note, notified_expired_at, created_at, updated_at`. `worker_trainings` (da empresa, sobre um freela dela): `id, company_id, worker_id, title, completed_at, note, created_by, created_at, revoked_at, revoked_reason` — treinamento não se apaga, se revoga com motivo. **Sem upload de arquivo na v1** (ADR-20260821: o arquivo não compra verdade; a conferência é visual sobre o original, e o caso crítico do piloto — treinamento interno — não tem documento). Validade **derivada em query** (`isCertificationExpired`), nunca status congelado. Trigger `enforce_certification_update_scope` com três ramos: (a) dono edita conteúdo ⇒ `verified_*` zerados (conferência perecível); (b) empresa com vínculo mexe só em `verified_*` e **só na própria** — guarda DS8 ancorada em `OLD`, cobrindo apagamento **e** sobrescrita `A → B`; (c) sessão nula (cron, `delete-account`) limpa `verified_*` e marca `notified_*`, nunca confere. Os três furos de RLS da spec original (auto-atribuição pelo freela, ator sem sessão, vazamento entre empresas) foram **corrigidos no gate**, não adiados. Aviso de vencimento por `notify_certification_expiries()` + `pg_cron`, degradando com `RAISE WARNING` se a extensão faltar. ADRs: `ADR-20260821-certificacoes-metadado-sem-arquivo.md`, `ADR-20260821-conferencia-de-certificacao-e-do-conferente.md`.

## Qualidade & testes

- **ESLint** 9 flat config (`frontend/eslint.config.js`): `@eslint/js`, `typescript-eslint`,
  `react-hooks`, `react-refresh`
- **Unit:** Vitest 4.0.18 + Testing Library (jsdom) — setup em `frontend/src/test/setup.ts`, co-located em `__tests__/`. **⚠️ `TZ: 'America/Sao_Paulo'` em `vitest.config.ts` (obrigatório para testes de data — CI roda UTC)**
- **E2E:** Playwright 1.58.2 — `frontend/playwright.config.ts`
- **Logger:** `frontend/src/lib/logger.ts` (`logError`/`logWarn` + Sentry); validadores em `lib/validation.ts`
  (CPF/CNPJ/email/senha)

## Scripts npm (rodar de `frontend/`)

| Script | Comando |
|---|---|
| `dev` | `vite` (porta 5173) |
| `build` | `tsc -b && vite build` (type-check + bundle — DEVE passar) |
| `lint` | `eslint .` |
| `test` | `vitest run` |
| `test:watch` | `vitest` |
| `test:e2e` | `playwright test` |
| `preview` | `vite preview` |

## Deploy

- **Frontend:** Vercel — projeto "worki" = `worki-opal.vercel.app`. Comando: `npx vercel --prod --cwd frontend`.
- **Edge functions:** `supabase functions deploy <nome>` (com `--no-verify-jwt` onde indicado acima).
- **Supabase project ref:** `vrklakcbkcsonarmhqhp`.

## Restrições inferidas

1. **Asaas-only** — Stripe 100% removido. Nenhuma feature reintroduz outro gateway.
2. **Sem `service_role` no frontend** — operações privilegiadas só em Edge Functions.
3. **Sem state manager global** (Redux/Zustand) — Context + fetch direto.
4. **Tipos à mão** — `types/index.ts` é a fonte; não há codegen.
5. **Mobile-first** — toda feature precisa funcionar bem no celular.
