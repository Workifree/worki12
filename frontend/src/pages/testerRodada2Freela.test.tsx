/**
 * Reproduções de N-1, N-2 e D-14 (relatório do tester, rodada 2 — lado freela).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, renderHook, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InviteTakeover from '../components/InviteTakeover'
import RateModal from '../components/RateModal'
import MyJobs from './MyJobs'
import Dashboard from './Dashboard'
import { EVENTO_CONVITES } from '../hooks/useShiftInvites'
import { isOnShift } from '../lib/shiftPresence'
import { supabase } from '../lib/supabase'

const mocks = vi.hoisted(() => ({
  listPendingForWorker: vi.fn(),
  listPendingInvites: vi.fn(),
  claimSlot: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({ supabase: { auth: { getUser: vi.fn() }, from: vi.fn() } }))
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))
vi.mock('../components/PageMeta', () => ({ default: () => null }))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }))
vi.mock('../contexts/NotificationContext', () => ({ useNotifications: () => ({ notifications: [] }) }))
vi.mock('../services/shiftCallService', () => ({
  ShiftCallService: {
    listPendingForWorkerChecked: mocks.listPendingForWorker,
    claimSlot: mocks.claimSlot,
  },
}))
vi.mock('../services/shiftInviteService', () => ({
  ShiftInviteService: { listPendingInvitesChecked: mocks.listPendingInvites },
}))
vi.mock('../services/attendanceConfirmationService', () => ({
  AttendanceConfirmationService: { getMyPendingConfirmationsChecked: vi.fn().mockResolvedValue([]) },
}))
vi.mock('../hooks/useTeamConnections', () => ({
  useWorkerStores: () => ({ myStores: [], pendingConnections: [], loading: false }),
}))

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>

const PENDING = {
  source: 'call' as const,
  id: 'target-1',
  callId: 'call-1',
  jobId: 'job-new',
  expiresAt: null,
  disputed: false,
  targetsCount: 1,
  slots: 1,
  job: { id: 'job-new', title: 'Turno do convite', budget: 100, company: { name: 'Empresa X' } },
}

/** Query do PostgREST: qualquer encadeamento, resolvendo no `await`. */
function chain(result: () => unknown) {
  const obj: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'not', 'is', 'order', 'limit']) obj[method] = () => obj
  obj.single = () => Promise.resolve(result())
  obj.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
    Promise.resolve(result()).then(ok, fail)
  return obj
}

function mockTables(tables: Record<string, () => unknown>) {
  vi.mocked(supabase.from).mockImplementation(
    (table: string) =>
      chain(() => ({ data: tables[table]?.() ?? [], error: null })) as unknown as ReturnType<typeof supabase.from>,
  )
}

const NO_STAMPS = {
  worker_checkin_at: null,
  worker_checkout_at: null,
  company_checkin_confirmed_at: null,
  company_checkout_confirmed_at: null,
}
const CHECKIN = '2026-11-25T04:15:00Z'
const CHECKOUT = '2026-11-25T07:00:00Z'

function applicationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app-new',
    status: 'in_progress',
    created_at: new Date().toISOString(),
    ...NO_STAMPS,
    job: {
      id: 'job-new',
      title: 'Turno aceito agora',
      budget: 100,
      start_date: new Date().toISOString(),
      work_start_time: '01:10',
      work_end_time: '04:50',
      location: 'SP',
      company: { id: 'company-1', name: 'Empresa X', logo_url: null },
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: 'worker-1' } },
    error: null,
  } as unknown as Awaited<ReturnType<typeof supabase.auth.getUser>>)
  mocks.listPendingForWorker.mockResolvedValue([])
  mocks.listPendingInvites.mockResolvedValue([])
  mocks.claimSlot.mockResolvedValue({ outcome: 'claimed' })
})

describe('N-1 — convite na frente da avaliação; um Esc fecha um modal por vez', () => {
  it('o convite fica por cima e com o foco, e cada Esc fecha só o da frente', async () => {
    mocks.listPendingForWorker.mockResolvedValue([PENDING])
    const closeRate = vi.fn()
    render(
      <>
        <InviteTakeover />
        <RateModal isOpen onClose={closeRate} onSubmit={vi.fn()} targetName="Empresa X" title="Avaliar Empresa" />
      </>,
      { wrapper },
    )

    const invite = await screen.findByRole('dialog', { name: /turno do convite/i })
    const rateOverlay = screen.getByText('Avaliar Empresa').closest('.fixed') as HTMLElement
    await waitFor(() => expect(rateOverlay).toHaveAttribute('inert'))
    expect(invite.className).toContain('z-[75]')
    expect(rateOverlay.className).toContain('z-[70]')
    expect(invite.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /turno do convite/i })).not.toBeInTheDocument())
    expect(closeRate).not.toHaveBeenCalled()
    expect(rateOverlay).not.toHaveAttribute('inert')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeRate).toHaveBeenCalledTimes(1)
  })

  it('a ordem de abertura não muda quem está na frente', async () => {
    let resolve: (v: unknown[]) => void = () => {}
    mocks.listPendingForWorker.mockReturnValue(new Promise((r) => { resolve = r }))
    const closeRate = vi.fn()
    render(
      <>
        <RateModal isOpen onClose={closeRate} onSubmit={vi.fn()} targetName="Empresa X" title="Avaliar Empresa" />
        <InviteTakeover />
      </>,
      { wrapper },
    )
    await act(async () => resolve([PENDING]))
    await screen.findByRole('dialog', { name: /turno do convite/i })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeRate).not.toHaveBeenCalled()
  })
})

