import { describe, it, expect } from 'vitest'
import { applicationStep, occupancy, shiftStep } from './nextAction'

describe('occupancy', () => {
  it('distingue vazio, parcial, completo e não carregado', () => {
    expect(occupancy(2, 0)).toMatchObject({ key: 'empty', label: 'Sem freela', needsPeople: true })
    expect(occupancy(2, 1)).toMatchObject({ key: 'partial', label: 'Falta 1' })
    expect(occupancy(1, 1)).toMatchObject({ key: 'full', needsPeople: false })
    expect(occupancy(2, null)).toMatchObject({ key: 'unknown', needsPeople: false })
  })
})

describe('próximo passo', () => {
  const done = { status: 'in_progress', company_checkin_confirmed_at: 'x', company_checkout_confirmed_at: 'y' }

  it('segue chegada, saída e pagamento', () => {
    expect(applicationStep({ status: 'hired' }).kind).toBe('checkin')
    expect(applicationStep({ status: 'in_progress', company_checkin_confirmed_at: 'x' }).kind).toBe('checkout')
    expect(applicationStep(done, null).kind).toBe('pay')
  })

  it('não oferece pagamento quando o marcador não foi lido', () => {
    expect(applicationStep(done, undefined).kind).toBe('view')
  })

  it('turno sem ninguém pede chamado; o passo mais atrasado vence', () => {
    expect(shiftStep(1, [{ status: 'invited' }]).kind).toBe('call')
    expect(shiftStep(2, [{ status: 'hired' }, done]).kind).toBe('pay')
    expect(shiftStep(1, [{ status: 'completed' }]).kind).toBe('view')
  })
})
