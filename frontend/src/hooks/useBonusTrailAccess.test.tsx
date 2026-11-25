import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BonusTrailApi, BonusTrailSnapshot } from '../components/bonus/types'
import { resetBonusTrailAccessCache, useBonusTrailAccess } from './useBonusTrailAccess'

const mockRpc = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { auth: {}, rpc: (...args: unknown[]) => mockRpc(...args) } }))
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))

function apiWith(status: BonusTrailSnapshot['status'] | Error) {
  const getMyTrail = vi.fn(async () => {
    if (status instanceof Error) throw status
    return { status } as BonusTrailSnapshot
  })
  return { api: { getMyTrail } as unknown as BonusTrailApi, getMyTrail }
}

describe('useBonusTrailAccess', () => {
  beforeEach(() => resetBonusTrailAccessCache())

  it('por padrão consulta em modo leve (p_light: true), sem avaliação completa', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'ok', status: 'active' }, error: null })
    const { result } = renderHook(() => useBonusTrailAccess(true))
    await waitFor(() => expect(result.current).toBe(true))
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('bonus_get_my_trail', { p_light: true })
  })

  it('só libera com inscrição ativa', async () => {
    const { api } = apiWith('active')
    const { result } = renderHook(() => useBonusTrailAccess(true, api))
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('não mostra com trilha desligada, sem inscrição ou em erro', async () => {
    for (const status of ['disabled', 'not_enrolled', 'invited', new Error('falha')] as const) {
      resetBonusTrailAccessCache()
      const { api, getMyTrail } = apiWith(status)
      const { result, unmount } = renderHook(() => useBonusTrailAccess(true, api))
      await waitFor(() => expect(getMyTrail).toHaveBeenCalled())
      expect(result.current).toBe(false)
      unmount()
    }
  })

  it('reset (aceite, saída, troca de conta) faz quem está montado consultar de novo', async () => {
    const { api, getMyTrail } = apiWith('active')
    const { result } = renderHook(() => useBonusTrailAccess(true, api))
    await waitFor(() => expect(result.current).toBe(true))
    act(() => resetBonusTrailAccessCache())
    await waitFor(() => expect(getMyTrail).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('compartilha uma única chamada entre consumidores e não consulta desabilitado', async () => {
    const { api, getMyTrail } = apiWith('active')
    renderHook(() => useBonusTrailAccess(true, api))
    const second = renderHook(() => useBonusTrailAccess(true, api))
    await waitFor(() => expect(second.result.current).toBe(true))
    expect(getMyTrail).toHaveBeenCalledTimes(1)
    resetBonusTrailAccessCache()
    const off = apiWith('active')
    renderHook(() => useBonusTrailAccess(false, off.api))
    expect(off.getMyTrail).not.toHaveBeenCalled()
  })
})
