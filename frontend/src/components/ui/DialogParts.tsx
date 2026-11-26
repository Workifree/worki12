import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './IconButton'
import { cx } from './cx'

export function DialogHeader({
  title,
  titleId,
  subtitle,
  onClose,
  closeDisabled = false,
}: {
  title: string
  /** Mesmo id passado em `Dialog labelledBy`. */
  titleId: string
  subtitle?: ReactNode
  onClose?: () => void
  closeDisabled?: boolean
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={titleId} className="text-lg font-semibold text-balance text-gray-900">
          {title}
        </h2>
        {subtitle && <div className="mt-1 text-sm text-gray-600">{subtitle}</div>}
      </div>
      {onClose && (
        <IconButton aria-label="Fechar" onClick={onClose} disabled={closeDisabled} className="-mr-2 -mt-2">
          <X size={20} />
        </IconButton>
      )}
    </div>
  )
}

/**
 * Rodapé fixo do modal. Filhos na ordem secundário e depois principal. Curtos: lado a lado no
 * celular, à direita no desktop. `stacked` (rótulos longos ou 3 ações): principal no topo.
 */
export function DialogActions({
  children,
  stacked = false,
  className,
}: {
  children: ReactNode
  stacked?: boolean
  className?: string
}) {
  return (
    <div
      className={cx(
        'worki-dialog-actions mt-4 flex gap-3 sm:justify-end',
        stacked
          ? 'flex-col-reverse sm:flex-row [&>*]:w-full sm:[&>*]:w-auto'
          : '[&>*]:flex-1 sm:[&>*]:flex-none',
        className,
      )}
    >
      {children}
    </div>
  )
}
