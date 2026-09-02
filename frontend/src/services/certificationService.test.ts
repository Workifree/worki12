import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CertificationService } from './certificationService';

// ---------------------------------------------------------------------------
// Mock supabase — chains explícitas por tabela/operação (molde de
// teamListService.test.ts). Testes verificam CONTEÚDO do payload e filtros,
// não só "retornou algo" — regressão de "empresa conseguiu editar conteúdo" ou
// "freela conseguiu escrever verified_*" precisa quebrar um teste.
// ---------------------------------------------------------------------------

// companies.select('id').eq('owner_id', ...).maybeSingle() — getAuthenticatedCompanyId
const mockCompanyMaybeSingle = vi.fn();

// worker_certifications.select('*').eq('worker_id', id).order(...) — listMyCertifications / listWorkerCertifications
const mockCertSelectOrder = vi.fn();
const mockCertSelectEq = vi.fn(() => ({ order: mockCertSelectOrder }));
const mockCertSelect = vi.fn(() => ({ eq: mockCertSelectEq }));

// worker_certifications.insert({...}).select().single() — createCertification
const mockCertInsertSingle = vi.fn();
const mockCertInsertSelect = vi.fn(() => ({ single: mockCertInsertSingle }));
const mockCertInsert = vi.fn((payload: Record<string, unknown>) => { void payload; return { select: mockCertInsertSelect }; });

// worker_certifications.update({...}).eq('id', id).select('id') — updateCertificationContent / verify / unverify
const mockCertUpdateSelect = vi.fn();
const mockCertUpdateEq = vi.fn(() => ({ select: mockCertUpdateSelect }));
const mockCertUpdate = vi.fn((payload: Record<string, unknown>) => { void payload; return { eq: mockCertUpdateEq }; });

// worker_certifications.delete().eq('id', id).select('id') — deleteCertification
const mockCertDeleteSelect = vi.fn();
const mockCertDeleteEq = vi.fn(() => ({ select: mockCertDeleteSelect }));
const mockCertDelete = vi.fn(() => ({ eq: mockCertDeleteEq }));

// worker_trainings.select('*').eq('worker_id', id).order(...) — listMyTrainings
// worker_trainings.select('*').eq('worker_id', id).eq('company_id', id).order(...) — listCompanyTrainings
const mockTrainingSelectOrder = vi.fn();
const mockTrainingSelectEqEq = vi.fn(() => ({ order: mockTrainingSelectOrder }));
const mockTrainingSelectEq = vi.fn(() => ({
  order: mockTrainingSelectOrder,
  eq: mockTrainingSelectEqEq,
}));
const mockTrainingSelect = vi.fn(() => ({ eq: mockTrainingSelectEq }));

// worker_trainings.insert({...}).select().single() — registerTraining
const mockTrainingInsertSingle = vi.fn();
const mockTrainingInsertSelect = vi.fn(() => ({ single: mockTrainingInsertSingle }));
const mockTrainingInsert = vi.fn((payload: Record<string, unknown>) => { void payload; return { select: mockTrainingInsertSelect }; });

// worker_trainings.update({...}).eq('id', id).select('id') — revokeTraining
const mockTrainingUpdateSelect = vi.fn();
const mockTrainingUpdateEq = vi.fn(() => ({ select: mockTrainingUpdateSelect }));
const mockTrainingUpdate = vi.fn((payload: Record<string, unknown>) => { void payload; return { eq: mockTrainingUpdateEq }; });

const mockGetUser = vi.fn();

const mockFrom = vi.fn((table: string) => {
  if (table === 'companies') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: mockCompanyMaybeSingle })),
      })),
    };
  }
  if (table === 'worker_certifications') {
    return {
      select: mockCertSelect,
      insert: mockCertInsert,
      update: mockCertUpdate,
      delete: mockCertDelete,
    };
  }
  if (table === 'worker_trainings') {
    return {
      select: mockTrainingSelect,
      insert: mockTrainingInsert,
      update: mockTrainingUpdate,
    };
  }
  throw new Error(`tabela inesperada no mock: ${table}`);
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (table: string) => mockFrom(table),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'worker-1' } }, error: null });
  mockCompanyMaybeSingle.mockResolvedValue({ data: { id: 'company-1' }, error: null });
  mockCertSelectOrder.mockResolvedValue({ data: [], error: null });
  mockCertInsertSingle.mockResolvedValue({
    data: { id: 'cert-1', worker_id: 'worker-1', title: 'CREF' },
    error: null,
  });
  mockCertUpdateSelect.mockResolvedValue({ data: [{ id: 'cert-1' }], error: null });
  mockCertDeleteSelect.mockResolvedValue({ data: [{ id: 'cert-1' }], error: null });
  mockTrainingSelectOrder.mockResolvedValue({ data: [], error: null });
  mockTrainingInsertSingle.mockResolvedValue({
    data: { id: 'training-1', worker_id: 'worker-1', company_id: 'company-1' },
    error: null,
  });
  mockTrainingUpdateSelect.mockResolvedValue({ data: [{ id: 'training-1' }], error: null });
});

