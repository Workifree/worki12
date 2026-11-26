import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card } from '../ui'
import PixKeyForm from './PixKeyForm'
import type { BonusTrailSnapshot, PayoutOutcome, PixOutcome } from './types'
import { centsToBRL, missingToMinimum, payoutMessage, pixMessage, shortDate } from './trailView'

interface PayoutPanelProps {
  snapshot: BonusTrailSnapshot
  onRequest: () => Promise<PayoutOutcome>
  onCancel: () => Promise<PayoutOutcome>
  onSavePix: (key: string) => Promise<PixOutcome>
  /** Mensagem de feedback (toast da página). */
  notify: (message: string, type: 'success' | 'error' | 'info') => void
}

/**
 * Pedido de PIX de segunda (R25), chave PIX (R24b) e histórico. O botão nunca é "desabilitado
 * mudo": abaixo do mínimo, o clique explica quanto falta.
 */
export default function PayoutPanel({ snapshot: s, onRequest, onCancel, onSavePix, notify }: PayoutPanelProps) {
  const [busy, setBusy] = useState(false)
  const [editingPix, setEditingPix] = useState(false)
  const [inlineNotice, setInlineNotice] = useState<string | null>(null)

  const ended = s.status === 'ended'
  const hasRequest = s.requestedPayoutCents !== null
  const belowMin = s.availableCents < s.minPayoutCents && !(ended && s.availableCents > 0)
  const missing = missingToMinimum(s.availableCents, s.minPayoutCents)

  const request = async () => {
    if (belowMin) {
      setInlineNotice(
        s.availableCents === 0
          ? payoutMessage('nothing_available', s.minPayoutCents)
          : `Faltam ${centsToBRL(missing)} para o mínimo de ${centsToBRL(s.minPayoutCents)}. Você não perde nada: o valor continua disponível para você.`,
      )
      return
    }
    if (!s.pixKeyMasked) {
      setEditingPix(true)
      setInlineNotice(payoutMessage('no_pix_key', s.minPayoutCents))
      return
    }
    setBusy(true)
    try {
      const outcome = await onRequest()
      setInlineNotice(null)
      notify(payoutMessage(outcome, s.minPayoutCents), outcome === 'ok' ? 'success' : 'info')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    setBusy(true)
    try {
      const outcome = await onCancel()
      const failure = outcome === 'too_late' ? 'O prazo para cancelar este pedido já passou.' : 'Não foi possível cancelar agora.'
      notify(outcome === 'ok' ? 'Pedido cancelado. O valor voltou para disponível.' : failure, outcome === 'ok' ? 'success' : 'error')
    } finally {
      setBusy(false)
    }
  }

  const savePix = async (key: string) => {
    setBusy(true)
    try {
      const outcome = await onSavePix(key)
      notify(pixMessage(outcome), outcome === 'ok' ? 'success' : 'error')
      if (outcome === 'ok') {
        setEditingPix(false)
        setInlineNotice(null)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="bonus-payout-title" className="space-y-3">
      <h2 id="bonus-payout-title" className="text-xl font-bold">
        Receber por PIX
      </h2>
      <Card>
        {hasRequest ? (
          <div className="space-y-3">
            <p className="text-base font-bold">
              Pedido de {centsToBRL(s.requestedPayoutCents ?? 0)} feito.
              {s.nextPayoutDate ? ` O PIX sai na segunda, ${shortDate(s.nextPayoutDate)}.` : ' O PIX sai na próxima segunda.'}
            </p>
            <Button variant="secondary" size="lg" fullWidth onClick={cancel} loading={busy}>
              Cancelar pedido
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Button
              variant="dark"
              fullWidth
              loading={busy}
              onClick={request}
              aria-disabled={belowMin || undefined}
              className={`!h-16 text-lg font-bold ${belowMin ? 'opacity-60' : ''}`}
            >
              Pedir PIX de segunda
            </Button>
            <p className="text-sm text-gray-700">
              {belowMin
                ? `Pedido mínimo de ${centsToBRL(s.minPayoutCents)}${s.availableCents > 0 ? ` · faltam ${centsToBRL(missing)}` : ''}.`
                : 'O PIX é enviado toda segunda, para a chave cadastrada.'}
            </p>
            {inlineNotice && (
              <p role="status" data-testid="bonus-payout-notice" className="rounded-xl border-2 border-black bg-blue-50 p-3 text-sm font-bold">
                {inlineNotice}
              </p>
            )}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="text-base font-bold">Sua chave PIX</h3>
        {editingPix ? (
          <div className="mt-3">
            <PixKeyForm submitLabel="Salvar chave" busy={busy} onSubmit={savePix} onCancel={() => setEditingPix(false)} />
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-base font-bold tabular-nums">{s.pixKeyMasked ?? 'Nenhuma chave cadastrada'}</p>
            <Button variant="secondary" size="lg" onClick={() => setEditingPix(true)} disabled={hasRequest}>
              {s.pixKeyMasked ? 'Trocar chave' : 'Cadastrar chave'}
            </Button>
          </div>
        )}
        {hasRequest && <p className="mt-2 text-sm text-gray-600">Para trocar a chave, cancele o pedido antes.</p>}
      </Card>

      {s.payouts.length > 0 && (
        <Card>
          <h3 className="text-base font-bold">PIX enviados</h3>
          <ul className="mt-3 divide-y-2 divide-gray-200">
            {s.payouts.map((p) => (
              <li key={p.id} className="py-3">
                <p className="flex justify-between text-base font-bold tabular-nums">
                  <span>{shortDate(p.paidAt)}</span>
                  <span>{centsToBRL(p.amountCents)}</span>
                </p>
                {p.milestoneTitles.length > 0 && <p className="mt-1 text-sm text-gray-600">{p.milestoneTitles.join(', ')}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-sm">
        <Link to="/regulamento-trilha" className="inline-flex min-h-11 items-center font-bold underline">
          Ler o regulamento da trilha
        </Link>
      </p>
    </section>
  )
}
