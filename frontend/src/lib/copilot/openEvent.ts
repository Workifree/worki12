/** Pedido para abrir o copiloto (botão de ajuda, atalho). `detail` traz o ponto de origem, se houver. */
export const OPEN_EVENT = 'worki:copilot:open'

export interface OpenDetail {
  /** De onde a pessoa abriu (centro do botão ou do campo): a "gota" nasce dali. */
  x: number
  y: number
}

export function requestOpen(origin?: OpenDetail): void {
  window.dispatchEvent(new CustomEvent<OpenDetail | undefined>(OPEN_EVENT, { detail: origin }))
}

/** Ctrl+K (⌘K no Mac). */
export function isOpenShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k'
}

export function centerOf(element: Element | null): OpenDetail | undefined {
  if (!element) return undefined
  const rect = element.getBoundingClientRect()
  return rect.width || rect.height ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined
}
