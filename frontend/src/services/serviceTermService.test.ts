import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceTermService, OUTCOME_ERRORS } from './serviceTermService';
import type { ServiceTermAcceptOutcome } from '../types';

// ---------------------------------------------------------------------------
// Mock supabase — mesma cadeia thenable de attendanceConfirmationService.test.ts.
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
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (
    onFulfilled?: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: (fn: string, params: unknown) => mockRpc(fn, params),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getByShiftPayment
// ---------------------------------------------------------------------------

describe('ServiceTermService.getByShiftPayment', () => {
  it('devolve { term: null, failed: false } sem tocar o banco quando shiftPaymentId está vazio', async () => {
    const result = await ServiceTermService.getByShiftPayment('');

    expect(result).toEqual({ term: null, failed: false });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('devolve o termo (rascunho ou aceito) quando encontrado', async () => {
    const term = {
      id: 'term-1',
      shift_payment_id: 'sp-1',
      job_id: 'job-1',
      worker_id: 'w1',
      company_id: 'c1',
      term_version: 'modelo-worki-v1',
      term_text: 'texto rascunho',
      amount: 180,
      created_at: '2026-08-18T00:00:00.000Z',
      accepted_at: null,
      accepted_ip: null,
      accepted_user_agent: null,
      anonymized_at: null,
    };
    mockFrom.mockReturnValue(makeChain({ data: term, error: null }));

    const result = await ServiceTermService.getByShiftPayment('sp-1');

    expect(mockFrom).toHaveBeenCalledWith('service_terms');
    expect(result).toEqual({ term, failed: false });
  });

  it('devolve { term: null, failed: false } quando não há termo para o pagamento (A8 — scheduled, ou RLS nega sem erro)', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }));

    const result = await ServiceTermService.getByShiftPayment('sp-1');

    expect(result).toEqual({ term: null, failed: false });
  });

  // C-TERM-FETCH-FAIL (achado ALTO, terceira iteração): falha de leitura (rede/RLS/erro)
  // é DISTINGUÍVEL de "sem termo" — ambas não podem colapsar no mesmo `null` que o
  // componente antes interpretava como "nada a exibir, confirmação liberada".
  it('devolve { term: null, failed: true } (não lança) quando a query falha', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: 'RLS' } }));

    const result = await ServiceTermService.getByShiftPayment('sp-1');

    expect(result).toEqual({ term: null, failed: true });
  });

  it('devolve { term: null, failed: true } quando a chamada lança exceção', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('network down');
    });

    const result = await ServiceTermService.getByShiftPayment('sp-1');

    expect(result).toEqual({ term: null, failed: true });
  });
});

// ---------------------------------------------------------------------------
// acceptServiceTerm
// ---------------------------------------------------------------------------

