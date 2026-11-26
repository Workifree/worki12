/**
 * Efeitos de "a IA está usando a tela": brilho na borda e "gota" ao abrir. ISOLADO de propósito:
 * quem quiser trocar o visual troca só este módulo e `copilot.css`; o resto do copiloto só conhece
 * a interface `Vfx`. Receita e medições: .harness/spec/copiloto-worki/pesquisa-visual-agentico.md.
 *
 * Gota: PC = SVG (ondas em círculo + ondulação do conteúdo por feDisplacementMap, só em rajada de 1,1 s);
 * celular, aparelho fraco (`lite`) e movimento reduzido = CSS puro (3 ondas, sem filtro SVG) ou nada.
 *
 * Regras (cumpridas aqui): ocioso = zero custo (nada animado, nenhum rAF); só `transform` e
 * `opacity` animam, tudo por CSS/WAAPI no compositor; `pointer-events: none`, `aria-hidden`, `inert`,
 * dentro da raiz `data-copilot-ui`; quieto com `prefers-reduced-motion`; pausa com a aba oculta; nível
 * "lite" (estático) em aparelho fraco.
 */
import { UI_ATTR } from '../dom'
import { prefersReducedMotion } from '../motion'

export interface VfxOrigin {
  x: number
  y: number
}

export type VfxLevel = 'low' | 'med' | 'high'

export interface Vfx {
  /** Liga o brilho (agente trabalhando). */
  activate(origin?: VfxOrigin): void
  deactivate(): void
  /** "Gota" ao abrir: ondas a partir do ponto de origem (botão ou atalho que abriu). */
  drop(origin?: VfxOrigin): void
  setLevel(level: VfxLevel): void
  /** 0 a 1 (atalho para `setLevel`). */
  setIntensity(level: number): void
  dispose(): void
}

export interface VfxOptions {
  /** Celular: ondas em CSS (sem filtro SVG). */
  mobile?: boolean
}

/**
 * 'full' | 'lite'. Igual ao laboratório: efeito completo em qualquer aparelho. Só a economia de dados
 * explícita (saveData) pede o brilho estático; movimento reduzido já é tratado à parte.
 */
export function pickFxTier(): 'full' | 'lite' {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } }
  return nav.connection?.saveData ? 'lite' : 'full'
}

const html = () => document.documentElement

