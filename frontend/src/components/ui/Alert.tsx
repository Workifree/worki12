import type { HTMLAttributes, ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { TONE_CLASS } from '../../lib/statusLabels'
import type { StatusTone } from '../../lib/statusLabels'
import { cx } from './cx'

const ICON = { neutral: Info, info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle }

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: StatusTone
  title?: string
  /** Saída do problema (botão secundário ou link). */
  action?: ReactNode
  children?: ReactNode
}

/** Aviso dentro do conteúdo. Passe `role="alert"` só para falha que acabou de ocorrer. */
export function Alert({ tone = 'info', title, action, className, children, ...rest }: AlertProps) {
  const Icon = ICON[tone]
  return (
    <div className={cx('flex items-start gap-3 rounded-xl border-2 p-3', TONE_CLASS[tone], className)} {...rest}>
      <Icon size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="text-sm font-bold">{title}</p>}
        {children && <div className="text-sm">{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  )
}
