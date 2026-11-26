import { describe, it, expect } from 'vitest'
import { LEVELS, levelProgress } from './gamification'
import sql from '../../../supabase/migrations/20260710000000_worker_completion_aggregates.sql?raw'

describe('LEVELS', () => {
  it('é idêntico a worker_level_for_xp do banco', () => {
    const doBanco = [...sql.matchAll(/WHEN p_xp >= (\d+)\s+THEN (\d+)/g)]
      .map((m) => ({ level: Number(m[2]), minXp: Number(m[1]) }))
      .reverse()
    expect(LEVELS).toEqual([{ level: 1, minXp: 0 }, ...doBanco])
  })
})

describe('levelProgress', () => {
  it('475 XP no nível 3: faltam 125', () => {
    expect(levelProgress(475, 3)).toMatchObject({ dentroDoNivel: 175, tamanhoDoNivel: 300, faltam: 125 })
  })

  it('nível gravado que contradiz o XP não desenha progresso', () => {
    expect(levelProgress(475, 5)).toBeNull()
    expect(levelProgress(700, 3)).toBeNull()
  })

  it('nível máximo: barra cheia', () => {
    expect(levelProgress(9999, 10)).toMatchObject({ percent: 100, faltam: 0 })
  })
})
