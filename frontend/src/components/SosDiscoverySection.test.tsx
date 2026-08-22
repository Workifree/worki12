import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SosDiscoverySection from './SosDiscoverySection';

// ---------------------------------------------------------------------------
// F11 — opt-in do freela (`workers.discoverable_for_sos`). Cobertura:
//  - O TEXTO DE CONSENTIMENTO (§5 do ddl-aprovado.md) está SEMPRE no DOM quando o toggle é
//    oferecido — nunca escondido atrás de um clique/tooltip. Isto é o requisito central da
//    tarefa: um consentimento que não diz o que expõe não sustenta a feature.
//  - O texto precisa nomear CPF e data de nascimento, não só telefone/PIX (dívida #13): o aceite
//    do SOS libera a linha inteira de `workers` via `can_view_worker_profile` (vínculo
//    operacional), não só telefone/chave PIX. Este teste falha se alguém remover a menção a CPF.
//  - Sem `availability_days` declarado, o toggle NEM APARECE (gate do DDL §5) — e, coerente com
//    isso, o texto de consentimento também não aparece (nada foi oferecido para consentir).
//  - Toggle chama SosService.setDiscoverable com o valor invertido; falha do service mostra
//    erro e NÃO muda o estado exibido (sem otimismo silencioso).
// ---------------------------------------------------------------------------

const mockAddToast = vi.fn();
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }),
}));

const mockSetDiscoverable = vi.fn();
vi.mock('../services/sosService', () => ({
  SosService: {
    setDiscoverable: (...args: unknown[]) => mockSetDiscoverable(...args),
  },
}));

const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: (...args: unknown[]) => mockMaybeSingle(...args),
    })),
  },
}));

vi.mock('../lib/logger', () => ({ logError: vi.fn() }));

const CONSENT_PHRASE = /passa a ver seus dados de contrata/i;
// A lista de dados expostos precisa citar CPF e data de nascimento (não só telefone/PIX) —
// é o ponto central da correção da dívida #13: o texto antigo subdeclarava o que
// `can_view_worker_profile` realmente libera no aceite do SOS.
const CONSENT_LISTS_SENSITIVE_FIELDS = /telefone.*cpf.*data de nascimento.*chave pix/is;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'worker-1' } } });
});

describe('SosDiscoverySection', () => {
  it('sem availability_days declarado, NÃO renderiza o toggle nem o texto de consentimento', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { discoverable_for_sos: false, availability_days: null },
      error: null,
    });
    render(<SosDiscoverySection />);

    await waitFor(() =>
      expect(screen.getByText(/declare sua disponibilidade/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByText(CONSENT_PHRASE)).not.toBeInTheDocument();
  });

  it('com availability_days declarado, o texto de consentimento está visível JUNTO do toggle desligado', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { discoverable_for_sos: false, availability_days: { '1': ['manha'] } },
      error: null,
    });
    render(<SosDiscoverySection />);

    await waitFor(() => expect(screen.getByRole('switch')).toBeInTheDocument());
    // O consentimento precisa estar no DOM ANTES de qualquer interação — não atrás de clique.
    expect(screen.getByText(CONSENT_PHRASE)).toBeInTheDocument();
    expect(screen.getByText(CONSENT_LISTS_SENSITIVE_FIELDS)).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Descoberta desativada')).toBeInTheDocument();
  });

  it('reflete discoverable_for_sos=true carregado do banco', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { discoverable_for_sos: true, availability_days: { '2': ['tarde'] } },
      error: null,
    });
    render(<SosDiscoverySection />);

    await waitFor(() => expect(screen.getByText('Descoberta ativada')).toBeInTheDocument());
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(CONSENT_PHRASE)).toBeInTheDocument();
    expect(screen.getByText(CONSENT_LISTS_SENSITIVE_FIELDS)).toBeInTheDocument();
  });

  it('ao ligar, chama setDiscoverable(true) e atualiza a UI', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { discoverable_for_sos: false, availability_days: { '3': ['noite'] } },
      error: null,
    });
    mockSetDiscoverable.mockResolvedValue({ success: true });
    render(<SosDiscoverySection />);

    await waitFor(() => expect(screen.getByText('Descoberta desativada')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(mockSetDiscoverable).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.getByText('Descoberta ativada')).toBeInTheDocument());
    expect(mockAddToast).toHaveBeenCalledWith(expect.any(String), 'success');
  });

  it('se o service falhar, mostra erro e NÃO muda o estado exibido', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { discoverable_for_sos: false, availability_days: { '3': ['noite'] } },
      error: null,
    });
    mockSetDiscoverable.mockResolvedValue({ success: false, error: 'Não foi possível salvar a preferência.' });
    render(<SosDiscoverySection />);

    await waitFor(() => expect(screen.getByText('Descoberta desativada')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith('Não foi possível salvar a preferência.', 'error'),
    );
    expect(screen.getByText('Descoberta desativada')).toBeInTheDocument();
  });
});
