import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'dark' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = verde (worker) · dark = preto (empresa) · secondary = borda · ghost = sem moldura · danger = destrutivo */
  variant?: ButtonVariant
  /** sm h-9 · md h-11 (alvo de toque 44px) · lg h-12 */
  size?: ButtonSize
  loading?: boolean
  fullWidth?: boolean
  /** Caixa-alta opcional (padrão: desligada). */
  uppercase?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl font-bold text-sm leading-none select-none ' +
  'transition-all duration-150 motion-reduce:transition-none motion-reduce:transform-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-black disabled:cursor-not-allowed disabled:opacity-50'

// Moldura brutalista refinada: borda 2px preta + sombra offset curta que "afunda" no active.
const FRAME =
  'border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] ' +
  'enabled:hover:-translate-x-px enabled:hover:-translate-y-px enabled:hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] ' +
  'enabled:active:translate-x-[3px] enabled:active:translate-y-[3px] enabled:active:shadow-none ' +
  'disabled:shadow-none'

const VARIANTS: Record<ButtonVariant, string> = {
  // primary-dark (#008840) → texto branco 4,57:1 (AA); o verde de marca #00A651 dá só 3,19:1.
  primary: `${FRAME} bg-primary-dark text-white enabled:hover:bg-black`,
  dark: `${FRAME} bg-black text-white enabled:hover:bg-gray-800`,
  secondary: `${FRAME} bg-white text-black enabled:hover:bg-gray-50`,
  ghost: 'border-2 border-transparent bg-transparent text-black enabled:hover:bg-gray-100',
  danger: `${FRAME} bg-red-600 text-white enabled:hover:bg-red-700`,
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3',
  md: 'h-11 px-5',
  lg: 'h-12 px-6',
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      data-testid="button-spinner"
      className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  )
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    fullWidth = false,
    uppercase = false,
    iconLeft,
    iconRight,
    type = 'button',
    disabled,
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        BASE,
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        uppercase && 'uppercase tracking-wide',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  )
})

export default Button
