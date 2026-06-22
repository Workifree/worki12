# Verification — v1-operacao-freelancer (Slice 1: loop relacional)

> Avaliação cética independente (harness-evaluator) da Fase 3.6. Branch `feat/v1-loop-relacional`.
> Escopo: Camada 1, requisitos R1, R2, R3, R5, R7, R8, R10, R11. R4/R9 (pagamento postpago) = Slice 2 (N/A).
> IDs estáveis ligados à constitution.
> Iteração 1 — 2026-06-22 (FAIL: F1 BLOCKER + F2/F3 ALTO).
> Iteração 2 — 2026-06-22 (RE-AVALIAÇÃO: F1–F4 verificados fechados em código). **PASS**.

## Gates determinísticos (rodados de `frontend/`)

| ID | Critério | Comando | Status (iter 2) |
|---|---|---|---|
| C-BUILD-GREEN | Build passa (Art. 3) | `cd frontend && npm run build` | PASS (built 18.71s, tsc -b + vite ok) |
| C-LINT-GREEN | Lint sem erro NOSSO (Art. 3) | `cd frontend && npm run lint` | PASS (3 erros = pré-existentes `react-hooks/set-state-in-effect` em DepositModal.tsx:36, Admin.tsx:162 e 431, idênticos à main; 0 erros nos arquivos do Slice 1. 1 warning em e2e/full-flow.cjs, não-Slice-1) |
| C-TESTS-GREEN | Testes relevantes verdes | `cd frontend && npm run test` | N/A (Slice 1 não adicionou testes; nenhum teste relevante toca os arquivos novos) |

## Gates de domínio (LLM)

