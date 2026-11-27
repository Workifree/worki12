import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AcceptTeamInvite from './AcceptTeamInvite';

const mockGetUser = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockSignInWithOtp = vi.fn();
const mockSignOut = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: (...a: unknown[]) => mockGetUser(...a),
      signInWithPassword: (...a: unknown[]) => mockSignInWithPassword(...a),
      signInWithOtp: (...a: unknown[]) => mockSignInWithOtp(...a),
      signOut: (...a: unknown[]) => mockSignOut(...a),
    },
  },
}));
vi.mock('../lib/logger', () => ({ logError: vi.fn() }));
vi.mock('../services/teamMembersService', async () => {
  const actual = await vi.importActual<typeof import('../services/teamMembersService')>('../services/teamMembersService');
  return { ...actual, getInvitePreview: vi.fn(), acceptMemberInvite: vi.fn(), provisionTeamInviteAccount: vi.fn() };
});

import { acceptMemberInvite, getInvitePreview, provisionTeamInviteAccount } from '../services/teamMembersService';
import { getSelectedCompanyId } from '../services/companyScopeService';

const TOKEN = 'a'.repeat(64);
const SENHA = 'senha-forte-123';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/convite-equipe/${TOKEN}`]}>
      <Routes>
        <Route path="/convite-equipe/:token" element={<AcceptTeamInvite />} />
        <Route path="/company/hoje" element={<div data-testid="dashboard">Hoje</div>} />
        <Route path="/login" element={<div data-testid="login">Login</div>} />
        <Route path="/" element={<div data-testid="home">Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Preenche senha + confirmação + Termos e envia o formulário de conta nova. */
async function criarSenhaEEnviar(senha = SENHA, confirmacao = senha) {
  await screen.findByText(/te convidou como Encarregado/);
  fireEvent.change(screen.getByLabelText(/Crie uma senha/), { target: { value: senha } });
  fireEvent.change(screen.getByLabelText(/Repita a senha/), { target: { value: confirmacao } });
  fireEvent.click(screen.getByLabelText(/Li e aceito/));
  fireEvent.click(screen.getByRole('button', { name: /Criar senha e entrar na equipe/ }));
}

/** Vai para o login de quem já tem conta e preenche e-mail, senha e Termos. */
async function loginEEnviar(email = 'ana@exemplo.com', senha = 'minha-senha') {
  await screen.findByText(/te convidou como Encarregado/);
  fireEvent.click(screen.getByRole('button', { name: /Já tenho conta com este e-mail/ }));
  fireEvent.change(await screen.findByLabelText(/Seu e-mail/), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/Sua senha/), { target: { value: senha } });
  fireEvent.click(screen.getByLabelText(/Li e aceito/));
  fireEvent.click(screen.getByRole('button', { name: /Entrar na equipe/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  mockGetUser.mockResolvedValue({ data: { user: null } });
  mockSignInWithPassword.mockResolvedValue({
    data: { user: { id: 'u1', email: 'ana@exemplo.com', user_metadata: { user_type: 'hire' } } },
    error: null,
  });
  mockSignOut.mockResolvedValue({ error: null });
  vi.mocked(getInvitePreview).mockResolvedValue({
    outcome: 'ok', companyName: 'Divino Fogão', role: 'encarregado', emailMasked: 'an***@exemplo.com', emailBound: true,
  });
  vi.mocked(provisionTeamInviteAccount).mockResolvedValue({ outcome: 'created', email: 'ana@exemplo.com' });
  vi.mocked(acceptMemberInvite).mockResolvedValue({ outcome: 'accepted' });
});

describe('AcceptTeamInvite — prévia', () => {
  it('mostra "Empresa X te convidou como Encarregado", o e-mail mascarado travado e guarda o token', async () => {
    renderPage();
    expect(await screen.findByText('Divino Fogão te convidou como Encarregado')).toBeInTheDocument();
    expect(getInvitePreview).toHaveBeenCalledWith(TOKEN);
    const campo = screen.getByLabelText('E-mail do convite') as HTMLInputElement;
    expect(campo.value).toBe('an***@exemplo.com');
    expect(campo).toBeDisabled();
    expect(sessionStorage.getItem('pending_team_invite_token')).toBe(TOKEN);
  });

  it('convite antigo (sem e-mail preso): pede novo link e não oferece formulário nem OTP', async () => {
    vi.mocked(getInvitePreview).mockResolvedValue({ outcome: 'ok', companyName: 'X', role: 'encarregado', emailBound: false });
    renderPage();
    expect(await screen.findByText('Convite antigo')).toBeInTheDocument();
    expect(screen.getByText(/Peça ao Gestor um novo link/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Crie uma senha/)).not.toBeInTheDocument();
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it('token morto (prévia expired) NÃO fica guardado e apaga um token velho da sessão', async () => {
    sessionStorage.setItem('pending_team_invite_token', 'token-velho');
    vi.mocked(getInvitePreview).mockResolvedValue({ outcome: 'expired' });
    renderPage();
    expect(await screen.findByText('Convite vencido')).toBeInTheDocument();
    expect(sessionStorage.getItem('pending_team_invite_token')).toBeNull();
  });

  it('prévia not_found: link inválido, sem formulário', async () => {
    vi.mocked(getInvitePreview).mockResolvedValue({ outcome: 'not_found' });
    renderPage();
    expect(await screen.findByText('Link inválido')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Crie uma senha/)).not.toBeInTheDocument();
  });

  it('prévia com falha de rede: oferece tentar de novo', async () => {
    vi.mocked(getInvitePreview).mockResolvedValueOnce({ outcome: 'error' });
    renderPage();
    expect(await screen.findByText('Não foi possível abrir o convite')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tentar de novo/ }));
    expect(await screen.findByText('Divino Fogão te convidou como Encarregado')).toBeInTheDocument();
  });
});

describe('AcceptTeamInvite — conta nova com senha (sem OTP)', () => {
  it('cria a conta, entra com a senha e aceita: ordem provision, signInWithPassword, aceite, Hoje', async () => {
    renderPage();
    await criarSenhaEEnviar();
    expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
    expect(provisionTeamInviteAccount).toHaveBeenCalledWith(TOKEN, SENHA);
    expect(mockSignInWithPassword).toHaveBeenCalledWith({ email: 'ana@exemplo.com', password: SENHA });
    expect(acceptMemberInvite).toHaveBeenCalledWith(TOKEN, true);
    const ordem = [
      vi.mocked(provisionTeamInviteAccount).mock.invocationCallOrder[0],
      mockSignInWithPassword.mock.invocationCallOrder[0],
      vi.mocked(acceptMemberInvite).mock.invocationCallOrder[0],
    ];
    expect(ordem).toEqual([...ordem].sort((a, b) => a - b));
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('pending_team_invite_token')).toBeNull();
  });

  it('validações locais: senha curta, senhas diferentes e Termos não chamam a função', async () => {
    renderPage();
    await criarSenhaEEnviar('curta', 'curta');
    expect(await screen.findByText(/A senha precisa ter de 8 a 72 caracteres/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Crie uma senha/), { target: { value: SENHA } });
    fireEvent.change(screen.getByLabelText(/Repita a senha/), { target: { value: SENHA + 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar senha e entrar na equipe/ }));
    expect(await screen.findByText('As senhas não são iguais.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Repita a senha/), { target: { value: SENHA } });
    fireEvent.click(screen.getByLabelText(/Li e aceito/)); // desmarca os Termos
    fireEvent.click(screen.getByRole('button', { name: /Criar senha e entrar na equipe/ }));
    expect(await screen.findByText(/Aceite os Termos de Uso/)).toBeInTheDocument();
    expect(provisionTeamInviteAccount).not.toHaveBeenCalled();
  });

  it('mostrar/ocultar senha alterna o tipo do campo', async () => {
    renderPage();
    await screen.findByText(/te convidou como Encarregado/);
    const campo = screen.getByLabelText(/Crie uma senha/) as HTMLInputElement;
    expect(campo.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(campo.type).toBe('text');
  });

  it('abrir o link nunca aceita: nada é chamado sem o clique', async () => {
    renderPage();
    await screen.findByText(/te convidou como Encarregado/);
    expect(provisionTeamInviteAccount).not.toHaveBeenCalled();
    expect(acceptMemberInvite).not.toHaveBeenCalled();
  });

  it('conta criada mas login falhou: cai no login com e-mail preenchido (sem recriar)', async () => {
    mockSignInWithPassword.mockResolvedValueOnce({ data: { user: null }, error: new Error('x') });
    renderPage();
    await criarSenhaEEnviar();
    expect(await screen.findByText(/Sua conta foi criada, mas não conseguimos entrar/)).toBeInTheDocument();
    expect((screen.getByLabelText(/Seu e-mail/) as HTMLInputElement).value).toBe('ana@exemplo.com');
    expect(acceptMemberInvite).not.toHaveBeenCalled();
  });

  it('e-mail de freela (worker_cannot_be_manager): mensagem honesta e nenhum login', async () => {
    vi.mocked(provisionTeamInviteAccount).mockResolvedValue({ outcome: 'worker_cannot_be_manager' });
    renderPage();
    await criarSenhaEEnviar();
    expect(await screen.findByText('Este e-mail é de uma conta de freela')).toBeInTheDocument();
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it('account_pending: orienta a pedir outro e-mail ou usar Esqueci a senha', async () => {
    vi.mocked(provisionTeamInviteAccount).mockResolvedValue({ outcome: 'account_pending' });
    renderPage();
    await criarSenhaEEnviar();
    expect(await screen.findByText('Já existe uma conta com este e-mail')).toBeInTheDocument();
    expect(screen.getByText(/ainda não confirmada/)).toBeInTheDocument();
    expect(screen.getByText(/Esqueci a senha/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ir para o login/ }));
    expect(await screen.findByTestId('login')).toBeInTheDocument();
  });

  it('rate_limited: pede para aguardar e permite voltar ao convite', async () => {
    vi.mocked(provisionTeamInviteAccount).mockResolvedValue({ outcome: 'rate_limited' });
    renderPage();
    await criarSenhaEEnviar();
    expect(await screen.findByText('Muitas tentativas')).toBeInTheDocument();
    expect(screen.getByText(/Aguarde alguns minutos/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Voltar ao convite/ }));
    expect(await screen.findByLabelText(/Crie uma senha/)).toBeInTheDocument();
  });

  it.each([
    ['expired', 'Convite vencido'],
    ['not_found', 'Link inválido'],
    ['legacy_invite', 'Convite antigo'],
  ] as const)('%s na função: encerra com copy própria', async (outcome, titulo) => {
    vi.mocked(provisionTeamInviteAccount).mockResolvedValue({ outcome });
    renderPage();
    await criarSenhaEEnviar();
    expect(await screen.findByText(titulo)).toBeInTheDocument();
  });

  it('erro genérico da função mantém o formulário com mensagem', async () => {
    vi.mocked(provisionTeamInviteAccount).mockResolvedValue({ outcome: 'error' });
    renderPage();
    await criarSenhaEEnviar();
    expect(await screen.findByText(/Não foi possível criar sua conta agora/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Crie uma senha/)).toBeInTheDocument();
  });
});

describe('AcceptTeamInvite — conta que já existe', () => {
  it('existing_account: pede e-mail e senha da conta dele, entra e aceita', async () => {
    vi.mocked(provisionTeamInviteAccount).mockResolvedValue({ outcome: 'existing_account' });
    renderPage();
    await criarSenhaEEnviar();
    fireEvent.change(await screen.findByLabelText(/Seu e-mail/), { target: { value: ' Ana@Exemplo.com ' } });
    fireEvent.change(screen.getByLabelText(/Sua senha/), { target: { value: 'minha-senha' } });
    // Os Termos marcados no formulário anterior continuam marcados.
    expect(screen.getByLabelText(/Li e aceito/)).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Entrar na equipe/ }));
    expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
    expect(mockSignInWithPassword).toHaveBeenCalledWith({ email: 'ana@exemplo.com', password: 'minha-senha' });
    expect(acceptMemberInvite).toHaveBeenCalledWith(TOKEN, true);
  });

  it('"Já tenho conta" vai direto ao login sem chamar a função', async () => {
    renderPage();
    await loginEEnviar();
    expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
    expect(provisionTeamInviteAccount).not.toHaveBeenCalled();
  });

  it('senha errada: mensagem clara e nenhum aceite', async () => {
    mockSignInWithPassword.mockResolvedValue({ data: { user: null }, error: new Error('invalid') });
    renderPage();
    await loginEEnviar();
    expect(await screen.findByText(/E-mail ou senha incorretos/)).toBeInTheDocument();
    expect(acceptMemberInvite).not.toHaveBeenCalled();
  });

  it('email_mismatch: "Este convite é para outro e-mail", token preservado, e permite trocar de conta', async () => {
    vi.mocked(acceptMemberInvite).mockResolvedValue({ outcome: 'email_mismatch' });
    renderPage();
    await loginEEnviar('outra@exemplo.com');
    expect(await screen.findByText('Este convite é para outro e-mail')).toBeInTheDocument();
    expect(sessionStorage.getItem('pending_team_invite_token')).toBe(TOKEN);
    fireEvent.click(screen.getByRole('button', { name: /Entrar com outra conta/ }));
    expect(mockSignOut).toHaveBeenCalled();
    expect(await screen.findByLabelText(/Sua senha/)).toBeInTheDocument();
  });

  it('conta de freela no login (user_type=work): bloqueia sem chamar o aceite', async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: { id: 'w', email: 'f@x.com', user_metadata: { user_type: 'work' } } },
      error: null,
    });
    renderPage();
    await loginEEnviar('f@x.com');
    expect(await screen.findByText('Este e-mail é de uma conta de freela')).toBeInTheDocument();
    expect(acceptMemberInvite).not.toHaveBeenCalled();
  });
});

describe('AcceptTeamInvite — já logado', () => {
  const logado = (tipo = 'hire') =>
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u', email: 'ana@x.com', user_metadata: { user_type: tipo } } } });

  it('com sessão de empresa: só pede os Termos e aceita com p_accept_tos=true', async () => {
    logado();
    renderPage();
    await screen.findByText(/ana@x.com/);
    const botao = screen.getByRole('button', { name: /Entrar na equipe/ });
    expect(botao).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Li e aceito/));
    fireEvent.click(botao);
    await waitFor(() => expect(acceptMemberInvite).toHaveBeenCalledWith(TOKEN, true));
    expect(provisionTeamInviteAccount).not.toHaveBeenCalled();
  });

  it('montar a página logado, sem clicar, não chama o aceite', async () => {
    logado();
    renderPage();
    await screen.findByText(/ana@x.com/);
    expect(acceptMemberInvite).not.toHaveBeenCalled();
  });

  it('sessão com outro e-mail: email_mismatch no aceite mostra a tela própria', async () => {
    logado();
    vi.mocked(acceptMemberInvite).mockResolvedValue({ outcome: 'email_mismatch' });
    renderPage();
    await screen.findByText(/ana@x.com/);
    fireEvent.click(screen.getByLabelText(/Li e aceito/));
    fireEvent.click(screen.getByRole('button', { name: /Entrar na equipe/ }));
    expect(await screen.findByText('Este convite é para outro e-mail')).toBeInTheDocument();
  });

  it('com sessão de freela: bloqueia e oferece outra conta', async () => {
    logado('work');
    renderPage();
    expect(await screen.findByText('Este e-mail é de uma conta de freela')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Entrar com outra conta/ }));
    expect(mockSignOut).toHaveBeenCalled();
    expect(await screen.findByLabelText(/Sua senha/)).toBeInTheDocument();
  });

  it('"Agora não" apaga o token guardado e vai para o início', async () => {
    logado();
    renderPage();
    await screen.findByText(/ana@x.com/);
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    expect(await screen.findByTestId('home')).toBeInTheDocument();
    expect(sessionStorage.getItem('pending_team_invite_token')).toBeNull();
  });
});

describe('AcceptTeamInvite — outcomes do aceite', () => {
  it.each(['accepted', 'already_accepted', 'already_operator'] as const)(
    '%s: cai direto na tela da empresa e apaga o token da sessão',
    async (outcome) => {
      vi.mocked(acceptMemberInvite).mockResolvedValue({ outcome });
      renderPage();
      await criarSenhaEEnviar();
      expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
      expect(sessionStorage.getItem('pending_team_invite_token')).toBeNull();
    },
  );

  it('quem já tem empresa passa a operar a empresa do convite', async () => {
    vi.mocked(acceptMemberInvite).mockResolvedValue({ outcome: 'accepted', companyId: 'empresa-do-convite' });
    renderPage();
    await criarSenhaEEnviar();
    expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
    expect(getSelectedCompanyId()).toBe('empresa-do-convite');
  });

  it('desfecho terminal (token_already_used) descarta o token pendente', async () => {
    vi.mocked(acceptMemberInvite).mockResolvedValue({ outcome: 'token_already_used' });
    renderPage();
    await criarSenhaEEnviar();
    expect(await screen.findByText('Link já usado')).toBeInTheDocument();
    expect(sessionStorage.getItem('pending_team_invite_token')).toBeNull();
  });

  const COPY: Array<[string, string]> = [
    ['expired', 'Convite vencido'],
    ['revoked', 'Convite cancelado'],
    ['not_found', 'Link inválido'],
    ['worker_cannot_be_manager', 'Este e-mail é de uma conta de freela'],
    ['manager_requires_verified_signup', 'Cadastre-se primeiro'],
    ['email_not_verified', 'Não conseguimos confirmar seu e-mail'],
    ['invalid_input', 'Não foi possível entrar'],
    ['unauthenticated', 'Sua sessão expirou'],
    ['error', 'Não foi possível processar'],
  ];

  it.each(COPY)('%s: copy própria em português e não navega', async (outcome, titulo) => {
    vi.mocked(acceptMemberInvite).mockResolvedValue({ outcome: outcome as never });
    renderPage();
    await criarSenhaEEnviar();
    expect(await screen.findByText(titulo)).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
  });

  it('tos_required volta ao formulário com mensagem dos Termos', async () => {
    vi.mocked(acceptMemberInvite).mockResolvedValueOnce({ outcome: 'tos_required' });
    renderPage();
    await criarSenhaEEnviar();
    expect(await screen.findByText(/aceite os Termos de Uso/i)).toBeInTheDocument();
  });

  it('outcome fora do contrato cai em "error" e "Tentar de novo" refaz só o aceite', async () => {
    vi.mocked(acceptMemberInvite).mockResolvedValueOnce({ outcome: 'algo_novo' as never });
    vi.mocked(acceptMemberInvite).mockResolvedValueOnce({ outcome: 'accepted' });
    renderPage();
    await criarSenhaEEnviar();
    expect(await screen.findByText('Não foi possível processar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tentar de novo/ }));
    expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
    expect(acceptMemberInvite).toHaveBeenCalledTimes(2);
    expect(provisionTeamInviteAccount).toHaveBeenCalledTimes(1);
  });
});
