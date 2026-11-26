import { afterEach, describe, expect, it } from 'vitest'
import { observePage } from './observe'
import { wantsToStop } from './session'

afterEach(() => { document.body.innerHTML = '' })

describe('botao de liga/desliga', () => {
  it('o modelo recebe o estado', () => {
    window.history.replaceState({}, '', '/profile')
    document.body.innerHTML = '<button type="button" aria-pressed="true">Seg manha</button><button type="button" aria-pressed="false">Qua manha</button>'
    const [a, b] = observePage().content.split('\n')
    expect(a).toMatch(/ marcado>/)
    expect(b).toMatch(/ desmarcado>/)
  })
})

describe('resposta que pede para parar', () => {
  it.each(['deixa pra la', 'deixa pra lá', 'pode parar', 'não sei, pode parar', 'para', 'cancela', 'esquece'])('%s', (t) => {
    expect(wantsToStop(t)).toBe(true)
  })
  it.each(['segunda e quarta de manha', 'para o turno de sexta', 'cancela o turno de sabado', 'sim'])('%s continua', (t) => {
    expect(wantsToStop(t)).toBe(false)
  })
})
