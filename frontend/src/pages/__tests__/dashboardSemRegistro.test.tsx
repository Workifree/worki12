/** Inicio da empresa: turno passado sem presenca nao e Contratado nem Ativo. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

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

import CompanyDashboard from '../company/CompanyDashboard'

const wait = { timeout: 4000 }
const worker = (n: string) => ({ id: `w-${n}`, full_name: n, avatar_url: null, primary_role: null })
const pastJob = (id: string) => ({ id, title: `Turno ${id}`, location: 'Loja', start_date: '2020-01-10', work_start_time: '09:00', work_end_time: '17:00' })
const jobRow = (id: string, appStatus: string) => ({ id, title: `Turno ${id}`, status: 'open', slots: 1, created_at: '2020-01-01T10:00:00Z', start_date: '2020-01-10', work_start_time: '09:00', work_end_time: '17:00', applications: [{ status: appStatus }] })

beforeEach(() => {
    vi.clearAllMocks()
    h.db.reset()
    h.db.rows.companies = [{ name: 'Doces' }]
    h.db.rows.jobs = [jobRow('j1', 'hired'), jobRow('j2', 'in_progress')]
    h.db.rows.applications = [
        { id: 'a1', job_id: 'j1', worker_id: 'w-Sem', status: 'hired', created_at: '2020-01-01T10:00:00Z', worker_checkin_at: null, company_checkin_confirmed_at: null, worker_checkout_at: null, company_checkout_confirmed_at: null, worker: worker('Sem'), jobs: pastJob('j1') },
        { id: 'a2', job_id: 'j2', worker_id: 'w-Saiu', status: 'in_progress', created_at: '2020-01-01T10:00:00Z', worker_checkin_at: '2020-01-10T12:00:00Z', company_checkin_confirmed_at: '2020-01-10T12:00:00Z', worker_checkout_at: '2020-01-10T20:00:00Z', company_checkout_confirmed_at: '2020-01-10T20:05:00Z', worker: worker('Saiu'), jobs: pastJob('j2') },
    ]
})

describe('Inicio da empresa com turno passado', () => {
    it('Ativos 0, Contratados 0 e grupo proprio com a linha sem presenca', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(
            <QueryClientProvider client={client}>
                <MemoryRouter initialEntries={['/company/dashboard']}>
                    <Routes><Route path="/company/dashboard" element={<CompanyDashboard />} /></Routes>
                </MemoryRouter>
            </QueryClientProvider>,
        )
        const ativos = await screen.findByText('Turnos ativos', {}, wait)
        await waitFor(() => expect(ativos.previousElementSibling?.textContent).toBe('0'), wait)
        expect(await screen.findByRole('region', { name: 'Sem registro de presença' }, wait)).toBeInTheDocument()
        expect(screen.getByText(/Sem registro de presença \(1\)/)).toBeInTheDocument()
        expect(screen.getByText('Sem')).toBeInTheDocument()
        expect(screen.getByText('Não compareceu / sem registro')).toBeInTheDocument()
        expect(screen.queryByText('Aguardando chegada')).not.toBeInTheDocument()
        expect(screen.queryByRole('region', { name: 'Contratados' })).not.toBeInTheDocument()
        expect(screen.queryByText('Saiu')).not.toBeInTheDocument()
    })
})

