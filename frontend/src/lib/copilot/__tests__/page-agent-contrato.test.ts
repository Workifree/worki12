/**
 * Contrato com o page-agent. O copiloto herda classes e funções internas dele (PageController,
 * clickElement, scrollVertically): um upgrade silencioso pode trocar nome, ordem ou efeito sem que o
 * TypeScript acuse. Este teste QUEBRA ALTO em qualquer mudança de versão, para alguém reler a
 * pesquisa (.harness/spec/copiloto-worki/pesquisa-page-agent.md) e as travas antes de subir.
 */
import appPackage from '../../../../package.json?raw'
import corePackage from '../../../../node_modules/@page-agent/core/package.json?raw'
import llmsPackage from '../../../../node_modules/@page-agent/llms/package.json?raw'
import controllerPackage from '../../../../node_modules/@page-agent/page-controller/package.json?raw'
import { PageAgentCore } from '@page-agent/core'
import { PageController, clickElement, scrollVertically } from '@page-agent/page-controller'
import { describe, expect, it } from 'vitest'

const PINNED = '1.12.4'
const INSTALLED: Record<string, string> = { core: corePackage, llms: llmsPackage, 'page-controller': controllerPackage }

describe('page-agent pinado', () => {
  it.each(['core', 'llms', 'page-controller'])('@page-agent/%s está na versão exata %s (sem ^ nem ~)', (name) => {
    const declared = (JSON.parse(appPackage) as { dependencies: Record<string, string> }).dependencies[`@page-agent/${name}`]
    expect(declared, 'package.json deve fixar a versão exata').toBe(PINNED)
    expect((JSON.parse(INSTALLED[name]) as { version: string }).version).toBe(PINNED)
  })

  it('o page-controller exporta o que o copiloto usa por baixo do guarda', () => {
    expect(typeof clickElement).toBe('function')
    expect(typeof scrollVertically).toBe('function')
    expect(typeof PageController).toBe('function')
  })

  it('o PageController tem cada método que o GuardedPageController sobrescreve', () => {
    const proto = PageController.prototype as unknown as Record<string, unknown>
    for (const method of [
      'updateTree', 'getBrowserState', 'getCurrentUrl', 'getLastUpdateTime', 'showMask', 'hideMask',
      'cleanUpHighlights', 'executeJavascript', 'scrollHorizontally', 'scroll', 'clickElement', 'inputText', 'selectOption',
    ]) {
      expect(typeof proto[method], `PageController.${method}`).toBe('function')
    }
  })

  it('o núcleo do agente mantém execute, stop e dispose', () => {
    const proto = PageAgentCore.prototype as unknown as Record<string, unknown>
    for (const method of ['execute', 'stop', 'dispose', 'addEventListener']) {
      expect(typeof proto[method], `PageAgentCore.${method}`).toBe('function')
    }
  })
})
