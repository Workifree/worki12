import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CompanyTeamMembers from './CompanyTeamMembers';
import type { MyCompany, TeamMemberItem } from '../../types';

const mockAddToast = vi.fn();
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }),
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../../lib/logger', () => ({ logError: vi.fn() }));
vi.mock('../../components/PageMeta', () => ({ default: () => null }));
vi.mock('../../components/company/TagsPanel', () => ({ default: () => <div data-testid="tags-panel" /> }));
vi.mock('../../services/shiftOperationService', () => ({
  listTags: vi.fn(async () => [{ id: 't1', name: 'Loja Centro', archivedAt: null }]),
}));

vi.mock('../../services/companyScopeService', async () => {
  const actual = await vi.importActual<typeof import('../../services/companyScopeService')>('../../services/companyScopeService');
  return { ...actual, getMyCompanies: vi.fn() };
});
vi.mock('../../services/teamMembersService', async () => {
  const actual = await vi.importActual<typeof import('../../services/teamMembersService')>('../../services/teamMembersService');
  return {
    ...actual,
    listMembers: vi.fn(),
    inviteMember: vi.fn(),
    resendInvite: vi.fn(),
    revokeInvite: vi.fn(),
    confirmMember: vi.fn(),
    rejectMember: vi.fn(),
    removeMember: vi.fn(),
    setMemberDefaultTag: vi.fn(),
  };
});

import { getMyCompanies } from '../../services/companyScopeService';
import * as svc from '../../services/teamMembersService';

function company(overrides: Partial<MyCompany> = {}): MyCompany {
  return {
    company_id: 'c1', company_name: 'Divino Fogão', role: 'owner', organization_id: 'o1',
    organization_name: null, onboarding_completed: true, accepted_tos: true, ...overrides,
  };
}

function member(overrides: Partial<TeamMemberItem> = {}): TeamMemberItem {
  return {
    memberId: 'm1', userId: 'u1', displayName: 'Ana', role: 'encarregado', status: 'active',
    state: 'active', confirmed: true, acceptedEmail: 'ana@x.com', invitedAt: null, expiresAt: null,
    acceptedAt: null, confirmedAt: null, removedAt: null, confirmationExpiresAt: null,
    defaultTagId: null, ...overrides,
  };
}

function list(items: TeamMemberItem[]) {
  vi.mocked(svc.listMembers).mockResolvedValue({ outcome: 'ok', elencoLinkRotationPending: false, items });
}

async function menu(nome: string, item: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name: (n: string) => n.startsWith(`Ações de ${nome} (`) }));
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
}

function preencher(nome: string, email = 'ana@x.com') {
  fireEvent.change(screen.getByLabelText(/Nome da pessoa/), { target: { value: nome } });
  fireEvent.change(screen.getByLabelText(/E-mail da pessoa/), { target: { value: email } });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/company/configuracoes/equipe']}>
      <Routes>
        <Route path="/company/configuracoes/equipe" element={<CompanyTeamMembers />} />
        <Route path="/company/dashboard" element={<div data-testid="dashboard">Dashboard</div>} />
        <Route path="/company/team" element={<div data-testid="elenco">Elenco</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMyCompanies).mockResolvedValue([company()]);
  list([]);
});

