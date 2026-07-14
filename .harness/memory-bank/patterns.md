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

## RPC idempotente com RETURNING id INTO (não IF FOUND)

```sql
CREATE OR REPLACE FUNCTION capture_escrow_postpago(
  p_job_id UUID,
  p_worker_id UUID,
  p_amount NUMERIC
)
RETURNS RECORD AS $$
DECLARE
  v_txn_id UUID;
BEGIN
  INSERT INTO wallet_transactions (wallet_id, amount, type, reference_id, ...)
  VALUES (wallet_id, p_amount, 'escrow_release', 'job:' || p_job_id || ':capture', ...)
  RETURNING id INTO v_txn_id;  -- ← obrigatório: evita race condition

  RETURN ROW(v_txn_id, ...);
END;
$$ LANGUAGE plpgsql;
```

**Razão:** `IF FOUND` após INSERT é anti-padrão — cria janela de race condition (concurrent retry enxerga duplicata
antes do INSERT ser visível). **RETURNING + INTO** garante atomicidade: insert sucede OU falha por constraint,
nunca deixa estado indeterminado. Idempotência fica no application layer (reference_id UNIQUE).

**Onde:** Postpago `capture_escrow_postpago`, `authorize_escrow_postpago`, `release_hold_postpago`. Prepago legado
não toca este padrão (usa IF FOUND histórico, refactor futuro).

## Tokenize + authorize separado de capture (cartão on-file)

```ts
// Slice 2 padrão: nunca chamar asaas-authorize e asaas-capture na mesma operação.
// Motivo: empresa precisa confirmar turno (check-in, worker validação, etc.) ANTES de capturar.

// 1. Onboarding / config:  empresa salva cartão
const card = await PaymentMethodService.savePaymentMethod({ number, cvv, ... });

// 2. Aceite de convite: apenas cria escrow sem saldo (push logic):
// — NÃO chama authorize ainda
// — worker faz check-in/checkout livremente

// 3. Empresa confirma conclusão: ENTÃO autoriza + captura
await WalletService.releaseOrCaptureEscrow(jobId, workerId, 'postpaid');
// → asaas-authorize-payment → authorize_escrow_postpago RPC (hold criado)
// → asaas-capture-payment → capture_escrow_postpago RPC (cobrança real + credita worker)
```

**Razão:** separação de concern. Tokenize é config (1x por cartão, sem jobId). Authorize é "vou cobrar" (job-específico,
criado late porque precisa de validação do worker). Capture é "cobrei de verdade" (worker crédito confirmado).
Permite retry + fallback (se authorize falha, convida novamente; se capture falha, refaz). Idempotência por
`reference_id` estável em wallet_transactions.

## Service pattern: PaymentMethodService (sem React Query, direto supabase + invokeFunction)

```ts
export const PaymentMethodService = {
  async savePaymentMethod(input: SaveCardInput): Promise<SaveCardResult> {
    // invokeFunction para privilégio (asaas tokenize)
    const result = await invokeFunction('asaas-tokenize-card', input);
    return { success: result.success, paymentMethodId: result.paymentMethodId, ... };
  },

  async capturePayment(jobId: string, workerId: string): Promise<CapturePaymentResult> {
    // invokeFunction para operação de pagamento
    const result = await invokeFunction('asaas-capture-payment', { jobId, workerId });
    return { success: result.success, chargeOnDemand: result.chargeOnDemand };
  },

  async listPaymentMethods(): Promise<PaymentMethod[]> {
    // supabase direto para leitura (RLS já filtra company_id por owner)
    const { data } = await supabase.from('payment_methods').select('*').eq('company_id', companyId);
    return data ?? [];
  }
};
```

**Razão:** padrão existente (`walletService`, `teamConnectionService`). Operações privilegiadas (I/O Asaas) usam
`invokeFunction`. Leituras usam `supabase` direto. Sem React Query (Article 5 — inconsistência). Service exporta
objeto com métodos; no frontend chamar via `services/api.ts invokeFunction()` + error handling centralizado em `lib/logger.ts`.

## Idempotência de alerta via link estável + SELECT-before-INSERT (Slice 3)

```ts
// Service: spendLimitService.evaluateSpendAlert
async evaluateSpendAlert(companyId: string, now: Date = new Date()): Promise<void> {
  // 1. Computar gasto e comparar com teto
  const spend = await computeAccumulatedSpend(companyId, now);
  const highestCrossed = determineHighestThreshold(spend, limit); // null | number | 'OVER'
  if (!highestCrossed) return;

  // 2. Construir chave de idempotência (link estável por período/threshold)
  const alertLink = `/company/financeiro?alert=${companyId}:${yyyymm(now)}:${highestCrossed}`;

  // 3. SELECT-before-INSERT: verificar se já existe
  const { data: existing } = await supabase
    .from('notifications')
    .select('id')
    .eq('user_id', ownerId)
    .eq('link', alertLink)
    .limit(1)
    .maybeSingle();
  
  if (existing) return; // Idempotência: alerta já enviado

  // 4. Inserir notificação (novo — policy 20260623000200 destrava INSERT para authenticated)
  await supabase.from('notifications').insert({
    user_id: ownerId,
    type: 'payment',
    title, message, link: alertLink,
  });
}
```

**Razão:** alerta pode rodar múltiplas vezes no período (retry, cron, etc.). Link estável (companyId:YYYYMM:threshold) como chave de idempotência
garante que o mesmo alerta NÃO é gravado em dobro. SELECT-before-INSERT cai em race condition? Não: notifications INSERT é rápido
e o pior caso (dois alerts chegam simultâneos) expõe 2 notificações idênticas por 1 segundo — UX aceitável em alerta (não dinheiro).
Policy `WITH CHECK (auth.uid() = user_id)` (nova 20260623000200) destrava INSERT do client (spendLimitService roda com role authenticated, owner inserindo para si).

