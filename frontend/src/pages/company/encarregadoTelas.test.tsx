import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import CompanyJobDetails from './CompanyJobDetails'
import CompanyJobCandidates from './CompanyJobCandidates'
import CompanyCreateJob from './CompanyCreateJob'
import { MemberCard } from '../../components/team/MemberCard'
import { supabase } from '../../lib/supabase'
import { getJobScope } from '../../services/jobScopeService'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => mockNavigate,
}))
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getUser: vi.fn() }, from: vi.fn(), rpc: vi.fn() } }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }))
vi.mock('../../hooks/useCurrentCompany', () => ({ useCurrentCompany: () => null, useCurrentCompanyState: () => ({ company: null, resolved: true, error: false }) }))
vi.mock('../../hooks/useShiftInvites', () => ({
  useCompanyInvites: () => ({ invitedWorkerIds: [], invite: vi.fn(), invitingWorkerId: null }),
  useShiftCalls: () => ({ calls: [], loading: false, cancellingId: null, cancel: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('../../hooks/useTeamConnections', () => ({ useCompanyTeam: () => ({ teamMembers: [], loading: false }) }))
vi.mock('../../services/companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('c1'),
  getMyCompanies: vi.fn().mockResolvedValue([]),
  pickCurrentCompany: () => null,
  subscribeCompanyScope: () => () => undefined,
  isGestor: () => false,
  hasTeamNav: () => true,
}))
vi.mock('../../services/jobScopeService', async () => ({
  ...(await vi.importActual<object>('../../services/jobScopeService')),
  getJobScope: vi.fn(),
}))

const GESTOR_JOB = {
  id: 'j1', title: 'Turno do Gestor', budget: 100, responsible_id: 'gestor', start_date: '2026-11-27T15:00:00Z',
  status: 'open', slots: 1,
}

function chain(result: unknown) {
  const obj: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'order', 'limit']) obj[m] = () => obj
  obj.single = () => Promise.resolve(result)
  obj.maybeSingle = () => Promise.resolve(result)
  obj.then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok)
  return obj as never
}

const open = (path: string, route: string, el: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  )

const PAGINAS: Array<[string, string, React.ReactElement]> = [
  ['/company/jobs/j1', '/company/jobs/:id', <CompanyJobDetails />],
  ['/company/jobs/j1/candidates', '/company/jobs/:id/candidates', <CompanyJobCandidates />],
  ['/company/jobs/j1/edit', '/company/jobs/:id/edit', <CompanyCreateJob />],
]

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.mocked(supabase.from).mockImplementation(() => chain({ data: GESTOR_JOB, error: null }))
  vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: { id: 'eu' } }, error: null } as never)
  vi.mocked(getJobScope).mockResolvedValue({ companyId: 'c1', restricted: true, userId: 'eu', coverages: [] })
})

describe('D-4: URL direta de turno alheio', () => {
  it.each(PAGINAS)('%s mostra "sem acesso" e nenhum dado do turno', async (path, route, el) => {
    open(path, route, el)
    expect(await screen.findByRole('heading', { name: /não tem acesso/i })).toBeInTheDocument()
    expect(screen.queryByText('Turno do Gestor')).not.toBeInTheDocument()
  })
})

describe('falha de rede não vira logout', () => {
  const offline = { data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 0 } } as never

  it.each(PAGINAS)('%s fica na tela com "Tentar de novo"', async (path, route, el) => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue(offline)
    open(path, route, el)
    expect(await screen.findByRole('button', { name: /tentar de novo/i })).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it.each(PAGINAS)('%s sem sessão de verdade vai ao login', async (path, route, el) => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: null }, error: null } as never)
    open(path, route, el)
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login'))
  })

  it('Criar turno: o que foi digitado continua depois da falha e da nova tentativa', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue(offline)
    open('/company/create?repetir=j1', '/company/create', <CompanyCreateJob />)
    await screen.findByRole('button', { name: /tentar de novo/i })
    const titulo = screen.getAllByRole('textbox')[0]
    fireEvent.change(titulo, { target: { value: 'Garçom sábado' } })
    fireEvent.click(screen.getByRole('button', { name: /tentar de novo/i }))
    await screen.findByRole('button', { name: /tentar de novo/i })
    expect(titulo).toHaveValue('Garçom sábado')
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})

describe('Elenco em modo restrito', () => {
  it('sem remover, repassar link, PIX de histórico nem abrir perfil', () => {
    const member = { connection: { id: 'tc1', worker_id: 'w1' }, worker: { id: 'w1', full_name: 'Ana Souza' } } as never
    render(<MemoryRouter><MemberCard member={member} restricted onRemove={vi.fn()} onInvite={vi.fn()} /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /convidar para turno/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remover|repassar/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/turno ainda com você/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Ana Souza'))
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
