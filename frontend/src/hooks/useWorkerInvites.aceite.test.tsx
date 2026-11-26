import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useWorkerInvites } from './useShiftInvites'

const addToast = vi.fn()
const claimSlot = vi.fn()
const isOnShift = vi.fn()

vi.mock('react-router-dom', () => {
  const navigate = vi.fn()
  return { useNavigate: () => navigate }
})
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))
vi.mock('../lib/authSession', () => ({ checkSession: async () => ({ status: 'ok', user: { id: 'w1' } }) }))
vi.mock('../contexts/ToastContext', () => {
  const toast = { addToast: (...args: unknown[]) => addToast(...args) }
  return { useToast: () => toast }
})
vi.mock('../services/shiftInviteService', () => ({
  ShiftInviteService: { listPendingInvitesChecked: async () => [] },
}))
vi.mock('../services/shiftCallService', () => ({
  ShiftCallService: {
    listPendingForWorkerChecked: async () => [{ source: 'call', id: 't1', callId: 'c1', jobId: 'j1' }],
    claimSlot: (...args: unknown[]) => claimSlot(...args),
    isOnShift: (...args: unknown[]) => isOnShift(...args),
  },
}))

async function montar() {
  const hook = renderHook(() => ({ takeover: useWorkerInvites(), pagina: useWorkerInvites() }))
  await waitFor(() => expect(hook.result.current.pagina.pendingInvites).toHaveLength(1))
  await waitFor(() => expect(hook.result.current.takeover.pendingInvites).toHaveLength(1))
  return hook
}

beforeEach(() => vi.clearAllMocks())

describe('useWorkerInvites — aceite', () => {
  it('dois cliques no mesmo instante, mesmo em instâncias diferentes, chamam a RPC uma vez', async () => {
    claimSlot.mockResolvedValue({ outcome: 'claimed' })
    const { result } = await montar()
    await act(async () => {
      await Promise.all([
        result.current.takeover.respond('t1', 'accepted'),
        result.current.takeover.respond('t1', 'accepted'),
        result.current.pagina.respond('t1', 'accepted'),
      ])
    })
    expect(claimSlot).toHaveBeenCalledTimes(1)
    expect(addToast).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ outcome: 'filled' }, true, 'Você já está neste turno.'],
    [{ outcome: 'already_responded', response: 'accepted' }, true, 'Você já está neste turno.'],
    [{ outcome: 'filled' }, false, 'Outro freela aceitou primeiro. Você continua no elenco e recebe os próximos.'],
    [{ outcome: 'filled' }, null, 'A vaga deste chamado já foi preenchida. Confira em Meus Turnos.'],
  ])('%o com a pessoa no turno = %s', async (rpc, noTurno, texto) => {
    claimSlot.mockResolvedValue(rpc)
    isOnShift.mockResolvedValue(noTurno)
    const { result } = await montar()
    await act(async () => {
      await result.current.takeover.respond('t1', 'accepted')
    })
    expect(addToast).toHaveBeenCalledWith(texto, 'info')
  })
})
