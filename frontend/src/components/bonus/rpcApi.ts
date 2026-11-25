/**
 * Adaptador de `BonusTrailApi` sobre as RPCs do operador, alinhado à migration
 * `20261124000300_trilha_bonus_s3_aceite_e_saque.sql` (o banco manda). O total de marcos é
 * derivado de `counts_in_total`. Campo ausente degrada para valor neutro, nunca quebra.
 */
import { supabase } from '../../lib/supabase'
import type {
  AcceptOutcome,
  BonusAwardState,
  BonusGroup,
  BonusMilestone,
  BonusPayoutHistoryItem,
  BonusTrailApi,
  BonusTrailSnapshot,
  BonusTrailStatus,
  MissingStamp,
  PendingShift,
  PayoutOutcome,
  PixOutcome,
} from './types'

type Raw = Record<string, unknown>

const isRaw = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

const STATUSES: BonusTrailStatus[] = ['disabled', 'not_enrolled', 'invited', 'active', 'ended', 'identity_required']
const AWARD_STATES: BonusAwardState[] = ['validating', 'available', 'in_payout', 'paid', 'not_counted']
const STAMPS: MissingStamp[] = [
  'worker_checkin',
  'worker_checkout',
  'company_checkin',
  'company_checkout',
  'payment_record',
  'receipt_confirmation',
]
const GROUPS: BonusGroup[] = ['A', 'B', 'C', 'D', 'E']

function parseMilestone(raw: unknown): BonusMilestone | null {
  if (!isRaw(raw)) return null
  const id = str(raw.id)
  if (!id) return null
  const group = GROUPS.find((g) => g === raw.group) ?? 'A'
  const awardState = AWARD_STATES.find((s) => s === raw.award_state) ?? null
  const p = isRaw(raw.progress) ? raw.progress : null
  return {
    id,
    key: str(raw.key) ?? id,
    group,
    sortOrder: num(raw.sort_order),
    title: str(raw.title) ?? '',
    amountCents: num(raw.amount_cents),
    countsInTotal: raw.counts_in_total === true,
    earned: raw.earned === true,
    earnedAt: str(raw.earned_at),
    awardState,
    availableAt: str(raw.available_at),
    releaseText: str(raw.release_text),
    awardId: str(raw.award_id),
    celebrated: raw.celebrated !== false,
    progress: p ? { current: num(p.current), target: num(p.target), unit: str(p.unit) ?? '' } : null,
  }
}

function parsePayout(raw: unknown): BonusPayoutHistoryItem | null {
  if (!isRaw(raw)) return null
  const id = str(raw.id)
  const paidAt = str(raw.paid_at)
  if (!id || !paidAt) return null
  return {
    id,
    paidAt,
    amountCents: num(raw.amount_cents),
    milestoneTitles: arr(raw.milestone_titles).filter((t): t is string => typeof t === 'string'),
  }
}

function parsePendingShift(raw: unknown): PendingShift | null {
  if (!isRaw(raw)) return null
  const jobId = str(raw.job_id)
  if (!jobId) return null
  return {
    jobId,
    jobTitle: str(raw.job_title) ?? 'Turno',
    shiftDate: str(raw.shift_date),
    workerName: str(raw.worker_name),
    missingStamps: arr(raw.missing_stamps)
      .map((v) => STAMPS.find((s) => s === v))
      .filter((s): s is MissingStamp => s !== undefined),
    warnings: arr(raw.warnings).filter((w): w is string => typeof w === 'string' && w !== ''),
  }
}

export function parseSnapshot(data: unknown): BonusTrailSnapshot {
  const raw: Raw = isRaw(data) ? data : {}
  const status = STATUSES.find((s) => s === raw.status) ?? 'not_enrolled'
  return {
    status,
    endsAt: str(raw.ends_at),
    milestones: arr(raw.milestones).map(parseMilestone).filter((m): m is BonusMilestone => m !== null),
    earnedCents: num(raw.earned_cents),
    releasingCents: num(raw.releasing_cents),
    releasingUntil: str(raw.releasing_until),
    releaseText: str(raw.release_text),
    pendingShifts: arr(raw.pending_shifts).map(parsePendingShift).filter((p): p is PendingShift => p !== null),
    availableCents: num(raw.available_cents),
    minPayoutCents: num(raw.min_payout_cents) || 2500,
    requestedPayoutCents: typeof raw.requested_payout_cents === 'number' ? raw.requested_payout_cents : null,
    nextPayoutDate: str(raw.next_payout_date),
    pixKeyMasked: str(raw.pix_key_masked),
    payouts: arr(raw.payouts).map(parsePayout).filter((p): p is BonusPayoutHistoryItem => p !== null),
  }
}

function outcomeOf(data: unknown): string {
  return isRaw(data) && typeof data.outcome === 'string' ? data.outcome : 'error'
}

function pick<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.find((a) => a === value) ?? fallback
}

export const bonusRpcApi: BonusTrailApi = {
  async getMyTrail() {
    const { data, error } = await supabase.rpc('bonus_get_my_trail')
    if (error) throw error
    return parseSnapshot(data)
  },
  async acceptEnrollment(pixKey) {
    const { data, error } = await supabase.rpc('bonus_accept_enrollment', { p_pix_key: pixKey })
    if (error) throw error
    return pick<AcceptOutcome>(
      outcomeOf(data),
      ['ok', 'identity_required', 'track_not_open', 'not_invited', 'disabled', 'ack_missing'],
      'error',
    )
  },
  async setPixKey(pixKey) {
    const { data, error } = await supabase.rpc('bonus_set_pix_key', { p_pix_key: pixKey })
    if (error) throw error
    return pick<PixOutcome>(outcomeOf(data), ['ok', 'open_payout', 'invalid'], 'error')
  },
  async requestPayout() {
    const { data, error } = await supabase.rpc('bonus_request_payout')
    if (error) throw error
    return pick<PayoutOutcome>(
      outcomeOf(data),
      ['ok', 'below_minimum', 'no_pix_key', 'already_requested', 'nothing_available', 'disabled'],
      'error',
    )
  },
  async cancelPayout() {
    const { data, error } = await supabase.rpc('bonus_cancel_payout')
    if (error) throw error
    return pick<PayoutOutcome>(outcomeOf(data), ['ok', 'too_late', 'not_found'], 'error')
  },
  async markCelebrated(awardIds) {
    const { error } = await supabase.rpc('bonus_mark_celebrated', { p_award_ids: awardIds })
    if (error) throw error
  },
}
