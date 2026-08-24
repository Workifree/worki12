import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CompanyOperationAnalytics from './CompanyOperationAnalytics';
import type { OperationAnalytics } from '../../types';

// ---------------------------------------------------------------------------
// F9 (Analytics de operação) — a página é uma camada fina sobre
// `OperationAnalyticsService.getOperationAnalytics()`: toda a lógica de agregação já é testada
// em `operationAnalyticsService.test.ts` (não repetir a contagem aqui — número em comentário
// envelhece sozinho a cada teste novo). O que ESTES testes precisam provar é o contrato de UI que o
// PRD eleva a requisito de arquitetura (D6/R18): os quatro estados de bloco NUNCA podem se
// confundir, o rótulo de truncamento nunca pode ficar em silêncio, e a tabela por freela nunca
// pode virar ranking (Article/D4 — proibido reordenar por métrica).
// ---------------------------------------------------------------------------

const mockGetOperationAnalytics = vi.fn();
vi.mock('../../services/operationAnalyticsService', () => ({
  OperationAnalyticsService: {
    getOperationAnalytics: (...args: unknown[]) => mockGetOperationAnalytics(...args),
  },
  // A página importa `emptyAnalytics` do mesmo módulo (fallback do catch em `fetchAnalytics`).
  // Sem este export no mock, o teste falha com "No 'emptyAnalytics' export is defined on the
  // mock" — não é um erro de outra coisa quebrando, é este mock ficar incompleto.
  emptyAnalytics: (hasError = false) => ({
    scopeCompanyIds: [],
    truncated: false,
    hasError,
    spend: { state: 'sem-fonte' },
    hires: { state: 'sem-fonte' },
    costPerHour: { state: 'sem-fonte' },
    hoursRatio: { state: 'sem-fonte' },
    fillTime: { state: 'sem-fonte' },
    callsByStatus: { state: 'sem-fonte' },
    callsByReason: { state: 'sem-fonte' },
    acceptanceByWorker: { state: 'sem-fonte' },
    attendanceByWorker: { state: 'sem-fonte' },
    performanceByWorker: { state: 'sem-fonte' },
    attendanceConfirmations: { state: 'sem-fonte' },
  }),
}));

vi.mock('../../lib/logger', () => ({ logError: vi.fn() }));

/** Base "tudo vazio" (sem-fonte em todo bloco) — cada teste sobrescreve só o bloco que testa. */
function buildAnalytics(overrides: Partial<OperationAnalytics> = {}): OperationAnalytics {
  return {
    scopeCompanyIds: ['company-1'],
    truncated: false,
    // Obrigatorio: erro de leitura NAO pode degradar para "nao ha dado"
    // (C-ANALYTICS-ERRO-VIRA-VAZIO). O único teste de erro passa `hasError: true` via override,
    // em 'CompanyOperationAnalytics — banner de erro (C-ANALYTICS-ERRO-VIRA-VAZIO)', abaixo.
    hasError: false,
    spend: { state: 'sem-fonte' },
    hires: { state: 'sem-fonte' },
    costPerHour: { state: 'sem-fonte' },
    hoursRatio: { state: 'sem-fonte' },
    fillTime: { state: 'sem-fonte' },
    callsByStatus: { state: 'sem-fonte' },
    callsByReason: { state: 'sem-fonte' },
    acceptanceByWorker: { state: 'sem-fonte' },
    attendanceByWorker: { state: 'sem-fonte' },
    performanceByWorker: { state: 'sem-fonte' },
    attendanceConfirmations: { state: 'sem-fonte' },
    ...overrides,
  };
}

beforeEach(() => {
  mockGetOperationAnalytics.mockReset();
});

// Escopo de unidade (F13): os servicos passaram a resolver a empresa OPERADA pelo seam, em vez
// de `.eq('owner_id', user.id)`. O duble evita bater na RPC get_my_companies nos testes.
vi.mock('../../services/companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
  getMyCompanies: vi.fn().mockResolvedValue([{ company_id: 'company-1' }]),
}))

