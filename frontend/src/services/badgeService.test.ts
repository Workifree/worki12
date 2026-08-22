import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadgeService } from './badgeService';
import type { CompanyBadge } from '../types';

// ---------------------------------------------------------------------------
// Mock supabase — rpc() (leitura + set) e from().update().eq() (chave-mestra).
// ---------------------------------------------------------------------------

interface UpdateSelectResult {
  data: Array<{ id: string }> | null;
  error: unknown;
}

// Cadeia real: from('workers').update({...}).eq('id', workerId).select('id')
// — o `.select('id')` é o que devolve a confirmação de linhas afetadas (C-RLS-SILENT-NOOP).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeUpdateChain(result: UpdateSelectResult): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.select = vi.fn(() => Promise.resolve(result));
  return chain;
}

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: (fn: string, params?: unknown) => mockRpc(fn, params),
  },
}));

vi.mock('../lib/logger', () => ({
  logError: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getCompanyBadges
// ---------------------------------------------------------------------------

describe('BadgeService.getCompanyBadges', () => {
  it('não toca o banco quando workerId está vazio', async () => {
    const result = await BadgeService.getCompanyBadges('');

    expect(result).toEqual({ badges: [], failed: false });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('devolve os badges na ordem em que a RPC os entrega (nunca reordena no client — DS5)', async () => {
    const badges: CompanyBadge[] = [
      {
        company_id: 'c1',
        company_name: 'Divino Fogão',
        company_logo_url: 'https://x/logo1.png',
        shifts_count: 3,
        last_shift_at: '2026-08-20T10:00:00.000Z',
        avg_rating: 4.5,
        reviews_count: 2,
        hidden: false,
      },
      {
        company_id: 'c2',
        company_name: 'Outback',
        company_logo_url: null,
        shifts_count: 1,
        last_shift_at: '2026-08-10T10:00:00.000Z',
        avg_rating: null,
        reviews_count: 0,
        hidden: false,
      },
    ];
    mockRpc.mockResolvedValueOnce({ data: badges, error: null });

    const result = await BadgeService.getCompanyBadges('worker-1');

    expect(mockRpc).toHaveBeenCalledWith('get_worker_company_badges', { p_worker_id: 'worker-1' });
    expect(result).toEqual({ badges, failed: false });
    // Ordem preservada — DS5: cronológica (last_shift_at DESC), nunca por nota.
    expect(result.badges[0].company_id).toBe('c1');
    expect(result.badges[1].company_id).toBe('c2');
  });

  it('avg_rating null é preservado como null (nunca vira 0 — ausência ≠ nota ruim)', async () => {
    const badge: CompanyBadge = {
      company_id: 'c1',
      company_name: 'Empresa sem review',
      company_logo_url: null,
      shifts_count: 1,
      last_shift_at: '2026-08-20T10:00:00.000Z',
      avg_rating: null,
      reviews_count: 0,
      hidden: false,
    };
    mockRpc.mockResolvedValueOnce({ data: [badge], error: null });

    const result = await BadgeService.getCompanyBadges('worker-1');

    expect(result.badges[0].avg_rating).toBeNull();
    expect(result.badges[0].avg_rating).not.toBe(0);
  });

  it('devolve { badges: [], failed: false } quando a RPC responde vazio (sem histórico OU sem acesso — nunca distingue, A3/DS10)', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const result = await BadgeService.getCompanyBadges('worker-sem-acesso');

    expect(result).toEqual({ badges: [], failed: false });
  });

  it('devolve { badges: [], failed: true } quando a RPC retorna erro genérico (nunca lança)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'RLS' } });

    const result = await BadgeService.getCompanyBadges('worker-1');

    expect(result).toEqual({ badges: [], failed: true });
  });

  it('devolve { badges: [], failed: true } quando a chamada lança exceção', async () => {
    mockRpc.mockImplementation(() => {
      throw new Error('network down');
    });

    const result = await BadgeService.getCompanyBadges('worker-1');

    expect(result).toEqual({ badges: [], failed: true });
  });

  it('degrada com failed=true (nunca "sem histórico") quando a RPC está ausente (PGRST202 — deploy adiantado)', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.get_worker_company_badges' },
    });

    const result = await BadgeService.getCompanyBadges('worker-1');

    expect(result).toEqual({ badges: [], failed: true });
  });
});

