import type { ReactNode } from 'react'
import { cx } from './cx'

export interface PageHeaderProps {
  title: string
  subtitle?: string
  /** UMA ação primária (ex.: <Button>). Empilha abaixo do título no mobile. */
  action?: ReactNode
  /** Nível semântico do título (padrão h1). */
  as?: 'h1' | 'h2'
  /** Sem margem inferior (header dentro de um bloco que já controla o espaçamento). */
  flush?: boolean
  className?: string
}

export function PageHeader({ title, subtitle, action, as: Heading = 'h1', flush = false, className }: PageHeaderProps) {
  return (
    <header
      className={cx(
        'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
        flush ? 'mb-0' : 'mb-6 sm:mb-8',
        className,
      )}
    >
      <div className="min-w-0">
        <Heading className="text-2xl sm:text-3xl font-bold tracking-tight text-black">{title}</Heading>
        {subtitle && <p className="mt-1 text-sm sm:text-base text-gray-600">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0 w-full sm:w-auto [&>*]:w-full sm:[&>*]:w-auto">{action}</div>}
    </header>
  )
}

export default PageHeader
