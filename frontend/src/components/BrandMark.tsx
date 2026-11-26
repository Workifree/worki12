import { cx } from './ui/cx'

export type BrandRole = 'work' | 'hire'

/** Faixa de marca de 4px no topo da tela: o único acento de cor do papel nas telas de acesso. */
export function BrandStripe({ role = 'work', className }: { role?: BrandRole; className?: string }) {
  return <div aria-hidden="true" className={cx('h-1 w-full shrink-0', role === 'hire' ? 'bg-company' : 'bg-primary', className)} />
}

/** Marca "W. Worki" (mesmo selo da barra lateral). */
export function BrandMark({ role = 'work', className }: { role?: BrandRole; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden="true"
        className={cx(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white',
          role === 'hire' ? 'bg-black' : 'bg-primary-dark',
        )}
      >
        W.
      </span>
      <span className="text-base font-bold tracking-tight text-gray-900">Worki</span>
    </span>
  )
}
