import type { ButtonHTMLAttributes } from 'react'
import { cx } from './cx'

export interface FilterChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  pressed: boolean
}

/**
 * Chip de filtro (liga/desliga). Agrupe em `role="group"` com `aria-label` e a classe
 * `worki-scroll-row` (UMA linha que rola, com esmaecimento na borda; nunca quebra).
 */
export function FilterChip({ pressed, className, type = 'button', ...rest }: FilterChipProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={cx(
        'relative inline-flex min-h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-pill border-ink px-3.5 text-sm font-medium',
        // Toque: 36px visuais, 44px de alvo.
        "after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] [@media(pointer:coarse)]:min-h-11",
        'transition-[transform,background-color,color] duration-fast motion-safe:active:scale-[.97]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        pressed
          ? 'border-black bg-black font-semibold text-white'
          : 'border-gray-300 bg-white text-gray-900 hover:border-gray-900 active:bg-gray-100',
        className,
      )}
      {...rest}
    />
  )
}
