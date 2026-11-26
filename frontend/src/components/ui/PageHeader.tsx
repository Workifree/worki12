import type { ReactNode } from 'react'
import { cx } from './cx'

export interface PageHeaderProps {
  title: string
  subtitle?: string
  /** UMA ação primária (ex.: <Button>). Empilha abaixo do título no mobile. */
  action?: ReactNode
  /** No celular, ação curta na MESMA linha do título (ex.: "Criar turno" em listas). */
  inlineAction?: boolean
  /** Nível semântico do título (padrão h1). */
  as?: 'h1' | 'h2'
  /** Sem margem inferior (header dentro de um bloco que já controla o espaçamento). */
  flush?: boolean
  className?: string
}

export function PageHeader({ title, subtitle, action, as: Heading = 'h1', flush = false, inlineAction = false, className }: PageHeaderProps) {
  return (
    <header
      className={cx(
        'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
        inlineAction && 'flex-row flex-wrap items-center justify-between gap-3',
        flush ? 'mb-0' : 'mb-6 sm:mb-8',
        className,
      )}
    >
      <div className="min-w-0">
        <Heading className="text-2xl sm:text-3xl font-bold tracking-tight text-balance text-black">{title}</Heading>
        {subtitle && <p className="mt-1 text-sm sm:text-base text-gray-600">{subtitle}</p>}
      </div>
      {action && (
        <div
          className={cx(
            'shrink-0 w-full sm:w-auto [&>*]:w-full sm:[&>*]:w-auto',
            inlineAction && 'w-auto [&>*]:w-auto',
          )}
        >
          {action}
        </div>
      )}
    </header>
  )
}

export default PageHeader
