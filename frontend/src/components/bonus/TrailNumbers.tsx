import { Card } from '../ui'
import type { BonusTrailSnapshot } from './types'
import { centsToBRL, missingToMinimum, shortDate } from './trailView'

interface TrailNumbersProps {
  snapshot: BonusTrailSnapshot
}

function Big({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <Card padding="sm" as="li" className="list-none">
      <p className="text-xs font-bold text-gray-600">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
      {children && <p className="mt-1 text-sm text-gray-600">{children}</p>}
    </Card>
  )
}

/** Os três números do topo (R23). Sem as palavras proibidas; datas sempre reais. */
export default function TrailNumbers({ snapshot: s }: TrailNumbersProps) {
  // O texto neutro do banco tem prioridade; sem ele, a data real. Nunca um prazo inventado na tela.
  const when = s.releaseText ?? (s.releasingUntil ? `libera em ${shortDate(s.releasingUntil)}` : null)
  const releasing =
    s.releasingCents > 0 ? `${centsToBRL(s.releasingCents)} liberando${when ? ` — ${when}` : ''}` : null

  const missing = missingToMinimum(s.availableCents, s.minPayoutCents)
  const showMissing = s.status === 'active' && s.requestedPayoutCents === null && missing > 0

  return (
    <ul aria-label="Seus números da trilha" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Big label="Bônus conquistado" value={centsToBRL(s.earnedCents)}>
        {releasing}
      </Big>
      <Big label="Disponível para saque" value={centsToBRL(s.availableCents)}>
        {showMissing ? `Faltam ${centsToBRL(missing)} para o mínimo de ${centsToBRL(s.minPayoutCents)}` : null}
      </Big>
      <Big
        label="Próximo PIX (segunda)"
        value={s.requestedPayoutCents !== null ? centsToBRL(s.requestedPayoutCents) : 'Nenhum pedido'}
      >
        {s.nextPayoutDate ? `Segunda, ${shortDate(s.nextPayoutDate)}` : null}
      </Big>
    </ul>
  )
}
