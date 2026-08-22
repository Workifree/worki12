import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CompanyBadges from './CompanyBadges';
import type { CompanyBadge } from '../types';

// ---------------------------------------------------------------------------
// F12 — "Já trabalhou com". Cobertura mínima exigida pelo evaluator (ver
// `.harness/spec/badges-empresas/ddl-aprovado.md` §5 e ADR-20260821):
//
//  - `avg_rating: null` (empresa nunca avaliou) NUNCA vira "0 estrelas" — precisa aparecer
//    como "Sem avaliação", distinto de nota baixa. Este é o bug real que escapou de 630
//    testes: um mock que fabricasse `avg_rating: 0` teria escondido a regressão.
//  - Ocultar um badge (mode='manage') chama `setBadgeVisibility(companyId, true)` e reflete
//    `hidden: true` na tela.
//  - Reexibir um badge oculto (mode='manage') chama `setBadgeVisibility(companyId, false)` —
//    a spec original tornava isso impossível (a RPC filtrava hidden inclusive para o dono);
//    esta é a asserção que pega essa regressão se alguém reintroduzir o filtro errado.
//  - `setBadgeVisibility` devolvendo `false` (recusa da RPC, não erro) NÃO deve fazer a UI
//    marcar o badge como oculto/reexibido — sem rollback otimista mentiroso.
//  - `mode='view'` nunca mostra o botão de olho (controle é só do dono).
//  - Ordem do array recebido do service é preservada — o componente nunca reordena por nota.
// ---------------------------------------------------------------------------

const mockAddToast = vi.fn();
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }),
}));

const mockGetCompanyBadges = vi.fn();
const mockSetBadgeVisibility = vi.fn();
const mockSetBadgesHiddenGlobal = vi.fn();
vi.mock('../services/badgeService', () => ({
  BadgeService: {
    getCompanyBadges: (...args: unknown[]) => mockGetCompanyBadges(...args),
    setBadgeVisibility: (...args: unknown[]) => mockSetBadgeVisibility(...args),
    setBadgesHiddenGlobal: (...args: unknown[]) => mockSetBadgesHiddenGlobal(...args),
  },
}));

const mockMaybeSingle = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: (...args: unknown[]) => mockMaybeSingle(...args),
    })),
  },
}));

vi.mock('../lib/logger', () => ({ logError: vi.fn() }));

function buildBadge(overrides: Partial<CompanyBadge> = {}): CompanyBadge {
  return {
    company_id: 'company-1',
    company_name: 'Divino Fogão',
    company_logo_url: null,
    shifts_count: 3,
    last_shift_at: '2026-08-10T12:00:00.000Z',
    avg_rating: 4.5,
    reviews_count: 2,
    hidden: false,
    ...overrides,
  };
}

function renderComponent(mode: 'view' | 'manage', workerId = 'worker-1') {
  return render(
    <MemoryRouter>
      <CompanyBadges workerId={workerId} mode={mode} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMaybeSingle.mockResolvedValue({ data: { badges_hidden: false }, error: null });
});

