import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { InviteToShiftModal } from './InviteToShiftModal'
import type { TeamMember } from '../../types'

// Mock supabase — factory com só vi.fn() inline (mesmo padrão de CompanyTeam.test.tsx)
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
}))

vi.mock('../../lib/logger', () => ({ logError: vi.fn() }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// useCompanyInvites — hook não editável, mockado.
vi.mock('../../hooks/useShiftInvites', () => ({
  useCompanyInvites: () => ({
    invites: [],
    loading: false,
    invitingWorkerId: null as string | null,
    invite: vi.fn().mockResolvedValue(true),
    refresh: vi.fn(),
  }),
}))

import { supabase } from '../../lib/supabase'

function buildChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
  return { ...chain, ...overrides }
}

function member(): TeamMember {
  return {
    connection: {
      id: 'conn-worker-1',
      company_id: 'company-1',
      worker_id: 'worker-1',
      status: 'accepted',
      source: 'phone',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    worker: {
      id: 'worker-1',
      full_name: 'João Silva',
      primary_role: 'Garçom',
      rating_average: 4.5,
      completed_jobs_count: 3,
      city: 'São Paulo',
      pix_key: 'joao@pix.com',
    },
  }
}

function renderModal() {
  return render(
    <MemoryRouter>
      <InviteToShiftModal member={member()} onClose={vi.fn()} onInvited={vi.fn()} />
    </MemoryRouter>
  )
}

// Escopo de unidade (F13): os servicos passaram a resolver a empresa OPERADA pelo seam, em vez
// de `.eq('owner_id', user.id)`. O duble evita bater na RPC get_my_companies nos testes.
vi.mock('../../services/companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
  getMyCompanies: vi.fn().mockResolvedValue([{ company_id: 'company-1' }]),
}))

describe('InviteToShiftModal - elegibilidade do turno de hoje à noite (fuso BRT)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Força o fuso local do processo p/ BRT — sem isso o teste ficaria dependente do
    // fuso do ambiente de CI (que pode já ser UTC, mascarando o bug).
    vi.stubEnv('TZ', 'America/Sao_Paulo')
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'owner-1' } },
      error: null,
    } as Awaited<ReturnType<typeof supabase.auth.getUser>>)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('turno de HOJE (BRT) continua elegível às 22h — não é descartado como "passado" pelo toISOString em UTC', async () => {
    // 16/08/2026 22:00 em BRT (UTC-3) = 17/08/2026 01:00 em UTC. Um cálculo ingênuo com
    // `new Date().toISOString().split('T')[0]` leria "2026-08-17" como "hoje" e descartaria
    // um turno com start_date "2026-08-16" como turno passado — exatamente o bug do achado.
    vi.setSystemTime(new Date('2026-08-17T01:00:00.000Z'))

    const companiesChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'company-1' }, error: null }),
    })
    const jobsChain = buildChain({
      order: vi.fn().mockResolvedValue({
        data: [
          { id: 'job-hoje', title: 'Turno de hoje à noite', start_date: '2026-08-16', work_start_time: '20:00', work_end_time: '23:59', location: 'SP', budget: 200 },
        ],
        error: null,
      }),
    })
    const applicationsChain = buildChain({
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'companies') return companiesChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'jobs') return jobsChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'applications') return applicationsChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderModal()

    await waitFor(() => {
      expect(screen.getByText('Turno de hoje à noite')).toBeInTheDocument()
    })
    expect(screen.queryByText('Nenhum turno elegível para convidar agora.')).not.toBeInTheDocument()
  })

  it('horário do turno é exibido sem os segundos (HH:MM, não HH:MM:SS)', async () => {
    vi.setSystemTime(new Date('2026-08-17T01:00:00.000Z'))

    const companiesChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'company-1' }, error: null }),
    })
    const jobsChain = buildChain({
      order: vi.fn().mockResolvedValue({
        data: [
          { id: 'job-hoje', title: 'Turno de hoje à noite', start_date: '2026-08-16', work_start_time: '20:00:00', work_end_time: '23:59:00', location: 'SP', budget: 200 },
        ],
        error: null,
      }),
    })
    const applicationsChain = buildChain({
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'companies') return companiesChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'jobs') return jobsChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'applications') return applicationsChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderModal()

    await waitFor(() => {
      expect(screen.getByText('· 20:00–23:59')).toBeInTheDocument()
    })
    expect(screen.queryByText(/20:00:00/)).not.toBeInTheDocument()
  })
})
