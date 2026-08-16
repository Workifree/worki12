import { describe, it, expect, vi, afterEach } from 'vitest'
import { todayLocalDate } from '../dateUtils'

describe('todayLocalDate', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('retorna a data local no formato YYYY-MM-DD', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 16, 10, 0, 0)) // 16/ago/2026 10:00 local
    expect(todayLocalDate()).toBe('2026-08-16')
  })

  it('não sofre off-by-one perto da meia-noite local (regressão do bug de fuso)', () => {
    vi.useFakeTimers()
    // 23:30 local — se usasse toISOString() (UTC, BRT = UTC-3) já teria virado o dia seguinte.
    vi.setSystemTime(new Date(2026, 7, 16, 23, 30, 0))
    expect(todayLocalDate()).toBe('2026-08-16')
  })

  it('preenche mês e dia com zero à esquerda', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 5, 12, 0, 0)) // 05/jan/2026
    expect(todayLocalDate()).toBe('2026-01-05')
  })
})
