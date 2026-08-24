import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import MyCertificationsSection from './MyCertificationsSection';
import { ToastProvider } from '../contexts/ToastContext';
import type { WorkerCertification } from '../types';

// ---------------------------------------------------------------------------
// F8 (freela) — "Minhas Certificações". Cobertura mínima exigida pelo evaluator:
//  - vencida NUNCA some da lista, mesmo com badge (D2/R8) — testa contra o predicado real
//    `isCertificationExpired`, não um mock que já decide "vencida" por fora;
//  - auto-declarada (sem `verified_by_company_id`) mostra a cópia de não-conferida, NUNCA
//    um selo genérico (D3);
//  - conferida mostra o nome da empresa nomeada (resolvido via `companies`), nunca "Verificado"
//    isolado;
//  - editar CONTEÚDO de uma certificação JÁ conferida dispara o aviso de perda ANTES de
//    chamar o service — só o segundo clique ("Continuar e salvar") de fato chama
//    `updateCertificationContent`. Esta é a asserção que pega regressão real: se o aviso
//    sumisse, o primeiro clique já chamaria o service direto.
// ---------------------------------------------------------------------------

const mockAddToast = vi.fn();
vi.mock('../contexts/ToastContext', async () => {
  const actual = await vi.importActual<typeof import('../contexts/ToastContext')>('../contexts/ToastContext');
  return { ...actual, useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }) };
});

const mockListMyCertifications = vi.fn();
const mockCreateCertification = vi.fn();
const mockUpdateCertificationContent = vi.fn();
const mockDeleteCertification = vi.fn();
vi.mock('../services/certificationService', () => ({
  CertificationService: {
    listMyCertifications: (...args: unknown[]) => mockListMyCertifications(...args),
    createCertification: (...args: unknown[]) => mockCreateCertification(...args),
    updateCertificationContent: (...args: unknown[]) => mockUpdateCertificationContent(...args),
    deleteCertification: (...args: unknown[]) => mockDeleteCertification(...args),
  },
}));

const mockSupabaseIn = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      in: (...args: unknown[]) => mockSupabaseIn(...args),
    })),
  },
}));

vi.mock('../lib/logger', () => ({ logError: vi.fn() }));

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

function renderSection() {
  return render(
    <ToastProvider>
      <MyCertificationsSection />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabaseIn.mockResolvedValue({ data: [], error: null });
  mockUpdateCertificationContent.mockResolvedValue({ success: true });
  mockCreateCertification.mockResolvedValue({ certification: buildCert() });
  mockDeleteCertification.mockResolvedValue({ success: true });
});

// Escopo de unidade (F13): os servicos passaram a resolver a empresa OPERADA pelo seam, em vez
// de `.eq('owner_id', user.id)`. O duble evita bater na RPC get_my_companies nos testes.
vi.mock('../services/companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
  getMyCompanies: vi.fn().mockResolvedValue([{ company_id: 'company-1' }]),
}))

describe('MyCertificationsSection — vencida nunca é ocultada (D2/R8)', () => {
  it('renderiza uma certificação vencida COM o badge "Vencida", nunca fora da lista', async () => {
    mockListMyCertifications.mockResolvedValue([
      buildCert({ id: 'cert-expired', title: 'Manipulação de Alimentos', expires_at: '2020-01-01' }),
    ]);

    renderSection();

    await screen.findByText('Manipulação de Alimentos');
    expect(screen.getByText('Vencida')).toBeInTheDocument();
  });

  it('certificação com validade futura NÃO mostra o badge "Vencida"', async () => {
    mockListMyCertifications.mockResolvedValue([buildCert({ expires_at: '2099-01-01' })]);

    renderSection();

    await screen.findByText('CREF');
    expect(screen.queryByText('Vencida')).not.toBeInTheDocument();
  });
});

