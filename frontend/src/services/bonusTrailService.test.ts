import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));
const mockLogError = vi.fn();
vi.mock('../lib/logger', () => ({ logError: (...args: unknown[]) => mockLogError(...args) }));

import { BonusTrailService } from './bonusTrailService';

const ok = (data: unknown) => ({ data, error: null });

/** Formato que `bonus_get_my_trail` (migration S3) devolve. */
const sqlSnapshot = {
  outcome: 'ok',
  status: 'active',
  ends_at: '2027-02-16T03:00:00+00:00',
  window_closed: false,
  total_milestones: 19,
  done_milestones: 2,
  earned_cents: 1000,
  releasing_cents: 1000,
  releasing_until: '2026-11-26T15:00:00+00:00',
  release_text: null,
  pending_shifts: [
    { job_id: 'j1', job_title: 'Evento', shift_date: '2026-11-24', worker_name: 'Ana', missing_stamps: ['worker_checkout'] },
  ],
  available_cents: 0,
  min_payout_cents: 2500,
  missing_to_min_cents: 0,
  can_request: false,
  requested_payout_id: null,
  requested_payout_cents: null,
  next_payout_date: '2026-11-30',
  pix_key_masked: '••••.com',
  payouts: [{ id: 'p1', amount_cents: 3500, paid_at: '2026-11-23T12:00:00+00:00', milestone_titles: ['Primeiro turno completo'] }],
  milestones: [
    {
      id: 'm1', key: 'accepted_challenge', group: 'A', sort_order: 2, title: 'Topei o desafio', amount_cents: 1000,
      counts_in_total: true, earned: true, earned_at: '2026-11-24T15:00:00+00:00', earned_cents: 1000,
      award_state: 'validating', available_at: '2026-11-26T15:00:00+00:00', award_id: 'a1', celebrated: false, progress: null,
    },
    {
      id: 'm2', key: 'shifts_3', group: 'C', sort_order: 12, title: '3 turnos completos', amount_cents: 1500,
      counts_in_total: true, earned: false, earned_at: null, earned_cents: 0, award_state: null, available_at: null,
      award_id: null, celebrated: true, progress: { current: 2, target: 3, unit: 'turnos' },
    },
    {
      id: 'm3', key: 'collection', group: 'E', sort_order: 20, title: 'Coleção completa', amount_cents: 3000,
      counts_in_total: false, earned: false, earned_at: null, earned_cents: 0, award_state: null, available_at: null,
      award_id: null, celebrated: true, progress: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('contrato do snapshot (S3 -> tela)', () => {
  it('mapeia os campos snake_case do banco', async () => {
    mockRpc.mockResolvedValue(ok(sqlSnapshot));
    const s = await BonusTrailService.getMyTrail();
    expect(mockRpc).toHaveBeenCalledWith('bonus_get_my_trail');
    expect(s).toMatchObject({
      status: 'active', earnedCents: 1000, releasingCents: 1000, availableCents: 0, minPayoutCents: 2500,
      requestedPayoutCents: null, nextPayoutDate: '2026-11-30', pixKeyMasked: '••••.com',
    });
    expect(s.milestones[0]).toMatchObject({ awardState: 'validating', awardId: 'a1', celebrated: false, earned: true });
    expect(s.milestones[1].progress).toEqual({ current: 2, target: 3, unit: 'turnos' });
    expect(s.milestones[2].countsInTotal).toBe(false);
    expect(s.payouts[0].milestoneTitles).toEqual(['Primeiro turno completo']);
  });

  it('getMyTrail propaga a falha (a tela distingue erro de vazio)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('rede') });
    await expect(BonusTrailService.getMyTrail()).rejects.toThrow('rede');
  });
});

describe('acesso leve (menu)', () => {
  it('usa p_light=true, que não avalia a trilha', async () => {
    mockRpc.mockResolvedValue(ok({ outcome: 'ok', status: 'active', ends_at: null }));
    expect(await BonusTrailService.hasActiveEnrollment()).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('bonus_get_my_trail', { p_light: true });
  });

  it.each(['disabled', 'not_enrolled', 'invited', 'ended', 'identity_required'])('status %s não é ativo', async (status) => {
    mockRpc.mockResolvedValue(ok({ outcome: 'ok', status }));
    expect(await BonusTrailService.hasActiveEnrollment()).toBe(false);
  });

  it('falha vira "sem acesso" e vai para o logger', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('rede') });
    expect(await BonusTrailService.getAccessStatus()).toBeNull();
    expect(await BonusTrailService.hasActiveEnrollment()).toBe(false);
    expect(mockLogError).toHaveBeenCalled();
  });
});

describe('ações', () => {
  it('aceite manda p_pix_key (vazio vira null) e repassa o desfecho do banco', async () => {
    mockRpc.mockResolvedValue(ok({ outcome: 'identity_required' }));
    expect(await BonusTrailService.acceptEnrollment('   ')).toBe('identity_required');
    expect(mockRpc).toHaveBeenCalledWith('bonus_accept_enrollment', { p_pix_key: null });
  });

  it.each(['track_not_open', 'ack_missing', 'not_invited', 'disabled'])('aceite: desfecho %s', async (outcome) => {
    mockRpc.mockResolvedValue(ok({ outcome }));
    expect(await BonusTrailService.acceptEnrollment(null)).toBe(outcome);
  });

  it.each(['ok', 'below_minimum', 'no_pix_key', 'already_requested', 'nothing_available', 'disabled'])(
    'saque: desfecho %s',
    async (outcome) => {
      mockRpc.mockResolvedValue(ok({ outcome }));
      expect(await BonusTrailService.requestPayout()).toBe(outcome);
    },
  );

  it.each(['ok', 'too_late', 'not_found'])('cancelamento: desfecho %s', async (outcome) => {
    mockRpc.mockResolvedValue(ok({ outcome }));
    expect(await BonusTrailService.cancelPayout()).toBe(outcome);
  });

  it('PIX é enviado sem espaços nas pontas', async () => {
    mockRpc.mockResolvedValue(ok({ outcome: 'open_payout' }));
    expect(await BonusTrailService.setPixKey('  chave@qa.com ')).toBe('open_payout');
    expect(mockRpc).toHaveBeenCalledWith('bonus_set_pix_key', { p_pix_key: 'chave@qa.com' });
  });

  it('erro de rede vira "error" sem lançar', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('rede') });
    expect(await BonusTrailService.requestPayout()).toBe('error');
    expect(await BonusTrailService.setPixKey('abc')).toBe('error');
    await expect(BonusTrailService.markCelebrated(['a1'])).resolves.toBeUndefined();
  });

  it('markCelebrated com lista vazia não chama o banco', async () => {
    await BonusTrailService.markCelebrated([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
