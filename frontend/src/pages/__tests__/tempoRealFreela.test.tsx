/** Tempo real, telas do freela e o sino: o evento atualiza a tela sem derrubar o que a pessoa fazia. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, renderHook, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactElement } from 'react'
import { emitLive } from '../../test/liveHubMock'
import { mergeMessages } from '../../lib/mergeMessages'
import { useLatestResponse } from '../../hooks/useLatestResponse'

const h = vi.hoisted(() => ({
    db: null as unknown as import('../../test/fakeDb').FakeDb,
    payments: vi.fn(),
    calls: vi.fn(),
    legacy: vi.fn(),
    stores: vi.fn(),
    receipt: vi.fn(),
    term: vi.fn(),
    toast: vi.fn(),
}))

vi.mock('../../lib/supabase', async () => {
    const { createFakeDb } = await import('../../test/fakeDb')
    h.db = createFakeDb()
    const user = { id: 'user-1' }
    const channel = () => { const c = { on: () => c, subscribe: () => c }; return c }
    return {
        supabase: {
            from: (table: string) => h.db.from(table),
            channel,
            removeChannel: () => undefined,
            auth: { getUser: () => Promise.resolve({ data: { user }, error: null }) },
        },
    }
})
vi.mock('../../lib/authSession', () => ({
    getSessionUserOrThrow: vi.fn().mockResolvedValue({ id: 'user-1' }),
    checkSession: vi.fn().mockResolvedValue({ status: 'ok', user: { id: 'user-1' } }),
}))
const auth = { user: { id: 'user-1' } }
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }))
const toast = { addToast: h.toast, removeToast: vi.fn() }
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => toast }))
vi.mock('../../services/paymentRecordService', () => ({
    PaymentRecordService: {
        listForWorkerChecked: (...a: unknown[]) => h.payments(...a),
        getReceiptChecked: (...a: unknown[]) => h.receipt(...a),
    },
}))
vi.mock('../../services/serviceTermService', () => ({ ServiceTermService: { getByShiftPayment: (...a: unknown[]) => h.term(...a) } }))
vi.mock('../../services/shiftCallService', () => ({ ShiftCallService: { listPendingForWorkerChecked: (...a: unknown[]) => h.calls(...a) } }))
vi.mock('../../services/shiftInviteService', () => ({ ShiftInviteService: { listPendingInvitesChecked: (...a: unknown[]) => h.legacy(...a) } }))
vi.mock('../../services/teamConnectionService', () => ({
    TeamConnectionService: {
        listMyStores: (...a: unknown[]) => h.stores(...a),
        listPendingConnections: vi.fn().mockResolvedValue([]),
    },
}))
vi.mock('../../services/attendanceConfirmationService', () => ({
    AttendanceConfirmationService: { getMyPendingConfirmationsChecked: vi.fn().mockResolvedValue([]) },
}))

import MeusRecebimentos from '../MeusRecebimentos'
import ReceiptView from '../ReceiptView'
import MyJobs from '../MyJobs'
import CarteiraClientes from '../CarteiraClientes'
import InviteTakeover from '../../components/InviteTakeover'
import { NotificationProvider, useNotifications } from '../../contexts/NotificationContext'

const wait = { timeout: 4000 }
const live = (table: string) => act(() => { emitLive(table) })
/** Passa do agrupamento de eventos (400 ms). */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 700)))
const at = (element: ReactElement, path = '/x', route = '/x') =>
    render(<MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={element} /></Routes></MemoryRouter>)

beforeEach(() => {
    vi.clearAllMocks()
    h.db.reset()
    sessionStorage.clear()
    h.calls.mockResolvedValue([])
    h.legacy.mockResolvedValue([])
    h.stores.mockResolvedValue([])
})

