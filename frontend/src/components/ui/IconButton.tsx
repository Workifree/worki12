import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

export type IconButtonVariant = 'ghost' | 'secondary' | 'danger'

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Obrigatório: botão só com ícone não tem nome acessível sem isto. */
  'aria-label': string
  /** O ícone (ex.: <X size={20} />). Decorativo — o nome vem do aria-label. */
  children: ReactNode
  /** ghost = sem moldura · secondary = borda preta · danger = destrutivo (borda/ícone vermelhos) */
  variant?: IconButtonVariant
}

const BASE =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 select-none ' +
  'transition-colors duration-150 motion-reduce:transition-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-black ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

const VARIANTS: Record<IconButtonVariant, string> = {
  ghost: 'border-transparent bg-transparent text-black enabled:hover:bg-gray-100',
  secondary: 'border-black bg-white text-black enabled:hover:bg-gray-50',
  danger: 'border-red-600 bg-white text-red-600 enabled:hover:bg-red-50',
}

/** Botão quadrado 44px só com ícone (fechar, editar, remover). `type="button"` por padrão. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', type = 'button', className, children, ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cx(BASE, VARIANTS[variant], className)} {...rest}>
      <span aria-hidden="true" className="inline-flex items-center justify-center">
        {children}
      </span>
    </button>
  )
})

export default IconButton
