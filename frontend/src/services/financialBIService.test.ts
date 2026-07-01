import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock supabase — chain genérica encadeável (select/eq/in/not) que resolve
// para `result` em maybeSingle()/single()/await direto (thenable), no padrão
// de paymentRecordService.test.ts. fromMock roteia por nome de tabela.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(result: { data: any; error: any }) {
  const promise = Promise.resolve(result)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    not: vi.fn(() => chain),
    order: vi.fn(() => chain),
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

// ---------------------------------------------------------------------------
// Fixtures — ADR-20260630 "Impacto no BI": gasto = escrow (released/captured)
// ∪ shift_payments (recorded), dedupe por job_id com precedência do escrow.
// ---------------------------------------------------------------------------

const WALLET_ROW = { id: 'wallet-company-1' }

const PERIOD = { start: '2026-06-01', end: '2026-07-01' }

// job-1 aparece nas DUAS fontes (anomalia) — escrow deve prevalecer (100, não 100+999).
// job-2 só aparece no marcador externo — deve somar (50).
const ESCROW_ROWS = [
  {
    amount: 100,
    captured_at: '2026-06-15T10:00:00Z',
    released_at: null,
    created_at: '2026-06-01T00:00:00Z',
    application_id: 'app-1',
    job_id: 'job-1',
  },
]

const SHIFT_PAYMENT_ROWS = [
  {
    amount: 999, // deve ser IGNORADO na soma — job-1 já tem escrow (precedência)
    paid_at: '2026-06-20T10:00:00Z',
    job_id: 'job-1',
    application_id: 'app-1',
    worker_id: 'worker-1',
  },
  {
    amount: 50, // job_id disjunto — soma normalmente
    paid_at: '2026-06-21T10:00:00Z',
    job_id: 'job-2',
    application_id: null,
    worker_id: 'worker-2',
  },
]

const APPLICATIONS_ROWS = [
  {
    id: 'app-1',
    worker_id: 'worker-1',
    job_id: 'job-1',
    worker_checkin_at: null,
    worker_checkout_at: null,
    status: 'completed',
  },
]

const JOBS_ROWS = [
  { id: 'job-1', estimated_hours: 8 },
  { id: 'job-2', estimated_hours: 5 },
]

const WORKERS_ROWS = [
  { id: 'worker-1', full_name: 'Worker Um', avatar_url: null, photo_url: null },
  { id: 'worker-2', full_name: 'Worker Dois', avatar_url: null, photo_url: null },
]

// ---------------------------------------------------------------------------
// BI-1: getAccumulatedSpend — dedupe por job_id (escrow precede)
// ---------------------------------------------------------------------------

describe('FinancialBIService.getAccumulatedSpend — fonte unificada (escrow ∪ shift_payments)', () => {
  it('soma escrow + marcador externo com job_id disjuntos, e IGNORA o marcador quando o job_id já tem escrow (precedência do escrow)', async () => {
    routeFrom({
      wallets: makeChain({ data: WALLET_ROW, error: null }),
      escrow_transactions: makeChain({ data: ESCROW_ROWS, error: null }),
      shift_payments: makeChain({ data: SHIFT_PAYMENT_ROWS, error: null }),
    })

    const { FinancialBIService } = await import('./financialBIService')
    const result = await FinancialBIService.getAccumulatedSpend('company-1', PERIOD)

    // 100 (escrow, job-1) + 50 (external, job-2) — os 999 do marcador de job-1 são descartados.
    expect(result.totalAmount).toBe(150)
  })

  it('soma só o marcador externo quando não há wallet/escrow (empresa que só usa o modo A)', async () => {
    routeFrom({
      wallets: makeChain({ data: null, error: null }),
      shift_payments: makeChain({
        data: [SHIFT_PAYMENT_ROWS[1]], // só o job-2 (50)
        error: null,
      }),
    })

    const { FinancialBIService } = await import('./financialBIService')
    const result = await FinancialBIService.getAccumulatedSpend('company-1', PERIOD)

    expect(result.totalAmount).toBe(50)
  })

  it('descarta linhas de shift_payments fora do período (filtro por paid_at)', async () => {
    routeFrom({
      wallets: makeChain({ data: WALLET_ROW, error: null }),
      escrow_transactions: makeChain({ data: [], error: null }),
      shift_payments: makeChain({
        data: [{ ...SHIFT_PAYMENT_ROWS[1], paid_at: '2026-05-15T10:00:00Z' }], // mês anterior
        error: null,
      }),
    })

    const { FinancialBIService } = await import('./financialBIService')
    const result = await FinancialBIService.getAccumulatedSpend('company-1', PERIOD)

    expect(result.totalAmount).toBe(0)
  })

  it('retorna zero (best-effort) sem lançar exceção em erro de query', async () => {
    routeFrom({
      wallets: makeChain({ data: WALLET_ROW, error: null }),
      escrow_transactions: makeChain({ data: null, error: { message: 'db error' } }),
      shift_payments: makeChain({ data: null, error: { message: 'db error' } }),
    })

    const { FinancialBIService } = await import('./financialBIService')
    const result = await FinancialBIService.getAccumulatedSpend('company-1', PERIOD)

    expect(result.totalAmount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// BI-2: getSpendByWorker — agrega gasto+horas por freela nas duas fontes
// ---------------------------------------------------------------------------

describe('FinancialBIService.getSpendByWorker — agrega escrow + marcador externo por freela', () => {
  it('agrega worker-1 (escrow, via application) e worker-2 (externo, sem application) separadamente', async () => {
    routeFrom({
      wallets: makeChain({ data: WALLET_ROW, error: null }),
      escrow_transactions: makeChain({ data: ESCROW_ROWS, error: null }),
      shift_payments: makeChain({ data: SHIFT_PAYMENT_ROWS, error: null }),
      applications: makeChain({ data: APPLICATIONS_ROWS, error: null }),
      jobs: makeChain({ data: JOBS_ROWS, error: null }),
      workers: makeChain({ data: WORKERS_ROWS, error: null }),
    })

    const { FinancialBIService } = await import('./financialBIService')
    const result = await FinancialBIService.getSpendByWorker('company-1', PERIOD)

    expect(result).toHaveLength(2)

    const worker1 = result.find((w) => w.workerId === 'worker-1')
    const worker2 = result.find((w) => w.workerId === 'worker-2')

    // worker-1: só a linha de escrow (job-1) conta — o marcador de job-1 foi deduplicado.
    expect(worker1?.totalAmount).toBe(100)
    expect(worker1?.totalHours).toBe(8) // fallback estimated_hours (sem checkin/checkout)
    expect(worker1?.shiftsCount).toBe(1)

    // worker-2: só a linha externa (job-2, sem escrow) conta.
    expect(worker2?.totalAmount).toBe(50)
    expect(worker2?.totalHours).toBe(5) // fallback estimated_hours via job-2
    expect(worker2?.shiftsCount).toBe(1)
  })

  it('retorna lista vazia quando não há gasto em nenhuma fonte no período', async () => {
    routeFrom({
      wallets: makeChain({ data: WALLET_ROW, error: null }),
      escrow_transactions: makeChain({ data: [], error: null }),
      shift_payments: makeChain({ data: [], error: null }),
    })

    const { FinancialBIService } = await import('./financialBIService')
    const result = await FinancialBIService.getSpendByWorker('company-1', PERIOD)

    expect(result).toEqual([])
  })
})
