import { useMemo, useState } from 'react'
import { PartyPopper, X } from 'lucide-react'
import { IconButton } from '../ui'
import { centsToBRL } from './trailView'

export interface Celebration {
  awardId: string
  title: string
  amountCents: number
}

interface CelebrationBannerProps {
  items: Celebration[]
  onClose: () => void
}

const COLORS = ['#2563EB', '#00A651', '#111111', '#FACC15', '#F472B6']
const PIECES = 36

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Posição determinística: confete estável entre renders, sem Math.random no render. */
function pieceStyle(i: number): React.CSSProperties {
  const delay = ((i * 53) % 60) / 100
  const duration = 1.6 + ((i * 29) % 12) / 10
  return {
    left: `${(i * 37) % 100}%`,
    backgroundColor: COLORS[i % COLORS.length],
    animation: `bonus-confetti-fall ${duration}s ease-in ${delay}s both`,
  }
}

/**
 * Comemoração ao concluir marco (R24): aviso NÃO modal (a região `role="status"` fica na página,
 * já montada) e confete decorativo em CSS puro. Com `prefers-reduced-motion`, sem animação.
 */
export default function CelebrationBanner({ items, onClose }: CelebrationBannerProps) {
  const [reduced] = useState(prefersReducedMotion)
  const pieces = useMemo(() => Array.from({ length: PIECES }, (_, i) => i), [])
  const total = items.reduce((sum, i) => sum + i.amountCents, 0)

  return (
    <>
      {!reduced && (
        <>
          <style>{`@keyframes bonus-confetti-fall { from { transform: translateY(-10vh) rotate(0deg); opacity: 1 } to { transform: translateY(110vh) rotate(540deg); opacity: 0 } }`}</style>
          <div aria-hidden="true" data-testid="bonus-confetti" className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
            {pieces.map((i) => (
              <span key={i} className="absolute top-0 h-3 w-2 rounded-sm" style={pieceStyle(i)} />
            ))}
          </div>
        </>
      )}
      <div className="flex items-start gap-3 rounded-2xl border-2 border-black bg-white p-4 shadow-[6px_6px_0px_0px_rgba(37,99,235,1)]">
        <PartyPopper aria-hidden="true" className="mt-1 h-7 w-7 shrink-0 text-blue-600" />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold">
            {items.length === 1 ? 'Marco concluído!' : `${items.length} marcos concluídos!`}
          </p>
          <p className="text-sm font-bold text-gray-700">{items.map((i) => i.title).join(', ')}</p>
          {total > 0 && <p className="mt-1 text-2xl font-bold tabular-nums">+ {centsToBRL(total)}</p>}
        </div>
        <IconButton aria-label="Fechar aviso" onClick={onClose}>
          <X aria-hidden="true" className="h-5 w-5" />
        </IconButton>
      </div>
    </>
  )
}
