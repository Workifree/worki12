import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cx } from './cx'

export interface ListRowProps {
  leading?: ReactNode
  title: ReactNode
  meta?: ReactNode
  /** Valor, selo ou menu. Fica FORA da área clicável (nunca botão dentro de botão). */
  trailing?: ReactNode
  /** Linha clicável: use `to` (navegação) ou `onActivate` (ação). Ganha chevron. */
  to?: string
  onActivate?: () => void
  className?: string
}

const AREA = 'flex min-h-[4.5rem] min-w-0 flex-1 items-center gap-3 px-3 py-2'
const PRESS =
  'transition-colors duration-fast hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black'

/** Linha de lista densa (72px ou mais). Agrupe em `<ul className="divide-y divide-gray-200">`. */
export function ListRow({ leading, title, meta, trailing, to, onActivate, className }: ListRowProps) {
  const body = (
    <>
      {leading}
      <span className="min-w-0 flex-1 text-left">
        <span className="line-clamp-2 break-words text-sm font-bold text-black">{title}</span>
        {meta && <span className="mt-0.5 block text-xs text-gray-600">{meta}</span>}
      </span>
      {(to || onActivate) && <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-gray-500" />}
    </>
  )
  return (
    <div className={cx('flex items-center', className)}>
      {to ? (
        <Link to={to} className={cx(AREA, PRESS)}>
          {body}
        </Link>
      ) : onActivate ? (
        <button type="button" onClick={onActivate} className={cx(AREA, PRESS)}>
          {body}
        </button>
      ) : (
        <div className={AREA}>{body}</div>
      )}
      {trailing && <div className="flex shrink-0 items-center gap-2 pr-3">{trailing}</div>}
    </div>
  )
}
