import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ReceiptView from './ReceiptView';
import type { ShiftPaymentReceipt } from '../services/paymentRecordService';
import type { ShiftPayment } from '../types';

// ---------------------------------------------------------------------------
// A8 (fechamento de lacuna, terceira iteração): um `shift_payment` com
// status='scheduled' (promessa, ainda não efetivada) NUNCA exibe o bloco de termo de
// prestação de serviço — o trigger de geração (R3) só dispara em 'recorded'. `ReceiptView`
// já guarda isso com `{!isScheduled && <ServiceTermSection ... />}`; este teste trava o
// comportamento visível (o componente-filho nem chega a ser renderizado).
// ---------------------------------------------------------------------------

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
}));

vi.mock('../lib/logger', () => ({ logError: vi.fn() }));

const mockGetReceipt = vi.fn();
vi.mock('../services/paymentRecordService', () => ({
  PaymentRecordService: {
    getReceipt: (...args: unknown[]) => mockGetReceipt(...args),
  },
}));

// Stub simples — este teste só precisa saber SE o bloco de termo é montado, não como
// ele se comporta por dentro (isso é responsabilidade de ServiceTermSection.test.tsx).
vi.mock('../components/ServiceTermSection', () => ({
  default: () => <div data-testid="service-term-section" />,
}));

import { supabase } from '../lib/supabase';

function makePayment(overrides: Partial<ShiftPayment> = {}): ShiftPayment {
  return {
    id: 'sp-1',
    job_id: 'job-1',
    company_id: 'company-1',
    worker_id: 'worker-1',
    application_id: 'app-1',
    source: 'external_pix',
    amount: 150,
    scheduled_for: null,
    paid_at: '2026-06-30T12:00:00Z',
    recorded_by: 'company-user-1',
    worker_confirmed_at: null,
    note: null,
    status: 'recorded',
    voided_at: null,
    void_reason: null,
    created_at: '2026-06-30T12:00:00Z',
    ...overrides,
  };
}

function makeReceipt(paymentOverrides: Partial<ShiftPayment> = {}): ShiftPaymentReceipt {
  return {
    payment: makePayment(paymentOverrides),
    job: {
      id: 'job-1',
      title: 'Turno de teste',
      location: 'São Paulo',
      start_date: '2026-06-30',
      work_start_time: '18:00',
      work_end_time: '23:00',
    },
    company: { id: 'company-1', name: 'Empresa Teste' },
    worker: { id: 'worker-1', full_name: 'Freela Teste' },
  };
}

function renderPage(jobId = 'job-1') {
  return render(
    <MemoryRouter initialEntries={[`/recibo/${jobId}`]}>
      <Routes>
        <Route path="/recibo/:jobId" element={<ReceiptView />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({
    data: { user: { id: 'worker-1' } },
  });
  // `applications` (chegada/saída) — não usado nestes testes, mas o fetch acontece
  // sempre que `payment.application_id` existe.
  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    }),
  });
});

// Escopo de unidade (F13): os servicos passaram a resolver a empresa OPERADA pelo seam, em vez
// de `.eq('owner_id', user.id)`. O duble evita bater na RPC get_my_companies nos testes.
vi.mock('../services/companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
  getMyCompanies: vi.fn().mockResolvedValue([{ company_id: 'company-1' }]),
}))

describe('ReceiptView — bloco de termo de prestação de serviço (A8)', () => {
  it('pagamento scheduled (promessa): NÃO renderiza o bloco de termo', async () => {
    mockGetReceipt.mockResolvedValue(makeReceipt({ status: 'scheduled', paid_at: null, scheduled_for: '2026-07-01' }));

    renderPage();

    expect(await screen.findByText('Comprovante de Agendamento')).toBeInTheDocument();
    expect(screen.queryByTestId('service-term-section')).not.toBeInTheDocument();
  });

  it('pagamento recorded (efetivado): renderiza o bloco de termo', async () => {
    mockGetReceipt.mockResolvedValue(makeReceipt({ status: 'recorded' }));

    renderPage();

    expect(await screen.findByText('Recibo de Pagamento')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('service-term-section')).toBeInTheDocument());
  });
});
