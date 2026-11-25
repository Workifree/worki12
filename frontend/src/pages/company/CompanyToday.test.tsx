import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CompanyToday from './CompanyToday';
import type { MyCompany, TeamMemberItem } from '../../types';
import type { TodayJob } from '../../services/shiftOperationService';

const mockAddToast = vi.fn();
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }),
}));
vi.mock('../../lib/logger', () => ({ logError: vi.fn() }));
vi.mock('../../components/PageMeta', () => ({ default: () => null }));
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'me' } } }), onAuthStateChange: vi.fn() } },
}));
let mockToday = '2026-11-23';
vi.mock('../../lib/dateUtils', async () => {
  const actual = await vi.importActual<typeof import('../../lib/dateUtils')>('../../lib/dateUtils');
  return { ...actual, todayInBrazil: () => mockToday, todayLocalDate: () => mockToday };
});

vi.mock('../../services/companyScopeService', async () => {
  const actual = await vi.importActual<typeof import('../../services/companyScopeService')>('../../services/companyScopeService');
  return { ...actual, getMyCompanies: vi.fn() };
});
vi.mock('../../services/teamMembersService', async () => {
  const actual = await vi.importActual<typeof import('../../services/teamMembersService')>('../../services/teamMembersService');
  return { ...actual, listMembers: vi.fn() };
});
vi.mock('../../services/shiftOperationService', async () => {
  const actual = await vi.importActual<typeof import('../../services/shiftOperationService')>('../../services/shiftOperationService');
  return {
    ...actual,
    listJobsByResponsible: vi.fn(),
    listOwnJobs: vi.fn(),
    listTagsChecked: vi.fn(),
    listActiveCoveragesChecked: vi.fn(),
    listCompanyOperators: vi.fn(),
    endCoverage: vi.fn(),
    cancelJob: vi.fn(),
    isCancelJobAvailable: vi.fn(),
    reassignJobs: vi.fn(),
  };
});

import { getMyCompanies } from '../../services/companyScopeService';
import { listMembers } from '../../services/teamMembersService';
import * as ops from '../../services/shiftOperationService';

function company(overrides: Partial<MyCompany> = {}): MyCompany {
  return {
    company_id: 'c1', company_name: 'Divino Fogão', role: 'owner', organization_id: 'o1',
    organization_name: null, onboarding_completed: true, accepted_tos: true, team_enabled: true, ...overrides,
  };
}

function member(overrides: Partial<TeamMemberItem> = {}): TeamMemberItem {
  return {
    memberId: 'm1', userId: 'u1', displayName: 'Ana', role: 'encarregado', status: 'active',
    state: 'active', confirmed: true, acceptedEmail: null, invitedAt: null, expiresAt: null,
    acceptedAt: null, confirmedAt: null, removedAt: null, ...overrides,
  };
}

