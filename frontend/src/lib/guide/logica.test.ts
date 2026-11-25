import { afterEach, describe, expect, it, vi } from 'vitest'
import { buscarRoteiros, normalizar, sugestoesDaTela } from './busca'
import { escolherRoteiro, escolhedorLocal, resolverEscolha } from './escolha'
import { alvoValido, guia, prepararDestaque, rotasPermitidas } from './api'
import { posicionarBalao } from './alvo'
import { PROGRESSO_VAZIO, gravarProgresso, lerProgresso } from './progresso'

describe('busca local', () => {
  it('ignora acento, caixa e hífen', () => {
    expect(normalizar('  Check-in da SAÍDA! ')).toBe('checkin da saida')
  })

  it.each([
    ['gestor', 'como faço pra pagar o garçom?', 'empresa-pagamento'],
    ['gestor', 'abrir uma nova diária', 'empresa-criar-turno'],
    ['gestor', 'convocar gente', 'empresa-chamar-freelas'],
    ['gestor', 'quanto gastei no mês', 'empresa-relatorio'],
    ['freela', 'cadê meu dinheiro', 'freela-confirmar-recebimento'],
    ['freela', 'bater ponto', 'freela-chegada'],
    ['freela', 'nao vou poder ir', 'freela-cancelar-turno'],
  ] as const)('%s: "%s"', (papel, consulta, esperado) => {
    expect(buscarRoteiros(papel, consulta)[0]?.id).toBe(esperado)
  })

  it('sem resposta devolve vazio, e o encarregado não recebe guia do Gestor', () => {
    expect(buscarRoteiros('gestor', 'previsão do tempo em marte')).toEqual([])
    expect(buscarRoteiros('gestor', 'como faço')).toEqual([])
    expect(buscarRoteiros('encarregado', 'estorno').map((r) => r.id)).not.toContain('empresa-estornar')
  })

  it('sugere pela tela atual, inclusive rota com id', () => {
    expect(sugestoesDaTela('freela', '/recebimentos')[0].id).toBe('freela-confirmar-recebimento')
    expect(sugestoesDaTela('gestor', '/company/jobs/123/candidates').length).toBeGreaterThan(0)
  })
})

describe('escolha por IA (lista fechada)', () => {
  it('só aceita id exato do papel', async () => {
    expect(resolverEscolha('freela', 'freela-pix')?.id).toBe('freela-pix')
    for (const lixo of ['empresa-pagamento', '/convite/abc', 'FREELA-PIX', 42, null, { id: 'freela-pix' }]) {
      expect(resolverEscolha('freela', lixo)).toBeNull()
    }
    await expect(escolherRoteiro('freela', 'x', { escolher: () => Promise.reject(new Error('fora')) }))
      .resolves.toBeNull()
    await expect(escolherRoteiro('freela', 'chave pix', escolhedorLocal('freela')))
      .resolves.toMatchObject({ id: 'freela-pix' })
  })
})

describe('API pública', () => {
  it('recusa alvo fora do formato, de outro papel ou com tentativa de seletor', () => {
    expect(alvoValido('freela.perfil.sos', 'freela')).toBe(true)
    expect(alvoValido('empresa.elenco.copiar-link', 'freela')).toBe(false)
    expect(alvoValido('publico.termos.aceitar', 'gestor')).toBe(false)
    expect(alvoValido('freela.perfil.sos"], body, [x="', 'freela')).toBe(false)
  })

  it('encurta o texto vindo de fora', () => {
    const { titulo, explicacao } = prepararDestaque(`linha\n\n${'a'.repeat(500)}`)
    expect(titulo).toBe('É aqui')
    expect(explicacao).toHaveLength(280)
    expect(explicacao).not.toContain('\n')
  })

  it('sem provider tudo é recusado', () => {
    expect(guia.iniciarRoteiro('freela-pix')).toEqual({ ok: false, motivo: 'guia-indisponivel' })
    expect(guia.destacar('freela.perfil.sos', 'x')).toEqual({ ok: false, motivo: 'guia-indisponivel' })
    expect(guia.estado().disponivel).toBe(false)
    expect(rotasPermitidas('encarregado').map((r) => r.id)).not.toContain('empresa.equipe')
  })
})

describe('posição do balão', () => {
  const celular = { largura: 320, altura: 568, topoLivre: 56, baseLivre: 64 }

  it('a 320px cabe na largura e foge do alvo', () => {
    const emCima = posicionarBalao({ top: 80, bottom: 124, left: 16, width: 288 }, celular)
    expect(emCima).toMatchObject({ left: 8, width: 304, bottom: 72 })
    expect(568 - emCima.bottom! - emCima.maxHeight).toBeGreaterThanOrEqual(124)

    const embaixo = posicionarBalao({ top: 440, bottom: 484, left: 16, width: 288 }, celular)
    expect(embaixo.top).toBe(64)
    expect(embaixo.top! + embaixo.maxHeight).toBeLessThanOrEqual(440)
  })

  it('no desktop não sai pela lateral', () => {
    const p = posicionarBalao(
      { top: 100, bottom: 140, left: 1200, width: 60 },
      { largura: 1280, altura: 800, topoLivre: 0, baseLivre: 0 },
    )
    expect(p.left + p.width).toBeLessThanOrEqual(1272)
    expect(p.top).toBe(152)
  })
})

describe('progresso', () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

  it('é separado por usuário e papel e tolera lixo', () => {
    gravarProgresso('u1', 'freela', { ...PROGRESSO_VAZIO, concluidos: ['freela-pix'] })
    expect(lerProgresso('u1', 'freela').concluidos).toEqual(['freela-pix'])
    expect(lerProgresso('u2', 'freela')).toEqual(PROGRESSO_VAZIO)
    localStorage.setItem('worki:guia:v1:u3:freela', '{quebrado')
    expect(lerProgresso('u3', 'freela')).toEqual(PROGRESSO_VAZIO)
  })

  it('funciona com armazenamento bloqueado', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('cota') })
    gravarProgresso('u4', 'gestor', { ...PROGRESSO_VAZIO, boasVindasVistas: true })
    expect(lerProgresso('u4', 'gestor').boasVindasVistas).toBe(true)
  })
})
