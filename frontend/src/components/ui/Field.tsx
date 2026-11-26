import { cloneElement, useId } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { cx } from './cx'

/** Classes canônicas de controle (input/textarea/select) — reutilizáveis fora do Field. */
const FIELD_CONTROL_BASE =
  'w-full border-ink border-gray-900 rounded-xl bg-white px-4 text-base sm:text-sm text-black placeholder:text-gray-500 ' +
  'focus:outline-none focus:border-2 focus:border-black focus:ring-2 focus:ring-primary/40 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 ' +
  'aria-[invalid=true]:border-red-600 aria-[invalid=true]:focus:border-red-600 aria-[invalid=true]:focus:ring-red-500/40'

/** input/select: altura fixa de 48px. `select` ganha seta do sistema (`.worki-select`, index.css). */
export const FIELD_CONTROL_CLASS = `${FIELD_CONTROL_BASE} h-12`

/** textarea: sem altura fixa — altura mínima própria e respiro vertical. */
export const FIELD_TEXTAREA_CLASS = `${FIELD_CONTROL_BASE} min-h-24 py-3 leading-relaxed`

interface ControlProps {
  id?: string
  className?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  required?: boolean
}

export interface FieldProps {
  label: string
  /**
   * Um único controle (input, textarea ou select). O Field injeta id, aria-describedby,
   * aria-invalid e as classes canônicas (mescladas ao className do controle).
   */
  children: ReactElement<ControlProps>
  hint?: ReactNode
  error?: string
  required?: boolean
  /** Marca "(opcional)" no rótulo. Marca-se o opcional, nunca o obrigatório (sem asterisco). */
  optional?: boolean
  className?: string
}

export function Field({ label, children, hint, error, required, optional, className }: FieldProps) {
  const autoId = useId()
  const controlId = children.props.id ?? autoId
  const hintId = `${controlId}-hint`
  const errorId = `${controlId}-error`
  // hint e erro ficam visíveis juntos (o hint não some quando há erro).
  const describedBy =
    [error ? errorId : null, hint ? hintId : null, children.props['aria-describedby']]
      .filter(Boolean)
      .join(' ') || undefined

  const control = cloneElement(children, {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : children.props['aria-invalid'],
    // Obrigatório para a tecnologia assistiva também. O <form> que usa `required` leva
    // `noValidate`: a mensagem é a nossa, junto do campo, não o balão do navegador.
    required: required || children.props.required,
    className: cx(
      children.type === 'textarea' ? FIELD_TEXTAREA_CLASS : FIELD_CONTROL_CLASS,
      children.type === 'select' && 'worki-select pr-10',
      children.props.className,
    ),
  })

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={controlId} className="text-sm font-semibold text-gray-900">
        {label}
        {optional && !required && <span className="ml-1 font-normal text-gray-600">(opcional)</span>}
      </label>
      {control}
      {hint && (
        <p id={hintId} className="text-xs text-gray-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="flex items-start gap-1 text-[13px] font-semibold text-red-700">
          <AlertCircle size={16} aria-hidden="true" className="mt-px shrink-0" />
          <span className="min-w-0">{error}</span>
        </p>
      )}
    </div>
  )
}

export default Field
