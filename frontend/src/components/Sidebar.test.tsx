import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invalidateCompanyScope } from '../services/companyScopeService';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from './Sidebar';

const mockGetUser = vi.fn();
const mockRpc = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(), maybeSingle: vi.fn(async () => ({ data: null })) })) })),
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

function renderSidebar(path = '/company/dashboard', type: 'company' | 'worker' = 'company') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar type={type} />
    </MemoryRouter>,
  );
}

describe('Sidebar — F13 (R13 seletor de unidade / R16 gate de Organização)', () => {
  beforeEach(() => {
        invalidateCompanyScope()  // o cache de rajada do seam nao pode vazar entre testes
    vi.clearAllMocks();
    sessionStorage.clear();
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

  const itens = () =>
    within(screen.getByRole('navigation', { name: 'Navegação principal' })).getAllByRole('link').map((a) => a.textContent);

  it('empresa: "Criar turno" no topo e seis itens agrupados', async () => {
    mockRpc.mockResolvedValue({ data: [companyRow()], error: null });

    renderSidebar();

    await waitFor(() => expect(itens()).toEqual(['Início', 'Turnos', 'Elenco', 'Mensagens', 'Relatórios', 'Gestão']));
    expect(screen.getByRole('link', { name: 'Criar turno' })).toHaveAttribute('href', '/company/create');
    expect(screen.getByRole('link', { name: /Divino Fogão/ })).toHaveAttribute('href', '/company/gestao');
  });

  it('encarregado: com Elenco, sem Relatórios', async () => {
    mockRpc.mockResolvedValue({ data: [companyRow({ role: 'encarregado' })], error: null });

    renderSidebar();

    await waitFor(() => expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('href', '/company/hoje'));
    expect(itens()).toEqual(['Início', 'Turnos', 'Elenco', 'Mensagens', 'Gestão']);
  });

  it('sub-rota mantém o item ativo; notificações não marcam nada', async () => {
    mockRpc.mockResolvedValue({ data: [companyRow()], error: null });

    const { unmount } = renderSidebar('/company/jobs/abc/edit');
    expect(screen.getByRole('link', { name: 'Turnos' })).toHaveAttribute('aria-current', 'page');
    unmount();

    renderSidebar('/company/notifications');
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
    expect(nav.querySelector('[aria-current]')).toBeNull();
  });

  it('freela: cinco itens e o cartão do rodapé leva ao perfil, ativo em /profile', () => {
    renderSidebar('/profile', 'worker');

    expect(itens()).toEqual(['Início', 'Meus Turnos', 'Empresas', 'Recebimentos', 'Mensagens']);
    const perfil = screen.getByRole('link', { name: /Ver meu perfil/ });
    expect(perfil).toHaveAttribute('href', '/profile');
    expect(perfil).toHaveAttribute('aria-current', 'page');
    expect(within(perfil).getByText('0 XP')).toBeInTheDocument();
  });
});
