import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock supabase — chain genérica encadeável (select/eq/neq/in) que resolve
// para `result` no await direto (thenable), no padrão de financialBIService.test.ts.
// fromMock roteia por nome de tabela.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(result: { data: any; error: any }) {
  const promise = Promise.resolve(result)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  }
  return chain
}

const mockGetUser = vi.fn()
const mockFrom = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
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
  mockGetUser.mockResolvedValue({ data: { user: { id: 'company-1' } } })
})

// ---------------------------------------------------------------------------
// Fixtures — 3 turnos no período: aberta (sem marcador), paga (recorded sem
// confirmação do freela) e conciliada (recorded + worker_confirmed_at).
// ---------------------------------------------------------------------------

const JOBS_ROWS = [
  {
    id: 'job-aberta',
    title: 'Garçom Evento X',
    category: 'Garçom',
    budget: 200,
    start_date: '2026-07-10',
    created_at: '2026-07-01T10:00:00Z',
    status: 'open',
  },
  {
    id: 'job-paga',
    title: 'Cozinheiro Evento Y',
    category: null,
    budget: 300,
    start_date: '2026-07-11',
    created_at: '2026-07-02T10:00:00Z',
    status: 'completed',
  },
  {
    id: 'job-conciliada',
    title: 'Segurança Evento Z',
    category: 'Segurança',
    budget: 250,
    start_date: '2026-07-12',
    created_at: '2026-07-03T10:00:00Z',
    status: 'completed',
  },
  {
    id: 'job-fora-do-periodo',
    title: 'Fora do período',
    category: null,
    budget: 100,
    start_date: '2026-05-01',
    created_at: '2026-05-01T10:00:00Z',
    status: 'completed',
  },
]

const SHIFT_PAYMENTS_ROWS = [
  {
    job_id: 'job-paga',
    worker_id: 'worker-paga',
    amount: 300,
    source: 'external_pix',
    status: 'recorded',
    paid_at: '2026-07-11T18:00:00Z',
    scheduled_for: null,
    worker_confirmed_at: null,
    created_at: '2026-07-11T10:00:00Z',
  },
  {
    job_id: 'job-conciliada',
    worker_id: 'worker-conciliada',
    amount: 250,
    source: 'cash',
    status: 'recorded',
    paid_at: '2026-07-12T18:00:00Z',
    scheduled_for: null,
    worker_confirmed_at: '2026-07-13T09:00:00Z',
    created_at: '2026-07-12T10:00:00Z',
  },
]

const APPLICATIONS_ROWS = [
  {
    job_id: 'job-aberta',
    worker_id: 'worker-aberta',
    status: 'hired',
    invitation_response: 'accepted',
  },
  {
    job_id: 'job-paga',
    worker_id: 'worker-paga',
    status: 'completed',
    invitation_response: 'accepted',
  },
  {
    job_id: 'job-conciliada',
    worker_id: 'worker-conciliada',
    status: 'completed',
    invitation_response: 'accepted',
  },
]

const WORKERS_ROWS = [
  { id: 'worker-aberta', full_name: 'Freela Aberta' },
  { id: 'worker-paga', full_name: 'Freela Paga' },
  { id: 'worker-conciliada', full_name: 'Freela Conciliada' },
]

function mockAllTables() {
  routeFrom({
    jobs: makeChain({ data: JOBS_ROWS, error: null }),
    shift_payments: makeChain({ data: SHIFT_PAYMENTS_ROWS, error: null }),
    applications: makeChain({ data: APPLICATIONS_ROWS, error: null }),
    workers: makeChain({ data: WORKERS_ROWS, error: null }),
  })
}

const PERIOD = { from: '2026-07-01', to: '2026-07-31' }

