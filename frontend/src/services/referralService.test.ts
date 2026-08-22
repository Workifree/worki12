import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ReferralService,
  CREATE_REFERRAL_ERRORS,
  ACCEPT_REFERRAL_ERRORS,
} from './referralService';
import type { WorkerReferralCard } from '../types';

// ---------------------------------------------------------------------------
// Mock supabase — mesma cadeia thenable de attendanceConfirmationService.test.ts.
// ---------------------------------------------------------------------------

interface QueryResult {
  data: unknown;
  error: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(result: QueryResult): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.then = (
    onFulfilled?: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (table: string) => mockFrom(table),
    rpc: (fn: string, params: unknown) => mockRpc(fn, params),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'worker-1' } }, error: null });
});

// ---------------------------------------------------------------------------
// createReferral — B apresenta X a A
// ---------------------------------------------------------------------------

describe('ReferralService.createReferral', () => {
  it('não toca o banco quando falta parâmetro obrigatório', async () => {
    const result = await ReferralService.createReferral('', 'company-b', 'company-a');

    expect(result.outcome).toBe('invalid_input');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('chama create_worker_referral com os parâmetros posicionais corretos e devolve created + referralId', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'created', referral_id: 'ref-1' }, error: null });

    const result = await ReferralService.createReferral('worker-x', 'company-b', 'company-a', 'boa profissional');

    expect(mockRpc).toHaveBeenCalledWith('create_worker_referral', {
      p_worker_id: 'worker-x',
      p_referring_company_id: 'company-b',
      p_requesting_company_id: 'company-a',
      p_message: 'boa profissional',
    });
    expect(result.outcome).toBe('created');
    expect(result.referralId).toBe('ref-1');
    expect(result.error).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // O CORAÇÃO DA FEATURE: a RPC colapsa veto/opt-out/já-conectado/teto/pendente-de-outra-
  // empresa num único outcome `not_available` (essa parte é garantida pelo SQL, não por este
  // teste — ver ddl-aprovado.md §6). O que ESTE teste prova é só a ponta client: dado
  // `outcome: 'not_available'`, o service devolve sempre a mesma mensagem genérica
  // (`CREATE_REFERRAL_ERRORS.not_available`), nunca uma variação por caso de uso.
  // ---------------------------------------------------------------------------
  it.each(['not_available'] as const)(
    'outcome=%s (colapso já feito no SQL) sempre devolve a MESMA mensagem genérica no client',
    async (outcome) => {
      mockRpc.mockResolvedValue({ data: { outcome }, error: null });

      const result = await ReferralService.createReferral('worker-x', 'company-b', 'company-a');

      expect(result.outcome).toBe('not_available');
      expect(result.error).toBe('Não foi possível concluir a indicação.');
      expect(result.error).toBe(CREATE_REFERRAL_ERRORS.not_available);
    },
  );

  it('rate_limited (fato da própria empresa indicadora) repassa o limit e mensagem própria, distinta de not_available', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'rate_limited', limit: 'company_24h' }, error: null });

    const result = await ReferralService.createReferral('worker-x', 'company-b', 'company-a');

    expect(result.outcome).toBe('rate_limited');
    expect(result.limit).toBe('company_24h');
    expect(result.error).not.toBe(CREATE_REFERRAL_ERRORS.not_available);
  });

  it('already_pending (fato da própria empresa indicadora) repassa referralId e mensagem própria', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'already_pending', referral_id: 'ref-2' }, error: null });

    const result = await ReferralService.createReferral('worker-x', 'company-b', 'company-a');

    expect(result.outcome).toBe('already_pending');
    expect(result.referralId).toBe('ref-2');
  });

  it('erro de rede/RPC vira not_available genérico (nunca detalha causa técnica para a UI)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'network down' } });

    const result = await ReferralService.createReferral('worker-x', 'company-b', 'company-a');

    expect(result.outcome).toBe('not_available');
    expect(result.error).toBe('Não foi possível concluir a indicação.');
  });
});

