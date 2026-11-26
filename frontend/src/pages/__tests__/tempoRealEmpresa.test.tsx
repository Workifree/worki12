/** Tempo real, telas da empresa: evento chega, a tela atualiza e nada do que a pessoa fazia se perde. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { emitLive } from '../../test/liveHubMock'

const h = vi.hoisted(() => ({
    db: null as unknown as import('../../test/fakeDb').FakeDb,
    today: vi.fn(),
    team: vi.fn(),
    members: vi.fn(),
    toast: vi.fn(),
    channel: vi.fn(),
}))

vi.mock('../../lib/supabase', async () => {
    const { createFakeDb } = await import('../../test/fakeDb')
    h.db = createFakeDb()
    const user = { id: 'user-1' }
    const channel = () => {
        const c = { on: () => c, subscribe: () => c, track: () => undefined, unsubscribe: () => undefined, presenceState: () => ({}) }
        h.channel()
        return c
    }
    return {
        supabase: {
            from: (table: string) => h.db.from(table),
            rpc: () => Promise.resolve({ data: { outcome: 'ok', items: [] }, error: null }),
            channel,
            removeChannel: () => undefined,
            auth: {
                getUser: () => Promise.resolve({ data: { user }, error: null }),
                getSession: () => Promise.resolve({ data: { session: { user } }, error: null }),
            },
        },
    }
})
vi.mock('../../lib/authSession', () => ({
    getSessionUserOrThrow: vi.fn().mockResolvedValue({ id: 'user-1' }),
    checkSession: vi.fn().mockResolvedValue({ status: 'ok', user: { id: 'user-1' } }),
}))
const company = { company_id: 'company-1', role: 'owner', company_name: 'Doces', team_enabled: false }
vi.mock('../../services/companyScopeService', async () => ({
    ...(await vi.importActual<object>('../../services/companyScopeService')),
    getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
    getMyCompanies: vi.fn().mockResolvedValue([{ company_id: 'company-1', role: 'owner' }]),
    pickCurrentCompany: () => company,
    subscribeCompanyScope: () => () => undefined,
    isGestor: () => true,
    hasTeamNav: () => false,
}))
vi.mock('../../hooks/useCurrentCompany', () => ({
    useCurrentCompany: () => company,
    useCurrentCompanyState: () => ({ company, resolved: true, error: false }),
}))
vi.mock('../../services/jobScopeService', () => ({
    getJobScope: vi.fn().mockResolvedValue({ companyId: 'company-1', restricted: false, userId: null, coverages: [] }),
    canSeeJob: () => true,
    scopeResponsibleIds: () => [],
}))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast: h.toast, removeToast: vi.fn() }) }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../services/shiftOperationService', async () => ({
    ...(await vi.importActual<object>('../../services/shiftOperationService')),
    listJobsByResponsible: (...a: unknown[]) => h.today(...a),
    listCompanyOperators: vi.fn().mockResolvedValue({ ok: true, items: [] }),
}))
vi.mock('../../services/teamConnectionService', () => ({
    TeamConnectionService: {
        listTeamMembers: (...a: unknown[]) => h.team(...a),
        listAllConnections: vi.fn().mockResolvedValue([]),
        generateInviteToken: vi.fn().mockResolvedValue({ url: 'https://worki/convite/x' }),
    },
}))
vi.mock('../../services/teamListService', () => ({ TeamListService: { listLists: vi.fn().mockResolvedValue([]) } }))

import CompanyJobCandidates from '../company/CompanyJobCandidates'
import CompanyJobs from '../company/CompanyJobs'
import CompanyMessages from '../company/CompanyMessages'

const wait = { timeout: 4000 }
const live = (table: string) => act(() => { emitLive(table) })
/** Passa do agrupamento de eventos (400 ms). */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 700)))

function at(path: string, route: string, element: ReactElement) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
                <Routes><Route path={route} element={element} /></Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    )
}

const application = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id, job_id: 'job-1', worker_id: `w-${id}`, status: 'hired', created_at: '2026-11-20T10:00:00Z',
    worker: { id: `w-${id}`, full_name: name, avatar_url: null, tags: [], level: 1, rating_average: 5, reviews_count: 1 },
    ...extra,
})

beforeEach(() => {
    vi.clearAllMocks()
    h.db.reset()
    h.db.rows.companies = [{ name: 'Doces' }]
})

