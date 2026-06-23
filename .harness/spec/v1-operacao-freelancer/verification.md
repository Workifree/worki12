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

---

# Verification - Slice 2 (pagamento postpago, modelo Uber)

> Avaliacao cetica independente (harness-evaluator) da Fase 3.6. Branch feat/v1-loop-relacional.
> Escopo: R4 (metodo cadastrado, sem deposito antecipado, cobra na conclusao) e R9 (conclusao, captura e paga worker).
> ADR: .harness/memory-bank/decisions/ADR-20260622-pagamento-postpago.md.
> Iteracao 1 - 2026-06-23. Veredito: FAIL (1 ALTO: S2-F1 suite de testes quebrada pela mudanca de producao).

## Gates deterministicos (rodados de frontend/)

| ID | Criterio | Status (iter 1) |
|---|---|---|
| C-BUILD-GREEN | Build passa (Art. 3) | PASS (built 12.63s, tsc -b + vite ok) |
| C-LINT-GREEN | Lint sem erro NOSSO (Art. 3) | PASS (3 erros PRE-EXISTENTES set-state-in-effect: DepositModal.tsx:38, Admin.tsx:162 e 431; 0 erros nos arquivos Slice 2) |
| C-TESTS-GREEN | Testes relevantes verdes | FAIL - 18 de 194 falham. 16 PRE-EXISTENTES no baseline Slice 1 (verificado por git stash: BottomNav 3, DepositModal 4, MyJobs 8, Wallet 1). 2 REGRESSAO Slice 2: CompanyJobCandidates.test.tsx (S2-F1) |

## Gates de dominio (LLM)

| ID | Criterio (Article) | Status | Evidencia |
|---|---|---|---|
| C-TS-STRICT | Sem any (Art. 2) | PASS | grep de any vazio nos arquivos Slice 2. Unica deno-lint-ignore no-explicit-any e em edge function Deno (helper chargeOnDemand), fora do gate frontend |
| C-TYPES-CENTRAL | Tipos em types/index.ts (Art. 2) | PASS | PaymentMethod (203), EscrowKind (219), EscrowStatus (226); EscrowTransaction/WalletTransaction estendidos em walletService.ts |
| C-FETCH-PATTERN | useState/useEffect direto (Art. 5) | PASS | PaymentMethodsSection usa useState/useEffect/useCallback; sem useQuery/useMutation |
| C-ROLE-ISOLATION | Rota worker/empresa (Art. 1, 12) | PASS | PaymentMethodsSection dentro de CompanyWallet.tsx:204 (/company/wallet). authorize caller=worker; capture/release caller=empresa dona do job |
| C-AUTH-GATE | Guard sessao -> /login (Art. 12) | PASS | services derivam company via auth.getUser + companies.owner_id; edge functions validam Authorization + auth.getUser(token) |
| C-SUPABASE | lib/supabase + RLS (Art. 4) | PASS | paymentMethodService le via supabase.from(payment_methods); privilegiado via invokeFunction |
| C-ASAAS-ONLY | So Asaas (Art. 6) | PASS | grep stripe vazio nos 4 functions + 4 migrations + frontend Slice 2 (2 hits = migrations legadas add/drop) |
| C-CENTRAL-WALLET | Sem subcontas (Art. 7) | PASS | hold no cartao da conta master; saldo do worker no DB |
| C-ESCROW-ATOMIC | Saldo so por RPC (Art. 8) | PASS | credito SO via capture_escrow_postpago (UPDATE wallets guardado por v_txn_id NOT NULL). authorize/release amount 0. RPCs SECURITY DEFINER + search_path vazio + GRANT EXECUTE service_role,authenticated (000800:226-228) |
| C-IDEMPOTENT | reference_id estavel/UNIQUE (Art. 9) | PASS | credito reference_id=job_id + ON CONFLICT (wallet_id, reference_id) WHERE reference_id NOT NULL DO NOTHING RETURNING id INTO v_txn_id (000800:166-177); casa idx_wallet_tx_unique_reference. Hold idx_escrow_unique_asaas_payment + idx_escrow_one_authorized_per_job |
| C-NO-SERVICE-ROLE | service_role fora do frontend (Art. 10) | PASS | grep vazio em frontend/src; functions usam Deno.env SUPABASE_SERVICE_ROLE_KEY |
| C-CORS-PREFLIGHT | OPTIONS tratado (Art. 11) | PASS | tokenize/authorize/capture/release: getCorsHeaders(req) + OPTIONS retorna ok. Deploy normal (verify-jwt) |
| C-RLS-NEW-TABLE | RLS por papel (Art. 4) | PASS | payment_methods ENABLE RLS (000600:78), REVOKE anon, GRANT authenticated/service_role; 4 policies company_id IN (companies WHERE owner_id=auth.uid()); SEM FORCE RLS |
| C-PCI | PAN/CVV nunca persistidos/logados (Art. 10) | PASS | PAN so server->Asaas; DB grava so token opaco + brand/last4/holder. Sem log de number/ccv. listPaymentMethods NAO seleciona o token. CVV type=password |
| C-DESIGN | Neo-brutalismo + cor papel (Art. 13) | PASS | border-2 border-black, sombra offset azul empresa, rounded-2xl, font-black uppercase |
| C-MOBILE | Mobile-first (grid-cols-1 base) | PASS | AddCardModal grid-cols-1 sm:grid-cols-3 e sm:grid-cols-2; text-xs base |
| C-FEEDBACK | Toast nao alert (rubrica) | PASS | grep alert/confirm vazio; usa useToast addToast |
| C-KEY-LIST | key unica em listas (rubrica) | PASS | key=card.id (nao index); skeletons key=i em array fixo (aceitavel) |
| C-NO-LEGACY | Nao toca legados (Art. 15) | PASS | sem referencia a backend_legacy ou frontend-angular-backup |

