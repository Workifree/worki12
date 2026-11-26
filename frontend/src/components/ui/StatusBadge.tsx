import type { HTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { TONE_CLASS, getStatus } from '../../lib/statusLabels'
import type { StatusDomain, StatusTone } from '../../lib/statusLabels'
import { cx } from './cx'

type Common = Omit<HTMLAttributes<HTMLSpanElement>, 'children'>

export type StatusBadgeProps = Common &
  (
    | {
        /** Estado do banco: rótulo, tom e ícone vêm do glossário. */
        domain: StatusDomain
        status: string | null | undefined
        tone?: never
        icon?: LucideIcon | null
        /** Complemento no lugar do rótulo do glossário (só para contexto: "Falta 1"). */
        children?: ReactNode
      }
    | { domain?: never; status?: never; tone: StatusTone; icon?: LucideIcon | null; children: ReactNode }
  )

/** Selo de estado: sem sombra e sem borda preta (não parece botão). Sempre com texto. */
export function StatusBadge(props: StatusBadgeProps) {
  const { domain, status, tone, icon, children, className, ...rest } = props
  const info = domain ? getStatus(domain, status) : null
  const Icon = icon === undefined ? info?.icon : icon
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-center gap-1 rounded-pill border px-2.5 py-1 text-xs font-semibold leading-tight',
        TONE_CLASS[info?.tone ?? tone ?? 'neutral'],
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={14} aria-hidden="true" className="shrink-0" />}
      <span className="min-w-0 break-words">{children ?? info?.label}</span>
    </span>
  )
}
