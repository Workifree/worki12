/**
 * Reproduções de M-2, N-4 e B-1 (relatório do tester, rodada 3).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CompanyMessages from './company/CompanyMessages'
import Messages from './Messages'
import MyJobs from './MyJobs'
import { activeShiftLabel } from '../lib/shiftProgress'
import { supabase } from '../lib/supabase'

const mocks = vi.hoisted(() => ({ getMyCompanies: vi.fn(), navigate: vi.fn() }))

vi.mock('../lib/supabase', () => {
  const channel: Record<string, unknown> = {}
  channel.on = () => channel
  channel.subscribe = () => channel
  channel.unsubscribe = () => {}
  channel.track = () => {}
  channel.presenceState = () => ({})
  return {
    supabase: { auth: { getUser: vi.fn() }, from: vi.fn(), channel: () => channel, removeChannel: () => {} },
  }
})
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))
vi.mock('../components/PageMeta', () => ({ default: () => null }))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }))
vi.mock('../services/companyScopeService', () => ({ getMyCompanies: mocks.getMyCompanies }))
vi.mock('../hooks/useShiftInvites', () => ({
  EVENTO_CONVITES: 'worki:convites-mudaram',
  useWorkerInvites: () => ({ pendingInvites: [], loading: false, respondingId: null, respond: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('../services/attendanceConfirmationService', () => ({
  AttendanceConfirmationService: { getMyPendingConfirmationsChecked: vi.fn().mockResolvedValue([]) },
}))

type Result = { data: unknown; error: unknown }

function mockTables(tables: Record<string, () => Result>) {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const result = () => tables[table]?.() ?? { data: [], error: null }
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'in', 'not', 'is', 'order', 'limit', 'update']) chain[m] = () => chain
    chain.then = (ok: (v: Result) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, fail)
    return chain as unknown as ReturnType<typeof supabase.from>
  })
}

const CHECKIN = '2026-11-25T04:15:00Z'
const CHECKOUT = '2026-11-25T07:00:00Z'

function conversation(stamps: Record<string, string> = {}) {
  return {
    id: 'conv-1',
    application_uuid: 'app-1',
    createdat: CHECKIN,
    islocked: false,
    application: {
      id: 'app-1',
      status: 'in_progress',
      worker_id: 'user-1',
      ...stamps,
      worker: { id: 'worker-1', full_name: 'Worker Teste' },
      job: { id: 'job-1', title: 'Turno C', company_id: 'company-1', company: { id: 'company-1', name: 'Restaurante Teste' } },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  Element.prototype.scrollIntoView = vi.fn()
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  } as unknown as Awaited<ReturnType<typeof supabase.auth.getUser>>)
  mocks.getMyCompanies.mockResolvedValue([{ company_id: 'company-1' }])
})

describe('M-2 — Mensagens da empresa: falha não é lista vazia', () => {
  it('mostra erro com "Tentar de novo", sem "(0)", e recupera', async () => {
    let falha = true
    mockTables({
      Conversation: () => (falha ? { data: null, error: { message: 'Failed to fetch' } } : { data: [conversation()], error: null }),
    })
    render(<CompanyMessages />, { wrapper: MemoryRouter })

    const retry = await screen.findByRole('button', { name: /tentar de novo/i })
    expect(screen.queryByText('Nenhuma conversa ainda.')).not.toBeInTheDocument()
    expect(screen.queryByText('Freelas (0)')).not.toBeInTheDocument()

    falha = false
    fireEvent.click(retry)
    expect(await screen.findByText('Worker Teste')).toBeInTheDocument()
    expect(screen.getByText('Freelas (1)')).toBeInTheDocument()
  })

  it('falha ao resolver a empresa também vira erro, sem carregamento eterno', async () => {
    mocks.getMyCompanies.mockRejectedValue(new Error('Failed to fetch'))
    mockTables({})
    render(<CompanyMessages />, { wrapper: MemoryRouter })
    expect(await screen.findByRole('button', { name: /tentar de novo/i })).toBeInTheDocument()
  })
})

describe('N-4 — nome da empresa no chat do freela trunca antes do selo', () => {
  it('o botão do nome é bloco com largura limitada, numa coluna que encolhe', async () => {
    mockTables({ Conversation: () => ({ data: [conversation()], error: null }) })
    render(
      <MemoryRouter initialEntries={['/messages?conversation=conv-1']}>
        <Messages />
      </MemoryRouter>,
    )
    const name = await screen.findByRole('button', { name: /ver perfil da empresa/i })
    // jsdom não mede layout: o que se trava é a combinação que faz o `truncate` funcionar.
    expect(name).toHaveClass('block', 'max-w-full', 'truncate')
    expect(name.parentElement).toHaveClass('w-full', 'min-w-0', 'sm:flex-1')
  })
})

describe('B-1 — depois da saída, nada diz "Em Andamento"', () => {
  it('a regra do selo', () => {
    expect(activeShiftLabel({ status: 'in_progress', worker_checkin_at: CHECKIN })).toBe('Em Andamento')
    expect(activeShiftLabel({ status: 'hired' })).toBe('Contratado')
    expect(
      activeShiftLabel({ status: 'in_progress', worker_checkin_at: CHECKIN, company_checkout_confirmed_at: CHECKOUT }),
    ).toBe('Saída confirmada')
    expect(activeShiftLabel({ status: 'completed' })).toBeNull()
  })

  it.each([
    ['freela', <Messages key="w" />],
    ['empresa', <CompanyMessages key="c" />],
  ])('chat do lado %s mostra "Saída confirmada"', async (_lado, tela) => {
    mockTables({
      Conversation: () => ({
        data: [conversation({ worker_checkin_at: CHECKIN, company_checkout_confirmed_at: CHECKOUT })],
        error: null,
      }),
    })
    render(<MemoryRouter>{tela}</MemoryRouter>)
    expect(await screen.findByText('Saída confirmada')).toBeInTheDocument()
    expect(screen.queryByText('Em Andamento')).not.toBeInTheDocument()
  })

  it('Meus Turnos: saída registrada pelo freela sai de "Em Andamento" e aguarda no Histórico', async () => {
    mockTables({
      applications: () => ({
        data: [
          {
            id: 'app-1',
            status: 'in_progress',
            created_at: CHECKIN,
            worker_checkin_at: CHECKIN,
            worker_checkout_at: CHECKOUT,
            company_checkin_confirmed_at: null,
            company_checkout_confirmed_at: null,
            job: { id: 'job-1', title: 'Turno C', budget: 100, start_date: CHECKIN, company: { id: 'company-1', name: 'Empresa' } },
          },
        ],
        error: null,
      }),
    })
    render(<MyJobs />, { wrapper: MemoryRouter })

    fireEvent.click(await screen.findByRole('tab', { name: /Em Andamento/i }))
    expect(screen.getByText('Nenhum trabalho em andamento.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Histórico/i }))
    expect(screen.getByText('Turno C')).toBeInTheDocument()
    expect(screen.getByText('Aguardando confirmação')).toBeInTheDocument()
    expect(screen.queryByText('Cancelado')).not.toBeInTheDocument()
    expect(screen.getByText('Falar com a empresa')).toBeInTheDocument()
  })
})

describe('N-5 — em tela estreita o selo fica abaixo do nome', () => {
  const CONFIRMED = { worker_checkin_at: CHECKIN, company_checkout_confirmed_at: CHECKOUT }

  it.each([
    ['freela', <Messages key="w" />, 'Restaurante Teste'],
    ['empresa', <CompanyMessages key="c" />, 'Worker Teste'],
  ])('chat do lado %s empilha nome, título e selo abaixo de sm', async (_lado, tela, nome) => {
    mockTables({ Conversation: () => ({ data: [conversation(CONFIRMED)], error: null }) })
    render(<MemoryRouter initialEntries={['/chat?conversation=conv-1']}>{tela}</MemoryRouter>)

    await screen.findByRole('button', { name: /voltar para a lista de conversas/i })
    // O selo do cabeçalho (o outro "Saída confirmada" é o da lista).
    const badge = screen.getAllByText('Saída confirmada').find((el) => el.classList.contains('self-start'))!
    const column = badge.parentElement!
    // jsdom não mede layout: trava as classes que empilham no celular e voltam à linha em `sm`.
    expect(column).toHaveClass('flex-col', 'sm:flex-row', 'min-w-0')
    const identity = column.firstElementChild as HTMLElement
    expect(identity).toHaveClass('w-full', 'min-w-0')
    expect(identity).toHaveTextContent(nome)
    expect(identity).toHaveTextContent('Turno C')
  })

  it('o botão de perfil do freela tem alvo de 44px na largura da coluna', async () => {
    mockTables({ Conversation: () => ({ data: [conversation(CONFIRMED)], error: null }) })
    render(
      <MemoryRouter initialEntries={['/messages?conversation=conv-1']}>
        <Messages />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('button', { name: /ver perfil da empresa/i })).toHaveClass('w-full', 'min-h-11')
  })
})
