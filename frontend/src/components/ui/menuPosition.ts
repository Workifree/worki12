export interface MenuAnchor {
  top: number
  bottom: number
  right: number
}

export interface MenuBounds {
  /** Largura da viewport. */
  width: number
  /** Primeiro e último pixel utilizáveis (o fundo é o topo da barra inferior, quando houver). */
  top: number
  bottom: number
}

export interface MenuPlacement {
  top: number
  left: number
  maxHeight: number
  opensUp: boolean
}

export const MENU_GAP = 6
export const MENU_MARGIN = 8

/**
 * Abaixo do gatilho; vira para cima quando não cabe e há mais espaço em cima; se não couber de
 * nenhum lado, ocupa a área útil. Nunca sai da tela nem passa para baixo da barra inferior.
 */
export function placeMenu(
  anchor: MenuAnchor,
  size: { width: number; height: number },
  bounds: MenuBounds,
): MenuPlacement {
  const below = Math.max(0, bounds.bottom - anchor.bottom - MENU_GAP - MENU_MARGIN)
  const above = Math.max(0, anchor.top - bounds.top - MENU_GAP - MENU_MARGIN)
  const opensUp = size.height > below && above > below
  const side = opensUp ? above : below
  const area = Math.max(0, bounds.bottom - bounds.top - MENU_MARGIN * 2)
  // Não cabe de nenhum lado: usa a área útil inteira (passa por cima do gatilho) antes de rolar.
  const covers = size.height > side
  const maxHeight = covers ? area : side
  const height = Math.min(size.height, maxHeight)
  const top = covers
    ? bounds.bottom - MENU_MARGIN - height
    : opensUp
      ? anchor.top - MENU_GAP - height
      : anchor.bottom + MENU_GAP
  const left = Math.max(MENU_MARGIN, Math.min(anchor.right - size.width, bounds.width - size.width - MENU_MARGIN))
  return { top, left, maxHeight, opensUp }
}
