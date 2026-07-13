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
- **Services de negócio:** `walletService` (escrow), `paymentMethodService` (cartão on-file), **`paymentRecordService`** (modo A — registro de pagamento externo + agendamento, sem mover saldo), `teamConnectionService` (equipe), `shiftInviteService` (convites push), `financialBIService` (BI unificado), `spendLimitService` (teto + alerta).
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
- **Fonte:** Inter (sans-serif), pesos pesados (`font-black`, `uppercase`)
- **Componentes novos (Slice 4):**
  - **`ProfileReviews`** — lista avaliações recebidas (estrelas + comentário). Props: `reviewedId`, `reviewerRole` ('company' | 'worker'). Filtra por `direction` inverso (worker que avalia company = direction='company'). Neo-brutalista com border 2px + sombra offset.

## Pagamentos — Asaas (único gateway)

- Helper compartilhado: `supabase/functions/_shared/asaas.ts` (+ `getCorsHeaders()`)
- Modelo: **carteira central** (sem subcontas); saldo por usuário no DB (`wallets.balance`)
- Tipos de pagamento: PIX, Boleto, Cartão de Crédito
- **Fluxos prepago (Slice 1):** `DepositModal` → `asaas-deposit`; saque `asaas-withdraw`; checkout `asaas-checkout`; sync `asaas-sync`; webhook `asaas-webhook`
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
  - **20260712000000** — novo status `scheduled`, coluna `scheduled_for date` (promessa imutável), `paid_at` agora nullable (NULL em scheduled, setado na efetivação). UNIQUE parcial `(job_id) WHERE status IN ('scheduled','recorded')`. Trigger reescrito para liberar SÓ transição `scheduled→recorded` de `paid_at`. Máquina de estados: `scheduled→recorded|voided`, `recorded→voided`. ZERO impacto em saldo/escrow.
- **Policy adicional (20260623000200):**
  - **`notifications` INSERT** — `WITH CHECK (auth.uid() = user_id)` destrava alerta in-app inserido pelo cliente (`spendLimitService.evaluateSpendAlert`).
- Tabelas principais: `workers`, `companies`, `jobs`, `applications`, `wallets`, `wallet_transactions`,
  `escrow_transactions`, `notifications`, `analytics_events`, `payment_methods`, **`company_spend_limits`** (nova), **`company_monthly_revenue`** (nova), **`shift_payments`** (estendida com scheduled + scheduled_for).
- **RPCs de agregados do worker (Slice 4):**
  - **`recompute_worker_aggregates(uuid)`** — recomputa `xp`, `level`, `completed_jobs_count`, `earnings_total`. SECURITY DEFINER, service_role only, idempotente. Fórmula: `xp = completed_jobs_count*100 + bônus_perfil` (foto +50, especialidades +75).
  - **`recompute_my_aggregates()`** — wrapper auth-scoped para cliente recomputar próprios agregados após editar perfil. GRANT EXECUTE TO authenticated.
  - **Trigger `trg_worker_completion_aggregates`** (AFTER INSERT/UPDATE status ON applications WHEN →'completed') — chama `recompute_worker_aggregates(worker_id)` (SECURITY DEFINER).
  - **Landmark:** trigger legado `award_xp_on_job_completion` NÃO era DEFINER → RLS bloqueava UPDATE do freela quando empresa concluía turno (causa real de "XP não sobe") = **foi removido**.
- **Chat:** o frontend lê/escreve a tabela **`Conversation`** (capital C — ex.: `supabase.from('Conversation')`
  em `hooks/useJobApplication.ts`, `pages/company/CompanyJobCandidates.tsx`). Existe também uma tabela
  `messages` no DB, mas **o chat do frontend usa `Conversation`** — não confundir.

## Qualidade & testes

- **ESLint** 9 flat config (`frontend/eslint.config.js`): `@eslint/js`, `typescript-eslint`,
  `react-hooks`, `react-refresh`
- **Unit:** Vitest 4.0.18 + Testing Library (jsdom) — setup em `frontend/src/test/setup.ts`, co-located em `__tests__/`
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
