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
  '<svg viewBox="0 0 22 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M3 2 L3 18 L7.4 14 L10.4 21 L13.4 19.7 L10.5 12.9 L16.5 12.6 Z" fill="#fff" stroke="#0F1720" stroke-width="1.6" stroke-linejoin="round"/>' +
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
  const x = rect.width > 260 ? rect.left + Math.min(84, rect.width / 2) : rect.left + rect.width * 0.55
  const y = rect.height > 160 ? rect.top + 44 : rect.top + rect.height / 2
  return {
    x: clamp(x, MARGIN, Math.max(MARGIN, window.innerWidth - MARGIN)),
    y: clamp(y, MARGIN, Math.max(MARGIN, window.innerHeight - MARGIN)),
  }
}

/** Proporcional à distância: 420 a 950 ms (receita da pesquisa visual). */
export function moveDuration(distance: number, finger = false): number {
  // Laboratório: cursor 300 + d (420..950); dedo 320 + 0,9·d (420..900).
  return finger ? clamp(320 + distance * 0.9, 420, 900) : clamp(300 + distance, 420, 950)
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
  let dot: HTMLElement | null = null
  if (finger) {
    dot = el('div', 'wk-ptr__dot', inner)
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
    // Laboratório: o cursor nasce em (36, 44); o dedo, embaixo no meio (50% × 90%).
    return pos ?? (finger ? { x: window.innerWidth * 0.5, y: window.innerHeight * 0.9 } : { x: 36, y: 44 })
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
    const duration = moveDuration(distance, finger) * scale
    place(from)
    if (typeof body.animate !== 'function') {
      // Sem Web Animations (testes): só espera o tempo do movimento.
      await wait(duration, signal)
      place(to)
      return
    }
    const options = (easing: string): KeyframeAnimationOptions => ({ duration, easing, fill: 'forwards' })
    const x = body.animate([{ transform: `translateX(${from.x}px)` }, { transform: `translateX(${to.x}px)` }], options('cubic-bezier(.3,.1,.1,1)'))
    const y = layerY.animate([{ transform: `translateY(${from.y}px)` }, { transform: `translateY(${to.y}px)` }], options('cubic-bezier(.5,0,.2,1)'))
    const aborted = new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
    await Promise.race([Promise.all([x.finished, y.finished]).then(() => undefined, () => undefined), aborted, wait(duration + 400)])
    // Fixa o destino e libera a animação.
    x.cancel()
    y.cancel()
    place(to)
  }

  const ripple = (at: Point) => {
    const ring = el('div', 'wk-ptr-ripple', root)
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

  /** Quem rola o alvo: o ancestral rolável mais próximo ou a janela. */
  const scrollParent = (el: HTMLElement): HTMLElement | null => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const o = getComputedStyle(n).overflowY
      if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n
    }
    return null
  }

  /** Rolagem lenta e humana (aceleração e freada suaves), sem depender do `scroll-behavior` da página. */
  const glideScroll = async (parent: HTMLElement | null, dy: number, signal: AbortSignal) => {
    const duration = clamp(500 + Math.abs(dy) * 0.5, 650, 1500) * scale
    const from = parent ? parent.scrollTop : window.scrollY
    const t0 = performance.now()
    while (!signal.aborted) {
      await frame()
      const p = clamp((performance.now() - t0) / duration, 0, 1)
      const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
      const y = from + dy * eased
      if (parent) parent.scrollTop = y
      else window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior })
      if (p >= 1) break
    }
  }

  /**
   * Traz o alvo para a área útil devagar, como uma pessoa: esconde o halo, rola com calma, e para um
   * instante "olhando" antes de seguir. Alvo já à vista: não rola.
   */
  const settleInView = async (element: HTMLElement, signal: AbortSignal) => {
    const rect = element.getBoundingClientRect()
    if (rect.top >= 72 && rect.bottom <= window.innerHeight - 96) return
    halo.classList.remove('is-on')
    say.classList.remove('is-on')
    if (instant()) {
      element.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior })
      return
    }
    const dy = rect.top + rect.height / 2 - window.innerHeight * 0.45
    await glideScroll(scrollParent(element), dy, signal)
    if (signal.aborted) return
    // Espera a posição assentar (no máximo ~500 ms) e uma pausa curta de "olhar" para o alvo.
    let last = element.getBoundingClientRect().top
    let steady = 0
    for (let i = 0; i < 30 && steady < 2 && !signal.aborted; i++) {
      await frame()
      const top = element.getBoundingClientRect().top
      steady = Math.abs(top - last) < 0.5 ? steady + 1 : 0
      last = top
    }
    await wait(320 * scale, signal)
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
        // Laboratório: o cursor aperta 90 ms depois de chegar; o dedo, 60 ms (com a ondulação 40 ms depois e o alvo cedendo 120 ms depois).
        await wait((instant() ? 160 : finger ? 150 : 200) * scale, signal)
        if (signal.aborted) return
        const motion = !instant() && typeof body.animate === 'function'
        if (motion) {
          if (finger) {
            dot?.animate?.(
              [
                { transform: 'scale(1)', background: 'rgba(15,23,32,.20)' },
                { transform: 'scale(.76)', background: 'rgba(15,23,32,.34)', offset: 0.35 },
                { transform: 'scale(.76)', background: 'rgba(15,23,32,.34)', offset: 0.6 },
                { transform: 'scale(1)', background: 'rgba(15,23,32,.20)' },
              ],
              { duration: 420, easing: 'ease-out' },
            )
            later(() => ripple(at), 40 * scale)
          } else {
            body.querySelector('svg')?.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(.84)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' })
            ripple(at)
          }
          // O alvo cede um instante ao toque (hitFx do laboratório).
          const target = element
          later(() => {
            if (target.isConnected) target.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(.965)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' })
          }, (finger ? 120 : 0) * scale)
        } else if (finger) {
          dot?.animate?.([{ opacity: 1 }, { opacity: 0.5 }, { opacity: 1 }], { duration: 300 })
          ripple(at)
        } else {
          ripple(at)
        }
        if (options.vibrate && finger) {
          try {
            navigator.vibrate?.(10)
          } catch {
            // sem vibração: segue
          }
        }
        await wait((finger ? 460 : 360) * scale, signal)
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