describe('recebimentos', () => {
    const payment = (id: string, title: string) => ({
        payment: { id, job_id: `job-${id}`, worker_id: 'user-1', company_id: 'company-1', amount: 150, status: 'recorded', source: 'external_pix', worker_confirmed_at: null },
        job: { id: `job-${id}`, title, location: null, start_date: null },
        company: { id: 'company-1', name: 'Doces', logo_url: null },
    })

    it('pagamento novo aparece e falha posterior não vira erro', async () => {
        h.payments.mockResolvedValue([payment('p1', 'Turno sexta')])
        at(<MeusRecebimentos />)
        await screen.findByText('Turno sexta', {}, wait)
        h.payments.mockResolvedValue([payment('p1', 'Turno sexta'), payment('p2', 'Turno sábado')])
        await live('shift_payments')
        expect(await screen.findByText('Turno sábado', {}, wait)).toBeInTheDocument()

        h.payments.mockRejectedValue(new Error('rede'))
        await live('shift_payments')
        await settle()
        expect(screen.getByText('Turno sábado')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Tentar de novo/ })).not.toBeInTheDocument()
    })
})

describe('recibo', () => {
    const receipt = (amount: number) => ({
        payment: { id: 'sp-12345678', job_id: 'job-1', worker_id: 'user-1', company_id: 'company-1', amount, status: 'recorded', source: 'external_pix', worker_confirmed_at: null, application_id: null, paid_at: '2026-11-20', created_at: '2026-11-20T10:00:00Z' },
        job: { id: 'job-1', title: 'Turno sexta', start_date: '2026-11-20', location: null },
        company: { name: 'Doces' },
        worker: { full_name: 'Ana' },
    })

    it('não recarrega enquanto a confirmação está marcada e não enviada', async () => {
        h.receipt.mockResolvedValue(receipt(150))
        h.term.mockResolvedValue({ term: null, failed: false })
        at(<ReceiptView />, '/recibo/job-1', '/recibo/:jobId')
        const box = await screen.findByRole('checkbox', {}, wait)
        fireEvent.click(box)
        h.receipt.mockResolvedValue(receipt(175))
        await live('shift_payments')
        await settle()
        expect(box).toBeChecked()
        expect(screen.queryByText(/175,00/)).not.toBeInTheDocument()

        fireEvent.click(box)
        expect((await screen.findAllByText(/175,00/, {}, wait)).length).toBeGreaterThan(0)
    })
})

describe('convite em tela cheia', () => {
    const invite = (id: string, title: string) => ({
        source: 'call', id, callId: id, jobId: `job-${id}`, expiresAt: null, disputed: false, targetsCount: 1, slots: 1,
        job: { id: `job-${id}`, title, budget: 100 },
    })

    it('convite novo aparece sem recarregar e não troca o que está sendo lido', async () => {
        at(<NotificationProvider><InviteTakeover /></NotificationProvider>)
        await settle()
        h.calls.mockResolvedValue([invite('c1', 'Garçom sexta')])
        await live('shift_call_targets')
        expect(await screen.findByRole('heading', { name: 'Garçom sexta' }, wait)).toBeInTheDocument()

        h.calls.mockResolvedValue([invite('c2', 'Bar sábado'), invite('c1', 'Garçom sexta')])
        await live('shift_call_targets')
        await settle()
        expect(screen.getByRole('heading', { name: 'Garçom sexta' })).toBeInTheDocument()
    })
})

