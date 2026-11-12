import { forwardRef } from 'react'
import type { HTMLAttributes, KeyboardEvent, MouseEvent, Ref } from 'react'
import { cx } from './cx'

export type CardPadding = 'none' | 'sm' | 'md' | 'lg'
export type CardElement = 'div' | 'section' | 'article' | 'li' | 'aside'

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** none = 0 · sm = p-4 · md = p-5 sm:p-6 · lg = p-6 sm:p-8 */
  padding?: CardPadding
  /** Hover elevado (cards clicáveis). */
  interactive?: boolean
  /**
   * Card clicável acessível: aplica role="button", tabIndex=0, foco visível e ativa com clique,
   * Enter ou Espaço — sem disparar quando o evento nasce de um controle interno (botão, link,
   * input). Implica o visual de `interactive`.
   */
  onActivate?: () => void
  /** Elemento HTML renderizado (padrão: div). */
  as?: CardElement
}

const PADDING: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5 sm:p-6',
  lg: 'p-6 sm:p-8',
}

const INTERACTIVE_SELECTOR = 'button,a,input,select,textarea,label,summary,[role="button"],[role="link"]'

export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  {
    padding = 'md',
    interactive = false,
    onActivate,
    as = 'div',
    className,
    children,
    onClick,
    onKeyDown,
    tabIndex,
    role,
    ...rest
  },
  ref,
) {
  const Tag = as as 'div'
  const activatable = typeof onActivate === 'function'

  const handleClick = (e: MouseEvent<HTMLElement>) => {
    onClick?.(e as MouseEvent<HTMLDivElement>)
    if (!activatable || e.defaultPrevented) return
    // Clique vindo de um controle interno pertence a ele, não ao card.
    const inner = (e.target as HTMLElement).closest(INTERACTIVE_SELECTOR)
    if (inner && inner !== e.currentTarget) return
    onActivate()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    onKeyDown?.(e as KeyboardEvent<HTMLDivElement>)
    if (!activatable || e.defaultPrevented) return
    // Guarda: Enter/Espaço em botão interno não ativa o card.
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onActivate()
    }
  }

  return (
    <Tag
      ref={ref as Ref<HTMLDivElement>}
      role={activatable ? (role ?? 'button') : role}
      tabIndex={activatable ? (tabIndex ?? 0) : tabIndex}
      className={cx(
        'bg-white border-2 border-black rounded-2xl',
        PADDING[padding],
        (interactive || activatable) &&
          'transition-all duration-150 motion-reduce:transition-none motion-reduce:transform-none hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]',
        activatable &&
          'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
        className,
      )}
      onClick={activatable || onClick ? handleClick : undefined}
      onKeyDown={activatable || onKeyDown ? handleKeyDown : undefined}
      {...rest}
    >
      {children}
    </Tag>
  )
})

export default Card