describe('OrderReportService.getReport — derivação de status e período', () => {
  it('deriva aberta/paga/conciliada corretamente e ignora turnos fora do período', async () => {
    mockAllTables()
    const { OrderReportService } = await import('./orderReportService')

    const report = await OrderReportService.getReport(PERIOD)

    expect(report.rows).toHaveLength(3)
    expect(report.rows.find((r) => r.jobId === 'job-fora-do-periodo')).toBeUndefined()

    const aberta = report.rows.find((r) => r.jobId === 'job-aberta')
    expect(aberta?.status).toBe('aberta')
    expect(aberta?.amount).toBe(200) // fallback pro budget do job
    expect(aberta?.workerName).toBe('Freela Aberta')
    expect(aberta?.workerId).toBe('worker-aberta')
    expect(aberta?.source).toBeNull()

    const paga = report.rows.find((r) => r.jobId === 'job-paga')
    expect(paga?.status).toBe('paga')
    expect(paga?.amount).toBe(300)
    expect(paga?.workerId).toBe('worker-paga')
    expect(paga?.source).toBe('external_pix')
    expect(paga?.paidAt).toBe('2026-07-11T18:00:00Z')

    const conciliada = report.rows.find((r) => r.jobId === 'job-conciliada')
    expect(conciliada?.status).toBe('conciliada')
    expect(conciliada?.workerName).toBe('Freela Conciliada')
    expect(conciliada?.workerId).toBe('worker-conciliada')

    expect(report.summary).toEqual({
      total: 3,
      abertas: 1,
      pagas: 1,
      conciliadas: 1,
      valorTotal: 200 + 300 + 250,
    })
  })

  it('filtra `rows` por status mas mantém `summary` com o período completo', async () => {
    mockAllTables()
    const { OrderReportService } = await import('./orderReportService')

    const report = await OrderReportService.getReport({ ...PERIOD, status: 'conciliada' })

    expect(report.rows).toHaveLength(1)
    expect(report.rows[0].jobId).toBe('job-conciliada')
    // summary continua refletindo os 3 turnos do período, não só o filtro aplicado
    expect(report.summary.total).toBe(3)
  })

  it('retorna vazio quando não há usuário autenticado', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    mockAllTables()
    const { OrderReportService } = await import('./orderReportService')

    const report = await OrderReportService.getReport(PERIOD)
    expect(report.rows).toEqual([])
    expect(report.summary.total).toBe(0)
  })

  it('retorna vazio (sem lançar) quando a query de jobs falha', async () => {
    routeFrom({
      jobs: makeChain({ data: null, error: { message: 'boom' } }),
    })
    const { OrderReportService } = await import('./orderReportService')

    const report = await OrderReportService.getReport(PERIOD)
    expect(report.rows).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// ADR-20260816 — marcador de pagamento por (turno, freela): um turno com N
// freelas pagos vira N linhas; turno sem NENHUM marcador continua com 1 linha
// (fallback pro freela "primário"), pra não sumir do relatório.
// ---------------------------------------------------------------------------

const JOBS_MULTI = [
  {
    id: 'job-dois-freelas',
    title: 'Evento Duplo',
    category: 'Garçom',
    budget: 500,
    start_date: '2026-07-20',
    created_at: '2026-07-15T10:00:00Z',
    status: 'completed',
  },
  {
    id: 'job-sem-pagamento',
    title: 'Turno Solo',
    category: 'Cozinheiro',
    budget: 220,
    start_date: '2026-07-21',
    created_at: '2026-07-16T10:00:00Z',
    status: 'open',
  },
]

const SHIFT_PAYMENTS_MULTI = [
  {
    job_id: 'job-dois-freelas',
    worker_id: 'worker-ana',
    amount: 150,
    source: 'external_pix',
    status: 'recorded',
    paid_at: '2026-07-20T18:00:00Z',
    scheduled_for: null,
    worker_confirmed_at: null,
    created_at: '2026-07-20T10:00:00Z',
  },
  {
    job_id: 'job-dois-freelas',
    worker_id: 'worker-bia',
    amount: 180,
    source: 'cash',
    status: 'recorded',
    paid_at: '2026-07-20T19:00:00Z',
    scheduled_for: null,
    worker_confirmed_at: '2026-07-21T09:00:00Z',
    created_at: '2026-07-20T11:00:00Z',
  },
]

const APPLICATIONS_MULTI = [
  { job_id: 'job-dois-freelas', worker_id: 'worker-ana', status: 'completed', invitation_response: 'accepted' },
  { job_id: 'job-dois-freelas', worker_id: 'worker-bia', status: 'completed', invitation_response: 'accepted' },
  { job_id: 'job-sem-pagamento', worker_id: 'worker-solo', status: 'hired', invitation_response: 'accepted' },
]

const WORKERS_MULTI = [
  { id: 'worker-ana', full_name: 'Ana Freela' },
  { id: 'worker-bia', full_name: 'Bia Freela' },
  { id: 'worker-solo', full_name: 'Freela Solo' },
]

describe('OrderReportService.getReport — granularidade (turno, freela) — ADR-20260816', () => {
  it('turno com dois freelas pagos vira duas linhas com nome/valor certos e o total somando as duas; turno sem pagamento continua presente com 1 linha', async () => {
    routeFrom({
      jobs: makeChain({ data: JOBS_MULTI, error: null }),
      shift_payments: makeChain({ data: SHIFT_PAYMENTS_MULTI, error: null }),
      applications: makeChain({ data: APPLICATIONS_MULTI, error: null }),
      workers: makeChain({ data: WORKERS_MULTI, error: null }),
    })
    const { OrderReportService } = await import('./orderReportService')

    const report = await OrderReportService.getReport(PERIOD)

    // Caso central: 1 turno + 2 freelas pagos = 2 linhas, ambas com jobId igual.
    const duploRows = report.rows.filter((r) => r.jobId === 'job-dois-freelas')
    expect(duploRows).toHaveLength(2)

    const ana = duploRows.find((r) => r.workerName === 'Ana Freela')
    const bia = duploRows.find((r) => r.workerName === 'Bia Freela')
    expect(ana).toBeDefined()
    expect(bia).toBeDefined()
    expect(ana?.workerId).toBe('worker-ana')
    expect(bia?.workerId).toBe('worker-bia')
    expect(ana?.amount).toBe(150)
    expect(bia?.amount).toBe(180)
    expect(ana?.status).toBe('paga') // recorded, sem worker_confirmed_at
    expect(bia?.status).toBe('conciliada') // recorded + worker_confirmed_at

    // Turno sem NENHUM marcador de pagamento continua com 1 linha (não some).
    const soloRows = report.rows.filter((r) => r.jobId === 'job-sem-pagamento')
    expect(soloRows).toHaveLength(1)
    expect(soloRows[0].workerName).toBe('Freela Solo')
    expect(soloRows[0].workerId).toBe('worker-solo')
    expect(soloRows[0].status).toBe('aberta')
    expect(soloRows[0].amount).toBe(220) // fallback pro budget do job

    // Sem dupla contagem nem subcontagem: total = 2 (duplo) + 1 (solo).
    expect(report.rows).toHaveLength(3)
    expect(report.summary.total).toBe(3)
    expect(report.summary.pagas).toBe(1)
    expect(report.summary.conciliadas).toBe(1)
    expect(report.summary.abertas).toBe(1)
    expect(report.summary.valorTotal).toBe(150 + 180 + 220)
  })
})

describe('toCSV', () => {
  it('gera CSV pt-BR com ";" e cabeçalho esperado, usando category como Função (fallback title)', async () => {
    mockAllTables()
    const { OrderReportService, toCSV } = await import('./orderReportService')

    const report = await OrderReportService.getReport(PERIOD)
    const csv = toCSV(report)
    const lines = csv.split('\r\n')

    expect(lines[0]).toBe('Data;Função;Freela;Valor;Forma;Status;Data Pgto')

    const pagaLine = lines.find((l) => l.includes('Freela Paga'))
    expect(pagaLine).toBeDefined()
    // job-paga tem category=null -> cai pro title
    expect(pagaLine).toContain('Cozinheiro Evento Y')
    expect(pagaLine).toContain('300,00')
    expect(pagaLine).toContain('PIX')
    expect(pagaLine).toContain('Paga')

    const abertaLine = lines.find((l) => l.includes('Freela Aberta'))
    expect(abertaLine).toContain('Garçom') // category presente
    expect(abertaLine).toContain('—') // sem forma de pagamento
  })

  it('escapa campos com ";" ou aspas', () => {
    const csvSource = {
      rows: [
        {
          jobId: 'job-x',
          workerId: 'worker-x',
          date: '2026-07-10',
          title: 'Turno; especial "raro"',
          category: null,
          workerName: 'Fulano',
          amount: 100,
          source: null,
          paidAt: null,
          status: 'aberta' as const,
        },
      ],
      summary: { total: 1, abertas: 1, pagas: 0, conciliadas: 0, valorTotal: 100 },
    }

    return import('./orderReportService').then(({ toCSV }) => {
      const csv = toCSV(csvSource)
      expect(csv).toContain('"Turno; especial ""raro"""')
    })
  })
})