describe('Meus Turnos', () => {
    const row = (id: string, title: string, status: string, date: string) => ({
        id, status, created_at: '2026-01-01T10:00:00Z', worker_checkin_at: null, worker_checkout_at: null,
        company_checkin_confirmed_at: null, company_checkout_confirmed_at: null,
        job: { id: `job-${id}`, title, budget: 100, start_date: date, work_start_time: '08:00', work_end_time: '12:00', location: 'Centro', company: { id: 'company-1', name: 'Doces', logo_url: null } },
    })

    it('atualiza a lista mantendo a aba que a pessoa vê', async () => {
        h.db.rows.applications = [row('a1', 'Turno marcado', 'hired', '2030-05-10')]
        at(<MyJobs />)
        await screen.findByText('Turno marcado', {}, wait)
        const tab = screen.getByRole('tab', { name: /Agendados/ })
        expect(tab).toHaveAttribute('aria-selected', 'true')

        // Sem escolha explícita, um convite novo puxaria a pessoa para a aba Convites.
        h.db.rows.applications = [row('a1', 'Turno marcado', 'hired', '2030-05-10'), row('a2', 'Turno extra', 'hired', '2030-05-11')]
        h.calls.mockResolvedValue([{
            source: 'call', id: 'c9', callId: 'c9', jobId: 'job-c9', expiresAt: null, disputed: false, targetsCount: 1, slots: 1,
            job: { id: 'job-c9', title: 'Convite novo' },
        }])
        await live('applications')
        expect(await screen.findByText('Turno extra', {}, wait)).toBeInTheDocument()
        expect(screen.getByRole('tab', { name: /Agendados/ })).toHaveAttribute('aria-selected', 'true')
    })
})

describe('minhas empresas', () => {
    const store = (id: string, name: string) => ({
        connection: { id, status: 'accepted', company_id: id, worker_id: 'user-1', accepted_at: '2026-01-01' },
        company: { id, name, logo_url: null },
    })

    it('empresa nova aparece sem esqueleto', async () => {
        h.stores.mockResolvedValue([store('1', 'Momma Doces')])
        at(<CarteiraClientes />)
        await screen.findByText('Momma Doces', {}, wait)
        h.stores.mockResolvedValue([store('1', 'Momma Doces'), store('2', 'Divino')])
        await live('team_connections')
        expect(await screen.findByText('Divino', {}, wait)).toBeInTheDocument()
        expect(screen.getByText('Momma Doces')).toBeInTheDocument()
    })
})

describe('sino', () => {
    function Titles() {
        const { notifications, erroCarga } = useNotifications()
        return <p>{erroCarga ? 'erro' : notifications.map((n) => n.title).join(',')}</p>
    }

    it('recupera pelo tempo real e mantém a lista quando a recarga falha', async () => {
        const n = (id: string) => ({ id, title: `aviso ${id}`, type: 'system', message: '', read_at: null, created_at: `2026-11-20T10:0${id}:00Z` })
        h.db.rows.notifications = [n('1')]
        render(<NotificationProvider><Titles /></NotificationProvider>)
        await screen.findByText('aviso 1', {}, wait)
        h.db.rows.notifications = [n('2'), n('1')]
        await live('notifications')
        expect(await screen.findByText('aviso 2,aviso 1', {}, wait)).toBeInTheDocument()
        h.db.failing.add('notifications')
        await live('notifications')
        await settle()
        expect(screen.getByText('aviso 2,aviso 1')).toBeInTheDocument()
    })
})

describe('ordem das respostas', () => {
    it('resposta antiga não sobrescreve a nova; falha nova não descarta a anterior', () => {
        const { result } = renderHook(() => useLatestResponse())
        const first = result.current()
        const second = result.current()
        expect(second()).toBe(true)
        expect(first()).toBe(false)
        const third = result.current()
        result.current() // quarta falha: nunca reivindica
        expect(third()).toBe(true)
    })

    it('mesclar mensagens não perde a recém-enviada nem recria a lista sem novidade', () => {
        const a = { id: 'a', createdat: '2026-01-01T10:00:00Z', content: 'a', read_at: null }
        const mine = { id: 'm', createdat: '2026-01-01T12:00:00Z', content: 'm', read_at: null }
        const current = [a, mine]
        expect(mergeMessages(current, [a])).toBe(current)
        const b = { id: 'b', createdat: '2026-01-01T11:00:00Z', content: 'b', read_at: null }
        expect(mergeMessages(current, [a, b]).map((m) => m.id)).toEqual(['a', 'b', 'm'])
    })
})
