import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CompanyReferrals from './CompanyReferrals';
import type { WorkerReferralCard } from '../../types';

// ---------------------------------------------------------------------------
// F10 (empresa destino/A) — a asserção mais importante desta feature (D2 do ADR
// ADR-20260821-indicacao-entre-empresas.md): a UI NUNCA depende de `worker_id` de uma
// indicação pendente. `list_worker_referral_cards()` devolve `worker_id: null` enquanto
// `status !== 'accepted'` — se algum código tentasse montar link/ação a partir dele, o
// teste abaixo (renderizar sem quebrar e sem expor link nenhum de perfil) falharia.
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockListReceivedCards = vi.fn();
const mockListMyReferrals = vi.fn();
vi.mock('../../services/referralService', () => ({
  ReferralService: {
    listReceivedCards: (...args: unknown[]) => mockListReceivedCards(...args),
    listMyReferrals: (...args: unknown[]) => mockListMyReferrals(...args),
    cancelReferral: vi.fn(),
  },
}));

const mockTeamMembers = vi.fn(() => [] as unknown[]);
vi.mock('../../hooks/useTeamConnections', () => ({
  useCompanyTeam: () => ({
    teamMembers: mockTeamMembers(),
    pendingConnections: [],
    loading: false,
    companyId: 'company-a',
    addWorker: vi.fn(),
    removeWorker: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const mockAddToast = vi.fn();
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }),
}));

vi.mock('../../lib/logger', () => ({ logError: vi.fn() }));

const mockCompaniesIn = vi.fn();
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      in: (...args: unknown[]) => mockCompaniesIn(...args),
    })),
  },
}));

const PENDING_CARD: WorkerReferralCard = {
  referral_id: 'ref-1',
  status: 'awaiting_worker',
  message: 'Ana é ótima no salão',
  created_at: new Date().toISOString(),
  expires_at: new Date().toISOString(),
  referring_company: { id: 'company-b', name: 'Empresa B', logo_url: null },
  worker_id: null,
  card: {
    full_name: 'Ana Souza',
    avatar_url: null,
    rating_average: 4.8,
    reviews_count: 12,
    primary_role: 'Garçom',
    roles: ['garcom'],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockListMyReferrals.mockResolvedValue([]);
  mockCompaniesIn.mockResolvedValue({ data: [], error: null });
  mockTeamMembers.mockReturnValue([]);
});

function renderPage() {
  return render(
    <MemoryRouter>
      <CompanyReferrals />
    </MemoryRouter>,
  );
}

describe('CompanyReferrals — caixa de entrada (empresa destino)', () => {
  it('lista cartões via list_worker_referral_cards, NUNCA from(worker_referrals) pré-aceite', async () => {
    mockListReceivedCards.mockResolvedValue({ outcome: 'ok', items: [PENDING_CARD] });
    renderPage();

    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument());
    expect(mockListReceivedCards).toHaveBeenCalledTimes(1);
    // A vitrine é sempre chamada SEM parâmetro (precedente is_shift_call_target).
    expect(mockListReceivedCards).toHaveBeenCalledWith();
  });

  it('NUNCA renderiza link/ação de perfil a partir de worker_id nulo em card pendente', async () => {
    mockListReceivedCards.mockResolvedValue({ outcome: 'ok', items: [PENDING_CARD] });
    renderPage();

    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument());

    // Nenhum link para a rota de perfil do freela pode existir enquanto worker_id é null —
    // essa rota SÓ pode ser alcançada por um worker_id real.
    const links = screen.queryAllByRole('link');
    links.forEach((link) => {
      expect(link.getAttribute('href')).not.toMatch(/\/company\/worker\//);
    });
    // A tela não tem nenhum botão de "conversar"/"convidar" para este cartão pendente.
    expect(screen.queryByRole('button', { name: /mensagem/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /convidar/i })).not.toBeInTheDocument();
  });

  it('mostra o nome da empresa indicadora e status "aguardando"', async () => {
    mockListReceivedCards.mockResolvedValue({ outcome: 'ok', items: [PENDING_CARD] });
    renderPage();

    await waitFor(() => expect(screen.getByText(/Empresa B/)).toBeInTheDocument());
    expect(screen.getByText('Aguardando o freela')).toBeInTheDocument();
  });

  it('redireciona para login se a sessão expirou', async () => {
    mockListReceivedCards.mockResolvedValue({ outcome: 'unauthenticated', items: [] });
    renderPage();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login'));
  });

  it('lista vazia mostra estado vazio, sem erro', async () => {
    mockListReceivedCards.mockResolvedValue({ outcome: 'ok', items: [] });
    renderPage();

    await waitFor(() => expect(screen.getByText('Nenhuma indicação recebida ainda.')).toBeInTheDocument());
  });
});

