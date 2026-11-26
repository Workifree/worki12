import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { cx } from './cx'

export interface ChoiceCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  pressed: boolean
  children: ReactNode
}

/** Opção selecionável (pessoa num modal, período da disponibilidade). Sem sombra: não é ação. */
export function ChoiceCard({ pressed, children, className, type = 'button', ...rest }: ChoiceCardProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={cx(
        'flex min-h-11 w-full items-center gap-3 rounded-xl border-ink bg-white px-3 py-2 text-left text-sm font-medium text-gray-900',
        'transition-[transform,background-color,border-color] duration-fast motion-safe:active:scale-[.98]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        pressed ? 'border-black bg-gray-50 font-semibold' : 'border-gray-200 hover:border-gray-900',
        className,
      )}
      {...rest}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {pressed && <CheckCircle2 size={20} aria-hidden="true" className="shrink-0" />}
    </button>
  )
}