describe('CompanyTeamMembers', () => {
  it('quem não é Gestor (encarregado) é mandado para o dashboard', async () => {
    vi.mocked(getMyCompanies).mockResolvedValue([company({ role: 'encarregado', confirmed: true })]);
    renderPage();
    expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
    expect(svc.listMembers).not.toHaveBeenCalled();
  });

  it('tela só de funcionários: sem aviso nem texto de Elenco/freela, e sem rotação de link', async () => {
    vi.mocked(svc.listMembers).mockResolvedValue({ outcome: 'ok', items: [], elencoLinkRotationPending: true });
    renderPage();
    await screen.findByText('Convide seu primeiro encarregado');
    expect(screen.getByText('Funcionários que operam a empresa com você.')).toBeInTheDocument();
    expect(screen.queryByText(/Elenco|freela/i)).not.toBeInTheDocument();
  });

  it('dono único sem equipe: estado vazio útil com botão para convidar', async () => {
    renderPage();
    expect(await screen.findByText('Convide seu primeiro encarregado')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Convidar pessoa/ }).length).toBeGreaterThan(0);
  });

  it('cartão mostra nome, papel, loja padrão e estado na mesma lista (convite pendente incluído)', async () => {
    list([
      member({ memberId: 'm2', userId: 'u2', displayName: 'Beto', defaultTagId: 't1' }),
      member({ memberId: 'm3', userId: null, displayName: 'Caio', state: 'invited', status: 'invited', expiresAt: '2026-12-01T15:00:00Z' }),
    ]);
    renderPage();
    expect(await screen.findByText('Beto')).toBeInTheDocument();
    await screen.findByText('Loja: Loja Centro');
    expect(screen.getByText('Caio')).toBeInTheDocument();
    expect(screen.getByText('Convite pendente')).toBeInTheDocument();
    expect(screen.getByText(/Link válido até 01\/12/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gerar novo link/ })).toBeInTheDocument();
  });

  it('destaca "Fulano entrou" com Confirmar e Não é essa pessoa; confirmação exige digitar o nome', async () => {
    list([
      member({ memberId: 'm1', userId: 'u1', displayName: 'Ana', state: 'awaiting_confirmation', confirmed: false }),
      member({ memberId: 'm3', userId: null, displayName: 'Caio', state: 'invite_expired', status: 'invited' }),
    ]);
    vi.mocked(svc.confirmMember).mockResolvedValue({ outcome: 'confirmed' });
    renderPage();
    expect(await screen.findByText('Ana entrou. É essa pessoa?')).toBeInTheDocument();
    expect(screen.getByText('Expirado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Não é essa pessoa/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Confirmar$/ }));
    const campo = await screen.findByLabelText(/Digite o nome da pessoa/);
    expect(campo).toHaveValue('');
    expect(screen.getByRole('button', { name: /Confirmar acesso/ })).toBeDisabled();
    fireEvent.change(campo, { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar acesso/ }));
    await waitFor(() => expect(svc.confirmMember).toHaveBeenCalledWith('c1', 'u1', 'Ana'));
  });

  it('Gestor convidado aguardando confirmação aparece como Gestor na área de confirmação', async () => {
    list([member({ role: 'manager', state: 'awaiting_confirmation', confirmed: false })]);
    renderPage();
    expect(await screen.findByText(/Entrou como Gestor/)).toBeInTheDocument();
  });

  it('diálogo mostra e-mail verificado e hora do aceite em São Paulo; name_mismatch mantém aberto', async () => {
    list([member({
      state: 'awaiting_confirmation', confirmed: false,
      acceptedAt: '2026-11-25T15:30:00Z', confirmationExpiresAt: '2026-11-28T15:30:00Z',
    })]);
    vi.mocked(svc.confirmMember).mockResolvedValue({ outcome: 'name_mismatch' });
    renderPage();
    expect(await screen.findByText(/Confirme até 28\/11.*12:30/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Confirmar$/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('ana@x.com');
    expect(dialog).toHaveTextContent(/25\/11.*12:30/);
    fireEvent.change(screen.getByLabelText(/Digite o nome da pessoa/), { target: { value: 'Outra' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar acesso/ }));
    expect(await screen.findByText(/O nome não confere/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('confirmação expired: fecha o diálogo e explica o prazo de 72 horas', async () => {
    list([member({ state: 'awaiting_confirmation', confirmed: false })]);
    vi.mocked(svc.confirmMember).mockResolvedValue({ outcome: 'expired' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Confirmar$/ }));
    fireEvent.change(await screen.findByLabelText(/Digite o nome da pessoa/), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar acesso/ }));
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith(expect.stringMatching(/72 horas/), 'error'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('pending_expired: "Convidar de novo" reabre o formulário com nome e papel preenchidos', async () => {
    list([member({ state: 'pending_expired', confirmed: false })]);
    renderPage();
    expect(await screen.findByText('Expirado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Confirmar$/ })).not.toBeInTheDocument();
    await menu('Ana', /Convidar de novo/);
    expect(await screen.findByLabelText(/Nome da pessoa/)).toHaveValue('Ana');
  });

  it('linha de Gestor ativa não tem Confirmar nem Revogar, nem Alterar loja', async () => {
    list([member({ role: 'manager', state: 'active', confirmed: false })]);
    renderPage();
    expect((await screen.findAllByText('Gestor')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /^Ações de Ana \(/ }));
    expect(screen.queryByRole('menuitem', { name: /Alterar loja|Cancelar convite/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Confirmar$/ })).not.toBeInTheDocument();
  });

  it('convidar: nome, e-mail, papel e loja padrão vão ao serviço; só há o link para copiar (sem WhatsApp/telefone)', async () => {
    vi.mocked(svc.inviteMember).mockResolvedValue({ outcome: 'invited', inviteToken: 'tok123' });
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: /Convidar pessoa/ }))[0]);
    preencher('Ana');
    await screen.findByRole('option', { name: 'Loja Centro' });
    fireEvent.change(screen.getByLabelText('Loja padrão'), { target: { value: 't1' } });
    expect(screen.queryByLabelText(/WhatsApp|telefone/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Gerar convite/ }));

    expect(await screen.findByTestId('invite-link')).toHaveTextContent('/convite-equipe/tok123');
    expect(svc.inviteMember).toHaveBeenCalledWith('c1', 'Ana', 'encarregado', 'ana@x.com', 't1');

    expect(screen.queryByRole('button', { name: /WhatsApp/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copiar link/ })).toBeInTheDocument();
  });

  it('convidar Gestor: papel escolhido segue ao serviço, sem loja padrão', async () => {
    vi.mocked(svc.inviteMember).mockResolvedValue({ outcome: 'invited', inviteToken: 'tokg' });
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: /Convidar pessoa/ }))[0]);
    preencher('Bia', 'bia@x.com');
    fireEvent.click(screen.getByLabelText(/Gestor/));
    expect(screen.queryByLabelText('Loja padrão')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Gerar convite/ }));
    await screen.findByTestId('invite-link');
    expect(svc.inviteMember).toHaveBeenCalledWith('c1', 'Bia', 'manager', 'bia@x.com', undefined);
  });

  it('convidar sem e-mail válido não chama o serviço', async () => {
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: /Convidar pessoa/ }))[0]);
    preencher('Ana', 'sem-arroba');
    fireEvent.click(screen.getByRole('button', { name: /Gerar convite/ }));
    expect(await screen.findByText('Digite um e-mail válido.')).toBeInTheDocument();
    expect(svc.inviteMember).not.toHaveBeenCalled();
  });

  it('already_invited por variação do nome: avisa e usa o nome gravado no convite', async () => {
    vi.mocked(svc.inviteMember).mockResolvedValue({ outcome: 'already_invited', memberId: 'm9', inviteToken: 'tok' });
    vi.mocked(svc.listMembers)
      .mockResolvedValueOnce({ outcome: 'ok', items: [], elencoLinkRotationPending: false })
      .mockResolvedValue({
        outcome: 'ok', elencoLinkRotationPending: false,
        items: [member({ memberId: 'm9', userId: null, displayName: 'José', state: 'invited', status: 'invited' })],
      });
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: /Convidar pessoa/ }))[0]);
    preencher('jose', 'jose@x.com');
    fireEvent.click(screen.getByRole('button', { name: /Gerar convite/ }));
    expect(await screen.findByText(/Este é o mesmo link/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Envie este link para José.'));
  });

  it('"Alterar loja" no menu da linha chama setMemberDefaultTag e explica a regra em uma frase', async () => {
    list([member({ memberId: 'm7' })]);
    vi.mocked(svc.setMemberDefaultTag).mockResolvedValue({ outcome: 'ok' } as never);
    renderPage();
    await menu('Ana', /Alterar loja/);
    expect(await screen.findByText(/nascem com esta loja e ele não pode trocar/)).toBeInTheDocument();
    await screen.findByRole('option', { name: 'Loja Centro' });
    fireEvent.change(screen.getByLabelText('Loja padrão'), { target: { value: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(svc.setMemberDefaultTag).toHaveBeenCalledWith('c1', 'm7', 't1'));
  });

  it('remover: dry-run, informa turnos abertos, remove e avisa sem misturar Equipe com Elenco', async () => {
    list([member()]);
    vi.mocked(svc.removeMember)
      .mockResolvedValueOnce({ outcome: 'would_remove', openJobs: 3, elencoLinkRotationAdvised: true, alreadyRemoved: false })
      .mockResolvedValueOnce({ outcome: 'removed', openJobs: 3, elencoLinkRotationAdvised: true, alreadyRemoved: false });
    renderPage();
    await menu('Ana', /Remover/);

    expect(await screen.findByText(/3 turnos abertos no nome dessa pessoa ficarão com você/)).toBeInTheDocument();
    expect(svc.removeMember).toHaveBeenNthCalledWith(1, 'c1', 'u1', true);

    fireEvent.click(screen.getByRole('button', { name: /Remover agora/ }));
    await waitFor(() => expect(svc.removeMember).toHaveBeenNthCalledWith(2, 'c1', 'u1', false));
    expect(await screen.findByText(/Para trazer outra, use Convidar pessoa/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Abrir Meu Elenco/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Dispensar aviso/ }));
    expect(screen.queryByText(/Para trazer outra/)).not.toBeInTheDocument();
  });

  it('remover o último Gestor (last_manager) explica o motivo', async () => {
    list([member({ role: 'manager' })]);
    vi.mocked(svc.removeMember).mockResolvedValue({
      outcome: 'last_manager', openJobs: 0, elencoLinkRotationAdvised: false, alreadyRemoved: false,
    });
    renderPage();
    await menu('Ana', /Remover/);
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith(expect.stringMatching(/pelo menos um Gestor/), 'error'));
  });

  it('"Não é essa pessoa" corta o acesso só depois de confirmar', async () => {
    list([member({ state: 'awaiting_confirmation', confirmed: false })]);
    vi.mocked(svc.rejectMember).mockResolvedValue({ outcome: 'rejected' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Não é essa pessoa/ }));
    expect(svc.rejectMember).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: /Cortar acesso/ }));
    await waitFor(() => expect(svc.rejectMember).toHaveBeenCalledWith('c1', 'u1'));
  });

  it('"Gerar novo link" de convite ainda válido pede confirmação (o antigo morre)', async () => {
    list([member({ memberId: 'm4', userId: null, displayName: 'Davi', state: 'invited', status: 'invited' })]);
    vi.mocked(svc.resendInvite).mockResolvedValue({ outcome: 'resent', inviteToken: 'tok-davi' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Gerar novo link/ }));
    expect(svc.resendInvite).not.toHaveBeenCalled();
    expect(screen.getByText(/O link anterior deixa de valer/, { selector: 'p.mb-5' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Gerar novo link/ }));
    await waitFor(() => expect(svc.resendInvite).toHaveBeenCalledWith('m4'));
  });

  it('convite vencido: "Gerar novo link" gera direto e mostra o NOVO link', async () => {
    list([member({ memberId: 'm3', userId: null, displayName: 'Caio', state: 'invite_expired', status: 'invited' })]);
    vi.mocked(svc.resendInvite).mockResolvedValue({ outcome: 'resent', inviteToken: 'novo-token' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Gerar novo link/ }));
    expect(await screen.findByTestId('invite-link')).toHaveTextContent('/convite-equipe/novo-token');
    expect(screen.queryByText(/WhatsApp/)).not.toBeInTheDocument();
  });

  it('revogar convite pendente (menu) chama a RPC', async () => {
    list([member({ memberId: 'm3', userId: null, displayName: 'Caio', state: 'invited', status: 'invited' })]);
    vi.mocked(svc.revokeInvite).mockResolvedValue({ outcome: 'revoked' });
    renderPage();
    await menu('Caio', /Cancelar convite/);
    expect(svc.revokeInvite).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/Cancelar o convite de Caio/);
    expect(dialog).toHaveTextContent('O link deixa de valer.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar convite' }));
    await waitFor(() => expect(svc.revokeInvite).toHaveBeenCalledWith('m3'));
  });

  it('homônimos têm botões de ações distintos e o diálogo mostra e-mail e papel', async () => {
    list([
      member({ memberId: 'a1', displayName: 'Ana', acceptedEmail: 'ana1@x.com' }),
      member({ memberId: 'a2', userId: null, displayName: 'Ana', state: 'invited', status: 'invited', acceptedEmail: null, invitedEmail: 'ana2@x.com' }),
    ]);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Ações de Ana (ana1@x.com)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ações de Ana (ana2@x.com)' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Cancelar convite/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Ana (ana2@x.com)');
    expect(dialog).toHaveTextContent('Encarregado');
  });

  it('modal de convite fecha com Escape e devolve o foco ao botão que abriu', async () => {
    renderPage();
    const abrir = (await screen.findAllByRole('button', { name: /Convidar pessoa/ }))[0];
    abrir.focus();
    fireEvent.click(abrir);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/Nome da pessoa/)).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(abrir).toHaveFocus();
  });

  it('"Tentar de novo" após falha ao resolver a empresa recarrega tudo', async () => {
    vi.mocked(getMyCompanies).mockRejectedValueOnce(new Error('rede'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    expect(await screen.findByText('Convide seu primeiro encarregado')).toBeInTheDocument();
    expect(getMyCompanies).toHaveBeenCalledTimes(2);
  });

  it('mensagem própria quando outro Gestor já resolveu (not_pending_confirmation)', async () => {
    list([member({ state: 'awaiting_confirmation', confirmed: false })]);
    vi.mocked(svc.rejectMember).mockResolvedValue({ outcome: 'not_pending_confirmation' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Não é essa pessoa/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Cortar acesso/ }));
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith(expect.stringMatching(/Outro Gestor já resolveu/), 'error'));
  });
});
