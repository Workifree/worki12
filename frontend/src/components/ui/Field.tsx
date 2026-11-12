import { cloneElement, useId } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { cx } from './cx'

/** Classes canônicas de controle (input/textarea/select) — reutilizáveis fora do Field. */
const FIELD_CONTROL_BASE =
  'w-full border-2 border-black rounded-xl bg-white px-4 text-sm text-black placeholder:text-gray-500 ' +
  'focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50 ' +
  'aria-[invalid=true]:border-red-600 aria-[invalid=true]:focus:ring-red-500'

/** input/select: altura fixa de 44px. */
export const FIELD_CONTROL_CLASS = `${FIELD_CONTROL_BASE} h-11`

/** textarea: sem altura fixa — altura mínima própria e respiro vertical. */
export const FIELD_TEXTAREA_CLASS = `${FIELD_CONTROL_BASE} min-h-24 py-3 leading-relaxed`

interface ControlProps {
  id?: string
  className?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
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
  className?: string
}

export function Field({ label, children, hint, error, required, className }: FieldProps) {
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
    className: cx(children.type === 'textarea' ? FIELD_TEXTAREA_CLASS : FIELD_CONTROL_CLASS, children.props.className),
  })

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={controlId} className="text-sm font-bold text-black">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-red-600">
            *
          </span>
        )}
      </label>
      {control}
      {hint && (
        <p id={hintId} className="text-xs text-gray-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-bold text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

export default Field
