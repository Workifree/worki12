import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ShiftPayment, PaymentSource, ShiftPaymentStatus } from '../types'

// ---------------------------------------------------------------------------
// Mock supabase — chain genérica encadeável (select/insert/update/eq) que
// resolve para `result` em maybeSingle()/single()/await direto (thenable).
// fromMock roteia por nome de tabela (um handler por tabela por teste).
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(result: { data: any; error: any }) {
  const promise = Promise.resolve(result)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(() => promise),
    single: vi.fn(() => promise),
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
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-company-1' } } })
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const APPLICATION_COMPLETED = {
  id: 'app-1',
  job_id: 'job-1',
  worker_id: 'worker-1',
  company_checkin_confirmed_at: '2026-06-30T09:00:00Z',
  company_checkout_confirmed_at: '2026-06-30T17:00:00Z',
}

const COMPANY_ROW = { id: 'company-1' }

const SHIFT_PAYMENT_ROW: ShiftPayment = {
  id: 'sp-1',
  job_id: 'job-1',
  company_id: 'company-1',
  worker_id: 'worker-1',
  application_id: 'app-1',
  source: 'external_pix',
  amount: 150,
  scheduled_for: null,
  paid_at: '2026-06-30T12:00:00Z',
  recorded_by: 'user-company-1',
  worker_confirmed_at: null,
  note: null,
  status: 'recorded',
  voided_at: null,
  void_reason: null,
  created_at: '2026-06-30T12:00:00Z',
}

const SCHEDULED_PAYMENT_ROW: ShiftPayment = {
  ...SHIFT_PAYMENT_ROW,
  id: 'sp-2',
  status: 'scheduled',
  scheduled_for: '2026-07-20',
  paid_at: null,
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

// Escopo de unidade (F13): os servicos passaram a resolver a empresa OPERADA pelo seam, em vez
// de `.eq('owner_id', user.id)`. O duble evita bater na RPC get_my_companies nos testes.
vi.mock('./companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
  getMyCompanies: vi.fn().mockResolvedValue([{ company_id: 'company-1' }]),
}))

