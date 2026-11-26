/**
 * Bloqueio de entrada enquanto a IA age: uma camada em tela cheia (abaixo do ponteiro virtual e da barra de
 * trabalho, acima da página) que engole toque, clique, rolagem e teclado de gente. O que o agente faz são
 * eventos sintéticos (`isTrusted: false`) direto no elemento alvo, que não passam pela camada.
 *
 * `document.elementFromPoint` é ajustado só enquanto a camada existe: ela é ignorada, para o page-agent
 * continuar enxergando os elementos como "no topo" e o realce continuar medindo o alvo certo.
 */
import { UI_ATTR } from './dom'

export const BLOCK_ATTR = 'data-copilot-block'

export interface InputBlock {
  on(): void
  off(): void
  readonly active: boolean
}

const HUMAN_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'touchstart', 'touchmove', 'touchend', 'wheel'] as const
const KEY_EVENTS = ['keydown', 'keypress', 'keyup', 'beforeinput'] as const

export function createInputBlock(host: HTMLElement): InputBlock {
  let layer: HTMLDivElement | null = null
  let original: typeof document.elementFromPoint | null = null
  const swallow = (event: Event) => {
    if (event.cancelable) event.preventDefault()
    event.stopPropagation()
  }
  const onKey = (event: Event) => {
    const key = event as KeyboardEvent
    if (!event.isTrusted || key.key === 'Escape') return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest(`[${UI_ATTR}]`)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  // Rede de segurança: modal (<dialog> em camada superior) fica ACIMA da camada de bloqueio, então o toque humano
  // também é barrado na captura da janela. Eventos sintéticos do agente (isTrusted=false) e a UI do copiloto passam.
  const onHuman = (event: Event) => {
    if (!event.isTrusted) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest(`[${UI_ATTR}]`)) return
    if (event.cancelable) event.preventDefault()
    event.stopImmediatePropagation()
  }

  const on = () => {
    if (layer) return
    for (const name of HUMAN_EVENTS) window.addEventListener(name, onHuman, { capture: true, passive: false })
    const node = document.createElement('div')
    node.setAttribute(BLOCK_ATTR, '')
    node.setAttribute(UI_ATTR, '')
    node.setAttribute('data-page-agent-ignore', 'true')
    node.setAttribute('aria-hidden', 'true')
    node.setAttribute('style', 'position:fixed;inset:0;z-index:0;touch-action:none;pointer-events:auto;background:transparent;overscroll-behavior:none;')
    for (const name of HUMAN_EVENTS) node.addEventListener(name, swallow, { passive: false })
    host.insertBefore(node, host.firstChild)
    layer = node
    for (const name of KEY_EVENTS) window.addEventListener(name, onKey, true)
    const hit = document.elementFromPoint
    if (typeof hit === 'function' && typeof document.elementsFromPoint === 'function') {
      original = hit
      document.elementFromPoint = (x: number, y: number) => document.elementsFromPoint(x, y).find((el) => !el.hasAttribute(BLOCK_ATTR)) ?? null
    }
    const active = document.activeElement
    if (active instanceof HTMLElement && !active.closest(`[${UI_ATTR}]`)) active.blur()
  }

  const off = () => {
    if (!layer) return
    layer.remove()
    layer = null
    for (const name of KEY_EVENTS) window.removeEventListener(name, onKey, true)
    for (const name of HUMAN_EVENTS) window.removeEventListener(name, onHuman, { capture: true })
    if (original) document.elementFromPoint = original
    original = null
  }

  return {
    on,
    off,
    get active() {
      return !!layer
    },
  }
}
