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

## ⚠️ Cancelamento é SOFT DELETE (`status='deleted'`), nunca `DELETE`

Turno cancelado = `UPDATE jobs SET status='deleted'`. Nunca `DELETE` do banco.

**Razão:** DELETE em cascata mata:
- `shift_calls` cascata → perde métrica `first_claim_at` (tempo de preenchimento, prova de ROI).
- `escrow_transactions` cascata → apaga razão/auditoria, não devolve saldo (quebra Article 8).
- `shift_payments` RESTRICT → aborta toda operação em lote se qualquer freela tem pagamento registrado.

O valor `'deleted'` já está espalhado no codebase (`.neq('status','deleted')` em consumidores); nenhum CHECK vigente o bloqueia.
Usar a mesma coluna/valor que já existe evita drift. Metadado `deleted_at` é imutável para auditoria.

**Padrão:** Toda operação de exclusão em massa (`update_job_series_future`, `stop_job_series`) usa `status='deleted'`, nunca DELETE real. RPC DEFINER executa a guarda.

## ⚠️ Predicado de segurança lido sob RLS falha aberto

Uma política que âncora só em `jobs.company_id = auth.uid()` é "âncora simples". Se uma query usa NOT EXISTS/NÃO ENCONTROU,
a RLS simples torna a condição **verdadeira falsa** — a linha fica invisível e a subquery pensa que "não existe".

**Exemplo:** `applications` policy de INSERT acessa `jobs.company_id`; `jobs` tem RLS simples. Se empresa X tenta convidar freela Y para job Z e a policy de `jobs` diz "empresa X não é dona", então `NOT EXISTS (SELECT ... FROM jobs WHERE ...)` retorna verdadeiro = INSERT é permitido silenciosamente, criando convite fantasma. Queremos falhar explícito.

**Defesa:** Operações em massa ("alterar 20 turnos futuros") NUNCA exploram RLS simples no client. Usam RPC **SECURITY DEFINER** com autorização explícita no próprio Postgres. RPCs com DEFINER contornam a RLS do invoker e decidem tudo num lugar auditável.

**Padrão:** Check-then-act em massa = RPC DEFINER, nunca loop no client. Mesma disciplina de `walletService` (operações financeiras são RPCs).

## ⚠️ `p_dry_run` como padrão de pré-visualização

Quando a UI precisa mostrar "isso vai afetar N linhas" antes de uma ação destrutiva, **duplicar o predicado no client é proibido** (mente sob RLS).

**Correto:** Adicionar parâmetro `p_dry_run boolean` na própria RPC. Mesma lógica, mesmo predicado, mesmo lugar — skip só o statement mutante:
```sql
IF NOT p_dry_run THEN
  UPDATE jobs SET status='deleted' WHERE (predicado de seleção);
END IF;
RETURN jsonb_build_object('outcome', 'preview', 'would_cancel', affected_count);
```

**Padrão:** `previewUpdateFutureOccurrences` e `previewStopSeries` chamam as mesmas RPCs com `p_dry_run=true`. Mantém predicado único (nunca copia lógica), zero duplicação de risco.

## ⚠️ `TZ` fixo no vitest é obrigatório

O CI roda em UTC (offset=0); entre 21h, 23h e 23h59 em BRT (UTC-3, offset=-3), conversões de data podem dar resultados idênticos
em UTC quando diferem em local — qualquer regressão de fuso passa verde no CI.

**Correto:** Configurar `vitest.config.ts`:
```ts
const config: defineConfig = {
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    env: { TZ: 'America/Sao_Paulo' }
  }
}
```

**Padrão:** O guarda existia na máquina do dev (BRT) e faltava no CI. F3 descobriu via teste regressivo. Sempre fixar TZ em testes de data.

## ⚠️ Índice único NÃO protege duplo-clique se a chave inclui id gerado

UNIQUE `(series_id, series_occurrence_date)` não dedupe operações duplas porque `series_id` é **gerado pela própria requisição**.
Duas submissões idênticas (duplo-clique rápido) criam dois `job_series` com IDs diferentes; o índice nunca colide entre eles.

