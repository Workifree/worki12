import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CompanyTeamMembers from './CompanyTeamMembers';
import type { MyCompany, TeamMemberItem } from '../../types';

const mockAddToast = vi.fn();
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }),
}));
vi.mock('../../lib/logger', () => ({ logError: vi.fn() }));
vi.mock('../../components/PageMeta', () => ({ default: () => null }));
vi.mock('../../components/company/TagsPanel', () => ({ default: () => null }));

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
    acceptedAt: null, confirmedAt: null, removedAt: null, ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/company/configuracoes/equipe']}>
      <Routes>
        <Route path="/company/configuracoes/equipe" element={<CompanyTeamMembers />} />
        <Route path="/company/dashboard" element={<div data-testid="dashboard">Dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMyCompanies).mockResolvedValue([company()]);
  vi.mocked(svc.listMembers).mockResolvedValue({ outcome: 'ok', items: [] });
});

describe('CompanyTeamMembers', () => {
  it('quem não é Gestor (encarregado) é mandado para o dashboard', async () => {
    vi.mocked(getMyCompanies).mockResolvedValue([company({ role: 'encarregado', confirmed: true })]);
    renderPage();
    expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
    expect(svc.listMembers).not.toHaveBeenCalled();
  });

  it('dono único sem equipe: estado vazio com botão primário para convidar', async () => {
    renderPage();
    expect(await screen.findByText('Ninguém na equipe ainda')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Convidar alguém da equipe/ })).toBeInTheDocument();
  });

  it('lista nome, papel e status; destaca "Fulano entrou, é ele?" com Confirmar e Não é ele', async () => {
    vi.mocked(svc.listMembers).mockResolvedValue({
      outcome: 'ok',
      items: [
        member({ memberId: 'm1', userId: 'u1', displayName: 'Ana', state: 'awaiting_confirmation', confirmed: false }),
        member({ memberId: 'm2', userId: 'u2', displayName: 'Beto', state: 'active', acceptedEmail: 'beto@x.com' }),
        member({ memberId: 'm3', userId: null, displayName: 'Caio', state: 'invite_expired', status: 'invited' }),
      ],
    });
    vi.mocked(svc.confirmMember).mockResolvedValue({ outcome: 'confirmed' });
    renderPage();
    expect(await screen.findByText('Ana entrou. É a pessoa certa?')).toBeInTheDocument();
    expect(screen.getByText('ana@x.com')).toBeInTheDocument();
    expect(screen.getByText('Beto')).toBeInTheDocument();
    expect(screen.getByText('Venceu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gerar novo link/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Confirmar$/ }));
    await waitFor(() => expect(svc.confirmMember).toHaveBeenCalledWith('c1', 'u1'));
  });

  it('"Não é ele" corta o acesso (reject)', async () => {
    vi.mocked(svc.listMembers).mockResolvedValue({
      outcome: 'ok',
      items: [member({ state: 'awaiting_confirmation', confirmed: false })],
    });
    vi.mocked(svc.rejectMember).mockResolvedValue({ outcome: 'rejected' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Não é essa pessoa/ }));
    // Passo de confirmação: nada é cortado antes de confirmar.
    expect(svc.rejectMember).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: /Cortar acesso/ }));
    await waitFor(() => expect(svc.rejectMember).toHaveBeenCalledWith('c1', 'u1'));
  });

  it('convidar: gera o link e abre o wa.me com telefone normalizado (DDI 55, só dígitos)', async () => {
    vi.mocked(svc.inviteMember).mockResolvedValue({ outcome: 'invited', inviteToken: 'tok123' });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Convidar alguém da equipe/ }));
    fireEvent.change(screen.getByLabelText(/Nome da pessoa/), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText(/WhatsApp da pessoa/), { target: { value: '(11) 91234-5678' } });
    fireEvent.click(screen.getByRole('button', { name: /Gerar convite/ }));

    expect(await screen.findByTestId('invite-link')).toHaveTextContent('/convite-equipe/tok123');
    expect(svc.inviteMember).toHaveBeenCalledWith('c1', 'Ana', 'encarregado');

    fireEvent.click(screen.getByRole('button', { name: /Enviar no WhatsApp/ }));
    const url = open.mock.calls[0][0] as string;
    expect(url).toMatch(/^https:\/\/wa\.me\/5511912345678\?text=/);
    expect(decodeURIComponent(url)).toContain('Divino Fogão te convidou para o Worki como Encarregado');
    open.mockRestore();
  });

  it('convidar sem telefone abre wa.me sem número (link não exige e-mail)', async () => {
    vi.mocked(svc.inviteMember).mockResolvedValue({ outcome: 'invited', inviteToken: 'tok123' });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Convidar alguém da equipe/ }));
    fireEvent.change(screen.getByLabelText(/Nome da pessoa/), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('button', { name: /Gerar convite/ }));
    await screen.findByTestId('invite-link');
    fireEvent.click(screen.getByRole('button', { name: /Enviar no WhatsApp/ }));
    expect(open.mock.calls[0][0] as string).toMatch(/^https:\/\/wa\.me\/\?text=/);
    open.mockRestore();
  });

  it('remover: faz dry-run, informa os turnos abertos e só então remove (nunca bloqueia)', async () => {
    vi.mocked(svc.listMembers).mockResolvedValue({ outcome: 'ok', items: [member()] });
    vi.mocked(svc.removeMember)
      .mockResolvedValueOnce({ outcome: 'would_remove', openJobs: 3, elencoLinkRotationAdvised: true, alreadyRemoved: false })
      .mockResolvedValueOnce({ outcome: 'removed', openJobs: 3, elencoLinkRotationAdvised: true, alreadyRemoved: false });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Remover da equipe/ }));

    expect(await screen.findByText(/3 turnos abertos no nome dessa pessoa ficarão com você/)).toBeInTheDocument();
    expect(svc.removeMember).toHaveBeenNthCalledWith(1, 'c1', 'u1', true);

    fireEvent.click(screen.getByRole('button', { name: /Remover agora/ }));
    await waitFor(() => expect(svc.removeMember).toHaveBeenNthCalledWith(2, 'c1', 'u1', false));
  });

  it('reenviar convite vencido mostra o NOVO link', async () => {
    vi.mocked(svc.listMembers).mockResolvedValue({
      outcome: 'ok',
      items: [member({ memberId: 'm3', userId: null, displayName: 'Caio', state: 'invite_expired', status: 'invited' })],
    });
    vi.mocked(svc.resendInvite).mockResolvedValue({ outcome: 'resent', inviteToken: 'novo-token' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Gerar novo link/ }));
    expect(await screen.findByTestId('invite-link')).toHaveTextContent('/convite-equipe/novo-token');
  });

  it('modal de convite fecha com Escape e devolve o foco ao botão que abriu', async () => {
    renderPage();
    const abrir = await screen.findByRole('button', { name: /Convidar alguém da equipe/ });
    abrir.focus();
    fireEvent.click(abrir);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/Nome da pessoa/)).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(abrir).toHaveFocus();
  });

  it('"Tentar de novo" após falha ao resolver a empresa recarrega tudo (não fica em silêncio)', async () => {
    vi.mocked(getMyCompanies).mockRejectedValueOnce(new Error('rede'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    expect(await screen.findByText('Ninguém na equipe ainda')).toBeInTheDocument();
    expect(getMyCompanies).toHaveBeenCalledTimes(2);
  });

  it('mensagem própria quando outro Gestor já resolveu (not_pending_confirmation)', async () => {
    vi.mocked(svc.listMembers).mockResolvedValue({
      outcome: 'ok',
      items: [member({ state: 'awaiting_confirmation', confirmed: false })],
    });
    vi.mocked(svc.rejectMember).mockResolvedValue({ outcome: 'not_pending_confirmation' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Não é essa pessoa/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Cortar acesso/ }));
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith(expect.stringMatching(/Outro Gestor já resolveu/), 'error'));
  });

  it('revogar convite pendente chama a RPC', async () => {
    vi.mocked(svc.listMembers).mockResolvedValue({
      outcome: 'ok',
      items: [member({ memberId: 'm3', userId: null, displayName: 'Caio', state: 'invited', status: 'invited' })],
    });
    vi.mocked(svc.revokeInvite).mockResolvedValue({ outcome: 'revoked' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Revogar convite/ }));
    await waitFor(() => expect(svc.revokeInvite).toHaveBeenCalledWith('m3'));
  });
});
