import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import QuemTeIndicou from './QuemTeIndicou';

// ---------------------------------------------------------------------------
// F10 (freela) — "Quem te indicou". Cobertura:
//  - aceitar cria vínculo e some da lista com mensagem explicando a consequência;
//  - recusar é NEUTRO (mesma cor/estilo de sucesso do aceite, nunca alarme vermelho);
//  - `blocked_by_you` mostra o motivo (é seguro — o veto é do próprio freela).
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockGetUser = vi.fn();
const mockCompaniesIn = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      in: (...args: unknown[]) => mockCompaniesIn(...args),
    })),
  },
}));

vi.mock('../lib/logger', () => ({ logError: vi.fn() }));

const mockAddToast = vi.fn();
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }),
}));

const mockListMyPendingReferrals = vi.fn();
const mockAcceptReferral = vi.fn();
const mockDeclineReferral = vi.fn();
vi.mock('../services/referralService', () => ({
  ReferralService: {
    listMyPendingReferrals: (...args: unknown[]) => mockListMyPendingReferrals(...args),
    acceptReferral: (...args: unknown[]) => mockAcceptReferral(...args),
    declineReferral: (...args: unknown[]) => mockDeclineReferral(...args),
  },
}));

const PENDING = {
  id: 'ref-1',
  worker_id: 'worker-1',
  referring_company_id: 'company-b',
  requesting_company_id: 'company-a',
  status: 'awaiting_worker' as const,
  message: 'Você é ótima, quer trabalhar lá também?',
  created_at: new Date().toISOString(),
  expires_at: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'worker-1' } } });
  mockCompaniesIn.mockResolvedValue({ data: [{ id: 'company-b', name: 'Empresa A', logo_url: null }], error: null });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <QuemTeIndicou />
    </MemoryRouter>,
  );
}

describe('QuemTeIndicou', () => {
  it('lista indicações pendentes com nome da empresa indicadora e o recado', async () => {
    mockListMyPendingReferrals.mockResolvedValue([PENDING]);
    renderPage();

    await waitFor(() => expect(screen.getByText('Empresa A')).toBeInTheDocument());
    expect(screen.getByText(/Você é ótima, quer trabalhar lá também/)).toBeInTheDocument();
  });

  it('explica a consequência do aceite antes do clique', async () => {
    mockListMyPendingReferrals.mockResolvedValue([PENDING]);
    renderPage();

    await waitFor(() => expect(screen.getByText('Empresa A')).toBeInTheDocument());
    expect(screen.getByText(/passa a te ver e pode te chamar para turnos/)).toBeInTheDocument();
  });

  it('aceitar remove da lista e mostra toast de sucesso', async () => {
    mockListMyPendingReferrals.mockResolvedValue([PENDING]);
    mockAcceptReferral.mockResolvedValue({ outcome: 'accepted' });
    renderPage();

    await waitFor(() => expect(screen.getByText('Empresa A')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /aceitar/i }));

    await waitFor(() => expect(mockAcceptReferral).toHaveBeenCalledWith('ref-1'));
    await waitFor(() => expect(screen.queryByText('Empresa A')).not.toBeInTheDocument());
    expect(mockAddToast).toHaveBeenCalledWith(expect.any(String), 'success');
  });

  it('recusar é neutro: mesmo tom "success" do aceite, sem alarme', async () => {
    mockListMyPendingReferrals.mockResolvedValue([PENDING]);
    mockDeclineReferral.mockResolvedValue({ outcome: 'declined' });
    renderPage();

    await waitFor(() => expect(screen.getByText('Empresa A')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /recusar/i }));

    await waitFor(() => expect(mockDeclineReferral).toHaveBeenCalledWith('ref-1'));
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith(expect.any(String), 'success'));
  });

  it('blocked_by_you mostra o motivo (é seguro contar — o veto é do próprio freela)', async () => {
    mockListMyPendingReferrals.mockResolvedValue([PENDING]);
    mockAcceptReferral.mockResolvedValue({
      outcome: 'blocked_by_you',
      error: 'Você bloqueou esta empresa. Para se conectar, reative o vínculo nas suas configurações de bloqueio.',
    });
    renderPage();

    await waitFor(() => expect(screen.getByText('Empresa A')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /aceitar/i }));

    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith(
        'Você bloqueou esta empresa. Para se conectar, reative o vínculo nas suas configurações de bloqueio.',
        'error',
      ),
    );
    // Card continua na lista — não foi resolvida.
    expect(screen.getByText('Empresa A')).toBeInTheDocument();
  });

  it('sem sessão, redireciona para /login', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    renderPage();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login'));
  });

  it('lista vazia mostra estado vazio', async () => {
    mockListMyPendingReferrals.mockResolvedValue([]);
    renderPage();

    await waitFor(() => expect(screen.getByText('Nenhuma indicação pendente no momento.')).toBeInTheDocument());
  });
});