**Defesa real:** UI (`disabled={loading}` no botão) + token de sessão no client. Índice UNIQUE é defesa contra **datas duplicadas dentro do mesmo lote**,
não contra duplo-clique de botão.

**Conhecimento reutilizável:** Se a chave de dedupe contém algo gerado na própria operação, ela não dedupe operações.
Chaves estáveis (`user_id:reference_id` em `wallet_transactions`) já existem; novas aplicações devem seguir o padrão.

## ⚠️ Ordem de serialização entre RPCs concorrentes via lock na mesma linha

`stop_job_series` e `claim_shift_slot` (ambas de F1/F3) são seguras entre si porque ambas travam o **mesmo objeto** (`jobs FOR UPDATE`).

Executando concorrentemente:
- Quem executa `stop_job_series` primeiro seta `jobs.status='deleted'`.
- Quem executa `claim_shift_slot` depois lê a linha nova e cai no ramo "série parada" (retorna erro estruturado).
- Nenhuma race condition; nenhuma corrupção de estado.

**Padrão:** Operações concorrentes em massa = travar a **mesma entidade** (jobs, não série — a série é só config). Lock no recurso escasso.

## ⚠️ Ocorrência de série é `jobs` pura, sem wrapper

`jobs` com `series_id` é ocorrência. Sem `series_id`, é turno avulso (pull legado). Mas não há tabela separada `series_occurrences`.

**Razão:** 3 FKs (`shift_calls`, `applications`, `shift_payments`) apontam para `jobs.id`. Criar wrapper adicionaria migrations (FK novas),
mudança de todas as policies (filtrar por `jobs.id`), refactor do ciclo inteiro de check-in/checkout. EAGER evita isso: materializamos `jobs` direto,
sem camada de indireção.

**Contrato:** Agenda (`groupJobsByDay`), Chamado de Turno (`ShiftCallService`), Convite direto (`shiftInviteService`) não sabem que série existe.
`series_id` é só etiqueta; lógica de recurso/timeline roda em `jobs` como sempre.

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

## ⚠️ Idempotência de alerta via link estável + SELECT-before-INSERT (Slice 3 — REMOVIDO, piloto)

**HISTÓRICO:** Padrão da Slice 3 (camada BI com `spendLimitService`). Alerta de teto de gasto via `/company/financeiro` foi removido na Onda 2 do piloto. 
Services `spendLimitService` e `financialBIService` não existem mais. Reabertura: opt-in futuro por gatilho do ADR-20260630.

**Padrão permanente — Idempotência de notificação via link único (post-removível):**
Se uma notificação usa um `link` estável como chave de idempotência (ex.: `/company/worker/:id` para novo membro da equipe), o padrão SELECT-before-INSERT permanece válido:
```ts
// SELECT-before-INSERT: verificar se já existe notificação com este link
const { data: existing } = await supabase
  .from('notifications')
  .select('id')
  .eq('user_id', userId)
  .eq('link', stableLink)
  .limit(1)
  .maybeSingle();

if (existing) return; // Idempotência: notificação já enviada
```
Policy `WITH CHECK (auth.uid() = user_id)` destrava INSERT do client (usuário inserindo notificação para si — usado em operações best-effort).

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

-- UNIQUE parcial: 1 marcador ativo por (turno, freela) — ADR-20260816
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_payments_job_worker_active
    ON public.shift_payments (job_id, worker_id)
    WHERE status IN ('scheduled', 'recorded');