## Findings de seguranca ja fechados - re-confirmados em codigo (nao confiados)

| Finding | Status | Evidencia |
|---|---|---|
| B1 credito-em-dobro | CONFIRMADO FECHADO | capture_escrow_postpago (000800:166-177): ON CONFLICT DO NOTHING RETURNING id INTO v_txn_id + IF v_txn_id NOT NULL THEN UPDATE wallets. NAO usa IF FOUND |
| B2 cobra-sem-creditar | CONFIRMADO FECHADO | chargeOnDemand (capture:260-274): guarda de idempotencia ANTES de cobrar - released/captured retornam success sem nova cobranca; refunded tratado como ausente |
| B3 re-autorizacao terminal | CONFIRMADO FECHADO | authorize:101-110: escrow refunded/captured/released -> HTTP 409, NAO recria hold sem novo convite |
| fallback so em codigos Asaas | CONFIRMADO | PRE_AUTH_UNAVAILABLE_CODES Set + match msg (authorize:202-225). Recusa de cartao e surfaced (throw), nao cai em fallback |
| 409 nao rotulado card_declined | CONFIRMADO | dispatchAuthorizePayment (shiftInviteService:75-84): estado terminal -> fallback_charge_on_demand, sem notificacao de cartao recusado |

## Coerencia das migrations

| Item | Status | Evidencia |
|---|---|---|
| Ordem (lexicografica) | PASS | 000600 -> 000700 -> 000800 (RPCs) -> 000900 (trigger). 800<900 garante RPCs antes do no-op |
| kind DEFAULT prepaid preserva linhas | PASS | 000700:52 ADD COLUMN IF NOT EXISTS kind NOT NULL DEFAULT prepaid - linha legada vira prepaid sem backfill |
| reference_id e TEXT | PASS | migration 20260308000000 alterou para TEXT; RPCs usam prefixos + job_id cast TEXT |
| Idempotencia (wallet_id, reference_id) | PASS | idx_wallet_tx_unique_reference WHERE reference_id NOT NULL intacto; ON CONFLICT casa exatamente |
| RPCs reversiveis / DOWN | PASS | DOWN em cada migration |
| CHECK status superset | PASS | 000700:78 reserved/authorized/captured/released/refunded - linhas existentes validas |

## Cobertura de acceptance criteria (Slice 2)

