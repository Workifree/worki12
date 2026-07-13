import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import CompanyJobCandidates from './CompanyJobCandidates'

// Mock WalletService — must not reference outer variables in factory
vi.mock('../../services/walletService', () => ({
  WalletService: {
    releaseOrCaptureEscrow: vi.fn().mockResolvedValue({ success: true }),
    getOrCreateWallet: vi.fn().mockResolvedValue({ balance: 1000 }),
  },
}))

// Mock supabase — factory with only inline vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(),
  },
}))

// Mock ToastContext
vi.mock('../../contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ addToast: vi.fn(), removeToast: vi.fn() })),
}))

// Mock useNavigate
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: vi.fn(() => vi.fn()),
  }
})

// Import mocked modules for assertions
import { supabase } from '../../lib/supabase'
import { WalletService } from '../../services/walletService'
import { useToast } from '../../contexts/ToastContext'
import { useNavigate } from 'react-router-dom'

function buildChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
  return { ...chain, ...overrides }
}

const JOB_DATA = { title: 'Garcom para Evento' }

// Application with in_progress status and all checkins confirmed — for delivery modal tests
const APP_IN_PROGRESS = [
  {
    id: 'app-1',
    job_id: 'job-123',
    worker_id: 'worker-1',
    status: 'in_progress',
    cover_letter: 'Olá, quero trabalhar.',
    created_at: new Date().toISOString(),
    worker: {
      id: 'worker-1',
      full_name: 'João Silva',
      avatar_url: null,
      city: 'São Paulo',
      level: 2,
      rating_average: 4.8,
      reviews_count: 10,
      tags: [],
    },
    worker_checkin_at: new Date().toISOString(),
    worker_checkout_at: new Date().toISOString(),
    company_checkin_confirmed_at: new Date().toISOString(),
    company_checkout_confirmed_at: new Date().toISOString(),
  },
]


function setupMocksWithApps(apps: unknown[]) {
  const mockAddToast = vi.fn()
  const mockRemoveToast = vi.fn()
  vi.mocked(useToast).mockReturnValue({ addToast: mockAddToast, removeToast: mockRemoveToast })
  vi.mocked(useNavigate).mockReturnValue(vi.fn())

  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: 'company-user-1' } },
    error: null,
  } as Awaited<ReturnType<typeof supabase.auth.getUser>>)

  vi.mocked(WalletService.getOrCreateWallet).mockResolvedValue({
    id: 'wallet-1', balance: 500, user_id: 'company-user-1', user_type: 'company', created_at: '', updated_at: ''
  })

  const jobChain = buildChain({
    single: vi.fn().mockResolvedValue({ data: JOB_DATA, error: null }),
  })

  const appChain = buildChain({
    order: vi.fn().mockResolvedValue({ data: apps, error: null }),
    update: vi.fn().mockReturnValue(buildChain({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  })

  // Por padrão, simula um turno com escrow prepago reservado (fluxo pull legado) —
  // é o que faz renderCompletionAction() mostrar "Confirmar Entrega" em vez de cair
  // no branch modo A ("Registrar Pagamento"). Testes específicos de modo A sobrescrevem.
  // Nota: o fetch real é `.select(...).eq('job_id', id)` sem `.order()` — o mock
  // precisa resolver direto no `eq()`, não em `order()`.
  const escrowChain = buildChain({
    eq: vi.fn().mockResolvedValue({
      data: [{ application_id: 'app-1', status: 'reserved', kind: 'prepaid' }],
      error: null,
    }),
  })

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === 'jobs') return jobChain as unknown as ReturnType<typeof supabase.from>
    if (table === 'applications') return appChain as unknown as ReturnType<typeof supabase.from>
    if (table === 'escrow_transactions') return escrowChain as unknown as ReturnType<typeof supabase.from>
    return buildChain() as unknown as ReturnType<typeof supabase.from>
  })

  return { mockAddToast, appChain }
}

function renderComponent() {
  return render(
    <MemoryRouter initialEntries={['/company/jobs/job-123/candidates']}>
      <Routes>
        <Route path="/company/jobs/:id/candidates" element={<CompanyJobCandidates />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CompanyJobCandidates — renderiza candidatos com status in_progress', () => {
  it('exibe candidato com status Em Andamento', async () => {
    setupMocksWithApps(APP_IN_PROGRESS)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('João Silva')).toBeInTheDocument()
    })

    expect(screen.getByText('Em Andamento')).toBeInTheDocument()
  })
})

