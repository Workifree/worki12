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
    expect(mockFrom).toHaveBeenCalledWith('companies')
    expect(mockFrom).toHaveBeenCalledWith('applications')
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
  it('retorna o registro recorded do turno', async () => {
    routeFrom({ shift_payments: makeChain({ data: SHIFT_PAYMENT_ROW, error: null }) })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.getPaymentByJob('job-1')

    expect(result).toEqual(SHIFT_PAYMENT_ROW)
    expect(mockFrom).toHaveBeenCalledWith('shift_payments')
  })

  it('retorna o registro scheduled (promessa) do turno — o comprovante de agendamento também deve aparecer', async () => {
    routeFrom({ shift_payments: makeChain({ data: SCHEDULED_PAYMENT_ROW, error: null }) })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.getPaymentByJob('job-1')

    expect(result).toEqual(SCHEDULED_PAYMENT_ROW)
    expect(result?.status).toBe('scheduled')
  })

  it('retorna null quando não há registro', async () => {
    routeFrom({ shift_payments: makeChain({ data: null, error: null }) })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.getPaymentByJob('job-sem-registro')

    expect(result).toBeNull()
  })

  it('retorna null em erro de query (não propaga exceção)', async () => {
    routeFrom({
      shift_payments: makeChain({ data: null, error: { message: 'db error' } }),
    })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.getPaymentByJob('job-1')

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getReceipt
// ---------------------------------------------------------------------------

describe('PaymentRecordService.getReceipt', () => {
  it('retorna payment + job + company + worker a partir do join', async () => {
    const joined = {
      ...SHIFT_PAYMENT_ROW,
      job: { id: 'job-1', title: 'Garçom', location: 'SP', start_date: '2026-06-29' },
      company: { id: 'company-1', name: 'Empresa X', logo_url: null },
      worker: { id: 'worker-1', full_name: 'Fulano', avatar_url: null, photo_url: null },
    }
    routeFrom({ shift_payments: makeChain({ data: joined, error: null }) })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.getReceipt('job-1')

    expect(result).not.toBeNull()
    expect(result?.job?.title).toBe('Garçom')
    expect(result?.company?.name).toBe('Empresa X')
    expect(result?.worker?.full_name).toBe('Fulano')
    expect(result?.payment.id).toBe('sp-1')
  })

  it('retorna null quando não há registro (RLS ou inexistente)', async () => {
    routeFrom({ shift_payments: makeChain({ data: null, error: null }) })

    const { PaymentRecordService } = await import('./paymentRecordService')
    const result = await PaymentRecordService.getReceipt('job-x')

    expect(result).toBeNull()
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
  it('confirma com sucesso (worker_confirmed_at)', async () => {
    routeFrom({ shift_payments: makeChain({ data: null, error: null }) })

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
})

// ---------------------------------------------------------------------------
// voidPayment
// ---------------------------------------------------------------------------

describe('PaymentRecordService.voidPayment', () => {
  it('estorna com sucesso (status=voided)', async () => {
    routeFrom({ shift_payments: makeChain({ data: null, error: null }) })

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
})