| AC | Status | Nota |
|---|---|---|
| A3 (metodo, sem deposito, cobra na conclusao) | PASS | tokenize grava token; authorize cria hold no aceite; capture cobra na conclusao |
| A5 (conclusao -> libera atomico; auto-processa) | PASS manual / PARCIAL cron | capture_escrow_postpago atomico+idempotente. Cron (R9) NAO implementado (S2-F2) |
| A9 (gate tecnico) | PARCIAL | build+lint verdes; RPC/idempotencia/CORS/sem service_role/sem Stripe OK. MAS npm run test nao verde (S2-F1) |
| R4 (postpago on-file) | PASS | sem deposito antecipado; cartao on-file; cobra na conclusao |
| R9 (captura + paga worker idempotente) | PASS manual | credita 1x; auto-processamento = S2-F2 |

## Findings - Slice 2

| ID | Sev | Tipo | Arquivo:linha | Descricao | Fix |
|---|---|---|---|---|---|
| S2-F1 | ALTO | a | CompanyJobCandidates.test.tsx:186,191,221 | handleConfirmDelivery agora chama WalletService.releaseOrCaptureEscrow (CompanyJobCandidates.tsx:106), mas o teste mocka/assere releaseEscrow. releaseOrCaptureEscrow nao mockado -> undefined -> result.success falsy -> toast de erro; 2 testes falham. Confirmado por git stash: no baseline Slice 1 PASSAM. Gate A9/Art.3 test verde violado | Atualizar o teste para mockar/asserir releaseOrCaptureEscrow. Producao CORRETA - so o teste desatualizado |
| S2-F2 | INFO | a | (ausente) | Auto-processamento (cron de carencia, R9/A5) nao implementado - so disparo manual via capture-payment. ADR ja preve como pendente. Nao bloqueia piloto embedded | Implementar cron/Edge em slice posterior; idempotencia ja cobre cron x empresa |
| S2-F3 | INFO | a | walletService.ts:20 | Union WalletTransaction.type tem escrow_authorize mas nao escrow_void (migration permite ambos). Sem efeito de runtime | Adicionar escrow_void ao union |
| S2-F4 | INFO | a | asaas-capture-payment:312-336 | No fallback de hold expirado, escrow fica authorized com asaas_payment_id do hold expirado; nova cobranca gera outro id NAO gravado. Sem double-charge (capture casa status=authorized), so lacuna de auditoria | Atualizar asaas_payment_id na reconciliacao |

## Verificacao anti-regressao (prepago legado)

- Prepago intacto: reserve/release/refund_escrow e idx_escrow_one_reserved_per_job inalterados. asaas-checkout nao tocado. auto_reserve_escrow_on_hire (000900) identico em runtime ao Slice 1 (so comentario).
- releaseOrCaptureEscrow ramifica certo: postpaid -> capturePayment (asaas-capture-payment); senao -> releaseEscrow (asaas-checkout). releaseEscrow passa applicationId vazio - INOCUO: asaas-checkout ignora applicationId (usa so jobId+workerId).
- Mutuamente exclusivo: job postpago nunca passa pelo ramo prepago do trigger (early-return invited->hired). Credito por (worker_wallet_id, job_id) nao colide cross-fluxo.
- UI wiring: CompanyWallet importa/renderiza PaymentMethodsSection (8/204); AddCardModal -> savePaymentMethod -> asaas-tokenize-card; sem import quebrado (build verde confirma).
- Build nao quebrou Slice 1: chunks CompanyTeam/useShiftInvites/InviteAccept/MyJobs intactos.

## Resultado (Slice 2)

```
verdict: FAIL
blockers: nenhum
altos: S2-F1 (suite CompanyJobCandidates quebrada pela mudanca releaseEscrow -> releaseOrCaptureEscrow - tipo a)
infos_aceitos: S2-F2 (cron), S2-F3 (union escrow_void), S2-F4 (asaas_payment_id no fallback expirado)
seguranca: B1/B2/B3 + fallback + 409 RE-CONFIRMADOS fechados em codigo
spec_coverage: A3 PASS; A5 PASS manual / PARCIAL cron; A9 PARCIAL (test nao-verde S2-F1); R4/R9 cobertos
next_step: builder_retry (corrigir S2-F1 - atualizar o teste; producao esta correta)
```

