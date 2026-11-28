import { describe, it, expect } from 'vitest'
import { isNotVisibleError } from './notVisible'

describe('isNotVisibleError', () => {
  it('reconhece PGRST116, status 406 e a mensagem de 0 linhas', () => {
    expect(isNotVisibleError({ code: 'PGRST116' })).toBe(true)
    expect(isNotVisibleError({ status: 406 })).toBe(true)
    expect(isNotVisibleError({ message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' })).toBe(true)
  })
  it('falha de rede ou outro erro não conta', () => {
    expect(isNotVisibleError(new TypeError('Failed to fetch'))).toBe(false)
    expect(isNotVisibleError({ code: '42501' })).toBe(false)
    expect(isNotVisibleError(null)).toBe(false)
    expect(isNotVisibleError(undefined)).toBe(false)
  })
})
