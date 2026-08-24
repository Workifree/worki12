import { describe, it, expect } from 'vitest'
import { periodForTime, normalizeAvailabilityGrade, isWorkerAvailableFor } from './availability'
import { parseDateOnly } from './dateUtils'
import type { AvailabilityDays } from '../types'

// F7 — DDL aprovado §3.2 exige cobrir os dois formatos reais de `work_start_time`
// ('18:00' e '20:00:00') além dos casos de A8 do spec original. LM-5: uma regex só de HH:MM
// devolveria null para metade dos turnos reais, silenciosamente.

describe('periodForTime — bucketiza HH:MM e HH:MM:SS em manha/tarde/noite', () => {
  it('aceita HH:MM:SS (formato de InviteToShiftModal.test.tsx)', () => {
    expect(periodForTime('20:00:00')).toBe('noite')
    expect(periodForTime('08:00:00')).toBe('manha')
  })

  it('aceita HH:MM (formato de ShiftCallModal.test.tsx)', () => {
    expect(periodForTime('12:00')).toBe('tarde')
    expect(periodForTime('18:00')).toBe('noite')
  })

  it('fronteiras exatas de cada período', () => {
    expect(periodForTime('05:00')).toBe('manha') // início da manhã
    expect(periodForTime('11:59')).toBe('manha')
    expect(periodForTime('12:00')).toBe('tarde') // início da tarde
    expect(periodForTime('17:59')).toBe('tarde')
    expect(periodForTime('18:00')).toBe('noite') // início da noite
    expect(periodForTime('04:59')).toBe('noite') // madrugada dobrada em noite
  })

  it('hora inválida ou fora de range devolve null, nunca lança', () => {
    expect(periodForTime('99:00')).toBeNull()
    expect(periodForTime('12:99')).toBeNull()
    expect(periodForTime('abc')).toBeNull()
    expect(periodForTime('')).toBeNull()
    expect(periodForTime(null)).toBeNull()
    expect(periodForTime(undefined)).toBeNull()
    expect(periodForTime('-1:00')).toBeNull()
  })
})

// LM-8 — só pode existir UMA representação de "vazio": null, nunca {}. O CHECK do banco rejeita
// o JSON null literal; cabe ao client podar chaves vazias e gravar SQL NULL.
describe('normalizeAvailabilityGrade — poda de chaves vazias (LM-8) e domínio válido', () => {
  it('grade vazia ({}) normaliza para null', () => {
    expect(normalizeAvailabilityGrade({})).toBeNull()
  })

  it('null/undefined normaliza para null', () => {
    expect(normalizeAvailabilityGrade(null)).toBeNull()
    expect(normalizeAvailabilityGrade(undefined)).toBeNull()
  })

  it('poda dias com array vazio, mantendo só os dias com período declarado', () => {
    const grade = { '0': [], '2': ['manha'] } as unknown as AvailabilityDays
    expect(normalizeAvailabilityGrade(grade)).toEqual({ '2': ['manha'] })
  })

  it('se a poda esvaziar tudo, devolve null (não {})', () => {
    const grade = { '0': [], '1': [] } as unknown as AvailabilityDays
    expect(normalizeAvailabilityGrade(grade)).toBeNull()
  })

  it('remove duplicata dentro do mesmo dia e recorta em 3 (mesmo teto do CHECK)', () => {
    const grade = { '3': ['manha', 'manha', 'manha', 'tarde'] } as unknown as AvailabilityDays
    const result = normalizeAvailabilityGrade(grade)
    expect(result?.['3']).toEqual(['manha', 'tarde'])
  })

  it('descarta chave fora do domínio 0..6 e período fora do enum', () => {
    const grade = { '9': ['manha'], '2': ['madrugada', 'manha'] } as unknown as AvailabilityDays
    expect(normalizeAvailabilityGrade(grade)).toEqual({ '2': ['manha'] })
  })
})

// Casamento dia-da-semana usa `parseDateOnly` (o projeto tem cicatriz documentada de off-by-one
// com `new Date(iso)` cru perto da meia-noite em BRT) — aqui provamos que o weekday derivado da
// mesma forma que o resto do app (getWeekdayIndex faria) bate com o que a grade espera.
describe('isWorkerAvailableFor — casamento dia-da-semana (convenção 0=domingo)', () => {
  const grade: AvailabilityDays = { '0': ['manha'], '3': ['tarde', 'noite'] }

  it('bate quando dia+período estão declarados', () => {
    // 2026-08-16 é um domingo (mesma data usada em seriesWeekRisk.test.ts)
    const weekday = parseDateOnly('2026-08-16').getDay()
    expect(weekday).toBe(0)
    expect(isWorkerAvailableFor(grade, weekday, 'manha')).toBe(true)
  })

  it('não bate quando o período não foi declarado para aquele dia', () => {
    const weekday = parseDateOnly('2026-08-16').getDay()
    expect(isWorkerAvailableFor(grade, weekday, 'noite')).toBe(false)
  })

  it('dia não declarado (chave ausente) é sempre false, nunca "indisponível" explícito', () => {
    const weekday = parseDateOnly('2026-08-19').getDay() // quarta, ausente da grade
    expect(isWorkerAvailableFor(grade, weekday, 'manha')).toBe(false)
  })

  it('period null (horário do turno não resolvido) é sempre false', () => {
    const weekday = parseDateOnly('2026-08-16').getDay()
    expect(isWorkerAvailableFor(grade, weekday, null)).toBe(false)
  })

  it('grade null/undefined (nunca declarou) é sempre false', () => {
    expect(isWorkerAvailableFor(null, 0, 'manha')).toBe(false)
    expect(isWorkerAvailableFor(undefined, 0, 'manha')).toBe(false)
  })

  it('weekday fora do range 0..6 é sempre false, nunca lança', () => {
    expect(isWorkerAvailableFor(grade, 7, 'manha')).toBe(false)
    expect(isWorkerAvailableFor(grade, -1, 'manha')).toBe(false)
  })
})