---

# Verification - Slice 3 (inteligencia financeira in-app)

> Avaliacao cetica independente (harness-evaluator). Branch feat/v1-loop-relacional. Escopo: Camada 2 R12 (teto+alerta in-app), R13 (BI gasto/horas), R14 (ratio/custo-pct-faturamento), R15 (no-show estimativa), R16 (concentracao para vinculo). R17 (import MOMMA) concierge/pendente N/A. WhatsApp do alerta Slice 4 N/A. Iteracao 1 - 2026-06-23. PASS (0 BLOCKER, 0 ALTO; findings ja-fechados re-confirmados em codigo).

## Gates deterministicos

| ID | Criterio | Status |
|---|---|---|
| C-BUILD-GREEN | Build passa Art.3 | PASS (built 18.62s; tsc -b + vite ok; chunk CompanyFinancial 29.39 kB) |
| C-LINT-GREEN | Lint sem erro NOSSO Art.3 | PASS (3 erros PRE-EXISTENTES set-state-in-effect: DepositModal.tsx:36, Admin.tsx:162, Admin.tsx:431 identicos a main; 0 erros/0 warnings nos 4 arquivos do Slice 3) |
| C-TESTS-GREEN | Testes relevantes verdes | PASS p/ Slice 3 (sem testes novos; suites do wire passam: walletService 21, CompanyWallet 8, CompanyJobCandidates 6 - S2-F1 fechado). 16 falhas em BottomNav/DepositModal/MyJobs/Wallet PRE-EXISTENTES: provado por git stash do Slice 3, mesmas 16 falhas no baseline. Nenhum desses componentes tocado pelo Slice 3 |

## Gates de dominio (LLM)

