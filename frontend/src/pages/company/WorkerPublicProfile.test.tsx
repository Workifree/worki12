import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import WorkerPublicProfile from './WorkerPublicProfile'
import { ToastProvider } from '../../contexts/ToastContext'

// Mock supabase — `auth.getUser` tem default inofensivo (sem sessão) pra não quebrar os
// testes que não se importam com o gate de vínculo (R1); os dois testes de visibilidade
// sobrescrevem com um usuário-empresa real.
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    from: vi.fn(),
  },
}))

// Mock analytics dynamic import
vi.mock('../../services/analytics', () => ({
  AnalyticsService: {
    trackProfileView: vi.fn(),
  },
}))

// Mock useNavigate
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: vi.fn(() => vi.fn()),
  }
})

import { supabase } from '../../lib/supabase'

function buildChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
  }
  return { ...chain, ...overrides }
}

const WORKER_DATA_WITH_REVIEWS = {
  id: 'worker-1',
  full_name: 'Maria Oliveira',
  bio: 'Barista e bartender experiente',
  city: 'São Paulo',
  level: 3,
  xp: 1500,
  completed_jobs_count: 12,
  recommendation_score: 0,
  rating_average: 4.3,
  reviews_count: 7,
  tags: ['Barista', 'Bartender', 'Atendimento'],
  created_at: '2024-01-15T10:00:00.000Z',
  avatar_url: null,
}

const WORKER_DATA_NO_REVIEWS = {
  ...WORKER_DATA_WITH_REVIEWS,
  rating_average: 0,
  reviews_count: 0,
}

const WORKER_DATA_WITH_CONTACT = {
  ...WORKER_DATA_WITH_REVIEWS,
  phone: '(11) 99999-9999',
  pix_key: 'maria@pix.com',
}

const REVIEWS_DATA = [
  {
    id: 'review-1',
    rating: 5,
    comment: 'Excelente trabalho!',
    reviewer_id: 'company-1',
    created_at: '2026-03-12T10:00:00.000Z',
  },
]

const COMPANIES_DATA = [
  { id: 'company-1', name: 'Tech Corp' },
]