// ---------------------------------------------------------------------------
// listReceivedCards / getReceivedCard — a vitrine de A (empresa destino)
//
// LM-1/LM-2 do ddl-aprovado.md: a caixa de entrada de A é SEMPRE via RPC, nunca
// from('worker_referrals') nem from('workers'). Estes testes travam que o service usa `rpc`
// para essas leituras, e nunca `from`.
// ---------------------------------------------------------------------------

describe('ReferralService.listReceivedCards', () => {
  it('chama list_worker_referral_cards SEM PARÂMETRO (não aceita "por qual empresa listar")', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'ok', items: [] }, error: null });

    await ReferralService.listReceivedCards();

    expect(mockRpc).toHaveBeenCalledWith('list_worker_referral_cards', undefined);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('devolve os itens com worker_id null para indicações ainda pendentes (não vaza o uuid antes do aceite)', async () => {
    const items: WorkerReferralCard[] = [
      {
        referral_id: 'ref-1',
        status: 'awaiting_worker',
        message: null,
        created_at: '2026-08-17T00:00:00.000Z',
        expires_at: '2026-08-31T00:00:00.000Z',
        referring_company: { id: 'company-b', name: 'Empresa B' },
        worker_id: null,
        card: { full_name: 'Fulano', avatar_url: null, rating_average: 4.5, reviews_count: 10, primary_role: 'garcom', roles: ['garcom'] },
      },
    ];
    mockRpc.mockResolvedValue({ data: { outcome: 'ok', items }, error: null });

    const result = await ReferralService.listReceivedCards();

    expect(result.outcome).toBe('ok');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].worker_id).toBeNull();
  });

  it('erro de RPC devolve lista vazia com outcome unauthenticated', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const result = await ReferralService.listReceivedCards();

    expect(result.outcome).toBe('unauthenticated');
    expect(result.items).toEqual([]);
  });
});

describe('ReferralService.getReceivedCard', () => {
  it('chama get_worker_referral_card com o referral_id', async () => {
    mockRpc.mockResolvedValue({
      data: {
        outcome: 'ok',
        referral_id: 'ref-1',
        status: 'awaiting_worker',
        message: null,
        created_at: '2026-08-17T00:00:00.000Z',
        expires_at: '2026-08-31T00:00:00.000Z',
        referring_company: { id: 'company-b', name: 'Empresa B' },
        worker_id: null,
        card: { full_name: 'Fulano' },
      },
      error: null,
    });

    const result = await ReferralService.getReceivedCard('ref-1');

    expect(mockRpc).toHaveBeenCalledWith('get_worker_referral_card', { p_referral_id: 'ref-1' });
    expect(result.outcome).toBe('ok');
    expect(result.card?.worker_id).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('worker_id vem preenchido SOMENTE quando status=accepted', async () => {
    mockRpc.mockResolvedValue({
      data: {
        outcome: 'ok',
        referral_id: 'ref-1',
        status: 'accepted',
        message: null,
        created_at: '2026-08-17T00:00:00.000Z',
        expires_at: '2026-08-31T00:00:00.000Z',
        referring_company: { id: 'company-b', name: 'Empresa B' },
        worker_id: 'worker-x',
        card: { full_name: 'Fulano' },
      },
      error: null,
    });

    const result = await ReferralService.getReceivedCard('ref-1');

    expect(result.card?.worker_id).toBe('worker-x');
  });

  it('não_available/forbidden/not_found não trazem card', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'not_available' }, error: null });

    const result = await ReferralService.getReceivedCard('ref-1');

    expect(result.outcome).toBe('not_available');
    expect(result.card).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// acceptReferral / declineReferral — o "sim"/"não" do freela
// ---------------------------------------------------------------------------

describe('ReferralService.acceptReferral', () => {
  it('accepted: outcome limpo, sem erro', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'accepted' }, error: null });

    const result = await ReferralService.acceptReferral('ref-1');

    expect(mockRpc).toHaveBeenCalledWith('accept_worker_referral', { p_referral_id: 'ref-1' });
    expect(result.outcome).toBe('accepted');
    expect(result.error).toBeUndefined();
  });

  it('blocked_by_you: é o único motivo privado seguro de contar ao FREELA (o veto é dele)', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'blocked_by_you' }, error: null });

    const result = await ReferralService.acceptReferral('ref-1');

    expect(result.outcome).toBe('blocked_by_you');
    expect(result.error).toBe(ACCEPT_REFERRAL_ERRORS.blocked_by_you);
    expect(result.error).toMatch(/bloqueou/i);
  });

  it('already_connected: idempotente, sem erro', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'already_connected' }, error: null });

    const result = await ReferralService.acceptReferral('ref-1');

    expect(result.outcome).toBe('already_connected');
    expect(result.error).toBeUndefined();
  });

  it('expired: mensagem própria', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'expired' }, error: null });

    const result = await ReferralService.acceptReferral('ref-1');

    expect(result.outcome).toBe('expired');
    expect(result.error).toMatch(/expirou/i);
  });
});