```

**Razão:** modo A (pagamento externo registrado) precisa de promessa com data (uso real: empresa paga freela em data futura, não na hora). 
`scheduled` é **auditoria** (não move saldo, Article 8 intacto). `paid_at` deve ser **fato verdadeiro** (data real), nunca data futura disfarçada; 
logo nullable até efetivação. Trigger libera SÓ a transição `scheduled→recorded` do `paid_at` (NULL→data real, uma vez) — garante imutabilidade pós-efetivação. 

O índice original assumia "1 freela por turno" (premissa não examinada, herdada de HALT sobre dimensão temporal). Achado do harness-evaluator: **um turno pode ter N freelas** 
(painel pós-criação de `CompanyCreateJob` convida vários). O UNIQUE foi trocado de `(job_id)` para `(job_id, worker_id)` (ADR-20260816) — agora barram 2 promessas OU promessa+pagamento 
**por freela do mesmo turno**, não por turno (granularidade volta a bater com `escrow_transactions`). N linhas `voided` OK (reagendar). BI conta SÓ `recorded` (promessa ≠ liquidação).

## Ordem crítica: frontend + adaptação ANTES de alargamento de constraint (Onda 1 — Revisão Piloto)

```
PROBLEMA: constraint alarga o que o DB aceita (ex.: `UNIQUE(job_id)` → `UNIQUE(job_id, worker_id)`)
→ múltiplas linhas casam com a mesma chave nova.

Quatro leituras do client usavam `.maybeSingle()` com a premissa "≤1 resultado". Se aplicar a migration
antes de adaptar o frontend, `.maybeSingle()` falha com PGRST116 (esperava 1, achou 2+), que o app trata
como null — a UI fica CEGA para ambas as linhas (card oferece "Registrar" para payment que existe; recibo 
diz "não encontrado" — PIOR que erro alto).

SOLUÇÃO (dois passos):
1. FRONTEND PRIMEIRO: adaptar o client para filtrar por nova dimensão da chave (ex.: `worker_id`).
   Compatível com banco ATUAL (query por freela devolve ≤1 linha). Pode ir a produção sozinho.
2. MIGRATION DEPOIS: criar novo índice ANTES de dropar o antigo (mesma transação); é um puro 
   destravamento, sem exigir mudança adicional de client.

Se o relógio do produto acabar entre os passos, o passo 1 converte erro silencioso em erro honesto
("outro freela deste turno já tem pagamento ativo") com contorno operacional.

Referência: ADR-20260816-marcador-pagamento-por-freela.md §Ordem de aplicação
```

**Razão:** toda mudança de constraint MAIS FROUXA precisa de adaptação de código primeiro. Reverso (aplicar schema antes de adaptar client) cria instante de vulnerabilidade onde dados válidos quebram queries antigas.

## DELETE/UPDATE sob RLS negado silenciosamente (Onda 1 — Revisão Piloto)

```tsx
// ✗ ERRADO — assume que DELETE sempre remove
const result = await supabase
  .from('team_connections')
  .delete()
  .eq('worker_id', workerId)
  .eq('company_id', companyId);
// Se a policy USING bloqueia a linha, retorna 0 sem erro (não é EXCEPTION).
// A UI mente: "removido" quando na verdade foi "negado por RLS".

// ✓ CORRETO — .select() para distinguir "negado" de "sucesso"
const { data, error } = await supabase
  .from('team_connections')
  .delete()
  .eq('worker_id', workerId)
  .eq('company_id', companyId)
  .select('id');  // ← obrigatório (SEM maybeSingle())

if (!data || data.length === 0) {
  // RLS bloqueou (linha nenhuma casou o USING) — não há erro, só 0 linhas afetadas
  return { success: false, error: 'Não foi possível remover este freela: ele encerrou a conexão com a sua empresa.' };
}