describe('ServiceTermService.acceptServiceTerm', () => {
  it('não toca o banco quando serviceTermId está vazio', async () => {
    const result = await ServiceTermService.acceptServiceTerm('');

    expect(result.outcome).toBe('not_found');
    expect(result.error).toBe('Termo não informado.');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('outcome=accepted repassa acceptedAt sem erro', async () => {
    const acceptedAt = '2026-08-18T12:00:00.000Z';
    mockRpc.mockResolvedValue({ data: { outcome: 'accepted', accepted_at: acceptedAt }, error: null });

    const result = await ServiceTermService.acceptServiceTerm('term-1');

    expect(mockRpc).toHaveBeenCalledWith('accept_service_term', { p_service_term_id: 'term-1' });
    expect(result.outcome).toBe('accepted');
    expect(result.acceptedAt).toBe(acceptedAt);
    expect(result.error).toBeUndefined();
  });

  // A7 — idempotência: chamar de novo para o mesmo termo já aceito não é erro, e o
  // acceptedAt permanece o da primeira vez (a RPC garante isso; o service só repassa).
  it('outcome=already_accepted é tratado como sucesso idempotente (A7), não como erro', async () => {
    const firstAcceptedAt = '2026-08-18T12:00:00.000Z';
    mockRpc.mockResolvedValue({
      data: { outcome: 'already_accepted', accepted_at: firstAcceptedAt },
      error: null,
    });

    const result = await ServiceTermService.acceptServiceTerm('term-1');

    expect(result.outcome).toBe('already_accepted');
    expect(result.acceptedAt).toBe(firstAcceptedAt);
    expect(result.error).toBeUndefined();
  });

  // Caso central do ADR-20260818: CPF ausente bloqueia o aceite com mensagem específica
  // (não genérica) — é o outcome que motivou o congelamento no aceite, não na geração.
  // A3 voltou à forma original em 25/08/2026 (débito #8, que dependia do #3): enquanto `/profile`
  // não tinha campo de CPF, apontar para lá mandava a pessoa a um beco sem saída. O campo existe
  // agora, então a mensagem volta a indicar o caminho que o próprio freela percorre.
  it('outcome=missing_cpf aponta o freela para o Perfil, onde ele resolve sozinho', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'missing_cpf' }, error: null });

    const result = await ServiceTermService.acceptServiceTerm('term-1');

    expect(result.outcome).toBe('missing_cpf');
    expect(result.error).toBe(OUTCOME_ERRORS.missing_cpf);
    expect(result.error).toMatch(/CPF/);
    expect(result.error).toMatch(/Perfil/);
    // e nao manda mais para o suporte, que era o caminho humano do beco sem saida
    expect(result.error).not.toMatch(/suporte/i);
  });

  it('erro de rede/RPC vira outcome not_found com mensagem fixa (nunca erro cru)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'connection refused' } });

    const result = await ServiceTermService.acceptServiceTerm('term-1');

    expect(result.outcome).toBe('not_found');
    expect(result.error).toBe('Não foi possível registrar o aceite do termo.');
    expect(result.error).not.toMatch(/connection refused/);
  });

  // Degradação elegante (PGRST202) — migration ainda não aplicada no ambiente. Nunca deve
  // ser tratado como "aceito": reporta indisponibilidade, sem log ruidoso.
  it('degrada com mensagem própria quando a RPC está ausente (PGRST202)', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.accept_service_term' },
    });

    const result = await ServiceTermService.acceptServiceTerm('term-1');

    expect(result.outcome).toBe('not_found');
    expect(result.error).toBe('Recurso indisponível no momento. Tente novamente em instantes.');
  });

  // Componente (N2 — achado do evaluator, reprovação F6 20/08/2026): outcome=payment_voided é
  // o caminho de estado mais provável em produção depois de missing_cpf (empresa estorna o
  // pagamento, freela tenta aceitar o termo do mesmo id). Literal ancorado — não referencia
  // OUTCOME_ERRORS, para não morrer junto se o mapa for alterado por descuido (N1).
  it('outcome=payment_voided (pagamento estornado após a geração do termo) traduz para mensagem literal de estorno', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'payment_voided' }, error: null });

    const result = await ServiceTermService.acceptServiceTerm('term-1');

    expect(result.outcome).toBe('payment_voided');
    expect(result.error).toBe('Este pagamento foi estornado — o termo não pode mais ser aceito.');
  });

  // Componente: outcome=forbidden (freela tentando aceitar termo de outro worker_id). Literal
  // ancorado pelo mesmo motivo de payment_voided acima — N1.
  it('outcome=forbidden traduz para mensagem literal de permissão negada', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'forbidden' }, error: null });

    const result = await ServiceTermService.acceptServiceTerm('term-1');

    expect(result.outcome).toBe('forbidden');
    expect(result.error).toBe('Você não tem permissão para aceitar este termo.');
  });

  // Tradução de outcome: todo outcome de recusa (exceto already_accepted, tratado à parte)
  // vira uma mensagem NÃO-genérica, comparada com o valor EXATO do mapa exportado — não
  // `toBeTruthy()` (achado do evaluator em attendanceConfirmationService, 18/08/2026).
  const REJECTION_OUTCOMES: ServiceTermAcceptOutcome[] = [
    'unauthenticated',
    'not_found',
    'forbidden',
    'payment_voided',
    'missing_cpf',
  ];

  it.each(REJECTION_OUTCOMES)('traduz outcome=%s na mensagem EXATA do mapa OUTCOME_ERRORS', async (outcome) => {
    mockRpc.mockResolvedValue({ data: { outcome }, error: null });

    const result = await ServiceTermService.acceptServiceTerm('term-1');

    expect(result.outcome).toBe(outcome);
    expect(result.error).toBe(OUTCOME_ERRORS[outcome]);
  });

  // N1 (achado do evaluator, reprovação F6 20/08/2026): o it.each acima é AUTO-REFERENCIAL —
  // compara result.error com OUTCOME_ERRORS[outcome], a MESMA fonte que o código usa. Isso mata
  // a mutação "traduzir tudo para um genérico fixo", mas NÃO mata "trocar o texto de uma entrada
  // do mapa" (os dois lados mudam juntos) nem "colar duas mensagens no mesmo texto por
  // descuido". Este teste ancora as 5 mensagens em literais e exige que sejam todas distintas —
  // trocar qualquer uma delas (inclusive para o texto de outra) quebra aqui.
  it('N1: as 5 mensagens de OUTCOME_ERRORS são literais fixas e mutuamente distintas', () => {
    expect(OUTCOME_ERRORS.unauthenticated).toBe('Sessão expirada. Faça login novamente.');
    expect(OUTCOME_ERRORS.not_found).toBe('Termo não encontrado.');
    expect(OUTCOME_ERRORS.forbidden).toBe('Você não tem permissão para aceitar este termo.');
    expect(OUTCOME_ERRORS.payment_voided).toBe(
      'Este pagamento foi estornado — o termo não pode mais ser aceito.',
    );
    expect(OUTCOME_ERRORS.missing_cpf).toBe(
      'Seu cadastro está sem um CPF válido. Cadastre o seu em Perfil para poder assinar o termo.',
    );

    const messages = [
      OUTCOME_ERRORS.unauthenticated,
      OUTCOME_ERRORS.not_found,
      OUTCOME_ERRORS.forbidden,
      OUTCOME_ERRORS.payment_voided,
      OUTCOME_ERRORS.missing_cpf,
    ];
    expect(new Set(messages).size).toBe(messages.length);
  });
});
