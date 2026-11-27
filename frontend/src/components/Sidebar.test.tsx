import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invalidateCompanyScope } from '../services/companyScopeService';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
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
    expect(screen.queryByLabelText('Trocar de empresa')).not.toBeInTheDocument();
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
      expect(screen.getByLabelText('Trocar de empresa')).toBeInTheDocument();
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

  it('encarregado: com Elenco, sem Mensagens (chat fora da v1) e sem Relatórios', async () => {
    mockRpc.mockResolvedValue({ data: [companyRow({ role: 'encarregado' })], error: null });

    renderSidebar();

    await waitFor(() => expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('href', '/company/hoje'));
    expect(itens()).toEqual(['Início', 'Turnos', 'Elenco', 'Gestão']);
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

  it('freela: cinco itens e a conta no rodapé leva ao perfil, ativa em /profile', () => {
    renderSidebar('/profile', 'worker');

    expect(itens()).toEqual(['Início', 'Meus Turnos', 'Empresas', 'Recebimentos', 'Mensagens']);
    const perfil = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/profile') as HTMLElement;
    expect(perfil).toHaveAttribute('href', '/profile');
    expect(perfil).toHaveAttribute('aria-current', 'page');
    // Sem o dado do freela (mock devolve null), nada de "Nível 1 · 0 XP" fabricado: só esqueleto.
    expect(within(perfil).queryByText(/XP/)).not.toBeInTheDocument();
  });

  it('rodapé de uma linha: Perfil, Ajuda e Sair ficam no menu "..." (teclado e rótulo)', async () => {
    renderSidebar('/dashboard', 'worker');

    const gatilho = screen.getByRole('button', { name: 'Mais opções da conta' });
    expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
    fireEvent.click(gatilho);

    const menu = await screen.findByRole('menu', { name: 'Conta' });
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Meu perfil', 'Ajuda', 'Sair']);
  });

  it('empresa: o menu da conta não repete "Meu perfil" e termina em Sair', async () => {
    mockRpc.mockResolvedValue({ data: [companyRow()], error: null });
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções da conta' }));

    const menu = await screen.findByRole('menu', { name: 'Conta' });
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Ajuda', 'Sair']);
  });

  it('recolhida (768-1099px): o texto dos itens continua para leitor de tela', () => {
    renderSidebar('/dashboard', 'worker');
    const inicio = screen.getByRole('link', { name: 'Início' });
    expect(within(inicio).getByText('Início')).toHaveClass('max-[1099px]:sr-only');
    expect(inicio).toHaveAttribute('title', 'Início');
  });

  it('links da navegação têm alvo de toque >= 44px (min-h-11), também no rail', () => {
    renderSidebar('/dashboard', 'worker');
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
    for (const link of within(nav).getAllByRole('link')) expect(link).toHaveClass('min-h-11');
  });
});
