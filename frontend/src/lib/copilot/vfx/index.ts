/**
 * Efeitos de "a IA está usando a tela": brilho na borda e "gota" ao abrir. ISOLADO de propósito:
 * quem quiser trocar o visual troca só este módulo e `copilot.css`; o resto do copiloto só conhece
 * a interface `Vfx`. Receita e medições: .harness/spec/copiloto-worki/pesquisa-visual-agentico.md.
 *
 * Gota: PC = SVG (ondas em círculo + ondulação do conteúdo por feDisplacementMap, só em rajada de 1,1 s);
 * celular, aparelho fraco (`lite`) e movimento reduzido = CSS puro (2 ondas, sem filtro SVG) ou nada.
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
  /** Celular: 2 ondas, halo menor, brilho mais baixo. */
  mobile?: boolean
}

/** 'full' | 'lite'. Aparelho fraco, economia de dados ou 2 núcleos ou menos: brilho estático. */
export function pickFxTier(): 'full' | 'lite' {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  if (nav.connection?.saveData) return 'lite'
  if ((nav.deviceMemory ?? 8) <= 2 || (nav.hardwareConcurrency ?? 8) <= 4) return 'lite'
  return 'full'
}

const html = () => document.documentElement

export function createGlowVfx(host: HTMLElement, options: VfxOptions = {}): Vfx {
  const mobile = !!options.mobile
  const root = document.createElement('div')
  root.className = 'wk-glow'
  root.setAttribute('data-on', 'false')
  root.setAttribute('data-level', mobile ? 'low' : 'med')
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
  /** Filtro de ondulação (PC): criado sob demanda, uma vez. `scale` vai de 0 a 12 e volta por SMIL, sem JS por quadro. */
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
      '<animate attributeName="scale" values="0;12;5;0" keyTimes="0;0.35;0.7;1" dur="1.1s" begin="indefinite" fill="remove"/>' +
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
    }, 1150)
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
    // Limita o preenchimento: onda de tela cheia custa caro em aparelho fraco.
    const radius = Math.min(Math.hypot(Math.max(origin.x, w - origin.x), Math.max(origin.y, h - origin.y)), Math.hypot(w, h) * 0.6)
    // PC com aparelho capaz: SVG. Celular e `lite`: CSS, sem filtro.
    if (!mobile && pickFxTier() === 'full') {
      svgRings(origin, radius)
      return
    }
    const delays = mobile ? [0, 140] : [0, 140, 300]
    for (const delay of delays) {
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
        { duration: mobile ? 1100 : 1250, delay, easing: 'cubic-bezier(.16,.8,.24,1)', fill: 'both' },
      )
      animation.onfinish = () => ring.remove()
    }
  }

  const level = (value: VfxLevel) => root.setAttribute('data-level', value)

  return {
    activate(origin) {
      if (origin) {
        root.style.setProperty('--wk-origin-x', `${Math.round(origin.x)}px`)
        root.style.setProperty('--wk-origin-y', `${Math.round(origin.y)}px`)
      }
      root.setAttribute('data-on', 'true')
    },
    deactivate() {
      root.setAttribute('data-on', 'false')
    },
    drop(origin) {
      rings(origin ?? { x: window.innerWidth / 2, y: window.innerHeight * 0.4 })
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
