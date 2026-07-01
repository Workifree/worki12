import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock supabase — chain genérica encadeável (select/eq/in/insert/limit) que
// resolve para `result` em maybeSingle()/await direto (thenable), no padrão
// de financialBIService.test.ts / paymentRecordService.test.ts.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(result: { data: any; error: any }) {
  const promise = Promise.resolve(result)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    maybeSingle: vi.fn(() => promise),
    single: vi.fn(() => promise),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  }
  return chain
}

const mockFrom = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}))

// FinancialBIService.getAccumulatedSpend é a fonte ÚNICA de gasto acumulado (dedupe
// escrow ∪ shift_payments) — spendLimitService NÃO deve duplicar essa query.
const mockGetAccumulatedSpend = vi.fn()
vi.mock('./financialBIService', () => ({
  FinancialBIService: {
    getAccumulatedSpend: (...args: unknown[]) => mockGetAccumulatedSpend(...args),
  },
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function routeFrom(handlers: Record<string, any>) {
  mockFrom.mockImplementation((table: string) => {
    const handler = handlers[table]
    if (!handler) throw new Error(`Tabela não mockada: ${table}`)
    return handler
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// Data fixa, construída localmente (evita ambiguidade de timezone com strings ISO 'Z').
const NOW = new Date(2026, 5, 15, 12, 0, 0) // 2026-06-15 local

const SPEND_LIMIT_ROW = {
  company_id: 'company-1',
  period: 'month',
  scope: '',
  amount: 1000,
  alert_thresholds: [80, 90, 100],
  financial_contact_email: null,
  financial_contact_phone: null,
}

describe('SpendLimitService.evaluateSpendAlert — gasto acumulado via fonte unificada (ADR-20260630)', () => {
  it('delega o cômputo do gasto ao FinancialBIService.getAccumulatedSpend (BI-1 unificado) em vez de consultar escrow_transactions/shift_payments diretamente', async () => {
    mockGetAccumulatedSpend.mockResolvedValue({
      totalAmount: 850, // 85% do teto de 1000 — cruza o threshold de 80
      periodStart: '2026-06-01',
      periodEnd: '2026-07-01',
    })

    routeFrom({
      company_spend_limits: makeChain({ data: SPEND_LIMIT_ROW, error: null }),
      companies: makeChain({ data: { owner_id: 'owner-1' }, error: null }),
      // Mesma tabela serve o SELECT de idempotência (maybeSingle → null = sem alerta prévio)
      // e o INSERT do alerta (ambos resolvem no mesmo `result` do chain — ok para este teste).
      notifications: makeChain({ data: null, error: null }),
    })

    const { SpendLimitService } = await import('./spendLimitService')
    await SpendLimitService.evaluateSpendAlert('company-1', NOW)

    // Chamou o BI unificado com o período do mês corrente — não recomputa a query aqui.
    expect(mockGetAccumulatedSpend).toHaveBeenCalledWith('company-1', {
      start: '2026-06-01',
      end: '2026-07-01',
    })

    // Contrato de não-duplicação: spendLimitService não deve ler escrow/shift_payments
    // diretamente — isso é responsabilidade exclusiva do FinancialBIService.
    expect(mockFrom).not.toHaveBeenCalledWith('escrow_transactions')
    expect(mockFrom).not.toHaveBeenCalledWith('shift_payments')

    // E ainda assim dispara o alerta (85% cruza o threshold de 80%) usando o valor delegado.
    expect(mockFrom).toHaveBeenCalledWith('notifications')
  })

  it('não dispara alerta quando o gasto delegado não cruza nenhum threshold', async () => {
    mockGetAccumulatedSpend.mockResolvedValue({
      totalAmount: 100, // 10% do teto — não cruza 80/90/100
      periodStart: '2026-06-01',
      periodEnd: '2026-07-01',
    })

    const notificationsHandler = makeChain({ data: null, error: null })
    routeFrom({
      company_spend_limits: makeChain({ data: SPEND_LIMIT_ROW, error: null }),
      companies: makeChain({ data: { owner_id: 'owner-1' }, error: null }),
      notifications: notificationsHandler,
    })

    const { SpendLimitService } = await import('./spendLimitService')
    await SpendLimitService.evaluateSpendAlert('company-1', NOW)

    expect(mockGetAccumulatedSpend).toHaveBeenCalled()
    // Sem threshold cruzado, a função retorna antes de tocar em `notifications`.
    expect(mockFrom).not.toHaveBeenCalledWith('notifications')
  })

  it('não bloqueia (retorna silenciosamente) quando não há teto configurado — nunca falha o fluxo que o chama', async () => {
    routeFrom({
      company_spend_limits: makeChain({ data: null, error: null }),
    })

    const { SpendLimitService } = await import('./spendLimitService')
    await expect(SpendLimitService.evaluateSpendAlert('company-1', NOW)).resolves.toBeUndefined()

    // Sem teto configurado, nem chega a calcular o gasto.
    expect(mockGetAccumulatedSpend).not.toHaveBeenCalled()
  })
})
