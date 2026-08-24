import { describe, expect, it } from 'vitest'
import { formatHistoryDate } from './utils'

// REGRESSAO (achado navegando o produto, 23/08/2026): o card do elenco exibia
// "1 turno com você · último em Invalid Date". A funcao documentava aceitar "date-only"
// (YYYY-MM-DD), mas os DOIS chamadores reais (MemberCard e InviteToShiftModal) passam
// `jobs.start_date`, que e timestamptz. Nao havia nenhum teste deste arquivo.

describe('formatHistoryDate', () => {
  it('formata date-only sem shift de fuso (o caso que a assinatura original previa)', () => {
    expect(formatHistoryDate('2026-08-23')).toBe('23/08/2026')
  })

  it('formata timestamptz — era o caso REAL dos chamadores e produzia "Invalid Date"', () => {
    const saida = formatHistoryDate('2026-08-23T13:00:00+00:00')
    expect(saida).not.toContain('Invalid')
    expect(saida).toBe(new Date('2026-08-23T13:00:00+00:00').toLocaleDateString('pt-BR'))
  })

  it('timestamptz usa a data LOCAL de quem le, nao a data UTC', () => {
    // 24/08 02:00 UTC = 23/08 23:00 em Sao Paulo. Fatiar os 10 primeiros caracteres
    // (a correcao preguicosa) devolveria 24/08 e erraria o dia para o leitor brasileiro.
    const instante = '2026-08-24T02:00:00+00:00'
    expect(formatHistoryDate(instante)).toBe(new Date(instante).toLocaleDateString('pt-BR'))
  })

  it('entrada vazia ou impossivel de ler vira travessao, nunca "Invalid Date"', () => {
    expect(formatHistoryDate('')).toBe('—')
    expect(formatHistoryDate('   ')).toBe('—')
    expect(formatHistoryDate('nao e data')).toBe('—')
  })
})
