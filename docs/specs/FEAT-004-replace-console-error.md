# FEAT-004: Substituir console.error por logError em Produção

**Issue:** #119 | **Priority:** P1 | **Created:** 2026-03-16 | **Status:** Draft

---

## Problem Statement

Existem 39+ instâncias de `console.error`, `console.log` e `console.warn` em código de produção do frontend que deveriam usar `logError` ou `logWarn` do `lib/logger.ts`. O logger redireciona erros para o Sentry em produção, enquanto `console.error` é invisível. Erros reais de usuários passam despercebidos.

---

## User Stories

| Persona | Ação desejada | Benefício concreto |
|---------|--------------|-------------------|
| Como operador | quero que todos os erros de produção sejam capturados pelo Sentry | para que problemas reais sejam detectados antes que usuários reclamem |
| Como desenvolvedor | quero padrão consistente de error logging | para que não haja dúvida sobre qual função de log usar |

---

## Acceptance Criteria

**AC-1 (logError usado):** Quando um erro ocorre em qualquer página ou serviço listado no issue, então `logError` é chamado (não `console.error`).

**AC-2 (logWarn para warnings):** Quando `console.warn` é usado para warnings esperados (como analytics RPC não existindo), então é substituído por `logWarn` de `lib/logger.ts`.

**AC-3 (ErrorBoundary exceção):** Quando o `ErrorBoundary.tsx` captura um erro, então pode manter `console.error` pois já reporta via Sentry separadamente.

**AC-4 (zero console em prod):** Quando `grep -rn "console.error\|console.log" frontend/src/ --include="*.tsx" --include="*.ts"` é executado, então retorna zero resultados exceto `ErrorBoundary.tsx` e `logger.ts` DEV mode.

---

## Technical Design

### Data Access Tier
**Selected tier:** N/A — refatoração de logging
**Rationale:** Não envolve data fetching, apenas substituição de chamadas de log.

### Components

**New files to create:**
Nenhum.

**Existing files to modify:**
| File Path | Current Behavior | Change Required |
|-----------|-----------------|-----------------|
| `frontend/src/components/RateModal.tsx` | `console.error` | Substituir por `logError` |
| `frontend/src/contexts/NotificationContext.tsx` | `console.error` | Substituir por `logError` |
| `frontend/src/components/Sidebar.tsx` (CompanyLayout) | `console.error` | Substituir por `logError` |
| `frontend/src/pages/company/CompanyAnalytics.tsx` | `console.error` | Substituir por `logError` |
| `frontend/src/pages/company/CompanyCreateJob.tsx` | `console.error` (3x) | Substituir por `logError` |
| `frontend/src/pages/company/CompanyJobDetails.tsx` | `console.error` | Substituir por `logError` |
| `frontend/src/pages/company/CompanyJobs.tsx` | `console.error` | Substituir por `logError` |
| `frontend/src/pages/company/CompanyMessages.tsx` | `console.error` (3x) | Substituir por `logError` |
| `frontend/src/pages/company/CompanyOnboarding.tsx` | `console.error` | Substituir por `logError` |
| `frontend/src/pages/company/CompanyProfile.tsx` | `console.error` (3x) | Substituir por `logError` |
| `frontend/src/pages/company/WorkerPublicProfile.tsx` | `console.error` | Substituir por `logError` |
| `frontend/src/pages/CreateJob.tsx` | `console.error` | Substituir por `logError` |
| `frontend/src/pages/Jobs.tsx` | `console.error` | Substituir por `logError` |
| `frontend/src/pages/Messages.tsx` | `console.error` (3x) | Substituir por `logError` |
| `frontend/src/pages/MyJobs.tsx` | `console.error` (5x) | Substituir por `logError` |
| `frontend/src/pages/Profile.tsx` | `console.error` (3x) | Substituir por `logError` |
| `frontend/src/pages/worker/WorkerOnboarding.tsx` | `console.error` | Substituir por `logError` |
| `frontend/src/services/analytics.ts` | `console.error` (5x) | Substituir por `logError` |
| `frontend/src/lib/gamification.ts` | `console.error` | Substituir por `logError` |

### Edge Functions
None — frontend-only change.

### Database Changes
Nenhuma — usa schema existente.

### State & Data Flow
Sem mudança funcional. Apenas substituição de `console.error(msg)` por `logError(error, 'ComponentName')` e `console.warn(msg)` por `logWarn(msg, 'ComponentName')`. O comportamento do app permanece idêntico.

### UI / Interaction Notes
Sem mudanças visuais. Erros que antes eram invisíveis em produção agora serão capturados pelo Sentry.

---

## Task Breakdown

| Task | Deliverable (what done looks like) | Estimate | Depends On |
|------|------------------------------------|----------|-----------|
| T1 | Todas as 39+ instâncias de `console.error`/`console.log`/`console.warn` substituídas por `logError`/`logWarn` em todos os arquivos listados. Import de `logError` adicionado onde ausente. Build e lint passam. | 3h | — |

**Total estimate:** 3h

**Deployment note:** Sem deploy adicional necessário.

---

## Out of Scope (v1)

- Não inclui: Configuração do Sentry DSN (já configurado)
- Não inclui: Modificação do logger.ts
- Não inclui: console.error em edge functions (runtime Deno, não usa Sentry frontend)
- Não inclui: ErrorBoundary.tsx (já tem integração Sentry própria)
