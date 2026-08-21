import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinkRiskService, DEFAULT_LINK_RISK_CONFIG } from './linkRiskService';

// ---------------------------------------------------------------------------
// Mock supabase — só rpc() é usado por este service.
// ---------------------------------------------------------------------------

const mockRpc = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, params?: unknown) => mockRpc(fn, params),
  },
}));

vi.mock('../lib/logger', () => ({
  logError: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getConfig
// ---------------------------------------------------------------------------

describe('LinkRiskService.getConfig', () => {
  it('devolve a config crua quando a RPC responde normalmente', async () => {
    mockRpc.mockResolvedValueOnce({ data: { enabled: false, threshold: 4 }, error: null });

    const result = await LinkRiskService.getConfig();

    expect(mockRpc).toHaveBeenCalledWith('my_link_risk_config', undefined);
    expect(result).toEqual({ enabled: false, threshold: 4 });
  });

  it('lê enabled=undefined como ligado (LM-6: undefined não é false)', async () => {
    mockRpc.mockResolvedValueOnce({ data: { threshold: 3 }, error: null });

    const result = await LinkRiskService.getConfig();

    expect(result.enabled).toBe(true);
    expect(result.threshold).toBe(3);
  });

  it('cai no fallback DEFAULT quando a RPC está ausente (PGRST202 — LM-5, deploy adiantado)', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.my_link_risk_config' },
    });

    const result = await LinkRiskService.getConfig();

    expect(result).toEqual(DEFAULT_LINK_RISK_CONFIG);
  });

  it('cai no fallback DEFAULT quando a chamada lança (rede, sessão etc.)', async () => {
    mockRpc.mockRejectedValueOnce(new Error('network down'));

    const result = await LinkRiskService.getConfig();

    expect(result).toEqual(DEFAULT_LINK_RISK_CONFIG);
  });

  it('ignora threshold inválido (<=0) e usa o fallback', async () => {
    mockRpc.mockResolvedValueOnce({ data: { enabled: true, threshold: 0 }, error: null });

    const result = await LinkRiskService.getConfig();

    expect(result.threshold).toBe(DEFAULT_LINK_RISK_CONFIG.threshold);
  });
});

// ---------------------------------------------------------------------------
// countForShift (modo âncora)
// ---------------------------------------------------------------------------

describe('LinkRiskService.countForShift', () => {
  it('não toca o banco sem jobId ou sem workerIds', async () => {
    const resultNoJob = await LinkRiskService.countForShift('', ['w1']);
    const resultNoWorkers = await LinkRiskService.countForShift('job-1', []);

    expect(resultNoJob.size).toBe(0);
    expect(resultNoWorkers.size).toBe(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('chama a RPC em modo âncora (p_anchor_job_id) e monta o Map por worker_id', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        { worker_id: 'w1', week_start: '2026-08-16', shift_count: 3 },
        { worker_id: 'w2', week_start: '2026-08-16', shift_count: 1 },
      ],
      error: null,
    });

    const result = await LinkRiskService.countForShift('job-1', ['w1', 'w2']);

    expect(mockRpc).toHaveBeenCalledWith('count_worker_shifts_by_week', {
      p_worker_ids: ['w1', 'w2'],
      p_anchor_job_id: 'job-1',
    });
    expect(result.get('w1')).toBe(3);
    expect(result.get('w2')).toBe(1);
  });

  it('degrada para Map vazio quando a RPC está ausente (PGRST202)', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    });

    const result = await LinkRiskService.countForShift('job-1', ['w1']);

    expect(result.size).toBe(0);
  });

  it('degrada para Map vazio quando a RPC nega autorização (RAISE do LM-3, turno de outra empresa)', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'link_risk: turno não pertence a esta empresa' },
    });

    const result = await LinkRiskService.countForShift('job-alheio', ['w1']);

    expect(result.size).toBe(0);
  });

  it('degrada para Map vazio quando a chamada lança', async () => {
    mockRpc.mockRejectedValueOnce(new Error('boom'));

    const result = await LinkRiskService.countForShift('job-1', ['w1']);

    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// countForRange (modo intervalo)
// ---------------------------------------------------------------------------

describe('LinkRiskService.countForRange', () => {
  it('não toca o banco sem workerIds ou sem range completo', async () => {
    const r1 = await LinkRiskService.countForRange([], '2026-08-01', '2026-08-31');
    const r2 = await LinkRiskService.countForRange(['w1'], '', '2026-08-31');
    const r3 = await LinkRiskService.countForRange(['w1'], '2026-08-01', '');

    expect(r1.size).toBe(0);
    expect(r2.size).toBe(0);
    expect(r3.size).toBe(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('chama a RPC em modo intervalo (p_range_start/p_range_end) e chaveia por worker|semana', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        { worker_id: 'w1', week_start: '2026-08-09', shift_count: 2 },
        { worker_id: 'w1', week_start: '2026-08-16', shift_count: 1 },
      ],
      error: null,
    });

    const result = await LinkRiskService.countForRange(['w1'], '2026-08-01', '2026-08-31');

    expect(mockRpc).toHaveBeenCalledWith('count_worker_shifts_by_week', {
      p_worker_ids: ['w1'],
      p_range_start: '2026-08-01',
      p_range_end: '2026-08-31',
    });
    expect(result.get('w1|2026-08-09')).toBe(2);
    expect(result.get('w1|2026-08-16')).toBe(1);
  });

  it('degrada para Map vazio quando a RPC está ausente (PGRST202)', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    });

    const result = await LinkRiskService.countForRange(['w1'], '2026-08-01', '2026-08-31');

    expect(result.size).toBe(0);
  });
});
