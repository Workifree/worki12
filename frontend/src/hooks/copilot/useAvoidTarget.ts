import { useLayoutEffect, useState, type RefObject } from 'react'

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export function intersects(a: Box, b: Box, gap = 6): boolean {
  return a.left < b.left + b.width + gap && a.left + a.width + gap > b.left && a.top < b.top + b.height + gap && a.top + a.height + gap > b.top
}

/**
 * Entre as posições possíveis do painel, a primeira que não fica em cima do item que o agente está
 * tocando (ou mostrando). `place(candidate, size)` devolve o retângulo que o painel ocuparia.
 * Reavalia enquanto há alvo: a rolagem até ele acontece depois.
 */
export function useAvoidTarget<T extends string>(
  target: HTMLElement | null,
  panel: RefObject<HTMLElement | null>,
  candidates: readonly T[],
  place: (candidate: T, size: { width: number; height: number }) => Box,
): T {
  const [choice, setChoice] = useState<T>(candidates[0])
  const key = candidates.join('|')

  useLayoutEffect(() => {
    if (!target) {
      setChoice(candidates[0])
      return
    }
    const decide = () => {
      const node = panel.current
      if (!node || !target.isConnected) return
      const rect = target.getBoundingClientRect()
      if (!rect.width && !rect.height) return
      const size = { width: node.offsetWidth, height: node.offsetHeight }
      const free = candidates.find((candidate) => !intersects(place(candidate, size), rect))
      if (free) setChoice((current) => (current !== free && !intersects(place(current, size), rect) ? current : free))
    }
    decide()
    const timer = window.setInterval(decide, 250)
    window.addEventListener('resize', decide)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', decide)
    }
    // `candidates` e `place` mudam de identidade a cada render; `key` representa as candidatas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, key])

  return choice
}
