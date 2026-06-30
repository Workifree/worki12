# Structure — Worki

> Como o código está organizado. Atualizar quando: criar nova pasta de papel, mudar convenção de naming,
> reorganizar rotas. **Worki NÃO usa Feature-Sliced Design** — é uma estrutura plana
> `pages/ + components/` com ramificação por papel (worker vs company).

## Layout raiz do repositório

```
worki12/
├── frontend/            # TODO o app React (build/lint/test rodam aqui)
│   └── src/             # ver abaixo
├── supabase/
│   ├── functions/       # Edge Functions Deno (+ _shared/)
│   ├── migrations/      # 52 migrations SQL (RLS, escrow, carteira)
│   └── config.toml
├── docs/                # documentação
├── e2e/                 # artefatos E2E
├── scripts/             # scripts utilitários
├── backend_legacy/      # ⛔ DEPRECADO — não tocar
├── frontend-angular-backup/ # ⛔ DEPRECADO — não tocar
├── .harness/            # este harness (constitution, memory-bank, playbooks, specs)
├── .claude/             # agentes, comandos, settings do Claude Code
└── CLAUDE.md            # entrypoint do orquestrador
```

## `frontend/src/` (estrutura plana, sem FSD)

```
frontend/src/
├── App.tsx              # router (BrowserRouter) + providers + React.lazy de todas as páginas
├── main.tsx             # bootstrap React
├── index.css            # @tailwind base/components/utilities + keyframes (slideIn) + glassmorphism util
├── components/          # componentes reutilizáveis GLOBAIS (JobCard, DepositModal, Sidebar,
│                        #   ProtectedRoute, BottomNav, NotificationBell, RateModal, TosGateModal, ...)
│   └── __tests__/       # testes co-located dos componentes
├── contexts/            # AuthContext, NotificationContext, ToastContext
├── hooks/               # useFocusTrap, useJobApplication, use-mobile
├── layouts/             # MainLayout (worker) + CompanyLayout (empresa)
├── lib/                 # supabase.ts (client), gamification.ts, validation.ts, logger.ts
│   └── __tests__/
├── pages/               # páginas de rota (papel worker no topo)
│   ├── company/         # páginas exclusivas da empresa (CompanyDashboard, CompanyCreateJob,
│   │                    #   CompanyJobCandidates, CompanyWallet, CompanyProfile, ...)
│   ├── worker/          # páginas exclusivas do worker (WorkerDashboard, WorkerOnboarding)
│   └── __tests__/
├── services/            # walletService.ts, analytics.ts, api.ts (invokeFunction)
├── types/               # index.ts — TODAS as interfaces do domínio (escritas à mão)
├── assets/              # imagens, fontes
└── test/                # setup.ts (mocks Vitest)
```

## Roteamento e isolamento de papel

- **`App.tsx`** declara todas as rotas. Páginas carregadas via `React.lazy` + `Suspense` (PageLoader skeleton).
- **`components/ProtectedRoute.tsx`** é o guarda: verifica sessão, exige `onboarding_completed`, aplica
  **isolamento de papel** (worker não acessa rotas de company e vice-versa) e **TOS gate** (`accepted_tos`).
- **Layouts por papel:** `MainLayout` (worker — Sidebar + BottomNav + Outlet); `CompanyLayout` (empresa).
- Redirecionamento default: worker → `/dashboard`; company → `/company/dashboard`.

## Convenção de páginas por papel

| Papel | Onde fica a página | Prefixo de rota |
|---|---|---|
| Worker | `pages/*.tsx` e `pages/worker/*.tsx` | `/dashboard`, `/jobs`, `/wallet`, ... |
| Empresa | `pages/company/*.tsx` | `/company/dashboard`, `/company/jobs`, ... |
| Compartilhado/público | `pages/*.tsx` | `/login`, `/`, `/terms`, `/privacy` |

> Nova página de empresa → `pages/company/`. Nova página de worker → `pages/` (ou `pages/worker/`).
> Componente usado pelos dois papéis → `components/` (global).

## Naming conventions

| Padrão | Exemplo | Uso |
|---|---|---|
| PascalCase `.tsx` | `JobCard.tsx`, `CompanyDashboard.tsx` | Componentes e páginas |
| `Company*` | `CompanyJobCandidates.tsx` | Páginas/elementos do papel empresa |
| camelCase | `walletService.ts`, `useJobApplication.ts` | services, hooks, funções |
| `use-*` / `use*` | `use-mobile.ts`, `useFocusTrap.ts` | hooks |
| `*.test.tsx` / `__tests__/` | `JobCard.test.tsx` | testes co-located |

## Arquivos críticos (não tocar sem plano)

| Arquivo | Função |
|---|---|
| `frontend/src/App.tsx` | Todas as rotas + montagem de providers |
| `frontend/src/components/ProtectedRoute.tsx` | Auth + isolamento de papel + TOS gate |
| `frontend/src/contexts/AuthContext.tsx` | Sessão global + Sentry user |
| `frontend/src/lib/supabase.ts` | Client Supabase (anon key) |
| `frontend/src/services/walletService.ts` | Escrow + carteira (reserve/release/refund) |
| `frontend/src/types/index.ts` | Contrato de tipos do domínio (à mão) |
| `supabase/functions/_shared/asaas.ts` | Integração Asaas + CORS |
| `supabase/migrations/*` | RLS + RPCs atômicas de escrow/carteira |

## Páginas grandes (candidatas a refactor com plano dedicado)

- `pages/Admin.tsx` (~767 linhas)
- `pages/Profile.tsx` (~703), `pages/company/CompanyProfile.tsx` (~696)
- `pages/MyJobs.tsx` (~610), `pages/company/CompanyJobCandidates.tsx` (~613)
- `pages/company/CompanyCreateJob.tsx` (~558), `pages/company/CompanyMessages.tsx` (~538)

## Test layout

```
frontend/vitest.config.ts → setupFiles: ['src/test/setup.ts']
frontend/src/test/setup.ts → mocks globais
co-located: <Componente>.test.tsx ou pasta __tests__/
E2E: frontend/playwright.config.ts + e2e/ (raiz)
```
