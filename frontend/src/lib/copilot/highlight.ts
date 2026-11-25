/**
 * Destaque padrão: contorno no próprio elemento (funciona dentro de `<dialog>`, sem camada).
 * Interface trocável: pode passar a usar `guia.destacar` (lib/guide) para alvos com `data-copilot`.
 */
export interface Highlighter {
  show(element: HTMLElement): void
  clear(): void
}

export function createOutlineHighlighter(): Highlighter {
  let current: { element: HTMLElement; outline: string; offset: string; shadow: string } | null = null
  const clear = () => {
    if (!current) return
    const { element, outline, offset, shadow } = current
    element.style.outline = outline
    element.style.outlineOffset = offset
    element.style.boxShadow = shadow
    element.removeAttribute('data-copilot-highlight')
    current = null
  }
  return {
    clear,
    show(element) {
      clear()
      current = {
        element,
        outline: element.style.outline,
        offset: element.style.outlineOffset,
        shadow: element.style.boxShadow,
      }
      element.style.outline = '3px solid #2563EB'
      element.style.outlineOffset = '3px'
      element.style.boxShadow = '0 0 0 8px rgba(37, 99, 235, 0.22)'
      element.setAttribute('data-copilot-highlight', '')
      element.scrollIntoView?.({ block: 'center', inline: 'nearest' })
    },
  }
}
