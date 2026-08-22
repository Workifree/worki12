import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SosCallButton } from './SosCallButton';

// ---------------------------------------------------------------------------
// F11 (SOS) — botão "Chamar fora do Elenco" na tela da empresa. Cobertura:
//  - botão desabilitado quando `sos_call_eligibility` recusa (cada `reason` tem mensagem própria
//    no atributo `title`, já que o botão nunca é a única guarda — a RPC reverifica tudo);
//  - habilitado quando elegível, abre o modal SEM nenhuma lista de nomes/alvos (a promessa
//    central: a empresa nunca vê quem foi chamado);
//  - cada `outcome` de recusa de `create_sos_call` mostra sua própria mensagem (nunca um erro
//    genérico) — inclui o caso em que o botão estava habilitado mas a RPC recusou mesmo assim;
//  - sucesso mostra a CONTAGEM devolvida pela RPC, nunca uma lista.
// ---------------------------------------------------------------------------

const mockAddToast = vi.fn();
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }),
}));

const mockCheckEligibility = vi.fn();
const mockCreateSosCall = vi.fn();
vi.mock('../../services/sosService', () => ({
  SosService: {
    checkEligibility: (...args: unknown[]) => mockCheckEligibility(...args),
    createSosCall: (...args: unknown[]) => mockCreateSosCall(...args),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SosCallButton', () => {
  it('desabilita o botão quando a elegibilidade recusa, com o motivo específico no title', async () => {
    mockCheckEligibility.mockResolvedValue({ eligible: false, reason: 'team_call_still_open' });
    render(<SosCallButton jobId="job-1" onDispatched={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /sos/i })).toBeDisabled());
    expect(screen.getByRole('button', { name: /sos/i })).toHaveAttribute(
      'title',
      expect.stringContaining('chamado ao Elenco em aberto'),
    );
  });

  it('habilita o botão quando elegível e abre o modal sem lista de alvos', async () => {
    mockCheckEligibility.mockResolvedValue({ eligible: true, reason: 'ok' });
    render(<SosCallButton jobId="job-1" onDispatched={vi.fn()} />);

    const button = await screen.findByRole('button', { name: /sos/i });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);

    expect(screen.getByRole('heading', { name: /chamar fora do elenco/i })).toBeInTheDocument();
    // A membrana: nenhum nome de freela, nenhuma lista — só o texto da regra.
    expect(screen.getByText(/você não vai ver quem foi chamado/i)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it.each([
    ['pool_empty', /elegíveis fora do seu elenco/i],
    ['quota_exceeded', /limite de chamados de urgência/i],
    ['not_urgent', /menos de 4 horas/i],
    ['already_filled', /todas as vagas preenchidas/i],
    ['team_not_tried', /chame primeiro o seu elenco/i],
    ['company_city_missing', /cadastre a cidade/i],
  ])('outcome %s mostra a mensagem específica ao tentar disparar', async (outcome, expected) => {
    mockCheckEligibility.mockResolvedValue({ eligible: true, reason: 'ok' });
    mockCreateSosCall.mockResolvedValue({
      success: false,
      outcome,
      error:
        outcome === 'pool_empty'
          ? 'Não encontramos freelas elegíveis fora do seu Elenco agora. Tente novamente mais tarde.'
          : outcome === 'quota_exceeded'
            ? 'Você atingiu o limite de chamados de urgência (1 aberto por vez, 3 a cada 7 dias).'
            : outcome === 'not_urgent'
              ? 'O SOS só pode ser aberto quando o turno começa em menos de 4 horas.'
              : outcome === 'already_filled'
                ? 'Este turno já está com todas as vagas preenchidas.'
                : outcome === 'team_not_tried'
                  ? 'Chame primeiro o seu Elenco — o SOS só abre depois que o chamado ao Elenco esgotar.'
                  : 'Cadastre a cidade da sua empresa no perfil para poder usar o SOS.',
    });
    render(<SosCallButton jobId="job-1" onDispatched={vi.fn()} />);

    const button = await screen.findByRole('button', { name: /sos/i });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: /chamar fora do elenco/i }));

    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith(expect.stringMatching(expected), 'error'));
  });

  it('sucesso mostra a CONTAGEM devolvida pela RPC, nunca uma lista', async () => {
    mockCheckEligibility.mockResolvedValue({ eligible: true, reason: 'ok' });
    mockCreateSosCall.mockResolvedValue({ success: true, outcome: 'created', callId: 'call-1', targetsCount: 7 });
    const onDispatched = vi.fn();
    render(<SosCallButton jobId="job-1" onDispatched={onDispatched} />);

    const button = await screen.findByRole('button', { name: /sos/i });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: /chamar fora do elenco/i }));

    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('7'), 'success'),
    );
    expect(onDispatched).toHaveBeenCalledWith(7);
  });
});
