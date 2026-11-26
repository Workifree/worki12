import { afterEach, describe, expect, it, vi } from 'vitest'
import { BLOCK_ATTR, createInputBlock } from '../inputBlock'

const zOf = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`)
  const body = css.slice(start, css.indexOf('}', start))
  return Number(/z-index:\s*(\d+)/.exec(body)?.[1])
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('bloqueio de entrada durante a ação da IA', () => {
  it('a camada só existe ligada e some ao desligar', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const block = createInputBlock(host)
    expect(host.querySelector(`[${BLOCK_ATTR}]`)).toBeNull()
    block.on()
    const layer = host.querySelector<HTMLElement>(`[${BLOCK_ATTR}]`)!
    expect(layer.getAttribute('style')).toContain('touch-action:none')
    expect(layer.hasAttribute('data-copilot-ui')).toBe(true)
    block.off()
    expect(host.querySelector(`[${BLOCK_ATTR}]`)).toBeNull()
  })

  it('engole toque e clique de gente, mas deixa o Parar (acima da camada) e eventos sintéticos do agente', () => {
    const host = document.createElement('div')
    const page = document.createElement('button')
    const onPage = vi.fn()
    page.addEventListener('click', onPage)
    document.body.append(page, host)
    const block = createInputBlock(host)
    block.on()
    const layer = host.querySelector(`[${BLOCK_ATTR}]`)!
    const down = new Event('touchmove', { cancelable: true, bubbles: true })
    layer.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    // o agente clica direto no alvo: a camada não participa
    page.click()
    expect(onPage).toHaveBeenCalledTimes(1)
    block.off()
  })

  it('libera o elementFromPoint original ao desligar', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const before = document.elementFromPoint
    const block = createInputBlock(host)
    block.on()
    block.off()
    expect(document.elementFromPoint).toBe(before)
    expect(block.active).toBe(false)
  })

  it('ordem de camadas: brilho, gota e ponteiro acima da folha (z 1) e da camada de bloqueio (z 0)', async () => {
    const fs = await vi.importActual<{ readFileSync: (p: string, enc: 'utf8') => string }>('node:fs')
    const css = fs.readFileSync('src/components/copilot/copilot.css', 'utf8')
    expect(zOf(css, '.wk-glow')).toBeGreaterThan(1)
    expect(zOf(css, '.wk-drop')).toBeGreaterThan(1)
    expect(zOf(css, '.wk-ptr-root')).toBeGreaterThan(zOf(css, '.wk-glow'))
  })
})
