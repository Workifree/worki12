import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ShiftInviteService,
  normalizePhoneForWhatsApp,
  buildShiftInviteWhatsAppMessage,
} from './shiftInviteService';

// ---------------------------------------------------------------------------
// Mock supabase — cadeia thenable (mimetiza o PostgrestFilterBuilder real, que é
// "awaitable" sem precisar de .then() explícito no fim da cadeia).
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
  chain.in = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.single = vi.fn(() => Promise.resolve(result));
  // Torna a própria cadeia "awaitable" — replica supabase-js (o builder é thenable).
  chain.then = (
    onFulfilled?: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (table: string) => mockFrom(table),
  },
}));

// Não é exercitado nestes testes (nenhum caminho chama invokeFunction), mas o service
// importa `./api` no topo do arquivo — mock vazio evita puxar o client real.
vi.mock('./api', () => ({
  invokeFunction: vi.fn(),
}));

vi.mock('./teamConnectionService', () => ({
  TeamConnectionService: { isWorkerInTeam: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'company-owner-1' } }, error: null });
});

// ---------------------------------------------------------------------------
// normalizePhoneForWhatsApp
// ---------------------------------------------------------------------------

describe('normalizePhoneForWhatsApp', () => {
  it('prefixa 55 num celular mascarado sem DDI (11 dígitos)', () => {
    expect(normalizePhoneForWhatsApp('(11) 99999-9999')).toBe('5511999999999');
  });

  it('prefixa 55 num fixo mascarado sem DDI (10 dígitos)', () => {
    expect(normalizePhoneForWhatsApp('(11) 9999-9999')).toBe('551199999999');
  });

  it('mantém como está quando já vem com DDI 55 (13 dígitos)', () => {
    expect(normalizePhoneForWhatsApp('+55 11 99999-9999')).toBe('5511999999999');
  });

  it('mantém como está quando já vem com DDI 55 (12 dígitos, fixo)', () => {
    expect(normalizePhoneForWhatsApp('55 11 9999-9999')).toBe('551199999999');
  });

  it('não confunde DDD 55 (Rio Grande do Sul) sem DDI com DDI+DDD 55: 11 dígitos vira 55+original', () => {
    // DDD 55 é válido no Brasil (RS) — um número local de 11 dígitos começando com "55"
    // (DDD 55 + celular de 9 dígitos) deve virar 13 dígitos com DDI prefixado, não ser
    // tratado como se já tivesse DDI (que exigiria 12/13 dígitos, não 11).
    expect(normalizePhoneForWhatsApp('55999998888')).toBe('5555999998888');
  });

  it('retorna null para telefone vazio', () => {
    expect(normalizePhoneForWhatsApp('')).toBeNull();
  });

  it('retorna null para telefone null/undefined', () => {
    expect(normalizePhoneForWhatsApp(null)).toBeNull();
    expect(normalizePhoneForWhatsApp(undefined)).toBeNull();
  });

  it('retorna null para formato irreconhecível (poucos dígitos)', () => {
    expect(normalizePhoneForWhatsApp('123')).toBeNull();
  });

  it('nunca gera um resultado vazio/undefined-like para entradas só com símbolos', () => {
    expect(normalizePhoneForWhatsApp('()-')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildShiftInviteWhatsAppMessage
// ---------------------------------------------------------------------------

describe('buildShiftInviteWhatsAppMessage', () => {
  it('monta mensagem com todos os campos preenchidos', () => {
    const msg = buildShiftInviteWhatsAppMessage({
      companyName: 'Restaurante Sabor',
      jobTitle: 'Garçom para evento',
      dateLabel: '20/08/2026',
      timeLabel: '08:00 às 17:00',
      location: 'Av. Paulista, 1000',
      amount: 150,
      appUrl: 'https://worki-opal.vercel.app/my-jobs',
    });

    expect(msg).toContain('Restaurante Sabor');
    expect(msg).toContain('Garçom para evento');
    expect(msg).toContain('20/08/2026');
    expect(msg).toContain('08:00 às 17:00');
    expect(msg).toContain('Av. Paulista, 1000');
    expect(msg).toContain('R$ 150,00');
    expect(msg).toContain('https://worki-opal.vercel.app/my-jobs');
  });

  it('omite linhas de local/valor quando ausentes, sem gerar texto quebrado', () => {
    const msg = buildShiftInviteWhatsAppMessage({
      companyName: '',
      jobTitle: 'Estoquista',
      appUrl: 'https://worki-opal.vercel.app/my-jobs',
    });

    expect(msg).toContain('a empresa'); // fallback quando companyName vazio
    expect(msg).toContain('Estoquista');
    expect(msg).not.toContain('Local:');
    expect(msg).not.toContain('Valor:');
    expect(msg).toContain('https://worki-opal.vercel.app/my-jobs');
  });

  it('não inclui "Valor:" quando amount é zero ou negativo', () => {
    const msg = buildShiftInviteWhatsAppMessage({
      companyName: 'Empresa X',
      jobTitle: 'Turno',
      amount: 0,
      appUrl: 'https://app/my-jobs',
    });
    expect(msg).not.toContain('Valor:');
  });
});

// ---------------------------------------------------------------------------
// ShiftInviteService.cancelInvite
// ---------------------------------------------------------------------------

describe('ShiftInviteService.cancelInvite', () => {
  it('cancela um convite invited sem resposta (invited -> cancelled)', async () => {
    const fetchChain = makeChain({ data: { id: 'app-1', status: 'invited' }, error: null });
    const updateChain = makeChain({ data: null, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table !== 'applications') throw new Error(`tabela inesperada: ${table}`);
      return {
        select: fetchChain.select,
        update: updateChain.update,
      };
    });
    // select().eq().maybeSingle() usa fetchChain; update().eq().eq() usa updateChain.
    fetchChain.select.mockReturnValue(fetchChain);
    updateChain.update.mockReturnValue(updateChain);

    const result = await ShiftInviteService.cancelInvite('app-1');

    expect(result.success).toBe(true);
    expect(updateChain.update).toHaveBeenCalledWith({ status: 'cancelled' });
  });

  it('rejeita transição quando o status atual não é invited', async () => {
    const fetchChain = makeChain({ data: { id: 'app-1', status: 'hired' }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'applications') throw new Error(`tabela inesperada: ${table}`);
      return { select: fetchChain.select };
    });

    const result = await ShiftInviteService.cancelInvite('app-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Transição inválida/);
  });

  it('retorna erro quando o convite não existe', async () => {
    const fetchChain = makeChain({ data: null, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'applications') throw new Error(`tabela inesperada: ${table}`);
      return { select: fetchChain.select };
    });

    const result = await ShiftInviteService.cancelInvite('app-inexistente');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/não encontrado/);
  });
});

// ---------------------------------------------------------------------------
// ShiftInviteService.dismissFromShift
// ---------------------------------------------------------------------------

describe('ShiftInviteService.dismissFromShift', () => {
  it('dispensa um freela hired sem pagamento ativo (hired -> cancelled)', async () => {
    const fetchChain = makeChain({
      data: { id: 'app-1', status: 'hired', job_id: 'job-1' },
      error: null,
    });
    const paymentChain = makeChain({ data: null, error: null }); // sem pagamento ativo
    const updateChain = makeChain({ data: null, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'applications') {
        return { select: fetchChain.select, update: updateChain.update };
      }
      if (table === 'shift_payments') {
        return { select: paymentChain.select };
      }
      throw new Error(`tabela inesperada: ${table}`);
    });

    const result = await ShiftInviteService.dismissFromShift('app-1');

    expect(result.success).toBe(true);
    expect(updateChain.update).toHaveBeenCalledWith({ status: 'cancelled' });
  });

  it('dispensa um freela in_progress sem pagamento ativo', async () => {
    const fetchChain = makeChain({
      data: { id: 'app-2', status: 'in_progress', job_id: 'job-2' },
      error: null,
    });
    const paymentChain = makeChain({ data: null, error: null });
    const updateChain = makeChain({ data: null, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'applications') {
        return { select: fetchChain.select, update: updateChain.update };
      }
      if (table === 'shift_payments') {
        return { select: paymentChain.select };
      }
      throw new Error(`tabela inesperada: ${table}`);
    });

    const result = await ShiftInviteService.dismissFromShift('app-2');

    expect(result.success).toBe(true);
  });

  it('bloqueia o dispensar quando já existe pagamento agendado/registrado para o job', async () => {
    const fetchChain = makeChain({
      data: { id: 'app-1', status: 'hired', job_id: 'job-1' },
      error: null,
    });
    const paymentChain = makeChain({
      data: { id: 'payment-1', status: 'recorded' },
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'applications') {
        return { select: fetchChain.select };
      }
      if (table === 'shift_payments') {
        return { select: paymentChain.select };
      }
      throw new Error(`tabela inesperada: ${table}`);
    });

    const result = await ShiftInviteService.dismissFromShift('app-1');

    expect(result.success).toBe(false);
    expect(result.blockedByPayment).toBe(true);
    expect(result.error).toMatch(/Estorne o pagamento/);
  });

  it('rejeita transição quando o status atual não é hired nem in_progress', async () => {
    const fetchChain = makeChain({
      data: { id: 'app-1', status: 'completed', job_id: 'job-1' },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'applications') throw new Error(`tabela inesperada: ${table}`);
      return { select: fetchChain.select };
    });

    const result = await ShiftInviteService.dismissFromShift('app-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Transição inválida/);
  });
});
