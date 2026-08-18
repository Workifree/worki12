import { describe, it, expect } from 'vitest'
import {
    localWeekStartKey,
    weeksOverThreshold,
    DEFAULT_LINK_RISK_THRESHOLD,
    type InviteSeriesTarget,
} from './seriesWeekRisk'

// R10/A7 — a única lógica de data NOVA desta feature sem cobertura antes desta rodada. É
// exatamente a classe de bug que o resto da feature (recurrence.ts, dateUtils.ts) toma cuidado
// de evitar: semana corrida (domingo-sábado) calculada em componentes LOCAIS, nunca por
// `new Date(dateStr)` (que o motor interpreta como meia-noite UTC) nem `getUTCDay()`.
describe('InviteSeriesModal — localWeekStartKey (semana corrida dom-sáb, LOCAL)', () => {
    it('domingo mapeia para si mesmo (é o início da própria semana)', () => {
        // 2026-08-16 é um domingo.
        expect(localWeekStartKey('2026-08-16')).toBe('2026-08-16')
    })

    it('qualquer dia dentro da mesma semana corrida mapeia para o domingo daquela semana', () => {
        const sunday = '2026-08-16'
        expect(localWeekStartKey('2026-08-17')).toBe(sunday) // segunda
        expect(localWeekStartKey('2026-08-19')).toBe(sunday) // quarta
        expect(localWeekStartKey('2026-08-22')).toBe(sunday) // sábado (fim da mesma semana)
    })

    it('o domingo seguinte já cai numa semana diferente', () => {
        expect(localWeekStartKey('2026-08-23')).toBe('2026-08-23')
        expect(localWeekStartKey('2026-08-23')).not.toBe(localWeekStartKey('2026-08-22'))
    })

    it('não sofre o off-by-one clássico de `new Date(dateStr)` interpretado como UTC', () => {
        // Se a implementação usasse `new Date('2026-08-16').getDay()` (meia-noite UTC), em
        // America/Sao_Paulo (UTC-3) isso resolveria para 2026-08-15 21:00 LOCAL — sábado, não
        // domingo — e o dia da semana viria errado. `localWeekStartKey` usa `parseDateOnly`
        // (componentes locais), então o domingo declarado continua sendo tratado como domingo.
        const viaNaiveUtcParse = new Date('2026-08-16').getDay()
        const viaLocalWeekStartKey = localWeekStartKey('2026-08-16') === '2026-08-16'

        // Sob TZ=America/Sao_Paulo (fixado em vitest.config.ts), a interpretação ingênua erra o
        // dia (6 = sábado) enquanto a correta acerta (chave igual à própria data = domingo).
        expect(viaNaiveUtcParse).toBe(6)
        expect(viaLocalWeekStartKey).toBe(true)
    })

    it('atravessa virada de mês/ano corretamente (última semana de dezembro)', () => {
        // 2026-12-27 é um domingo; 2027-01-02 (sábado) ainda é da mesma semana corrida.
        expect(localWeekStartKey('2026-12-27')).toBe('2026-12-27')
        expect(localWeekStartKey('2027-01-02')).toBe('2026-12-27')
    })
})

function targetsOn(...dates: string[]): InviteSeriesTarget[] {
    return dates.map((occurrenceDate, i) => ({ jobId: `job-${i}`, occurrenceDate }))
}

describe('InviteSeriesModal — weeksOverThreshold (R10/A7, aviso não-bloqueante)', () => {
    it('não sinaliza nada quando nenhuma semana ultrapassa o limite', () => {
        const targets = targetsOn('2026-08-16', '2026-08-23', '2026-08-30') // 1 por semana
        expect(weeksOverThreshold(targets, DEFAULT_LINK_RISK_THRESHOLD)).toEqual([])
    })

    it('sinaliza a semana que ultrapassa o limite, com a contagem certa', () => {
        // 3 ocorrências na semana de 16/08 (dom, seg, sáb) — acima do limite padrão de 2.
        const targets = targetsOn('2026-08-16', '2026-08-17', '2026-08-22', '2026-08-23')
        const risky = weeksOverThreshold(targets, DEFAULT_LINK_RISK_THRESHOLD)

        expect(risky).toHaveLength(1)
        expect(risky[0]).toEqual({ weekStart: '2026-08-16', count: 3 })
    })

    it('exatamente no limite NÃO sinaliza (é ">", não ">=")', () => {
        const targets = targetsOn('2026-08-16', '2026-08-17') // 2 = DEFAULT_LINK_RISK_THRESHOLD
        expect(weeksOverThreshold(targets, DEFAULT_LINK_RISK_THRESHOLD)).toEqual([])
    })

    it('sinaliza múltiplas semanas de risco, ordenadas cronologicamente', () => {
        const targets = targetsOn(
            '2026-08-30', '2026-08-31', '2026-09-01', // semana de 30/08: 3
            '2026-08-16', '2026-08-17', '2026-08-18', // semana de 16/08: 3
        )
        const risky = weeksOverThreshold(targets, DEFAULT_LINK_RISK_THRESHOLD)

        expect(risky.map((w) => w.weekStart)).toEqual(['2026-08-16', '2026-08-30'])
        expect(risky.every((w) => w.count === 3)).toBe(true)
    })
})
