import { describe, expect, it } from 'vitest'

// Contrato das âncoras do copiloto (.harness/spec/copiloto-worki/mapa-de-intencoes.md, §8).
// Verificação no código-fonte: cada id é declarado uma vez, então não se repete dentro de uma tela.
const sources = import.meta.glob(['../**/*.tsx', '!../**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const FORMAT = /^(empresa|freela|publico)\.[a-z0-9-]+\.[a-z0-9-]+$/

/** Id -> nº de declarações permitido, com o motivo. */
const REPEATED: Record<string, number> = {
  // TodayShiftCard (turno de hoje) e cartão da lista em MyJobs: um turno aparece só num deles.
  'freela.turno.falar-empresa': 2,
  'freela.turnos.cancelar': 2,
}

/** Valores declarados em JSX (`data-copilot="x"` ou `={cond ? 'x' : 'y'}`) e em objetos de MenuItem. */
function declarations(source: string): { ids: string[]; templates: number } {
  const ids: string[] = []
  let templates = 0
  for (const match of source.matchAll(/(?<!\[)data-copilot(?:="([^"]*)"|=\{([^}]*)\}|':\s*'([^']*)')/g)) {
    const [, literal, expression, property] = match
    if (literal !== undefined || property !== undefined) {
      ids.push(literal ?? property)
    } else if (expression.includes('`')) {
      templates += 1
    } else {
      // Só os ramos do ternário; literais da condição (`kind === 'checkin'`) ficam de fora.
      ids.push(...Array.from(expression.matchAll(/[?:]\s*'([^']*)'/g), (m) => m[1]))
    }
  }
  return { ids, templates }
}

const found = Object.entries(sources).map(([file, source]) => ({ file, ...declarations(source) }))
const all = found.flatMap(({ file, ids }) => ids.map((id) => ({ file, id })))

describe('âncoras data-copilot', () => {
  it('existem âncoras para conferir', () => {
    expect(all.length).toBeGreaterThan(50)
  })

  it('o valor é literal (template string não é rastreável)', () => {
    expect(found.filter((f) => f.templates > 0).map((f) => f.file)).toEqual([])
  })

  it('todas seguem <papel>.<tela>.<elemento>', () => {
    expect(all.filter(({ id }) => !FORMAT.test(id))).toEqual([])
  })

  it('cada id é único na tela', () => {
    const count = new Map<string, number>()
    for (const { id } of all) count.set(id, (count.get(id) ?? 0) + 1)
    const wrong = [...count].filter(([id, n]) => n !== (REPEATED[id] ?? 1))
    expect(wrong).toEqual([])
    expect(Object.keys(REPEATED).filter((id) => !count.has(id))).toEqual([])
  })
})
