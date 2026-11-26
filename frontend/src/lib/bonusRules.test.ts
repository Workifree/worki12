import { describe, expect, it } from 'vitest'
import {
  BONUS_CAP_REAIS,
  BONUS_RULES_INTRO,
  BONUS_RULES_MILESTONE_GROUPS,
  BONUS_RULES_SECTIONS,
} from './bonusRules'

const allText = [BONUS_RULES_INTRO, ...BONUS_RULES_SECTIONS.flatMap((s) => [s.title, ...s.paragraphs])]
  .join(' ')
  .toLowerCase()

describe('regulamento da trilha', () => {
  it('nunca chama o dinheiro de saldo, carteira ou crédito', () => {
    expect(allText).not.toMatch(/saldo|carteira|crédito|credito/)
  })

  it('traz a regra geral, o PIX de segunda com mínimo e a linha de encerramento', () => {
    expect(allText).toContain('turnos reais, com presença confirmada dos dois lados')
    expect(allText).toContain('segunda-feira')
    expect(allText).toContain('r$ 25,00')
    expect(allText).toContain('pode deixar de ser pago')
    expect(allText).toContain('encerrado')
  })

  it('não tem cláusula de estorno nem publica vetos ou limiares internos', () => {
    expect(allText).not.toMatch(/estorn|devol|cobrad|ressarc|veto|anomalia|48 ?h|limiar/)
  })

  it('os valores dos marcos somam o teto de R$ 300 (tier maior da Velocidade)', () => {
    const total = BONUS_RULES_MILESTONE_GROUPS.flatMap((g) => g.items).reduce((sum, item) => {
      const nums = [...item.reais.matchAll(/\d+/g)].map((m) => Number(m[0]))
      return sum + Math.max(...nums)
    }, 0)
    expect(total).toBe(BONUS_CAP_REAIS)
  })
})