describe('CompanyOperationAnalytics — estados de bloco (D6/R18)', () => {
  it('sem-fonte: NUNCA mostra "0"/"R$ 0,00" — mostra mensagem acionável', async () => {
    mockGetOperationAnalytics.mockResolvedValue(
      buildAnalytics({
        spend: { state: 'sem-fonte' },
        fillTime: { state: 'sem-fonte' },
      }),
    );
    render(<CompanyOperationAnalytics />);

    await waitFor(() => expect(screen.getByText(/Nenhum pagamento registrado neste período/i)).toBeInTheDocument());
    // Nenhum "R$ 0,00" deve aparecer na tela inteira quando a fonte está vazia.
    expect(screen.queryByText(/R\$\s?0,00/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Nenhum chamado de turno disparado neste período/i).length).toBeGreaterThan(0);
  });

  it('zero-real: turno com 12 concluídos e 0 no-shows mostra "0" com contexto, não estado vazio', async () => {
    mockGetOperationAnalytics.mockResolvedValue(
      buildAnalytics({
        attendanceByWorker: {
          state: 'ok',
          rows: [
            {
              workerId: 'w1',
              workerName: 'Ana Souza',
              companyId: 'company-1',
              noShowCount: 0,
              noShowExcludedNoScheduleCount: 0,
              cancelledCount: 0,
              punctualCount: 12,
              lateCount: 0,
              checkinsWithScheduleCount: 12,
              punctualityRate: 1,
            },
          ],
        },
      }),
    );
    render(<CompanyOperationAnalytics />);

    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument());
    // A linha da tabela deve exibir 0 como resultado real (zero-real), não a mensagem de vazio.
    expect(screen.queryByText(/Nenhum turno contratado\/cancelado neste período/i)).not.toBeInTheDocument();
    const row = screen.getByText('Ana Souza').closest('tr');
    expect(row).not.toBeNull();
    expect(row!.textContent).toMatch(/0/); // no-show = 0, exibido na linha
  });

  it('amostra-insuficiente: tempo de preenchimento mostra "—" quando nenhum chamado foi aceito', async () => {
    mockGetOperationAnalytics.mockResolvedValue(
      buildAnalytics({ fillTime: { state: 'amostra-insuficiente' } }),
    );
    render(<CompanyOperationAnalytics />);

    await waitFor(() =>
      expect(screen.getByText(/nenhum foi aceito ainda neste período/i)).toBeInTheDocument(),
    );
  });

  it('truncated: exibe a faixa de truncamento (A16) quando o service reporta corte de paginação', async () => {
    mockGetOperationAnalytics.mockResolvedValue(buildAnalytics({ truncated: true }));
    render(<CompanyOperationAnalytics />);

    await waitFor(() =>
      expect(screen.getByText(/Período grande demais para calcular com precisão/i)).toBeInTheDocument(),
    );
  });

  it('sem truncamento: NÃO exibe a faixa de truncamento', async () => {
    mockGetOperationAnalytics.mockResolvedValue(buildAnalytics({ truncated: false }));
    render(<CompanyOperationAnalytics />);

    await waitFor(() => expect(mockGetOperationAnalytics).toHaveBeenCalled());
    expect(screen.queryByText(/Período grande demais para calcular com precisão/i)).not.toBeInTheDocument();
  });
});

describe('CompanyOperationAnalytics — banner de erro (C-ANALYTICS-ERRO-VIRA-VAZIO)', () => {
  it('hasError=true mostra o banner de erro (role="alert") e "Tentar de novo" chama o service de novo', async () => {
    const user = userEvent.setup();
    mockGetOperationAnalytics.mockResolvedValue(buildAnalytics({ hasError: true }));
    render(<CompanyOperationAnalytics />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Não foi possível carregar os dados deste período/i);
    expect(mockGetOperationAnalytics).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /Tentar de novo/i }));

    await waitFor(() => expect(mockGetOperationAnalytics).toHaveBeenCalledTimes(2));
  });
});

describe('CompanyOperationAnalytics — custo por hora (D2b/A17)', () => {
  it('rotula turnos que usaram hora estimada (sem checkout) — não mistura com hora real silenciosamente', async () => {
    mockGetOperationAnalytics.mockResolvedValue(
      buildAnalytics({
        costPerHour: {
          state: 'ok',
          costPerHour: 25,
          totalSpend: 500,
          totalHours: 20,
          shiftsCount: 5,
          noHoursSourceShiftsCount: 0,
          estimatedHoursShiftsCount: 2,
          inconsistentDurationShiftsCount: 0,
          delta: { current: 25, previous: null, percentChange: null },
        },
      }),
    );
    render(<CompanyOperationAnalytics />);

    await waitFor(() =>
      expect(screen.getByText(/2 de 5 turno\(s\) usaram a hora ESTIMADA/i)).toBeInTheDocument(),
    );
  });
});

describe('CompanyOperationAnalytics — tabela por freela nunca vira ranking (D4/R17)', () => {
  it('preserva a ordem alfabética recebida do service — não reordena por métrica', async () => {
    // Ordem alfabética "errada" de propósito em relação a qualquer métrica (Ana tem pior
    // aceite que Bia) — se o componente reordenasse por número, a ordem do DOM mudaria.
    mockGetOperationAnalytics.mockResolvedValue(
      buildAnalytics({
        acceptanceByWorker: {
          state: 'ok',
          rows: [
            {
              workerId: 'w1',
              workerName: 'Ana Souza',
              companyId: 'company-1',
              received: 5,
              accepted: 1,
              declined: 4,
              noResponse: 0,
              acceptanceRate: 0.2,
            },
            {
              workerId: 'w2',
              workerName: 'Bia Lima',
              companyId: 'company-1',
              received: 5,
              accepted: 5,
              declined: 0,
              noResponse: 0,
              acceptanceRate: 1,
            },
          ],
        },
      }),
    );
    render(<CompanyOperationAnalytics />);

    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument());
    const names = screen.getAllByText(/Souza|Lima/).map((el) => el.textContent);
    expect(names).toEqual(['Ana Souza', 'Bia Lima']);
  });
});

describe('CompanyOperationAnalytics — carregamento', () => {
  it('mostra skeleton, nunca "0", enquanto a busca está em voo', () => {
    mockGetOperationAnalytics.mockReturnValue(new Promise(() => {})); // nunca resolve
    render(<CompanyOperationAnalytics />);

    expect(screen.getByRole('status', { name: /Carregando métricas/i })).toBeInTheDocument();
    expect(screen.queryByText(/R\$\s?0,00/)).not.toBeInTheDocument();
  });
});