function renderComponent(workerId = 'worker-1') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/company/worker/${workerId}`]}>
        <Routes>
          <Route path="/company/worker/:id" element={<WorkerPublicProfile />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  )
}

// Mock parcial de `supabase.auth.getUser()` — só os campos usados pelo componente.
// Cast único no retorno (em vez de @ts-expect-error por linha) porque o TS ancora o erro
// de tipo em posições diferentes dependendo do shape do mock (objeto completo vs `user: null`).
type GetUserResult = Awaited<ReturnType<typeof supabase.auth.getUser>>

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: null },
    error: null,
  } as unknown as GetUserResult)
})

describe('WorkerPublicProfile — sistema de avaliação', () => {
  it('renderiza "(7 avaliações)" quando reviews_count=7', async () => {
    const workerChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: WORKER_DATA_WITH_REVIEWS, error: null }),
    })
    const reviewsChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: REVIEWS_DATA, error: null }),
    })
    const companiesChain = buildChain({
      in: vi.fn().mockResolvedValue({ data: COMPANIES_DATA, error: null }),
    })
    const historyChain = buildChain({
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'workers') return workerChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'reviews') return reviewsChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'companies') return companiesChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'applications') return historyChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Maria Oliveira')).toBeInTheDocument()
    })

    expect(screen.getByText('(7 avaliações)')).toBeInTheDocument()
  })

  it('renderiza "—" quando rating_average=0 e reviews_count=0', async () => {
    const workerChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: WORKER_DATA_NO_REVIEWS, error: null }),
    })
    const reviewsChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })
    const historyChain = buildChain({
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'workers') return workerChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'reviews') return reviewsChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'applications') return historyChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Maria Oliveira')).toBeInTheDocument()
    })

    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('(0 avaliações)')).toBeInTheDocument()
  })

  it('cada review exibe data formatada em português', async () => {
    const workerChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: WORKER_DATA_WITH_REVIEWS, error: null }),
    })
    const reviewsChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: REVIEWS_DATA, error: null }),
    })
    const companiesChain = buildChain({
      in: vi.fn().mockResolvedValue({ data: COMPANIES_DATA, error: null }),
    })
    const historyChain = buildChain({
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'workers') return workerChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'reviews') return reviewsChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'companies') return companiesChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'applications') return historyChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText(/Excelente trabalho!/)).toBeInTheDocument()
    })

    // Data formatada em português: "12 de mar. de 2026"
    expect(screen.getByText('12 de mar. de 2026')).toBeInTheDocument()
  })
})

describe('WorkerPublicProfile — visibilidade de contato/pagamento (R1, defesa em profundidade)', () => {
  it('mostra telefone e chave PIX quando a empresa tem vínculo "accepted" com o freela', async () => {
    const workerChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: WORKER_DATA_WITH_CONTACT, error: null }),
    })
    const reviewsChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })
    const historyChain = buildChain({
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })
    // getConnectionStatus encontra uma conexão 'accepted' → hasTeamConnection=true
    const teamConnectionsChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: { status: 'accepted' }, error: null }),
    })

    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'company-99' } },
      error: null,
    } as unknown as GetUserResult)

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'workers') return workerChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'reviews') return reviewsChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'applications') return historyChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'team_connections') return teamConnectionsChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('(11) 99999-9999')).toBeInTheDocument()
    })
    expect(screen.getByText('maria@pix.com')).toBeInTheDocument()
    expect(
      screen.queryByText('Adicione este freela ao seu elenco para ver os dados de pagamento.'),
    ).not.toBeInTheDocument()
  })

  it('oculta telefone e chave PIX e mostra "Adicione..." quando NÃO existe conexão nenhuma', async () => {
    const workerChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: WORKER_DATA_WITH_CONTACT, error: null }),
    })
    const reviewsChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })
    const historyChain = buildChain({
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })
    // getConnectionStatus não encontra NENHUMA conexão → status null
    const teamConnectionsChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })

    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'company-99' } },
      error: null,
    } as unknown as GetUserResult)

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'workers') return workerChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'reviews') return reviewsChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'applications') return historyChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'team_connections') return teamConnectionsChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(
        screen.getByText('Adicione este freela ao seu elenco para ver os dados de pagamento.'),
      ).toBeInTheDocument()
    })
    expect(screen.queryByText('(11) 99999-9999')).not.toBeInTheDocument()
    expect(screen.queryByText('maria@pix.com')).not.toBeInTheDocument()
  })

  it('oculta telefone e chave PIX e mostra "Aguardando o freela aceitar..." quando a conexão está "pending" (F-06)', async () => {
    // Alcançável a partir do PendingCard do CompanyTeam — o freela JÁ foi adicionado, só
    // falta aceitar. A copy não pode sugerir "adicionar de novo" (leva a "já está no elenco").
    const workerChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: WORKER_DATA_WITH_CONTACT, error: null }),
    })
    const reviewsChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })
    const historyChain = buildChain({
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })
    const teamConnectionsChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: { status: 'pending' }, error: null }),
    })

    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'company-99' } },
      error: null,
    } as unknown as GetUserResult)

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'workers') return workerChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'reviews') return reviewsChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'applications') return historyChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'team_connections') return teamConnectionsChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(
        screen.getByText('Aguardando o freela aceitar o convite para ver os dados de pagamento.'),
      ).toBeInTheDocument()
    })
    expect(
      screen.queryByText('Adicione este freela ao seu elenco para ver os dados de pagamento.'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('(11) 99999-9999')).not.toBeInTheDocument()
    expect(screen.queryByText('maria@pix.com')).not.toBeInTheDocument()
  })

  it('mostra "Perfil indisponível" quando a RLS de vínculo esconde a linha (.maybeSingle() sem dado)', async () => {
    const workerChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'workers') return workerChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(
        screen.getByText('Perfil indisponível — este freela não faz parte do seu elenco.'),
      ).toBeInTheDocument()
    })
  })
})
