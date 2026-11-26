/**
 * Ponteiro virtual: mostra o que o agente VAI fazer, antes de ele fazer.
 *
 *  - PC: uma seta que desliza até o alvo (curva suave) e "clica" com ondulação;
 *  - celular: um dedo virtual (círculo translúcido, no estilo "mostrar toques") que desliza, aperta
 *    e ondula; sem seta de mouse.
 *
 * É SÓ imagem. Nunca dispara evento, nunca recebe toque (`pointer-events: none`, `inert`,
 * `aria-hidden`) e fica dentro da raiz `data-copilot-ui`, que a leitura da tela ignora. O clique
 * de verdade continua sendo feito depois, pelo controlador guardado.
 */
import { UI_ATTR } from './dom'
import { clamp, prefersReducedMotion, wait } from './motion'

export type PointerKind = 'cursor' | 'finger'
export type PointerAction = 'click' | 'type' | 'select' | 'point'

export interface PointerRequest {
  action: PointerAction
  /** Texto que vai ser escrito (só para a pré-visualização local; nunca sai do aparelho). */
  text?: string
  /** Frase do balão ("Me mostre" e destaque). */
  say?: string
}

export interface VirtualPointer {
  readonly kind: PointerKind
  /** Move até o alvo, mostra a ação e resolve quando o clique/escrita de verdade pode acontecer. */
  act(element: HTMLElement, request: PointerRequest, signal: AbortSignal): Promise<void>
  /** Aponta e fica (modo "Me mostre" e destaque): halo no alvo e balão. */
  pointAt(element: HTMLElement, text: string | null, signal?: AbortSignal): Promise<void>
  /** Rolagem: rastro curto do dedo/seta. */
  scrollHint(down: boolean, signal: AbortSignal): Promise<void>
  hide(): void
  dispose(): void
}

export interface PointerOptions {
  kind: PointerKind
  /** 0 = sem animação nem espera (testes); 1 = tempo normal. */
  timeScale?: number
  reducedMotion?: () => boolean
  /** Vibração leve no toque do dedo virtual, onde existir. */
  vibrate?: boolean
}

const ARROW =
  '<svg viewBox="0 0 30 34" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M3 2.4 L3 24.6 L8.9 19.3 L12.9 28.6 L17.2 26.8 L13.2 17.6 L21.4 17.4 Z" fill="#2563EB" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>' +
  '</svg>'

const MARGIN = 14

function el(tag: string, className: string, parent?: HTMLElement): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  parent?.appendChild(node)
  return node
}

interface Point {
  x: number
  y: number
}

/** Ponto de toque: o centro do alvo; em alvo largo, perto do começo (onde fica o texto/ícone). */
export function aimPoint(rect: DOMRect): Point {
  const x = rect.width > 260 ? rect.left + Math.min(84, rect.width / 2) : rect.left + rect.width / 2
  const y = rect.height > 160 ? rect.top + 44 : rect.top + rect.height / 2
  return {
    x: clamp(x, MARGIN, Math.max(MARGIN, window.innerWidth - MARGIN)),
    y: clamp(y, MARGIN, Math.max(MARGIN, window.innerHeight - MARGIN)),
  }
}

/** Proporcional à distância: 420 a 950 ms (receita da pesquisa visual). */
export function moveDuration(distance: number): number {
  return clamp(300 + distance, 420, 950)
}

