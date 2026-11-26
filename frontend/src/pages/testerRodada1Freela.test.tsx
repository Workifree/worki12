/**
 * Reproduções dos defeitos D-4, D-5 e D-6 (relatório do tester, rodada 1 — equipe e encarregados).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, renderHook, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import MeusRecebimentos from './MeusRecebimentos'
import { computeWorkerSteps, type JobApplication } from './MyJobs'
import { useCompanyInvites, useWorkerInvites } from '../hooks/useShiftInvites'
import { checkSession } from '../lib/authSession'
import { supabase } from '../lib/supabase'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  addToast: vi.fn(),
  listForWorker: vi.fn(),
  inviteWorkerToShift: vi.fn(),
  listInvitesByJob: vi.fn(),
  listPendingInvites: vi.fn(),
  listCallsByJob: vi.fn(),
  listPendingForWorker: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({ supabase: { auth: { getUser: vi.fn() }, from: vi.fn() } }))
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.addToast }) }))
vi.mock('../services/paymentRecordService', () => ({
  PaymentRecordService: { listForWorkerChecked: mocks.listForWorker },
}))
vi.mock('../services/shiftInviteService', () => ({
  ShiftInviteService: {
    inviteWorkerToShift: mocks.inviteWorkerToShift,
    listInvitesByJob: mocks.listInvitesByJob,
    listPendingInvitesChecked: mocks.listPendingInvites,
  },
}))
vi.mock('../services/shiftCallService', () => ({
  ShiftCallService: {
    listCallsByJob: mocks.listCallsByJob,
    listPendingForWorkerChecked: mocks.listPendingForWorker,
  },
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mocks.navigate }
})

type GetUserResult = Awaited<ReturnType<typeof supabase.auth.getUser>>

const SESSION_OK = { data: { user: { id: 'user-1' } }, error: null } as unknown as GetUserResult
// O que o auth-js devolve quando o GET /auth/v1/user não sai: user nulo + erro de rede.
const OFFLINE = {
  data: { user: null },
  error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' },
} as unknown as GetUserResult
const SIGNED_OUT = {
  data: { user: null },
  error: { name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' },
} as unknown as GetUserResult

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(supabase.auth.getUser).mockResolvedValue(SESSION_OK)
  mocks.listForWorker.mockResolvedValue([])
  mocks.listInvitesByJob.mockResolvedValue([])
  mocks.listPendingInvites.mockResolvedValue([])
  mocks.listCallsByJob.mockResolvedValue([])
  mocks.listPendingForWorker.mockResolvedValue([])
  mocks.inviteWorkerToShift.mockResolvedValue({ application: null, callId: 'call-1' })
})

describe('D-4 — falha de rede não é "sem sessão"', () => {
  it('checkSession separa rede, sessão inexistente e sessão válida', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce(OFFLINE)
    expect((await checkSession()).status).toBe('unavailable')
    vi.mocked(supabase.auth.getUser).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect((await checkSession()).status).toBe('unavailable')
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce(SIGNED_OUT)
    expect((await checkSession()).status).toBe('signed_out')
    expect((await checkSession()).status).toBe('ok')
  })

  it('Recebimentos offline: mostra erro com "Tentar de novo", não vai ao /login e recupera', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue(OFFLINE)
    render(<MeusRecebimentos />, { wrapper })

    const retry = await screen.findByRole('button', { name: /tentar de novo/i })
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(screen.queryByText('Nenhum recebimento ainda')).not.toBeInTheDocument()

    vi.mocked(supabase.auth.getUser).mockResolvedValue(SESSION_OK)
    fireEvent.click(retry)
    expect(await screen.findByText('Nenhum recebimento ainda')).toBeInTheDocument()
  })

  it('Recebimentos sem sessão de verdade continua indo ao /login', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue(SIGNED_OUT)
    render(<MeusRecebimentos />, { wrapper })
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/login'))
  })

  it('useWorkerInvites offline: sinaliza erro sem redirecionar, e refresh recupera', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue(OFFLINE)
    const { result } = renderHook(() => useWorkerInvites(), { wrapper })

    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current.loading).toBe(false)
    expect(mocks.navigate).not.toHaveBeenCalled()

    vi.mocked(supabase.auth.getUser).mockResolvedValue(SESSION_OK)
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.error).toBe(false))
  })

  it('consulta que falha vira erro, nunca lista vazia', async () => {
    mocks.listPendingForWorker.mockRejectedValue(new Error('Failed to fetch'))
    const { result } = renderHook(() => useWorkerInvites(), { wrapper })
    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current.loading).toBe(false)
  })

  it('Recebimentos com a consulta falhando não diz "Nenhum recebimento ainda"', async () => {
    mocks.listForWorker.mockRejectedValue(new Error('Failed to fetch'))
    render(<MeusRecebimentos />, { wrapper })
    expect(await screen.findByRole('button', { name: /tentar de novo/i })).toBeInTheDocument()
    expect(screen.queryByText('Nenhum recebimento ainda')).not.toBeInTheDocument()
  })

  it('useWorkerInvites sem sessão redireciona', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue(SIGNED_OUT)
    renderHook(() => useWorkerInvites(), { wrapper })
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/login'))
  })
})

describe('D-5 — convite por chamado marca o freela como convidado', () => {
  it('após convidar, o freela entra em invitedWorkerIds mesmo sem linha em applications', async () => {
    const { result } = renderHook(() => useCompanyInvites('job-1'), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.invitedWorkerIds).toEqual([])

    await act(async () => {
      await result.current.invite('worker-1')
    })

    expect(result.current.invitedWorkerIds).toEqual(['worker-1'])
  })

  it('lê os alvos de chamado já gravados e ignora recusa e chamado vencido', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString()
    const past = new Date(Date.now() - 3_600_000).toISOString()
    mocks.listCallsByJob.mockResolvedValue([
      {
        status: 'open',
        expires_at: future,
        targets: [
          { worker_id: 'pendente', response: null },
          { worker_id: 'recusou', response: 'declined' },
        ],
      },
      { status: 'open', expires_at: past, targets: [{ worker_id: 'vencido', response: null }] },
    ])
    const { result } = renderHook(() => useCompanyInvites('job-1'), { wrapper })
    await waitFor(() => expect(result.current.invitedWorkerIds).toEqual(['pendente']))
  })

  it('o convidado de um turno não aparece como convidado em outro', async () => {
    const { result, rerender } = renderHook(({ id }) => useCompanyInvites(id), {
      wrapper,
      initialProps: { id: 'job-1' },
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.invite('worker-1')
    })
    rerender({ id: 'job-2' })
    await waitFor(() => expect(result.current.invitedWorkerIds).toEqual([]))
  })
})

describe('D-6 — o stepper só afirma o que tem carimbo', () => {
  const job = (stamps: Partial<JobApplication>) =>
    ({
      worker_checkin_at: null,
      worker_checkout_at: null,
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
      ...stamps,
    }) as JobApplication
  const labels = (stamps: Partial<JobApplication>) => computeWorkerSteps(job(stamps)).map((s) => s.label)

  it('sem check-in, nada diz que a chegada foi registrada', () => {
    expect(labels({})).toEqual(['Registrar chegada', 'Registrar saída', 'Confirmação da empresa'])
  })

  it('cada texto muda só com o próprio carimbo', () => {
    expect(labels({ worker_checkin_at: '2026-11-25T11:00:00Z' })).toEqual([
      'Chegada registrada',
      'Registrar saída',
      'Confirmação da empresa',
    ])
    expect(
      labels({ worker_checkin_at: '2026-11-25T11:00:00Z', worker_checkout_at: '2026-11-25T19:00:00Z' }),
    ).toEqual(['Chegada registrada', 'Saída registrada', 'Aguardando empresa'])
    expect(
      labels({
        company_checkin_confirmed_at: '2026-11-25T11:00:00Z',
        company_checkout_confirmed_at: '2026-11-25T19:00:00Z',
      }),
    ).toEqual(['Chegada registrada', 'Saída registrada', 'Empresa confirmou'])
  })
})
