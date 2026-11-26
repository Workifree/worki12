import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMyAccessState } from './accessStateService';

const mockRpc = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));
vi.mock('../lib/logger', () => ({ logError: vi.fn() }));

describe('getMyAccessState', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('chama a RPC sem parâmetro e mapeia a resposta', async () => {
    mockRpc.mockResolvedValue({
      data: { removed: true, has_active: false, owns_company: false },
      error: null,
    });
    await expect(getMyAccessState()).resolves.toEqual({
      removed: true,
      hasActive: false,
      ownsCompany: false,
    });
    expect(mockRpc).toHaveBeenCalledWith('my_access_state');
  });

  it('devolve null quando a RPC não existe', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } });
    await expect(getMyAccessState()).resolves.toBeNull();
  });

  it('devolve null quando a chamada rejeita', async () => {
    mockRpc.mockRejectedValue(new Error('rede'));
    await expect(getMyAccessState()).resolves.toBeNull();
  });

  it.each([null, {}, { removed: true, has_active: 'false', owns_company: false }])(
    'devolve null em formato inesperado: %j',
    async (data) => {
      mockRpc.mockResolvedValue({ data, error: null });
      await expect(getMyAccessState()).resolves.toBeNull();
    },
  );
});
