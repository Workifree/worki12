/** Mensagens da empresa (ADR-20261127): uma linha por freela, não lidas só do freela, vazias canceladas somem. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CompanyMessages from './CompanyMessages'
import { supabase } from '../../lib/supabase'

const mocks = vi.hoisted(() => ({
    scope: { company: { company_id: 'company-1' } as { company_id: string } | null, resolved: true, error: false },
}))

vi.mock('../../lib/supabase', () => {
    const channel: Record<string, unknown> = {}
    channel.on = () => channel
    channel.subscribe = () => channel
    channel.unsubscribe = () => {}
    channel.track = () => {}
    channel.presenceState = () => ({})
    return { supabase: { auth: { getUser: vi.fn() }, from: vi.fn(), channel: () => channel, removeChannel: () => {} } }
})
vi.mock('../../lib/logger', () => ({ logError: vi.fn() }))
vi.mock('../../lib/authSession', () => ({
    checkSession: vi.fn().mockResolvedValue({ status: 'ok', user: { id: 'enc-1' } }),
}))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }))
vi.mock('../../hooks/useCurrentCompany', () => ({ useCurrentCompanyState: () => mocks.scope }))

type Result = { data: unknown; error: unknown }

function mockTables(tables: Record<string, () => Result>) {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
        const chain: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'neq', 'in', 'not', 'is', 'order', 'limit', 'update']) chain[m] = () => chain
        chain.then = (ok: (v: Result) => unknown, fail?: (e: unknown) => unknown) =>
            Promise.resolve(tables[table]?.() ?? { data: [], error: null }).then(ok, fail)
        return chain as unknown as ReturnType<typeof supabase.from>
    })
}

const conv = (id: string, jobTitle: string, extra: { appStatus?: string; jobStatus?: string; companyId?: string; workerId?: string } = {}) => ({
    id,
    application_uuid: `app-${id}`,
    createdat: '2026-11-20T10:00:00Z',
    islocked: false,
    application: {
        id: `app-${id}`,
        status: extra.appStatus ?? 'hired',
        worker_id: extra.workerId ?? 'w-ana',
        worker: { id: extra.workerId ?? 'w-ana', full_name: 'Ana Souza' },
        job: { id: `job-${id}`, title: jobTitle, status: extra.jobStatus ?? 'open', company_id: extra.companyId ?? 'company-1' },
    },
})

const msg = (id: string, conversationid: string, senderid: string, content: string, at: string) =>
    ({ id, conversationid, senderid, content, createdat: at, read_at: null })

beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    mocks.scope = { company: { company_id: 'company-1' }, resolved: true, error: false }
})

describe('CompanyMessages — lista por freela', () => {
    it('uma linha por freela, não lidas só do freela, e vazia cancelada/apagada não aparece', async () => {
        mockTables({
            Conversation: () => ({
                data: [
                    conv('c1', 'Evento sábado'),
                    conv('c2', 'Loja centro'),
                    conv('c3', 'Turno cancelado', { appStatus: 'cancelled' }),
                    conv('c4', 'Turno apagado', { jobStatus: 'deleted' }),
                    conv('c5', 'Outra unidade', { companyId: 'company-2' }),
                ],
                error: null,
            }),
            Message: () => ({
                data: [
                    msg('m1', 'c1', 'w-ana', 'oi, posso ir', '2026-11-21T10:00:00Z'),
                    msg('m2', 'c1', 'colega-1', 'confirmado', '2026-11-21T11:00:00Z'),
                    msg('m3', 'c2', 'w-ana', 'e na loja?', '2026-11-22T10:00:00Z'),
                ],
                error: null,
            }),
        })

        render(<CompanyMessages />, { wrapper: MemoryRouter })

        expect(await screen.findByText('Conversas (1)')).toBeInTheDocument()
        const row = screen.getByRole('button', { name: /Ana Souza/ })
        expect(screen.getAllByText('Ana Souza')).toHaveLength(1)
        // 2 turnos visíveis; os 2 vazios (cancelado, apagado) e o de outra unidade ficam de fora.
        expect(within(row).getByText('2 turnos')).toBeInTheDocument()
        // m1 e m3 são do freela; m2 é de colega e não conta.
        expect(within(row).getByText('2')).toBeInTheDocument()
        expect(within(row).getByText('e na loja?')).toBeInTheDocument()
    })

    it('conversa cancelada COM mensagem continua visível', async () => {
        mockTables({
            Conversation: () => ({ data: [conv('c3', 'Turno cancelado', { appStatus: 'cancelled' })], error: null }),
            Message: () => ({ data: [msg('m1', 'c3', 'w-ana', 'preciso cancelar', '2026-11-21T10:00:00Z')], error: null }),
        })
        render(<CompanyMessages />, { wrapper: MemoryRouter })
        expect(await screen.findByText('Ana Souza')).toBeInTheDocument()
    })

    it('sem empresa corrente resolvida não consulta nada e mostra lista vazia sem erro', async () => {
        mocks.scope = { company: null, resolved: true, error: false }
        mockTables({ Conversation: () => ({ data: [conv('c1', 'Evento')], error: null }) })
        render(<CompanyMessages />, { wrapper: MemoryRouter })
        expect(await screen.findByText('Nenhuma conversa ainda.')).toBeInTheDocument()
    })
})
