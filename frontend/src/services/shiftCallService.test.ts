import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ShiftCallService,
  calcExpiryAtShiftStart,
  DEFAULT_CALL_EXPIRY_HOURS,
} from './shiftCallService';

// ---------------------------------------------------------------------------
// Mock supabase — mesma cadeia thenable de shiftInviteService.test.ts (o builder do
// supabase-js é awaitable sem .then() explícito no fim).
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
  chain.insert = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.single = vi.fn(() => Promise.resolve(result));
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

vi.mock('./api', () => ({ invokeFunction: vi.fn().mockResolvedValue({}) }));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'company-owner-1' } }, error: null });
});

// ---------------------------------------------------------------------------
// calcExpiryAtShiftStart — função pura, sem I/O
// ---------------------------------------------------------------------------

describe('calcExpiryAtShiftStart', () => {
  it('usa a data do turno com o horário de início colado por cima', () => {
    const start = new Date();
    start.setDate(start.getDate() + 2);
    const result = new Date(calcExpiryAtShiftStart(start.toISOString(), '08:30'));

    expect(result.getHours()).toBe(8);
    expect(result.getMinutes()).toBe(30);
  });

  it('nunca devolve instante no passado — piso de 30 minutos quando o turno já começou', () => {
    // Turno de ONTEM: um chamado com expiração no passado nasceria morto — a RPC recusaria
    // o primeiro aceite com outcome 'expired' e o gerente não entenderia por quê.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const result = new Date(calcExpiryAtShiftStart(yesterday.toISOString(), '08:00'));

    expect(result.getTime()).toBeGreaterThan(Date.now());
  });

  it('cai no default quando o turno não tem data', () => {
    const result = new Date(calcExpiryAtShiftStart(null, null));
    const expected = Date.now() + DEFAULT_CALL_EXPIRY_HOURS * 3600_000;

    // Tolerância de 1 minuto — o relógio anda entre o cálculo e a asserção.
    expect(Math.abs(result.getTime() - expected)).toBeLessThan(60_000);
  });
});

// ---------------------------------------------------------------------------
// createShiftCall
// ---------------------------------------------------------------------------

describe('ShiftCallService.createShiftCall', () => {
  it('recusa disparo sem nenhum freela selecionado (sem tocar o banco)', async () => {
    const result = await ShiftCallService.createShiftCall('job-1', []);

    expect(result.error).toBeTruthy();
    expect(result.call).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('deduplica ids repetidos antes de gravar os alvos', async () => {
    const targetsChain = makeChain({ data: [{ id: 't1', worker_id: 'w1' }], error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'companies') return makeChain({ data: { id: 'company-1' }, error: null });
      if (table === 'jobs') {
        return makeChain({ data: { id: 'job-1', slots: 1, company_id: 'company-1' }, error: null });
      }
      if (table === 'shift_calls') return makeChain({ data: { id: 'call-1' }, error: null });
      if (table === 'shift_call_targets') return targetsChain;
      return makeChain({ data: null, error: null });
    });

    const result = await ShiftCallService.createShiftCall('job-1', ['w1', 'w1', 'w1']);

    expect(result.error).toBeUndefined();
    // Um único alvo gravado, não três — chamar a mesma pessoa 3x seria 3 notificações no
    // celular dela pela MESMA vaga, e o UNIQUE(call_id, worker_id) derrubaria o insert inteiro.
    expect(targetsChain.insert).toHaveBeenCalledWith([{ call_id: 'call-1', worker_id: 'w1' }]);
  });

  it('cancela o chamado quando nenhum alvo pôde ser gravado (elenco desatualizado)', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'companies') return makeChain({ data: { id: 'company-1' }, error: null });
      if (table === 'jobs') {
        return makeChain({ data: { id: 'job-1', slots: 2, company_id: 'company-1' }, error: null });
      }
      if (table === 'shift_calls') return makeChain({ data: { id: 'call-1' }, error: null });
      // A policy de INSERT barra quem não tem team_connections 'accepted'.
      if (table === 'shift_call_targets') return makeChain({ data: null, error: { message: 'RLS' } });
      return makeChain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({ data: { outcome: 'cancelled' }, error: null });

    const result = await ShiftCallService.createShiftCall('job-1', ['w1']);

    expect(result.call).toBeNull();
    expect(result.error).toBeTruthy();
    // Um chamado aberto sem nenhum alvo ficaria eternamente "aguardando resposta" na tela da
    // empresa, sem ninguém do outro lado para responder.
    expect(mockRpc).toHaveBeenCalledWith('cancel_shift_call', { p_call_id: 'call-1' });
  });
});

