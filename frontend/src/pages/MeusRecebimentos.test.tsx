import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MeusRecebimentos from './MeusRecebimentos'
import type { WorkerShiftPaymentListItem } from '../services/paymentRecordService'
import type { ShiftPayment } from '../types'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
  },
}))

vi.mock('../lib/logger', () => ({ logError: vi.fn() }))

const mockListForWorker = vi.fn()
vi.mock('../services/paymentRecordService', () => ({
  PaymentRecordService: {
    listForWorker: (...args: unknown[]) => mockListForWorker(...args),
  },
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

import { supabase } from '../lib/supabase'

function renderPage() {
  return render(
    <MemoryRouter>
      <MeusRecebimentos />
    </MemoryRouter>
  )
}

function makePayment(overrides: Partial<ShiftPayment> = {}): ShiftPayment {
  return {
    id: 'sp-1',
    job_id: 'job-1',
    company_id: 'company-1',
    worker_id: 'worker-1',
    application_id: 'app-1',
    source: 'external_pix',
    amount: 150,
    scheduled_for: null,
    paid_at: '2026-06-30T12:00:00Z',
    recorded_by: 'company-user-1',
    worker_confirmed_at: null,
    note: null,
    status: 'recorded',
    voided_at: null,
    void_reason: null,
    created_at: '2026-06-30T12:00:00Z',
    ...overrides,
  }
}

function makeItem(overrides: Partial<ShiftPayment> = {}, jobTitle = 'Garçom'): WorkerShiftPaymentListItem {
  return {
    payment: makePayment(overrides),
    job: { id: overrides.job_id ?? 'job-1', title: jobTitle, location: 'São Paulo', start_date: '2026-06-29' },
    company: { id: 'company-1', name: 'Empresa X', logo_url: null },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { user: { id: 'worker-1' } as any },
    error: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
})

describe('MeusRecebimentos', () => {
  it('redireciona para /login quando não há sessão', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { user: null } as any,
      error: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    mockListForWorker.mockResolvedValue([])

    renderPage()

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login'))
    expect(mockListForWorker).not.toHaveBeenCalled()
  })

  it('mostra empty state honesto quando não há nenhum recebimento', async () => {
    mockListForWorker.mockResolvedValue([])

    renderPage()

    await waitFor(() => expect(screen.getByText(/Nenhum recebimento ainda/i)).toBeInTheDocument())
    // Vocabulário: nunca "saldo"
    expect(screen.queryByText(/saldo/i)).not.toBeInTheDocument()
  })

  it('separa recorded pendente de confirmação em destaque, distinto de recorded já confirmado', async () => {
    mockListForWorker.mockResolvedValue([
      makeItem({ id: 'sp-pending', status: 'recorded', worker_confirmed_at: null }, 'Garçom'),
      makeItem({ id: 'sp-confirmed', status: 'recorded', worker_confirmed_at: '2026-07-01T10:00:00Z' }, 'Barman'),
    ])

    renderPage()

    await waitFor(() => expect(screen.getByText('Garçom')).toBeInTheDocument())
    expect(screen.getAllByText('Confirme o recebimento').length).toBeGreaterThan(0)
    expect(screen.getByText(/Aguardam confirmação/i)).toBeInTheDocument()
    expect(screen.getByText('Barman')).toBeInTheDocument()
  })

  it('mostra o valor agendado (scheduled) como promessa, não como recebido', async () => {
    mockListForWorker.mockResolvedValue([
      makeItem({ id: 'sp-scheduled', status: 'scheduled', scheduled_for: '2026-08-20', paid_at: null }, 'Cozinheiro'),
    ])

    renderPage()

    await waitFor(() => expect(screen.getByText('Cozinheiro')).toBeInTheDocument())
    expect(screen.getAllByText(/Promessa/i).length).toBeGreaterThan(0)
  })

  it('mostra itens cancelados (voided) de forma discreta, sem esconder, com o motivo', async () => {
    mockListForWorker.mockResolvedValue([
      makeItem({ id: 'sp-voided', status: 'voided', voided_at: '2026-07-05T00:00:00Z', void_reason: 'Valor errado' }, 'Estoquista'),
    ])

    renderPage()

    await waitFor(() => expect(screen.getByText('Estoquista')).toBeInTheDocument())
    expect(screen.getByText('Cancelados')).toBeInTheDocument()
    expect(screen.getByText(/Motivo: Valor errado/i)).toBeInTheDocument()
  })

  it('não navega ao clicar em um card cancelado (voided) — evita abrir o recibo errado', async () => {
    const user = userEvent.setup()
    mockListForWorker.mockResolvedValue([
      makeItem({ id: 'sp-voided', status: 'voided', voided_at: '2026-07-05T00:00:00Z', void_reason: 'Valor errado', job_id: 'job-voided' }, 'Estoquista'),
    ])

    renderPage()

    await waitFor(() => expect(screen.getByText('Estoquista')).toBeInTheDocument())

    // Card cancelado não é um "role=button" clicável (sem foco/teclado/click habilitados).
    expect(screen.queryByRole('button', { name: /Estoquista/i })).not.toBeInTheDocument()

    await user.click(screen.getByText('Estoquista'))
    expect(mockNavigate).not.toHaveBeenCalledWith('/recibo/job-voided')
  })

  it('navega para o recibo ao clicar em um card recorded (ativo)', async () => {
    const user = userEvent.setup()
    mockListForWorker.mockResolvedValue([
      makeItem({ id: 'sp-active', status: 'recorded', worker_confirmed_at: '2026-07-01T10:00:00Z', job_id: 'job-active' }, 'Garçom'),
    ])

    renderPage()

    await waitFor(() => expect(screen.getByText('Garçom')).toBeInTheDocument())
    await user.click(screen.getByText('Garçom'))
    expect(mockNavigate).toHaveBeenCalledWith('/recibo/job-active')
  })

  it('resume total recebido (só recorded) e total agendado sem usar a palavra "saldo"', async () => {
    mockListForWorker.mockResolvedValue([
      makeItem({ id: 'sp-1', status: 'recorded', amount: 100, worker_confirmed_at: '2026-07-01T10:00:00Z' }, 'Garçom'),
      makeItem({ id: 'sp-2', status: 'scheduled', amount: 50, scheduled_for: '2026-08-01', paid_at: null }, 'Barman'),
    ])

    renderPage()

    await waitFor(() => expect(screen.getByText(/Total recebido/i)).toBeInTheDocument())
    expect(screen.getAllByText('R$ 100,00').length).toBeGreaterThan(0)
    expect(screen.getByText(/Agendado \(promessa\)/i)).toBeInTheDocument()
    expect(screen.queryByText(/saldo/i)).not.toBeInTheDocument()
  })
})
