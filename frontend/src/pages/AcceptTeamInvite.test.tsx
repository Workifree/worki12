import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AcceptTeamInvite from './AcceptTeamInvite';

const mockGetUser = vi.fn();
const mockSignInWithOtp = vi.fn();
const mockVerifyOtp = vi.fn();
const mockSignOut = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: (...a: unknown[]) => mockGetUser(...a),
      signInWithOtp: (...a: unknown[]) => mockSignInWithOtp(...a),
      verifyOtp: (...a: unknown[]) => mockVerifyOtp(...a),
      signOut: (...a: unknown[]) => mockSignOut(...a),
    },
  },
}));
vi.mock('../lib/logger', () => ({ logError: vi.fn() }));
vi.mock('../services/teamMembersService', async () => {
  const actual = await vi.importActual<typeof import('../services/teamMembersService')>('../services/teamMembersService');
  return { ...actual, getInvitePreview: vi.fn(), acceptMemberInvite: vi.fn() };
});

import { acceptMemberInvite, getInvitePreview } from '../services/teamMembersService';

const TOKEN = 'a'.repeat(64);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/convite-equipe/${TOKEN}`]}>
      <Routes>
        <Route path="/convite-equipe/:token" element={<AcceptTeamInvite />} />
        <Route path="/company/hoje" element={<div data-testid="dashboard">Hoje</div>} />
        <Route path="/convite-gerente/:token" element={<div data-testid="gerente">Gerente</div>} />
        <Route path="/" element={<div data-testid="home">Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Percorre o formulário até o aceite: e-mail + Termos → código → aceite. */
async function percorrerAteAceitar() {
  await screen.findByText(/te convidou como Encarregado/);
  fireEvent.change(screen.getByLabelText(/Seu e-mail/), { target: { value: 'Ana@Exemplo.com' } });
  fireEvent.click(screen.getByLabelText(/Li e aceito/));
  fireEvent.click(screen.getByRole('button', { name: /Receber código por e-mail/ }));
  const codigo = await screen.findByLabelText(/Código do e-mail/);
  fireEvent.change(codigo, { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: /Entrar na equipe/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mockGetUser.mockResolvedValue({ data: { user: null } });
  mockSignInWithOtp.mockResolvedValue({ error: null });
  mockVerifyOtp.mockResolvedValue({ data: { user: { id: 'u1', user_metadata: { user_type: 'hire' } } }, error: null });
  mockSignOut.mockResolvedValue({ error: null });
  vi.mocked(getInvitePreview).mockResolvedValue({ outcome: 'ok', companyName: 'Divino Fogão', role: 'encarregado' });
});

describe('AcceptTeamInvite — prévia', () => {
  it('mostra "Empresa X te convidou como Encarregado" e preserva o token na sessão', async () => {
    renderPage();
    expect(await screen.findByText('Divino Fogão te convidou como Encarregado')).toBeInTheDocument();
    expect(getInvitePreview).toHaveBeenCalledWith(TOKEN);
    expect(sessionStorage.getItem('pending_team_invite_token')).toBe(TOKEN);
  });

  it('prévia not_found: link inválido, sem formulário', async () => {
    vi.mocked(getInvitePreview).mockResolvedValue({ outcome: 'not_found' });
    renderPage();
    expect(await screen.findByText('Link inválido')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Seu e-mail/)).not.toBeInTheDocument();
  });

  it('prévia expired: convite vencido, sem formulário', async () => {
    vi.mocked(getInvitePreview).mockResolvedValue({ outcome: 'expired' });
    renderPage();
    expect(await screen.findByText('Convite vencido')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Seu e-mail/)).not.toBeInTheDocument();
  });

  it('prévia com falha de rede: oferece tentar de novo', async () => {
    vi.mocked(getInvitePreview).mockResolvedValueOnce({ outcome: 'error' });
    renderPage();
    expect(await screen.findByText('Não foi possível abrir o convite')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tentar de novo/ }));
    expect(await screen.findByText('Divino Fogão te convidou como Encarregado')).toBeInTheDocument();
  });
});

describe('AcceptTeamInvite — entrada por código, sem senha', () => {
  it('exige o aceite dos Termos antes de enviar o código', async () => {
    renderPage();
    await screen.findByText(/te convidou como Encarregado/);
    fireEvent.change(screen.getByLabelText(/Seu e-mail/), { target: { value: 'ana@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Receber código por e-mail/ }));
    expect(await screen.findByText(/Aceite os Termos de Uso/)).toBeInTheDocument();
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it('envia o OTP criando conta de EMPRESA (user_type=hire), nunca de freela', async () => {
    vi.mocked(acceptMemberInvite).mockResolvedValue({ outcome: 'accepted' });
    renderPage();
    await percorrerAteAceitar();
    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: 'ana@exemplo.com',
      options: { shouldCreateUser: true, data: { user_type: 'hire' } },
    });
    expect(mockVerifyOtp).toHaveBeenCalledWith({ email: 'ana@exemplo.com', token: '123456', type: 'email' });
  });

  it('código incorreto: mensagem clara e nada de aceite', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { user: null }, error: new Error('invalid') });
    renderPage();
    await percorrerAteAceitar();
    expect(await screen.findByText(/Código incorreto ou vencido/)).toBeInTheDocument();
    expect(acceptMemberInvite).not.toHaveBeenCalled();
  });

  it('e-mail que já é de freela (user_type=work): worker_cannot_be_manager sem chamar o aceite', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { user: { id: 'u2', user_metadata: { user_type: 'work' } } }, error: null });
    renderPage();
    await percorrerAteAceitar();
    expect(await screen.findByText('Este e-mail é de uma conta de freela')).toBeInTheDocument();
    expect(screen.getByText(/Use outro e-mail para entrar na equipe/)).toBeInTheDocument();
    expect(acceptMemberInvite).not.toHaveBeenCalled();
  });

  it('com sessão de freela já aberta: bloqueia e oferece outro e-mail', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'w', email: 'f@x.com', user_metadata: { user_type: 'work' } } } });
    renderPage();
    expect(await screen.findByText('Este e-mail é de uma conta de freela')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Usar outro e-mail/ }));
    expect(mockSignOut).toHaveBeenCalled();
    expect(await screen.findByLabelText(/Seu e-mail/)).toBeInTheDocument();
  });

  it('com sessão de empresa aberta: só pede os Termos e aceita com p_accept_tos=true', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u', email: 'ana@x.com', user_metadata: { user_type: 'hire' } } } });
    vi.mocked(acceptMemberInvite).mockResolvedValue({ outcome: 'accepted' });
    renderPage();
    await screen.findByText(/ana@x.com/);
    const botao = screen.getByRole('button', { name: /Entrar na equipe/ });
    expect(botao).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Li e aceito/));
    fireEvent.click(botao);
    await waitFor(() => expect(acceptMemberInvite).toHaveBeenCalledWith(TOKEN, true));
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });
});

describe('AcceptTeamInvite — todos os outcomes do aceite', () => {
  it.each(['accepted', 'already_accepted', 'already_operator'] as const)(
    '%s: cai direto na tela da empresa e apaga o token da sessão',
    async (outcome) => {
      vi.mocked(acceptMemberInvite).mockResolvedValue({ outcome });
      renderPage();
      await percorrerAteAceitar();
      expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
      expect(acceptMemberInvite).toHaveBeenCalledWith(TOKEN, true);
      expect(sessionStorage.getItem('pending_team_invite_token')).toBeNull();
    },
  );

  const COPY: Array<[string, string]> = [
    ['expired', 'Convite vencido'],
    ['revoked', 'Convite cancelado'],
    ['token_already_used', 'Link já usado'],
    ['not_found', 'Link inválido'],
    ['worker_cannot_be_manager', 'Este e-mail é de uma conta de freela'],
    ['use_manager_invite', 'Este convite é de Gestor'],
    ['email_not_verified', 'Não conseguimos confirmar seu e-mail'],
    ['invalid_input', 'Não foi possível entrar'],
    ['unauthenticated', 'Sua sessão expirou'],
    ['error', 'Não foi possível processar'],
  ];

  it.each(COPY)('%s: mostra copy própria em português e não navega', async (outcome, titulo) => {
    vi.mocked(acceptMemberInvite).mockResolvedValue({ outcome: outcome as never });
    renderPage();
    await percorrerAteAceitar();
    expect(await screen.findByText(titulo)).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
  });

  it('use_manager_invite oferece o caminho de Gestor', async () => {
    vi.mocked(acceptMemberInvite).mockResolvedValue({ outcome: 'use_manager_invite' });
    renderPage();
    await percorrerAteAceitar();
    fireEvent.click(await screen.findByRole('button', { name: /Continuar como Gestor/ }));
    expect(await screen.findByTestId('gerente')).toBeInTheDocument();
  });

  it('tos_required NÃO é beco sem saída: volta com o checkbox dos Termos e deixa aceitar sem novo código', async () => {
    vi.mocked(acceptMemberInvite).mockResolvedValueOnce({ outcome: 'tos_required' });
    vi.mocked(acceptMemberInvite).mockResolvedValueOnce({ outcome: 'accepted' });
    renderPage();
    await percorrerAteAceitar();
    expect(await screen.findByText(/aceite os Termos de Uso/i)).toBeInTheDocument();
    const box = screen.getByLabelText(/Li e aceito/)
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: /Entrar na equipe/ }));
    expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
    expect(mockVerifyOtp).toHaveBeenCalledTimes(1);
  });

  it('outcome fora do contrato cai em "error" (sem tela branca) e "Tentar de novo" refaz o aceite', async () => {
    vi.mocked(acceptMemberInvite).mockResolvedValueOnce({ outcome: 'algo_novo' as never });
    vi.mocked(acceptMemberInvite).mockResolvedValueOnce({ outcome: 'accepted' });
    renderPage();
    await percorrerAteAceitar();
    expect(await screen.findByText('Não foi possível processar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tentar de novo/ }));
    expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
    expect(acceptMemberInvite).toHaveBeenCalledTimes(2);
    expect(mockVerifyOtp).toHaveBeenCalledTimes(1);
  });

  it('limite de envio do OTP (429) mostra mensagem própria', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: Object.assign(new Error('rate limit'), { status: 429 }) });
    renderPage();
    await screen.findByText(/te convidou como Encarregado/);
    fireEvent.change(screen.getByLabelText(/Seu e-mail/), { target: { value: 'ana@x.com' } });
    fireEvent.click(screen.getByLabelText(/Li e aceito/));
    fireEvent.click(screen.getByRole('button', { name: /Receber código por e-mail/ }));
    expect(await screen.findByText('Aguarde um minuto para pedir outro código.')).toBeInTheDocument();
  });
});
