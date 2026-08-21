import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Dashboard from './Dashboard'

// ---------------------------------------------------------------------------
// F7 — R14/A10: CTA de disponibilidade no Dashboard. BLOCKER da revisão de frontend: o CTA
// precisa aparecer SÓ enquanto `availability_days IS NULL` (nunca declarou) e sumir assim que
// existir QUALQUER grade com pelo menos um período dentro. Cobre os DOIS lados — um teste que só
// prova "aparece" não prova A10 (o critério exige aparecer E sumir corretamente). O caso `{}`
// (objeto vazio, aceito pelo CHECK do banco por containment — achado do security-reviewer) é
// tratado como equivalente a "nunca declarou": sem isso, um freela com `{}` gravado por qualquer
// caminho perderia o CTA sem nunca ter declarado nada.
// ---------------------------------------------------------------------------

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(),
  },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

vi.mock('../components/PageMeta', () => ({
  default: () => null,
}))

vi.mock('../hooks/useShiftInvites', () => ({
  useWorkerInvites: () => ({
    pendingInvites: [],
    loading: false,
    respondingId: null,
    respond: vi.fn(),
  }),
}))

vi.mock('../hooks/useTeamConnections', () => ({
  useWorkerStores: () => ({
    myStores: [],
    pendingConnections: [],
    loading: false,
  }),
}))

import { supabase } from '../lib/supabase'

function workerRow(availabilityDays: unknown) {
  return {
    id: 'worker-1',
    full_name: 'Freela Teste',
    avatar_url: null,
    level: 1,
    xp: 0,
    earnings_total: 0,
    rating_average: null,
    completed_jobs_count: 0,
    roles: [],
    primary_role: null,
    availability_days: availabilityDays,
  }
}

/** `.from('workers').select('*').eq('id', userId).single()` — encadeável. */
function workersFromChain(row: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: row, error: null }),
      }),
    }),
  }
}

/** `.from('applications').select(...).eq(...).in(...)` (nextJob) e com `.order().limit()` (history). */
function applicationsFromChain() {
  const emptyResult = Promise.resolve({ data: [], error: null })
  const chain = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          // nextJob: `await ...in(...)` resolve direto
          then: emptyResult.then.bind(emptyResult),
          // history: `.in(...).order(...).limit(...)`
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    }),
  }
  return chain
}

function setupMocks(availabilityDays: unknown) {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: 'worker-1', email_confirmed_at: '2026-01-01T00:00:00Z' } },
    error: null,
  } as never)

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === 'workers') return workersFromChain(workerRow(availabilityDays)) as never
    if (table === 'applications') return applicationsFromChain() as never
    throw new Error(`tabela não mockada: ${table}`)
  })
}

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>,
  )
}

describe('Dashboard — CTA de disponibilidade (F7 R14/A10)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('aparece quando availability_days é NULL (nunca declarou)', async () => {
    setupMocks(null)
    renderDashboard()

    expect(
      await screen.findByText(/declare sua disponibilidade/i),
    ).toBeInTheDocument()
  })

  it('aparece quando availability_days é {} (vazio, equivalente a nunca declarado)', async () => {
    setupMocks({})
    renderDashboard()

    expect(
      await screen.findByText(/declare sua disponibilidade/i),
    ).toBeInTheDocument()
  })

  it('some quando existe grade com pelo menos um período declarado', async () => {
    setupMocks({ '1': ['manha'] })
    renderDashboard()

    // Espera a tela terminar de carregar (sai do skeleton) antes de afirmar ausência.
    await waitFor(() => {
      expect(screen.getByText(/próximo turno/i)).toBeInTheDocument()
    })

    expect(screen.queryByText(/declare sua disponibilidade/i)).not.toBeInTheDocument()
  })
})
