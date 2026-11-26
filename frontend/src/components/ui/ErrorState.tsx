import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from './Button'
import { cx } from './cx'

export interface ErrorStateProps {
  onRetry: () => void
  title?: string
  message?: string
  /** A nova tentativa está rodando. */
  retrying?: boolean
  className?: string
}

/**
 * Erro de CARGA, diferente de vazio: um vazio que mente faz a pessoa concluir que não tem nada
 * quando foi a rede que caiu.
 */
export function ErrorState({
  onRetry,
  title = 'Não conseguimos carregar',
  message = 'Verifique sua conexão e tente de novo.',
  retrying = false,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cx(
        'rounded-2xl border-2 border-status-danger-line bg-status-danger-bg p-5 text-center sm:p-6',
        className,
      )}
    >
      <AlertTriangle size={40} aria-hidden="true" className="mx-auto mb-3 text-red-600" />
      <p className="mb-1 text-base font-bold text-status-danger-fg">{title}</p>
      <p className="mb-4 text-sm text-status-danger-fg">{message}</p>
      <Button variant="dark" onClick={onRetry} loading={retrying} iconLeft={<RotateCw size={16} aria-hidden="true" />}>
        Tentar de novo
      </Button>
    </div>
  )
}
