/**
 * Ponteiro virtual (seta no PC, dedo no celular) e brilho: só imagem. Não geram evento nenhum, não
 * entram na leitura enviada ao modelo e o PARAR os interrompe antes de qualquer toque de verdade.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCopilotSession } from '../session'
import { observePage } from '../observe'
import { aimPoint, createVirtualPointer, moveDuration } from '../pointer'
import { createGlowVfx } from '../vfx'
import { click, createSimulatedStack, done, fakeUI, goTo, installDomStubs, isHuman, type } from './harness'

beforeAll(installDomStubs)
beforeEach(() => {
  goTo('/company/create')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'group').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const EVENTS = ['click', 'dblclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'keydown', 'input', 'change', 'submit']

function target(label = 'Salvar') {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  document.body.appendChild(button)
  button.getBoundingClientRect = () => new DOMRect(100, 200, 120, 40)
  return button
}

describe('as duas formas do ponteiro', () => {
  it.each(['cursor', 'finger'] as const)('%s: invisível para leitor de tela e para a IA, sem receber toque', (kind) => {
    const host = document.createElement('div')
    host.setAttribute('data-copilot-ui', '')
    document.body.appendChild(host)
    const pointer = createVirtualPointer(host, { kind, timeScale: 0 })
    const root = host.querySelector('[data-copilot-pointer]')!
    expect(root.getAttribute('data-copilot-pointer')).toBe(kind)
    expect(root.hasAttribute('data-copilot-ui')).toBe(true)
    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(root.hasAttribute('inert')).toBe(true)
    expect(root.getAttribute('data-page-agent-ignore')).toBe('true')
    // Sem seta de mouse no celular; sem círculo no PC.
    expect(!!root.querySelector('svg')).toBe(kind === 'cursor')
    expect(!!root.querySelector('.wk-ptr__dot')).toBe(kind === 'finger')
    pointer.dispose()
    expect(host.querySelector('[data-copilot-pointer]')).toBeNull()
  })

  it('moveDuration é proporcional à distância, entre 420 e 950 ms', () => {
    expect(moveDuration(0)).toBe(420)
    expect(moveDuration(500)).toBe(800)
    expect(moveDuration(5000)).toBe(950)
  })

  it('alvo largo é tocado perto do começo; alvo pequeno, no centro', () => {
    expect(aimPoint(new DOMRect(100, 100, 40, 40))).toEqual({ x: 122, y: 120 }) // laboratório: 55% da largura
    expect(aimPoint(new DOMRect(100, 100, 600, 60)).x).toBe(184)
  })
})

describe('é só imagem: nenhum evento humano ou sintético', () => {
  it.each(['cursor', 'finger'] as const)('%s: mover, apertar, digitar e rolar não disparam nenhum evento', async (kind) => {
    const host = document.createElement('div')
    host.setAttribute('data-copilot-ui', '')
    document.body.appendChild(host)
    const el = target()
    const seen: string[] = []
    for (const type of EVENTS) window.addEventListener(type, (e) => seen.push(`${e.type}:${e.isTrusted}`), { capture: true })
    const pointer = createVirtualPointer(host, { kind, timeScale: 0 })
    const signal = new AbortController().signal
    await pointer.act(el, { action: 'click' }, signal)
    await pointer.act(el, { action: 'type', text: 'Garçom' }, signal)
    await pointer.act(el, { action: 'select' }, signal)
    await pointer.pointAt(el, 'Toque aqui', signal)
    await pointer.scrollHint(true, signal)
    expect(seen).toEqual([])
  })

  it('o clique de verdade só acontece DEPOIS de o ponteiro chegar (e o alvo não é tocado por ele)', async () => {
    const order: string[] = []
    const host = document.createElement('div')
    document.body.appendChild(host)
    const el = target()
    el.addEventListener('click', () => order.push('clique'))
    const pointer = createVirtualPointer(host, { kind: 'cursor', timeScale: 0.02 })
    order.push('inicio')
    await pointer.act(el, { action: 'click' }, new AbortController().signal)
    order.push('chegou')
    expect(order).toEqual(['inicio', 'chegou'])
    el.click()
    expect(order.at(-1)).toBe('clique')
  })

  it('com reduced-motion o ponteiro aparece no alvo sem animação', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const pointer = createVirtualPointer(host, { kind: 'cursor', reducedMotion: () => true })
    const t0 = performance.now()
    await pointer.act(target(), { action: 'point' }, new AbortController().signal)
    expect(performance.now() - t0).toBeLessThan(600)
    expect(host.querySelector<HTMLElement>('.wk-ptr')!.style.transform).toContain('translateX(166px')
  })

  it('PARAR no meio do movimento resolve na hora', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const pointer = createVirtualPointer(host, { kind: 'finger', timeScale: 1 })
    const abort = new AbortController()
    const t0 = performance.now()
    const run = pointer.act(target(), { action: 'click' }, abort.signal)
    setTimeout(() => abort.abort(), 60)
    await run
    expect(performance.now() - t0).toBeLessThan(500)
  })

  it('vibração só no dedo e só se o aparelho tiver', async () => {
    const vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const signal = new AbortController().signal
    await createVirtualPointer(host, { kind: 'cursor', timeScale: 0, vibrate: true }).act(target(), { action: 'click' }, signal)
    expect(vibrate).not.toHaveBeenCalled()
    await createVirtualPointer(host, { kind: 'finger', timeScale: 0, vibrate: true }).act(target(), { action: 'click' }, signal)
    expect(vibrate).toHaveBeenCalledWith(10)
    Reflect.deleteProperty(navigator, 'vibrate')
  })
})

describe('fora da leitura enviada ao modelo', () => {
  it('seta, dedo, halo, balão e brilho não aparecem na observação', async () => {
    const host = document.createElement('div')
    host.setAttribute('data-copilot-ui', '')
    document.body.appendChild(host)
    render(<main><h1>Criar turno</h1><button type="button">Publicar turno</button></main>)
    for (const kind of ['cursor', 'finger'] as const) {
      const pointer = createVirtualPointer(host, { kind, timeScale: 0 })
      await pointer.pointAt(document.querySelector('main button')!, 'Toque em Publicar turno', new AbortController().signal)
    }
    createGlowVfx(host).activate({ x: 10, y: 10 })
    const { content, elements } = observePage()
    expect(elements.size).toBe(1)
    expect(content).not.toMatch(/Toque em Publicar|copilot|wk-/i)
    expect(content).toBe('h1: Criar turno\n[0]<button risco=pede-confirmacao> Publicar turno />')
  })

  it('o brilho é decorativo: aria-hidden, inert, e liga/desliga sem tocar a página', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const glow = createGlowVfx(host, { mobile: true })
    const root = host.querySelector('.wk-glow')!
    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(root.hasAttribute('inert')).toBe(true)
    expect(root.getAttribute('data-device')).toBe('mobile')
    glow.activate({ x: 5, y: 6 })
    expect(root.getAttribute('data-on')).toBe('true')
    glow.deactivate()
    expect(root.getAttribute('data-on')).toBe('false')
    glow.dispose()
    expect(host.querySelector('.wk-glow')).toBeNull()
    expect(host.querySelector('.wk-drop')).toBeNull()
  })
})

describe('brilho: níveis e gota', () => {
  it('gota: PC = SVG com ondulação; celular e aparelho fraco = CSS sem filtro SVG; reduced-motion = nada', () => {
    const animate = vi.fn(() => ({ onfinish: null as null | (() => void) }))
    const original = Element.prototype.animate
    Element.prototype.animate = animate as unknown as typeof Element.prototype.animate
    const cores = (n: number) => Object.defineProperty(navigator, 'hardwareConcurrency', { value: n, configurable: true })
    try {
      document.body.innerHTML = '<div id="root"></div>'
      const host = document.createElement('div')
      document.body.appendChild(host)

      cores(8)
      createGlowVfx(host, { mobile: false }).drop({ x: 50, y: 50 })
      // halo de pressão (entrada + pulso), gota e 3 ondas (laboratório)
      expect(animate).toHaveBeenCalledTimes(6)
      expect(host.querySelector('.wk-bead')).not.toBeNull()
      expect(host.querySelectorAll('.wk-drop__svg circle')).toHaveLength(3)
      expect(host.querySelector('filter#wk-ripple feDisplacementMap')).not.toBeNull()
      expect(host.querySelector('.wk-ring')).toBeNull()

      // Celular: 3 ondas em CSS (como o laboratório), e nenhum filtro SVG novo.
      animate.mockClear()
      host.innerHTML = ''
      createGlowVfx(host, { mobile: true }).drop({ x: 50, y: 50 })
      expect(animate).toHaveBeenCalledTimes(6)
      expect(host.querySelectorAll('.wk-ring')).toHaveLength(3)
      expect(host.querySelector('filter, feTurbulence, feDisplacementMap, .wk-drop__svg')).toBeNull()

      // PC fraco (até 4 núcleos): cai para a gota CSS.
      animate.mockClear()
      host.innerHTML = ''
      cores(4)
      createGlowVfx(host, { mobile: false }).drop({ x: 50, y: 50 })
      expect(host.querySelectorAll('.wk-ring')).toHaveLength(3)
      expect(host.querySelector('filter, .wk-drop__svg')).toBeNull()

      animate.mockClear()
      cores(8)
      window.matchMedia = ((query: string) => ({ matches: /reduce/.test(query), addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
      createGlowVfx(host).drop({ x: 5, y: 5 })
      expect(animate).not.toHaveBeenCalled()
    } finally {
      Element.prototype.animate = original
      Reflect.deleteProperty(navigator, 'hardwareConcurrency')
      // @ts-expect-error restaura o estado sem matchMedia do jsdom
      delete window.matchMedia
    }
  })

  it('aparelho fraco (2 GB ou até 4 núcleos) usa o nível lite, estático', async () => {
    const { pickFxTier } = await import('../vfx')
    Object.defineProperty(navigator, 'deviceMemory', { value: 2, configurable: true })
    expect(pickFxTier()).toBe('lite')
    Reflect.deleteProperty(navigator, 'deviceMemory')
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 4, configurable: true })
    expect(pickFxTier()).toBe('lite')
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8, configurable: true })
    expect(pickFxTier()).toBe('full')
  })

  it('o brilho muda de nível sem mudar largura (só opacidade)', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const glow = createGlowVfx(host)
    glow.setIntensity(0.9)
    expect(host.querySelector('.wk-glow')!.getAttribute('data-level')).toBe('high')
    glow.setIntensity(0.4)
    expect(host.querySelector('.wk-glow')!.getAttribute('data-level')).toBe('low')
  })
})

describe('integração com o executor e o PARAR', () => {
  it('o ponteiro é chamado ANTES do clique e do preenchimento de verdade', async () => {
    const order: string[] = []
    const onClick = vi.fn(() => order.push('clique real'))
    const onInput = vi.fn(() => order.push('escrita real'))
    render(
      <main>
        <input aria-label="Título do turno" onInput={onInput} />
        <button type="button" onClick={onClick}>Abrir</button>
      </main>,
    )
    const stack = createSimulatedStack(({ step, find }) => (step === 0 ? type(find(/Título/), 'Garçom') : step === 1 ? click(find(/Abrir/)) : done()))
    const ui = fakeUI({
      async actOn(request) {
        order.push(`ponteiro:${request.kind}`)
      },
    })
    const session = createCopilotSession({ role: 'company', mode: 'do', ui, navigate: () => {}, llmFetch: stack.llmFetch, isHuman, stepDelaySeconds: 0 })
    await act(async () => {
      await session.run('abra e preencha')
    })
    // O botão "Abrir" pede confirmação (fakeUI recusa), então só a escrita e a ida do ponteiro ao botão contam.
    expect(order.indexOf('ponteiro:type')).toBeLessThan(order.indexOf('escrita real'))
    expect(order[0]).toBe('ponteiro:type')
  })

  it('PARAR enquanto o ponteiro caminha: o clique de verdade NÃO acontece', async () => {
    const onClick = vi.fn()
    render(<button type="button" data-copilot-risk="A" onClick={onClick} data-testid="alvo">Filtrar</button>)
    let stop = () => {}
    const stack = createSimulatedStack(({ step, find }) => (step === 0 ? click(find(/Filtrar/)) : done()))
    const ui = fakeUI({
      async actOn(_request, signal) {
        setTimeout(() => stop(), 10)
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
      },
    })
    const session = createCopilotSession({ role: 'company', mode: 'do', ui, navigate: () => {}, llmFetch: stack.llmFetch, isHuman, stepDelaySeconds: 0 })
    stop = session.stop
    let status = ''
    await act(async () => {
      status = (await session.run('veja os detalhes')).status
    })
    await new Promise((r) => setTimeout(r, 400))
    expect(status).toBe('stopped')
    expect(onClick).not.toHaveBeenCalled()
  })
})
