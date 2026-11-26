/**
 * Destaque padrão: contorno no próprio elemento (funciona dentro de `<dialog>`, sem camada).
 * Interface trocável: pode passar a usar `guia.destacar` (lib/guide) para alvos com `data-copilot`.
 */
export interface Highlighter {
  show(element: HTMLElement): void
  clear(): void
}

/** Dentro da área útil da tela (longe do topo, onde fica a pílula, e da barra de baixo). */
function insideSafeArea(element: HTMLElement): boolean {
  const r = element.getBoundingClientRect()
  // jsdom (testes) não tem layout: tudo zero. No navegador de verdade, tamanho zero = invisível, sem realce.
  if (r.width === 0 && r.height === 0 && /jsdom/i.test(navigator.userAgent)) return true
  return r.width > 0 && r.top >= 56 && r.bottom <= window.innerHeight - 72 && r.left >= 0 && r.right <= window.innerWidth
}

/** O centro do alvo é mesmo dele (não está atrás de uma barra, aviso ou modal). */
function notCovered(element: HTMLElement): boolean {
  const r = element.getBoundingClientRect()
  if (r.width === 0 && r.height === 0 && /jsdom/i.test(navigator.userAgent)) return true
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return !!top && (top === element || element.contains(top) || top.contains(element))
}

/**
 * O contorno só aparece depois que o alvo parou de se mexer, está inteiro na área útil e livre; nunca
 * rola a página (quem rola é o ponteiro, devagar). Fora disso espera até ~6 s e desiste em silêncio.
 */
export function createOutlineHighlighter(): Highlighter {
  let current: { element: HTMLElement; outline: string; offset: string; shadow: string } | null = null
  let timer = 0
  const stopWaiting = () => {
    window.clearInterval(timer)
    timer = 0
  }
  const clear = () => {
    stopWaiting()
    if (!current) return
    const { element, outline, offset, shadow } = current
    element.style.outline = outline
    element.style.outlineOffset = offset
    element.style.boxShadow = shadow
    element.removeAttribute('data-copilot-highlight')
    current = null
  }
  const paint = (element: HTMLElement) => {
    current = { element, outline: element.style.outline, offset: element.style.outlineOffset, shadow: element.style.boxShadow }
    element.style.outline = '3px solid #2563EB'
    element.style.outlineOffset = '3px'
    element.style.boxShadow = '0 0 0 8px rgba(37, 99, 235, 0.22)'
    element.setAttribute('data-copilot-highlight', '')
  }
  return {
    clear,
    show(element) {
      clear()
      let lastTop = Number.NaN
      let steady = 0
      let waited = 0
      timer = window.setInterval(() => {
        waited += 100
        if (!element.isConnected || waited > 6000) return stopWaiting()
        const top = element.getBoundingClientRect().top
        steady = Math.abs(top - lastTop) < 0.5 ? steady + 1 : 0
        lastTop = top
        if (steady >= 2 && insideSafeArea(element) && notCovered(element)) {
          stopWaiting()
          paint(element)
        }
      }, 100)
    },
  }
}
