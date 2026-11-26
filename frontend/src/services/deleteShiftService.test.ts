import { describe, it, expect, vi, beforeEach } from 'vitest'
import { deleteShift } from './deleteShiftService'
import { supabase } from '../lib/supabase'
import { WalletService } from './walletService'

vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }))
vi.mock('./walletService', () => ({ WalletService: { refundEscrow: vi.fn() } }))

const rpc = vi.mocked(supabase.rpc)
const outcome = (value: string) => ({ data: { outcome: value }, error: null }) as never

function tables(apps: unknown[], escrows: unknown[]) {
  vi.mocked(supabase.from).mockImplementation((table: string) => ({
    select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: table === 'applications' ? apps : escrows, error: null }) }) }),
  }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(WalletService.refundEscrow).mockResolvedValue({ success: true })
})

describe('deleteShift (D-1: cancel_job; estorno só com escrow reservado)', () => {
  it('sem escrow: só cancel_job, nenhum estorno', async () => {
    rpc.mockResolvedValue(outcome('cancelled'))
    expect((await deleteShift('j1')).outcome).toBe('cancelled')
    expect(rpc).toHaveBeenCalledWith('cancel_job', { p_job_id: 'j1', p_reason: null })
    expect(WalletService.refundEscrow).not.toHaveBeenCalled()
  })

  it('escrow reservado: estorna uma vez e cancela de novo', async () => {
    rpc.mockResolvedValueOnce(outcome('active_escrow')).mockResolvedValueOnce(outcome('cancelled'))
    tables([{ status: 'hired' }], [{ status: 'reserved' }])
    expect((await deleteShift('j1')).outcome).toBe('cancelled')
    expect(WalletService.refundEscrow).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it.each(['authorized', 'captured'])('escrow %s não é reservado: não estorna', async (status) => {
    rpc.mockResolvedValue(outcome('active_escrow'))
    tables([], [{ status }])
    expect((await deleteShift('j1')).outcome).toBe('active_escrow')
    expect(WalletService.refundEscrow).not.toHaveBeenCalled()
  })

  it('presença iniciada: não devolve saldo de turno que não será excluído', async () => {
    rpc.mockResolvedValue(outcome('active_escrow'))
    tables([{ status: 'hired', worker_checkin_at: '2026-11-25T10:00:00Z' }], [{ status: 'reserved' }])
    expect((await deleteShift('j1')).outcome).toBe('attendance_started')
    expect(WalletService.refundEscrow).not.toHaveBeenCalled()
  })

  it('estorno falhou: mantém o turno', async () => {
    rpc.mockResolvedValue(outcome('active_escrow'))
    tables([], [{ status: 'reserved' }])
    vi.mocked(WalletService.refundEscrow).mockResolvedValue({ success: false })
    expect((await deleteShift('j1')).outcome).toBe('active_escrow')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('recusa por pagamento: nada de estorno', async () => {
    rpc.mockResolvedValue(outcome('active_payment'))
    expect((await deleteShift('j1')).outcome).toBe('active_payment')
    expect(WalletService.refundEscrow).not.toHaveBeenCalled()
  })
})