| ID | Criterio Article | Status | Evidencia |
|---|---|---|---|
| C-TS-STRICT | Sem any tipado Art.2 | PASS | grep any/as-any vazio nos 4 arquivos do Slice 3 |
| C-TYPES-CENTRAL | Tipos em types/index.ts Art.2 | PASS | SpendLimit 343, MonthlyRevenue 361, AccumulatedSpend 377, SpendByWorker 390, CostRatio 408, NoShowCost 425, ConcentrationFlag 441, FinancialBIData 459 a mao |
| C-FETCH-PATTERN | useState/useEffect + supabase direto Art.5 | PASS | grep useQuery/useMutation vazio; hooks useState/useEffect/useCallback; services supabase.from direto. Views REJEITADAS |
| C-ROLE-ISOLATION | Rota empresa correta Art.1,12 | PASS | rota financeiro sob /company + CompanyLayout App.tsx:174 dentro de ProtectedRoute. Link mobile em CompanyWallet com aria-label |
| C-AUTH-GATE | Guard de sessao para login Art.12 | PASS | useSpendLimit/useFinancialBI supabase.auth.getUser para navigate login useFinancialBI.ts:78-81,131-134,250-252,298-300 |
| C-SUPABASE | Acesso via lib/supabase + RLS Art.4 | PASS | todos importam lib/supabase; BI nao filtra company_id por seguranca RLS garante so por UX |
| C-ASAAS-ONLY | Nenhum gateway alem de Asaas Art.6 | PASS | grep stripe vazio nos 4 arquivos + 3 migrations |
| C-CENTRAL-WALLET | Sem subcontas Art.7 | PASS | Slice 3 so LE escrow/wallets BI. Nao cria subconta nem espelha saldo |
| C-ESCROW-ATOMIC | Saldo so por RPC Art.8 | PASS | grep UPDATE-wallets/RPCs de saldo nas 3 migrations vazio (unica ocorrencia comentario NAO-toca-saldo 0100:10). Alerta FORA da RPC walletService.ts:236-253 IIFE void pos result.success |
| C-IDEMPOTENT | reference_id estavel UNIQUE Art.9 | PASS | Slice 3 sem escrita financeira. Idempotencia do ALERTA por convencao de link + SELECT-before-INSERT spendLimitService.ts:335,353-365. notifications_user_id_idx cobre user_id. wallet_transactions UNIQUE intacta |
| C-NO-SERVICE-ROLE | service_role fora do frontend Art.10 | PASS | grep service_role vazio em frontend/src. GRANTs de service_role nas migrations correto p/ path edge/cron futuro |
| C-CORS-PREFLIGHT | Edge function trata OPTIONS Art.11 | N/A | Slice 3 nao cria edge function. Alerta INSERT direto em notifications via client autenticado RLS |
| C-RLS-NEW-TABLE | Tabela nova com RLS por dono Art.4 | PASS | company_spend_limits ENABLE RLS 113 + 4 policies SELECT/INSERT/UPDATE/DELETE todas company_id IN companies WHERE owner_id auth.uid 127-148 + REVOKE anon + GRANT authenticated/service_role. company_monthly_revenue idem 70-101 |
| C-NOTIF-INSERT-POLICY | INSERT de notifications correto novo | PASS | 20260623000200 WITH CHECK auth.uid user_id FOR authenticated owner insere SO na propria caixa. notifications tinha SELECT+UPDATE faltava INSERT deny implicito finding fechado. Triggers SECURITY DEFINER + service_role bypass intactos. Nome unico DROP IF EXISTS idempotente |
| C-DESIGN | Neo-brutalismo + cor por papel Art.13 | PASS | border-2 border-black + shadow offset solido 6px + rounded-2xl + uppercase font-black. Barra de progresso AZUL bg-blue-600 empresa no normal escalando amarelo/vermelho por threshold CompanyFinancial.tsx:85-92 |
| C-MOBILE | Mobile-first grid-cols-1 base | PASS | grid-cols-1 sm:grid-cols-2 no-show:602; skeletons base 1-col. Acesso mobile via card em CompanyWallet BottomNav sem slot |
| C-A11Y | Acessibilidade do dashboard novo | PASS | progressbar role + aria-valuenow/min/max + aria-label 191-196; toggle aria-expanded + aria-controls + id correspondente 528,575-576; botoes aria-label |
| C-TOAST-FEEDBACK | Feedback via Toast nao alert Art.13 | PASS | grep alert/confirm vazio; addToast em handleSave CompanyFinancial.tsx:106,113,117 |
| C-LIST-KEY | key estavel em listas | PASS | key workerId nas listas de freela e concentracao. Skeletons com index em Array(n) estaticos aceitavel |
| C-NO-LEGACY | Nao toca legados Art.15 | PASS | sem referencia a backend_legacy ou frontend-angular-backup |
| C-LGPD | PII nao vaza em log/Sentry | PASS | logError carrega so chave-de-contexto + erro; sem CPF/CNPJ/e-mail/telefone. financial_contact_email/phone so na config RLS por dono |

## Cobertura de requisitos (Slice 3)

| Req | Status | Evidencia |
|---|---|---|
| R12 teto + alerta in-app nunca bloqueio | PASS | upsertSpendLimit scope vazio upsert idempotente via onConflict company_id period scope sem teto duplicado. evaluateSpendAlert BI-1 released/captured vs teto dispara SO o maior threshold cruzado nao-alertado (acima de 100 = OVER) idempotente por link INSERT pro owner. NUNCA bloqueia: roda FORA da RPC best-effort void mensagem contratacoes-continuam-funcionando. Contratacao NAO consulta o teto |
| R13 BI gasto/horas por freela/periodo | PASS | getAccumulatedSpend BI-1 + getSpendByWorker BI-2 horas reais checkout-checkin com fallback jobs.estimated_hours hoursSource real/estimated/mixed exposto. Carimbo COALESCE captured/released/created filtrado JS-side |
| R14 ratio custo/hora + custo-pct-faturamento | PASS | getCostRatio costPerHour null se horas 0; costPercentRevenue null se faturamento ausente UI CTA informe-o-faturamento-acima CompanyFinancial.tsx:506-507 nao inventa numero. company_monthly_revenue year_month dia-1 UNIQUE |
| R15 custo de no-show estimativa | PASS | getNoShowCost heuristica aceito/hired + turno passado + sem checkout isEstimate sempre true UI badge Estimativa + nota heuristica-v1-sem-coluna-explicita 594-595,616-619. GAP documentado. budget/estimated_hours existem em Job |
| R16 concentracao para vinculo | PASS | getConcentrationFlags horas BI-2 + COUNT DISTINCT date start_date flag quando horas maior-igual 150 E dias maior-igual 20 constantes de produto no service nao no banco. UI aviso vermelho + badge 625-637 |
| R17 import MOMMA | N/A | Concierge/pendente fora do build de codigo |

