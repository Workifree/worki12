import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AttendanceConfirmationService, OUTCOME_ERRORS } from './attendanceConfirmationService';
import type { AttendanceConfirmationOutcome } from '../types';

// ---------------------------------------------------------------------------
// Mock supabase — mesma cadeia thenable de shiftCallService.test.ts (o builder do
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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'worker-1' } }, error: null });
});

// ---------------------------------------------------------------------------
// requestConfirmation — empresa pede confirmação (manual)
// ---------------------------------------------------------------------------

describe('AttendanceConfirmationService.requestConfirmation', () => {
  it('não toca o banco quando applicationId está vazio', async () => {
    const result = await AttendanceConfirmationService.requestConfirmation('');

    expect(result.outcome).toBe('not_found');
    expect(result.error).toBe('Candidatura não informada.');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('repassa request_count no sucesso (outcome=requested)', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'requested', request_count: 1 }, error: null });

    const result = await AttendanceConfirmationService.requestConfirmation('app-1');

    expect(mockRpc).toHaveBeenCalledWith('request_attendance_confirmation', {
      p_application_id: 'app-1',
    });
    expect(result.outcome).toBe('requested');
    expect(result.requestCount).toBe(1);
    expect(result.error).toBeUndefined();
  });

  // L3: cap de 2 pedidos por application — a RPC (não o client) decide via lock. O service só
  // precisa traduzir o outcome corretamente para a UI desabilitar o botão com o motivo certo.
  it('cap de 2: outcome=limit_reached vira erro explicando o limite, sem requestCount', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'limit_reached' }, error: null });

    const result = await AttendanceConfirmationService.requestConfirmation('app-1');

    expect(result.outcome).toBe('limit_reached');
    expect(result.requestCount).toBeUndefined();
    expect(result.error).toMatch(/limite/i);
  });

  // Cooldown de 6h entre pedidos — retry_after deve ser repassado para a UI poder informar
  // quando o botão libera de novo.
  it('cooldown: repassa retryAfter e mensagem explicando a espera', async () => {
    const retryAfter = '2026-08-18T00:00:00.000Z';
    mockRpc.mockResolvedValue({ data: { outcome: 'cooldown', retry_after: retryAfter }, error: null });

    const result = await AttendanceConfirmationService.requestConfirmation('app-1');

    expect(result.outcome).toBe('cooldown');
    expect(result.retryAfter).toBe(retryAfter);
    expect(result.error).toMatch(/aguarde/i);
  });

  it('erro de rede/RPC vira outcome not_found com mensagem fixa (nunca erro cru)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'connection refused' } });

    const result = await AttendanceConfirmationService.requestConfirmation('app-1');

    expect(result.outcome).toBe('not_found');
    expect(result.error).toBe('Não foi possível pedir a confirmação de presença.');
    expect(result.error).not.toMatch(/connection refused/);
  });

  // Tradução de outcome: todo outcome de recusa desta RPC vira uma mensagem não-genérica.
  const REQUEST_OUTCOMES: AttendanceConfirmationOutcome[] = [
    'unauthenticated',
    'forbidden',
    'invalid_status',
    'job_inactive',
    'job_past',
    'already_responded',
    'limit_reached',
    'cooldown',
    'not_found',
  ];

  it.each(REQUEST_OUTCOMES)('traduz outcome=%s na mensagem EXATA do mapa OUTCOME_ERRORS', async (outcome) => {
    mockRpc.mockResolvedValue({ data: { outcome }, error: null });

    const result = await AttendanceConfirmationService.requestConfirmation('app-1');

    // Achado do evaluator (mutation testing, 18/08/2026): `toBeTruthy()` sozinho passa mesmo se
    // `translateOutcome` for trocada por um retorno genérico fixo — comparar com a mensagem
    // EXATA do mapa exportado é o que realmente prova que este outcome tem tradução própria.
    expect(result.outcome).toBe(outcome);
    expect(result.error).toBe(OUTCOME_ERRORS[outcome]);
  });
});

// ---------------------------------------------------------------------------
// respondConfirmation — freela responde (UM toque)
// ---------------------------------------------------------------------------

