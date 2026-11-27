import { describe, it, expect } from 'vitest'
import { isChatDeniedByRls } from './shiftChat'

describe('isChatDeniedByRls', () => {
    it('reconhece a recusa da RLS', () => {
        expect(isChatDeniedByRls({ code: '42501', message: 'x' })).toBe(true)
        expect(isChatDeniedByRls({ message: 'new row violates row-level security policy for table "Conversation"' })).toBe(true)
    })

    it('falha de rede ou erro qualquer não é recusa', () => {
        expect(isChatDeniedByRls({ message: 'Failed to fetch' })).toBe(false)
        expect(isChatDeniedByRls(null)).toBe(false)
        expect(isChatDeniedByRls(new Error('boom'))).toBe(false)
    })
})
