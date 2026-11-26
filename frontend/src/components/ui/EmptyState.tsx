import type { HTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: LucideIcon
  /** O que não há, em uma frase ("Nenhum turno em andamento agora."). */
  title: string
  /** Por que está vazio ou o que fazer. */
  description?: string
  /** Próximo passo (um ou dois botões). */
  action?: ReactNode
  /** inline = dentro de uma seção · page = a tela inteira está vazia */
  size?: 'inline' | 'page'
  headingLevel?: 'h2' | 'h3'
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = 'inline',
  headingLevel: Heading = 'h2',
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        'px-4 text-center',
        size === 'page' ? 'py-12' : 'py-8',
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={40} aria-hidden="true" className="mx-auto mb-3 text-gray-400" />}
      <Heading className="text-base font-semibold text-balance text-gray-900">{title}</Heading>
      {description && <p className="mx-auto mt-1 max-w-prose text-sm text-gray-600">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap items-center justify-center gap-3">{action}</div>}
    </div>
  )
}