describe('AttendanceConfirmationService.respondConfirmation', () => {
  it('não toca o banco quando applicationId está vazio', async () => {
    const result = await AttendanceConfirmationService.respondConfirmation('', 'confirmed');

    expect(result.outcome).toBe('not_found');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('"Sim, vou": outcome=confirmed sem erro', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'confirmed' }, error: null });

    const result = await AttendanceConfirmationService.respondConfirmation('app-1', 'confirmed');

    expect(mockRpc).toHaveBeenCalledWith('respond_attendance_confirmation', {
      p_application_id: 'app-1',
      p_response: 'confirmed',
    });
    expect(result.outcome).toBe('confirmed');
    expect(result.error).toBeUndefined();
  });

  it('"Não vou poder": outcome=cannot_attend sem erro (a notificação é responsabilidade da RPC)', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'cannot_attend' }, error: null });

    const result = await AttendanceConfirmationService.respondConfirmation('app-1', 'cannot_attend');

    expect(result.outcome).toBe('cannot_attend');
    expect(result.error).toBeUndefined();
  });

  // L8/A5: idempotência — duplo toque/retry no mesmo pedido. A RPC garante atomicidade via
  // UPDATE ... WHERE response IS NULL; este teste garante que o SERVICE trata a segunda
  // resposta como erro visível (não como sucesso silencioso) e não reenvia dado divergente.
  it('idempotência (A5): segunda chamada devolve already_responded, sem repetir sucesso', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'confirmed' }, error: null });
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'already_responded' }, error: null });

    const first = await AttendanceConfirmationService.respondConfirmation('app-1', 'confirmed');
    const second = await AttendanceConfirmationService.respondConfirmation('app-1', 'confirmed');

    expect(first.outcome).toBe('confirmed');
    expect(first.error).toBeUndefined();

    expect(second.outcome).toBe('already_responded');
    expect(second.error).toBe(OUTCOME_ERRORS.already_responded);
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('erro de rede/RPC vira outcome not_found com mensagem fixa', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });

    const result = await AttendanceConfirmationService.respondConfirmation('app-1', 'confirmed');

    expect(result.outcome).toBe('not_found');
    expect(result.error).toBe('Não foi possível registrar sua resposta.');
    expect(result.error).not.toMatch(/timeout/);
  });

  const RESPOND_OUTCOMES: AttendanceConfirmationOutcome[] = [
    'unauthenticated',
    'not_target',
    'invalid_status',
    'invalid_response',
    'already_responded',
    'not_requested',
    'not_found',
  ];

  it.each(RESPOND_OUTCOMES)('traduz outcome=%s na mensagem EXATA do mapa OUTCOME_ERRORS', async (outcome) => {
    mockRpc.mockResolvedValue({ data: { outcome }, error: null });

    const result = await AttendanceConfirmationService.respondConfirmation('app-1', 'confirmed');

    expect(result.outcome).toBe(outcome);
    expect(result.error).toBe(OUTCOME_ERRORS[outcome]);
  });
});

// ---------------------------------------------------------------------------
// getConfirmationsForJob — leitura para a empresa (resumo + badges)
// ---------------------------------------------------------------------------

describe('AttendanceConfirmationService.getConfirmationsForJob', () => {
  it('devolve [] sem tocar o banco quando jobId está vazio', async () => {
    const result = await AttendanceConfirmationService.getConfirmationsForJob('');

    expect(result).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('devolve as linhas cruas do turno (agrupamento é responsabilidade de quem consome)', async () => {
    const rows = [
      { id: 'c1', application_id: 'app-1', job_id: 'job-1', worker_id: 'w1', response: 'confirmed' },
      { id: 'c2', application_id: 'app-2', job_id: 'job-1', worker_id: 'w2', response: null },
    ];
    mockFrom.mockReturnValue(makeChain({ data: rows, error: null }));

    const result = await AttendanceConfirmationService.getConfirmationsForJob('job-1');

    expect(mockFrom).toHaveBeenCalledWith('shift_attendance_confirmations');
    expect(result).toHaveLength(2);
  });

  it('devolve [] (não lança) quando a query falha', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: 'RLS' } }));

    const result = await AttendanceConfirmationService.getConfirmationsForJob('job-1');

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getMyPendingConfirmations — leitura para o freela (card em MyJobs)
// ---------------------------------------------------------------------------

describe('AttendanceConfirmationService.getMyPendingConfirmations', () => {
  it('devolve [] sem sessão', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await AttendanceConfirmationService.getMyPendingConfirmations();

    expect(result).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  // L3: pode haver até 2 pedidos pendentes para o MESMO turno (auto + lembrete manual). A UI
  // mostra UM card por turno — dedupe por application_id, mantendo o mais recente.
  it('dedupe por application_id mantendo o pedido mais recente (2 pedidos abertos no mesmo turno)', async () => {
    const rows = [
      {
        id: 'c-manual',
        application_id: 'app-1',
        job_id: 'job-1',
        worker_id: 'worker-1',
        source: 'manual',
        requested_at: '2026-08-17T20:00:00.000Z',
        response: null,
      },
      {
        id: 'c-auto',
        application_id: 'app-1',
        job_id: 'job-1',
        worker_id: 'worker-1',
        source: 'auto',
        requested_at: '2026-08-17T18:00:00.000Z',
        response: null,
      },
      {
        id: 'c-other-job',
        application_id: 'app-2',
        job_id: 'job-2',
        worker_id: 'worker-1',
        source: 'auto',
        requested_at: '2026-08-17T18:00:00.000Z',
        response: null,
      },
    ];
    mockFrom.mockReturnValue(makeChain({ data: rows, error: null }));

    const result = await AttendanceConfirmationService.getMyPendingConfirmations();

    expect(result).toHaveLength(2);
    const forApp1 = result.find((r) => r.application_id === 'app-1');
    // Mantém o pedido MANUAL (mais recente, listado primeiro pelo order desc do query), não o
    // auto — o service não reordena, confia na ordem já pedida ao banco.
    expect(forApp1?.id).toBe('c-manual');
  });

  it('devolve [] (não lança) quando a query falha', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: 'RLS' } }));

    const result = await AttendanceConfirmationService.getMyPendingConfirmations();

    expect(result).toEqual([]);
  });
});