export function createGlowVfx(host: HTMLElement, options: VfxOptions = {}): Vfx {
  const mobile = !!options.mobile
  const root = document.createElement('div')
  root.className = 'wk-glow'
  root.setAttribute('data-on', 'false')
  root.setAttribute('data-level', mobile ? 'high' : 'med')
  root.setAttribute('data-device', mobile ? 'mobile' : 'desktop')
  for (const [name, value] of [[UI_ATTR, ''], ['data-copilot-vfx', 'glow'], ['data-page-agent-ignore', 'true'], ['aria-hidden', 'true'], ['inert', '']]) {
    root.setAttribute(name, value)
  }
  root.innerHTML = '<i class="wk-glow__halo"><i class="wk-glow__sweep"></i></i>'
  host.insertBefore(root, host.firstChild)

  const dropLayer = document.createElement('div')
  dropLayer.className = 'wk-drop'
  for (const [name, value] of [[UI_ATTR, ''], ['data-page-agent-ignore', 'true'], ['aria-hidden', 'true'], ['inert', '']]) {
    dropLayer.setAttribute(name, value)
  }
  host.insertBefore(dropLayer, root.nextSibling)

  const SVG = 'http://www.w3.org/2000/svg'
  /** Filtro de ondulação (PC): criado sob demanda, uma vez. `scale` segue sin(πp)·(1−0,4p)·12 (pico ≈ 9,6) por SMIL, sem JS por quadro. */
  let ripple: { filter: SVGSVGElement; animate: SVGAnimateElement } | null = null
  const ensureRipple = () => {
    if (ripple) return ripple
    const svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('focusable', 'false')
    svg.setAttribute(UI_ATTR, '')
    svg.style.position = 'absolute'
    svg.innerHTML =
      '<filter id="wk-ripple" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.011 0.016" numOctaves="1" seed="7" result="n"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="n" scale="0" xChannelSelector="R" yChannelSelector="G">' +
      '<animate attributeName="scale" values="0;3.56;6.49;8.54;9.59;9.60;8.67;6.99;4.80;2.37;0" keyTimes="0;.1;.2;.3;.4;.5;.6;.7;.8;.9;1" dur="1.1s" begin="indefinite" fill="remove"/>' +
      '</feDisplacementMap></filter>'
    host.appendChild(svg)
    ripple = { filter: svg, animate: svg.querySelector('animate') as SVGAnimateElement }
    return ripple
  }
  let rippleTimer = 0
  /** Ondulação do conteúdo: só no PC, só quando nenhum diálogo está aberto (um filtro no pai reposiciona o que é `fixed`). */
  const rippleContent = () => {
    const app = document.getElementById('root')
    if (!app || document.querySelector('dialog[open]') || typeof ensureRipple().animate.beginElement !== 'function') return
    app.style.filter = 'url(#wk-ripple)'
    ensureRipple().animate.beginElement()
    window.clearTimeout(rippleTimer)
    rippleTimer = window.setTimeout(() => {
      app.style.filter = ''
    }, 1100)
  }

  /** Ondas em SVG (PC): três círculos com contorno que crescem a partir do ponto de origem. */
  const svgRings = (origin: VfxOrigin, radius: number) => {
    const w = window.innerWidth
    const h = window.innerHeight
    const layer = document.createElementNS(SVG, 'svg')
    layer.setAttribute('class', 'wk-drop__svg')
    layer.setAttribute('viewBox', `0 0 ${w} ${h}`)
    layer.setAttribute('aria-hidden', 'true')
    dropLayer.appendChild(layer)
    ;[0, 140, 300].forEach((delay, i) => {
      const circle = document.createElementNS(SVG, 'circle')
      circle.setAttribute('cx', String(origin.x))
      circle.setAttribute('cy', String(origin.y))
      circle.setAttribute('r', String(radius * 0.94))
      circle.setAttribute('fill', 'none')
      circle.setAttribute('stroke', i % 2 ? 'rgba(124,58,237,.30)' : 'rgba(37,99,235,.30)')
      circle.setAttribute('stroke-width', String(9 - i * 2))
      circle.style.transformOrigin = `${origin.x}px ${origin.y}px`
      layer.appendChild(circle)
      const animation = circle.animate(
        [
          { transform: 'scale(.03)', opacity: 0 },
          { opacity: 0.95, offset: 0.12 },
          { opacity: 0.5, offset: 0.5 },
          { transform: 'scale(1)', opacity: 0 },
        ],
        { duration: 1250, delay, easing: 'cubic-bezier(.16,.8,.24,1)', fill: 'both' },
      )
      animation.onfinish = () => {
        circle.remove()
        if (!layer.childElementCount) layer.remove()
      }
    })
    rippleContent()
  }

  const previousTier = html().getAttribute('data-copilot-fx')
  html().setAttribute('data-copilot-fx', pickFxTier())
  const onVisibility = () => html().classList.toggle('is-hidden', document.hidden)
  document.addEventListener('visibilitychange', onVisibility)
  const timers = new Set<number>()

  const rings = (origin: VfxOrigin) => {
    if (prefersReducedMotion() || typeof dropLayer.animate !== 'function') return
    const w = window.innerWidth
    const h = window.innerHeight
    // Raio até o canto mais distante, sem teto (laboratório: R = hypot(max(x, w − x), max(y, h − y))).
    const radius = Math.hypot(Math.max(origin.x, w - origin.x), Math.max(origin.y, h - origin.y))
    // PC com aparelho capaz: SVG. Celular e `lite`: CSS, sem filtro.
    // Gota SVG com ondulação (feDisplacementMap) no PC e no celular, como o laboratório.
    if (pickFxTier() === 'full') {
      svgRings(origin, radius)
      return
    }
    for (const delay of [0, 140, 300]) {
      const ring = document.createElement('div')
      ring.className = 'wk-ring'
      Object.assign(ring.style, { left: `${origin.x - radius}px`, top: `${origin.y - radius}px`, width: `${2 * radius}px`, height: `${2 * radius}px` })
      dropLayer.appendChild(ring)
      const animation = ring.animate(
        [
          { transform: 'scale(.03)', opacity: 0 },
          { opacity: 0.95, offset: 0.12 },
          { opacity: 0.55, offset: 0.5 },
          { transform: 'scale(1)', opacity: 0 },
        ],
        { duration: 1250, delay, easing: 'cubic-bezier(.16,.8,.24,1)', fill: 'both' },
      )
      animation.onfinish = () => ring.remove()
    }
  }

  const baseLevel: VfxLevel = mobile ? 'high' : 'med'
  const level = (value: VfxLevel) => root.setAttribute('data-level', value)

  /** Brilho ligado pelo agente (o da gota não pode apagá-lo). */
  let agentOn = false
  let dropOn = false
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id)
      fn()
    }, ms)
    timers.add(id)
  }
  const clearLater = () => {
    timers.forEach((id) => window.clearTimeout(id))
    timers.clear()
  }

  /**
   * Gota, como o `press`/`release` do laboratório (L553-568): halo de pressão (entra em 340 ms e pulsa),
   * gota de 16 px (560 ms), ondas e brilho em nível alto (800 ms, atraso de 280 ms). Ao "soltar" (900 ms depois,
   * o `demo()` do laboratório) o halo some em 320 ms, o brilho volta ao médio e apaga em 900 ms após 2,4 s.
   */
  const press = (origin: VfxOrigin) => {
    if (typeof dropLayer.animate !== 'function') return
    clearLater()
    const reduced = prefersReducedMotion()
    if (reduced) {
      level(baseLevel)
      root.setAttribute('data-fade', 'quick')
      if (!agentOn) root.setAttribute('data-on', 'true')
      dropOn = true
      later(() => release(null), 900)
      return
    }
    const halo = document.createElement('div')
    halo.className = 'wk-press'
    Object.assign(halo.style, { left: `${origin.x}px`, top: `${origin.y}px` })
    dropLayer.appendChild(halo)
    halo.animate([{ transform: 'scale(.25)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 340, easing: 'cubic-bezier(.22,.9,.24,1)', fill: 'both' })
    const pulse = halo.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: 1700, delay: 340, iterations: Infinity, easing: 'ease-in-out' })
    const bead = document.createElement('div')
    bead.className = 'wk-bead'
    Object.assign(bead.style, { left: `${origin.x}px`, top: `${origin.y}px` })
    dropLayer.appendChild(bead)
    bead.animate(
      [
        { transform: 'translateY(-20px) scale(.4)', opacity: 0 },
        { transform: 'translateY(0) scale(1.1)', opacity: 1, offset: 0.42 },
        { transform: 'scale(.86)', opacity: 0.9, offset: 0.62 },
        { transform: 'scale(2.6)', opacity: 0 },
      ],
      { duration: 560, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' },
    ).onfinish = () => bead.remove()
    level('high')
    root.setAttribute('data-fade', 'drop')
    if (!agentOn) root.setAttribute('data-on', 'true')
    dropOn = true
    later(() => release(halo, pulse), 900)
  }
  const release = (halo: HTMLElement | null, pulse?: Animation) => {
    if (halo) {
      pulse?.cancel?.()
      if (typeof halo.animate === 'function') halo.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, fill: 'forwards' }).onfinish = () => halo.remove()
      else halo.remove()
    }
    level(baseLevel)
    later(() => {
      dropOn = false
      if (agentOn) return
      root.setAttribute('data-fade', 'slow')
      root.setAttribute('data-on', 'false')
      later(() => root.removeAttribute('data-fade'), 1000)
    }, prefersReducedMotion() ? 800 : 2400)
  }

  return {
    activate(origin) {
      if (origin) {
        root.style.setProperty('--wk-origin-x', `${Math.round(origin.x)}px`)
        root.style.setProperty('--wk-origin-y', `${Math.round(origin.y)}px`)
      }
      agentOn = true
      root.setAttribute('data-fade', 'show')
      root.setAttribute('data-on', 'true')
    },
    deactivate() {
      agentOn = false
      if (dropOn) return
      // Mantém o giro e a respiração durante o apagar (300 ms), como no laboratório.
      root.setAttribute('data-fade', 'hide')
      root.setAttribute('data-on', 'false')
      later(() => root.removeAttribute('data-fade'), 400)
    },
    drop(origin) {
      const at = origin ?? { x: window.innerWidth / 2, y: window.innerHeight * 0.4 }
      press(at)
      rings(at)
    },
    setLevel: level,
    setIntensity(value) {
      level(value >= 0.8 ? 'high' : value <= 0.6 ? 'low' : 'med')
    },
    dispose() {
      timers.forEach((id) => clearTimeout(id))
      window.clearTimeout(rippleTimer)
      document.getElementById('root')?.style.removeProperty('filter')
      ripple?.filter.remove()
      document.removeEventListener('visibilitychange', onVisibility)
      html().classList.remove('is-hidden')
      if (previousTier === null) html().removeAttribute('data-copilot-fx')
      else html().setAttribute('data-copilot-fx', previousTier)
      root.remove()
      dropLayer.remove()
    },
  }
}
