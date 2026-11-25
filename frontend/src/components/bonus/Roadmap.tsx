import { Check, Lock } from 'lucide-react'
import { cx } from '../ui/cx'
import type { BonusMilestone } from './types'
import { buildRoadmap, centsToBRL, progressPercent, shortDate, type MilestoneView } from './trailView'

interface RoadmapProps {
  milestones: BonusMilestone[]
  /** Trilha encerrada: o que não foi conquistado aparece como "não conquistado", nunca como perda. */
  ended: boolean
}

const ROW_BASE = 'relative rounded-2xl border-2 p-4 sm:p-5'

function awardLine(m: MilestoneView): string {
  switch (m.awardState) {
    case 'validating':
      if (m.releaseText) return m.releaseText.charAt(0).toUpperCase() + m.releaseText.slice(1)
      return m.availableAt ? `Libera em ${shortDate(m.availableAt)}` : 'Liberando'
    case 'available':
      return 'Disponível para saque'
    case 'in_payout':
      return 'No pedido de PIX'
    case 'paid':
      return 'PIX enviado'
    default:
      return ''
  }
}

function MilestoneItem({ m, ended }: { m: MilestoneView; ended: boolean }) {
  const value = m.amountCents > 0 ? centsToBRL(m.amountCents) : 'Sem valor'
  const pct = m.progress ? progressPercent(m.progress.current, m.progress.target) : 0

  return (
    <li
      data-state={m.view}
      className={cx(
        ROW_BASE,
        m.view === 'done' && 'border-black bg-blue-50',
        m.view === 'active' && 'border-black bg-white shadow-[6px_6px_0px_0px_rgba(37,99,235,1)]',
        (m.view === 'locked' || m.view === 'excluded') && 'border-gray-300 bg-gray-50 text-gray-600',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cx(
            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2',
            m.view === 'done' ? 'border-black bg-blue-600 text-white' : m.view === 'active' ? 'border-black bg-white' : 'border-gray-300 bg-white',
          )}
        >
          {m.view === 'done' ? <Check className="h-5 w-5" /> : m.view === 'locked' ? <Lock className="h-4 w-4" /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h3 className="text-base font-black">{m.title}</h3>
            <span className="text-base font-black tabular-nums">{value}</span>
          </div>
          <p className="sr-only">
            {m.view === 'done' ? 'Concluído' : m.view === 'active' ? 'Em andamento' : m.view === 'excluded' ? 'Fora da contagem' : 'Trancado'}
          </p>

          {m.view === 'done' && (
            <p className="mt-1 text-sm text-gray-700">
              {m.earnedAt ? `Concluído em ${shortDate(m.earnedAt)}` : 'Concluído'}
              {awardLine(m) ? ` · ${awardLine(m)}` : ''}
            </p>
          )}

          {m.view === 'active' && m.progress && (
            <div className="mt-3">
              <div
                role="progressbar"
                aria-label={`Progresso: ${m.title}`}
                aria-valuemin={0}
                aria-valuemax={m.progress.target}
                aria-valuenow={m.progress.current}
                className="h-3 w-full overflow-hidden rounded-full border-2 border-black bg-white"
              >
                <div className="h-full bg-blue-600 transition-[width] motion-reduce:transition-none" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-sm font-bold tabular-nums">
                {m.progress.current} de {m.progress.target} {m.progress.unit}
              </p>
            </div>
          )}

          {m.view === 'active' && !m.progress && <p className="mt-1 text-sm text-gray-700">Em andamento</p>}

          {!ended && m.key === 'constancy' && (m.view === 'active' || m.view === 'locked') && (
            <p className="mt-1 text-sm font-bold">Só fecha no fim da trilha.</p>
          )}

          {m.view === 'excluded' && <p className="mt-1 text-sm">Esse turno não entrou na contagem</p>}

          {m.view === 'locked' && (
            <p className="mt-1 text-sm">
              {ended ? 'Não conquistado' : 'Trancado por enquanto'}
            </p>
          )}
        </div>
      </div>
    </li>
  )
}

/** Roadmap vertical dos marcos (R21): acesos, no máximo 3 ativos, o resto trancado com o valor à vista. */
export default function Roadmap({ milestones, ended }: RoadmapProps) {
  const items = buildRoadmap(milestones)
  return (
    <ol aria-label="Marcos da trilha" className="space-y-3">
      {items.map((m) => (
        <MilestoneItem key={m.id} m={ended && m.view === 'active' ? { ...m, view: 'locked' } : m} ended={ended} />
      ))}
    </ol>
  )
}
