/**
 * Próxima ação da empresa por ESTADO do turno. Puro, sem rede: Hoje, Início, Turnos, Detalhe e
 * Presença usam as mesmas regras, para o mesmo estado ter o mesmo selo e o mesmo verbo.
 */

import type { StatusTone } from './statusLabels'

export type OccupancyKey = 'empty' | 'partial' | 'full' | 'unknown'

export interface Occupancy {
  key: OccupancyKey
  tone: StatusTone
  /** Texto do selo ("Sem freela", "Falta 1", "Completo"). */
  label: string
  /** Ainda há vaga para preencher. */
  needsPeople: boolean
}

/** `filled` nulo = a leitura falhou ou não veio: nunca vira "0 preenchidas". */
export function occupancy(slots: number | null | undefined, filled: number | null | undefined): Occupancy {
  if (filled === null || filled === undefined) {
    return { key: 'unknown', tone: 'neutral', label: 'Ocupação não carregada', needsPeople: false }
  }
  const total = slots ?? 1
  if (filled >= total) return { key: 'full', tone: 'success', label: 'Completo', needsPeople: false }
  if (filled <= 0) return { key: 'empty', tone: 'warning', label: 'Sem freela', needsPeople: true }
  return { key: 'partial', tone: 'warning', label: `Falta ${total - filled}`, needsPeople: true }
}

export type ShiftStepKind = 'call' | 'checkin' | 'checkout' | 'pay' | 'view'

export interface ShiftStep {
  kind: ShiftStepKind
  label: string
}

export interface ApplicationStepInput {
  status: string
  company_checkin_confirmed_at?: string | null
  company_checkout_confirmed_at?: string | null
}

/**
 * Próximo passo de UM freela no turno. `paymentStatus`: marcador ativo ('scheduled' | 'recorded'),
 * `null` = não há, `undefined` = não foi lido (não oferecer pagamento às cegas).
 */
export function applicationStep(app: ApplicationStepInput, paymentStatus?: string | null): ShiftStep {
  if (app.status === 'hired' || app.status === 'in_progress') {
    if (!app.company_checkin_confirmed_at) return { kind: 'checkin', label: 'Registrar chegada' }
    if (!app.company_checkout_confirmed_at) return { kind: 'checkout', label: 'Registrar saída' }
    if (paymentStatus === null) return { kind: 'pay', label: 'Registrar pagamento' }
    return { kind: 'view', label: 'Ver turno' }
  }
  if (app.status === 'completed' && paymentStatus === null) return { kind: 'pay', label: 'Registrar pagamento' }
  return { kind: 'view', label: 'Ver turno' }
}

/**
 * Ação principal do turno inteiro: o que está mais atrasado no fluxo vem primeiro. O verbo de
 * presença e pagamento leva à tela "Presença e pagamento".
 */
export function shiftStep(slots: number | null | undefined, applications: ApplicationStepInput[]): ShiftStep {
  const filled = applications.filter((a) => ['hired', 'in_progress', 'completed'].includes(a.status)).length
  if (filled === 0) return { kind: 'call', label: 'Chamar freelas' }
  const steps = applications
    .filter((a) => a.status === 'hired' || a.status === 'in_progress')
    .map((a) => applicationStep(a, null).kind)
  if (steps.includes('pay')) return { kind: 'pay', label: 'Registrar pagamento' }
  if (steps.includes('checkout')) return { kind: 'checkout', label: 'Registrar saída' }
  if (steps.includes('checkin')) return { kind: 'checkin', label: 'Marcar presença' }
  if (filled < (slots ?? 1)) return { kind: 'call', label: 'Chamar freelas' }
  return { kind: 'view', label: 'Presença e pagamento' }
}

/** "Sex., 27/11 · 10:00–14:00". Usa só a parte da data (sem deslocar pelo fuso do aparelho). */
export function shiftWhen(startDate: string | null | undefined, start?: string | null, end?: string | null): string {
  const time = start ? `${start.slice(0, 5)}${end ? `–${end.slice(0, 5)}` : ''}` : ''
  const [y, m, d] = (startDate ?? '').split('T')[0].split('-').map(Number)
  if (!y || !m || !d) return time || 'Data a combinar'
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
  const day = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
  return time ? `${day} · ${time}` : day
}
