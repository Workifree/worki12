import { cx } from './cx'

/** Espera pontual sem formato conhecido. Ação do usuário usa `Button loading`. */
export function Spinner({
  size = 20,
  label = 'Carregando',
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  return (
    <span role="status" className={cx('inline-flex', className)}>
      <span
        aria-hidden="true"
        style={{ width: size, height: size }}
        className="animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** Bloco cinza com o formato do conteúdo (decorativo: o anúncio fica no SkeletonList). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx('h-24 rounded-xl bg-gray-200 motion-safe:animate-pulse', className)} />
}

export function SkeletonList({
  count = 3,
  label = 'Carregando',
  itemClassName,
  className,
}: {
  count?: number
  label?: string
  itemClassName?: string
  className?: string
}) {
  return (
    <div role="status" className={cx('space-y-4', className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={itemClassName} />
      ))}
    </div>
  )
}
