import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useCurrentCompanyState } from './useCurrentCompany';
import type { MyCompany } from '../types';

vi.mock('../lib/logger', () => ({ logError: vi.fn() }));

let scopeListener: (() => void) | null = null;
const mockGetMyCompanies = vi.fn();
vi.mock('../services/companyScopeService', () => ({
  getMyCompanies: () => mockGetMyCompanies(),
  pickCurrentCompany: (list: MyCompany[]) => list[0] ?? null,
  subscribeCompanyScope: (cb: () => void) => {
    scopeListener = cb;
    return () => { scopeListener = null; };
  },
}));

function row(overrides: Partial<MyCompany> = {}): MyCompany {
  return {
    company_id: 'c1', company_name: 'Divino', role: 'owner', organization_id: 'o1', organization_name: null,
    onboarding_completed: true, accepted_tos: true, confirmed: true, team_enabled: true, ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  scopeListener = null;
});

describe('useCurrentCompanyState', () => {
  it('mantém a MESMA referência de company quando nada relevante mudou (sem re-render em cascata)', async () => {
    mockGetMyCompanies.mockResolvedValue([row()]);
    const { result } = renderHook(() => useCurrentCompanyState());
    await waitFor(() => expect(result.current.resolved).toBe(true));
    const first = result.current.company;
    expect(first).not.toBeNull();

    mockGetMyCompanies.mockResolvedValue([row()]); // objeto novo, mesmos campos
    act(() => scopeListener?.());
    await waitFor(() => expect(mockGetMyCompanies).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.company).toBe(first);
  });

  it('troca a referência quando o papel ou team_enabled mudam', async () => {
    mockGetMyCompanies.mockResolvedValue([row({ team_enabled: false })]);
    const { result } = renderHook(() => useCurrentCompanyState());
    await waitFor(() => expect(result.current.company?.team_enabled).toBe(false));

    mockGetMyCompanies.mockResolvedValue([row({ team_enabled: true })]);
    act(() => scopeListener?.());
    await waitFor(() => expect(result.current.company?.team_enabled).toBe(true));
  });

  it('falha no refetch zera a empresa e expõe error: acesso revogado não parece ativo', async () => {
    mockGetMyCompanies.mockResolvedValue([row()]);
    const { result } = renderHook(() => useCurrentCompanyState());
    await waitFor(() => expect(result.current.company).not.toBeNull());

    mockGetMyCompanies.mockRejectedValue(new Error('rede'));
    act(() => scopeListener?.());
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.company).toBeNull();
    expect(result.current.resolved).toBe(true);
  });
});