export function createVirtualPointer(host: HTMLElement, options: PointerOptions): VirtualPointer {
  const finger = options.kind === 'finger'
  const scale = options.timeScale ?? 1
  const reduced = () => (options.reducedMotion ?? prefersReducedMotion)()
  const instant = () => scale === 0 || reduced()

  const root = el('div', 'wk-ptr-root')
  root.setAttribute(UI_ATTR, '')
  root.setAttribute('data-copilot-pointer', options.kind)
  root.setAttribute('data-page-agent-ignore', 'true')
  root.setAttribute('aria-hidden', 'true')
  root.setAttribute('inert', '')
  host.appendChild(root)

  const halo = el('div', 'wk-ptr-halo', root)
  // X no elemento de fora e Y no de dentro, com curvas diferentes: a trajetória sai em arco, só com transform.
  const body = el('div', `wk-ptr ${finger ? 'wk-ptr--finger' : 'wk-ptr--cursor'}`, root)
  const layerY = el('div', 'wk-ptr__y', body)
  const inner = el('div', 'wk-ptr__inner', layerY)
  if (finger) {
    el('div', 'wk-ptr__dot', inner)
  } else {
    inner.innerHTML = ARROW
    const tag = el('b', 'wk-ptr__tag', inner)
    tag.textContent = 'Copiloto'
  }
  const say = el('div', 'wk-ptr-say', root)

  let pos: Point | null = null
  let visible = false
  const timers = new Set<number>()

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id)
      fn()
    }, ms)
    timers.add(id)
  }

  const place = (point: Point) => {
    pos = point
    body.style.transform = `translateX(${point.x}px)`
    layerY.style.transform = `translateY(${point.y}px)`
  }

  const show = () => {
    if (visible) return
    visible = true
    root.classList.add('is-on')
  }

  const hideAll = () => {
    visible = false
    root.classList.remove('is-on', 'is-pressed', 'is-typing')
    halo.classList.remove('is-on')
    say.classList.remove('is-on')
  }

  const start = (): Point => {
    // Sai do meio da tela: o painel (e o PARAR) ficam nos cantos e embaixo, e o ponteiro não passa por cima deles.
    return pos ?? { x: window.innerWidth / 2, y: window.innerHeight * (finger ? 0.52 : 0.45) }
  }

  /** Desliza até `to` (Web Animations, só transform). Resolve no destino ou ao abortar. */
  const glide = async (to: Point, signal: AbortSignal): Promise<void> => {
    const from = start()
    show()
    if (instant()) {
      place(to)
      return
    }
    const distance = Math.hypot(to.x - from.x, to.y - from.y)
    const duration = moveDuration(distance) * scale
    place(from)
    if (typeof body.animate !== 'function') {
      // Sem Web Animations (testes): só espera o tempo do movimento.
      await wait(duration, signal)
      place(to)
      return
    }
    const options = (easing: string): KeyframeAnimationOptions => ({ duration, easing, fill: 'forwards' })
    const x = body.animate([{ transform: `translateX(${from.x}px)` }, { transform: `translateX(${to.x}px)` }], options(finger ? 'cubic-bezier(.4,0,.2,1)' : 'cubic-bezier(.3,.1,.1,1)'))
    const y = layerY.animate([{ transform: `translateY(${from.y}px)` }, { transform: `translateY(${to.y}px)` }], options(finger ? 'cubic-bezier(.4,0,.2,1)' : 'cubic-bezier(.5,0,.2,1)'))
    const aborted = new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
    await Promise.race([Promise.all([x.finished, y.finished]).then(() => undefined, () => undefined), aborted, wait(duration + 400)])
    // Fixa o destino e libera a animação.
    x.cancel()
    y.cancel()
    place(to)
  }

  const ripple = (at: Point) => {
    const ring = el('div', `wk-ptr-ripple${finger ? ' wk-ptr-ripple--finger' : ''}`, root)
    ring.style.left = `${at.x}px`
    ring.style.top = `${at.y}px`
    later(() => ring.remove(), 650)
  }

  const haloOn = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    halo.style.left = `${rect.left - 5}px`
    halo.style.top = `${rect.top - 5}px`
    halo.style.width = `${rect.width + 10}px`
    halo.style.height = `${rect.height + 10}px`
    halo.classList.add('is-on')
  }

  const balloon = (text: string | null, around: Point, rect: DOMRect | null, typing = false) => {
    if (!text) {
      say.classList.remove('is-on')
      return
    }
    say.textContent = text.slice(0, 160)
    say.classList.toggle('is-typing', typing)
    say.classList.add('is-on')
    const width = Math.min(260, window.innerWidth - MARGIN * 2)
    say.style.maxWidth = `${width}px`
    const height = say.offsetHeight || 44
    // Abaixo do alvo; se não couber, acima.
    const below = (rect ? rect.bottom : around.y) + 18
    const top = below + height > window.innerHeight - MARGIN ? Math.max(MARGIN, (rect ? rect.top : around.y) - height - 18) : below
    say.style.top = `${top}px`
    say.style.left = `${clamp(around.x - width / 2, MARGIN, Math.max(MARGIN, window.innerWidth - width - MARGIN))}px`
  }

  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

  /** Traz o alvo para a janela SEM rolagem suave (o CSS da página pode ser `smooth`) e espera a posição assentar. */
  const settleInView = async (element: HTMLElement, signal: AbortSignal) => {
    const rect = element.getBoundingClientRect()
    if (rect.top >= 56 && rect.bottom <= window.innerHeight - 72) return
    element.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior })
    if (scale === 0) return
    // Posição estável por 2 quadros seguidos (no máximo ~500 ms): halo e ponto de toque saem do lugar certo.
    let last = element.getBoundingClientRect().top
    let steady = 0
    for (let i = 0; i < 30 && steady < 2 && !signal.aborted; i++) {
      await frame()
      const top = element.getBoundingClientRect().top
      steady = Math.abs(top - last) < 0.5 ? steady + 1 : 0
      last = top
    }
  }

  /** Digita na pré-visualização do balão, letra a letra; o campo de verdade é escrito de uma vez, depois. */
  const typePreview = async (text: string, at: Point, rect: DOMRect, signal: AbortSignal) => {
    const preview = text.slice(0, 60)
    if (instant()) {
      balloon(`${preview}`, at, rect, true)
      return
    }
    const total = clamp(preview.length * 34, 400, 1100) * scale
    const step = total / Math.max(1, preview.length)
    for (let i = 1; i <= preview.length && !signal.aborted; i++) {
      balloon(preview.slice(0, i), at, rect, true)
      await wait(step, signal)
    }
  }

  return {
    kind: options.kind,

    async act(element, request, signal) {
      if (signal.aborted || !element.isConnected) return
      await settleInView(element, signal)
      if (signal.aborted) return
      const rect = element.getBoundingClientRect()
      const at = request.action === 'type' || request.action === 'select' ? { x: clamp(rect.left + Math.min(28, rect.width / 2), MARGIN, window.innerWidth - MARGIN), y: aimPoint(rect).y } : aimPoint(rect)
      haloOn(element)
      await glide(at, signal)
      if (signal.aborted) return
      // A tela pode ter se ajeitado durante o deslize: o halo acompanha o alvo.
      haloOn(element)
      balloon(request.say ?? null, at, element.getBoundingClientRect())
      if (request.action === 'type' && request.text) {
        root.classList.add('is-typing')
        await typePreview(request.text, at, rect, signal)
        root.classList.remove('is-typing')
        if (!signal.aborted) await wait(120 * scale, signal)
      } else if (request.action === 'select') {
        await wait(320 * scale, signal)
      } else if (request.action === 'click') {
        // Pausa curta sobre o alvo, aperta, ondula; só então o clique de verdade.
        await wait((instant() ? 160 : 110) * scale, signal)
        if (signal.aborted) return
        root.classList.add('is-pressed')
        ripple(at)
        if (options.vibrate && finger) {
          try {
            navigator.vibrate?.(10)
          } catch {
            // sem vibração: segue
          }
        }
        await wait(160 * scale, signal)
        root.classList.remove('is-pressed')
      } else {
        await wait(260 * scale, signal)
      }
      if (!request.say) balloon(null, at, rect)
    },

    async pointAt(element, text, signal = new AbortController().signal) {
      if (!element.isConnected) return
      await settleInView(element, signal)
      const rect = element.getBoundingClientRect()
      const at = aimPoint(rect)
      haloOn(element)
      await glide(at, signal)
      balloon(text, at, rect)
    },

    async scrollHint(down, signal) {
      show()
      const from = { x: window.innerWidth / 2, y: window.innerHeight * (down ? 0.68 : 0.32) }
      const to = { x: from.x, y: window.innerHeight * (down ? 0.38 : 0.62) }
      pos = null
      place(from)
      pos = from
      if (instant()) return
      root.classList.add('is-pressed')
      await glide(to, signal)
      root.classList.remove('is-pressed')
    },

    hide: hideAll,

    dispose() {
      hideAll()
      timers.forEach((id) => clearTimeout(id))
      timers.clear()
      root.remove()
    },
  }
}