describe('N-2 — turno aceito pelo aviso aparece sem recarregar', () => {
  it('aceitar no aviso recarrega Meus Turnos e abre a aba do turno', async () => {
    let accepted = false
    mocks.listPendingForWorker.mockImplementation(async () => (accepted ? [] : [PENDING]))
    mocks.claimSlot.mockImplementation(async () => {
      accepted = true
      return { outcome: 'claimed' }
    })
    mockTables({ applications: () => (accepted ? [applicationRow()] : []) })

    render(
      <>
        <InviteTakeover />
        <MyJobs />
      </>,
      { wrapper },
    )
    const dialog = await screen.findByRole('dialog', { name: /turno do convite/i })
    await screen.findByRole('tab', { name: /Em Andamento/i })

    const acceptInDialog = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Aceitar')!
    fireEvent.click(acceptInDialog)

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Em Andamento/i })).toHaveAttribute('aria-selected', 'true'),
    )
    expect(screen.getByText('Turno aceito agora')).toBeInTheDocument()
    // Aceito, mas sem check-in: nada de "Ao vivo" (D-14).
    expect(screen.queryByText('Ao vivo')).not.toBeInTheDocument()
  })

  it('turno aceito para outro dia leva à aba Agendados', async () => {
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString()
    let rows: unknown[] = []
    mockTables({ applications: () => rows })
    render(<MyJobs />, { wrapper })
    await screen.findByRole('tab', { name: /Agendados/i })

    const base = applicationRow()
    rows = [{ ...base, status: 'hired', job: { ...base.job, start_date: nextWeek } }]
    act(() => {
      window.dispatchEvent(new CustomEvent(EVENTO_CONVITES, { detail: { jobAceito: 'job-new' } }))
    })

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Agendados/i })).toHaveAttribute('aria-selected', 'true'),
    )
  })

  it('o hook só informa jobAceito quando a resposta é um aceite que deu certo', async () => {
    const { useWorkerInvites } = await import('../hooks/useShiftInvites')
    mocks.listPendingForWorker.mockResolvedValue([PENDING])
    const details: unknown[] = []
    const listener = (e: Event) => details.push((e as CustomEvent).detail.jobAceito)
    window.addEventListener(EVENTO_CONVITES, listener)

    const { result } = renderHook(() => useWorkerInvites(), { wrapper })
    await waitFor(() => expect(result.current.pendingInvites).toHaveLength(1))
    await act(async () => {
      await result.current.respond('target-1', 'accepted')
    })
    mocks.claimSlot.mockResolvedValue({ outcome: 'not_found' })
    await waitFor(() => expect(result.current.pendingInvites).toHaveLength(1))
    await act(async () => {
      await result.current.respond('target-1', 'accepted')
    })

    window.removeEventListener(EVENTO_CONVITES, listener)
    expect(details).toEqual(['job-new', undefined])
  })
})

describe('D-14 — "no turno agora" só com chegada e sem saída', () => {
  it('isOnShift segue os carimbos', () => {
    expect(isOnShift(NO_STAMPS)).toBe(false)
    expect(isOnShift({ ...NO_STAMPS, worker_checkin_at: CHECKIN })).toBe(true)
    expect(isOnShift({ ...NO_STAMPS, company_checkin_confirmed_at: CHECKIN })).toBe(true)
    expect(isOnShift({ ...NO_STAMPS, worker_checkin_at: CHECKIN, worker_checkout_at: CHECKOUT })).toBe(false)
    expect(isOnShift({ ...NO_STAMPS, worker_checkin_at: CHECKIN, company_checkout_confirmed_at: CHECKOUT })).toBe(false)
  })

  function renderDashboard(stamps: Record<string, string>) {
    mockTables({
      workers: () => ({ id: 'worker-1', full_name: 'Freela Teste', roles: [], availability_days: null }),
      applications: () => [applicationRow(stamps)],
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <Dashboard />
      </QueryClientProvider>,
      { wrapper },
    )
  }

  it('com check-in e sem saída, o Início diz que está no turno', async () => {
    renderDashboard({ worker_checkin_at: CHECKIN })
    expect(await screen.findByText('Você está no turno agora')).toBeInTheDocument()
  })

  it('status in_progress sem check-in não afirma que está no turno', async () => {
    renderDashboard({})
    expect(await screen.findByText('Agendado')).toBeInTheDocument()
    expect(screen.getByText('Próximo turno')).toBeInTheDocument()
    expect(screen.queryByText('Você está no turno agora')).not.toBeInTheDocument()
  })

  it('com a saída confirmada, o turno deixa de ser o atual', async () => {
    renderDashboard({ worker_checkin_at: CHECKIN, company_checkout_confirmed_at: CHECKOUT })
    expect(await screen.findByText('Sem próximos turnos marcados.')).toBeInTheDocument()
    expect(screen.queryByText('Você está no turno agora')).not.toBeInTheDocument()
  })
})