describe('ReferralService.declineReferral', () => {
  it('declined: recusa neutra, sem penalidade/erro', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'declined' }, error: null });

    const result = await ReferralService.declineReferral('ref-1');

    expect(mockRpc).toHaveBeenCalledWith('decline_worker_referral', { p_referral_id: 'ref-1' });
    expect(result.outcome).toBe('declined');
    expect(result.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// cancelReferral — B retira a apresentação
// ---------------------------------------------------------------------------

describe('ReferralService.cancelReferral', () => {
  it('cancelled: sucesso sem erro', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'cancelled' }, error: null });

    const result = await ReferralService.cancelReferral('ref-1');

    expect(mockRpc).toHaveBeenCalledWith('cancel_worker_referral', { p_referral_id: 'ref-1' });
    expect(result.outcome).toBe('cancelled');
  });

  it('forbidden: empresa que não indicou não pode cancelar', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'forbidden' }, error: null });

    const result = await ReferralService.cancelReferral('ref-1');

    expect(result.outcome).toBe('forbidden');
    expect(result.error).toMatch(/permissão/i);
  });
});

// ---------------------------------------------------------------------------
// listMyReferrals / listMyPendingReferrals — leitura direta por RLS (não usam RPC)
// ---------------------------------------------------------------------------

describe('ReferralService.listMyReferrals (empresa indicadora)', () => {
  it('lê worker_referrals filtrando por referring_company_id, sem passar por RPC', async () => {
    const rows = [{ id: 'ref-1', worker_id: 'w1', referring_company_id: 'company-b', requesting_company_id: 'company-a', status: 'awaiting_worker', created_at: 't', expires_at: 't2' }];
    mockFrom.mockReturnValue(makeChain({ data: rows, error: null }));

    const result = await ReferralService.listMyReferrals('company-b');

    expect(mockFrom).toHaveBeenCalledWith('worker_referrals');
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result).toEqual(rows);
  });

  it('retorna [] sem empresa informada, sem tocar o banco', async () => {
    const result = await ReferralService.listMyReferrals('');

    expect(result).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('ReferralService.listMyPendingReferrals (freela)', () => {
  it('lê worker_referrals filtrando por status awaiting_worker, sem RPC', async () => {
    mockFrom.mockReturnValue(makeChain({ data: [], error: null }));

    await ReferralService.listMyPendingReferrals();

    expect(mockFrom).toHaveBeenCalledWith('worker_referrals');
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setAcceptsReferrals — opt-out do freela (R7)
// ---------------------------------------------------------------------------

describe('ReferralService.setAcceptsReferrals', () => {
  it('atualiza a própria linha de workers via update().eq(id, uid)', async () => {
    const chain = makeChain({ data: null, error: null });
    mockFrom.mockReturnValue(chain);

    const result = await ReferralService.setAcceptsReferrals(false);

    expect(mockFrom).toHaveBeenCalledWith('workers');
    expect(chain.update).toHaveBeenCalledWith({ accepts_referrals: false });
    expect(chain.eq).toHaveBeenCalledWith('id', 'worker-1');
    expect(result.success).toBe(true);
  });

  it('sem sessão: falha sem tocar o banco', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await ReferralService.setAcceptsReferrals(true);

    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
