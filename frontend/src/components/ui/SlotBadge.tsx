import type { HTMLAttributes } from 'react'
import { cx } from './cx'

export interface SlotBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Vagas preenchidas. `null` = a leitura falhou: mostra "–/N", nunca "0/N". */
  filled: number | null | undefined
  /** Total de vagas. */
  total: number | null | undefined
}

/**
 * Contador de vagas do laboratório visual ("4/5"): caixinha com contorno de tinta, verde quando o
 * turno está completo e âmbar quando ainda falta gente. Sempre com texto acessível por extenso.
 */
export function SlotBadge({ filled, total, className, ...rest }: SlotBadgeProps) {
  const slots = total ?? 1
  const known = filled !== null && filled !== undefined
  const full = known && filled >= slots
  const label = known
    ? `${filled} de ${slots} ${slots === 1 ? 'vaga preenchida' : 'vagas preenchidas'}`
    : `${slots} ${slots === 1 ? 'vaga' : 'vagas'}, ocupação não carregada`
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'inline-flex shrink-0 items-center rounded-lg border-2 border-black px-2 py-0.5 text-xs font-extrabold leading-tight tabular-nums',
        !known ? 'bg-gray-100 text-gray-700' : full ? 'bg-[#D7F5E4] text-[#0B6B3A]' : 'bg-[#FFE9B8] text-[#8A5A00]',
        className,
      )}
    >
      {known ? filled : '–'}/{slots}
    </span>
  )
}
