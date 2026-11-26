import { forwardRef } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { LinkProps } from 'react-router-dom'
import { linkButtonClasses } from './buttonClasses'
import type { ButtonClassOptions } from './buttonClasses'

export interface ButtonLinkProps extends LinkProps, Omit<ButtonClassOptions, 'className'> {
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

/** Navegação com aparência de botão. Navegar é `<a>`, nunca `<button onClick={navigate}>`. */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant, size, fullWidth, uppercase, iconLeft, iconRight, className, children, ...rest },
  ref,
) {
  return (
    <Link ref={ref} className={linkButtonClasses({ variant, size, fullWidth, uppercase, className })} {...rest}>
      {iconLeft}
      {children}
      {iconRight}
    </Link>
  )
})
