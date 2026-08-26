import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as renderRTL, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// O bloco de `missing_cpf` aponta para /profile com <Link> (débito #8), e <Link> exige contexto de
// rota. Em produção o componente sempre vive dentro do router — o wrapper aqui reproduz isso.
const render = (ui: React.ReactElement) => renderRTL(<MemoryRouter>{ui}</MemoryRouter>);
import ServiceTermSection from './ServiceTermSection';
import type { ServiceTerm } from '../types';

// ---------------------------------------------------------------------------
// Bloco do termo de prestação de serviço (F6) + confirmação de recebimento, dentro
// do recibo (`ReceiptView`). Os dois fluxos moram no MESMO componente porque R8/A2/A3
// (não reescritos pelo gate) exigem que "Confirmar Recebimento" aceite o termo ANTES de
// gravar `worker_confirmed_at` — achado BLOCKER do evaluator (18/08/2026): antes, os
// blocos eram irmãos na página e o clique único no botão de confirmar passava por cima
// do termo sem nunca aceitá-lo.
//
// Terceira iteração (C-TERM-CONSENT / C-TERM-FETCH-FAIL): abrir o termo (`showFullText`)
// deixou de ser suficiente sozinho — o checkbox "Li e concordo com os termos acima" é
// uma SEGUNDA pré-condição somada. E o service agora devolve `{ term, failed }`
// discriminado: `failed=true` bloqueia a confirmação (não é mais indistinguível de
// "sem termo").
//
// Cobertura mínima pedida:
//  - sem termo ({ term: null, failed: false }): confirmação de recebimento continua normal
//    (feature aditiva, nunca bloqueia o que já existia);
//  - falha de leitura ({ term: null, failed: true }): confirmação FICA bloqueada, com
//    ação de tentar de novo (C-TERM-FETCH-FAIL);
//  - termo pendente: "Confirmar Recebimento" fica gateado até expandir o termo E marcar
//    o checkbox de concordância (C-TERM-CONSENT);
//  - confirmar com termo pendente ACEITA antes de confirmar (ordem correta);
//  - missing_cpf/payment_voided/forbidden/unauthenticated ABORTAM o fluxo — nunca
//    confirmam o recebimento;
//  - aceite OK + confirmação de recebimento falha (erro parcial): não chama onConfirmed,
//    mas o termo permanece aceito;
//  - termo já aceito: confirmar não chama a RPC de aceite de novo.
// ---------------------------------------------------------------------------

const mockAddToast = vi.fn();
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }),
}));

const mockGetByShiftPayment = vi.fn();
const mockAcceptServiceTerm = vi.fn();
vi.mock('../services/serviceTermService', () => ({
  ServiceTermService: {
    getByShiftPayment: (...args: unknown[]) => mockGetByShiftPayment(...args),
    acceptServiceTerm: (...args: unknown[]) => mockAcceptServiceTerm(...args),
  },
}));

const mockConfirmReceiptByWorker = vi.fn();
vi.mock('../services/paymentRecordService', () => ({
  PaymentRecordService: {
    confirmReceiptByWorker: (...args: unknown[]) => mockConfirmReceiptByWorker(...args),
  },
}));

vi.mock('../lib/logger', () => ({ logError: vi.fn() }));

const mockOnConfirmed = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

function buildTerm(overrides: Partial<ServiceTerm> = {}): ServiceTerm {
  return {
    id: 'term-1',
    shift_payment_id: 'sp-1',
    job_id: 'job-1',
    worker_id: 'worker-1',
    company_id: 'company-1',
    term_version: 'modelo-worki-v1',
    term_text: 'TERMO DE PRESTAÇÃO DE SERVIÇO AUTÔNOMO...',
    amount: 180,
    created_at: '2026-08-18T00:00:00.000Z',
    accepted_at: null,
    accepted_ip: null,
    accepted_user_agent: null,
    anonymized_at: null,
    ...overrides,
  };
}

/** Abre "Ler o termo inteiro" e marca "Li e concordo" — as DUAS pré-condições somadas
 * (C-TERM-CONSENT) para habilitar a confirmação com termo pendente. */
