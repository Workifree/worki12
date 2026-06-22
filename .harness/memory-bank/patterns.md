# Patterns — Worki

> Padrões recorrentes validados no código. Populado pelo `harness-memory-updater` (ou à mão) conforme
> novas tasks consolidam. Cada padrão = solução observada em uso, não opinião. Não inventar padrões —
> observar uso real em ≥2 lugares antes de promover.

## Fetch direto com guard de sessão (NÃO React Query)

```tsx
useEffect(() => {
  let active = true
  ;(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { navigate('/login'); return }
    const { data, error } = await supabase.from('jobs').select('*').eq('company_id', companyId)
    if (!active) return
    if (error) { logError('jobs.fetch', error); return }
    setJobs(data ?? [])
  })()
  return () => { active = false }
}, [companyId])
```

**Razão:** é o padrão de fato do projeto. React Query está instalado mas não é usado nas páginas. Introduzir
`useQuery` numa feature isolada cria inconsistência — seguir useState/useEffect salvo migração intencional.

## Operação de saldo SEMPRE via walletService / RPC atômica

```ts
// ✓ Correto — atômico, idempotente. WalletService é objeto exportado, args POSICIONAIS:
import { WalletService } from '../services/walletService'  // relativo; sem alias @/
await WalletService.reserveEscrow(jobId, amount, companyUserId)
// releaseEscrow(jobId, applicationId, workerUserId) · refundEscrow(jobId, reason?)

// ✗ Proibido — update manual de saldo no client
await supabase.from('wallets').update({ balance: novoSaldo }).eq('user_id', uid)
```

**Razão:** saldo é dinheiro. Só RPCs atômicas (`reserve/release/refund_escrow`, `credit_deposit`,
`update_wallet_balance`) garantem consistência e idempotência (`wallet_transactions` UNIQUE `(wallet_id, reference_id)`).

## Operação privilegiada via Edge Function, nunca service_role no client

```ts
// frontend — import relativo (sem alias @/)
import { invokeFunction } from '../services/api'
const res = await invokeFunction('asaas-deposit', { amount, method: 'PIX' })
```

**Razão:** `service_role` só existe dentro do Deno (`Deno.env`). Qualquer coisa que precise de privilégio
(Asaas, admin, exclusão de conta) é uma Edge Function com CORS preflight + validação de auth.

## Edge Function: CORS preflight obrigatório

```ts
import { getCorsHeaders } from '../_shared/asaas.ts'
const cors = getCorsHeaders(req)
if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
// ... handler ...
return new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json' } })
```

**Razão:** sem tratar `OPTIONS`, o browser bloqueia a chamada. Funções Asaas precisam aceitar origens de
prod **e** local (`localhost:5173`).

## Isolamento de papel no roteamento

Rotas de worker e de company vivem sob `ProtectedRoute`, que além de sessão verifica papel + onboarding + TOS.
Página nova de empresa → `pages/company/` + rota `/company/*`; worker → `pages/` + rota raiz.

**Razão:** isolamento de papel é regra de segurança (espelha RLS). Misturar papéis numa rota fura o modelo.

## Modal brutalista + toast para feedback

Modais seguem o padrão `DepositModal` (overlay `bg-black/50 backdrop-blur-sm`, caixa branca
`border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]`). Feedback de ação via `ToastContext`
(`addToast('Mensagem', 'success'|'error'|'info')`), não `alert()`.

**Razão:** consistência visual (design-system) + UX não-bloqueante padronizada.

## Tipos no contrato central, não inline espalhado

Interfaces de domínio (Job, Application, WorkerProfile, CompanyProfile, ...) ficam em
`frontend/src/types/index.ts`. Ao mudar schema, atualizar lá (não há codegen).

**Razão:** uma fonte de verdade para os tipos; evita drift entre páginas.

## Erro: logger + Sentry, nunca console solto

```ts
import { logError } from '../lib/logger'   // relativo (sem alias @/)
logError('wallet.deposit', error)   // também captura no Sentry
```

**Razão:** `console.log` cru não chega à observabilidade e polui o build. `lib/logger.ts` centraliza.

---

## Service + hook para operação de negócio sem saldo/privilegiado

```ts
// Service (frontend/src/services/teamConnectionService.ts)
export const TeamConnectionService = {
  async addToTeam(workerId: string, source: TeamConnectionSource): Promise<CreateConnectionResult> { ... },
  async addToTeamByToken(token: string): Promise<CreateConnectionResult> { ... },
  generateInviteToken(companyId: string): ConnectionInviteToken { ... },
  async listTeamMembers(): Promise<TeamMember[]> { ... },
  async listAllConnections(): Promise<TeamConnection[]> { ... },
}

// Hook (frontend/src/hooks/useTeamConnections.ts)
export function useCompanyTeam(): UseCompanyTeamResult {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [pendingConnections, setPendingConnections] = useState<TeamConnection[]>([])
  // ... useState + useEffect + supabase direto (padrão Article 5)
  return { teamMembers, pendingConnections, loading, companyId, addWorker, refresh }
}
```

**Razão:** operações de negócio não-financeiras (equipe, convites, ratings) vêm em par service+hook, 
espelhando o padrão de `walletService`. Service: lógica pura + chamadas Supabase. Hook: estado local, 
carregamento, refresh — sem React Query. Mantém consistência com o resto do projeto.

## Extensão de tabela existente para fluxo novo (push + pull coexistem)

```sql
-- applications já carrega status 'pending'/'hired'/etc. do fluxo pull (worker se candidata → empresa contrata).
-- Slice 1 adiciona convite push: ADD COLUMNS (invited_by_company_at, invitation_response, invitation_expires_at)
-- e novo status 'invited'. A política de INSERT ganha uma branch: empresa pode inserir com status='invited' se:
--   (a) job pertence a uma company dela
--   (b) worker está na equipe 'accepted' dessa company (team_connections)
--   (c) status nasce='invited' (não forja 'hired')
-- Fluxo pull intacto — a segunda policy de INSERT (worker) permite pull. POLICIES SÃO OR-ED.
```

**Razão:** convite e candidatura são modelos concorrentes na mesma application. Estender em vez de criar 
`job_invitations` evita join/migração de dados e mantém o ciclo inteiro (check-in/checkout/confirmação) 
na mesma aresta. ADR-001 (Slice 1) explica a opção.

## Padrões a serem extraídos

> Conforme novas tasks consolidam padrões, popular aqui via `harness-memory-updater` ou edição direta.
