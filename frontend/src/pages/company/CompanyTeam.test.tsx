import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CompanyTeam from './CompanyTeam'
import type { TeamMember } from '../../types'

// Mock supabase — factory com só vi.fn() inline
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
}))

vi.mock('../../contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ addToast: vi.fn(), removeToast: vi.fn() })),
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

// useCompanyTeam — hook não editável, mockado por completo (dados fixos de elenco).
const mockRemoveWorker = vi.fn().mockResolvedValue(true)
const mockAddWorker = vi.fn().mockResolvedValue(true)
const mockRefresh = vi.fn()
let teamMembersFixture: TeamMember[] = []

vi.mock('../../hooks/useTeamConnections', () => ({
  useCompanyTeam: () => ({
    teamMembers: teamMembersFixture,
    pendingConnections: [],
    loading: false,
    companyId: 'company-1',
    addWorker: mockAddWorker,
    removeWorker: mockRemoveWorker,
    refresh: mockRefresh,
  }),
}))

// useCompanyInvites — hook não editável, mockado com um invite() rastreável. Expondo a chamada
// do próprio hook (com jobId) permite conferir que o jobId selecionado no picker é o mesmo
// usado quando "Confirmar convite" dispara.
const mockInvite = vi.fn().mockResolvedValue(true)
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- _jobId só existe pra ficar registrado em mock.calls
const mockUseCompanyInvites = vi.fn((_jobId: string | null | undefined) => ({
  invites: [],
  loading: false,
  invitingWorkerId: null as string | null,
  invite: mockInvite,
  refresh: vi.fn(),
}))
vi.mock('../../hooks/useShiftInvites', () => ({
  useCompanyInvites: (jobId: string | null | undefined) => mockUseCompanyInvites(jobId),
}))

import { supabase } from '../../lib/supabase'

function buildChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    // `.in()` é usado de dois jeitos no código real: encadeado antes de `.order()` (jobs) e
    // como terminal que resolve a promise (exclusão de applications). Default chainável — quem
    // precisa do terminal sobrescreve `in` explicitamente (ver applicationsExcludeChain).
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
  return { ...chain, ...overrides }
}

function member(workerId: string, overrides: Partial<TeamMember['worker']> = {}): TeamMember {
  return {
    connection: {
      id: `conn-${workerId}`,
      company_id: 'company-1',
      worker_id: workerId,
      status: 'accepted',
      source: 'phone',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    worker: {
      id: workerId,
      full_name: 'João Silva',
      primary_role: 'Garçom',
      rating_average: 4.5,
      completed_jobs_count: 3,
      city: 'São Paulo',
      pix_key: 'joao@pix.com',
      ...overrides,
    },
  }
}

function renderComponent() {
  return render(
    <MemoryRouter>
      <CompanyTeam />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  teamMembersFixture = []
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: 'owner-1' } },
    error: null,
  } as Awaited<ReturnType<typeof supabase.auth.getUser>>)
})

// Escopo de unidade (F13): os servicos passaram a resolver a empresa OPERADA pelo seam, em vez
// de `.eq('owner_id', user.id)`. O duble evita bater na RPC get_my_companies nos testes.
vi.mock('../../services/companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
  getMyCompanies: vi.fn().mockResolvedValue([{ company_id: 'company-1' }]),
}))

describe('CompanyTeam - Histórico com a empresa', () => {
  it('mostra quantos turnos concluídos e a data do último (batch, 1 query pro elenco todo)', async () => {
    teamMembersFixture = [member('worker-1')]

    const applicationsHistoryChain = buildChain({
      in: vi.fn().mockResolvedValue({
        data: [
          { worker_id: 'worker-1', jobs: { company_id: 'company-1', start_date: '2026-02-01' } },
          { worker_id: 'worker-1', jobs: { company_id: 'company-1', start_date: '2026-03-10' } },
        ],
        error: null,
      }),
    })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'applications') return applicationsHistoryChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText(/2 turnos com você/)).toBeInTheDocument()
    })
    expect(screen.getByText(/10\/03\/2026/)).toBeInTheDocument()
  })

  it('mostra "Nenhum turno ainda com você" quando não há histórico', async () => {
    teamMembersFixture = [member('worker-1')]
    vi.mocked(supabase.from).mockImplementation(() => buildChain() as unknown as ReturnType<typeof supabase.from>)

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Nenhum turno ainda com você')).toBeInTheDocument()
    })
  })
})

