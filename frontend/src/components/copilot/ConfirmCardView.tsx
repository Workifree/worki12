import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
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

  // Foco: vai para o cartão quando ele abre ("Não fazer", o primeiro controle: Enter por engano não
  // confirma nada) e volta para onde estava quando ele fecha.
  const box = useRef<HTMLDivElement>(null)
  const firstButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    firstButton.current?.focus({ preventScroll: true })
    return () => {
      if (opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true })
    }
  }, [])

  // Tab não sai do cartão enquanto ele espera a resposta.
  const trapTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !box.current) return
    const items = Array.from(box.current.querySelectorAll<HTMLElement>('button:not([disabled]),[tabindex]:not([tabindex="-1"])'))
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || !box.current.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !box.current.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      ref={box}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="copilot-confirm-title"
      aria-describedby="copilot-confirm-action"
      onKeyDown={trapTab}
      className="flex min-h-0 flex-col gap-3">
      <h2 id="copilot-confirm-title" className="flex items-center gap-2 text-base font-bold">
        <ShieldCheck size={20} aria-hidden="true" /> Confirme antes
      </h2>
      <p className="text-xs text-gray-600">Tela: {card.screen}</p>
      <p id="copilot-confirm-action" className="break-words text-sm font-semibold">{card.action}</p>
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
        <PillButton ref={firstButton} tone="light" onClick={() => onAnswer(false)}>
          Não fazer
        </PillButton>
        <PillButton tone={role === 'company' ? 'dark' : 'green'} disabled={!armed} onClick={() => onAnswer(true)}>
          Confirmar
        </PillButton>
      </div>
    </div>
  )
}