// ---------------------------------------------------------------------------
// listMyCertifications / listWorkerCertifications
// ---------------------------------------------------------------------------

// Escopo de unidade (F13): os servicos passaram a resolver a empresa OPERADA pelo seam, em vez
// de `.eq('owner_id', user.id)`. O duble evita bater na RPC get_my_companies nos testes.
vi.mock('./companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
  getMyCompanies: vi.fn().mockResolvedValue([{ company_id: 'company-1' }]),
}))

describe('CertificationService.listMyCertifications', () => {
  it('filtra por worker_id do freela autenticado (nunca por company_id — não existe)', async () => {
    await CertificationService.listMyCertifications();

    expect(mockCertSelect).toHaveBeenCalledWith('*');
    expect(mockCertSelectEq).toHaveBeenCalledWith('worker_id', 'worker-1');
  });

  it('devolve null em erro do banco (erro ≠ lista vazia) — nunca lança para a UI', async () => {
    mockCertSelectOrder.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    const result = await CertificationService.listMyCertifications();

    // null sinaliza falha de carga: a UI mostra erro+retry em vez do empty state que mente
    expect(result).toBeNull();
  });
});

describe('CertificationService.listWorkerCertifications', () => {
  it('filtra pelo worker_id passado — vencidas NÃO são filtradas aqui (R8: nunca ocultar)', async () => {
    mockCertSelectOrder.mockResolvedValueOnce({
      data: [{ id: 'cert-1', expires_at: '2020-01-01' }],
      error: null,
    });

    const result = await CertificationService.listWorkerCertifications('worker-2');

    expect(mockCertSelectEq).toHaveBeenCalledWith('worker_id', 'worker-2');
    expect(result).toEqual([{ id: 'cert-1', expires_at: '2020-01-01' }]);
  });
});

// ---------------------------------------------------------------------------
// createCertification — nunca envia verified_*/notified_*
// ---------------------------------------------------------------------------

describe('CertificationService.createCertification', () => {
  it('rejeita título vazio sem chamar o banco', async () => {
    const result = await CertificationService.createCertification({ title: '   ' });

    expect(result.certification).toBeNull();
    expect(result.error).toBeTruthy();
    expect(mockCertInsert).not.toHaveBeenCalled();
  });

  it('insere só worker_id + campos de conteúdo — payload NÃO contém verified_*/notified_* (wc_insert_owner exige nulos)', async () => {
    await CertificationService.createCertification({
      title: '  CREF 012345  ',
      issuer: 'CONFEF',
      expires_at: '2027-01-01',
    });

    expect(mockCertInsert).toHaveBeenCalledTimes(1);
    const payload = mockCertInsert.mock.calls[0][0];
    expect(payload).toEqual({
      worker_id: 'worker-1',
      title: 'CREF 012345',
      issuer: 'CONFEF',
      registration_number: null,
      issued_at: null,
      expires_at: '2027-01-01',
    });
    expect(payload).not.toHaveProperty('verified_by_company_id');
    expect(payload).not.toHaveProperty('notified_30d_at');
  });
});

// ---------------------------------------------------------------------------
// updateCertificationContent — payload de conteúdo, 0 linhas = RLS negou
// ---------------------------------------------------------------------------