describe('MyCertificationsSection — auto-declarada ≠ verificada (D3)', () => {
  it('sem verified_by_company_id: mostra a cópia de não-conferida, nunca um selo genérico', async () => {
    mockListMyCertifications.mockResolvedValue([buildCert({ verified_by_company_id: null, verified_at: null })]);

    renderSection();

    await screen.findByText('CREF');
    expect(
      screen.getByText('Cadastrado pelo próprio profissional — não conferido.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Verificado$/)).not.toBeInTheDocument();
  });

  it('com verified_by_company_id: nomeia a empresa que conferiu (resolvida via companies), nunca "Verificado" isolado', async () => {
    mockListMyCertifications.mockResolvedValue([
      buildCert({ verified_by_company_id: 'company-9', verified_at: '2026-02-01T12:00:00.000Z' }),
    ]);
    mockSupabaseIn.mockResolvedValue({ data: [{ id: 'company-9', name: 'Divino Fogão' }], error: null });

    renderSection();

    await screen.findByText(/Conferida por Divino Fogão em/);
    expect(screen.queryByText('Cadastrado pelo próprio profissional — não conferido.')).not.toBeInTheDocument();
  });
});

describe('MyCertificationsSection — aviso de perda de conferência ANTES de salvar (DS2)', () => {
  it('editar conteúdo de certificação JÁ conferida arma o aviso no primeiro submit — NÃO chama o service ainda', async () => {
    mockListMyCertifications.mockResolvedValue([
      buildCert({ verified_by_company_id: 'company-9', verified_at: '2026-02-01T12:00:00.000Z' }),
    ]);
    mockSupabaseIn.mockResolvedValue({ data: [{ id: 'company-9', name: 'Divino Fogão' }], error: null });

    renderSection();
    await screen.findByText('CREF');

    fireEvent.click(screen.getByLabelText('Editar certificação CREF'));
    fireEvent.change(await screen.findByLabelText('Título *'), { target: { value: 'CREF (atualizado)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    // Regra 1 do enunciado: o aviso aparece ANTES de qualquer chamada ao service.
    await screen.findByText(/vai remover a conferência de Divino Fogão/);
    expect(mockUpdateCertificationContent).not.toHaveBeenCalled();

    // Só o segundo clique (confirmação explícita) chama o service.
    fireEvent.click(screen.getByRole('button', { name: 'Continuar e salvar' }));
    await waitFor(() => {
      expect(mockUpdateCertificationContent).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateCertificationContent).toHaveBeenCalledWith(
      'cert-1',
      expect.objectContaining({ title: 'CREF (atualizado)' }),
    );
  });

  it('editar certificação NÃO conferida salva direto, sem aviso de perda', async () => {
    mockListMyCertifications.mockResolvedValue([buildCert({ verified_by_company_id: null, verified_at: null })]);
    mockUpdateCertificationContent.mockResolvedValue({ success: true });

    renderSection();
    await screen.findByText('CREF');

    fireEvent.click(screen.getByLabelText('Editar certificação CREF'));
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(mockUpdateCertificationContent).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/vai remover a conferência/)).not.toBeInTheDocument();
  });
});

describe('MyCertificationsSection — CRUD básico', () => {
  it('cadastra uma nova certificação com sucesso e recarrega a lista', async () => {
    mockListMyCertifications.mockResolvedValueOnce([]).mockResolvedValueOnce([buildCert()]);
    mockCreateCertification.mockResolvedValue({ certification: buildCert() });

    renderSection();
    await screen.findByText('Você ainda não cadastrou nenhuma certificação.');

    fireEvent.click(screen.getAllByRole('button', { name: /Adicionar|Cadastrar certificação/ })[0]);
    fireEvent.change(await screen.findByLabelText('Título *'), { target: { value: 'CREF' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(mockCreateCertification).toHaveBeenCalledWith(expect.objectContaining({ title: 'CREF' }));
    });
  });

  it('exclui uma certificação após confirmação explícita', async () => {
    mockListMyCertifications.mockResolvedValue([buildCert()]);
    mockDeleteCertification.mockResolvedValue({ success: true });

    renderSection();
    await screen.findByText('CREF');

    fireEvent.click(screen.getByLabelText('Excluir certificação CREF'));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));

    await waitFor(() => {
      expect(mockDeleteCertification).toHaveBeenCalledWith('cert-1');
    });
  });
});
