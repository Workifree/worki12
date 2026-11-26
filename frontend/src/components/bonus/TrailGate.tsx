import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Lock, Sparkles } from 'lucide-react'
import { Button, Card } from '../ui'
import PixKeyForm from './PixKeyForm'
import type { AcceptOutcome, BonusTrailStatus } from './types'
import { acceptMessage, centsToBRL } from './trailView'

interface TrailGateProps {
  status: Extract<BonusTrailStatus, 'disabled' | 'not_enrolled' | 'invited' | 'identity_required'>
  minPayoutCents: number
  onAccept: (pixKey: string | null) => Promise<AcceptOutcome>
}

/** Estados sem trilha ativa: desligada/sem inscrição, sem login próprio e convite com aceite do regulamento. */
export default function TrailGate({ status, minPayoutCents, onAccept }: TrailGateProps) {
  const [agreed, setAgreed] = useState(false)
  const [pix, setPix] = useState<string | null>(null)
  const [addingPix, setAddingPix] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (status === 'identity_required') {
    return (
      <Card className="text-center">
        <Lock aria-hidden="true" className="mx-auto h-8 w-8" />
        <h2 className="mt-3 text-xl font-bold">A trilha é para quem opera com login próprio</h2>
        <p className="mt-2 text-sm text-gray-700">
          Quando você entrar com o seu próprio acesso, a trilha aparece aqui. Se tiver dúvida, fale com a equipe do Worki.
        </p>
      </Card>
    )
  }

  if (status === 'disabled' || status === 'not_enrolled') {
    return (
      <Card className="text-center">
        <h2 className="text-xl font-bold">A trilha não está disponível para você agora</h2>
        <p className="mt-2 text-sm text-gray-700">Assim que houver um convite para você, ele aparece aqui.</p>
      </Card>
    )
  }

  const accept = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const outcome = await onAccept(pix)
      if (outcome !== 'ok') setMessage(acceptMessage(outcome))
    } catch {
      setMessage(acceptMessage('error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-5">
      <div className="flex items-start gap-3">
        <Sparkles aria-hidden="true" className="mt-1 h-6 w-6 shrink-0 text-blue-600" />
        <div>
          <h2 className="text-xl font-bold">Você recebeu um convite para a trilha de bônus</h2>
          <p className="mt-1 text-sm text-gray-700">
            Cada passo que você conclui no Worki vira um marco, e cada marco vale um bônus em dinheiro, pago por PIX toda segunda.
          </p>
        </div>
      </div>

      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>Você começa com 2 marcos já concluídos.</li>
        <li>Contam turnos reais, com presença confirmada dos dois lados.</li>
        <li>Nada que você conquista se perde. Sem pegadinha e sem penalidade.</li>
        <li>O pedido de PIX tem o mínimo de {centsToBRL(minPayoutCents)}.</li>
        <li>O bônus é pago pelo próprio Worki, direto na sua chave PIX.</li>
      </ul>

      <p className="text-sm">
        <Link to="/regulamento-trilha" target="_blank" rel="noopener" className="inline-flex min-h-11 items-center font-bold underline">
          Ler o regulamento de 1 página
        </Link>
      </p>

      <div className="rounded-xl border-2 border-black p-4">
        <h3 className="text-base font-bold">Chave PIX (opcional agora)</h3>
        {pix && !addingPix ? (
          <div className="mt-1 space-y-2">
            <p className="text-sm">Chave pronta para o seu primeiro pedido.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" size="lg" onClick={() => setAddingPix(true)}>
                Trocar chave
              </Button>
              <Button variant="ghost" size="lg" onClick={() => setPix(null)}>
                Remover chave
              </Button>
            </div>
          </div>
        ) : addingPix ? (
          <div className="mt-3">
            <PixKeyForm
              submitLabel="Usar esta chave"
              onSubmit={(key) => {
                setPix(key)
                setAddingPix(false)
              }}
              onCancel={() => setAddingPix(false)}
            />
          </div>
        ) : (
          <Button variant="secondary" size="lg" className="mt-2" onClick={() => setAddingPix(true)}>
            Cadastrar chave PIX
          </Button>
        )}
        <p className="mt-2 text-xs text-gray-600">Você pode cadastrar depois, na própria tela da trilha.</p>
      </div>

      <label className="flex min-h-12 cursor-pointer items-start gap-3 text-sm font-bold">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-6 w-6 shrink-0 rounded border-2 border-black"
        />
        <span>Li e concordo com o regulamento da trilha de bônus.</span>
      </label>

      {message && (
        <p role="alert" className="rounded-xl border-2 border-black bg-blue-50 p-3 text-sm font-bold">
          {message}
        </p>
      )}

      <Button variant="dark" size="lg" fullWidth loading={busy} disabled={!agreed} onClick={accept} className="!h-14 text-base">
        Entrar na trilha
      </Button>
    </Card>
  )
}
