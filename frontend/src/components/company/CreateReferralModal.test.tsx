import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import CreateReferralModal from './CreateReferralModal';
import type { TeamMember } from '../../types';

// ---------------------------------------------------------------------------
// F10 (empresa indicadora) — cobertura crítica exigida pelo evaluator: TODO motivo privado
// do freela (veto, opt-out, já conectado, teto) colapsa em `not_available` e a UI mostra
// SEMPRE a mesma mensagem genérica — nunca uma variação por cenário (isso vazaria
// informação por eliminação, ver ADR-20260821 D4).
// ---------------------------------------------------------------------------

const mockAddToast = vi.fn();
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }),
}));

const mockCreateReferral = vi.fn();
vi.mock('../../services/referralService', () => ({
  ReferralService: {
    createReferral: (...args: unknown[]) => mockCreateReferral(...args),
  },
}));

vi.mock('../../lib/logger', () => ({ logError: vi.fn() }));

const mockIlike = vi.fn();
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      ilike: (...args: unknown[]) => mockIlike(...args),
    })),
  },
}));

const TEAM_MEMBERS = [
  { connection: { id: 'c1' }, worker: { id: 'worker-1', full_name: 'Ana Souza' } },
] as unknown as TeamMember[];

function selectWorkerAndCompany() {
  fireEvent.change(screen.getByLabelText('Freela do seu elenco'), { target: { value: 'worker-1' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIlike.mockReturnValue({
    neq: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue({
        data: [{ id: 'company-a', name: 'Empresa A', logo_url: null }],
        error: null,
      }),
    }),
  });
});

async function pickCompany() {
  fireEvent.change(screen.getByPlaceholderText('Buscar empresa pelo nome'), {
    target: { value: 'Empresa' },
  });
  await waitFor(() => expect(screen.getByText('Empresa A')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Empresa A'));
}

describe('CreateReferralModal', () => {
  it('não permite submeter sem freela e empresa selecionados', () => {
    render(
      <CreateReferralModal
        open
        onClose={vi.fn()}
        referringCompanyId="company-b"
        teamMembers={TEAM_MEMBERS}
        onCreated={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /^Indicar$/ })).toBeDisabled();
  });

  it('em sucesso, chama onCreated e mostra toast de sucesso', async () => {
    mockCreateReferral.mockResolvedValue({ outcome: 'created', referralId: 'ref-1' });
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(
      <CreateReferralModal
        open
        onClose={onClose}
        referringCompanyId="company-b"
        teamMembers={TEAM_MEMBERS}
        onCreated={onCreated}
      />,
    );

    selectWorkerAndCompany();
    await pickCompany();
    fireEvent.click(screen.getByRole('button', { name: /^Indicar$/ }));

    await waitFor(() => expect(mockCreateReferral).toHaveBeenCalledWith('worker-1', 'company-b', 'company-a', undefined));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Indicação enviada'), 'success');
  });

  // ---------------------------------------------------------------------------
  // A UI é uma vitrine burra: mostra exatamente `result.error` que o service devolveu, sem
  // ramificar por outcome. Os quatro motivos privados do freela (veto/opt-out/já-conectado/
  // teto) JÁ colapsam em `outcome: 'not_available'` dentro da RPC (garantido pelo SQL + pelos
  // testes de `referralService.test.ts`, não aqui). O que este bloco prova, na fronteira do
  // componente: (1) quando o outcome É `not_available`, a mensagem exibida é a genérica
  // compartilhada; (2) outcomes REAIS e distintos (fatos da própria empresa indicadora, não do
  // freela) mostram mensagens próprias — só `not_available` produz a genérica.
  // ---------------------------------------------------------------------------
  const GENERIC_NOT_AVAILABLE = 'Não foi possível concluir a indicação.';

  it('outcome=not_available mostra a mensagem genérica compartilhada', async () => {
    mockCreateReferral.mockResolvedValue({ outcome: 'not_available', error: GENERIC_NOT_AVAILABLE });
    render(
      <CreateReferralModal
        open
        onClose={vi.fn()}
        referringCompanyId="company-b"
        teamMembers={TEAM_MEMBERS}
        onCreated={vi.fn()}
      />,
    );

    selectWorkerAndCompany();
    await pickCompany();
    fireEvent.click(screen.getByRole('button', { name: /^Indicar$/ }));

    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith(GENERIC_NOT_AVAILABLE, 'error'));
  });

  it.each([
    { outcome: 'already_pending', error: 'Já existe uma indicação sua pendente para esta empresa.' },
    { outcome: 'rate_limited', error: 'Limite de indicações atingido. Tente novamente mais tarde.' },
    { outcome: 'company_not_found', error: 'Empresa de destino não encontrada.' },
  ] as const)(
    'outcome=$outcome (fato da própria empresa indicadora) mostra mensagem PRÓPRIA, distinta da genérica',
    async ({ outcome, error }) => {
      mockCreateReferral.mockResolvedValue({ outcome, error });
      render(
        <CreateReferralModal
          open
          onClose={vi.fn()}
          referringCompanyId="company-b"
          teamMembers={TEAM_MEMBERS}
          onCreated={vi.fn()}
        />,
      );

      selectWorkerAndCompany();
      await pickCompany();
      fireEvent.click(screen.getByRole('button', { name: /^Indicar$/ }));

      await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith(error, 'error'));
      expect(error).not.toBe(GENERIC_NOT_AVAILABLE);
    },
  );
});

