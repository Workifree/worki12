import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useCompanyInvites } from './useShiftInvites'

const invite = vi.hoisted(() => vi.fn())

vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }))
vi.mock('../lib/authSession', () => ({ checkSession: vi.fn().mockResolvedValue({ status: 'ok', user: { id: 'u' } }) }))
vi.mock('../services/shiftInviteService', () => ({
    ShiftInviteService: { inviteWorkerToShift: invite, listInvitesByJob: vi.fn().mockResolvedValue([]) },
}))
vi.mock('../services/shiftCallService', () => ({ ShiftCallService: { listCallsByJob: vi.fn().mockResolvedValue([]) } }))

describe('useCompanyInvites', () => {
    it('dois cliques no mesmo instante criam um chamado só', async () => {
        let finish: (value: object) => void = () => {}
        invite.mockReturnValue(new Promise((resolve) => { finish = resolve }))
        const { result } = renderHook(() => useCompanyInvites('job-1'), { wrapper: MemoryRouter })

        let first!: Promise<boolean>
        let second!: Promise<boolean>
        act(() => {
            first = result.current.invite('w1')
            second = result.current.invite('w1')
        })
        await expect(second).resolves.toBe(false)
        await act(async () => { finish({}); await first })
        expect(invite).toHaveBeenCalledTimes(1)
    })
})
