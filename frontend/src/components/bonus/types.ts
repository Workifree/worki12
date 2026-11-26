/**
 * Contrato da tela do operador da Trilha de bônus (spec trilha-bonus-operador, R20-R25).
 *
 * `BonusTrailApi` é o adaptador injetável: a tela e o hook só conhecem esta interface. O
 * serviço de banco (`services/bonusTrailService.ts`, do builder de banco) deve implementá-la;
 * enquanto ele não existe, `rpcApi.ts` mapeia as RPCs nomeadas na spec (S4).
 *
 * Nada aqui carrega motivo de exclusão, flag, decisão do dono ou lista de vetos (AF7): o
 * operador só enxerga estado de award e valores.
 */

export type BonusTrailStatus =
  | 'disabled' // programa desligado (`enabled=false`)
  | 'not_enrolled' // sem inscrição
  | 'invited' // convidada, ainda não aceitou o regulamento
  | 'active'
  | 'ended'
  | 'identity_required' // sem login próprio confirmado na empresa

export type BonusAwardState = 'validating' | 'available' | 'in_payout' | 'paid' | 'not_counted'

export type MissingStamp =
  | 'worker_checkin'
  | 'worker_checkout'
  | 'company_checkin'
  | 'company_checkout'
  | 'payment_record'
  | 'receipt_confirmation'

/** Turno do operador ainda com passos em aberto ("Quase lá"). */
export interface PendingShift {
  jobId: string
  jobTitle: string
  shiftDate: string | null
  workerName: string | null
  missingStamps: MissingStamp[]
  /** Avisos prontos em português, vindos do banco (ex.: horário informado diferente do registro). */
  warnings: string[]
}

export type BonusGroup = 'A' | 'B' | 'C' | 'D' | 'E'

export interface BonusMilestone {
  id: string
  key: string
  group: BonusGroup
  sortOrder: number
  title: string
  amountCents: number
  /** Conta no "N de total" (coluna `counts_in_total`). O total é derivado, nunca constante. */
  countsInTotal: boolean
  /** Award já existe (acende mesmo se o marco estiver "trancado" na tela, A26). */
  earned: boolean
  earnedAt: string | null
  awardState: BonusAwardState | null
  /** Data real em que o valor passa a poder ser pedido, quando conhecida. */
  availableAt: string | null
  /** Texto neutro do banco sobre a liberação (substitui a data quando vem preenchido). */
  releaseText: string | null
  /** Id do award (para marcar como comemorado). */
  awardId: string | null
  /** Award já comemorado (confete não repete). */
  celebrated: boolean
  /** Progresso real (só turnos contáveis). Null quando o marco não tem barra. */
  progress: { current: number; target: number; unit: string } | null
}

export interface BonusPayoutHistoryItem {
  id: string
  amountCents: number
  paidAt: string
  milestoneTitles: string[]
}

export interface BonusTrailSnapshot {
  status: BonusTrailStatus
  /** Fim real da janela da trilha (YYYY-MM-DD ou ISO). */
  endsAt: string | null
  milestones: BonusMilestone[]
  earnedCents: number
  /** Parcela de `earnedCents` ainda liberando. */
  releasingCents: number
  /** Data real mais próxima de liberação, quando conhecida. */
  releasingUntil: string | null
  /** Texto neutro do banco sobre a liberação (`release_text`). */
  releaseText: string | null
  pendingShifts: PendingShift[]
  availableCents: number
  minPayoutCents: number
  /** Valor do pedido aberto para a próxima segunda; null se não há pedido. */
  requestedPayoutCents: number | null
  /** Data real (YYYY-MM-DD) da próxima segunda de PIX. */
  nextPayoutDate: string | null
  /** Chave PIX mascarada (nunca a chave inteira). */
  pixKeyMasked: string | null
  payouts: BonusPayoutHistoryItem[]
}

export type AcceptOutcome = 'ok' | 'identity_required' | 'track_not_open' | 'not_invited' | 'disabled' | 'ack_missing' | 'error'
export type PayoutOutcome =
  | 'ok'
  | 'below_minimum'
  | 'no_pix_key'
  | 'already_requested'
  | 'nothing_available'
  | 'disabled'
  | 'too_late' // cancelamento depois do corte
  | 'not_found' // não há pedido aberto
  | 'error'
export type PixOutcome = 'ok' | 'open_payout' | 'invalid' | 'error'

export interface BonusTrailApi {
  getMyTrail(): Promise<BonusTrailSnapshot>
  acceptEnrollment(pixKey: string | null): Promise<AcceptOutcome>
  setPixKey(pixKey: string): Promise<PixOutcome>
  requestPayout(): Promise<PayoutOutcome>
  cancelPayout(): Promise<PayoutOutcome>
  markCelebrated(awardIds: string[]): Promise<void>
}
