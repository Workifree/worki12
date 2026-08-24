import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SosService } from './sosService';

// ---------------------------------------------------------------------------
// Mock supabase — mesma cadeia thenable de shiftCallService.test.ts.
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
// checkEligibility
// ---------------------------------------------------------------------------

// Escopo de unidade (F13): os servicos passaram a resolver a empresa OPERADA pelo seam, em vez
// de `.eq('owner_id', user.id)`. O duble evita bater na RPC get_my_companies nos testes.
vi.mock('./companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
  getMyCompanies: vi.fn().mockResolvedValue([{ company_id: 'company-1' }]),
}))

describe('SosService.checkEligibility', () => {
  it('repassa o jsonb da RPC sem reinterpretar a regra no client', async () => {
    mockRpc.mockResolvedValue({
      data: { eligible: true, reason: 'ok', quota_week_left: 2, missing_slots: 1 },
      error: null,
    });

    const result = await SosService.checkEligibility('job-1');

    expect(mockRpc).toHaveBeenCalledWith('sos_call_eligibility', { p_job_id: 'job-1' });
    expect(result.eligible).toBe(true);
    expect(result.quota_week_left).toBe(2);
  });

  it('degrada para not eligible quando a RPC falha (nunca lança para a UI)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('boom') });

    const result = await SosService.checkEligibility('job-1');

    expect(result.eligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createSosCall — A6/A7: nunca vaza lista; outcome é sempre traduzido
// ---------------------------------------------------------------------------

describe('SosService.createSosCall', () => {
  it('recusa sem job informado, sem tocar o banco', async () => {
    const result = await SosService.createSosCall('');

    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('outcome=created: devolve SÓ {call_id, targets_count, expires_at} — nunca uma lista de alvos', async () => {
    mockRpc.mockResolvedValue({
      data: {
        outcome: 'created',
        call_id: 'call-sos-1',
        targets_count: 7,
        expires_at: '2026-08-21T12:00:00.000Z',
      },
      error: null,
    });

    const result = await SosService.createSosCall('job-1', { reason: 'falta' });

    expect(mockRpc).toHaveBeenCalledWith('create_sos_call', {
      p_job_id: 'job-1',
      p_reason: 'falta',
      p_message: null,
    });
    expect(result.success).toBe(true);
    expect(result.callId).toBe('call-sos-1');
    expect(result.targetsCount).toBe(7);
    expect(result.error).toBeUndefined();
    // Nenhum campo de lista de alvos deveria existir no retorno do service — a garantia
    // estrutural de que "a empresa nunca vê quem foi chamado" (D1 do ADR) não vaza aqui.
    expect(result).not.toHaveProperty('targets');
    expect(result).not.toHaveProperty('targetWorkerIds');
  });

  it.each([
    ['pool_empty', 'não encontramos'],
    ['quota_exceeded', 'limite'],
    ['not_urgent', 'menos de 4 horas'],
    ['already_filled', 'preenchidas'],
    ['team_not_tried', 'elenco'],
    ['team_call_still_open', 'em aberto'],
    ['company_city_missing', 'cidade'],
  ] as const)('outcome=%s produz mensagem específica e success=false', async (outcome, needle) => {
    mockRpc.mockResolvedValue({ data: { outcome }, error: null });

    const result = await SosService.createSosCall('job-1');

    expect(result.success).toBe(false);
    expect(result.outcome).toBe(outcome);
    expect(result.error?.toLowerCase()).toContain(needle);
  });

  it('erro de rede da RPC não lança — devolve retorno estruturado', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('network down') });

    const result = await SosService.createSosCall('job-1');

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('error');
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// setDiscoverable — opt-in/opt-out (R4/A14)
// ---------------------------------------------------------------------------

describe('SosService.setDiscoverable', () => {
  it('escreve discoverable_for_sos SOMENTE na própria linha do freela autenticado', async () => {
    const chain = makeChain({ data: null, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'workers') return chain;
      return makeChain({ data: null, error: null });
    });

    const result = await SosService.setDiscoverable(true);

    expect(result.success).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('workers');
    expect(chain.update).toHaveBeenCalledWith({ discoverable_for_sos: true });
    expect(chain.eq).toHaveBeenCalledWith('id', 'worker-1');
  });

  it('sem sessão, recusa sem tocar o banco', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await SosService.setDiscoverable(false);

    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
