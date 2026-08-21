import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import WorkerCertificationsPanel from './WorkerCertificationsPanel';
import { ToastProvider } from '../../contexts/ToastContext';
import type { WorkerCertification, WorkerTraining } from '../../types';

// ---------------------------------------------------------------------------
// F8 (empresa) — o que a empresa vê no perfil de um freela: certificações auto-declaradas
// (com botão de conferência) e treinamentos internos (registro + revogação). Cobertura
// mínima que pega regressão real:
//  - vencida NUNCA some (D2/R8);
//  - "Desfazer conferência" só aparece quando A PRÓPRIA empresa logada foi quem conferiu —
//    conferência de OUTRA empresa não ganha o botão nesta tela (defesa de UI, D3);
//  - "Marcar como conferida" chama o service com o id certo, e some depois de conferida;
//  - revogar treinamento exige motivo (não chama o service com string vazia).
// ---------------------------------------------------------------------------

const mockAddToast = vi.fn();
vi.mock('../../contexts/ToastContext', async () => {
  const actual = await vi.importActual<typeof import('../../contexts/ToastContext')>('../../contexts/ToastContext');
  return { ...actual, useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }) };
});

const mockListWorkerCertifications = vi.fn();
const mockListCompanyTrainings = vi.fn();
const mockVerifyCertification = vi.fn();
const mockUnverifyCertification = vi.fn();
const mockRegisterTraining = vi.fn();
const mockRevokeTraining = vi.fn();
vi.mock('../../services/certificationService', () => ({
  CertificationService: {
    listWorkerCertifications: (...args: unknown[]) => mockListWorkerCertifications(...args),
    listCompanyTrainings: (...args: unknown[]) => mockListCompanyTrainings(...args),
    verifyCertification: (...args: unknown[]) => mockVerifyCertification(...args),
    unverifyCertification: (...args: unknown[]) => mockUnverifyCertification(...args),
    registerTraining: (...args: unknown[]) => mockRegisterTraining(...args),
    revokeTraining: (...args: unknown[]) => mockRevokeTraining(...args),
  },
}));

const mockGetUser = vi.fn();
const mockSupabaseIn = vi.fn();
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      in: (...args: unknown[]) => mockSupabaseIn(...args),
    })),
  },
}));

vi.mock('../../lib/logger', () => ({ logError: vi.fn() }));

function buildCert(overrides: Partial<WorkerCertification> = {}): WorkerCertification {
  return {
    id: 'cert-1',
    worker_id: 'worker-1',
    title: 'CREF',
    issuer: 'CREF-SP',
    registration_number: '012345-G/SP',
    issued_at: '2024-01-10',
    expires_at: '2030-01-10',
    verified_by_company_id: null,
    verified_at: null,
    verified_note: null,
    notified_30d_at: null,
    notified_expired_at: null,
    created_at: '2024-01-10T00:00:00.000Z',
    updated_at: '2024-01-10T00:00:00.000Z',
    ...overrides,
  };
}

function buildTraining(overrides: Partial<WorkerTraining> = {}): WorkerTraining {
  return {
    id: 'training-1',
    company_id: 'company-1',
    worker_id: 'worker-1',
    title: 'Boas práticas RDC 216',
    completed_at: '2026-01-05',
    note: null,
    created_by: 'company-1',
    created_at: '2026-01-05T00:00:00.000Z',
    revoked_at: null,
    revoked_reason: null,
    ...overrides,
  };
}

function renderPanel() {
  return render(
    <ToastProvider>
      <WorkerCertificationsPanel workerId="worker-1" />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'company-1' } }, error: null });
  mockSupabaseIn.mockResolvedValue({ data: [], error: null });
  mockListCompanyTrainings.mockResolvedValue([]);
});

describe('WorkerCertificationsPanel — vencida nunca é ocultada (D2/R8)', () => {
  it('renderiza certificação vencida com o badge, sem sumir da lista', async () => {
    mockListWorkerCertifications.mockResolvedValue([buildCert({ expires_at: '2020-01-01' })]);

    renderPanel();

    await screen.findByText('CREF');
    expect(screen.getByText('Vencida')).toBeInTheDocument();
  });
});