function job(overrides: Partial<TodayJob> = {}): TodayJob {
  return {
    jobId: 'j1', title: 'Garçom de salão', status: 'open', date: '2026-11-23', startTime: '18:00', slots: 2, filled: 1,
    responsibleId: 'u1', responsibleKind: 'person', responsibleLabel: 'Ana', creatorLabel: null,
    tagId: 't1', tagName: 'Salão', tagArchived: false, ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/company/hoje']}>
      <Routes>
        <Route path="/company/hoje" element={<CompanyToday />} />
        <Route path="/company/jobs/:id/candidates" element={<div data-testid="candidatos">Candidatos</div>} />
        <Route path="/company/create" element={<div data-testid="criar">Criar</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockToday = '2026-11-23';
  vi.mocked(getMyCompanies).mockResolvedValue([company()]);
  vi.mocked(listMembers).mockResolvedValue({ outcome: 'ok', items: [member(), member({ memberId: 'm2', userId: 'u2', displayName: 'Beto' })] });
  vi.mocked(ops.listTagsChecked).mockResolvedValue({ ok: true, items: [{ id: 't1', name: 'Salão', archivedAt: null }] });
  vi.mocked(ops.isCancelJobAvailable).mockResolvedValue(true);
  vi.mocked(ops.listActiveCoveragesChecked).mockResolvedValue({ ok: true, items: [] });
  vi.mocked(ops.listCompanyOperators).mockResolvedValue({
    ok: true,
    items: [
      { userId: 'me', label: 'Eu mesmo', role: 'gestor' },
      { userId: 'u1', label: 'Ana', role: 'encarregado' },
      { userId: 'u2', label: 'Beto', role: 'encarregado' },
    ],
  });
  vi.mocked(ops.listJobsByResponsible).mockResolvedValue({ outcome: 'ok', truncated: false, items: [job()] });
  vi.mocked(ops.listOwnJobs).mockResolvedValue({ outcome: 'ok', items: [] });
});

describe('CompanyToday — Gestor', () => {
  it('lista os turnos por dia com "Responsável: nome · etiqueta"', async () => {
    renderPage();
    expect(await screen.findByText('Garçom de salão')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Hoje' })).toBeInTheDocument();
    expect(screen.getByText('Responsável: Ana · Salão')).toBeInTheDocument();
    expect(ops.listJobsByResponsible).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'c1', from: '2026-11-23', to: '2026-12-06', responsibleId: null, tagId: null }),
    );
  });

  it('filtra por pessoa e por etiqueta com chips e refaz a consulta no banco', async () => {
    renderPage();
    await screen.findByText('Garçom de salão');

    fireEvent.click(await screen.findByRole('button', { name: 'Beto' }));
    await waitFor(() =>
      expect(ops.listJobsByResponsible).toHaveBeenLastCalledWith(expect.objectContaining({ responsibleId: 'u2' })),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Salão' }));
    await waitFor(() =>
      expect(ops.listJobsByResponsible).toHaveBeenLastCalledWith(expect.objectContaining({ responsibleId: 'u2', tagId: 't1' })),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
    await waitFor(() =>
      expect(ops.listJobsByResponsible).toHaveBeenLastCalledWith(expect.objectContaining({ responsibleId: null, tagId: null })),
    );
  });

  it('estado vazio útil leva a criar turno', async () => {
    vi.mocked(ops.listJobsByResponsible).mockResolvedValue({ outcome: 'ok', truncated: false, items: [] });
    renderPage();
    expect(await screen.findByText(/Nenhum turno nos próximos 14 dias/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Criar turno/ }));
    expect(await screen.findByTestId('criar')).toBeInTheDocument();
  });

  it('"Passar para..." lista as pessoas, avisa da notificação e chama a RPC', async () => {
    vi.mocked(ops.reassignJobs).mockResolvedValue({ outcome: 'ok', moved: 1, skipped: 0 });
    renderPage();
    await screen.findByText('Garçom de salão');

    fireEvent.click(screen.getByRole('button', { name: 'Passar para...' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Beto' }));
    expect(within(dialog).getByText(/será notificada/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /Passar o turno/ }));

    await waitFor(() => expect(ops.reassignJobs).toHaveBeenCalledWith(['j1'], 'u2'));
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('1 turno foi passado.', 'success'));
  });

  it('"Cobrir alguém" só aparece com 2 ou mais encarregados', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /Cobrir alguém/ })).toBeInTheDocument();
  });

  it('Gestor pode passar "para mim"', async () => {
    renderPage();
    await screen.findByText('Garçom de salão');
    fireEvent.click(screen.getByRole('button', { name: 'Passar para...' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Ana' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Para mim' })).toBeInTheDocument();
  });

  it('nomes repetidos ganham numeração', async () => {
    vi.mocked(ops.listCompanyOperators).mockResolvedValue({
      ok: true,
      items: [
        { userId: 'u1', label: 'Ana', role: 'encarregado' },
        { userId: 'u3', label: 'Ana', role: 'encarregado' },
      ],
    });
    renderPage();
    await screen.findByText('Garçom de salão');
    fireEvent.click(screen.getByRole('button', { name: 'Passar para...' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Ana (1)' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Ana (2)' })).toBeInTheDocument();
  });

  it('trocar o filtro limpa a seleção e mostra o esqueleto; "Limpar seleção" desmarca', async () => {
    renderPage();
    await screen.findByText('Garçom de salão');
    fireEvent.click(screen.getByRole('checkbox', { name: /Selecionar Garçom de salão/ }));
    expect(screen.getByRole('button', { name: 'Limpar seleção' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar seleção' }));
    expect(screen.queryByRole('button', { name: 'Limpar seleção' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /Selecionar Garçom de salão/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salão' }));
    expect(screen.queryByRole('button', { name: 'Limpar seleção' })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Carregando os turnos' })).toBeInTheDocument();
    expect(await screen.findByText('Garçom de salão')).toBeInTheDocument();
  });

  it('Gestor tem caminho de volta ao painel', async () => {
    renderPage();
    await screen.findByText('Garçom de salão');
    expect(screen.getByRole('link', { name: 'Visão geral' })).toHaveAttribute('href', '/company/dashboard');
    expect(screen.getByRole('link', { name: 'Hoje' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: /Ver o painel da empresa/ })).not.toBeInTheDocument();
  });

  it('erro da lista de operadores mostra aviso claro e esconde Passar/Cobrir sem quebrar a tela', async () => {
    vi.mocked(ops.listCompanyOperators).mockResolvedValue({ ok: false, items: [] });
    renderPage();
    expect(await screen.findByText('Garçom de salão')).toBeInTheDocument();
    expect(await screen.findByText(/Não foi possível carregar quem pode receber turnos/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Passar para...' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cobrir/ })).not.toBeInTheDocument();
  });

  it('D-8: sem a RPC cancel_job no ambiente, não mostra um botão que sempre falharia', async () => {
    vi.mocked(ops.isCancelJobAvailable).mockResolvedValue(false);
    renderPage();
    await screen.findByText('Garçom de salão');
    await screen.findByRole('button', { name: 'Passar para...' });
    expect(screen.queryByRole('button', { name: 'Cancelar turno' })).not.toBeInTheDocument();
  });

  it('cancelar turno recusado por pagamento ativo mostra o motivo e não fecha a lista', async () => {
    vi.mocked(ops.cancelJob).mockResolvedValue({ outcome: 'active_payment', cancelledApplications: 0, cancelledCalls: 0, closedCandidates: 0 });
    renderPage();
    await screen.findByText('Garçom de salão');

    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar turno' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar o turno' }));

    expect(await within(dialog).findByText(/pagamento agendado ou registrado/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Nada foi alterado/)).toBeInTheDocument();
    expect(ops.listJobsByResponsible).toHaveBeenCalledTimes(1);
  });

  it('cancelar com sucesso avisa e recarrega a lista', async () => {
    vi.mocked(ops.cancelJob).mockResolvedValue({ outcome: 'cancelled', cancelledApplications: 1, cancelledCalls: 0, closedCandidates: 0 });
    renderPage();
    await screen.findByText('Garçom de salão');

    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar turno' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar o turno' }));

    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('Turno cancelado. 1 pessoa foi avisada.', 'success'));
    await waitFor(() => expect(ops.listJobsByResponsible).toHaveBeenCalledTimes(2));
  });

  it('erro ao carregar oferece tentar de novo', async () => {
    vi.mocked(ops.listJobsByResponsible).mockResolvedValueOnce({ outcome: 'error', truncated: false, items: [] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Garçom de salão')).toBeInTheDocument();
  });
});

describe('CompanyToday — divulgação progressiva (dono único)', () => {
  it('sem equipe: nada de filtros de pessoa, "Passar para", "Cobrir" nem linha de responsável', async () => {
    vi.mocked(getMyCompanies).mockResolvedValue([company({ team_enabled: false })]);
    vi.mocked(ops.listTagsChecked).mockResolvedValue({ ok: true, items: [] });
    renderPage();
    await screen.findByText('Garçom de salão');

    expect(screen.queryByRole('button', { name: 'Passar para...' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cobrir/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Todos' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Responsável:/)).not.toBeInTheDocument();
    expect(listMembers).not.toHaveBeenCalled();
    // D-8: dono único não ganha "Cancelar turno" (R23)
    expect(screen.queryByRole('button', { name: 'Cancelar turno' })).not.toBeInTheDocument();
  });
});

describe('CompanyToday — encarregado', () => {
  beforeEach(() => {
    vi.mocked(getMyCompanies).mockResolvedValue([company({ role: 'encarregado', confirmed: true, team_enabled: true })]);
    vi.mocked(ops.listOwnJobs).mockResolvedValue({
      outcome: 'ok',
      items: [
        job({ jobId: 'own', date: '2099-01-01', title: 'Turno meu', responsibleKind: 'self', responsibleLabel: 'Você', filled: null }),
        job({ jobId: 'cov', date: '2099-01-01', title: 'Turno coberto', responsibleKind: 'covering', responsibleLabel: 'Você cobre um colega', filled: null }),
      ],
    });
  });

  it('usa só a consulta dos próprios turnos (nunca a do Gestor) e não lista pessoas', async () => {
    renderPage();
    expect(await screen.findByText('Turno meu')).toBeInTheDocument();
    expect(screen.getByText('Turno coberto')).toBeInTheDocument();
    expect(ops.listJobsByResponsible).not.toHaveBeenCalled();
    expect(listMembers).not.toHaveBeenCalled();
    expect(ops.listOwnJobs).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'c1', userId: 'me' }));
    expect(screen.getByText('Responsável: Você · Salão')).toBeInTheDocument();
  });

  it('cancela os próprios e os cobertos, sem filtro de pessoa', async () => {
    renderPage();
    await screen.findByText('Turno meu');
    expect(await screen.findAllByRole('button', { name: 'Cancelar turno' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Todos' })).toBeInTheDocument(); // há etiqueta: filtro de etiqueta
    expect(screen.queryByRole('button', { name: 'Ana' })).not.toBeInTheDocument();
  });

  it('vê "Passar para..." só nos próprios turnos e "Cobrir meus turnos", com a lista de operadores (sem listar a equipe)', async () => {
    renderPage();
    await screen.findByText('Turno meu');
    expect(screen.getAllByRole('button', { name: 'Passar para...' })).toHaveLength(1);
    expect(ops.listCompanyOperators).toHaveBeenCalledWith('c1');
    expect(listMembers).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cobrir meus turnos' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('group', { name: 'Quem será coberto' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Ana' })).toBeInTheDocument();
  });

  it('abrir o turno leva aos candidatos', async () => {
    renderPage();
    await screen.findByText('Turno meu');
    fireEvent.click(screen.getAllByRole('button', { name: 'Abrir turno' })[0]);
    expect(await screen.findByTestId('candidatos')).toBeInTheDocument();
  });
});

describe('CompanyToday — virada do dia', () => {
  it('após a meia-noite de São Paulo recalcula "hoje" e refaz a consulta com a janela nova', async () => {
    renderPage();
    await screen.findByText('Garçom de salão');
    expect(ops.listJobsByResponsible).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-11-23' }));

    // a aba passou a noite aberta: o relógio vira o dia e a aba volta ao foco
    mockToday = '2026-11-24';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() =>
      expect(ops.listJobsByResponsible).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-11-24', to: '2026-12-07' })),
    );
  });

  it('o timer da meia-noite também atualiza o dia (fake timers)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-23T23:59:30-03:00'));
      renderPage();
      await vi.waitFor(() => expect(ops.listJobsByResponsible).toHaveBeenCalled());

      mockToday = '2026-11-24';
      await vi.advanceTimersByTimeAsync(40_000);

      await vi.waitFor(() =>
        expect(ops.listJobsByResponsible).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-11-24' })),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
