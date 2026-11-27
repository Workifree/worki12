import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  archiveTag,
  renameTag,
  buildShiftWindow,
  cancelJob,
  cancelJobMessage,
  cancelJobWasRefused,
  coverageMessage,
  coverageSpanDays,
  createCoverage,
  createTag,
  getBusyWorkerIds,
  isCancelJobAvailable,
  resetCancelJobAvailability,
  listCompanyOperators,
  listJobsByResponsible,
  reassignJobs,
  reassignMessage,
  setJobTag,
  tagMessage,
} from './shiftOperationService';

const mockRpc = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: { rpc: (fn: string, params?: unknown) => mockRpc(fn, params) },
}));
const mockLogError = vi.fn();
vi.mock('../lib/logger', () => ({ logError: (...args: unknown[]) => mockLogError(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildShiftWindow', () => {
  it('monta a janela do dia com offset de São Paulo', () => {
    expect(buildShiftWindow('2026-11-25', '09:00:00', '17:30')).toEqual({
      start: '2026-11-25T09:00:00-03:00',
      end: '2026-11-25T17:30:00-03:00',
    });
  });

  it('cruza a meia-noite quando a saída é igual ou antes da entrada', () => {
    expect(buildShiftWindow('2026-11-25', '22:00', '04:00')).toEqual({
      start: '2026-11-25T22:00:00-03:00',
      end: '2026-11-26T04:00:00-03:00',
    });
  });

  it('sem horário vale o dia inteiro', () => {
    expect(buildShiftWindow('2026-11-30', null, null)).toEqual({
      start: '2026-11-30T00:00:00-03:00',
      end: '2026-12-01T00:00:00-03:00',
    });
  });

  it('usa a data civil de Brasília de um timestamp (meio-dia local)', () => {
    const win = buildShiftWindow('2026-11-25T15:00:00.000Z', '08:00', '12:00');
    expect(win?.start).toBe('2026-11-25T08:00:00-03:00');
  });

  it('sem data não há janela', () => {
    expect(buildShiftWindow(null)).toBeNull();
    expect(buildShiftWindow('')).toBeNull();
  });
});

describe('getBusyWorkerIds', () => {
  const win = { start: '2026-11-25T09:00:00-03:00', end: '2026-11-25T17:00:00-03:00' };

  it('chama a RPC com o contrato e devolve só os ids', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ worker_id: 'w1' }, { worker_id: 'w3' }], error: null });
    const result = await getBusyWorkerIds({ companyId: 'c1', window: win, workerIds: ['w1', 'w2', 'w3'], excludeJobId: 'j1' });
    expect(mockRpc).toHaveBeenCalledWith('get_busy_workers', {
      p_company_id: 'c1',
      p_start: win.start,
      p_end: win.end,
      p_worker_ids: ['w1', 'w2', 'w3'],
      p_exclude_job_id: 'j1',
    });
    expect([...result].sort()).toEqual(['w1', 'w3']);
  });

  it('divide mais de 200 freelas em lotes de 200 e une os resultados', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `w${i}`);
    mockRpc
      .mockResolvedValueOnce({ data: [{ worker_id: 'w1' }], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'x' } })
      .mockResolvedValueOnce({ data: [{ worker_id: 'w440' }], error: null });
    const result = await getBusyWorkerIds({ companyId: 'c1', window: win, workerIds: ids });
    expect(mockRpc).toHaveBeenCalledTimes(3);
    expect((mockRpc.mock.calls[0][1] as { p_worker_ids: string[] }).p_worker_ids).toHaveLength(200);
    expect((mockRpc.mock.calls[2][1] as { p_worker_ids: string[] }).p_worker_ids).toHaveLength(50);
    expect([...result].sort()).toEqual(['w1', 'w440']);
  });

  it('não consulta sem janela ou sem freelas', async () => {
    expect((await getBusyWorkerIds({ companyId: 'c1', window: null, workerIds: ['w1'] })).size).toBe(0);
    expect((await getBusyWorkerIds({ companyId: 'c1', window: win, workerIds: [] })).size).toBe(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('erro da RPC (ex.: 42501) degrada para "sem aviso" e registra o log, sem lançar', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'forbidden' } });
    const result = await getBusyWorkerIds({ companyId: 'c1', window: win, workerIds: ['w1'] });
    expect(result.size).toBe(0);
    expect(mockLogError).toHaveBeenCalled();
  });

  it('falha de rede também degrada', async () => {
    mockRpc.mockRejectedValueOnce(new Error('rede'));
    expect((await getBusyWorkerIds({ companyId: 'c1', window: win, workerIds: ['w1'] })).size).toBe(0);
  });
});