describe('CompanyReferrals — caixa de saída (empresa indicadora)', () => {
  it('troca para a aba Enviadas e lista via from(worker_referrals) (RLS própria)', async () => {
    mockListReceivedCards.mockResolvedValue({ outcome: 'ok', items: [] });
    mockListMyReferrals.mockResolvedValue([
      {
        id: 'ref-2',
        worker_id: 'worker-9',
        referring_company_id: 'company-a',
        requesting_company_id: 'company-c',
        status: 'awaiting_worker',
        message: null,
        created_at: new Date().toISOString(),
        expires_at: new Date().toISOString(),
      },
    ]);
    mockCompaniesIn.mockResolvedValue({ data: [{ id: 'company-c', name: 'Empresa C' }], error: null });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /enviadas/i }));

    await waitFor(() => expect(screen.getByText('Empresa C')).toBeInTheDocument());
    expect(mockListMyReferrals).toHaveBeenCalledWith('company-a');
  });

  // -------------------------------------------------------------------------
  // C-REFERRAL-SENT-LEGIBILIDADE (evaluator): B indicou o MESMO freela ou freelas
  // diferentes para a MESMA empresa destino — sem o nome do indicado, as linhas ficam
  // idênticas e o botão "cancelar" vira uma loteria. `worker_id` já vem por RLS própria
  // (é indicação da própria B); o nome resolve via `teamMembers` (já carregado, sem query nova).
  // -------------------------------------------------------------------------
  it('resolve o nome do freela indicado por linha, distinguindo indicações para a mesma empresa destino', async () => {
    mockListReceivedCards.mockResolvedValue({ outcome: 'ok', items: [] });
    mockTeamMembers.mockReturnValue([
      { connection: { id: 'c1' }, worker: { id: 'worker-9', full_name: 'Ana Souza' } },
      { connection: { id: 'c2' }, worker: { id: 'worker-10', full_name: 'Bruno Lima' } },
    ]);
    mockListMyReferrals.mockResolvedValue([
      {
        id: 'ref-2',
        worker_id: 'worker-9',
        referring_company_id: 'company-a',
        requesting_company_id: 'company-c',
        status: 'awaiting_worker',
        message: null,
        created_at: new Date().toISOString(),
        expires_at: new Date().toISOString(),
      },
      {
        id: 'ref-3',
        worker_id: 'worker-10',
        referring_company_id: 'company-a',
        requesting_company_id: 'company-c',
        status: 'awaiting_worker',
        message: null,
        created_at: new Date().toISOString(),
        expires_at: new Date().toISOString(),
      },
    ]);
    mockCompaniesIn.mockResolvedValue({ data: [{ id: 'company-c', name: 'Empresa C' }], error: null });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /enviadas/i }));

    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument());
    expect(screen.getByText('Bruno Lima')).toBeInTheDocument();
    // As duas linhas apontam pra mesma "Empresa C" mas são distinguíveis pelo nome do freela.
    expect(screen.getAllByText('Empresa C')).toHaveLength(2);
  });
});
