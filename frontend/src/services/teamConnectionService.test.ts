import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamConnectionService } from './teamConnectionService';

const mockDeleteEq2 = vi.fn().mockResolvedValue({ error: null });
const mockDeleteEq1 = vi.fn(() => ({ eq: mockDeleteEq2 }));
const mockDelete = vi.fn(() => ({ eq: mockDeleteEq1 }));

const mockMaybeSingle = vi.fn();
const mockSelect = vi.fn(() => ({
  eq: vi.fn(() => ({
    maybeSingle: mockMaybeSingle,
  })),
}));

const mockFrom = vi.fn((table: string) => {
  if (table === 'companies') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'comp-12345678-1234-1234-1234-123456789012' }, error: null }),
        })),
      })),
    };
  }
  if (table === 'team_connections') {
    return {
      delete: mockDelete,
      select: mockSelect,
    };
  }
  return {
    select: mockSelect,
  };
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'owner-123' } },
        error: null,
      }),
    },
    from: (table: string) => mockFrom(table),
  },
}));

describe('TeamConnectionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('removeFromTeam', () => {
    it('remove conexão do freela da equipe com sucesso', async () => {
      mockDeleteEq2.mockResolvedValueOnce({ error: null });

      const result = await TeamConnectionService.removeFromTeam('worker-abc-123');

      expect(result.success).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('retorna erro quando a deleção no supabase falha', async () => {
      mockDeleteEq2.mockResolvedValueOnce({ error: { message: 'DB error' } });

      const result = await TeamConnectionService.removeFromTeam('worker-abc-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Erro ao remover freela do elenco.');
    });
  });

  describe('token helpers', () => {
    it('gera e valida worker invite token com prefixo w_', () => {
      const workerId = 'worker-12345678-1234-1234-1234-123456789012';
      const tokenObj = TeamConnectionService.generateWorkerInviteToken(workerId);

      expect(tokenObj.token.startsWith('w_')).toBe(true);
      expect(TeamConnectionService.isWorkerInviteToken(tokenObj.token)).toBe(true);

      const resolvedId = TeamConnectionService.resolveWorkerInviteToken(tokenObj.token);
      expect(resolvedId).toBe(workerId);
    });
  });
});
