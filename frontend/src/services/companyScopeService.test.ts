import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getMyCompanies,
  pickPrimaryCompany,
  pickCurrentCompany,
  getAuthenticatedCompanyId,
  setSelectedCompanyId,
  getSelectedCompanyId,
  invalidateCompanyScope,
} from './companyScopeService';
import type { MyCompany } from '../types';

const mockGetUser = vi.fn();
const mockRpc = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

vi.mock('../lib/logger', () => ({ logError: vi.fn() }));

function row(overrides: Partial<MyCompany> = {}): MyCompany {
  return {
    company_id: 'comp-1',
    company_name: 'Empresa',
    role: 'owner',
    organization_id: 'org-1',
    organization_name: 'Org',
    onboarding_completed: true,
    accepted_tos: true,
    ...overrides,
  };
}

describe('companyScopeService', () => {
  beforeEach(() => {
    invalidateCompanyScope();  // o cache de rajada nao pode vazar entre testes
    vi.clearAllMocks();
    setSelectedCompanyId(null);
  });

  describe('getMyCompanies', () => {
    it('devolve as linhas da RPC get_my_companies', async () => {
      mockRpc.mockResolvedValue({ data: [row()], error: null });
      const result = await getMyCompanies();
      expect(mockRpc).toHaveBeenCalledWith('get_my_companies');
      expect(result).toEqual([row()]);
    });

    it('lança quando a RPC devolve erro', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
      await expect(getMyCompanies()).rejects.toBeTruthy();
    });

    it('devolve array vazio (não erro) quando data é null sem error', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });
      const result = await getMyCompanies();
      expect(result).toEqual([]);
    });
  });

  describe('pickPrimaryCompany', () => {
    it('devolve null para lista vazia', () => {
      expect(pickPrimaryCompany([])).toBeNull();
    });

    it('prioriza a linha role=owner mesmo quando não é a primeira', () => {
      const manager = row({ company_id: 'comp-manager', role: 'manager' });
      const owner = row({ company_id: 'comp-owner', role: 'owner' });
      expect(pickPrimaryCompany([manager, owner])?.company_id).toBe('comp-owner');
    });

    it('devolve a primeira quando não há role=owner (gerente puro)', () => {
      const manager = row({ company_id: 'comp-manager', role: 'manager' });
      expect(pickPrimaryCompany([manager])?.company_id).toBe('comp-manager');
    });
  });

  describe('pickCurrentCompany (R13 — seletor de unidade)', () => {
    it('sem seleção ativa, devolve a primária (owner)', () => {
      const manager = row({ company_id: 'comp-manager', role: 'manager' });
      const owner = row({ company_id: 'comp-owner', role: 'owner' });
      expect(pickCurrentCompany([manager, owner])?.company_id).toBe('comp-owner');
    });

    it('com seleção ativa válida, devolve a unidade selecionada mesmo que não seja a primária', () => {
      const manager = row({ company_id: 'comp-manager', role: 'manager' });
      const owner = row({ company_id: 'comp-owner', role: 'owner' });
      setSelectedCompanyId('comp-manager');
      expect(pickCurrentCompany([manager, owner])?.company_id).toBe('comp-manager');
    });

    it('seleção órfã (unidade não está mais na lista) cai para a primária', () => {
      const owner = row({ company_id: 'comp-owner', role: 'owner' });
      setSelectedCompanyId('comp-inexistente');
      expect(pickCurrentCompany([owner])?.company_id).toBe('comp-owner');
    });
  });

  describe('setSelectedCompanyId / getSelectedCompanyId', () => {
    it('persiste e lê a seleção', () => {
      setSelectedCompanyId('comp-x');
      expect(getSelectedCompanyId()).toBe('comp-x');
    });

    it('null limpa a seleção', () => {
      setSelectedCompanyId('comp-x');
      setSelectedCompanyId(null);
      expect(getSelectedCompanyId()).toBeNull();
    });
  });

  describe('getAuthenticatedCompanyId', () => {
    it('lança "Sessão expirada" quando não há usuário autenticado', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      await expect(getAuthenticatedCompanyId()).rejects.toThrow('Sessão expirada');
    });

    it('devolve o company_id da unidade corrente (caso dominante: 1 linha, role=owner)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
      mockRpc.mockResolvedValue({ data: [row({ company_id: 'comp-42' })], error: null });
      await expect(getAuthenticatedCompanyId()).resolves.toBe('comp-42');
    });

    it('lança "Perfil de empresa não encontrado" quando a sessão não opera nenhuma empresa', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
      mockRpc.mockResolvedValue({ data: [], error: null });
      await expect(getAuthenticatedCompanyId()).rejects.toThrow('Perfil de empresa não encontrado');
    });

    it('lança "Perfil de empresa não encontrado" (não o erro cru) quando a RPC falha', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
      mockRpc.mockResolvedValue({ data: null, error: { message: 'RPC indisponível' } });
      await expect(getAuthenticatedCompanyId()).rejects.toThrow('Perfil de empresa não encontrado');
    });
  });
});
