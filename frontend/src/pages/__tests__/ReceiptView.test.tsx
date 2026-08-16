import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ReceiptView from '../ReceiptView'
import { PaymentRecordService } from '../../services/paymentRecordService'
import type { ShiftPaymentReceipt } from '../../services/paymentRecordService'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
}))

vi.mock('../../services/paymentRecordService', () => ({
  PaymentRecordService: {
    getReceipt: vi.fn(),
    confirmReceiptByWorker: vi.fn(),
  },
}))

vi.mock('../../contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ addToast: vi.fn(), removeToast: vi.fn() })),
}))

vi.mock('../../lib/logger', () => ({ logError: vi.fn() }))

vi.mock('../../components/PageMeta', () => ({ default: () => null }))

import { supabase } from '../../lib/supabase'

function buildChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
  return { ...chain, ...overrides }
}

function baseReceipt(overrides: Partial<ShiftPaymentReceipt['payment']> = {}): ShiftPaymentReceipt {
  return {
    payment: {
      id: 'pay-1',
      job_id: 'job-1',
      company_id: 'company-1',
      worker_id: 'worker-1',
      application_id: 'app-1',
      source: 'external_pix',
      amount: 150,
      scheduled_for: null,
      paid_at: '2026-03-05T20:00:00Z',
      recorded_by: 'company-1',
      worker_confirmed_at: null,
      note: null,
      status: 'recorded',
      voided_at: null,
      void_reason: null,
      created_at: '2026-03-05T20:00:00Z',
      ...overrides,
    },
    job: {
      id: 'job-1',
      title: 'Garçom para evento',
      location: 'São Paulo',
      start_date: '2026-03-05',
      work_start_time: '18:00',
      work_end_time: '02:00',
    },
    company: { id: 'company-1', name: 'Bar do Zé', logo_url: null },
    worker: { id: 'worker-1', full_name: 'João Silva', avatar_url: null },
  }
}

function renderComponent(jobId = 'job-1') {
  return render(
    <MemoryRouter initialEntries={[`/recibo/${jobId}`]}>
      <Routes>
        <Route path="/recibo/:jobId" element={<ReceiptView />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: 'worker-1' } },
    error: null,
  } as Awaited<ReturnType<typeof supabase.auth.getUser>>)
})

describe('ReceiptView - Horas trabalhadas', () => {
  it('calcula corretamente um turno que cruza a meia-noite (18h10 -> 01h00)', async () => {
    vi.mocked(PaymentRecordService.getReceipt).mockResolvedValue(baseReceipt())

    const applicationsChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          worker_checkin_at: '2026-03-05T18:10:00-03:00',
          worker_checkout_at: '2026-03-06T01:00:00-03:00',
        },
        error: null,
      }),
    })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'applications') return applicationsChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('18:10')).toBeInTheDocument()
    })
    expect(screen.getByText('01:00')).toBeInTheDocument()
    // 18h10 -> 01h00 (dia seguinte) = 6h50 trabalhadas
    expect(screen.getByText('6h50')).toBeInTheDocument()
  })

  it('calcula corretamente um turno dentro do mesmo dia (08h00 -> 16h30)', async () => {
    vi.mocked(PaymentRecordService.getReceipt).mockResolvedValue(baseReceipt())

    const applicationsChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          worker_checkin_at: '2026-03-05T08:00:00-03:00',
          worker_checkout_at: '2026-03-05T16:30:00-03:00',
        },
        error: null,
      }),
    })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'applications') return applicationsChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('8h30')).toBeInTheDocument()
    })
  })

  it('não inventa horário: mostra "Não registrado" quando os timestamps não existem', async () => {
    vi.mocked(PaymentRecordService.getReceipt).mockResolvedValue(baseReceipt())

    const applicationsChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({
        data: { worker_checkin_at: null, worker_checkout_at: null },
        error: null,
      }),
    })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'applications') return applicationsChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Garçom para evento')).toBeInTheDocument()
    })
    // Sem checkin nem checkout — o bloco inteiro de chegada/saída/total é omitido.
    expect(screen.queryByText('Chegada')).not.toBeInTheDocument()
  })

  it('marca "Não registrado" quando só a chegada existe (sem checkout ainda)', async () => {
    vi.mocked(PaymentRecordService.getReceipt).mockResolvedValue(baseReceipt())

    const applicationsChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({
        data: { worker_checkin_at: '2026-03-05T18:10:00-03:00', worker_checkout_at: null },
        error: null,
      }),
    })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'applications') return applicationsChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('18:10')).toBeInTheDocument()
    })
    // Saída e Total não têm dado real — "Não registrado" em vez de inventar zero.
    expect(screen.getAllByText('Não registrado').length).toBeGreaterThanOrEqual(2)
  })
})
