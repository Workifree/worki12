import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useCanUseCompanyChat } from './useCanUseCompanyChat'

const getMyCompanies = vi.hoisted(() => vi.fn())

vi.mock('../lib/logger', () => ({ logError: vi.fn() }))
vi.mock('../services/companyScopeService', () => ({
    getMyCompanies,
    pickCurrentCompany: (list: unknown[]) => list[0] ?? null,
    subscribeCompanyScope: () => () => undefined,
}))

const company = (role: string) => ({ company_id: 'c1', role, confirmed: true })

describe('useCanUseCompanyChat', () => {
    it('Gestor passa a ver o atalho quando o papel resolve (antes disso, não)', async () => {
        getMyCompanies.mockResolvedValue([company('owner')])
        const { result } = renderHook(() => useCanUseCompanyChat())
        expect(result.current).toBe(false)
        await waitFor(() => expect(result.current).toBe(true))
    })

    it('Encarregado nunca vê atalho de chat', async () => {
        getMyCompanies.mockResolvedValue([company('encarregado')])
        const { result } = renderHook(() => useCanUseCompanyChat())
        await waitFor(() => expect(getMyCompanies).toHaveBeenCalled())
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(result.current).toBe(false)
    })
})