// Realmente removido
return { success: true };
```

**Razão:** DELETE/UPDATE sob RLS que não casa com a cláusula USING retorna PostgREST status 204 (sem erro). Padrão obrigatório
em toda operação destrutiva guardada por RLS. Exemplo real: `teamConnectionService.removeFromTeam()` (migração `20260816000000`)
impede DELETE de linhas `status='blocked'` bloqueadas pelo worker — precisa de `.select()` para saber se foi negado.

## ⚠️ GRANT UPDATE (coluna) é aditivo — exige REVOKE antes (F2 — Listas do Elenco)

**Problema:** `ALTER TABLE t ADD COLUMN c; GRANT UPDATE (c) ON t TO authenticated;` NÃO retira privilégio de UPDATE da tabela inteira.
Se `authenticated` já tinha `UPDATE` de toda a tabela, o GRANT de coluna fica **adormecido** — update de outra coluna passa.
A restrição só vale se forem feitos, **nesta ordem**:
```sql
REVOKE UPDATE ON <tabela> FROM authenticated;      -- (1) revoga de tabela inteira
GRANT UPDATE (<coluna_1>, <coluna_2>) ON <tabela> TO authenticated;  -- (2) reconstrói só as colunas permitidas
```

Sem (1), (2) é noop — a table-level GRANT ganha. **Ordem importa porque REVOKE sem lista de colunas revoga TANTO o privilégio de tabela QUANTO todos os de coluna**.

**Manifesta em runtime no `.update()`:** Uma chamada como `.update({ name: 'novo', other_col: 'valor' })` que inclua uma coluna não-permitida devolve `42501` (permission denied). A **mensagem não menciona coluna** — parece erro de RLS puro, não de GRANT. O padrão de teste correto é:
```ts
expect(supabase.from('tabela').update({ name: 'x' })).resolves.toBeDefined();  // ✓ só coluna permitida
expect(supabase.from('tabela').update({ name: 'x', forbidden: 'y' })).rejects.toThrow('42501');  // ✗ inclui coluna proibida
```

**Precedentes:** `20260311300000_restrict_wallet_update_columns.sql` (pattern histórico, wallet_id imutável), e F2 usa o mesmo padrão para `company_id` em `team_lists`.

---

## Sem transação entre chamadas PostgREST — ordenação crítica de INSERT/DELETE (F2 — diff de membros)

Operação `setMembers(listId, workerIds)` computa diff: workers-a-adicionar (INSERT) vs. workers-a-remover (DELETE).

**Ordem obrigatória:** INSERT primeiro, depois DELETE. Se DELETE falhar, os dados novos já foram inseridos — falha parcial é detectável.
Invertida (DELETE então INSERT), um DELETE que falha deixa linhas órfãs sem INSERT para compensar.

```ts
// ✓ CORRETO — INSERT antes de DELETE
const toAdd = newSet.filter(id => !currentSet.has(id));
for (const workerId of toAdd) {
  const { error: addError } = await supabase.from('team_list_members').insert({ list_id: listId, worker_id: workerId });
  if (addError) throw addError;
}

const toRemove = Array.from(currentSet).filter(id => !newSet.has(id));
for (const workerId of toRemove) {
  const { error: removeError } = await supabase.from('team_list_members').delete().eq('list_id', listId).eq('worker_id', workerId);
  if (removeError) throw removeError;
}
```

**Razão:** sem transação entre as chamadas (Supabase/PostgREST não oferece multi-statement), ordem define o estado consistente. INSERT-primeiro é padrão defensivo: se algo falha, adiciona-se dado e não remove-se (comissão vs. rollback automático).

---

## `.in('coluna', [])` devolve 0 linhas — pule a chamada (F2 — filtro de disponíveis)

Ao calcular membros disponíveis de uma lista (aceitos no elenco E não-excluídos do turno), após intersecção:
```ts
const availableInList = listMembers.filter(id => available.has(id));  // Pode ser []

if (availableInList.length === 0) {
  // ✗ ERRADO — .in() com array vazio retorna 0 linhas, não erro
  const { data } = await supabase.from('workers').select('*').in('id', availableInList);
  // data = [] — verdade ou RLS negou? Indistinto.
  
  // ✓ CORRETO — pule a query
  return [];
}

