import type { ButtonHTMLAttributes } from 'react'
import { cx } from './cx'

export interface FilterChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  pressed: boolean
}

/** Chip de filtro (liga/desliga). Agrupe em `role="group"` com `aria-label`. */
export function FilterChip({ pressed, className, type = 'button', ...rest }: FilterChipProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={cx(
        'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-pill border-2 px-4 text-sm font-bold',
        'transition-[transform,background-color,color] duration-fast motion-safe:active:scale-[.97]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        pressed
          ? 'border-black bg-black text-white'
          : 'border-gray-300 bg-white text-black hover:border-black active:bg-gray-100',
        className,
      )}
      {...rest}
    />
  )
}