describe('CompanyBadges', () => {
  it('renderiza "Sem avaliação" quando avg_rating é null, nunca 0 estrelas', async () => {
    mockGetCompanyBadges.mockResolvedValue({
      badges: [buildBadge({ avg_rating: null, reviews_count: 0 })],
      failed: false,
    });

    renderComponent('view');

    await waitFor(() => expect(screen.getByText('Divino Fogão')).toBeInTheDocument());

    expect(screen.getByText('Sem avaliação')).toBeInTheDocument();
    // Não deve haver nenhuma nota numérica renderizada para este badge (nada como "0.0" ou "4.5").
    expect(screen.queryByText(/^\d\.\d/)).not.toBeInTheDocument();
  });

  it('renderiza a nota numérica quando avg_rating existe', async () => {
    mockGetCompanyBadges.mockResolvedValue({
      badges: [buildBadge({ avg_rating: 4.5, reviews_count: 2 })],
      failed: false,
    });

    renderComponent('view');

    await waitFor(() => expect(screen.getByText('4.5')).toBeInTheDocument());
    expect(screen.queryByText('Sem avaliação')).not.toBeInTheDocument();
  });

  it('mode="manage": esconder um badge chama setBadgeVisibility(id, true) e atualiza a UI', async () => {
    mockGetCompanyBadges.mockResolvedValue({
      badges: [buildBadge({ hidden: false })],
      failed: false,
    });
    mockSetBadgeVisibility.mockResolvedValue(true);

    renderComponent('manage');

    await waitFor(() => expect(screen.getByText('Divino Fogão')).toBeInTheDocument());

    const hideButton = screen.getByLabelText('Ocultar selo de Divino Fogão');
    fireEvent.click(hideButton);

    await waitFor(() => expect(mockSetBadgeVisibility).toHaveBeenCalledWith('company-1', true));
    await waitFor(() => expect(screen.getByText('Oculto')).toBeInTheDocument());
  });

  it('mode="manage": reexibir um badge JÁ oculto chama setBadgeVisibility(id, false) e some o rótulo "Oculto"', async () => {
    mockGetCompanyBadges.mockResolvedValue({
      badges: [buildBadge({ hidden: true })],
      failed: false,
    });
    mockSetBadgeVisibility.mockResolvedValue(true);

    renderComponent('manage');

    await waitFor(() => expect(screen.getByText('Divino Fogão')).toBeInTheDocument());
    expect(screen.getByText('Oculto')).toBeInTheDocument();

    const showButton = screen.getByLabelText('Reexibir selo de Divino Fogão');
    fireEvent.click(showButton);

    await waitFor(() => expect(mockSetBadgeVisibility).toHaveBeenCalledWith('company-1', false));
    await waitFor(() => expect(screen.queryByText('Oculto')).not.toBeInTheDocument());
  });

  it('setBadgeVisibility devolvendo false (recusa) NÃO altera o estado local nem mostra sucesso', async () => {
    mockGetCompanyBadges.mockResolvedValue({
      badges: [buildBadge({ hidden: false })],
      failed: false,
    });
    mockSetBadgeVisibility.mockResolvedValue(false);

    renderComponent('manage');

    await waitFor(() => expect(screen.getByText('Divino Fogão')).toBeInTheDocument());

    const hideButton = screen.getByLabelText('Ocultar selo de Divino Fogão');
    fireEvent.click(hideButton);

    await waitFor(() => expect(mockSetBadgeVisibility).toHaveBeenCalled());

    // Continua sem o rótulo "Oculto" — a recusa não deve ser tratada como sucesso.
    expect(screen.queryByText('Oculto')).not.toBeInTheDocument();
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringMatching(/não foi possível/i), 'error');
  });

  it('mode="view" nunca mostra o botão de ocultar/reexibir', async () => {
    mockGetCompanyBadges.mockResolvedValue({
      badges: [buildBadge()],
      failed: false,
    });

    renderComponent('view');

    await waitFor(() => expect(screen.getByText('Divino Fogão')).toBeInTheDocument());
    expect(screen.queryByLabelText(/ocultar selo/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/reexibir selo/i)).not.toBeInTheDocument();
  });

  it('preserva a ordem recebida do service (nunca reordena por nota)', async () => {
    mockGetCompanyBadges.mockResolvedValue({
      badges: [
        buildBadge({ company_id: 'c-low', company_name: 'Nota Baixa Ltda', avg_rating: 2.0, reviews_count: 1 }),
        buildBadge({ company_id: 'c-high', company_name: 'Nota Alta Ltda', avg_rating: 5.0, reviews_count: 10 }),
      ],
      failed: false,
    });

    renderComponent('view');

    await waitFor(() => expect(screen.getByText('Nota Baixa Ltda')).toBeInTheDocument());

    const names = screen.getAllByText(/Ltda/).map((el) => el.textContent);
    expect(names).toEqual(['Nota Baixa Ltda', 'Nota Alta Ltda']);
  });

  it('mode="view" sem badges (lista vazia) não renderiza a seção', async () => {
    mockGetCompanyBadges.mockResolvedValue({ badges: [], failed: false });

    const { container } = renderComponent('view');

    await waitFor(() => expect(mockGetCompanyBadges).toHaveBeenCalled());
    expect(container.querySelector('h3')).not.toBeInTheDocument();
  });

  it('mode="manage" com falha de leitura mostra mensagem de erro, não lista vazia', async () => {
    mockGetCompanyBadges.mockResolvedValue({ badges: [], failed: true });

    renderComponent('manage');

    await waitFor(() =>
      expect(screen.getByText(/não foi possível carregar os selos/i)).toBeInTheDocument()
    );
  });

  it('switch da chave-mestra chama setBadgesHiddenGlobal com o valor invertido', async () => {
    mockGetCompanyBadges.mockResolvedValue({ badges: [buildBadge()], failed: false });
    mockSetBadgesHiddenGlobal.mockResolvedValue(true);

    renderComponent('manage');

    await waitFor(() => expect(screen.getByText('Divino Fogão')).toBeInTheDocument());

    const toggle = screen.getByLabelText('Não exibir onde já trabalhei para outras empresas');
    fireEvent.click(toggle);

    await waitFor(() => expect(mockSetBadgesHiddenGlobal).toHaveBeenCalledWith('worker-1', true));
  });

  // -------------------------------------------------------------------------------------------
  // DS11 (.harness/spec/badges-empresas/ddl-aprovado.md §2.1) — destino do clique no selo.
  //
  // NOTA sobre "mock de permissão" (patterns.md: mock de dado é permitido, mock de permissão
  // exige justificativa): estes testes montam `<MemoryRouter>` SEM `<ProtectedRoute>`, o que é
  // exatamente o ambiente que fabricou o bug original (produção nega `/empresa/:id` para
  // `user_type='hire'` via ProtectedRoute.workerOnlyPaths; o teste antigo nunca passava por lá,
  // então nunca pegava a rejeição). A justificativa aqui: o objeto sob teste é CompanyBadges
  // (que rota ele CHAMA), não o ProtectedRoute (que decide se a rota é permitida) — testar os
  // dois juntos exigiria montar a árvore de auth inteira só para uma asserção de destino. Para
  // não reintroduzir o mesmo furo, o caso `mode='view'` planta uma armadilha: monta também a
  // rota real `/empresa/:id` (o destino worker-only que produção rejeitaria) e falha o teste se
  // ela for alcançada — só a rota-espelho `/company/empresa/:id` pode ser atingida.
  // -------------------------------------------------------------------------------------------
  it('mode="manage": clique no selo navega para /empresa/:id (destino inalterado)', async () => {
    mockGetCompanyBadges.mockResolvedValue({ badges: [buildBadge()], failed: false });

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<CompanyBadges workerId="worker-1" mode="manage" />} />
          <Route path="/empresa/:id" element={<div>Perfil público (worker-only)</div>} />
          <Route
            path="/company/empresa/:id"
            element={
              <div>
                Rota-espelho alcançada indevidamente — mode=&quot;manage&quot; NUNCA deve ir para
                /company/empresa/:id
              </div>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Divino Fogão')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Divino Fogão'));

    await waitFor(() => expect(screen.getByText('Perfil público (worker-only)')).toBeInTheDocument());
    expect(screen.queryByText(/Rota-espelho alcançada indevidamente/)).not.toBeInTheDocument();
  });

  it('mode="view": clique no selo navega para /company/empresa/:id (rota-espelho), NUNCA para /empresa/:id', async () => {
    mockGetCompanyBadges.mockResolvedValue({ badges: [buildBadge()], failed: false });

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<CompanyBadges workerId="worker-1" mode="view" />} />
          {/* Armadilha: em produção esta rota é worker-only (ProtectedRoute.workerOnlyPaths) e
              rejeitaria qualquer 'hire' que a alcançasse. mode='view' só monta para 'hire'
              (WorkerPublicProfile.tsx, sob CompanyLayout) — se o clique aterrissar aqui, o bug
              original (toast de permissão + redirect) voltou. */}
          <Route
            path="/empresa/:id"
            element={<div>REGRESSÃO: caiu na rota worker-only /empresa/:id</div>}
          />
          <Route path="/company/empresa/:id" element={<div>Rota-espelho (CompanyPublicProfile)</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Divino Fogão')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Divino Fogão'));

    await waitFor(() => expect(screen.getByText('Rota-espelho (CompanyPublicProfile)')).toBeInTheDocument());
    expect(screen.queryByText(/REGRESSÃO/)).not.toBeInTheDocument();
  });
});
