/**
 * Realce do alvo: UM único nó `position: fixed` (reaproveitado), que segue o elemento a cada frame
 * (rAF: só transform e tamanho). Fica no mesmo contexto do alvo (dentro do `<dialog>` aberto, se houver,
 * que vive na camada superior), acima do conteúdo e ABAIXO da raiz do copiloto. Some na hora quando o
 * elemento sai do DOM, fica sem tamanho/escondido, sai da área visível de uma rolagem, é coberto por
 * modal/aviso, a rota muda, a ação termina (`clear`) ou a tarefa para. Nunca deixa nó órfão.
 * Interface trocável: pode passar a usar `guia.destacar` (lib/guide) para alvos com `data-copilot`.
 */
import { UI_ATTR } from './dom'

export interface Highlighter {
  show(element: HTMLElement): void
  clear(): void
}

const NODE_ATTR = 'data-copilot-highlight-node'
const FADE_MS = 160
const GIVE_UP_MS = 6000
const STEADY_MS = 200
const PAD = 3

const isJsdom = () => /jsdom/i.test(navigator.userAgent)

/** Retângulo do alvo recortado pelas áreas de rolagem dos ancestrais; null = nada visível. */
function visibleRect(element: HTMLElement): { left: number; top: number; right: number; bottom: number } | null {
  const r = element.getBoundingClientRect()
  let left = r.left
  let top = r.top
  let right = r.right
  let bottom = r.bottom
  for (let p = element.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const s = getComputedStyle(p)
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
    const pr = p.getBoundingClientRect()
    if (pr.width === 0 && pr.height === 0) continue
    left = Math.max(left, pr.left)
    top = Math.max(top, pr.top)
    right = Math.min(right, pr.right)
    bottom = Math.min(bottom, pr.bottom)
  }
  right = Math.min(right, window.innerWidth)
  bottom = Math.min(bottom, window.innerHeight)
  left = Math.max(left, 0)
  top = Math.max(top, 0)
  return right - left > 1 && bottom - top > 1 ? { left, top, right, bottom } : null
}

function hasLayout(element: HTMLElement): boolean {
  const r = element.getBoundingClientRect()
  return r.width > 0 || r.height > 0
}

/** O centro do alvo é mesmo dele (não está atrás de uma barra, aviso ou modal). */
function notCovered(element: HTMLElement, box: { left: number; top: number; right: number; bottom: number }): boolean {
  const top = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2)
  return !!top && (top === element || element.contains(top) || top.contains(element))
}

/** Dentro da área útil da tela (longe do topo, onde fica a pílula, e da barra de baixo). */
function insideSafeArea(element: HTMLElement): boolean {
  const r = element.getBoundingClientRect()
  return r.width > 0 && r.top >= 56 && r.bottom <= window.innerHeight - 72 && r.left >= 0 && r.right <= window.innerWidth
}

function hidden(element: HTMLElement): boolean {
  const s = getComputedStyle(element)
  return s.display === 'none' || s.visibility === 'hidden'
}

export function createOutlineHighlighter(): Highlighter {
  let node: HTMLDivElement | null = null
  let target: HTMLElement | null = null
  let raf = 0
  let removeTimer = 0
  let href = ''

  const ensureNode = (element: HTMLElement): HTMLDivElement => {
    if (!node) {
      node = document.createElement('div')
      node.setAttribute(NODE_ATTR, '')
      node.setAttribute('aria-hidden', 'true')
      node.setAttribute('inert', '')
      node.style.cssText =
        'position:fixed;left:0;top:0;margin:0;pointer-events:none;box-sizing:border-box;z-index:2147483000;' +
        'border:3px solid #2563EB;border-radius:10px;box-shadow:0 0 0 8px rgba(37,99,235,0.22);' +
        `opacity:0;transition:opacity ${FADE_MS}ms ease;will-change:transform,opacity;`
    }
    const container = element.closest('dialog[open]') ?? document.body
    if (node.parentNode !== container) {
      // Antes da raiz do copiloto (mesmo pai), para o painel e a pílula ficarem por cima.
      const ui = Array.from(container.children).find((c) => c.hasAttribute(UI_ATTR)) ?? null
      container.insertBefore(node, ui)
    }
    return node
  }

  const detach = () => {
    window.clearTimeout(removeTimer)
    removeTimer = 0
    node?.remove()
  }

  const stopLoop = () => {
    if (raf) window.cancelAnimationFrame(raf)
    raf = 0
  }

  const clear = () => {
    stopLoop()
    if (target) target.removeAttribute('data-copilot-highlight')
    target = null
    if (node?.parentNode) {
      node.style.opacity = '0'
      window.clearTimeout(removeTimer)
      removeTimer = window.setTimeout(detach, FADE_MS + 40)
    }
  }

  /** Apaga já, sem fade (alvo sumiu: nada a desvanecer). */
  const kill = () => {
    clear()
    detach()
  }

  const show = (element: HTMLElement) => {
    kill()
    target = element
    href = location.href
    const startedAt = performance.now()
    let lastTop = Number.NaN
    let steadySince = startedAt
    let painted = false

    const frame = () => {
      raf = 0
      if (target !== element) return
      const now = performance.now()
      if (!element.isConnected || href !== location.href) return kill()
      const jsdom = isJsdom() && !hasLayout(element)
      if (!painted) {
        if (now - startedAt > GIVE_UP_MS) return kill()
        const top = element.getBoundingClientRect().top
        if (!(Math.abs(top - lastTop) < 0.5)) steadySince = now
        lastTop = top
        if (now - steadySince >= STEADY_MS && (jsdom || (insideSafeArea(element) && !hidden(element) && visibleRect(element) !== null))) {
          const box = jsdom ? null : visibleRect(element)
          if (jsdom || (box && notCovered(element, box))) {
            painted = true
            element.setAttribute('data-copilot-highlight', '')
          }
        }
        if (!painted) {
          raf = window.requestAnimationFrame(frame)
          return
        }
      }
      // Pintado: acompanha o alvo; sumiu de verdade = encerra; coberto/recortado = só esconde.
      if (jsdom) {
        ensureNode(element).style.opacity = '1'
      } else {
        if (hidden(element) || !hasLayout(element)) return kill()
        const box = visibleRect(element)
        const n = ensureNode(element)
        if (!box || !notCovered(element, box)) {
          n.style.opacity = '0'
        } else {
          n.style.width = `${box.right - box.left + PAD * 2}px`
          n.style.height = `${box.bottom - box.top + PAD * 2}px`
          const wantX = box.left - PAD
          const wantY = box.top - PAD
          n.style.transform = `translate(${wantX}px, ${wantY}px)`
          // Contêiner com transform/filter vira o "fixed" do nó e o desloca: mede e compensa.
          const got = n.getBoundingClientRect()
          const dx = wantX - got.left
          const dy = wantY - got.top
          if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) n.style.transform = `translate(${wantX + dx}px, ${wantY + dy}px)`
          n.style.opacity = '1'
        }
      }
      raf = window.requestAnimationFrame(frame)
    }
    raf = window.requestAnimationFrame(frame)
  }

  return { show, clear }
}
