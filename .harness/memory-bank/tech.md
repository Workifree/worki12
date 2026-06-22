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
- **QR code:** `qrcode.react` 4.2.0 (geração de QR em `<QRCodeSVG>` para links de convite)
- **Util:** `clsx` + `tailwind-merge` + `class-variance-authority`; datas via `date-fns`
- **Fonte:** Inter (sans-serif), pesos pesados (`font-black`, `uppercase`)

## Pagamentos — Asaas (único gateway)

- Helper compartilhado: `supabase/functions/_shared/asaas.ts` (+ `getCorsHeaders()`)
- Modelo: **carteira central** (sem subcontas); saldo por usuário no DB (`wallets.balance`)
- Tipos de pagamento: PIX, Boleto, Cartão de Crédito
- Fluxos: `DepositModal` → `asaas-deposit`; saque `asaas-withdraw`; checkout `asaas-checkout`;
  sync `asaas-sync`; webhook `asaas-webhook`
- Lógica de carteira no frontend: `frontend/src/services/walletService.ts`

## Edge Functions (Deno, `supabase/functions/`)

| Função | Papel | Deploy |
|---|---|---|
| `_shared/` | `asaas.ts`, `email.ts`, `rate-limit.ts` | (lib) |
| `admin-data` | dados de admin (auth própria) | **`--no-verify-jwt`** |
| `asaas-checkout` | criar checkout de pagamento | normal |
| `asaas-deposit` | depósito/top-up de carteira | normal |
| `asaas-sync` | reconciliar status de transação | normal |
| `asaas-webhook` | receber webhook Asaas (sem JWT Supabase) | **`--no-verify-jwt`** |
| `asaas-withdraw` | saque (transferência PIX) | normal |
| `delete-account` | exclusão de conta | normal |
| `send-notification` | enviar notificação | normal |

## Banco de dados

- **PostgreSQL + RLS** em todas as tabelas. 52 migrations em `supabase/migrations/`.
- **RPCs atômicas (escrow/carteira):** `reserve_escrow`, `release_escrow`, `refund_escrow`,
  `credit_deposit`, `update_wallet_balance`. **Requerem** `GRANT EXECUTE ... TO service_role, authenticated`.
- **Constraint crítica:** `wallet_transactions` UNIQUE deve ser `(wallet_id, reference_id)`, não `reference_id` só.
- Tabelas principais: `workers`, `companies`, `jobs`, `applications`, `wallets`, `wallet_transactions`,
  `escrow_transactions`, `notifications`, `analytics_events`.
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
