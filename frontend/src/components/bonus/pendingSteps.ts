/**
 * "Quase lá": traduz `missing_stamps` de cada turno pendente em o que falta e QUEM faz.
 * Tom neutro: sem acusação, sem prazo e sem prometer que o turno vai contar.
 */
import type { MissingStamp, PendingShift } from './types'

export interface PendingStep {
  stamp: MissingStamp
  actor: 'operator' | 'worker'
  text: string
}

/** Ordem natural do turno. */
const ORDER: MissingStamp[] = [
  'worker_checkin',
  'company_checkin',
  'worker_checkout',
  'company_checkout',
  'payment_record',
  'receipt_confirmation',
]

export function firstName(fullName: string | null): string | null {
  return fullName?.trim().split(/\s+/)[0] || null
}

export function pendingSteps(shift: PendingShift): PendingStep[] {
  const who = firstName(shift.workerName) ?? 'o freela'
  const copy: Record<MissingStamp, Omit<PendingStep, 'stamp'>> = {
    worker_checkin: { actor: 'worker', text: `Falta ${who} fazer o check-in` },
    company_checkin: { actor: 'operator', text: 'Falta você confirmar a chegada' },
    worker_checkout: { actor: 'worker', text: `Falta ${who} fazer o check-out` },
    company_checkout: { actor: 'operator', text: 'Falta você confirmar a saída' },
    payment_record: { actor: 'operator', text: 'Falta registrar o pagamento' },
    receipt_confirmation: { actor: 'worker', text: `Falta ${who} confirmar o recebimento` },
  }
  const missing = new Set(shift.missingStamps)
  // Só dá para confirmar o recebimento depois que o pagamento é registrado.
  if (missing.has('payment_record')) missing.delete('receipt_confirmation')
  return ORDER.filter((stamp) => missing.has(stamp)).map((stamp) => ({ stamp, ...copy[stamp] }))
}

const REMINDER_ACTION: Partial<Record<MissingStamp, string>> = {
  worker_checkin: 'fazer o check-in',
  worker_checkout: 'fazer o check-out',
  receipt_confirmation: 'confirmar o recebimento',
}

/** Mensagem pronta para o freela; null quando não há nada que dependa dele. */
export function reminderMessage(shift: PendingShift, dateLabel: string, appUrl: string): string | null {
  const actions = pendingSteps(shift)
    .map((step) => REMINDER_ACTION[step.stamp])
    .filter((a): a is string => a !== undefined)
  if (actions.length === 0) return null
  const name = firstName(shift.workerName)
  const day = dateLabel ? ` de ${dateLabel}` : ''
  return `Oi${name ? `, ${name}` : ''}! Quando puder, falta ${actions.join(' e ')} do turno "${shift.jobTitle}"${day} no Workyn: ${appUrl}`
}