const { data } = await supabase.from('workers').select('*').in('id', availableInList);
return data ?? [];
```

**Razão:** `.in('coluna', [])` não retorna erro — devolve 0 linhas. Como o projeto usa "0 linhas = RLS negou" como sinal em alguns padrões (DELETE/UPDATE), confundir um array legitimamente vazio com negação de acesso causa bugs silenciosos. Pular a query é explícito e eficiente.

---

## Par `is_job_owner` ↔ `is_company_owner` mantidos em paralelo (F2 — autorização de empresa)

**Situação:** F2 introduz `is_company_owner(company_id)` paralela a `is_job_owner(job_id)`, ambas com a mesma ancoragem dupla:
```sql
company_id = auth.uid() OR company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid())
```

Ambas são **SECURITY INVOKER** (não DEFINER), **STABLE**, com `SET search_path = ''`. Não foram unificadas porque:

1. **Dependência não registrada em corpo de função SQL-as-string:** Se `is_job_owner` delegasse para `is_company_owner` em uma migration, um `DROP FUNCTION is_company_owner` (seu DOWN) quebraria `is_job_owner` **em runtime**, sem erro em tempo de DROP — tabelas que a usam em policy cai silenciosamente.

2. **F3 (multi-unidade/gerente) deve unificar:** Contrato de manutenção: `is_job_owner` e `is_company_owner` são um par. Qualquer mudança na regra de autorização de empresa (adoção de multi-unidade, gerentes, etc.) DEVE alterar **ambas na mesma migration**, e ali a unificação vira naturalmente possível (delegação + BEGIN ATOMIC em PG14+ registra dependência). Cada função carrega COMMENT cruzada e referência ao ADR-20260817.

**Padrão observável:** duplicação intencional quando: (a) corpo SQL como string (sem rastreamento de dependência), (b) conceitos paralelos (job vs. empresa), (c) mudança futura previsível que unifique. Não vale a pena "DRY" se o custo é quebra silenciosa de schema.

---

## Grafo acíclico de policies dispensa SECURITY DEFINER (F2 — `team_lists` ↔ `team_list_members`)

F1 ("Chamado de Turno") precisou de dois helpers SECURITY DEFINER mínimos (`shift_call_job_id`, `is_shift_call_target`) porque as policies de `shift_calls` e `shift_call_targets` se referenciavam mutuamente — erro 42P17 em runtime.

F2 tem grafo **acíclico:** `team_lists` referencia `companies` (SELECT `USING (true)`); `team_list_members` referencia `team_lists` (subquery em policy) E `companies` — mas **`team_lists` NÃO referencia `team_list_members` em nenhuma policy**. Sem aresta de volta = sem recursão = sem DEFINER precisado.

**Critério de decisão:** Antes de criar função SECURITY DEFINER para desbloquear RLS:
1. Mapear dependências policy entre tabelas (quem referencia quem em USING/WITH CHECK).
2. Se houver ciclo (A→B→A), DEFINER é necessário. Se grafo é DAG, não.
3. Se DAG mas policy é complexa, pode valer uma função simples por clareza (não por necessidade).

Documentação do critério: ADR-20260817-seam-autorizacao-empresa.md §Grafo acíclico.

---

## ⚠️ Tentativa é evento, contrato é linha (F4 — Confirmação de Véspera)

Confirmação de presença no turno é uma **tentativa**, não o contrato (application). Uma vaga pode ter 10 freelas;
cada um pode receber N tentativas de confirmação (reenvios se não responder em 12h).

**Padrão correto:** criar tabela-evento separada (`shift_attendance_confirmations`):
```sql
CREATE TABLE public.shift_attendance_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id),
  worker_id uuid NOT NULL REFERENCES workers(id),
  request_sent_at timestamptz,
  worker_responded_at timestamptz,
  response text,
  confirmation_status text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_attendance_confirmations_job_worker ON public.shift_attendance_confirmations(job_id, worker_id);
-- Sem UNIQUE — múltiplas tentativas/reenvios por (job, worker)
-- RLS: SELECT-only. INSERT/UPDATE via RPC DEFINER.
```

**Razão anti-padrão (colunas em applications):** Adicionar `attendance_attempts jsonb` em `applications` levaria a:
- Lógica de tentativa duplicada (INSERT notifications em dois places)
- Histórico perdido ou não-consultável (N tentativas em coluna = sem índice = varredura)
- Máquina de estados fragmentada (`applications.status` + `applications.attendance_attempt_status`)

**Benefício:** cada linha é auditável. SQL consultável. Reutilizável futuro (retry com backoff, análise de padrão de não-aparecimento, webhook de SMS).

## ⚠️ Coluna nova em `applications` nasce gravável — padrão: tabela-evento + RPC DEFINER (F4)

Supabase grant via `GRANT SELECT, INSERT, UPDATE ON applications TO authenticated` é de **tabela**, não de coluna.
Adicionar coluna nova em `applications` a faz gravável pelo client via `.update()` sem política de coluna explícita.

**Problema:** se a coluna é estado crítico (ex.: tentativa de confirmação), permitir escrita direta do client quebra auditoria.

**Padrão:** estado que precisa de imutabilidade/auditoria vai para **tabela-evento própria com RLS só de SELECT**:
```sql
ALTER TABLE applications
  ADD COLUMN confirmation_requested_at timestamptz;  -- ✗ se precisa imutabilidade

