import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ReferralOptOutSection from './ReferralOptOutSection';

// ---------------------------------------------------------------------------
// F10 — opt-out do freela (`workers.accepts_referrals`). Cobertura:
//  - estado inicial reflete a coluna lida do banco;
//  - toggle chama ReferralService.setAcceptsReferrals com o valor invertido;
//  - falha do service mostra erro e NÃO muda o estado visual (sem otimismo silencioso).
// ---------------------------------------------------------------------------

const mockAddToast = vi.fn();
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }),
}));

const mockSetAcceptsReferrals = vi.fn();
vi.mock('../services/referralService', () => ({
  ReferralService: {
    setAcceptsReferrals: (...args: unknown[]) => mockSetAcceptsReferrals(...args),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'worker-1' } } });
});

describe('ReferralOptOutSection', () => {
  it('reflete accepts_referrals=true carregado do banco', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { accepts_referrals: true }, error: null });
    render(<ReferralOptOutSection />);

    await waitFor(() => expect(screen.getByText('Aceito ser indicado')).toBeInTheDocument());
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('reflete accepts_referrals=false carregado do banco', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { accepts_referrals: false }, error: null });
    render(<ReferralOptOutSection />);

    await waitFor(() => expect(screen.getByText('Não quero ser indicado')).toBeInTheDocument());
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('ao clicar, chama setAcceptsReferrals com o valor invertido e atualiza a UI', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { accepts_referrals: true }, error: null });
    mockSetAcceptsReferrals.mockResolvedValue({ success: true });
    render(<ReferralOptOutSection />);

    await waitFor(() => expect(screen.getByText('Aceito ser indicado')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(mockSetAcceptsReferrals).toHaveBeenCalledWith(false));
    await waitFor(() => expect(screen.getByText('Não quero ser indicado')).toBeInTheDocument());
    expect(mockAddToast).toHaveBeenCalledWith(expect.any(String), 'success');
  });

  it('se o service falhar, mostra erro e NÃO muda o estado exibido', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { accepts_referrals: true }, error: null });
    mockSetAcceptsReferrals.mockResolvedValue({ success: false, error: 'Não foi possível salvar sua preferência.' });
    render(<ReferralOptOutSection />);

    await waitFor(() => expect(screen.getByText('Aceito ser indicado')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith('Não foi possível salvar sua preferência.', 'error'),
    );
    expect(screen.getByText('Aceito ser indicado')).toBeInTheDocument();
  });
});
