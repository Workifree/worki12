import { useLayoutEffect, useRef, useState } from 'react'
import type { HTMLAttributes } from 'react'
import type { StatusTone } from '../../lib/statusLabels'
import { cx } from './cx'
import './status-list.css'

export interface StatusPillProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  tone: StatusTone
  label: string
  /** Estado "vivo" (aguardando, em andamento): ponto que respira e brilho deslizante. */
  live?: boolean
}

/** Pílula de status do laboratório visual. O texto é sempre real; o brilho é só decoração (aria-hidden). */
export function StatusPill({ tone, label, live = false, className, ...rest }: StatusPillProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [w, setW] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (live && ref.current) setW(Math.ceil(ref.current.getBoundingClientRect().width))
  }, [live, label])
  return (
    <span {...rest} data-tone={tone} data-live={live ? '' : undefined} className={cx('wk-spill', className)}>
      {live && <i className="wk-spill__dot" aria-hidden="true" />}
      <span className="wk-spill__shim" style={w ? ({ '--w': `${w}px` } as React.CSSProperties) : undefined}>
        <span ref={ref}>{label}</span>
        {live && w !== null && (
          <span className="wk-spill__win" aria-hidden="true">
            <span className="wk-spill__txt">{label}</span>
          </span>
        )}
      </span>
    </span>
  )
}