describe('reassignJobs', () => {
  it('traduz moved/skipped', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'ok', moved: 2, skipped: 1 }, error: null });
    const result = await reassignJobs(['a', 'b', 'c'], 'u1');
    expect(mockRpc).toHaveBeenCalledWith('reassign_job_responsible', { p_job_ids: ['a', 'b', 'c'], p_to: 'u1' });
    expect(result).toEqual({ outcome: 'ok', moved: 2, skipped: 1 });
    expect(reassignMessage(result)).toBe('2 turnos foram passados. 1 turno não pôde ser passado.');
  });

  it('nothing_moved e erro viram mensagens claras', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'nothing_moved', moved: 0, skipped: 1 }, error: null });
    const r = await reassignJobs(['a'], 'u1');
    expect(r.outcome).toBe('nothing_moved');
    expect(reassignMessage(r)).toMatch(/Nenhum turno foi passado/);

    mockRpc.mockRejectedValueOnce(new Error('x'));
    expect((await reassignJobs(['a'], 'u1')).outcome).toBe('error');
  });
});

describe('createCoverage', () => {
  const params = { companyId: 'c1', fromUserId: 'a', toUserId: 'b', startsOn: '2026-12-01', endsOn: '2026-12-10' };

  it('envia os parâmetros nomeados do contrato', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'created', coverage_id: 'cv1' }, error: null });
    const r = await createCoverage(params);
    expect(mockRpc).toHaveBeenCalledWith('create_responsibility_coverage', {
      p_company_id: 'c1', p_from: 'a', p_to: 'b', p_starts_on: '2026-12-01', p_ends_on: '2026-12-10',
    });
    expect(r).toMatchObject({ outcome: 'created', coverageId: 'cv1' });
  });

  it('overlaps traz a janela existente e a mensagem a cita', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { outcome: 'overlaps', coverage_id: 'cv0', existing_starts_on: '2026-12-05', existing_ends_on: '2026-12-20' },
      error: null,
    });
    const r = await createCoverage(params);
    expect(r.outcome).toBe('overlaps');
    expect(coverageMessage(r)).toContain('05/12 a 20/12');
  });

  it('mensagens dos demais desfechos', () => {
    expect(coverageMessage({ outcome: 'window_too_long' })).toMatch(/60 dias/);
    expect(coverageMessage({ outcome: 'from_is_gestor' })).toMatch(/Gestor/);
    expect(coverageMessage({ outcome: 'already_covered' })).toMatch(/já está coberto/);
    expect(coverageMessage({ outcome: 'starts_in_the_past' })).toBe('A cobertura precisa começar hoje (ou ontem).');
  });

  it('coverageSpanDays conta dias corridos inclusive', () => {
    expect(coverageSpanDays('2026-12-01', '2026-12-01')).toBe(1);
    expect(coverageSpanDays('2026-12-01', '2026-12-10')).toBe(10);
    expect(coverageSpanDays('2026-12-10', '2026-12-01')).toBe(-8);
    expect(coverageSpanDays('', '2026-12-01')).toBeNaN();
  });
});

