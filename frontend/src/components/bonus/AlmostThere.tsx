import { Link } from 'react-router-dom'
import { ArrowRight, Info, MessageCircle } from 'lucide-react'
import { Card } from '../ui'
import { buildWhatsAppUrl } from '../../services/teamMembersService'
import { pendingSteps, reminderMessage, firstName } from './pendingSteps'
import type { PendingShift } from './types'
import { shortDate } from './trailView'

interface AlmostThereProps {
  shifts: PendingShift[]
}

const ACTION_CLASS =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-black px-5 text-sm font-bold ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2'

/** "Quase lá": turnos que ainda têm passos em aberto, com quem faz cada um. */
export default function AlmostThere({ shifts }: AlmostThereProps) {
  const rows = shifts.map((shift) => ({ shift, steps: pendingSteps(shift) })).filter((r) => r.steps.length > 0 || r.shift.warnings.length > 0)
  if (rows.length === 0) return null

  return (
    <section aria-labelledby="bonus-almost-title" className="space-y-3">
      <div>
        <h2 id="bonus-almost-title" className="text-xl font-bold">
          Quase lá
        </h2>
        <p className="text-sm text-gray-700">Turnos com passos em aberto.</p>
      </div>
      <ul className="space-y-3">
        {rows.map(({ shift, steps }, index) => {
          const day = shortDate(shift.shiftDate)
          const message = reminderMessage(shift, day, `${window.location.origin}/my-jobs`)
          // Só com aviso (nenhum passo em aberto), o operador ainda pode abrir o turno para ver os horários.
          const showOpenShift = steps.length === 0 || steps.some((s) => s.actor === 'operator')
          return (
            <Card as="li" padding="sm" key={`${shift.jobId}-${index}`} className="list-none">
              <h3 className="text-base font-bold">{shift.jobTitle}</h3>
              <p className="text-sm text-gray-600">{[day, shift.workerName].filter(Boolean).join(' · ')}</p>
              {steps.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-bold">
                  {steps.map((s) => (
                    <li key={s.stamp}>{s.text}</li>
                  ))}
                </ul>
              )}
              {/* Aviso informativo, em tom neutro: sem vermelho, sem alerta e sem atribuir culpa. */}
              {shift.warnings.map((warning) => (
                <p key={warning} className="mt-2 flex items-start gap-2 rounded-xl bg-blue-50 p-3 text-sm text-gray-800">
                  <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                  <span>{warning}</span>
                </p>
              ))}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                {showOpenShift && (
                  <Link to={`/company/jobs/${shift.jobId}/candidates`} className={`${ACTION_CLASS} bg-black text-white`}>
                    Abrir o turno
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                )}
                {/* Mesmo deep link wa.me do projeto, sem telefone: o WhatsApp pede para escolher o contato. */}
                {message && (
                  <a
                    href={buildWhatsAppUrl(message)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Lembrar ${firstName(shift.workerName) ?? 'o freela'} pelo WhatsApp sobre ${shift.jobTitle}`}
                    className={`${ACTION_CLASS} bg-white text-black`}
                  >
                    <MessageCircle aria-hidden="true" className="h-4 w-4" />
                    Lembrar pelo WhatsApp
                  </a>
                )}
              </div>
            </Card>
          )
        })}
      </ul>
    </section>
  )
}