describe('CertificationService.updateCertificationContent', () => {
  it('envia só campos de conteúdo, nunca verified_*', async () => {
    await CertificationService.updateCertificationContent('cert-1', {
      title: 'CREF atualizado',
      issued_at: '2020-01-01',
    });

    const payload = mockCertUpdate.mock.calls[0][0];
    expect(payload).toEqual({
      title: 'CREF atualizado',
      issuer: null,
      registration_number: null,
      issued_at: '2020-01-01',
      expires_at: null,
    });
    expect(payload).not.toHaveProperty('verified_by_company_id');
  });

  it('0 linhas de retorno vira erro explícito (RLS negou silenciosamente, não exceção)', async () => {
    mockCertUpdateSelect.mockResolvedValueOnce({ data: [], error: null });

    const result = await CertificationService.updateCertificationContent('cert-1', { title: 'X' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/não existe mais ou não é sua/);
  });

  it('rejeita título vazio sem chamar o banco', async () => {
    const result = await CertificationService.updateCertificationContent('cert-1', { title: '  ' });

    expect(result.success).toBe(false);
    expect(mockCertUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteCertification
// ---------------------------------------------------------------------------

describe('CertificationService.deleteCertification', () => {
  it('0 linhas de retorno vira erro (não é mais dono ou já foi excluída)', async () => {
    mockCertDeleteSelect.mockResolvedValueOnce({ data: [], error: null });

    const result = await CertificationService.deleteCertification('cert-1');

    expect(result.success).toBe(false);
  });

  it('sucesso quando 1 linha volta', async () => {
    const result = await CertificationService.deleteCertification('cert-1');

    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyCertification / unverifyCertification — SEMPRE em nome próprio, nunca conteúdo
// ---------------------------------------------------------------------------

describe('CertificationService.verifyCertification', () => {
  it('grava verified_by_company_id da PRÓPRIA empresa autenticada — nunca um id arbitrário', async () => {
    await CertificationService.verifyCertification('cert-1', '  vi o documento original  ');

    const payload = mockCertUpdate.mock.calls[0][0];
    expect(payload).toEqual({
      verified_by_company_id: 'company-1',
      verified_note: 'vi o documento original',
    });
    expect(payload).not.toHaveProperty('title');
  });

  it('nota vazia vira null, não string vazia', async () => {
    await CertificationService.verifyCertification('cert-1', '   ');

    const payload = mockCertUpdate.mock.calls[0][0];
    expect(payload.verified_note).toBeNull();
  });

  it('0 linhas (sem vínculo) vira mensagem de erro específica', async () => {
    mockCertUpdateSelect.mockResolvedValueOnce({ data: [], error: null });

    const result = await CertificationService.verifyCertification('cert-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/vínculo/);
  });

  it('erro 42501 do trigger é traduzido, nunca repassado cru', async () => {
    mockCertUpdateSelect.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'new row violates row-level security policy' },
    });

    const result = await CertificationService.verifyCertification('cert-1');

    expect(result.success).toBe(false);
    expect(result.error).not.toMatch(/row-level security/);
  });
});

describe('CertificationService.unverifyCertification', () => {
  it('envia só verified_by_company_id: null — nunca mexe em conteúdo', async () => {
    await CertificationService.unverifyCertification('cert-1');

    expect(mockCertUpdate).toHaveBeenCalledWith({ verified_by_company_id: null });
  });
});

// ---------------------------------------------------------------------------
// listMyTrainings / listCompanyTrainings — A15: nunca vaza treinamento de outra empresa
// ---------------------------------------------------------------------------

describe('CertificationService.listMyTrainings', () => {
  it('filtra só por worker_id — dado pessoal do próprio freela', async () => {
    await CertificationService.listMyTrainings();

    expect(mockTrainingSelectEq).toHaveBeenCalledWith('worker_id', 'worker-1');
  });
});

describe('CertificationService.listCompanyTrainings', () => {
  it('filtra por worker_id E company_id da empresa autenticada — nunca só worker_id (vazaria A15)', async () => {
    await CertificationService.listCompanyTrainings('worker-2');

    expect(mockTrainingSelectEq).toHaveBeenCalledWith('worker_id', 'worker-2');
    expect(mockTrainingSelectEqEq).toHaveBeenCalledWith('company_id', 'company-1');
  });
});

// ---------------------------------------------------------------------------
// registerTraining — só empresa, created_by = auth.uid()
// ---------------------------------------------------------------------------

describe('CertificationService.registerTraining', () => {
  it('rejeita título vazio sem chamar o banco', async () => {
    const result = await CertificationService.registerTraining('worker-2', '   ', '2026-08-01');

    expect(result.training).toBeNull();
    expect(mockTrainingInsert).not.toHaveBeenCalled();
  });

  it('insere com company_id da empresa autenticada e created_by = auth.uid() — nunca o freela como dono', async () => {
    await CertificationService.registerTraining('worker-2', 'Boas práticas RDC 216', '2026-08-01', 'ok');

    expect(mockTrainingInsert).toHaveBeenCalledWith({
      company_id: 'company-1',
      worker_id: 'worker-2',
      title: 'Boas práticas RDC 216',
      completed_at: '2026-08-01',
      note: 'ok',
      created_by: 'worker-1',
    });
  });

  it('erro de RLS (sem vínculo) é traduzido', async () => {
    mockTrainingInsertSingle.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'row-level security' },
    });

    const result = await CertificationService.registerTraining('worker-2', 'X', '2026-08-01');

    expect(result.training).toBeNull();
    expect(result.error).toMatch(/vínculo/);
  });
});

// ---------------------------------------------------------------------------
// revokeTraining — one-way, exige motivo
// ---------------------------------------------------------------------------

describe('CertificationService.revokeTraining', () => {
  it('rejeita motivo vazio sem chamar o banco', async () => {
    const result = await CertificationService.revokeTraining('training-1', '   ');

    expect(result.success).toBe(false);
    expect(mockTrainingUpdate).not.toHaveBeenCalled();
  });

  it('envia revoked_at + revoked_reason — nunca reescreve conteúdo', async () => {
    await CertificationService.revokeTraining('training-1', 'registrado por engano');

    const payload = mockTrainingUpdate.mock.calls[0][0];
    expect(payload.revoked_reason).toBe('registrado por engano');
    expect(typeof payload.revoked_at).toBe('string');
    expect(payload).not.toHaveProperty('title');
  });

  it('0 linhas vira erro (revogado por outra empresa, ou já revogado — trigger rejeitaria)', async () => {
    mockTrainingUpdateSelect.mockResolvedValueOnce({ data: [], error: null });

    const result = await CertificationService.revokeTraining('training-1', 'engano');

    expect(result.success).toBe(false);
  });
});
