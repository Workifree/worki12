import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { buttonClasses } from './buttonClasses'
import type { ButtonSize, ButtonVariant } from './buttonClasses'

export type { ButtonSize, ButtonVariant }

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * primary = verde (freela) · dark = preto (empresa) · secondary = borda · ghost = terciário ·
   * danger = confirmação final destrutiva · dangerOutline = abre a confirmação
   */
  variant?: ButtonVariant
  /** sm 36px (44px em tela de toque) · md 44px · lg 48px — alturas MÍNIMAS */
  size?: ButtonSize
  /** Mantém o rótulo, troca o ícone pelo giro e bloqueia o clique. */
  loading?: boolean
  fullWidth?: boolean
  /** Caixa-alta opcional (padrão: desligada). */
  uppercase?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
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
      className={buttonClasses({
        variant,
        size,
        fullWidth,
        uppercase,
        // Carregando não é "indisponível": quase opaco e cursor de espera.
        className: loading ? `disabled:cursor-wait disabled:opacity-80 ${className ?? ''}` : className,
      })}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          data-testid="button-spinner"
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        iconLeft
      )}
      {children}
      {!loading && iconRight}
    </button>
  )
})

export default Button