// ---------------------------------------------------------------------------
// DS-BUSCA (`.harness/spec/troca-freelas/ddl-aprovado.md` §6 +
// `ADR-20260821-busca-de-empresas-acoplada-ao-debito-10.md`) — sanitização do termo,
// mínimo de 3 caracteres e debounce ~300ms na busca da empresa destino.
// ---------------------------------------------------------------------------
describe('CreateReferralModal — DS-BUSCA (sanitização, mínimo, debounce)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderModal() {
    return render(
      <CreateReferralModal
        open
        onClose={vi.fn()}
        referringCompanyId="company-b"
        teamMembers={TEAM_MEMBERS}
        onCreated={vi.fn()}
      />,
    );
  }

  function searchInput() {
    return screen.getByPlaceholderText('Buscar empresa pelo nome');
  }

  it('DS-BUSCA-1: "%%" não produz uma query que casa com a tabela inteira (guard de comprimento deixa de ser decorativo)', async () => {
    renderModal();

    await act(async () => {
      fireEvent.change(searchInput(), { target: { value: '%%' } });
      await vi.advanceTimersByTimeAsync(400);
    });

    // Sanitizado, "%%" vira string vazia -> abaixo do mínimo de 3 chars -> NENHUMA query.
    // Com o código antigo (sem sanitização), isto dispararia `ilike('name', '%%%%')`
    // — um padrão que casa QUALQUER linha da tabela.
    expect(mockIlike).not.toHaveBeenCalled();
  });

  it('DS-BUSCA-1: remove `% _ * \\` do termo antes de montar o padrão ilike, preservando o restante', async () => {
    renderModal();

    await act(async () => {
      fireEvent.change(searchInput(), { target: { value: 'a%b_c*d\\e' } });
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(mockIlike).toHaveBeenCalledWith('name', '%abcde%');
  });

  it('DS-BUSCA-2: abaixo de 3 caracteres (sanitizados) não dispara query nenhuma', async () => {
    renderModal();

    await act(async () => {
      fireEvent.change(searchInput(), { target: { value: 'ab' } });
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(mockIlike).not.toHaveBeenCalled();
  });

  it('DS-BUSCA-2: exatamente 3 caracteres já dispara a query', async () => {
    renderModal();

    await act(async () => {
      fireEvent.change(searchInput(), { target: { value: 'abc' } });
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(mockIlike).toHaveBeenCalledWith('name', '%abc%');
  });

  it('DS-BUSCA-3: não busca antes de ~300ms e busca só uma vez depois do debounce', async () => {
    renderModal();

    await act(async () => {
      fireEvent.change(searchInput(), { target: { value: 'Emp' } });
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(mockIlike).not.toHaveBeenCalled();

    // Nova tecla dentro da janela de debounce reinicia o timer — uma query por rajada,
    // não uma por tecla.
    await act(async () => {
      fireEvent.change(searchInput(), { target: { value: 'Empr' } });
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(mockIlike).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(mockIlike).toHaveBeenCalledTimes(1);
    expect(mockIlike).toHaveBeenCalledWith('name', '%Empr%');
  });
});