describe('cancelJob', () => {
  it('manda motivo aparado (ou null) e traduz as contagens', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { outcome: 'cancelled', cancelled_applications: 2, cancelled_calls: 1, closed_candidates: 1 },
      error: null,
    });
    const r = await cancelJob('j1', '  evento remarcado ');
    expect(mockRpc).toHaveBeenCalledWith('cancel_job', { p_job_id: 'j1', p_reason: 'evento remarcado' });
    expect(r).toEqual({ outcome: 'cancelled', cancelledApplications: 2, cancelledCalls: 1, closedCandidates: 1 });
    expect(cancelJobMessage(r)).toBe('Turno cancelado. 3 pessoas foram avisadas.');

    mockRpc.mockResolvedValueOnce({ data: { outcome: 'cancelled' }, error: null });
    await cancelJob('j2', '   ');
    expect(mockRpc).toHaveBeenLastCalledWith('cancel_job', { p_job_id: 'j2', p_reason: null });
  });

  it.each([
    ['active_payment', /pagamento/],
    ['attendance_started', /presença/],
    ['active_escrow', /reserva de saldo/],
    ['job_in_the_past', /já começou/],
    ['forbidden', /permissão/],
  ] as const)('recusa %s vira texto claro e é marcada como recusa', (outcome, pattern) => {
    const result = { outcome, cancelledApplications: 0, cancelledCalls: 0, closedCandidates: 0 };
    expect(cancelJobMessage(result)).toMatch(pattern);
    expect(cancelJobWasRefused(outcome)).toBe(true);
  });

  it('copy depende do papel e não manda "devolver a reserva"', () => {
    const base = { cancelledApplications: 0, cancelledCalls: 0, closedCandidates: 0 };
    expect(cancelJobMessage({ outcome: 'active_payment', ...base }, 'gestor')).toMatch(/Estorne o pagamento registrado/);
    expect(cancelJobMessage({ outcome: 'active_payment', ...base }, 'encarregado')).toMatch(/Peça ao Gestor/);
    const escrow = cancelJobMessage({ outcome: 'active_escrow', ...base });
    expect(escrow).toBe('Este turno tem uma reserva de saldo ativa; fale com o suporte do Worki.');
    expect(escrow).not.toMatch(/Devolva/);
  });

  it('turno vazio e erro de rede', async () => {
    expect(cancelJobMessage({ outcome: 'cancelled', cancelledApplications: 0, cancelledCalls: 0, closedCandidates: 0 }))
      .toBe('Turno cancelado. Não havia ninguém no turno.');
    mockRpc.mockRejectedValueOnce(new Error('rede'));
    const r = await cancelJob('j1');
    expect(r.outcome).toBe('error');
    expect(cancelJobWasRefused(r.outcome)).toBe(false);
  });
});

describe('tags', () => {
  it('createTag e setJobTag usam o contrato', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'created', tag_id: 't1' }, error: null });
    expect(await createTag('c1', 'Salão')).toEqual({ outcome: 'created', tagId: 't1' });
    expect(mockRpc).toHaveBeenCalledWith('create_company_tag', { p_company_id: 'c1', p_name: 'Salão' });

    mockRpc.mockResolvedValueOnce({ data: { outcome: 'ok' }, error: null });
    await setJobTag('j1', null);
    expect(mockRpc).toHaveBeenLastCalledWith('set_job_tag', { p_job_id: 'j1', p_tag_id: null });
  });
});

describe('listJobsByResponsible', () => {
  it('mapeia os itens e o responsável efetivo', async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        outcome: 'ok',
        truncated: false,
        items: [
          {
            job_id: 'j1', title: 'Garçom', status: 'open', date: '2026-11-25', start_time: '18:00:00', slots: 2, filled: 1,
            responsible_id: 'u1', responsible_kind: 'person', responsible_label: 'Ana', creator_label: null,
            tag_id: 't1', tag_name: 'Salão', tag_archived: false,
          },
          {
            job_id: 'j2', title: 'Copa', status: 'open', date: '2026-11-25', start_time: null, slots: 1, filled: 0,
            responsible_id: 'u9', responsible_kind: 'gestor', responsible_label: 'Gestor', creator_label: 'Bia',
            tag_id: null, tag_name: null, tag_archived: null,
          },
        ],
      },
      error: null,
    });
    const r = await listJobsByResponsible({ companyId: 'c1', from: '2026-11-25', to: '2026-12-08', responsibleId: 'u1' });
    expect(mockRpc).toHaveBeenCalledWith('list_jobs_by_responsible', {
      p_company_id: 'c1', p_from: '2026-11-25', p_to: '2026-12-08', p_responsible_id: 'u1', p_tag_id: null,
    });
    expect(r.outcome).toBe('ok');
    expect(r.items[0]).toMatchObject({ startTime: '18:00', responsibleKind: 'person', tagName: 'Salão' });
    expect(r.items[1]).toMatchObject({ startTime: null, responsibleKind: 'gestor', creatorLabel: 'Bia' });
  });

  it('forbidden não traz itens', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'forbidden' }, error: null });
    expect(await listJobsByResponsible({ companyId: 'c1', from: 'a', to: 'b' })).toEqual({ outcome: 'forbidden', truncated: false, items: [] });
  });
});

