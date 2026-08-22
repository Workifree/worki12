import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inviteManager, acceptManagerInvite, revokeManager, listCompanyManagers } from './organizationService';

const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

vi.mock('../lib/logger', () => ({ logError: vi.fn() }));

describe('organizationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('inviteManager (R8)', () => {
    it('devolve outcome=invited + token em sucesso', async () => {
      mockRpc.mockResolvedValue({
        data: { outcome: 'invited', member_id: 'm1', invite_token: 'tok-1' },
        error: null,
      });

      const result = await inviteManager('comp-1', 'gerente@ex.com');

      expect(mockRpc).toHaveBeenCalledWith('invite_company_manager', {
        p_company_id: 'comp-1',
        p_email: 'gerente@ex.com',
      });
      expect(result).toEqual({ outcome: 'invited', memberId: 'm1', inviteToken: 'tok-1' });
    });

    it('devolve outcome=forbidden quando quem chama não é sócio/operador', async () => {
      mockRpc.mockResolvedValue({ data: { outcome: 'forbidden' }, error: null });
      const result = await inviteManager('comp-1', 'x@ex.com');
      expect(result.outcome).toBe('forbidden');
    });

    it('nunca lança — erro de rede vira outcome=error', async () => {
      mockRpc.mockRejectedValue(new Error('network down'));
      const result = await inviteManager('comp-1', 'x@ex.com');
      expect(result.outcome).toBe('error');
      expect(result.error).toBeTruthy();
    });
  });

  describe('acceptManagerInvite (R9)', () => {
    it('devolve outcome=accepted + company_id em sucesso', async () => {
      mockRpc.mockResolvedValue({
        data: { outcome: 'accepted', company_id: 'comp-9', member_id: 'm1' },
        error: null,
      });
      const result = await acceptManagerInvite('tok-1');
      expect(mockRpc).toHaveBeenCalledWith('accept_manager_invite', { p_token: 'tok-1' });
      expect(result).toEqual({ outcome: 'accepted', companyId: 'comp-9', memberId: 'm1' });
    });

    it('NUNCA aceita silenciosamente token já usado por outro usuário (token_already_used)', async () => {
      mockRpc.mockResolvedValue({ data: { outcome: 'token_already_used' }, error: null });
      const result = await acceptManagerInvite('tok-usado');
      expect(result.outcome).toBe('token_already_used');
    });

    it('convite vencido devolve outcome=expired, nunca ativa em silêncio', async () => {
      mockRpc.mockResolvedValue({ data: { outcome: 'expired' }, error: null });
      const result = await acceptManagerInvite('tok-velho');
      expect(result.outcome).toBe('expired');
    });
  });

  describe('revokeManager (R10 — soft delete)', () => {
    it('devolve outcome=revoked em sucesso', async () => {
      mockRpc.mockResolvedValue({ data: { outcome: 'revoked', affected: 1 }, error: null });
      const result = await revokeManager('comp-1', 'user-1');
      expect(mockRpc).toHaveBeenCalledWith('revoke_company_manager', {
        p_company_id: 'comp-1',
        p_user_id: 'user-1',
      });
      expect(result.outcome).toBe('revoked');
    });
  });

  describe('listCompanyManagers', () => {
    it('consulta company_members filtrando por company_id e excluindo removed', async () => {
      const mockOrder = vi.fn().mockResolvedValue({
        data: [{ id: 'm1', company_id: 'comp-1', user_id: null, role: 'manager', status: 'invited' }],
        error: null,
      });
      const mockNeq = vi.fn(() => ({ order: mockOrder }));
      const mockEq = vi.fn(() => ({ neq: mockNeq }));
      const mockSelect = vi.fn(() => ({ eq: mockEq }));
      mockFrom.mockReturnValue({ select: mockSelect });

      const result = await listCompanyManagers('comp-1');

      expect(mockFrom).toHaveBeenCalledWith('company_members');
      expect(mockEq).toHaveBeenCalledWith('company_id', 'comp-1');
      expect(mockNeq).toHaveBeenCalledWith('status', 'removed');
      expect(result).toHaveLength(1);
    });

    it('devolve lista vazia (sem lançar) quando a query falha', async () => {
      const mockOrder = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
      const mockNeq = vi.fn(() => ({ order: mockOrder }));
      const mockEq = vi.fn(() => ({ neq: mockNeq }));
      const mockSelect = vi.fn(() => ({ eq: mockEq }));
      mockFrom.mockReturnValue({ select: mockSelect });

      const result = await listCompanyManagers('comp-1');
      expect(result).toEqual([]);
    });
  });
});
