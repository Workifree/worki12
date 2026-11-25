import { describe, it, expect } from 'vitest'
import { buildRoadmap, lastTrailDay, milestoneCount, missingToMinimum, progressPercent, shortDate } from './trailView'
import type { BonusMilestone } from './types'

function ms(n: number, over: Partial<BonusMilestone> = {}): BonusMilestone {
  return {
    id: `m${n}`,
    key: `k${n}`,
    group: n <= 4 ? 'A' : 'B',
    sortOrder: n,
    title: `Marco ${n}`,
    amountCents: 1000,
    countsInTotal: true,
    earned: false,
    earnedAt: null,
    awardState: null,
    availableAt: null,
    releaseText: null,
    awardId: null,
    celebrated: true,
    progress: null,
    ...over,
  }
}

describe('buildRoadmap', () => {
  it('acende os conquistados, deixa só 3 ativos e tranca o resto', () => {
    const list = Array.from({ length: 20 }, (_, i) => ms(i + 1, i < 2 ? { earned: true } : {}))
    const view = buildRoadmap(list)
    expect(view.filter((m) => m.view === 'done')).toHaveLength(2)
    expect(view.filter((m) => m.view === 'active').map((m) => m.sortOrder)).toEqual([3, 4, 5])
    expect(view.filter((m) => m.view === 'locked')).toHaveLength(15)
  })

  it('mantém aceso um marco conquistado adiante dos ativos (A26)', () => {
    const list = Array.from({ length: 10 }, (_, i) => ms(i + 1, i === 8 ? { earned: true } : {}))
    const view = buildRoadmap(list)
    expect(view[8].view).toBe('done')
    expect(view.filter((m) => m.view === 'active').map((m) => m.sortOrder)).toEqual([1, 2, 3])
  })
})

describe('contadores', () => {
  it('deriva o total dos marcos ("2 de 19") e ignora o que não conta', () => {
    const list = [
      ...Array.from({ length: 19 }, (_, i) => ms(i + 1, i < 2 ? { earned: true } : {})),
      ms(20, { group: 'E', countsInTotal: false, earned: true }),
    ]
    expect(milestoneCount(list)).toEqual({ done: 2, total: 19 })
  })
  it('award not_counted não conta nem acende', () => {
    const list = [ms(1, { earned: true, awardState: 'not_counted' }), ms(2)]
    expect(milestoneCount(list)).toEqual({ done: 0, total: 2 })
    expect(buildRoadmap(list)[0].view).toBe('excluded')
  })
  it('usa o dia de São Paulo e trata ends_at como exclusivo', () => {
    // 22h de 24/11 em São Paulo já é 25/11 em UTC.
    expect(shortDate('2026-11-25T01:00:00+00:00')).toBe('24/11')
    expect(shortDate('2026-11-30')).toBe('30/11')
    expect(lastTrailDay('2027-02-16T03:00:00+00:00')).toBe('15/02')
  })
  it('limita o progresso e calcula o que falta para o mínimo', () => {
    expect(progressPercent(5, 3)).toBe(100)
    expect(progressPercent(1, 3)).toBe(33)
    expect(missingToMinimum(1000, 2500)).toBe(1500)
    expect(missingToMinimum(3000, 2500)).toBe(0)
  })
})
