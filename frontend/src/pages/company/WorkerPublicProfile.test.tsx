import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import WorkerPublicProfile from './WorkerPublicProfile'

// Mock supabase
vi.mock('../../lib/supabase', () => ({
  supabase: {
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
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
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
    <MemoryRouter initialEntries={[`/company/worker/${workerId}`]}>
      <Routes>
        <Route path="/company/worker/:id" element={<WorkerPublicProfile />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('WorkerPublicProfile — sistema de avaliação', () => {
  it('renderiza "(7 avaliações)" quando reviews_count=7', async () => {
    const workerChain = buildChain({
      single: vi.fn().mockResolvedValue({ data: WORKER_DATA_WITH_REVIEWS, error: null }),
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
      single: vi.fn().mockResolvedValue({ data: WORKER_DATA_NO_REVIEWS, error: null }),
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
      single: vi.fn().mockResolvedValue({ data: WORKER_DATA_WITH_REVIEWS, error: null }),
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
