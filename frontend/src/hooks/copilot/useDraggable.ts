import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

export interface Offset {
  x: number
  y: number
}

/**
 * Arrastar o painel pela alça (PC). Só `transform`: sem layout. Fica dentro da janela. A alça
 * continua opcional: o painel funciona sem arrastar.
 */
export function useDraggable(panel: RefObject<HTMLElement | null>) {
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 })
  const start = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button,a,input,textarea,select')) return
      start.current = { px: event.clientX, py: event.clientY, ox: offset.x, oy: offset.y }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [offset],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const from = start.current
      const node = panel.current
      if (!from || !node) return
      const rect = node.getBoundingClientRect()
      let dx = from.ox + event.clientX - from.px
      let dy = from.oy + event.clientY - from.py
      // Não deixa o painel sair da janela.
      const baseLeft = rect.left - offset.x
      const baseTop = rect.top - offset.y
      dx = Math.min(Math.max(dx, 8 - baseLeft), window.innerWidth - rect.width - 8 - baseLeft)
      dy = Math.min(Math.max(dy, 8 - baseTop), window.innerHeight - rect.height - 8 - baseTop)
      setOffset({ x: dx, y: dy })
    },
    [offset, panel],
  )

  const onPointerUp = useCallback(() => {
    start.current = null
  }, [])

  return {
    offset,
    reset: () => setOffset({ x: 0, y: 0 }),
    handleProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  }
}
