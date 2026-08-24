import { describe, expect, it } from 'vitest'
import { rotuloDeUmDia, rotuloDeDias } from './weekdayLabels'

// REGRESSAO (achado navegando o produto, 24/08/2026): a agenda mostrava
// "SÉRIE · TODA SÁBADO". Duas telas montavam o texto com `toda ${dia}` fixo.
describe('rotuloDeUmDia — concordância de gênero', () => {
  it('domingo e sábado sao masculinos: "todo"', () => {
    expect(rotuloDeUmDia(0)).toBe('todo domingo')
    expect(rotuloDeUmDia(6)).toBe('todo sábado')
  })

  it('os outros cinco sao femininos: "toda"', () => {
    expect(rotuloDeUmDia(1)).toBe('toda segunda')
    expect(rotuloDeUmDia(2)).toBe('toda terça')
    expect(rotuloDeUmDia(3)).toBe('toda quarta')
    expect(rotuloDeUmDia(4)).toBe('toda quinta')
    expect(rotuloDeUmDia(5)).toBe('toda sexta')
  })
})

describe('rotuloDeDias — lista', () => {
  it('um dia so cai no singular, com o artigo certo', () => {
    expect(rotuloDeDias([6])).toBe('todo sábado')
    expect(rotuloDeDias([5])).toBe('toda sexta')
  })

  it('varios dias usam plural, que dispensa o artigo e resolve o genero', () => {
    // O caso que motivou tudo: sexta (fem) e sábado (masc) na mesma frase.
    expect(rotuloDeDias([5, 6])).toBe('às sextas e sábados')
    expect(rotuloDeDias([1, 3, 5])).toBe('às segundas, quartas e sextas')
  })

  it('ordena por dia da semana, nao pela ordem de clique', () => {
    expect(rotuloDeDias([6, 1, 3])).toBe('às segundas, quartas e sábados')
  })

  it('lista vazia nao inventa texto', () => {
    expect(rotuloDeDias([])).toBe('')
  })
})
