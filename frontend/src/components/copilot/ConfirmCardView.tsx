import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { PillButton } from './PillButton'
import type { ConfirmCard } from '../../lib/copilot/ui'

/** Cartão montado pelo código. O botão de confirmar só habilita depois de um instante. */
export function ConfirmCardView({
  card,
  role,
  armDelayMs = 600,
  onAnswer,
}: {
  card: ConfirmCard
  role: 'company' | 'worker'
  armDelayMs?: number
  onAnswer: (ok: boolean) => void
}) {
  // Evita que um toque já a caminho confirme sem a pessoa ter lido.
  const [armed, setArmed] = useState(armDelayMs <= 0)
  useEffect(() => {
    const timer = window.setTimeout(() => setArmed(true), armDelayMs)
    return () => window.clearTimeout(timer)
  }, [armDelayMs])

  return (
    <div role="alertdialog" aria-labelledby="copilot-confirm-title" className="flex min-h-0 flex-col gap-3">
      <h2 id="copilot-confirm-title" className="flex items-center gap-2 text-base font-bold">
        <ShieldCheck size={20} aria-hidden="true" /> Confirme antes
      </h2>
      <p className="text-xs text-gray-600">Tela: {card.screen}</p>
      <p className="break-words text-sm font-semibold">{card.action}</p>
      <p className="text-sm text-gray-600">{card.reason}</p>
      {card.fields.length > 0 && (
        <dl className="max-h-[28dvh] min-h-16 shrink space-y-1 overflow-y-auto overscroll-contain rounded-2xl bg-white/70 p-3 ring-1 ring-black/10 text-sm">
          {card.fields.map((field, i) => (
            <div key={`${field.label}-${i}`} className="flex flex-wrap gap-x-2">
              <dt className="text-gray-600">{field.label}:</dt>
              <dd className="min-w-0 break-words font-semibold">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <PillButton tone="light" onClick={() => onAnswer(false)}>
          Não fazer
        </PillButton>
        <PillButton tone={role === 'company' ? 'dark' : 'green'} disabled={!armed} onClick={() => onAnswer(true)}>
          Confirmar
        </PillButton>
      </div>
    </div>
  )
}
