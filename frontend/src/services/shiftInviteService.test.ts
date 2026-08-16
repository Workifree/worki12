import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ShiftInviteService,
  normalizePhoneForWhatsApp,
  buildShiftInviteWhatsAppMessage,
  hasAttendedShift,
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
  chain.limit = vi.fn(() => chain);
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
// hasAttendedShift — predicado único de comparecimento (revisão pré-piloto, QA final)
// ---------------------------------------------------------------------------

describe('hasAttendedShift', () => {
  it('false quando nenhum dos três sinais está presente', () => {
    expect(
      hasAttendedShift({
        worker_checkin_at: null,
        company_checkin_confirmed_at: null,
        company_checkout_confirmed_at: null,
      }),
    ).toBe(false);
  });

  it('true quando só worker_checkin_at está preenchido', () => {
    expect(
      hasAttendedShift({
        worker_checkin_at: '2026-08-16T20:00:00.000Z',
        company_checkin_confirmed_at: null,
        company_checkout_confirmed_at: null,
      }),
    ).toBe(true);
  });

  it('true quando só company_checkin_confirmed_at está preenchido (empresa confirmou presença, freela não usou o app)', () => {
    expect(
      hasAttendedShift({
        worker_checkin_at: null,
        company_checkin_confirmed_at: '2026-08-16T20:05:00.000Z',
        company_checkout_confirmed_at: null,
      }),
    ).toBe(true);
  });

  it('true quando só company_checkout_confirmed_at está preenchido', () => {
    expect(
      hasAttendedShift({
        worker_checkin_at: null,
        company_checkin_confirmed_at: null,
        company_checkout_confirmed_at: '2026-08-16T23:00:00.000Z',
      }),
    ).toBe(true);
  });

  it('true quando os três sinais estão preenchidos', () => {
    expect(
      hasAttendedShift({
        worker_checkin_at: '2026-08-16T20:00:00.000Z',
        company_checkin_confirmed_at: '2026-08-16T20:05:00.000Z',
        company_checkout_confirmed_at: '2026-08-16T23:00:00.000Z',
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ShiftInviteService.cancelInvite
// ---------------------------------------------------------------------------

describe('ShiftInviteService.cancelInvite', () => {
  it('cancela um convite invited sem resposta (invited -> cancelled)', async () => {
    const fetchChain = makeChain({ data: { id: 'app-1', status: 'invited' }, error: null });
    // .select('id') no fim da cadeia de update — retorna a linha afetada (sucesso real).
    const updateChain = makeChain({ data: [{ id: 'app-1' }], error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table !== 'applications') throw new Error(`tabela inesperada: ${table}`);
      return {
        select: fetchChain.select,
        update: updateChain.update,
      };
    });
    // select().eq().maybeSingle() usa fetchChain; update().eq().eq().select() usa updateChain.
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

  it('reporta falha (não sucesso mentiroso) quando o UPDATE afeta 0 linhas (RLS negou em silêncio)', async () => {
    const fetchChain = makeChain({ data: { id: 'app-1', status: 'invited' }, error: null });
    // PostgREST 204 sem erro, mas 0 linhas casaram o USING — igual ao caso de removeFromTeam.
    const updateChain = makeChain({ data: [], error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table !== 'applications') throw new Error(`tabela inesperada: ${table}`);
      return { select: fetchChain.select, update: updateChain.update };
    });
    fetchChain.select.mockReturnValue(fetchChain);
    updateChain.update.mockReturnValue(updateChain);

    const result = await ShiftInviteService.cancelInvite('app-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Não foi possível cancelar/);
  });
});

// ---------------------------------------------------------------------------
// ShiftInviteService.dismissFromShift
// ---------------------------------------------------------------------------

describe('ShiftInviteService.dismissFromShift', () => {
  it('dispensa um freela hired sem pagamento ativo e sem sinal de comparecimento (hired -> cancelled)', async () => {
    const fetchChain = makeChain({
      data: {
        id: 'app-1',
        status: 'hired',
        job_id: 'job-1',
        worker_id: 'worker-1',
        worker_checkin_at: null,
        company_checkout_confirmed_at: null,
      },
      error: null,
    });
    const paymentChain = makeChain({ data: [], error: null }); // sem pagamento ativo (array vazio, .limit(1))
    // .select('id') no fim da cadeia de update — retorna a linha afetada.
    const updateChain = makeChain({ data: [{ id: 'app-1' }], error: null });

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
    // Guarda de pagamento filtra por (job_id, worker_id) — não só job_id (ADR-20260816).
    expect(paymentChain.eq).toHaveBeenCalledWith('worker_id', 'worker-1');
  });

  it('dispensa um freela in_progress sem pagamento ativo e sem sinal de comparecimento', async () => {
    const fetchChain = makeChain({
      data: {
        id: 'app-2',
        status: 'in_progress',
        job_id: 'job-2',
        worker_id: 'worker-2',
        worker_checkin_at: null,
        company_checkout_confirmed_at: null,
      },
      error: null,
    });
    const paymentChain = makeChain({ data: [], error: null });
    const updateChain = makeChain({ data: [{ id: 'app-2' }], error: null });

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

  it('bloqueia o dispensar quando já existe pagamento agendado/registrado para ESTE freela neste job', async () => {
    const fetchChain = makeChain({
      data: {
        id: 'app-1',
        status: 'hired',
        job_id: 'job-1',
        worker_id: 'worker-1',
        worker_checkin_at: null,
        company_checkout_confirmed_at: null,
      },
      error: null,
    });
    const paymentChain = makeChain({
      data: [{ id: 'payment-1', status: 'recorded' }],
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

  // -------------------------------------------------------------------------
  // Caso central do ADR-20260816: turno com DOIS freelas. O pagamento ativo de
  // um NÃO pode travar o dispensar do outro — a guarda filtra por (job_id, worker_id),
  // não por job_id sozinho. Continua válido depois da migration
  // 20260816220000 (hoje o banco só permite 1 marcador ativo por job; o teste usa mock).
  // -------------------------------------------------------------------------
  it('NÃO bloqueia o dispensar do freela B quando o pagamento ativo é do freela A (mesmo job)', async () => {
    const fetchChain = makeChain({
      data: {
        id: 'app-b',
        status: 'hired',
        job_id: 'job-1',
        worker_id: 'worker-B',
        worker_checkin_at: null,
        company_checkout_confirmed_at: null,
      },
      error: null,
    });
    // A guarda consulta shift_payments filtrando por (job_id, worker_id=worker-B) — o
    // pagamento existente é do worker-A, então a query (que a RLS/filtro real restringiria)
    // não deve "achar" nada para worker-B. O mock simula esse resultado já filtrado: vazio.
    const paymentChain = makeChain({ data: [], error: null });
    const updateChain = makeChain({ data: [{ id: 'app-b' }], error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'applications') {
        return { select: fetchChain.select, update: updateChain.update };
      }
      if (table === 'shift_payments') {
        return { select: paymentChain.select };
      }
      throw new Error(`tabela inesperada: ${table}`);
    });

    const result = await ShiftInviteService.dismissFromShift('app-b');

    expect(result.success).toBe(true);
    expect(paymentChain.eq).toHaveBeenCalledWith('worker_id', 'worker-B');
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

  // -------------------------------------------------------------------------
  // Regressão (revisão pré-piloto, QA #2): dispensar depois que o freela já
  // trabalhou tornava o turno impagável e irreversível (UNIQUE(job_id, worker_id)
  // impede reconvidar o mesmo freela). Comportamental: dado que o freela já
  // compareceu (por qualquer um dos dois sinais), dispensar deve ser recusado
  // ANTES de tocar em `applications` — não apenas "escondido na UI".
  // -------------------------------------------------------------------------

  it('bloqueia o dispensar quando o freela já fez check-in (worker_checkin_at preenchido)', async () => {
    const fetchChain = makeChain({
      data: {
        id: 'app-1',
        status: 'in_progress',
        job_id: 'job-1',
        worker_checkin_at: '2026-08-16T20:00:00.000Z',
        company_checkout_confirmed_at: null,
      },
      error: null,
    });
    const updateChain = makeChain({ data: [{ id: 'app-1' }], error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'applications') {
        return { select: fetchChain.select, update: updateChain.update };
      }
      throw new Error(`tabela inesperada (não deveria consultar shift_payments): ${table}`);
    });

    const result = await ShiftInviteService.dismissFromShift('app-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/turno já foi cumprido/);
    // Nunca chega a tentar o UPDATE — a application permanece intacta (reversível).
    expect(updateChain.update).not.toHaveBeenCalled();
  });

  it('bloqueia o dispensar quando a empresa já confirmou a saída (fallback sem worker_checkout_at)', async () => {
    const fetchChain = makeChain({
      data: {
        id: 'app-1',
        status: 'in_progress',
        job_id: 'job-1',
        worker_checkin_at: null,
        company_checkin_confirmed_at: null,
        company_checkout_confirmed_at: '2026-08-16T23:00:00.000Z',
      },
      error: null,
    });
    const updateChain = makeChain({ data: [{ id: 'app-1' }], error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'applications') {
        return { select: fetchChain.select, update: updateChain.update };
      }
      throw new Error(`tabela inesperada (não deveria consultar shift_payments): ${table}`);
    });

    const result = await ShiftInviteService.dismissFromShift('app-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/turno já foi cumprido/);
    expect(updateChain.update).not.toHaveBeenCalled();
  });

  // Regressão (QA final, rodada seguinte): a guarda anterior só olhava worker_checkin_at
  // e company_checkout_confirmed_at — deixava "Dispensar" disponível depois de
  // "Confirmar Presença" (company_checkin_confirmed_at) sem o freela ter batido check-in no
  // app, que é o caminho CANÔNICO do modo A (freela que não usa o app).
  it('bloqueia o dispensar quando só a empresa confirmou a CHEGADA (company_checkin_confirmed_at, sem checkin do freela)', async () => {
    const fetchChain = makeChain({
      data: {
        id: 'app-1',
        status: 'in_progress',
        job_id: 'job-1',
        worker_checkin_at: null,
        company_checkin_confirmed_at: '2026-08-16T20:05:00.000Z',
        company_checkout_confirmed_at: null,
      },
      error: null,
    });
    const updateChain = makeChain({ data: [{ id: 'app-1' }], error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'applications') {
        return { select: fetchChain.select, update: updateChain.update };
      }
      throw new Error(`tabela inesperada (não deveria consultar shift_payments): ${table}`);
    });

    const result = await ShiftInviteService.dismissFromShift('app-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/turno já foi cumprido/);
    expect(updateChain.update).not.toHaveBeenCalled();
  });

  it('reporta falha (não sucesso mentiroso) quando o UPDATE afeta 0 linhas (RLS negou em silêncio)', async () => {
    const fetchChain = makeChain({
      data: {
        id: 'app-1',
        status: 'hired',
        job_id: 'job-1',
        worker_id: 'worker-1',
        worker_checkin_at: null,
        company_checkout_confirmed_at: null,
      },
      error: null,
    });
    const paymentChain = makeChain({ data: [], error: null });
    const updateChain = makeChain({ data: [], error: null });

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

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Não foi possível dispensar/);
  });
});
