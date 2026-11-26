import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), createShiftCall: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock('../lib/logger', () => ({ logError: vi.fn() }));
vi.mock('./shiftCallService', () => ({ ShiftCallService: { createShiftCall: mocks.createShiftCall } }));
vi.mock('./jobScopeService', () => ({
  getJobScope: vi.fn(), canSeeJob: () => true, scopeResponsibleIds: () => [],
}));

import { buildCallPlan, dispatchCalls, publishBatch, resolveInvitees } from './shiftBatchService';
import { createRow, emptyTemplate, type ShiftDraftBatch } from '../lib/shiftDrafts';

const rows = ['2026-11-28', '2026-11-29', '2026-12-05'].map((d) =>
  createRow(d, { start_time: '18:00', end_time: '23:00', slots: 3, budget: 150 }));
const batch: ShiftDraftBatch = { client_batch_id: 'b-1', source: 'form', template: emptyTemplate('garcom'), rows };

/** `from('shift_calls').select().eq().eq()` */
const openCalls = (data: unknown[]) => {
  const chain = { select: () => chain, eq: vi.fn(), then: undefined as unknown };
  chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ data, error: null });
  mocks.from.mockReturnValue(chain);
};

beforeEach(() => vi.clearAllMocks());

describe('publishBatch', () => {
  it('envia uma única RPC com o id do lote e sem campos locais', async () => {
    mocks.rpc.mockResolvedValue({ data: { outcome: 'created', job_ids: ['1', '2', '3'] }, error: null });
    expect(await publishBatch('emp', batch)).toEqual({ ok: true, alreadyCreated: false, jobIds: ['1', '2', '3'] });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe('create_jobs_batch');
    expect(args).toMatchObject({ p_client_batch_id: 'b-1', p_company_id: 'emp', p_series: null });
    expect(args.p_rows[0]).not.toHaveProperty('key');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('A3: already_created é sucesso', async () => {
    mocks.rpc.mockResolvedValue({ data: { outcome: 'already_created', job_ids: ['1'] }, error: null });
    expect(await publishBatch('emp', batch)).toMatchObject({ ok: true, alreadyCreated: true });
  });

  it('erro por linha volta com a linha', async () => {
    mocks.rpc.mockResolvedValue({
      data: { outcome: 'invalid', errors: [{ row: 7, code: 'past_date', message: 'Esta data já passou.' }] }, error: null,
    });
    expect(await publishBatch('emp', batch)).toMatchObject({ ok: false, uncertain: false, errors: [{ row: 7 }] });
  });

  it.each([
    ['resposta de erro sem código', () => mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })],
    ['exceção de rede', () => mocks.rpc.mockRejectedValue(new TypeError('Failed to fetch'))],
  ])('%s: resultado incerto, repetir é seguro', async (_l, arrange) => {
    arrange();
    expect(await publishBatch('emp', batch)).toMatchObject({ ok: false, uncertain: true });
  });

  it('migration não aplicada tem mensagem própria', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    const result = await publishBatch('emp', batch);
    expect(result).toMatchObject({ ok: false, uncertain: false });
    expect(!result.ok && result.message).toContain('ainda não está disponível');
  });
});

describe('chamar depois de publicar', () => {
  const eligible = new Set(['a', 'b', 'c']);
  const list = () => ['a', 'b', 'saiu-do-elenco'];

  it('a linha vence a escolha geral e quem saiu do elenco fica fora', () => {
    const call = { mode: 'list' as const, list_id: 'l' };
    expect(resolveInvitees(rows[0], call, list, eligible)).toEqual(['a', 'b']);
    expect(resolveInvitees({ ...rows[0], invite_worker_ids: ['c', 'c'] }, call, list, eligible)).toEqual(['c']);
    expect(resolveInvitees(rows[0], { mode: 'none' }, list, eligible)).toEqual([]);
  });

  it('lista e pessoas avulsas somam', () => {
    expect(resolveInvitees(rows[0], { mode: 'list', list_id: 'l', worker_ids: ['c'] }, list, eligible)).toEqual(['a', 'b', 'c']);
    expect(resolveInvitees(rows[0], { mode: 'workers', worker_ids: ['c', 'zz'] }, list, eligible)).toEqual(['c']);
  });

  it('liga cada linha ao turno pela ordem e pula quem não tem convidado', () => {
    expect(buildCallPlan(rows, ['j1', 'j2', 'j3'], (r) => (r === rows[1] ? [] : ['a'])).map((p) => p.job_id))
      .toEqual(['j1', 'j3']);
  });

  const plan = ['j1', 'j2', 'j3'].map((job_id) => ({ job_id, row_key: job_id, worker_ids: ['a'] }));

  it('A7: uma falha não interrompe nem desfaz as outras', async () => {
    mocks.createShiftCall
      .mockResolvedValueOnce({ call: {} })
      .mockResolvedValueOnce({ call: null, error: 'cota' })
      .mockRejectedValueOnce(new Error('rede'));
    const results = await dispatchCalls(plan, { mode: 'workers', expires_minutes: 90 });
    expect(results.map((r) => r.status)).toEqual(['sent', 'failed', 'failed']);
    expect(results[1].error).toBe('cota');
    expect(mocks.createShiftCall).toHaveBeenNthCalledWith(1, 'j1', ['a'], { reason: 'outro', expiresInHours: 1.5 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('"Tentar de novo" não abre 2º chamado se o primeiro chegou', async () => {
    openCalls([{ id: 'c', targets: [{ worker_id: 'a' }] }]);
    const [result] = await dispatchCalls(plan.slice(0, 1), undefined, { retry: true });
    expect(result.status).toBe('sent');
    expect(mocks.createShiftCall).not.toHaveBeenCalled();
  });

  it('chamado vazio (sem alvos) não conta como enviado', async () => {
    openCalls([{ id: 'c', targets: [] }]);
    mocks.createShiftCall.mockResolvedValue({ call: {} });
    await dispatchCalls(plan.slice(0, 1), undefined, { retry: true });
    expect(mocks.createShiftCall).toHaveBeenCalledTimes(1);
  });
});
