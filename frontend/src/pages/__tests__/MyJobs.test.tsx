import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MyJobs from '../MyJobs'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(),
  },
}))

vi.mock('../../contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ addToast: vi.fn(), removeToast: vi.fn() })),
}))

vi.mock('../../lib/logger', () => ({ logError: vi.fn() }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: vi.fn(() => vi.fn()),
  }
})

// Mock RateModal to simplify tests
vi.mock('../../components/RateModal', () => ({
  default: () => null,
}))

// Mock JobLifecycleStepper to simplify tests
vi.mock('../../components/JobLifecycleStepper', () => ({
  default: () => <div data-testid="lifecycle-stepper">Stepper</div>,
}))

// Mock PageMeta
vi.mock('../../components/PageMeta', () => ({
  default: () => null,
}))

import { supabase } from '../../lib/supabase'
import { useToast } from '../../contexts/ToastContext'
import { useNavigate } from 'react-router-dom'

interface ApplicationRow {
  id: string
  status: string
  created_at: string
  worker_checkin_at: string | null
  worker_checkout_at: string | null
  company_checkin_confirmed_at: string | null
  company_checkout_confirmed_at: string | null
  job: {
    id: string
    title: string
    budget: number
    start_date: string | null
    work_start_time: string | null
    work_end_time: string | null
    location: string | null
    company: {
      id: string
      name: string
      logo_url: string | null
    } | null
  } | null
}

const APP_IN_PROGRESS: ApplicationRow = {
  id: 'app-2',
  status: 'in_progress',
  created_at: '2026-03-15T08:00:00Z',
  worker_checkin_at: '2026-03-17T08:00:00Z',
  worker_checkout_at: null,
  company_checkin_confirmed_at: null,
  company_checkout_confirmed_at: null,
  job: {
    id: 'job-2',
    title: 'Barman para Festa',
    budget: 200,
    start_date: '2026-03-17',
    work_start_time: '08:00',
    work_end_time: '16:00',
    location: 'Rio de Janeiro',
    company: { id: 'company-2', name: 'Bar & Cia', logo_url: null },
  },
}

const APP_COMPLETED: ApplicationRow = {
  id: 'app-3',
  status: 'completed',
  created_at: '2026-03-01T10:00:00Z',
  worker_checkin_at: '2026-03-05T08:00:00Z',
  worker_checkout_at: '2026-03-05T16:00:00Z',
  company_checkin_confirmed_at: '2026-03-05T08:30:00Z',
  company_checkout_confirmed_at: '2026-03-05T16:30:00Z',
  job: {
    id: 'job-3',
    title: 'Cozinheiro para Evento',
    budget: 300,
    start_date: '2026-03-05',
    work_start_time: '08:00',
    work_end_time: '16:00',
    location: 'Belo Horizonte',
    company: { id: 'company-3', name: 'Restaurante Top', logo_url: null },
  },
}

function buildChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    in: vi.fn().mockReturnThis(),
  }
  return { ...chain, ...overrides }
}

function setupMocks(apps: ApplicationRow[] = []) {
  const mockAddToast = vi.fn()
  vi.mocked(useToast).mockReturnValue({ addToast: mockAddToast, removeToast: vi.fn() })
  vi.mocked(useNavigate).mockReturnValue(vi.fn())

  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: 'worker-1' } },
    error: null,
  } as Awaited<ReturnType<typeof supabase.auth.getUser>>)

  const reviewsChain = buildChain({
    eq: vi.fn().mockResolvedValue({ data: [], error: null }),
  })

  const appsChain = buildChain({
    order: vi.fn().mockResolvedValue({ data: apps, error: null }),
  })

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === 'reviews') return reviewsChain as unknown as ReturnType<typeof supabase.from>
    if (table === 'applications') return appsChain as unknown as ReturnType<typeof supabase.from>
    return buildChain() as unknown as ReturnType<typeof supabase.from>
  })

  return { mockAddToast }
}

function renderComponent() {
  return render(
    <MemoryRouter>
      <MyJobs />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MyJobs - Tabs de status', () => {
  it('renderiza todas as tabs de status (pivô: sem Candidaturas)', async () => {
    setupMocks([APP_IN_PROGRESS])
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Convites')).toBeInTheDocument()
    })

    expect(screen.getByText('Em Andamento')).toBeInTheDocument()
    expect(screen.getByText('Agendados')).toBeInTheDocument()
    expect(screen.getByText(/Histórico/)).toBeInTheDocument()
    // Aba "Candidaturas" foi removida no pivô push (invite-only).
    expect(screen.queryByText('Candidaturas')).not.toBeInTheDocument()
  })

  it('troca de tab ao clicar e mostra turnos corretos', async () => {
    setupMocks([APP_IN_PROGRESS, APP_COMPLETED])
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Meus Turnos')).toBeInTheDocument()
    })

    // Em Andamento
    fireEvent.click(screen.getByText('Em Andamento'))
    await waitFor(() => {
      expect(screen.getByText('Barman para Festa')).toBeInTheDocument()
    })

    // Histórico
    fireEvent.click(screen.getByText(/Histórico/))
    await waitFor(() => {
      expect(screen.getByText('Cozinheiro para Evento')).toBeInTheDocument()
    })
  })
})

describe('MyJobs - Botao check-out', () => {
  it('exibe botao Check-out para turnos in_progress com checkin e sem checkout', async () => {
    setupMocks([APP_IN_PROGRESS])
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Meus Turnos')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Em Andamento'))

    await waitFor(() => {
      expect(screen.getByText('Barman para Festa')).toBeInTheDocument()
    })

    // worker_checkin_at setado e worker_checkout_at null → botão Check-out visível
    expect(screen.getByText('Check-out')).toBeInTheDocument()
  })
})

describe('MyJobs - Estado vazio por tab', () => {
  it('exibe estado vazio na tab Em Andamento quando nao ha turnos', async () => {
    setupMocks([])
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Meus Turnos')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Em Andamento'))

    await waitFor(() => {
      expect(screen.getByText('Nenhum trabalho em andamento.')).toBeInTheDocument()
    })
  })

  it('exibe estado vazio na tab Agendados quando nao ha turnos', async () => {
    setupMocks([])
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Meus Turnos')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Agendados'))

    await waitFor(() => {
      expect(screen.getByText('Nenhum turno agendado no momento.')).toBeInTheDocument()
    })
  })

  it('exibe estado vazio na tab Historico quando nao ha turnos', async () => {
    setupMocks([])
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Meus Turnos')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(/Histórico/))

    await waitFor(() => {
      expect(screen.getByText('Seu histórico está vazio.')).toBeInTheDocument()
    })
  })
})

describe('MyJobs - Erro de autenticacao', () => {
  it('navega para login quando usuario nao autenticado', async () => {
    const mockNavigate = vi.fn()
    vi.mocked(useToast).mockReturnValue({ addToast: vi.fn(), removeToast: vi.fn() })
    vi.mocked(useNavigate).mockReturnValue(mockNavigate)
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: null },
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.getUser>>)

    renderComponent()

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login')
    })
  })
})
