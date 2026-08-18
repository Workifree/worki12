import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobSeriesService, type JobSeriesTemplate } from './jobSeriesService';
import { MAX_SERIES_OCCURRENCES } from '../lib/recurrence';

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
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
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

const jobTemplate: JobSeriesTemplate = {
  title: 'Garçom',
  category: 'Eventos',
  location: 'Rua X, 123',
  budget: 150,
  budget_type: 'daily',
  work_start_time: '08:00',
  work_end_time: '17:00',
  slots: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'companies') {
      return makeChain({ data: { id: 'company-1' }, error: null });
    }
    if (table === 'job_series') {
      return makeChain({ data: [], error: null });
    }
    throw new Error(`tabela inesperada no mock: ${table}`);
  });
});

// ---------------------------------------------------------------------------
// createSeries
// ---------------------------------------------------------------------------

describe('JobSeriesService.createSeries', () => {
  it('bloqueia NO CLIENT (R7) quando não há ocorrência nenhuma, sem chamar o banco', async () => {
    const result = await JobSeriesService.createSeries({
      recurrenceType: 'weekly',
      weekdays: [0],
      rangeStartDate: '2026-09-01',
      rangeEndDate: '2026-09-30',
      occurrenceDates: [],
      jobTemplate,
    });

    expect(result.seriesId).toBeNull();
    expect(result.error).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('bloqueia NO CLIENT (R7/A3) quando o intervalo geraria mais que o limite, sem chamar o banco', async () => {
    const occurrenceDates = Array.from({ length: MAX_SERIES_OCCURRENCES + 1 }, (_, i) =>
      `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
    );

    const result = await JobSeriesService.createSeries({
      recurrenceType: 'daily',
      rangeStartDate: '2026-09-01',
      rangeEndDate: '2026-12-31',
      occurrenceDates,
      jobTemplate,
    });

    expect(result.seriesId).toBeNull();
    expect(result.occurrences).toBe(0);
    expect(result.error).toContain(String(MAX_SERIES_OCCURRENCES));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('recusa recorrência semanal sem nenhum dia da semana marcado, sem chamar o banco', async () => {
    const result = await JobSeriesService.createSeries({
      recurrenceType: 'weekly',
      weekdays: [],
      rangeStartDate: '2026-09-01',
      rangeEndDate: '2026-09-30',
      occurrenceDates: ['2026-09-06'],
      jobTemplate,
    });

    expect(result.seriesId).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('A1 (spec): chama create_job_series com os parâmetros corretos e devolve seriesId/occurrences', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { outcome: 'ok', series_id: 'series-1', occurrences: 4 },
      error: null,
    });

    const result = await JobSeriesService.createSeries({
      recurrenceType: 'weekly',
      weekdays: [0],
      rangeStartDate: '2026-09-01',
      rangeEndDate: '2026-09-30',
      occurrenceDates: ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27'],
      jobTemplate,
    });

    expect(result).toEqual({ seriesId: 'series-1', occurrences: 4 });
    expect(mockRpc).toHaveBeenCalledWith('create_job_series', {
      p_company_id: 'company-1',
      p_recurrence_type: 'weekly',
      p_weekdays: [0],
      p_range_start_date: '2026-09-01',
      p_range_end_date: '2026-09-30',
      p_occurrence_dates: ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27'],
      p_job_template: jobTemplate,
    });
  });

  it('envia p_weekdays=null quando recurrenceType é daily, mesmo que weekdays venha preenchido por engano', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { outcome: 'ok', series_id: 'series-2', occurrences: 5 },
      error: null,
    });

    await JobSeriesService.createSeries({
      recurrenceType: 'daily',
      weekdays: [1, 2],
      rangeStartDate: '2026-09-01',
      rangeEndDate: '2026-09-05',
      occurrenceDates: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'],
      jobTemplate,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'create_job_series',
      expect.objectContaining({ p_weekdays: null }),
    );
  });

  it('LM-12: erro 23505 (unique violation — hoje só cai aqui por datas duplicadas no MESMO lote, NÃO por duplo-clique) vira mensagem específica, não genérica', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });

    const result = await JobSeriesService.createSeries({
      recurrenceType: 'daily',
      rangeStartDate: '2026-09-01',
      rangeEndDate: '2026-09-05',
      occurrenceDates: ['2026-09-01'],
      jobTemplate,
    });

    expect(result.seriesId).toBeNull();
    expect(result.error).toBe('Essa série já foi criada.');
  });

  it('outcome cap_exceeded do banco (revalidação server-side) é traduzido em mensagem', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'cap_exceeded' }, error: null });

    const result = await JobSeriesService.createSeries({
      recurrenceType: 'daily',
      rangeStartDate: '2026-09-01',
      rangeEndDate: '2026-09-05',
      occurrenceDates: ['2026-09-01'],
      jobTemplate,
    });

    expect(result.seriesId).toBeNull();
    expect(result.error).toContain(String(MAX_SERIES_OCCURRENCES));
  });

  it('erro genérico de RPC (sem code conhecido) cai em mensagem genérica', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    const result = await JobSeriesService.createSeries({
      recurrenceType: 'daily',
      rangeStartDate: '2026-09-01',
      rangeEndDate: '2026-09-05',
      occurrenceDates: ['2026-09-01'],
      jobTemplate,
    });

    expect(result.seriesId).toBeNull();
    expect(result.error).toBe('Não foi possível criar a série de turnos.');
  });
});

// ---------------------------------------------------------------------------
// updateFutureOccurrences
// ---------------------------------------------------------------------------

describe('JobSeriesService.updateFutureOccurrences', () => {
  it('A5 (spec): repassa seriesId/fromDate/patch e mapeia updated/skippedFilled/skippedCalled', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { outcome: 'ok', updated: 3, skipped_filled: 1, skipped_called: 0 },
      error: null,
    });

    const result = await JobSeriesService.updateFutureOccurrences('series-1', '2026-09-10', {
      briefing: 'Camisa verde',
    });

    expect(result).toEqual({ updated: 3, skippedFilled: 1, skippedCalled: 0 });
    expect(mockRpc).toHaveBeenCalledWith('update_job_series_future', {
      p_series_id: 'series-1',
      p_from_date: '2026-09-10',
      p_patch: { briefing: 'Camisa verde' },
    });
  });

  it('traduz outcome forbidden em mensagem', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'forbidden' }, error: null });

    const result = await JobSeriesService.updateFutureOccurrences('series-1', '2026-09-10', {});

    expect(result.updated).toBe(0);
    expect(result.error).toBe('Você não tem permissão sobre esta série.');
  });

  it('erro de transporte (RPC error) devolve mensagem genérica sem lançar', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'network' } });

    const result = await JobSeriesService.updateFutureOccurrences('series-1', '2026-09-10', {});

    expect(result.updated).toBe(0);
    expect(result.error).toBe('Não foi possível atualizar os turnos futuros.');
  });
});

// ---------------------------------------------------------------------------
// stopSeries
// ---------------------------------------------------------------------------

describe('JobSeriesService.previewUpdateFutureOccurrences', () => {
  it('chama a MESMA RPC de updateFutureOccurrences com p_dry_run=true e mapeia wouldUpdate', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { outcome: 'preview', would_update: 3, skipped_filled: 1, skipped_called: 0 },
      error: null,
    });

    const result = await JobSeriesService.previewUpdateFutureOccurrences('series-1', '2026-09-10', {
      briefing: 'Camisa verde',
    });

    expect(result).toEqual({ wouldUpdate: 3, skippedFilled: 1, skippedCalled: 0 });
    expect(mockRpc).toHaveBeenCalledWith('update_job_series_future', {
      p_series_id: 'series-1',
      p_from_date: '2026-09-10',
      p_patch: { briefing: 'Camisa verde' },
      p_dry_run: true,
    });
  });

  it('não confunde outcome "ok" (execução) com "preview" — só aceita preview como sucesso', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { outcome: 'ok', updated: 3, skipped_filled: 0, skipped_called: 0 },
      error: null,
    });

    const result = await JobSeriesService.previewUpdateFutureOccurrences('series-1', '2026-09-10', {});

    expect(result.wouldUpdate).toBe(0);
    expect(result.error).toBeTruthy();
  });

  it('traduz outcome forbidden em mensagem', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'forbidden' }, error: null });

    const result = await JobSeriesService.previewUpdateFutureOccurrences('series-1', '2026-09-10', {});

    expect(result.wouldUpdate).toBe(0);
    expect(result.error).toBe('Você não tem permissão sobre esta série.');
  });
});

describe('JobSeriesService.previewStopSeries', () => {
  it('chama a MESMA RPC de stopSeries com p_dry_run=true e mapeia wouldCancel', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { outcome: 'preview', would_cancel: 3, skipped_filled: 1, skipped_called: 0 },
      error: null,
    });

    const result = await JobSeriesService.previewStopSeries('series-1');

    expect(result).toEqual({ wouldCancel: 3, skippedFilled: 1, skippedCalled: 0 });
    expect(mockRpc).toHaveBeenCalledWith('stop_job_series', {
      p_series_id: 'series-1',
      p_from_date: null,
      p_dry_run: true,
    });
  });

  it('repassa fromDate quando informado', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { outcome: 'preview', would_cancel: 0, skipped_filled: 0, skipped_called: 0 },
      error: null,
    });

    await JobSeriesService.previewStopSeries('series-1', '2026-09-15');

    expect(mockRpc).toHaveBeenCalledWith('stop_job_series', {
      p_series_id: 'series-1',
      p_from_date: '2026-09-15',
      p_dry_run: true,
    });
  });

  it('erro de transporte devolve mensagem genérica sem lançar', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'network' } });

    const result = await JobSeriesService.previewStopSeries('series-1');

    expect(result.wouldCancel).toBe(0);
    expect(result.error).toBe('Não foi possível calcular a prévia do cancelamento.');
  });
});

describe('JobSeriesService.stopSeries', () => {
  it('A6 (spec): mapeia cancelled/skippedFilled/skippedCalled do outcome ok', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { outcome: 'ok', cancelled: 3, skipped_filled: 1, skipped_called: 0 },
      error: null,
    });

    const result = await JobSeriesService.stopSeries('series-1');

    expect(result).toEqual({ cancelled: 3, skippedFilled: 1, skippedCalled: 0 });
    expect(mockRpc).toHaveBeenCalledWith('stop_job_series', {
      p_series_id: 'series-1',
      p_from_date: null,
    });
  });

  it('repassa fromDate quando informado', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { outcome: 'ok', cancelled: 0, skipped_filled: 0, skipped_called: 0 },
      error: null,
    });

    await JobSeriesService.stopSeries('series-1', '2026-09-15');

    expect(mockRpc).toHaveBeenCalledWith('stop_job_series', {
      p_series_id: 'series-1',
      p_from_date: '2026-09-15',
    });
  });

  it('outcome not_found é traduzido', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'not_found' }, error: null });

    const result = await JobSeriesService.stopSeries('series-inexistente');

    expect(result.cancelled).toBe(0);
    expect(result.error).toBe('Série não encontrada.');
  });
});

// ---------------------------------------------------------------------------
// listSeries
// ---------------------------------------------------------------------------

describe('JobSeriesService.listSeries', () => {
  it('filtra por company_id da empresa autenticada, mais recente primeiro', async () => {
    const chain = makeChain({
      data: [{ id: 'series-1', company_id: 'company-1', status: 'active' }],
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'companies') return makeChain({ data: { id: 'company-1' }, error: null });
      if (table === 'job_series') return chain;
      throw new Error(`tabela inesperada: ${table}`);
    });

    const result = await JobSeriesService.listSeries();

    expect(result).toHaveLength(1);
    expect(chain.eq).toHaveBeenCalledWith('company_id', 'company-1');
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('devolve lista vazia (não lança) quando a query falha', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'companies') return makeChain({ data: { id: 'company-1' }, error: null });
      if (table === 'job_series') return makeChain({ data: null, error: { message: 'boom' } });
      throw new Error(`tabela inesperada: ${table}`);
    });

    const result = await JobSeriesService.listSeries();
    expect(result).toEqual([]);
  });
});
