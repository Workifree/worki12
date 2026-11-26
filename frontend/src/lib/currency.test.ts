import { describe, expect, it } from 'vitest'
import { formatBRL, formatWorkedTime } from './currency'

const plain = (v: string) => v.replace(/\s/g, ' ')

describe('formatadores', () => {
    it('dinheiro sempre com milhar e centavos', () => {
        expect(plain(formatBRL(6413.68))).toBe('R$ 6.413,68')
        expect(plain(formatBRL(100))).toBe('R$ 100,00')
        expect(plain(formatBRL(null))).toBe('R$ 0,00')
    })

    it('horas: nunca "0h" nem "N/A"', () => {
        expect(formatWorkedTime(7.5)).toBe('7h 30min')
        expect(formatWorkedTime(8)).toBe('8h')
        expect(formatWorkedTime(0.75)).toBe('45min')
        expect(formatWorkedTime(1250)).toBe('1.250h')
        expect(formatWorkedTime(0)).toBe('Sem registro')
        expect(formatWorkedTime(0.001)).toBe('Sem registro')
        expect(formatWorkedTime(null, 'x')).toBe('x')
    })
})