describe('CompanyTeam - Convidar direto do elenco', () => {
  it('lista só turnos open/paused elegíveis, exclui os com data passada e os com application existente', async () => {
    teamMembersFixture = [member('worker-1')]

    const companiesChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'company-1' }, error: null }),
    })
    const jobsChain = buildChain({
      order: vi.fn().mockResolvedValue({
        data: [
          { id: 'job-past', title: 'Turno de ontem', start_date: '2000-01-01', work_start_time: null, work_end_time: null, location: null, budget: 100 },
          { id: 'job-future', title: 'Turno elegível', start_date: '2099-01-01', work_start_time: '18:00', work_end_time: '23:00', location: 'SP', budget: 200 },
          { id: 'job-already-invited', title: 'Turno já convidado', start_date: '2099-02-01', work_start_time: null, work_end_time: null, location: null, budget: 150 },
        ],
        error: null,
      }),
    })
    const applicationsExcludeChain = buildChain({
      in: vi.fn().mockResolvedValue({ data: [{ job_id: 'job-already-invited' }], error: null }),
    })
    const applicationsHistoryChain = buildChain({
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'companies') return companiesChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'jobs') return jobsChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'applications') {
        // Primeira chamada relevante no fluxo do teste é a exclusão dentro do modal;
        // a query de histórico da página também usa 'applications' mas com corpo
        // diferente — ambos os mocks aceitam .in() e devolvem algo seguro.
        return applicationsExcludeChain as unknown as ReturnType<typeof supabase.from>
      }
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })
    void applicationsHistoryChain

    renderComponent()

    const inviteButton = await screen.findByRole('button', { name: 'Convidar para turno' })
    fireEvent.click(inviteButton)

    await waitFor(() => {
      expect(screen.getByText('Turno elegível')).toBeInTheDocument()
    })
    expect(screen.queryByText('Turno de ontem')).not.toBeInTheDocument()
    expect(screen.queryByText('Turno já convidado')).not.toBeInTheDocument()
  })

  it('oferece "Criar turno" no estado vazio quando não há turno elegível', async () => {
    teamMembersFixture = [member('worker-1')]

    const companiesChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'company-1' }, error: null }),
    })
    const jobsChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'companies') return companiesChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'jobs') return jobsChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    fireEvent.click(await screen.findByRole('button', { name: 'Convidar para turno' }))

    const createButton = await screen.findByRole('button', { name: /Criar turno/i })
    fireEvent.click(createButton)

    expect(mockNavigate).toHaveBeenCalledWith('/company/create')
  })

  it('confirma o convite com o turno selecionado (workerId fixo, jobId escolhido no picker)', async () => {
    teamMembersFixture = [member('worker-1')]

    const companiesChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'company-1' }, error: null }),
    })
    const jobsChain = buildChain({
      order: vi.fn().mockResolvedValue({
        data: [{ id: 'job-future', title: 'Turno elegível', start_date: '2099-01-01', work_start_time: null, work_end_time: null, location: null, budget: 200 }],
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

    renderComponent()

    fireEvent.click(await screen.findByRole('button', { name: 'Convidar para turno' }))
    fireEvent.click(await screen.findByText('Turno elegível'))

    const confirmButton = await screen.findByRole('button', { name: /Confirmar convite/i })
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(mockInvite).toHaveBeenCalledWith('worker-1')
    })
    // O hook foi chamado (em algum render) já com o jobId escolhido no picker.
    expect(mockUseCompanyInvites.mock.calls.some(([jobId]) => jobId === 'job-future')).toBe(true)
  })
})