## Agregados do worker via função idempotente SECURITY DEFINER (Slice 4)

```sql
-- Função canônica — recomputa XP/level/earnings_total a partir de source of truth (applications com status='completed')
-- SECURITY DEFINER porque invoker (trigger ou cliente via wrapper) não tem permissão direta em workers.
CREATE OR REPLACE FUNCTION public.recompute_worker_aggregates(p_worker_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count int; v_earnings numeric; v_bonus int; v_xp int;
BEGIN
  -- Source: aplicações concluídas
  SELECT COUNT(*)::int, COALESCE(SUM(j.budget), 0)
    INTO v_count, v_earnings
  FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE a.worker_id = p_worker_id AND a.status = 'completed';

  -- Bônus de perfil: foto +50, especialidades +75
  SELECT
    (CASE WHEN w.avatar_url IS NOT NULL AND w.avatar_url <> '' THEN 50 ELSE 0 END)
    + (CASE WHEN (w.primary_role IS NOT NULL AND w.primary_role <> '')
             OR (w.roles IS NOT NULL AND jsonb_typeof(w.roles) = 'array' AND jsonb_array_length(w.roles) > 0)
          THEN 75 ELSE 0 END)
    INTO v_bonus
  FROM public.workers w WHERE w.id = p_worker_id;

  v_xp := v_count * 100 + COALESCE(v_bonus, 0);

  UPDATE public.workers SET
    completed_jobs_count = v_count,
    earnings_total = v_earnings,
    xp = v_xp,
    level = public.worker_level_for_xp(v_xp)
  WHERE id = p_worker_id;
END;
$$;

-- Wrapper auth-scoped para cliente recomputar PRÓPRIO XP após editar perfil (foto/especialidades).
CREATE OR REPLACE FUNCTION public.recompute_my_aggregates()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RETURN; END IF;
    PERFORM public.recompute_worker_aggregates(auth.uid());
END;
$$;

-- No trigger: chamada SECURITY DEFINER quando aplicação → 'completed'.
-- Trigger `trg_worker_completion_aggregates` (AFTER INSERT/UPDATE OF status ON applications WHEN status→'completed')
-- → PERFORM public.recompute_worker_aggregates(NEW.worker_id);
```

**Razão:** agregados (xp, level, completed_jobs_count, earnings_total) são derivados, não fonte. Uma função idempotente é a 
**única fonte de verdade**. SECURITY DEFINER (com search_path='') protege contra RLS no invoker; service_role chama indiretamente via 
trigger DEFINER; cliente chama via wrapper auth-scoped (`recompute_my_aggregates`). Landmark: trigger legado `award_xp_on_job_completion` 
NÃO era DEFINER → RLS bloqueava UPDATE do freela quando empresa concluía turno (causa real de "XP não sobe") = **foi removido**.

## Pagamento externo agendado (shift_payments com status 'scheduled') — Slice 3

```sql
-- Máquina de estados (mesma linha, in-place):
-- scheduled (promessa) ──efetivar──► recorded (realizado) ──estornar──► voided
--     │                                                                   ▲
--     └────────────────── cancelar ────────────────────────────────────┘

ALTER TABLE public.shift_payments
    ADD COLUMN IF NOT EXISTS scheduled_for date;     -- promessa (imutável)
ALTER TABLE public.shift_payments
    ALTER COLUMN paid_at DROP NOT NULL;              -- nullable (NULL em scheduled)

-- Trigger de imutabilidade reescrito: libera ÚNICA transição (scheduled→recorded) de paid_at
CREATE OR REPLACE FUNCTION public.enforce_shift_payment_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- scheduled_for: material, imutável sempre (reagendar = void + novo)
    IF NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for THEN
        RAISE EXCEPTION 'shift_payments: scheduled_for e imutavel.';
    END IF;

    -- paid_at: imutável, EXCETO transição scheduled→recorded
    IF NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
        IF NOT (OLD.status = 'scheduled' AND NEW.status = 'recorded'
                AND OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL) THEN
            RAISE EXCEPTION 'shift_payments: paid_at so pode ser definido na efetivacao.';
        END IF;
    END IF;

    -- Transições válidas (só empresa): scheduled→recorded (efetivar), scheduled→voided (cancelar), recorded→voided (estornar)
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT (
            (OLD.status = 'scheduled' AND NEW.status IN ('recorded', 'voided'))
            OR (OLD.status = 'recorded' AND NEW.status = 'voided')
        ) THEN
            RAISE EXCEPTION 'shift_payments: transicao invalida (% -> %).', OLD.status, NEW.status;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- UNIQUE parcial: 1 marcador ativo por turno (scheduled OU recorded)
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_payments_job_active
    ON public.shift_payments (job_id)
    WHERE status IN ('scheduled', 'recorded');
```

**Razão:** modo A (pagamento externo registrado) precisa de promessa com data (uso real: empresa paga freela em data futura, não na hora). 
`scheduled` é **auditoria** (não move saldo, Article 8 intacto). `paid_at` deve ser **fato verdadeiro** (data real), nunca data futura disfarçada; 
logo nullable até efetivação. Trigger libera SÓ a transição `scheduled→recorded` do `paid_at` (NULL→data real, uma vez) — garante imutabilidade pós-efetivação. 
UNIQUE ativo barra 2 promessas OU promessa+pagamento em linhas distintas do mesmo turno; N linhas `voided` OK (reagendar). BI conta SÓ `recorded` 
(promessa ≠ liquidação).

---

## Padrões a serem extraídos

> Conforme novas tasks consolidam padrões, popular aqui via `harness-memory-updater` ou edição direta.