describe('presença e pagamento (candidatos)', () => {
    const open = () => at('/company/jobs/job-1/candidates', '/company/jobs/:id/candidates', <CompanyJobCandidates />)
    beforeEach(() => {
        h.db.rows.jobs = [{ title: 'Garçom de evento', budget: 150, slots: 3, start_date: '2026-03-05', company_id: 'company-1' }]
        h.db.rows.applications = [application('a1', 'Ana Souza')]
    })

    it('quem aceitou aparece sozinho', async () => {
        open()
        await screen.findByText('Ana Souza', {}, wait)
        h.db.rows.applications = [application('a1', 'Ana Souza'), application('a2', 'Bruno Lima')]
        await live('applications')
        expect(await screen.findByText('Bruno Lima', {}, wait)).toBeInTheDocument()
        expect(screen.getByText('Ana Souza')).toBeInTheDocument()
    })

    it('com o modal de pagamento aberto nada muda; ao fechar, atualiza', async () => {
        const done = {
            worker_checkin_at: '2026-03-05T12:00:00Z', worker_checkout_at: '2026-03-05T20:00:00Z',
            company_checkin_confirmed_at: '2026-03-05T12:00:00Z', company_checkout_confirmed_at: '2026-03-05T20:00:00Z',
        }
        h.db.rows.applications = [application('a1', 'Ana Souza', done)]
        open()
        await screen.findByText('Ana Souza', {}, wait)
        fireEvent.click(screen.getByRole('button', { name: /Registrar pagamento/i }))
        const note = screen.getByRole('dialog').querySelector('textarea, input[type="text"]') as HTMLInputElement
        fireEvent.change(note, { target: { value: 'pago no balcão' } })

        h.db.rows.applications = [application('a1', 'Ana Souza', done), application('a2', 'Bruno Lima')]
        await live('applications')
        await settle()
        expect(screen.queryByText('Bruno Lima')).not.toBeInTheDocument()
        expect(note).toHaveValue('pago no balcão')

        fireEvent.keyDown(document, { key: 'Escape' })
        expect(await screen.findByText('Bruno Lima', {}, wait)).toBeInTheDocument()
    })

    it('recarga que falha mantém a tela, sem erro e sem bloquear o pagamento', async () => {
        open()
        await screen.findByText('Ana Souza', {}, wait)
        h.db.failing.add('applications')
        h.db.failing.add('shift_payments')
        await live('applications')
        await settle()
        expect(screen.getByText('Ana Souza')).toBeInTheDocument()
        expect(screen.queryByText(/Não conseguimos/)).not.toBeInTheDocument()
    })
})

describe('turnos', () => {
    const job = (id: string, title: string) => ({ id, title, status: 'open', type: 'freela', created_at: '2026-11-20T10:00:00Z', start_date: null, slots: 1 })

    it('turno novo entra sem apagar a busca digitada', async () => {
        h.db.rows.jobs = [job('j1', 'Cozinha almoço')]
        at('/company/jobs', '/company/jobs', <CompanyJobs />)
        await screen.findByText('Cozinha almoço', {}, wait)
        const search = screen.getByRole('textbox', { name: 'Buscar turnos' })
        fireEvent.change(search, { target: { value: 'cozinha' } })
        h.db.rows.jobs = [job('j1', 'Cozinha almoço'), job('j2', 'Cozinha jantar')]
        await live('job_live_signals')
        expect(await screen.findByText('Cozinha jantar', {}, wait)).toBeInTheDocument()
        expect(search).toHaveValue('cozinha')
    })
})

describe('mensagens da empresa', () => {
    const conversation = (id: string, name: string) => ({
        id, application_uuid: `app-${id}`, createdat: '2026-11-20T10:00:00Z', islocked: false,
        application: { id: `app-${id}`, status: 'hired', worker: { id: `w-${id}`, full_name: name }, job: { id: 'j', title: 'Evento', company_id: 'company-1' } },
    })
    const message = (id: string, content: string) => ({ id, content, conversationid: 'c1', senderid: 'w-c1', createdat: `2026-11-20T1${id}:00:00Z`, read_at: '2026-11-20T20:00:00Z' })

    it('lista e conversa aberta atualizam sem piscar o histórico nem apagar o texto', async () => {
        h.db.rows.Conversation = [conversation('c1', 'Ana Souza')]
        h.db.rows.Message = [message('1', 'primeira mensagem')]
        at('/company/messages?conversation=c1', '/company/messages', <CompanyMessages />)
        const log = await screen.findByRole('log', {}, wait)
        await waitFor(() => expect(log).toHaveTextContent('primeira mensagem'), wait)
        const field = screen.getByRole('textbox')
        fireEvent.change(field, { target: { value: 'rascunho' } })
        const channels = h.channel.mock.calls.length

        h.db.rows.Conversation = [conversation('c1', 'Ana Souza'), conversation('c2', 'Bruno Lima')]
        h.db.rows.Message = [message('1', 'primeira mensagem'), message('2', 'segunda mensagem')]
        await live('Message')
        expect(await screen.findByText('Bruno Lima', {}, wait)).toBeInTheDocument()
        await waitFor(() => expect(log).toHaveTextContent('segunda mensagem'), wait)
        expect(log).toHaveTextContent('primeira mensagem')
        expect(field).toHaveValue('rascunho')
        // A conversa não foi reassinada: o histórico não foi zerado e recarregado.
        expect(h.channel.mock.calls.length).toBe(channels)
    })
})

