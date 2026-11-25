import { describe, expect, it } from 'vitest'
import { matchPath } from 'react-router-dom'
import { PRIMEIROS_PASSOS, ROTEIROS, roteirosDoPapel } from './roteiros'
import { ROTAS, guiaPermitidoEm, type RotaId } from './rotas'
import { BOAS_VINDAS } from './boasVindas'
import { alvoValido, papelAlcanca, rotasPermitidas } from './api'
import { isGestorOnlyPath } from '../navigation'
import type { PapelGuia } from './tipos'

const fontes = import.meta.glob(['../../**/*.tsx', '!../../**/*.test.tsx', '!../../components/guide/**'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>
const codigo = Object.values(fontes).join('\n')
const appTsx = Object.entries(fontes).find(([arquivo]) => arquivo.endsWith('/App.tsx'))![1]

/** Mesma leitura de `lib/copilotAnchors.test.ts`. */
const declarados = new Set<string>()
for (const m of codigo.matchAll(/(?<!\[)data-copilot(?:="([^"]*)"|=\{([^}]*)\}|':\s*'([^']*)')/g)) {
  const [, literal, expressao, propriedade] = m
  if (literal ?? propriedade) declarados.add(literal ?? propriedade)
  else for (const ramo of expressao.matchAll(/[?:]\s*'([^']*)'/g)) declarados.add(ramo[1])
}

const passos = ROTEIROS.flatMap((roteiro) => roteiro.passos.map((passo) => ({ roteiro, passo })))
const PROIBIDAS = [
  '/convite/abc', '/convite-gerente/abc', '/convite-equipe/abc', '/login', '/admin',
  '/company/worker/abc', '/company/trilha',
]
const PAPEIS: PapelGuia[] = ['gestor', 'encarregado', 'freela']

describe('catálogo do guia', () => {
  it('todo alvo citado existe no código', () => {
    const faltando = passos.flatMap(({ roteiro, passo }) =>
      passo.alvos.filter((alvo) => !declarados.has(alvo)).map((alvo) => `${roteiro.id}: ${alvo}`))
    expect(faltando).toEqual([])
  })

  it('nenhuma rota da lista fechada casa com rota proibida', () => {
    for (const [id, rota] of Object.entries(ROTAS)) {
      for (const proibida of PROIBIDAS) {
        expect(matchPath({ path: rota.padrao, end: true }, proibida), `${id} x ${proibida}`).toBeNull()
        expect(rota.destino ?? '').not.toBe(proibida)
      }
      // Destino é literal, sem parâmetro e sem query (nada de ?conversation=).
      expect(rota.destino ?? '/x', id).toMatch(/^\/[a-z/-]+$/)
      if (rota.destino) expect(guiaPermitidoEm(rota.destino), id).toBe(true)
      else expect(rota.comoChegar && rota.partirDe, id).toBeTruthy()
      if (rota.partirDe) expect(ROTAS[rota.partirDe].destino, id).toBeTruthy()
    }
  })

  it('todo padrão de rota existe no App.tsx', () => {
    const caminhos = [...appTsx.matchAll(/path="([^"]+)"/g)].map((m) => m[1])
    for (const { padrao } of Object.values(ROTAS)) {
      const relativo = padrao.startsWith('/company/') ? padrao.slice('/company/'.length) : padrao.slice(1)
      expect(caminhos.includes(padrao) || caminhos.includes(relativo), padrao).toBe(true)
    }
  })

  it('cada papel só vê rotas e alvos que alcança', () => {
    for (const papel of PAPEIS) {
      for (const roteiro of roteirosDoPapel(papel)) {
        for (const passo of roteiro.passos) {
          const prefixo = papel === 'freela' ? 'freela.' : 'empresa.'
          for (const alvo of passo.alvos) expect(alvoValido(alvo, papel), `${roteiro.id}: ${alvo}`).toBe(true)
          for (const rota of [passo.rota, ...(passo.tambemEm ?? [])]) {
            expect(rota.startsWith(prefixo), `${roteiro.id}: ${rota}`).toBe(true)
            expect(papelAlcanca(papel, rota), `${roteiro.id}: ${rota}`).toBe(true)
          }
        }
      }
    }
  })

  it('o encarregado não é levado a rota exclusiva do Gestor', () => {
    for (const { id, navegavel, padrao } of rotasPermitidas('encarregado')) {
      if (navegavel) expect(isGestorOnlyPath(padrao), id as RotaId).toBe(false)
    }
  })

  it('o que a tela marca como risco D é D no catálogo, e D nunca avança sozinho', () => {
    const marcadosD = [...declarados].filter((id) => {
      const trecho = new RegExp(`data-copilot="${id.replace(/\./g, '\\.')}"\\s+data-copilot-risk="D"`)
      return trecho.test(codigo)
    })
    expect(marcadosD.length).toBeGreaterThan(5)
    for (const { roteiro, passo } of passos) {
      if (passo.alvos.some((a) => marcadosD.includes(a))) expect(passo.risco, `${roteiro.id}: ${passo.titulo}`).toBe('D')
      if (passo.risco === 'D') expect(passo.avancaAoTocar, roteiro.id).toBeFalsy()
    }
  })

  it('ids únicos, textos preenchidos e alvo sempre com explicação alternativa', () => {
    expect(new Set(ROTEIROS.map((r) => r.id)).size).toBe(ROTEIROS.length)
    for (const { roteiro, passo } of passos) {
      expect(passo.titulo && passo.explicacao && passo.aoTocar, roteiro.id).toBeTruthy()
      // O envio do formulário de turno está sempre na tela.
      if (passo.alvos.length && !passo.alvos.includes('empresa.turno-criar.enviar')) {
        expect(passo.semAlvo, `${roteiro.id}: ${passo.titulo}`).toBeTruthy()
      }
    }
  })

  it('primeiros passos existem e boas-vindas têm no máximo 3 cartões', () => {
    for (const papel of PAPEIS) {
      const ids = roteirosDoPapel(papel).map((r) => r.id)
      for (const id of PRIMEIROS_PASSOS[papel]) expect(ids).toContain(id)
      expect(BOAS_VINDAS[papel].length).toBeLessThanOrEqual(3)
    }
  })
})