// ---------------------------------------------------------------------------
// claimSlot — o client NÃO arbitra a corrida, só repassa o outcome
// ---------------------------------------------------------------------------

describe('ShiftCallService.claimSlot', () => {
  it('repassa o outcome da RPC sem reinterpretar', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'filled' }, error: null });

    const result = await ShiftCallService.claimSlot('call-1');

    expect(mockRpc).toHaveBeenCalledWith('claim_shift_slot', { p_call_id: 'call-1' });
    expect(result.outcome).toBe('filled');
  });

  it('devolve outcome tratável (não lança) quando a RPC falha', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(ShiftCallService.claimSlot('call-1')).resolves.toEqual({ outcome: 'not_found' });
  });
});

// ---------------------------------------------------------------------------
// listPendingForWorker — filtro de expiração no client
// ---------------------------------------------------------------------------

describe('ShiftCallService.listPendingForWorker', () => {
  const jobStub = { id: 'job-1', title: 'Garçom', company: { id: 'c1', name: 'Divino' } };

  function targetRow(callId: string, status: string, expiresInMinutes: number, targetsCount = 3) {
    const expires = new Date();
    expires.setMinutes(expires.getMinutes() + expiresInMinutes);
    return {
      id: `t-${callId}`,
      call_id: callId,
      worker_id: 'w1',
      notified_at: new Date().toISOString(),
      responded_at: null,
      response: null,
      call: {
        id: callId,
        job_id: 'job-1',
        slots: 1,
        reason: 'falta',
        message: null,
        targets_count: targetsCount,
        status,
        expires_at: expires.toISOString(),
        created_at: new Date().toISOString(),
        job: jobStub,
      },
    };
  }

  it('esconde chamado expirado, mesmo que o banco ainda o marque como open', async () => {
    // A expiração é preguiçosa no banco (só fecha quando alguém toca no chamado). Mostrar a
    // vaga aqui seria oferecer algo que a RPC recusa no clique seguinte.
    mockFrom.mockReturnValue(makeChain({ data: [targetRow('call-vencido', 'open', -5)], error: null }));

    await expect(ShiftCallService.listPendingForWorker()).resolves.toEqual([]);
  });

  it('esconde chamado que já foi preenchido ou cancelado', async () => {
    mockFrom.mockReturnValue(makeChain({ data: [targetRow('call-cheio', 'filled', 120)], error: null }));

    await expect(ShiftCallService.listPendingForWorker()).resolves.toEqual([]);
  });

  it('marca como disputado quando o chamado foi para mais de um freela', async () => {
    mockFrom.mockReturnValue(makeChain({ data: [targetRow('call-1', 'open', 120, 4)], error: null }));

    const [invite] = await ShiftCallService.listPendingForWorker();

    expect(invite.disputed).toBe(true);
    expect(invite.targetsCount).toBe(4);
    expect(invite.source).toBe('call');
    expect(invite.callId).toBe('call-1');
  });

  it('NÃO marca como disputado o chamado de um alvo só (convite individual)', async () => {
    mockFrom.mockReturnValue(makeChain({ data: [targetRow('call-1', 'open', 120, 1)], error: null }));

    const [invite] = await ShiftCallService.listPendingForWorker();

    expect(invite.disputed).toBe(false);
  });
});
