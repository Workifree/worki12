import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBusyWorkers } from './useBusyWorkers';

vi.mock('../lib/logger', () => ({ logError: vi.fn() }));
const mockSeam = vi.fn();
vi.mock('../services/companyScopeService', () => ({ getAuthenticatedCompanyId: () => mockSeam() }));
const mockBusy = vi.fn();
vi.mock('../services/shiftOperationService', () => ({ getBusyWorkerIds: (p: unknown) => mockBusy(p) }));

const win = { start: '2026-11-25T09:00:00-03:00', end: '2026-11-25T17:00:00-03:00' };

beforeEach(() => {
  vi.clearAllMocks();
  mockSeam.mockResolvedValue('seam-company');
});

describe('useBusyWorkers', () => {
  it('usa a empresa do turno (companyId) em vez da corrente do seam', async () => {
    mockBusy.mockResolvedValue(new Set(['w1']));
    const { result } = renderHook(() => useBusyWorkers({ windows: [win], workerIds: ['w1'], companyId: 'company-do-turno' }));
    await waitFor(() => expect(result.current.has('w1')).toBe(true));
    expect(mockSeam).not.toHaveBeenCalled();
    expect(mockBusy).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company-do-turno' }));
  });

  it('ignora resposta atrasada de uma consulta que já foi trocada', async () => {
    let resolveOld: (s: Set<string>) => void = () => undefined;
    mockBusy.mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }));
    mockBusy.mockResolvedValueOnce(new Set(['novo']));

    const { result, rerender } = renderHook(
      (props: { ids: string[] }) => useBusyWorkers({ windows: [win], workerIds: props.ids, companyId: 'c' }),
      { initialProps: { ids: ['a'] } },
    );
    rerender({ ids: ['b'] });
    await waitFor(() => expect(result.current.has('novo')).toBe(true));

    resolveOld(new Set(['velho'])); // chega depois, de outra consulta
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.has('velho')).toBe(false);
    expect(result.current.has('novo')).toBe(true);
  });

  it('com janelas de ocorrências, cada janela exclui o próprio turno', async () => {
    mockBusy.mockResolvedValue(new Set());
    renderHook(() => useBusyWorkers({ windows: [{ ...win, excludeJobId: 'j1' }], workerIds: ['w1'], companyId: 'c' }));
    await waitFor(() => expect(mockBusy).toHaveBeenCalled());
    expect(mockBusy).toHaveBeenCalledWith(expect.objectContaining({ excludeJobId: 'j1' }));
  });
});