describe('Hoje', () => {
    const turno = (jobId: string, title: string) => ({
        jobId, title, date: new Date().toLocaleDateString('en-CA'), startTime: '08:00', endTime: '18:00', status: 'open',
        slots: 2, filled: 0, responsibleId: 'user-1', responsibleName: 'Dona', effectiveResponsibleId: 'user-1',
        effectiveResponsibleName: 'Dona', tagId: null, tagName: null,
    })

    it('turno novo aparece; falha na recarga não apaga a lista', async () => {
        const { default: CompanyToday } = await import('../company/CompanyToday')
        h.today.mockResolvedValue({ outcome: 'ok', items: [turno('j1', 'Balcão')], truncated: false })
        at('/company/hoje', '/company/hoje', <CompanyToday />)
        await screen.findByText('Balcão', {}, wait)

        h.today.mockResolvedValue({ outcome: 'ok', items: [turno('j1', 'Balcão'), turno('j2', 'Salão')], truncated: false })
        await live('applications')
        expect(await screen.findByText('Salão', {}, wait)).toBeInTheDocument()

        h.today.mockResolvedValue({ outcome: 'error', items: [], truncated: false })
        await live('applications')
        await settle()
        expect(screen.getByText('Salão')).toBeInTheDocument()
        expect(screen.queryByText('Não foi possível carregar os turnos.')).not.toBeInTheDocument()
    })
})

describe('Elenco', () => {
    const member = (id: string, name: string) => ({
        connection: { id: `c-${id}`, worker_id: id, company_id: 'company-1', status: 'accepted' },
        worker: { id, full_name: name, avatar_url: null, roles: [], rating_average: 5, reviews_count: 0, completed_jobs_count: 0 },
    })

    it('quem aceitou o convite entra na lista sem esqueleto', async () => {
        const { default: CompanyTeam } = await import('../company/CompanyTeam')
        h.team.mockResolvedValue([member('w1', 'Ana Souza')])
        at('/company/team', '/company/team', <CompanyTeam />)
        await screen.findByText('Ana Souza', {}, wait)
        h.team.mockResolvedValue([member('w1', 'Ana Souza'), member('w2', 'Bruno Lima')])
        await live('team_connections')
        expect(await screen.findByText('Bruno Lima', {}, wait)).toBeInTheDocument()
        expect(screen.getByText('Ana Souza')).toBeInTheDocument()
    })
})

describe('detalhe e Início', () => {
    beforeEach(() => {
        h.db.rows.jobs = [{ id: 'job-1', title: 'Garçom', status: 'open', slots: 2, budget: 100, created_at: '2026-11-20T10:00:00Z', applications: [] }]
        h.db.rows.applications = []
    })

    it('detalhe do turno atualiza a contagem de freelas', async () => {
        const { default: CompanyJobDetails } = await import('../company/CompanyJobDetails')
        at('/company/jobs/job-1', '/company/jobs/:id', <CompanyJobDetails />)
        await screen.findByText('Freelas · 0 de 2 vagas', {}, wait)
        h.db.rows.applications = [{ status: 'hired' }]
        await live('applications')
        expect(await screen.findByText('Freelas · 1 de 2 vagas', {}, wait)).toBeInTheDocument()
    })

    it('Início: recarga que falha não vira tela de erro', async () => {
        const { default: CompanyDashboard } = await import('../company/CompanyDashboard')
        at('/company/dashboard', '/company/dashboard', <CompanyDashboard />)
        await screen.findByText('Turnos ativos', {}, wait)
        await settle()
        h.db.failing.add('jobs')
        h.db.failing.add('applications')
        h.db.failing.add('shift_payments')
        await live('applications')
        await settle()
        expect(screen.getByText('Turnos ativos')).toBeInTheDocument()
        expect(screen.queryByText(/Não conseguimos carregar seus turnos/)).not.toBeInTheDocument()
        expect(screen.queryByText(/pagamentos pendentes/)).not.toBeInTheDocument()
    })
})