-- ✓ CORRETO — nova tabela-evento
CREATE TABLE shift_attendance_confirmations (...)  -- RLS SELECT-only
-- INSERT/UPDATE via RPC DEFINER (business logic no banco, não no client)
```

**Precedente histórico:** padrão de `shift_call_targets` (F1) seguiu o mesmo: tabela separada, RLS SELECT-only, mutação por RPC. Landmine corrigido em F4: descoberto em `20260817` que colunas novas nascem gravável silenciosamente.

## ⚠️ Escolha de timing depende de quem precisa ser alcançado — não existe agendador em produção (F4)

Worki **não tem** agendador em produção (`pg_cron` v1.6.4 está **disponível mas não instalado**; nenhum `cron.schedule` em migration,
nenhum `crons` em `vercel.json`, nenhum `schedule` em workflows; `expire-invites` existe e nunca rodou). Há **dois caminhos legítimos**
para features que dependem de timing — **a escolha depende de quem precisa ser alcançado**, não de preferência técnica.

**Caminho 1: Expiração preguiçosa (padrão F1 — Chamado de Turno)**
```
Convite enviado com expiration_at → quem chegar atrasado (próxima visita) fecha o estado
Funciona quando alguém vai INEVITAVELMENTE tocar naquele registro
Exemplo: shift_call com status='open' → freela lê, vê data de expiração, marca como 'expired' na UI
Custo: zero. Alcance: só quem abre o app.
```

**Caminho 2: `cron.schedule` versionado em migration (padrão F4 — Confirmação de Véspera) — MANDATÓRIO aqui**
```
Noite antes do turno (cron roda 20h UTC) → RPC batch alcança N freelas SEM eles abrirem app
Necessário quando o valor depende de ALCANÇAR QUEM NÃO VAI ABRIR A TELA
Exemplo: "confirme presença amanhã" — se esperar freela abrir o app, 8h30 já passou (quebra do turno)
Custo: agendador em produção (pré-requisito). Alcance: proativo, sem depender do usuário.
```

**Critério de decisão — alcance necessário:** A promessa da feature decide o padrão. Se é "descobrir furo 12h antes", preguiçoso
**não funciona** (freela descobrindo o aviso após perder o turno = comportamento humano que a feature existe para **substituir**).

**ADR feedback:**
- **Architect reprovou v1** (só botão manual): *"entrega a UI de uma feature cuja promessa não é cumprida por nenhum código do PR… 
  o piloto atribuiria o silêncio ao produto, não à configuração ausente."*
- **Evaluator:** ausência de pg_cron = **ALTO**. *"A feature é um botão que o gerente precisa lembrar de apertar na véspera — 
  que é literalmente o comportamento humano que a feature existe para substituir."*

**Implementação F4:**
```sql
IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
  SELECT cron.schedule('request_attendance_confirmations_7d', '20 * * * *', 
    $$SELECT public.batch_request_attendance_confirmations_7d();$$);
END IF;
```
Graceful: migration passa sem erro se pg_cron não está. **Mas a feature é incompleta sem cron** — é pré-requisito de entrega
(não item de backlog). Runbook deve documentar: "ops: habilitar pg_cron antes de validar F4 em produção".

**Padrão observável:** 
- Expiração preguiçosa = funciona hoje, funciona sem config. 
- Cron versionado = exige instalação. Escolha pelo alcance necessário, não por disponibilidade de tech.

## ⚠️ `RAISE WARNING` não chega aos aplicadores via MCP (F4 — logs de migração)

Migrations neste projeto são aplicadas por **MCP** (Supabase Management API, canal de aplicação da CLI). MCP engole
`NOTICE` e `WARNING` — avisos em SQL não chegam ao runbook/logs do aplicador.

**Exemplo anti-padrão (F4):**
```sql
-- ✗ ERRADO — aviso engolido
IF NOT pg_extension_installed('pg_cron') THEN
  RAISE WARNING 'pg_cron não encontrado — confirmação de véspera funcionará via frontend apenas.';
