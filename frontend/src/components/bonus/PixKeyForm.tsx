import { useState } from 'react'
import { Button, Field } from '../ui'
import { normalizePixKeyForStorage, type PixKeyType } from '../../lib/validation'
import { maskPixInput, pixKeyError } from './pixKey'

interface PixKeyFormProps {
  /** Recebe a chave já normalizada para armazenamento. */
  onSubmit: (normalizedKey: string) => Promise<void> | void
  submitLabel: string
  busy?: boolean
  onCancel?: () => void
}

const TYPES: Array<{ value: PixKeyType; label: string; placeholder: string }> = [
  { value: 'cpf', label: 'CPF', placeholder: '000.000.000-00' },
  { value: 'cnpj', label: 'CNPJ', placeholder: '00.000.000/0000-00' },
  { value: 'telefone', label: 'Telefone', placeholder: '(11) 99999-9999' },
  { value: 'email', label: 'E-mail', placeholder: 'nome@exemplo.com' },
  { value: 'aleatoria', label: 'Chave aleatória', placeholder: 'Cole a chave' },
]

const SELECT_CLASS =
  'h-11 w-full rounded-xl border-2 border-black bg-white px-4 text-base focus:outline-none focus:ring-2 focus:ring-primary sm:text-sm'

/** Cadastro da chave PIX do operador (R24b/R25), no próprio fluxo. */
export default function PixKeyForm({ onSubmit, submitLabel, busy = false, onCancel }: PixKeyFormProps) {
  const [type, setType] = useState<PixKeyType>('cpf')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | undefined>()
  const current = TYPES.find((t) => t.value === type) ?? TYPES[0]

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const normalized = normalizePixKeyForStorage(type, value)
    const problem = pixKeyError(type, value)
    if (problem) {
      setError(problem)
      return
    }
    setError(undefined)
    await onSubmit(normalized)
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="bonus-pix-type" className="mb-1 block text-sm font-bold">
          Tipo da chave
        </label>
        <select id="bonus-pix-type" value={type} onChange={(e) => {
          setType(e.target.value as PixKeyType)
          setValue('')
          setError(undefined)
        }} className={SELECT_CLASS}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <Field label="Chave PIX" error={error} hint="É para onde enviamos o PIX de segunda. Só você e a equipe do Worki enxergam.">
        <input
          type="text"
          inputMode={type === 'email' ? 'email' : type === 'aleatoria' ? 'text' : 'numeric'}
          autoComplete="off"
          value={value}
          placeholder={current.placeholder}
          onChange={(e) => setValue(maskPixInput(type, e.target.value))}
        />
      </Field>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" variant="dark" size="lg" loading={busy} className="sm:flex-1">
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" size="lg" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  )
}