describe('listCompanyOperators', () => {
  it('devolve só user_id e rótulo', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ user_id: 'u1', label: 'Ana', role: 'encarregado' }, { user_id: 'u2', label: null, role: 'gestor' }, { user_id: 'u3', label: 'X' }],
      error: null,
    });
    const r = await listCompanyOperators('c1');
    expect(mockRpc).toHaveBeenCalledWith('list_company_operators', { p_company_id: 'c1' });
    expect(r).toEqual({
      ok: true,
      items: [
        { userId: 'u1', label: 'Ana', role: 'encarregado' },
        { userId: 'u2', label: 'Sem nome', role: 'gestor' },
        // papel ausente nunca vira encarregado
        { userId: 'u3', label: 'X', role: 'gestor' },
      ],
    });
  });

  it('erro 42501 vira ok:false (nunca lista vazia fingindo sucesso)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'forbidden' } });
    expect(await listCompanyOperators('c1')).toEqual({ ok: false, items: [] });
    expect(mockLogError).toHaveBeenCalled();
  });
});

describe('tagMessage', () => {
  it('forbidden de atribuição fala do turno; o de gestão fala de criar/arquivar', () => {
    expect(tagMessage('forbidden', 'assign')).toBe('Você não pode alterar a etiqueta deste turno.');
    expect(tagMessage('forbidden')).toBe('Só o Gestor pode criar ou arquivar etiquetas.');
  });
});

describe('isCancelJobAvailable (front no ar antes da E5)', () => {
  beforeEach(() => resetCancelJobAvailability());

  it('sonda inócua (p_job_id nulo); função inexistente esconde o botão e fica em cache', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    expect(await isCancelJobAvailable()).toBe(false);
    expect(await isCancelJobAvailable()).toBe(false);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('cancel_job', { p_job_id: null, p_reason: null });
  });

  it('função existente (invalid_input) = disponível; erro de rede não é cacheado como ausência', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'invalid_input' }, error: null });
    expect(await isCancelJobAvailable()).toBe(true);
    resetCancelJobAvailability();
    mockRpc.mockRejectedValueOnce(new Error('rede'));
    expect(await isCancelJobAvailable()).toBe(true);
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'x' } });
    expect(await isCancelJobAvailable()).toBe(false);
  });

  it('cancelJob com a RPC ausente devolve "unavailable" com texto claro', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    const r = await cancelJob('j1');
    expect(r.outcome).toBe('unavailable');
    expect(cancelJobMessage(r)).toMatch(/ainda não está disponível/);
  });
});

describe('lojas: renomear e arquivar (ADR-20261127)', () => {
  it('renameTag usa o contrato e devolve o outcome', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'renamed', tag_id: 't1' }, error: null });
    expect(await renameTag('t1', 'Loja Centro')).toEqual({ outcome: 'renamed' });
    expect(mockRpc).toHaveBeenLastCalledWith('rename_company_tag', { p_tag_id: 't1', p_name: 'Loja Centro' });
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'already_exists' }, error: null });
    expect((await renameTag('t1', 'Outra')).outcome).toBe('already_exists');
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('x') });
    expect((await renameTag('t1', 'Outra')).outcome).toBe('error');
  });

  it('archiveTag devolve a contagem só em default_of_members', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'default_of_members', count: 2 }, error: null });
    expect(await archiveTag('t1')).toEqual({ outcome: 'default_of_members', count: 2 });
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'archived' }, error: null });
    expect(await archiveTag('t1')).toEqual({ outcome: 'archived' });
  });

  it('tagMessage cobre renamed e default_of_members', () => {
    expect(tagMessage('default_of_members')).toMatch(/padrão/);
    expect(tagMessage('renamed')).toMatch(/Nome atualizado/);
  });
});