describe('CompanyJobCandidates — modal de confirmação de entrega', () => {
  it('modal de confirmação abre ao clicar botão Confirmar Entrega', async () => {
    setupMocksWithApps(APP_IN_PROGRESS)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('João Silva')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Confirmar Entrega'))

    expect(screen.getByRole('heading', { name: /Confirmar Entrega/i })).toBeInTheDocument()
    expect(screen.getByText(/O pagamento será liberado imediatamente ao profissional/)).toBeInTheDocument()
  })

  it('modal fecha ao clicar Cancelar sem chamar releaseEscrow', async () => {
    setupMocksWithApps(APP_IN_PROGRESS)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('João Silva')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Confirmar Entrega'))

    expect(screen.getByText(/O pagamento será liberado imediatamente ao profissional/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Cancelar'))

    await waitFor(() => {
      expect(screen.queryByText(/O pagamento será liberado imediatamente ao profissional/)).not.toBeInTheDocument()
    })

    expect(WalletService.releaseOrCaptureEscrow).not.toHaveBeenCalled()
  })

  it('toast de sucesso aparece após releaseOrCaptureEscrow retornar sucesso', async () => {
    const { mockAddToast } = setupMocksWithApps(APP_IN_PROGRESS)
    vi.mocked(WalletService.releaseOrCaptureEscrow).mockResolvedValueOnce({ success: true })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('João Silva')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Confirmar Entrega'))

    await waitFor(() => {
      expect(screen.getByText(/O pagamento será liberado imediatamente ao profissional/)).toBeInTheDocument()
    })

    // Get "Confirmar" button inside modal (not the list button)
    const buttons = screen.getAllByRole('button')
    const confirmarModal = buttons.find(b => b.textContent?.trim() === 'Confirmar')
    expect(confirmarModal).toBeDefined()
    fireEvent.click(confirmarModal!)

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Entrega confirmada! Pagamento liberado ao profissional.',
        'success'
      )
    })
  })

  it('toast de erro aparece quando releaseOrCaptureEscrow retorna success=false', async () => {
    const { mockAddToast } = setupMocksWithApps(APP_IN_PROGRESS)
    vi.mocked(WalletService.releaseOrCaptureEscrow).mockResolvedValueOnce({ success: false, error: 'Falha no pagamento' })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('João Silva')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Confirmar Entrega'))

    await waitFor(() => {
      expect(screen.getByText(/O pagamento será liberado imediatamente ao profissional/)).toBeInTheDocument()
    })

    const buttons = screen.getAllByRole('button')
    const confirmarModal = buttons.find(b => b.textContent?.trim() === 'Confirmar')
    expect(confirmarModal).toBeDefined()
    fireEvent.click(confirmarModal!)

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Erro ao liberar pagamento. Tente novamente.',
        'error'
      )
    })
  })
})

describe('CompanyJobCandidates — modal de avaliação (review)', () => {
  it('handleSubmitReview exibe toast de review duplicado quando error.code === 23505', async () => {
    const mockAddToast = vi.fn()
    const mockRemoveToast = vi.fn()
    vi.mocked(useToast).mockReturnValue({ addToast: mockAddToast, removeToast: mockRemoveToast })
    vi.mocked(useNavigate).mockReturnValue(vi.fn())

    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'company-user-1' } },
      error: null,
    } as Awaited<ReturnType<typeof supabase.auth.getUser>>)

    // App with completed status — "Avaliar" button visible
    const appWithCheckins = [{
      id: 'app-3',
      job_id: 'job-123',
      worker_id: 'worker-3',
      status: 'completed',
      cover_letter: 'Pronto para trabalhar.',
      created_at: new Date().toISOString(),
      worker: {
        id: 'worker-3',
        full_name: 'Pedro Santos',
        avatar_url: null,
        city: 'Belo Horizonte',
        level: 1,
        rating_average: 0,
        reviews_count: 0,
        tags: [],
      },
      worker_checkin_at: new Date().toISOString(),
      worker_checkout_at: new Date().toISOString(),
      company_checkin_confirmed_at: new Date().toISOString(),
      company_checkout_confirmed_at: new Date().toISOString(),
    }]

    const jobChain = buildChain({
      single: vi.fn().mockResolvedValue({ data: JOB_DATA, error: null }),
    })
    const appChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: appWithCheckins, error: null }),
      update: vi.fn().mockReturnValue(buildChain({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    })
    const reviewsChain = buildChain({
      insert: vi.fn().mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      }),
    })
    const escrowChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    vi.mocked(WalletService.releaseOrCaptureEscrow).mockResolvedValue({ success: true })
    vi.mocked(WalletService.getOrCreateWallet).mockResolvedValue({ id: 'w1', balance: 500, user_id: 'company-user-1', user_type: 'company', created_at: '', updated_at: '' })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'jobs') return jobChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'applications') return appChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'escrow_transactions') return escrowChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'reviews') return reviewsChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Pedro Santos')).toBeInTheDocument()
    })

    // Click "Avaliar" button — opens the rating modal
    fireEvent.click(screen.getByText('Avaliar'))

    // Rating modal should be open
    await waitFor(() => {
      expect(screen.getByText('Avaliar Freela')).toBeInTheDocument()
    })

    // Submit the review
    fireEvent.click(screen.getByText('Enviar Avaliação'))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Você já avaliou este freela para este turno.',
        'error'
      )
    })
  })
})