END IF;
```
Aplicador nunca vê o aviso. Runbook para F4 precisa dizer explicitamente: "ops: validar se pg_cron está instalado
com `\dx pg_cron` na sua sessão psql direto".

**Defesa:** toda migration que depende de recurso externo precisa ter:
1. **Verificação SQL em UP:** `IF EXISTS (SELECT ... FROM pg_available_extensions WHERE ...)` com graceful fallback
2. **Runbook explícito:** instruções de validação **no arquivo da migration** como comentário (READ-ME-APLICACAO.md)
3. **Sem RAISE** — instruções vão direto em COMMENT dentro do arquivo .sql

**Padrão:** validação > aviso. Código SQL não conta com warnings chegarem a humanos.

## ⚠️ Predicado consumido sem sessão precisa ser `SECURITY DEFINER` (F4 — cron lê `jobs`)

Função lida por um consumidor **sem sessão** (`auth.uid()` NULL) não pode depender de RLS simples.

**Exemplo (F4):** cron chama `batch_request_attendance_confirmations_7d()` → precisa ler `jobs` para saber "qual turno
é amanhã em fuso local?". A function `job_local_date(job_id)` converte UTC para local via `settings.app_timezone`.

```sql
-- ✗ ERRADO — cron roda sem sessão, `auth.uid()` = NULL
CREATE FUNCTION job_local_date(p_job_id uuid) RETURNS date AS $$
  SELECT (jobs.start_date AT TIME ZONE settings.app_timezone)::date
  FROM jobs                               -- ← policy SELECT depende de RLS
  WHERE jobs.id = p_job_id;
$$ LANGUAGE sql STABLE;  -- ← INVOKER padrão
-- Resultado: quando cron chama, RLS nega acesso → retorna NULL

-- ✓ CORRETO — SECURITY DEFINER ignora RLS do invoker
CREATE FUNCTION job_local_date(p_job_id uuid) RETURNS date AS $$
  SELECT (jobs.start_date AT TIME ZONE (SELECT value FROM settings WHERE key = 'app_timezone'))::date
  FROM jobs                               -- ← RLS agora irrelevante
  WHERE jobs.id = p_job_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';
```

**Regra:** Se consumidor não tem sessão (cron, trigger, webhook desautenticado), função INVOKER que acessa tabela com RLS retorna falso → silenciosamente. Sem erro no LOG; a feature para de funcionar sem aviso. **Sempre use SECURITY DEFINER + search_path='' para funções lidas por consumidores sem sessão.**

**Consequência:** função DEFINER sem `search_path = ''` é vulnável a name shadowing de schema externo.

## ⚠️ Teste de mutação prova mais que teste decorativo (F4 — confirmação de presença)

Teste que afirma "ordem está correta" SEM verificar estado intermediário passa falso até quando a ordem está invertida.

**Exemplo real (F4):** dois testes foram quebrados ao reescrever o código:
1. **Teste de ordem de notificações** — passava com ordem invertida porque asseverava só o DOM final (onde a ordem é indistinguível até ler o HTML inteiro). Virou `toBeTruthy()` sem validar conteúdo real.
2. **Teste de mensagem específica** — 16 casos que diziam "mensagem contém 'X'" e verificavam `toBeTruthy()`, sem afirmar a string real.

**Padrão de teste real:** bloquear a operação em `Promise.pending()` controlada e validar estado intermediário:
```ts
// ✗ ERRADO — afirma só resultado final
test('notifications arrive in order', async () => {
  await requestConfirmation(worker1);
  await requestConfirmation(worker2);
  // Renderiza UI... passa se worker1 ou worker2 vier primeiro
  expect(screen.getByText('worker1')).toBeInTheDocument();  // ✓ mas worker2 primeiro? Também passa
});

