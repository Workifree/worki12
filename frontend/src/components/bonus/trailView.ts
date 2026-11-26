import { format } from 'date-fns'
import { formatBRL } from '../../lib/currency'
import { parseDateOnly, toBrazilDateOnly } from '../../lib/dateUtils'
import { addDaysTo } from '../../lib/todayView'
import type { AcceptOutcome, BonusMilestone, PayoutOutcome, PixOutcome } from './types'

export const MAX_ACTIVE_MILESTONES = 3

export type MilestoneView = BonusMilestone & { view: 'done' | 'active' | 'locked' | 'excluded' }

/** Conquista que vale: award `not_counted` nunca aparece como concluído. */
export function isEarned(m: BonusMilestone): boolean {
  return m.earned && m.awardState !== 'not_counted'
}

/**
 * R21: concluídos acesos; os 3 primeiros não concluídos (em `sortOrder`) ativos; o resto trancado.
 * Trancar é só visual: marco já conquistado acende mesmo que esteja "adiante" (A26).
 */
export function buildRoadmap(milestones: BonusMilestone[]): MilestoneView[] {
  const sorted = [...milestones].sort((a, b) => a.sortOrder - b.sortOrder)
  let activeLeft = MAX_ACTIVE_MILESTONES
  return sorted.map((m) => {
    if (isEarned(m)) return { ...m, view: 'done' as const }
    // Fora da contagem: linha neutra, sem check, sem ocupar vaga de marco ativo.
    if (m.awardState === 'not_counted') return { ...m, view: 'excluded' as const }
    if (activeLeft > 0) {
      activeLeft -= 1
      return { ...m, view: 'active' as const }
    }
    return { ...m, view: 'locked' as const }
  })
}

/** "N de total": o total vem dos marcos devolvidos pelo banco (`counts_in_total`). */
export function milestoneCount(milestones: BonusMilestone[]): { done: number; total: number } {
  const counted = milestones.filter((m) => m.countsInTotal)
  return { done: counted.filter(isEarned).length, total: counted.length }
}

export function centsToBRL(cents: number): string {
  return formatBRL(cents / 100)
}

/** Data civil em America/Sao_Paulo: data-only passa direto; timestamp é convertido (não é o dia UTC). */
function brazilDay(value: string): string {
  return value.length > 10 ? toBrazilDateOnly(value) : value
}

/** dd/MM em America/Sao_Paulo. Vazio devolve ''. */
export function shortDate(value: string | null): string {
  if (!value) return ''
  return format(parseDateOnly(brazilDay(value)), 'dd/MM')
}

/**
 * Último dia da trilha (dd/MM). `ends_at` é EXCLUSIVO: `starts_at` é 00:00 local e
 * `ends_at = starts_at + 84 dias` (spec R3), ou seja, o início do dia seguinte ao último.
 */
export function lastTrailDay(endsAt: string | null): string {
  if (!endsAt) return ''
  return shortDate(addDaysTo(brazilDay(endsAt), -1))
}

export function progressPercent(current: number, target: number): number {
  if (target <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((current / target) * 100)))
}

export function missingToMinimum(availableCents: number, minCents: number): number {
  return Math.max(0, minCents - availableCents)
}

export function acceptMessage(outcome: AcceptOutcome): string {
  switch (outcome) {
    case 'identity_required':
      return 'A trilha é para quem opera com login próprio.'
    case 'track_not_open':
      return 'Esta trilha ainda não está aberta.'
    case 'disabled':
      return 'A trilha não está disponível no momento.'
    case 'ack_missing':
    case 'not_invited':
      return 'Sua inscrição ainda não está liberada. Fale com a equipe do Worki.'
    default:
      return 'Não foi possível entrar na trilha agora. Tente de novo em instantes.'
  }
}

export function payoutMessage(outcome: PayoutOutcome, minPayoutCents: number): string {
  switch (outcome) {
    case 'ok':
      return 'Pedido feito. A data do PIX aparece na tela.'
    case 'below_minimum':
      return `O pedido mínimo é de ${centsToBRL(minPayoutCents)}. Quando o disponível chegar a esse valor, você poderá pedir.`
    case 'no_pix_key':
      return 'Cadastre sua chave PIX para pedir o PIX.'
    case 'already_requested':
      return 'Você já tem um pedido para a próxima segunda.'
    case 'nothing_available':
      return 'Ainda não há valor disponível para pedir.'
    case 'disabled':
      return 'A trilha não está disponível no momento.'
    default:
      return 'Não foi possível pedir agora. Tente de novo em instantes.'
  }
}

export function pixMessage(outcome: PixOutcome): string {
  switch (outcome) {
    case 'ok':
      return 'Chave PIX salva.'
    case 'open_payout':
      return 'Há um pedido aberto. Cancele o pedido antes de trocar a chave.'
    case 'invalid':
      return 'Confira a chave PIX e tente de novo.'
    default:
      return 'Não foi possível salvar a chave agora.'
  }
}
