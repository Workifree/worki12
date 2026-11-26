import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOutlineHighlighter } from '../highlight'

const NODE = '[data-copilot-highlight-node]'
let queue: FrameRequestCallback[] = []
let clock = 0

function frames(n = 1) {
  for (let i = 0; i < n; i++) {
    clock += 100
    const run = queue
    queue = []
    run.forEach((cb) => cb(clock))
  }
}

function target(rect = { left: 100, top: 200, width: 80, height: 40 }) {
  const el = document.createElement('button')
  document.body.appendChild(el)
  el.getBoundingClientRect = () =>
    ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) }) as DOMRect
  return el
}

let hit: Element | null = null
beforeEach(() => {
  queue = []
  clock = 0
  hit = null
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb))
  vi.stubGlobal('cancelAnimationFrame', () => { queue = [] })
  window.requestAnimationFrame = globalThis.requestAnimationFrame
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame
  document.elementFromPoint = () => hit
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('realce do copiloto', () => {
  it('acende no alvo e some um frame depois de o elemento sair do DOM', () => {
    const el = target()
    hit = el
    const h = createOutlineHighlighter()
    h.show(el)
    frames(5)
    expect(el).toHaveAttribute('data-copilot-highlight')
    expect((document.querySelector(NODE) as HTMLElement).style.opacity).toBe('1')
    el.remove()
    frames(1)
    expect(document.querySelector(NODE)).toBeNull()
  })

  it('esconde quando um overlay cobre o centro do alvo e volta ao descobrir', () => {
    const el = target()
    const modal = document.createElement('div')
    document.body.appendChild(modal)
    hit = el
    const h = createOutlineHighlighter()
    h.show(el)
    frames(5)
    hit = modal
    frames(1)
    expect((document.querySelector(NODE) as HTMLElement).style.opacity).toBe('0')
    hit = el
    frames(1)
    expect((document.querySelector(NODE) as HTMLElement).style.opacity).toBe('1')
  })

  it('não acende se já nasce coberto', () => {
    const el = target()
    hit = document.body.appendChild(document.createElement('div'))
    createOutlineHighlighter().show(el)
    frames(10)
    expect(el).not.toHaveAttribute('data-copilot-highlight')
    expect(document.querySelector(NODE)).toBeNull()
  })

  it('parar a tarefa (clear) limpa atributo, loop e nó', () => {
    vi.useFakeTimers()
    const el = target()
    hit = el
    const h = createOutlineHighlighter()
    h.show(el)
    frames(5)
    h.clear()
    expect(el).not.toHaveAttribute('data-copilot-highlight')
    expect(queue).toHaveLength(0)
    vi.advanceTimersByTime(300)
    expect(document.querySelector(NODE)).toBeNull()
    vi.useRealTimers()
  })

  it('esconde o alvo recortado por uma área de rolagem', () => {
    const scroller = document.createElement('div')
    scroller.style.overflow = 'auto'
    scroller.getBoundingClientRect = () => ({ left: 0, top: 60, right: 500, bottom: 150, width: 500, height: 90, x: 0, y: 60, toJSON: () => ({}) }) as DOMRect
    document.body.appendChild(scroller)
    const el = target({ left: 100, top: 300, width: 80, height: 40 })
    scroller.appendChild(el)
    hit = el
    createOutlineHighlighter().show(el)
    frames(10)
    expect(document.querySelector(NODE)).toBeNull()
  })

  it('sem nó órfão depois de vários ciclos', () => {
    vi.useFakeTimers()
    const h = createOutlineHighlighter()
    for (let i = 0; i < 8; i++) {
      const el = target()
      hit = el
      h.show(el)
      frames(5)
      if (i % 2) el.remove()
      else h.clear()
      expect(document.querySelectorAll(NODE).length).toBeLessThanOrEqual(1)
    }
    h.clear()
    vi.advanceTimersByTime(300)
    expect(document.querySelectorAll(NODE)).toHaveLength(0)
    vi.useRealTimers()
  })
})