// ✓ CORRETO — segura promise e valida estado intermediário
test('notifications arrive in order', async () => {
  let resolveNotification: Function | null = null;
  jest.spyOn(notificationService, 'notify').mockImplementation(
    () => new Promise(r => { resolveNotification = r; })
  );

  await requestConfirmation(worker1);
  // Notificação de worker1 está pendente
  expect(screen.getByText('notification: worker1')).toBeInTheDocument();  // Intermediário
  expect(screen.queryByText('notification: worker2')).not.toBeInTheDocument();  // worker2 ainda não

  resolveNotification?.();  // Libera notificação worker1
  await waitFor(() => expect(screen.getByText('received: worker1')).toBeInTheDocument());

  await requestConfirmation(worker2);
  // worker1 recebeu, worker2 agora está pendente
  expect(screen.getByText('notification: worker2')).toBeInTheDocument();  // Nova
  resolveNotification?.();
  await waitFor(() => expect(screen.getByText('received: worker2')).toBeInTheDocument());

  // Ordem é verificável aqui porque capturamos transições, não só resultado final
});
```

**Razão:** teste que só valida o **resultado final** é "teste decorativo" — prova menos que parece. Validade real = **estado intermediário** (qual vem antes, qual depende do quê). Especialmente crítico em features com timeline/notificações/máquinas de estado.

## WhatsApp como canal de notificação sem backend (aviso manual de convite)

```ts
// shiftInviteService.ts — helpers puros de normalização e montagem de mensagem
export function normalizePhoneForWhatsApp(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  
  // Já veio com DDI 55 (12 = DDD + 8 dígitos + 55; 13 = DDD + 9 dígitos + 55)
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    return digits;
  }
  
  // Número local sem DDI (10 = fixo, 11 = celular)
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  
  return null; // Formato inválido — nunca cria `wa.me/undefined`
}

export function buildShiftInviteWhatsAppMessage(params: {
  companyName: string;
  jobTitle: string;
  dateLabel?: string | null;  // Pré-formatado (ex.: "16/08/2026")
  timeLabel?: string | null;  // Pré-formatado (ex.: "08:00 às 17:00")
  location?: string | null;
  amount?: number | null;      // Em BRL
  appUrl: string;             // Link deep-linkado para o app
}): string {
  // Linhas compostas, filtro de nulls, join com \n
  const lines = [
    `Oi! Aqui é ${params.companyName || 'a empresa'} pelo Worki.`,
    `Te convidei para o turno "${params.jobTitle}"${params.dateLabel ? `, ${params.dateLabel}` : ''}${params.timeLabel ? ` (${params.timeLabel})` : ''}.`,
    params.location ? `Local: ${params.location}` : null,
    typeof params.amount === 'number' && params.amount > 0
      ? `Valor: R$ ${params.amount.toFixed(2).replace('.', ',')}`
      : null,
    '',
    `Dá uma olhada e responde no app: ${params.appUrl}`,
  ].filter((line): line is string => line !== null);
  
  return lines.join('\n');
}

// Uso em CompanyJobCandidates.tsx:
const phone = normalizePhoneForWhatsApp(worker.phone);
if (phone) {
  const message = buildShiftInviteWhatsAppMessage({
    companyName: companyName,
    jobTitle: job.title,
    dateLabel: formatDate(job.start_date),
    timeLabel: `${job.start_time} às ${job.end_time}`,
    location: job.location,
    amount: job.budget,
    appUrl: `${APP_URL}/my-jobs?invite=${application.id}`,
  });
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
}
```

**Razão:** convite push só existe dentro do app (notificação do navegador não sobrevive à aba fechada). Sem push/SMS nativo, o telefone cadastrado é o único
canal fora do app que a empresa tem à mão. Funções puras (sem I/O) — testáveis isoladas. Normalização de DDI é essencial: formato brasileiro mascarado
("(11) 99999-9999") vira "5511999999999"; invalido retorna `null` evitando links quebrados (`wa.me/undefined`). Mensagem pré-formatada (data, hora, valor, link do app)
oferece experiência profissional no WhatsApp — não é genérica ("você recebeu um convite"), mas contextualizada (turno, dia, valor, localização).