async function openAndAgreeToTerm(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /Ler o termo inteiro/i }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Li e concordo com os termos acima/i }));
}

// Escopo de unidade (F13): os servicos passaram a resolver a empresa OPERADA pelo seam, em vez
// de `.eq('owner_id', user.id)`. O duble evita bater na RPC get_my_companies nos testes.
vi.mock('../services/companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
  getMyCompanies: vi.fn().mockResolvedValue([{ company_id: 'company-1' }]),
}))

describe('ServiceTermSection', () => {
  it('sem termo ({ term: null, failed: false }): confirmação de recebimento continua funcionando normalmente', async () => {
    mockGetByShiftPayment.mockResolvedValue({ term: null, failed: false });

    render(
      <ServiceTermSection
        shiftPaymentId="sp-1"
        isWorkerViewer
        isCompanyViewer={false}
        workerConfirmedAt={null}
        onConfirmed={mockOnConfirmed}
      />,
    );

    await waitFor(() => expect(mockGetByShiftPayment).toHaveBeenCalledWith('sp-1'));
    // Nenhum card de termo, nenhum aviso de fronteira jurídica — feature é aditiva.
    expect(screen.queryByText(/Termo de Prestação de Serviço/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/não é parte deste termo/i)).not.toBeInTheDocument();
    // O botão de confirmar não é gateado por termo inexistente.
    const confirmButton = screen.getByRole('button', { name: /Confirmar Recebimento/i });
    expect(confirmButton).toBeEnabled();
  });

  // C-TERM-FETCH-FAIL (achado ALTO, terceira iteração): falha de leitura NÃO é o mesmo que
  // "sem termo" — precisa bloquear a confirmação (falhar fechado), não liberar o botão.
  it('falha na leitura do termo ({ failed: true }): confirmação de recebimento fica bloqueada, com ação de tentar de novo', async () => {
    mockGetByShiftPayment.mockResolvedValue({ term: null, failed: true });

    render(
      <ServiceTermSection
        shiftPaymentId="sp-1"
        isWorkerViewer
        isCompanyViewer={false}
        workerConfirmedAt={null}
        onConfirmed={mockOnConfirmed}
      />,
    );

    await waitFor(() => expect(mockGetByShiftPayment).toHaveBeenCalledWith('sp-1'));
    expect(
      await screen.findByText(/Não foi possível verificar o termo de prestação de serviço/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmar Recebimento/i })).toBeDisabled();

    // Retry: chama getByShiftPayment de novo; se resolver sem termo e sem falha, libera.
    // O retry passa por um novo ciclo de loading (skeleton) — o botão anterior é
    // desmontado, então a asserção final precisa RE-consultar o DOM, não reusar a
    // referência antiga (que fica presa fora da árvore).
    mockGetByShiftPayment.mockResolvedValueOnce({ term: null, failed: false });
    fireEvent.click(screen.getByRole('button', { name: /Tentar de novo/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Confirmar Recebimento/i })).toBeEnabled(),
    );
    expect(screen.queryByText(/Não foi possível verificar o termo/i)).not.toBeInTheDocument();
  });

  it('termo pendente (freela): "Confirmar Recebimento" fica desabilitado até expandir o termo E marcar concordância', async () => {
    mockGetByShiftPayment.mockResolvedValue({ term: buildTerm(), failed: false });

    render(
      <ServiceTermSection
        shiftPaymentId="sp-1"
        isWorkerViewer
        isCompanyViewer={false}
        workerConfirmedAt={null}
        onConfirmed={mockOnConfirmed}
      />,
    );

    expect(await screen.findByText(/TERMO DE PRESTAÇÃO DE SERVIÇO AUTÔNOMO/)).toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: /Aceitar termo e confirmar recebimento/i });
    expect(confirmButton).toBeDisabled();
    expect(
      screen.getByText(/Abra "Ler o termo inteiro" acima antes de confirmar o recebimento\./i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Ler o termo inteiro/i }));

    // Aberto mas ainda sem concordância — continua bloqueado (C-TERM-CONSENT).
    expect(confirmButton).toBeDisabled();
    expect(
      screen.getByText(/Marque "Li e concordo com os termos acima" antes de confirmar o recebimento\./i),
    ).toBeInTheDocument();
    // A cláusula de fronteira aparece na UI, além de estar dentro do term_text.
    expect(screen.getByText(/não é parte deste termo/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /Li e concordo com os termos acima/i }));
    expect(confirmButton).toBeEnabled();
  });

  it('confirmar recebimento com termo pendente ACEITA o termo antes de confirmar (R8/A2/A3)', async () => {
    mockGetByShiftPayment.mockResolvedValueOnce({ term: buildTerm(), failed: false });
    mockAcceptServiceTerm.mockResolvedValue({ outcome: 'accepted', acceptedAt: '2026-08-18T12:00:00.000Z' });
    mockGetByShiftPayment.mockResolvedValueOnce({
      term: buildTerm({ accepted_at: '2026-08-18T12:00:00.000Z', term_text: 'TERMO CONGELADO — CPF: 123.456.789-01' }),
      failed: false,
    });
    mockConfirmReceiptByWorker.mockResolvedValue({ success: true });

    render(
      <ServiceTermSection
        shiftPaymentId="sp-1"
        isWorkerViewer
        isCompanyViewer={false}
        workerConfirmedAt={null}
        onConfirmed={mockOnConfirmed}
      />,
    );

    await openAndAgreeToTerm();
    fireEvent.click(screen.getByRole('button', { name: /Aceitar termo e confirmar recebimento/i }));

    await waitFor(() => expect(mockConfirmReceiptByWorker).toHaveBeenCalledWith('sp-1'));
    // Ordem: aceita ANTES de confirmar — é exatamente o que a falha do evaluator pedia.
    const acceptOrder = mockAcceptServiceTerm.mock.invocationCallOrder[0];
    const confirmOrder = mockConfirmReceiptByWorker.mock.invocationCallOrder[0];
    expect(acceptOrder).toBeLessThan(confirmOrder);

    expect(mockOnConfirmed).toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith('Recebimento confirmado!', 'success');
    // O texto CONGELADO (re-renderizado no aceite) é o que fica visível — não montado no client.
    expect(await screen.findByText(/TERMO CONGELADO — CPF: 123.456.789-01/)).toBeInTheDocument();
  });

  // Lacuna fechada (terceira iteração): aceite OK, mas a confirmação em si falha — erro
  // parcial. O termo já fica registrado como aceito (não é desfeito), mas o recebimento
  // não é confirmado e o pai não é avisado.
  it('aceite OK + confirmação de recebimento falha: termo permanece aceito, mas onConfirmed NÃO é chamado', async () => {
    mockGetByShiftPayment.mockResolvedValueOnce({ term: buildTerm(), failed: false });
    mockAcceptServiceTerm.mockResolvedValue({ outcome: 'accepted', acceptedAt: '2026-08-18T12:00:00.000Z' });
    mockGetByShiftPayment.mockResolvedValueOnce({
      term: buildTerm({ accepted_at: '2026-08-18T12:00:00.000Z' }),
      failed: false,
    });
    mockConfirmReceiptByWorker.mockResolvedValue({ success: false, error: 'Marcador já estornado.' });

    render(
      <ServiceTermSection
        shiftPaymentId="sp-1"
        isWorkerViewer
        isCompanyViewer={false}
        workerConfirmedAt={null}
        onConfirmed={mockOnConfirmed}
      />,
    );

    await openAndAgreeToTerm();
    fireEvent.click(screen.getByRole('button', { name: /Aceitar termo e confirmar recebimento/i }));

    await waitFor(() => expect(mockConfirmReceiptByWorker).toHaveBeenCalledWith('sp-1'));
    expect(mockAddToast).toHaveBeenCalledWith('Marcador já estornado.', 'error');
    expect(mockOnConfirmed).not.toHaveBeenCalled();
    // O termo aceito não é desfeito — a tela deve refletir o estado aceito já gravado.
    expect(await screen.findByText(/Termo aceito em/i)).toBeInTheDocument();
  });

  it('missing_cpf ABORTA o fluxo: nunca confirma o recebimento', async () => {
    mockGetByShiftPayment.mockResolvedValue({ term: buildTerm(), failed: false });
    mockAcceptServiceTerm.mockResolvedValue({
      outcome: 'missing_cpf',
      error: 'Seu cadastro está sem um CPF válido. Fale com a empresa ou com o suporte do Worki para regularizar seu cadastro.',
    });

    render(
      <ServiceTermSection
        shiftPaymentId="sp-1"
        isWorkerViewer
        isCompanyViewer={false}
        workerConfirmedAt={null}
        onConfirmed={mockOnConfirmed}
      />,
    );

    await openAndAgreeToTerm();
    fireEvent.click(screen.getByRole('button', { name: /Aceitar termo e confirmar recebimento/i }));

    await waitFor(() => expect(mockAcceptServiceTerm).toHaveBeenCalledWith('term-1'));
    // Nunca chama confirmReceiptByWorker — o recebimento não é confirmado sem o termo aceito.
    expect(mockConfirmReceiptByWorker).not.toHaveBeenCalled();
    expect(mockOnConfirmed).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Seu cadastro está sem um CPF válido/i),
    ).toBeInTheDocument();
    // C-TERM-CPF-DEADEND: nunca promete uma tela de edição de CPF que não existe.
    expect(screen.queryByText(/Complete seu CPF no perfil/i)).not.toBeInTheDocument();
  });

  it('payment_voided ABORTA o fluxo: nunca confirma o recebimento', async () => {
    mockGetByShiftPayment.mockResolvedValue({ term: buildTerm(), failed: false });
    mockAcceptServiceTerm.mockResolvedValue({
      outcome: 'payment_voided',
      error: 'Este pagamento foi estornado — o termo não pode mais ser aceito.',
    });

    render(
      <ServiceTermSection
        shiftPaymentId="sp-1"
        isWorkerViewer
        isCompanyViewer={false}
        workerConfirmedAt={null}
        onConfirmed={mockOnConfirmed}
      />,
    );

    await openAndAgreeToTerm();
    fireEvent.click(screen.getByRole('button', { name: /Aceitar termo e confirmar recebimento/i }));

    await waitFor(() => expect(mockAcceptServiceTerm).toHaveBeenCalledWith('term-1'));
    expect(mockConfirmReceiptByWorker).not.toHaveBeenCalled();
    expect(mockOnConfirmed).not.toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith(
      'Este pagamento foi estornado — o termo não pode mais ser aceito.',
      'error',
    );
  });

  // Lacuna fechada (terceira iteração): outcomes não cobertos antes — protegidos por
  // construção (RPC nunca deveria devolver forbidden/unauthenticated para este freela em
  // uso normal), mas sem teste uma refatoração futura poderia silenciosamente confirmar
  // o recebimento mesmo com esses outcomes.
  it.each([
    ['forbidden', 'Você não tem permissão para aceitar este termo.'],
    ['unauthenticated', 'Sessão expirada. Faça login novamente.'],
  ])('outcome=%s ABORTA o fluxo: nunca confirma o recebimento', async (outcome, errorMsg) => {
    mockGetByShiftPayment.mockResolvedValue({ term: buildTerm(), failed: false });
    mockAcceptServiceTerm.mockResolvedValue({ outcome, error: errorMsg });

    render(
      <ServiceTermSection
        shiftPaymentId="sp-1"
        isWorkerViewer
        isCompanyViewer={false}
        workerConfirmedAt={null}
        onConfirmed={mockOnConfirmed}
      />,
    );

    await openAndAgreeToTerm();
    fireEvent.click(screen.getByRole('button', { name: /Aceitar termo e confirmar recebimento/i }));

    await waitFor(() => expect(mockAcceptServiceTerm).toHaveBeenCalledWith('term-1'));
    expect(mockConfirmReceiptByWorker).not.toHaveBeenCalled();
    expect(mockOnConfirmed).not.toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith(errorMsg, 'error');
  });

  it('termo já aceito: confirmar recebimento não chama a RPC de aceite de novo', async () => {
    mockGetByShiftPayment.mockResolvedValue({
      term: buildTerm({ accepted_at: '2026-08-18T12:00:00.000Z' }),
      failed: false,
    });
    mockConfirmReceiptByWorker.mockResolvedValue({ success: true });

    render(
      <ServiceTermSection
        shiftPaymentId="sp-1"
        isWorkerViewer
        isCompanyViewer={false}
        workerConfirmedAt={null}
        onConfirmed={mockOnConfirmed}
      />,
    );

    // Termo aceito: já não há gate de leitura/concordância — o botão nasce habilitado.
    const confirmButton = await screen.findByRole('button', { name: /Confirmar Recebimento/i });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mockConfirmReceiptByWorker).toHaveBeenCalledWith('sp-1'));
    expect(mockAcceptServiceTerm).not.toHaveBeenCalled();
  });

  it('empresa: mostra "aguardando aceite" e "aguardando confirmação", sem nenhum botão', async () => {
    mockGetByShiftPayment.mockResolvedValue({ term: buildTerm(), failed: false });

    render(
      <ServiceTermSection
        shiftPaymentId="sp-1"
        isWorkerViewer={false}
        isCompanyViewer
        workerConfirmedAt={null}
        onConfirmed={mockOnConfirmed}
      />,
    );

    expect(await screen.findByText(/Aguardando aceite do termo pelo freela/i)).toBeInTheDocument();
    expect(screen.getByText(/Aguardando confirmação do freela/i)).toBeInTheDocument();
    // A empresa nunca vê botão de aceite/confirmação — só o toggle de leitura do documento.
    expect(screen.queryByRole('button', { name: /Aceitar o termo/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirmar Recebimento/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aceitar termo e confirmar recebimento/i })).not.toBeInTheDocument();
  });

  it('recebimento já confirmado com termo ainda pendente (estado legado): caminho de resgate aparece gateado por leitura E concordância', async () => {
    mockGetByShiftPayment.mockResolvedValue({ term: buildTerm(), failed: false });

    render(
      <ServiceTermSection
        shiftPaymentId="sp-1"
        isWorkerViewer
        isCompanyViewer={false}
        workerConfirmedAt="2026-08-18T10:00:00.000Z"
        onConfirmed={mockOnConfirmed}
      />,
    );

    expect(await screen.findByText(/Recebimento confirmado em/i)).toBeInTheDocument();
    // Sem botão "Confirmar Recebimento" (já confirmado) — mas o resgate do termo aparece.
    expect(screen.queryByRole('button', { name: /Confirmar Recebimento/i })).not.toBeInTheDocument();
    const rescueButton = screen.getByRole('button', { name: /Aceitar o termo de prestação de serviço/i });
    expect(rescueButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Ler o termo inteiro/i }));
    expect(rescueButton).toBeDisabled(); // aberto, mas ainda sem concordância

    fireEvent.click(screen.getByRole('checkbox', { name: /Li e concordo com os termos acima/i }));
    expect(rescueButton).toBeEnabled();
  });

  it('não rotula IP/UA como "verificado" ou "comprovação" — só indício', async () => {
    mockGetByShiftPayment.mockResolvedValue({
      term: buildTerm({
        accepted_at: '2026-08-18T12:00:00.000Z',
        accepted_ip: '203.0.113.5',
        accepted_user_agent: 'Mozilla/5.0',
      }),
      failed: false,
    });

    render(
      <ServiceTermSection
        shiftPaymentId="sp-1"
        isWorkerViewer={false}
        isCompanyViewer
        workerConfirmedAt={null}
        onConfirmed={mockOnConfirmed}
      />,
    );

    expect(await screen.findByText(/Indícios do aceite \(não são prova\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/verificado/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/comprovação/i)).not.toBeInTheDocument();
  });
});