// ---------------------------------------------------------------------------
// setBadgeVisibility
// ---------------------------------------------------------------------------

describe('BadgeService.setBadgeVisibility', () => {
  it('não toca o banco quando companyId está vazio', async () => {
    const result = await BadgeService.setBadgeVisibility('', true);

    expect(result).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('chama a RPC com os parâmetros corretos e devolve true quando a RPC grava (elegível)', async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });

    const result = await BadgeService.setBadgeVisibility('c1', true);

    expect(mockRpc).toHaveBeenCalledWith('set_worker_badge_visibility', {
      p_company_id: 'c1',
      p_hidden: true,
    });
    expect(result).toBe(true);
  });

  // DS3 — a RPC recusa quando não há turno concluído com aquela empresa. O service NUNCA
  // interpreta isso como sucesso: a UI otimista precisa distinguir "gravado" de "ignorado".
  it('devolve false quando a RPC recusa por falta de elegibilidade (DS3 — sem turno concluído)', async () => {
    mockRpc.mockResolvedValueOnce({ data: false, error: null });

    const result = await BadgeService.setBadgeVisibility('company-sem-turno', true);

    expect(result).toBe(false);
  });

  it('devolve false (nunca lança) quando a RPC retorna erro', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    const result = await BadgeService.setBadgeVisibility('c1', true);

    expect(result).toBe(false);
  });

  it('devolve false quando a chamada lança exceção', async () => {
    mockRpc.mockImplementation(() => {
      throw new Error('network down');
    });

    const result = await BadgeService.setBadgeVisibility('c1', true);

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setBadgesHiddenGlobal
// ---------------------------------------------------------------------------

describe('BadgeService.setBadgesHiddenGlobal', () => {
  it('não toca o banco quando workerId está vazio', async () => {
    const result = await BadgeService.setBadgesHiddenGlobal('', true);

    expect(result).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('faz UPDATE direto em workers.badges_hidden e devolve true quando a linha é de fato afetada (Article 5 — sem RPC nova, DS2)', async () => {
    const chain = makeUpdateChain({ data: [{ id: 'worker-1' }], error: null });
    mockFrom.mockReturnValue(chain);

    const result = await BadgeService.setBadgesHiddenGlobal('worker-1', true);

    expect(mockFrom).toHaveBeenCalledWith('workers');
    expect(chain.update).toHaveBeenCalledWith({ badges_hidden: true });
    expect(chain.eq).toHaveBeenCalledWith('id', 'worker-1');
    expect(chain.select).toHaveBeenCalledWith('id');
    expect(result).toBe(true);
  });

  // C-RLS-SILENT-NOOP: sob RLS um UPDATE que não casa nenhuma linha devolve { data: [], error: null }
  // — sem `.select('id')` a função antiga devolvia `true` mesmo sem ter gravado nada, uma falsa
  // confirmação num controle de privacidade ("Seção ocultada" quando na verdade não ocultou).
  // Este teste falharia com a implementação anterior (que ignorava `data` e sempre devolvia true
  // quando `error` era null).
  it('devolve false quando o UPDATE não casa nenhuma linha (RLS negou em silêncio, sem erro)', async () => {
    mockFrom.mockReturnValue(makeUpdateChain({ data: [], error: null }));

    const result = await BadgeService.setBadgesHiddenGlobal('worker-1', true);

    expect(result).toBe(false);
  });

  it('devolve false (nunca lança) quando o UPDATE falha (ex.: RLS negando)', async () => {
    mockFrom.mockReturnValue(makeUpdateChain({ data: null, error: { message: 'RLS' } }));

    const result = await BadgeService.setBadgesHiddenGlobal('worker-1', true);

    expect(result).toBe(false);
  });

  it('devolve false quando a chamada lança exceção', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('network down');
    });

    const result = await BadgeService.setBadgesHiddenGlobal('worker-1', false);

    expect(result).toBe(false);
  });
});