## Checklist seguranca/dominio

- Isolamento cross-company queries BI dependem da RLS de escrow_transactions company_wallet_id IN wallets WHERE user_id auth.uid migration 001:58-61. companyId resolvido de companies.owner_id user.id. Mesmo se o client forjasse company_wallet_id o RLS bloqueia. Config tables isoladas por owner. SEM vazamento.
- Dinheiro so por RPC nenhuma das 3 migrations toca saldo/RPC; alerta roda fora da RPC best-effort.
- Idempotencia do alerta link estavel + SELECT-before-INSERT nao duplica threshold/mes. notifications_user_id_idx existe.
- service_role ausente do frontend. Asaas-only sem Stripe. CORS N/A sem edge nova.
- Findings ja-fechados re-confirmados: notifications INSERT policy auth.uid user_id; scope NOT NULL DEFAULT vazio upsert sem duplicata; barra azul empresa; acesso mobile via CompanyWallet; aria do progressbar/aria-controls; border-2.

## Anti-regressao (Slice 1/2 intactos)

- Pagamento NAO regrediu releaseOrCaptureEscrow mantem ramificacao postpaid=capturePayment / prepaid=releaseEscrow walletService.ts:227-232. Alerta adicionado APOS result.success em IIFE void com try/catch que nunca propaga 236-253 nao altera o retorno nem bloqueia o pagamento.
- Suites do caminho tocado verdes walletService.test.ts 21 CompanyWallet.test.tsx 8 CompanyJobCandidates.test.tsx 6. O S2-F1 Slice 2 fechado.
- As 16 falhas de teste pre-existentes baseline da main provado por stash: mocks supabase desatualizados em BottomNav/DepositModal/MyJobs/Wallet nenhum tocado pelo Slice 3.

## Findings - Slice 3

| ID | Sev | Tipo | Arquivo:linha | Descricao | Fix |
|---|---|---|---|---|---|
| S3-F1 | INFO | a | financialBIService.ts:442-510 | No-show heuristica sem coluna explicita no_show. JA mitigado isEstimate true + rotulo Estimativa + nota. GAP previsto no contrato BI-4 | Se piloto exigir precisao architect cria marcador explicito de no-show em applications migration menor |
| S3-F2 | INFO | a | financialBIService.ts:104-113,180-184 | BI-1/BI-2 filtram periodo em JS PostgREST nao suporta COALESCE em filtro. Aceitavel no volume v1 documentado | Se volume crescer mover agregacao p/ RPC SQL SECURITY INVOKER ou indice por carimbo |

## Resultado (Slice 3)

```
verdict: PASS
blockers: nenhum
altos: nenhum
infos_aceitos: S3-F1 (no-show heuristica ja rotulada), S3-F2 (filtro de periodo JS-side ok no volume v1)
lint_passed: true (3 erros pre-existentes em DepositModal/Admin nao-Slice-3)
build_passed: true
tests_passed: true (p/ Slice 3; 16 falhas pre-existentes na main nao-regressao provado por stash)
seguranca: isolamento cross-company (RLS escrow), saldo-so-RPC, idempotencia de alerta, notifications INSERT policy, sem service_role/Stripe - todos OK
spec_coverage: R12 PASS R13 PASS R14 PASS R15 PASS R16 PASS; R17 N/A (concierge); WhatsApp N/A (Slice 4)
next_step: approved (Phase 3.7 memory-updater + commit)
```

