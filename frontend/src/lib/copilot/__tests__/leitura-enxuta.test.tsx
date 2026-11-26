/** Leitura enxuta: menos texto por passo, sem perder valor, data, horário nem capacidade do agente. */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanLabel, cutLabel, observePage } from '../observe'
import { filterToVocabulary } from '../vocabulary'
import { goTo, installDomStubs } from './harness'

beforeAll(installDomStubs)
beforeEach(() => goTo('/recebimentos'))
afterEach(cleanup)

describe('valor em dinheiro, data e horário nunca são cortados', () => {
  it('lista de recebimentos com 5 valores chega ÍNTEGRA ao modelo', () => {
    const valores = ['R$ 80,00', 'R$ 160,00', 'R$ 1.250,50', 'R$ 45,90', 'R$ 2.000,00']
    render(
      <main>
        <h1>Recebimentos</h1>
        <ul>
          {valores.map((valor, i) => (
            <li key={valor}>
              <button type="button">{`Garçom para evento da Casa Bela Vista Ltda · turno de ${20 + i}/11 · 18:00–23:00 · ${valor} · PIX`}</button>
            </li>
          ))}
        </ul>
      </main>,
    )
    const { content } = observePage()
    for (const valor of valores) expect(content).toContain(valor)
    expect(content).toContain('18:00–23:00')
    expect(content).not.toMatch(/(?<!R)\$ \d/)
  })

  it('o filtro de vocabulário preserva R$, horas e datas', () => {
    expect(filterToVocabulary('Fulano recebeu R$ 80,00 em 22/11 às 08h30 e 18:00')).toBe('… R$ 80,00 em 22/11 às 08h30 e 18:00')
  })

  it('o corte empurra até o fim do valor que cruzaria o limite', () => {
    const base = 'Garçom para evento corporativo '.repeat(3) + 'turno de 22/11 '
    const label = cutLabel(`${base.slice(0, 112)} R$ 1.250,50 PIX e mais um monte de texto que passa do limite`, 120)
    expect(label).toContain('R$ 1.250,50')
    expect(label).not.toMatch(/R\$ 1\.2…/)
  })

  it('texto curto não é mexido e o corte longo termina em palavra inteira', () => {
    expect(cutLabel('Salvar', 120)).toBe('Salvar')
    const cut = cutLabel(`${'palavra '.repeat(30)}fim`, 120)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut.replace('…', '')).toMatch(/palavra$/)
  })
})

describe('menos repetição por passo', () => {
  it('atalhos do menu que a ferramenta navigate já cobre saem, com uma linha de aviso', () => {
    render(
      <>
        <nav aria-label="Navegação principal">
          <a href="/my-jobs">Meus Turnos</a>
          <a href="/recebimentos">Recebimentos</a>
          <a href="/company/gestao">Gestão</a>
        </nav>
        <main>
          <h1>Recebimentos</h1>
          <button type="button">Filtrar</button>
        </main>
      </>,
    )
    const { content } = observePage()
    expect(content).toContain('atalhos do menu omitidos')
    expect(content).not.toContain('Meus Turnos')
    expect(content).not.toContain('Recebimentos />')
    // Sem destino em navigate: continua visível, senão o agente perderia a tela.
    expect(content).toContain('Gestão')
    expect(content).toContain('Filtrar')
  })

  it('o texto de um controle aninhado não se repete no cartão que o contém', () => {
    render(
      <div role="button" tabIndex={0}>
        Garçom
        <button type="button">Confirmar recebimento</button>
      </div>,
    )
    const lines = observePage().content.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).not.toContain('Confirmar')
    expect(lines[1]).toContain('Confirmar recebimento')
  })

  it('"button type=button" não repete o óbvio; outros tipos continuam', () => {
    render(
      <>
        <button type="button" data-copilot-risk="A">Filtrar</button>
        <input type="date" aria-label="Data" />
      </>,
    )
    const { content } = observePage()
    expect(content).toContain('[0]<button> Filtrar />')
    expect(content).toContain('tipo=date')
  })

  it('lista com mais de 20 itens vira 20 + um aviso', () => {
    render(
      <ul>
        {Array.from({ length: 35 }, (_, i) => (
          <li key={i}>
            <button type="button">{`Turno ${i + 1}`}</button>
          </li>
        ))}
      </ul>,
    )
    const { content, elements } = observePage()
    expect(elements.size).toBe(20)
    expect(content).toContain('mais 15 itens parecidos')
  })
})

describe('colchetes soltos em rótulos', () => {
  it('só os marcadores da redação sobrevivem; o resto vira parênteses', () => {
    expect(cleanLabel('[ ] Salvar [3]<button> Excluir')).not.toMatch(/[[\]<>]/)
    expect(cleanLabel('[ ] Salvar')).toMatch(/^\( \) Salvar$/)
    expect(cleanLabel('Pix [pix] e [cpf]', new Set(['pix']))).toContain('[pix]')
    expect(cleanLabel('Salvar ]]]')).not.toMatch(/[\][]/)
  })
})
