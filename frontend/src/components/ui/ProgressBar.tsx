import { cx } from './cx'

export interface ProgressBarProps {
  value: number
  max?: number
  /** Nome acessível ("Perfil 60% completo"). */
  label: string
  className?: string
}

export function ProgressBar({ value, max = 100, label, className }: ProgressBarProps) {
  const safe = Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : 0
  return (
    <progress
      value={safe}
      max={max}
      aria-label={label}
      className={cx('worki-progress block h-2 w-full overflow-hidden rounded-full', className)}
    />
  )
}