| ID | Critério (Article) | Status | Evidência |
|---|---|---|---|
| C-TS-STRICT | Sem `any`; props tipadas (Art. 2) | PASS | grep `: any`/`as any` vazio em todos os arquivos Slice 1 (services, hooks, pages, MyJobs, CompanyCreateJob) |
| C-TYPES-CENTRAL | Tipos em `types/index.ts` (Art. 2) | PASS | TeamConnection/TeamMember/MyStore/ApplicationStatus/InvitationResponse/ReviewDirection + `Job.briefing?` (types/index.ts:64) |
| C-FETCH-PATTERN | useState/useEffect + supabase direto (Art. 5) | PASS | grep `useQuery`/`useMutation` vazio nos hooks/services/pages novos; hooks usam useState/useEffect/useCallback |
| C-ROLE-ISOLATION | Rota worker/empresa correta (Art. 1, 12) | PASS | `/company/team` sob ProtectedRoute+CompanyLayout (App.tsx:172); `/convite/:token` sob ProtectedRoute (App.tsx:144, dentro do bloco 134-176); convites na rota worker `/my-jobs` |
| C-AUTH-GATE | Guard de sessão → /login (Art. 12) | PASS | getUser()→/login nos hooks; services exigem sessão; addToTeamByToken deriva workerId da sessão (não por param) |
| C-SUPABASE | Acesso via lib/supabase + RLS (Art. 4) | PASS | todos os services importam `../lib/supabase` |
| C-ASAAS-ONLY | Nenhum gateway além de Asaas (Art. 6) | PASS | grep `stripe` vazio em todos os arquivos Slice 1 (frontend + migrations) |
| C-CENTRAL-WALLET | Sem subcontas (Art. 7) | N/A | Slice 1 não toca carteira |
| C-ESCROW-ATOMIC | Saldo só por RPC (Art. 8) | PASS | criar-turno e aceite NÃO chamam reserve_escrow; `auto_reserve_escrow_on_hire` (migration 000300:140-142) early-return quando OLD.status='invited' + invited_by_company_at NOT NULL → POSTPAGO preservado; fluxo PULL legado segue reservando (000300:144-157) |
| C-IDEMPOTENT | reference_id estável / UNIQUE (Art. 9) | N/A | Slice 1 não faz escrita financeira; idempotência aplicada a team_connections (UNIQUE pair 000000:37) e convite (guard) |
| C-NO-SERVICE-ROLE | service_role fora do frontend (Art. 10) | PASS | grep vazio em frontend/src |
| C-CORS-PREFLIGHT | Edge function trata OPTIONS (Art. 11) | N/A | Slice 1 não cria edge function (reusa send-notification existente) |
| C-RLS-NEW-TABLE | Tabela nova com RLS por papel (Art. 4) | PASS | team_connections: ENABLE RLS (000000:75) + 6 policies por papel; SELECT só participantes (isolamento worker); INSERT só empresa+pending (não forja accepted); UPDATE worker restrito a accepted/blocked; GRANT service_role. Self-invite bloqueado (000400) |
| C-DESIGN | Neo-brutalismo + cor por papel (Art. 13) | PASS | InviteAccept: border-2 border-black, shadow offset sólido `8px_8px_0px`, rounded-2xl, uppercase font-black, verde worker (#00A651) |
| C-MOBILE | Mobile-first (grid-cols-1 base) | PASS | grid-cols-1 base; InviteAccept max-w-md centrado; tabs overflow-x-auto |
| C-NO-LEGACY | Não toca legados (Art. 15) | PASS | diff não inclui backend_legacy/ nem frontend-angular-backup/ |
| C-SPEC-COVERAGE | ACs do Slice cobertos | PASS | ver abaixo — F1–F4 fechados |

## Cobertura de acceptance criteria (Slice 1)

| AC | Status (iter 2) | Nota |
|---|---|---|
| A1 (conexão consentida → equipe/lojas) | PASS | link-invite (R1-b) agora E2E: `/convite/:token` (App.tsx:144, sob ProtectedRoute) → InviteAccept.tsx:45 chama addToTeamByToken (workerId da sessão) → addToTeamByToken/resolveInviteToken não são mais dead code; generateInviteToken monta `/convite/{token}` coerente (service:170). QR-scan câmera e SMS adiados (Slice 4, documentado F5) |
| A2 (re-convite sem novo handshake) | PASS | isWorkerInTeam guarda; notificação de convite linka `/my-jobs` (rota real, shiftInviteService:189) |
| A3 (pagamento) | N/A | Slice 2 |
| A4 aceite/recusa (recusa NEUTRA) | PASS | respondToInvite invited→hired/declined; trigger postpago ajustado; recusa neutra; sem escrow; notificação de aceite linka `/company/jobs/${job_id}/candidates` com job_id no escopo (shiftInviteService:328, rota App.tsx:166) |
| A5 (conclusão/escrow) | N/A | Slice 2 |
| R3/R6 briefing no convite | PASS | cadeia completa: type Job.briefing? (types:64) → CompanyCreateJob insere briefing (157) → migration 000500 cria coluna `briefing` (idempotente, nullable) → listPendingInvites seleciona briefing (shiftInviteService:372) → MyJobs renderiza `job.briefing || job.description` (465-468) |
| R10 fix direção do review | PASS | MyJobs.tsx:311-317 direction='company' + reviewed_id=company_id explícitos; trigger company espelhado |

## Findings — status iter 2

| ID | Sev (iter1) | Tipo | Status iter 2 | Evidência de fechamento |
|---|---|---|---|---|
| F1 | BLOCKER | a | **FECHADO** | `pages/InviteAccept.tsx` criada; rota `/convite/:token` sob ProtectedRoute (App.tsx:144); chama addToTeamByToken(token) com workerId da sessão; resolveInviteToken/addToTeamByToken têm caller real (não mais dead code); generateInviteToken → `/convite/{token}` coerente |
| F2 | ALTO | a | **FECHADO** | shiftInviteService.ts:189 `link: '/my-jobs'` (rota existe em App.tsx:150) |
| F3 | ALTO | a | **FECHADO** | shiftInviteService.ts:328 `link: '/company/jobs/${current.job_id}/candidates'` (rota App.tsx:166; job_id selecionado no fetch da application, linha 251) |
| F4 | MÉDIO | a | **FECHADO** | migration 000500 coluna briefing + Job.briefing tipo + select traz briefing + UI mostra `briefing || description`. Cadeia inteira verificada |
| F5 | INFO | a | ABERTO (aceito) | QR-scan câmera + canal phone/SMS = entrada manual na UI; data layer suporta os 3 sources. Adiado Slice 4 / v1.1 — não bloqueia |

## Verificação anti-regressão (iter 2)

- **Postpago preservado:** nenhum `reserve_escrow` no caminho convite/criar-turno/aceite (só comentários + o early-return de skip na migration 000300). Fluxo PULL legado de contratação direta intacto.
- **Isolamento de papel/RLS intacto:** policies de team_connections corretas; worker invited→hired só liberado em convite real (000300:92-97); self-invite bloqueado no INSERT do worker (000400).
- **Sem `as any` / service_role / Stripe** em nenhum arquivo do Slice 1 (greps vazios).

## Resultado

```
verdict: PASS
blockers: []
altos: []
abertos_aceitos: [F5 (INFO, Slice 4)]
spec_coverage: A1, A2, A4, R3/R6, R10 cobertos (Slice 1); A3/A5 = Slice 2 (N/A)
next_step: approved  → Phase 3.7 (memory-updater) + commit
```