describe('Tipos ShiftPayment', () => {
  it('ShiftPayment aceita todos os campos da migration', () => {
    expect(SHIFT_PAYMENT_ROW.status).toBe('recorded')
    expect(SHIFT_PAYMENT_ROW.source).toBe('external_pix')
    expect(SHIFT_PAYMENT_ROW.worker_confirmed_at).toBeNull()
  })

  it('PaymentSource aceita external_pix | cash | other', () => {
    const sources: PaymentSource[] = ['external_pix', 'cash', 'other']
    sources.forEach((s) => expect(['external_pix', 'cash', 'other']).toContain(s))
  })

  it('ShiftPaymentStatus aceita scheduled | recorded | voided', () => {
    const statuses: ShiftPaymentStatus[] = ['scheduled', 'recorded', 'voided']
    statuses.forEach((s) => expect(['scheduled', 'recorded', 'voided']).toContain(s))
  })

  it('ShiftPayment aceita voided com voided_at/void_reason preenchidos', () => {
    const voided: ShiftPayment = {
      ...SHIFT_PAYMENT_ROW,
      status: 'voided',
      voided_at: '2026-07-01T00:00:00Z',
      void_reason: 'Valor incorreto',
    }
    expect(voided.status).toBe('voided')
    expect(voided.voided_at).not.toBeNull()
  })

  it('ShiftPayment aceita scheduled com scheduled_for preenchido e paid_at nulo', () => {
    expect(SCHEDULED_PAYMENT_ROW.status).toBe('scheduled')
    expect(SCHEDULED_PAYMENT_ROW.scheduled_for).toBe('2026-07-20')
    expect(SCHEDULED_PAYMENT_ROW.paid_at).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// recordExternalPayment
// ---------------------------------------------------------------------------

describe('PaymentRecordService.recordExternalPayment', () => {
  it('rejeita amount <= 0 sem chamar o supabase', async () => {
    const { PaymentRecordService } = await import('./paymentRecordService')

    const result = await PaymentRecordService.recordExternalPayment({
      jobId: 'job-1',
      workerId: 'worker-1',
      applicationId: 'app-1',
      source: 'cash',
      amount: 0,
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/maior que zero/)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejeita quando o turno (application) não está concluído (checkout ainda não confirmado)', async () => {
    routeFrom({
      applications: makeChain({
        data: { ...APPLICATION_COMPLETED, company_checkout_confirmed_at: null },
        error: null,
      }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.recordExternalPayment({
      jobId: 'job-1',
      workerId: 'worker-1',
      applicationId: 'app-1',
      source: 'cash',
      amount: 100,
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/concluído/)
  })

  it('rejeita quando o turno (application) não está concluído (chegada ainda não confirmada)', async () => {
    routeFrom({
      applications: makeChain({
        data: { ...APPLICATION_COMPLETED, company_checkin_confirmed_at: null },
        error: null,
      }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.recordExternalPayment({
      jobId: 'job-1',
      workerId: 'worker-1',
      applicationId: 'app-1',
      source: 'cash',
      amount: 100,
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/concluído/)
  })

  it('registra com sucesso mesmo quando application.status ainda não é "completed" (só depende do sinal real de conclusão)', async () => {
    routeFrom({
      applications: makeChain({
        data: { ...APPLICATION_COMPLETED, status: 'in_progress' },
        error: null,
      }),
      companies: makeChain({ data: COMPANY_ROW, error: null }),
      shift_payments: makeChain({ data: SHIFT_PAYMENT_ROW, error: null }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.recordExternalPayment({
      jobId: 'job-1',
      workerId: 'worker-1',
      applicationId: 'app-1',
      source: 'cash',
      amount: 100,
    })

    expect(result.success).toBe(true)
  })

  it('rejeita quando a application não corresponde ao job/worker informados', async () => {
    routeFrom({
      applications: makeChain({
        data: { ...APPLICATION_COMPLETED, worker_id: 'worker-OUTRO' },
        error: null,
      }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.recordExternalPayment({
      jobId: 'job-1',
      workerId: 'worker-1',
      applicationId: 'app-1',
      source: 'cash',
      amount: 100,
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/não corresponde/)
  })

  it('rejeita quando a application não existe', async () => {
    routeFrom({
      applications: makeChain({ data: null, error: null }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.recordExternalPayment({
      jobId: 'job-1',
      workerId: 'worker-1',
      applicationId: 'app-inexistente',
      source: 'cash',
      amount: 100,
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/não encontrad/)
  })

  it('registra com sucesso quando o turno está concluído', async () => {
    routeFrom({
      applications: makeChain({ data: APPLICATION_COMPLETED, error: null }),
      companies: makeChain({ data: COMPANY_ROW, error: null }),
      shift_payments: makeChain({ data: SHIFT_PAYMENT_ROW, error: null }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.recordExternalPayment({
      jobId: 'job-1',
      workerId: 'worker-1',
      applicationId: 'app-1',
      source: 'external_pix',
      amount: 150,
      note: 'Pago via PIX',
    })

    expect(result.success).toBe(true)
    expect(result.payment).toEqual(SHIFT_PAYMENT_ROW)
    expect(mockFrom).toHaveBeenCalledWith('shift_payments')
    expect(mockFrom).toHaveBeenCalledWith('applications')
    // `companies` saiu: a empresa da sessao vem do seam (getAuthenticatedCompanyId), unico
    // ponto que conhece dono direto, dono via owner_id E gerente de unidade.
    expect(mockFrom).not.toHaveBeenCalledWith('companies')
  })

  it('trata violação do UNIQUE parcial (23505) como alreadyRecorded, sem crashar', async () => {
    routeFrom({
      applications: makeChain({ data: APPLICATION_COMPLETED, error: null }),
      companies: makeChain({ data: COMPANY_ROW, error: null }),
      shift_payments: makeChain({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.recordExternalPayment({
      jobId: 'job-1',
      workerId: 'worker-1',
      applicationId: 'app-1',
      source: 'cash',
      amount: 100,
    })

    expect(result.success).toBe(false)
    expect(result.alreadyRecorded).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('retorna erro genérico em falha de INSERT não relacionada a duplicidade', async () => {
    routeFrom({
      applications: makeChain({ data: APPLICATION_COMPLETED, error: null }),
      companies: makeChain({ data: COMPANY_ROW, error: null }),
      shift_payments: makeChain({
        data: null,
        error: { code: '42501', message: 'permission denied' },
      }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.recordExternalPayment({
      jobId: 'job-1',
      workerId: 'worker-1',
      applicationId: 'app-1',
      source: 'cash',
      amount: 100,
    })

    expect(result.success).toBe(false)
    expect(result.alreadyRecorded).toBeUndefined()
    expect(result.error).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// scheduleExternalPayment (ADR-20260712 — pagamento agendado)
// ---------------------------------------------------------------------------

describe('PaymentRecordService.scheduleExternalPayment', () => {
  it('rejeita amount <= 0 sem chamar o supabase', async () => {
    const { PaymentRecordService } = await import('./paymentRecordService')

    const result = await PaymentRecordService.scheduleExternalPayment({
      jobId: 'job-1',
      workerId: 'worker-1',
      applicationId: 'app-1',
      source: 'cash',
      amount: 0,
      scheduledFor: '2026-07-20',
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/maior que zero/)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejeita scheduledFor vazio sem chamar o supabase', async () => {
    const { PaymentRecordService } = await import('./paymentRecordService')

    const result = await PaymentRecordService.scheduleExternalPayment({
      jobId: 'job-1',
      workerId: 'worker-1',
      applicationId: 'app-1',
      source: 'cash',
      amount: 100,
      scheduledFor: '',
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/data prevista/)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejeita quando o turno (application) não está concluído', async () => {
    routeFrom({
      applications: makeChain({
        data: { ...APPLICATION_COMPLETED, company_checkout_confirmed_at: null },
        error: null,
      }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.scheduleExternalPayment({
      jobId: 'job-1',
      workerId: 'worker-1',
      applicationId: 'app-1',
      source: 'cash',
      amount: 100,
      scheduledFor: '2026-07-20',
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/concluído/)
  })

  it('agenda com sucesso quando o turno está concluído — status scheduled, sem paid_at', async () => {
    routeFrom({
      applications: makeChain({ data: APPLICATION_COMPLETED, error: null }),
      companies: makeChain({ data: COMPANY_ROW, error: null }),
      shift_payments: makeChain({ data: SCHEDULED_PAYMENT_ROW, error: null }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.scheduleExternalPayment({
      jobId: 'job-1',
      workerId: 'worker-1',
      applicationId: 'app-1',
      source: 'external_pix',
      amount: 150,
      scheduledFor: '2026-07-20',
    })

    expect(result.success).toBe(true)
    expect(result.payment?.status).toBe('scheduled')
    expect(result.payment?.paid_at).toBeNull()
    expect(mockFrom).toHaveBeenCalledWith('shift_payments')
  })

  it('trata violação do UNIQUE parcial (23505) como alreadyActive, sem crashar', async () => {
    routeFrom({
      applications: makeChain({ data: APPLICATION_COMPLETED, error: null }),
      companies: makeChain({ data: COMPANY_ROW, error: null }),
      shift_payments: makeChain({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.scheduleExternalPayment({
      jobId: 'job-1',
      workerId: 'worker-1',
      applicationId: 'app-1',
      source: 'cash',
      amount: 100,
      scheduledFor: '2026-07-20',
    })

    expect(result.success).toBe(false)
    expect(result.alreadyActive).toBe(true)
    expect(result.error).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// effectivateScheduledPayment (scheduled → recorded)
// ---------------------------------------------------------------------------

describe('PaymentRecordService.effectivateScheduledPayment', () => {
  it('efetiva com sucesso — status recorded, paid_at preenchido', async () => {
    routeFrom({
      shift_payments: makeChain({
        data: { ...SCHEDULED_PAYMENT_ROW, status: 'recorded', paid_at: '2026-07-20T00:00:00Z' },
        error: null,
      }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.effectivateScheduledPayment('sp-2')

    expect(result.success).toBe(true)
    expect(result.payment?.status).toBe('recorded')
    expect(result.payment?.paid_at).toBeTruthy()
    expect(mockFrom).toHaveBeenCalledWith('shift_payments')
  })

  it('retorna erro quando o UPDATE falha (ex.: trigger de imutabilidade/transição inválida)', async () => {
    routeFrom({
      shift_payments: makeChain({
        data: null,
        error: { message: 'shift_payments: transicao de status invalida' },
      }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.effectivateScheduledPayment('sp-2')

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// getPaymentByJob
// ---------------------------------------------------------------------------

describe('PaymentRecordService.getPaymentByJob', () => {
  it('retorna o registro recorded do (turno, freela) e filtra por worker_id', async () => {
    const chain = makeChain({ data: SHIFT_PAYMENT_ROW, error: null })
    routeFrom({ shift_payments: chain })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.getPaymentByJob('job-1', 'worker-1')

    expect(result).toEqual(SHIFT_PAYMENT_ROW)
    expect(mockFrom).toHaveBeenCalledWith('shift_payments')
    expect(chain.eq).toHaveBeenCalledWith('worker_id', 'worker-1')
  })

  it('retorna o registro scheduled (promessa) do turno — o comprovante de agendamento também deve aparecer', async () => {
    routeFrom({ shift_payments: makeChain({ data: SCHEDULED_PAYMENT_ROW, error: null }) })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.getPaymentByJob('job-1', 'worker-1')

    expect(result).toEqual(SCHEDULED_PAYMENT_ROW)
    expect(result?.status).toBe('scheduled')
  })

  it('retorna null quando não há registro', async () => {
    routeFrom({ shift_payments: makeChain({ data: null, error: null }) })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.getPaymentByJob('job-sem-registro', 'worker-1')

    expect(result).toBeNull()
  })

  it('retorna null em erro de query (não propaga exceção)', async () => {
    routeFrom({
      shift_payments: makeChain({ data: null, error: { message: 'db error' } }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.getPaymentByJob('job-1', 'worker-1')

    expect(result).toBeNull()
  })

  it('retorna null sem chamar o supabase quando workerId é vazio (evita ambiguidade)', async () => {
    const { PaymentRecordService } = await import('./paymentRecordService')

    const result = await PaymentRecordService.getPaymentByJob('job-1', '')

    expect(result).toBeNull()
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// listActivePaymentsByJob (ADR-20260816 — marcador por (job_id, worker_id))
// ---------------------------------------------------------------------------

describe('PaymentRecordService.listActivePaymentsByJob', () => {
  it('retorna [] sem chamar o supabase quando jobId é vazio', async () => {
    const { PaymentRecordService } = await import('./paymentRecordService')

    const result = await PaymentRecordService.listActivePaymentsByJob('')

    expect(result).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('retorna [] quando não há nenhum marcador ativo', async () => {
    routeFrom({ shift_payments: makeChain({ data: [], error: null }) })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.listActivePaymentsByJob('job-1')

    expect(result).toEqual([])
  })

  it('retorna 1 marcador quando o turno tem 1 freela (compatível com o banco ATUAL)', async () => {
    routeFrom({ shift_payments: makeChain({ data: [SHIFT_PAYMENT_ROW], error: null }) })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.listActivePaymentsByJob('job-1')

    expect(result).toHaveLength(1)
    expect(result[0].worker_id).toBe('worker-1')
  })

  // Caso central do ADR: turno com DOIS freelas, cada um com seu próprio marcador ativo.
  // O banco atual não permite isso ainda (UNIQUE por job_id) — este teste é de unidade com
  // mock e continua válido depois da migration 20260816220000 (UNIQUE por (job_id, worker_id)).
  it('retorna os marcadores de DOIS freelas do mesmo turno, um por worker_id', async () => {
    const paymentWorkerB: ShiftPayment = {
      ...SHIFT_PAYMENT_ROW,
      id: 'sp-worker-b',
      worker_id: 'worker-2',
      application_id: 'app-2',
      amount: 200,
    }
    routeFrom({
      shift_payments: makeChain({ data: [SHIFT_PAYMENT_ROW, paymentWorkerB], error: null }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.listActivePaymentsByJob('job-1')

    expect(result).toHaveLength(2)
    const byWorker = Object.fromEntries(result.map((p) => [p.worker_id, p]))
    expect(byWorker['worker-1'].id).toBe('sp-1')
    expect(byWorker['worker-2'].id).toBe('sp-worker-b')
    // Cada marcador aponta para a application do PRÓPRIO freela — nunca cruza.
    expect(byWorker['worker-1'].application_id).toBe('app-1')
    expect(byWorker['worker-2'].application_id).toBe('app-2')
  })

  it('retorna [] em erro de query (não propaga exceção)', async () => {
    routeFrom({
      shift_payments: makeChain({ data: null, error: { message: 'db error' } }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.listActivePaymentsByJob('job-1')

    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getReceipt
// ---------------------------------------------------------------------------

describe('PaymentRecordService.getReceipt', () => {
  const JOINED_WORKER_1 = {
    ...SHIFT_PAYMENT_ROW,
    job: { id: 'job-1', title: 'Garçom', location: 'SP', start_date: '2026-06-29' },
    company: { id: 'company-1', name: 'Empresa X', logo_url: null },
    worker: { id: 'worker-1', full_name: 'Fulano', avatar_url: null, photo_url: null },
  }

  const JOINED_WORKER_2 = {
    ...SHIFT_PAYMENT_ROW,
    id: 'sp-worker-b',
    worker_id: 'worker-2',
    application_id: 'app-2',
    job: { id: 'job-1', title: 'Garçom', location: 'SP', start_date: '2026-06-29' },
    company: { id: 'company-1', name: 'Empresa X', logo_url: null },
    worker: { id: 'worker-2', full_name: 'Beltrana', avatar_url: null, photo_url: null },
  }

  it('com workerId explícito (?worker=): filtra por worker_id e retorna payment + job + company + worker', async () => {
    const chain = makeChain({ data: JOINED_WORKER_1, error: null })
    routeFrom({ shift_payments: chain })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.getReceipt('job-1', 'worker-1')

    expect(result).not.toBeNull()
    expect(result?.job?.title).toBe('Garçom')
    expect(result?.company?.name).toBe('Empresa X')
    expect(result?.worker?.full_name).toBe('Fulano')
    expect(result?.payment.id).toBe('sp-1')
    expect(chain.eq).toHaveBeenCalledWith('worker_id', 'worker-1')
    // Não chama getUser — o parâmetro explícito já resolve o espectador.
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('workerId alheio (RLS não devolve a linha): retorna null, nunca vaza o recibo de outro freela', async () => {
    // A RLS já filtrou no servidor — o mock simula "nenhuma linha casa" (não é este client
    // que decide isolar; é o retorno vazio que o `getReceipt` deve honrar sem tentar de outro jeito).
    routeFrom({ shift_payments: makeChain({ data: null, error: null }) })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.getReceipt('job-1', 'worker-DE-OUTRO-FREELA')

    expect(result).toBeNull()
  })

  it('sem workerId, espectador é o próprio freela (worker_id = auth.uid()): resolve para o marcador dele', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'worker-1' } } })
    const chain = makeChain({ data: JOINED_WORKER_1, error: null })
    routeFrom({ shift_payments: chain })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.getReceipt('job-1')

    expect(result?.payment.id).toBe('sp-1')
    expect(result?.worker?.full_name).toBe('Fulano')
    expect(chain.eq).toHaveBeenCalledWith('worker_id', 'worker-1')
  })

  it('sem workerId, espectador é a empresa (link antigo): cai para o marcador ativo mais antigo', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'company-owner-1' } } })
    let call = 0
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'shift_payments') throw new Error(`Tabela não mockada: ${table}`)
      call += 1
      // 1ª chamada: tenta como o próprio freela (worker_id = auth.uid()) — não acha nada,
      // porque quem está logado é a empresa. 2ª chamada: fallback determinístico.
      if (call === 1) return makeChain({ data: null, error: null })
      return makeChain({ data: [JOINED_WORKER_1, JOINED_WORKER_2], error: null })
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.getReceipt('job-1')

    // Mais antigo primeiro (ordenado por created_at ascending no fallback) = worker-1.
    expect(result?.payment.id).toBe('sp-1')
    expect(result?.worker?.full_name).toBe('Fulano')
  })

  it('retorna null quando não há registro (RLS ou inexistente)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'company-owner-1' } } })
    routeFrom({ shift_payments: makeChain({ data: null, error: null }) })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.getReceipt('job-x')

    expect(result).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Caso central do ADR: turno com DOIS freelas, cada um com seu próprio recibo.
  // O card do freela B nunca deve exibir o recibo do freela A, e vice-versa.
  // -------------------------------------------------------------------------
  it('turno com dois freelas: cada worker_id resolve para o SEU próprio recibo, nunca o do outro', async () => {
    const { PaymentRecordService } = await import('./paymentRecordService')

    // Worker A
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'shift_payments') throw new Error(`Tabela não mockada: ${table}`)
      return makeChain({ data: JOINED_WORKER_1, error: null })
    })
    const resultA = await PaymentRecordService.getReceipt('job-1', 'worker-1')
    expect(resultA?.worker?.full_name).toBe('Fulano')

    // Worker B — troca o mock para simular a RLS devolvendo a linha DELE, não a de A.
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'shift_payments') throw new Error(`Tabela não mockada: ${table}`)
      return makeChain({ data: JOINED_WORKER_2, error: null })
    })
    const resultB = await PaymentRecordService.getReceipt('job-1', 'worker-2')
    expect(resultB?.worker?.full_name).toBe('Beltrana')
    expect(resultB?.payment.id).not.toBe(resultA?.payment.id)
  })
})

// ---------------------------------------------------------------------------
// listForWorker (Meus Recebimentos)
// ---------------------------------------------------------------------------

describe('PaymentRecordService.listForWorker', () => {
  it('retorna [] sem chamar o supabase quando workerId é vazio', async () => {
    const { PaymentRecordService } = await import('./paymentRecordService')

    const result = await PaymentRecordService.listForWorker('')

    expect(result).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('lista os marcadores do worker com job/company embutidos', async () => {
    const joinedRecorded = {
      ...SHIFT_PAYMENT_ROW,
      job: { id: 'job-1', title: 'Garçom', location: 'SP', start_date: '2026-06-29' },
      company: { id: 'company-1', name: 'Empresa X', logo_url: null },
    }
    const joinedScheduled = {
      ...SCHEDULED_PAYMENT_ROW,
      job: { id: 'job-2', title: 'Barman', location: 'RJ', start_date: '2026-07-19' },
      company: { id: 'company-1', name: 'Empresa X', logo_url: null },
    }
    routeFrom({
      shift_payments: makeChain({ data: [joinedRecorded, joinedScheduled], error: null }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.listForWorker('worker-1')

    expect(result).toHaveLength(2)
    expect(result[0].payment.id).toBe('sp-1')
    expect(result[0].job?.title).toBe('Garçom')
    expect(result[0].company?.name).toBe('Empresa X')
    expect(result[1].payment.status).toBe('scheduled')
    expect(mockFrom).toHaveBeenCalledWith('shift_payments')
  })

  it('retorna [] em erro de query (não propaga exceção)', async () => {
    routeFrom({
      shift_payments: makeChain({ data: null, error: { message: 'db error' } }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.listForWorker('worker-1')

    expect(result).toEqual([])
  })

  it('retorna [] quando não há nenhum marcador (data null)', async () => {
    routeFrom({
      shift_payments: makeChain({ data: null, error: null }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.listForWorker('worker-1')

    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// confirmReceiptByWorker
// ---------------------------------------------------------------------------

describe('PaymentRecordService.confirmReceiptByWorker', () => {
  it('confirma com sucesso (worker_confirmed_at) — UPDATE afetou 1 linha', async () => {
    routeFrom({ shift_payments: makeChain({ data: [{ id: 'sp-1' }], error: null }) })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.confirmReceiptByWorker('sp-1')

    expect(result.success).toBe(true)
    expect(mockFrom).toHaveBeenCalledWith('shift_payments')
  })

  it('retorna erro quando o UPDATE falha (ex.: trigger de imutabilidade)', async () => {
    routeFrom({
      shift_payments: makeChain({
        data: null,
        error: { message: 'worker_confirmed_at nao pode ser alterado apos a confirmacao' },
      }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.confirmReceiptByWorker('sp-1')

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  // Classe "sucesso falso" (patterns.md — DELETE/UPDATE sob RLS negado silenciosamente):
  // 0 linhas afetadas, SEM erro Postgres, nunca pode ser reportado como sucesso.
  it('UPDATE negado pela RLS (0 linhas, sem erro): retorna success=false, nunca true', async () => {
    routeFrom({ shift_payments: makeChain({ data: [], error: null }) })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.confirmReceiptByWorker('sp-de-outro-freela')

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// voidPayment
// ---------------------------------------------------------------------------

describe('PaymentRecordService.voidPayment', () => {
  it('estorna com sucesso (status=voided) — UPDATE afetou 1 linha', async () => {
    routeFrom({ shift_payments: makeChain({ data: [{ id: 'sp-1' }], error: null }) })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.voidPayment('sp-1', 'Valor informado errado')

    expect(result.success).toBe(true)
  })

  it('retorna erro quando o UPDATE falha', async () => {
    routeFrom({
      shift_payments: makeChain({ data: null, error: { message: 'permission denied' } }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.voidPayment('sp-1', 'motivo')

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  // Classe "sucesso falso": estorno negado em silêncio (0 linhas, sem erro) mostraria
  // "estornado" com o marcador ainda ATIVO — e "Dispensar" ficaria travado sem explicação.
  it('UPDATE negado pela RLS (0 linhas, sem erro): retorna success=false, nunca true', async () => {
    routeFrom({ shift_payments: makeChain({ data: [], error: null }) })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.voidPayment('sp-de-outra-empresa', 'motivo')

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