describe('WorkerCertificationsPanel — botão "Desfazer conferência" só para quem conferiu (D3, defesa de UI)', () => {
  it('mostra "Desfazer conferência" quando a PRÓPRIA empresa logada foi quem conferiu', async () => {
    mockListWorkerCertifications.mockResolvedValue([
      buildCert({ verified_by_company_id: 'company-1', verified_at: '2026-02-01T12:00:00.000Z' }),
    ]);
    mockSupabaseIn.mockResolvedValue({ data: [{ id: 'company-1', name: 'Minha Empresa' }], error: null });

    renderPanel();

    await screen.findByText(/Conferida por Minha Empresa em/);
    expect(screen.getByRole('button', { name: 'Desfazer conferência' })).toBeInTheDocument();
  });

  it('NÃO mostra "Desfazer conferência" quando outra empresa foi quem conferiu', async () => {
    mockListWorkerCertifications.mockResolvedValue([
      buildCert({ verified_by_company_id: 'company-OUTRA', verified_at: '2026-02-01T12:00:00.000Z' }),
    ]);
    mockSupabaseIn.mockResolvedValue({ data: [{ id: 'company-OUTRA', name: 'Outra Empresa' }], error: null });

    renderPanel();

    await screen.findByText(/Conferida por Outra Empresa em/);
    expect(screen.queryByRole('button', { name: 'Desfazer conferência' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Marcar como conferida' })).not.toBeInTheDocument();
  });

  it('certificação não conferida mostra "Marcar como conferida", nunca "Desfazer conferência"', async () => {
    mockListWorkerCertifications.mockResolvedValue([buildCert({ verified_by_company_id: null, verified_at: null })]);

    renderPanel();

    await screen.findByText('CREF');
    expect(screen.getByRole('button', { name: 'Marcar como conferida' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desfazer conferência' })).not.toBeInTheDocument();
  });
});

describe('WorkerCertificationsPanel — conferir certificação', () => {
  it('clicar "Marcar como conferida" chama o service com o id da certificação certa', async () => {
    mockListWorkerCertifications.mockResolvedValue([buildCert({ id: 'cert-abc' })]);
    mockVerifyCertification.mockResolvedValue({ success: true });

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar como conferida' }));

    await waitFor(() => {
      expect(mockVerifyCertification).toHaveBeenCalledWith('cert-abc');
    });
  });

  it('erro do service não derruba a tela e mostra o toast de erro', async () => {
    mockListWorkerCertifications.mockResolvedValue([buildCert()]);
    mockVerifyCertification.mockResolvedValue({ success: false, error: 'Sem vínculo com este freela.' });

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar como conferida' }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Sem vínculo com este freela.', 'error');
    });
  });
});

describe('WorkerCertificationsPanel — treinamentos', () => {
  it('registra um treinamento com o título e a data informados', async () => {
    mockListWorkerCertifications.mockResolvedValue([]);
    mockRegisterTraining.mockResolvedValue({ training: buildTraining() });

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar' }));
    fireEvent.change(await screen.findByLabelText('Título *'), {
      target: { value: 'Boas práticas RDC 216' },
    });
    // "Registrar" existe duas vezes: o gatilho do cabeçalho (já clicado acima) e o submit do
    // modal — o submit é sempre o ÚLTIMO da lista, já que o modal renderiza depois no DOM.
    const registerButtons = screen.getAllByRole('button', { name: 'Registrar' });
    fireEvent.click(registerButtons[registerButtons.length - 1]);

    await waitFor(() => {
      expect(mockRegisterTraining).toHaveBeenCalledWith(
        'worker-1',
        'Boas práticas RDC 216',
        expect.any(String),
        '',
      );
    });
  });

  it('revogar SEM motivo não chama o service — o motivo é obrigatório', async () => {
    mockListCompanyTrainings.mockResolvedValue([buildTraining()]);

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Revogar' }));
    // "Revogar" existe duas vezes após abrir o modal: o gatilho do card e o confirmar do modal
    // (sempre o ÚLTIMO, pelo mesmo motivo do registro acima).
    const revokeButtons = await screen.findAllByRole('button', { name: 'Revogar' });
    fireEvent.click(revokeButtons[revokeButtons.length - 1]);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Informe o motivo da revogação.', 'error');
    });
    expect(mockRevokeTraining).not.toHaveBeenCalled();
  });

  it('revogar COM motivo chama o service e o registro revogado exibe o motivo', async () => {
    mockListCompanyTrainings.mockResolvedValueOnce([buildTraining()]).mockResolvedValueOnce([
      buildTraining({ revoked_at: '2026-03-01T00:00:00.000Z', revoked_reason: 'Registrado por engano' }),
    ]);
    mockRevokeTraining.mockResolvedValue({ success: true });

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Revogar' }));
    fireEvent.change(await screen.findByLabelText('Motivo *'), {
      target: { value: 'Registrado por engano' },
    });
    const revokeButtons = screen.getAllByRole('button', { name: 'Revogar' });
    fireEvent.click(revokeButtons[revokeButtons.length - 1]);

    await waitFor(() => {
      expect(mockRevokeTraining).toHaveBeenCalledWith('training-1', 'Registrado por engano');
    });
    await screen.findByText('Revogado');
    expect(screen.getByText(/Motivo da revogação: Registrado por engano/)).toBeInTheDocument();
  });
});
