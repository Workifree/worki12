import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from './Sidebar';

const mockGetUser = vi.fn();
const mockRpc = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(), maybeSingle: vi.fn() })) })),
    })),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

vi.mock('../lib/logger', () => ({ logError: vi.fn() }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ signOut: vi.fn() }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn(), removeToast: vi.fn() }) }));
vi.mock('./NotificationBell', () => ({ default: () => null }));

function companyRow(overrides: Record<string, unknown> = {}) {
  return {
    company_id: 'comp-1',
    company_name: 'Divino Fogão — Unidade 1',
    role: 'owner',
    organization_id: 'org-1',
    organization_name: 'Divino Fogão',
    onboarding_completed: true,
    accepted_tos: true,
    ...overrides,
  };
}

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar type="company" />
    </MemoryRouter>,
  );
}

describe('Sidebar — F13 (R13 seletor de unidade / R16 gate de Organização)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email_confirmed_at: '2026-01-01' } } });
  });

  it('conta com UMA unidade: seletor não aparece (zero mudança visual, caso dominante)', async () => {
    mockRpc.mockResolvedValue({ data: [companyRow()], error: null });

    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText('Divino Fogão — Unidade 1')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('Trocar de unidade')).not.toBeInTheDocument();
  });

  it('sessão com MAIS de uma unidade: seletor aparece com as opções', async () => {
    mockRpc.mockResolvedValue({
      data: [
        companyRow({ company_id: 'comp-1', company_name: 'Loja Centro' }),
        companyRow({ company_id: 'comp-2', company_name: 'Loja Zona Sul', role: 'manager' }),
      ],
      error: null,
    });

    renderSidebar();

    await waitFor(() => {
      expect(screen.getByLabelText('Trocar de unidade')).toBeInTheDocument();
    });
    expect(screen.getByRole('option', { name: 'Loja Centro' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Loja Zona Sul' })).toBeInTheDocument();
  });

  it('role=owner: link "Organização" aparece no menu', async () => {
    mockRpc.mockResolvedValue({ data: [companyRow({ role: 'owner' })], error: null });

    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText('Organização')).toBeInTheDocument();
    });
  });

  it('role=manager (gerente comum): link "Organização" NÃO aparece no menu', async () => {
    mockRpc.mockResolvedValue({ data: [companyRow({ role: 'manager' })], error: null });

    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText('Perfil Empresa')).toBeInTheDocument();
    });
    expect(screen.queryByText('Organização')).not.toBeInTheDocument();
  });
});
