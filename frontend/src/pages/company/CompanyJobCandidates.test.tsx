import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import CompanyJobCandidates from './CompanyJobCandidates'

// Mock WalletService — must not reference outer variables in factory
vi.mock('../../services/walletService', () => ({
  WalletService: {
    releaseOrCaptureEscrow: vi.fn().mockResolvedValue({ success: true }),
    getOrCreateWallet: vi.fn().mockResolvedValue({ balance: 1000 }),
  },
}))

// Mock supabase — factory with only inline vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(),
  },
}))

// Mock ToastContext
vi.mock('../../contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ addToast: vi.fn(), removeToast: vi.fn() })),
}))

// Mock useNavigate
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: vi.fn(() => vi.fn()),
  }
})

// Import mocked modules for assertions
import { supabase } from '../../lib/supabase'
import { WalletService } from '../../services/walletService'
import { useToast } from '../../contexts/ToastContext'
import { useNavigate } from 'react-router-dom'

function buildChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
    // `.limit(1)` — usado por `shiftInviteService.dismissFromShift` na guarda de pagamento
    // ativo por (job_id, worker_id) (ADR-20260816). Resolve vazio por padrão (sem pagamento
    // ativo); testes específicos sobrescrevem quando precisam simular um marcador existente.
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
  return { ...chain, ...overrides }
}

// Cadeia "thenable" que aceita QUALQUER número de .eq()/.in() encadeados antes de resolver —
// necessária para ShiftInviteService.cancelInvite/dismissFromShift, que fazem
// `.update(...).eq('id', id).eq('status', 'invited')` (ou `.in('status', [...])`), dois
// filtros encadeados após o update (o `buildChain` padrão só suporta um nível).
function chainableResolve(result: { data: unknown; error: unknown } = { data: null, error: null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {}
  obj.eq = vi.fn(() => obj)
  obj.in = vi.fn(() => obj)
  obj.select = vi.fn(() => obj)
  obj.then = (onFulfilled?: (v: typeof result) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected)
  return obj
}

// start_date/work_start_time/work_end_time fixos — usados pelo pré-preenchimento do modal de
// horário manual (revisão pré-piloto, QA 1) e pelos testes de rollover de dia (turno que vira
// a noite: entra 18h, sai 02h do dia seguinte).
const JOB_DATA = {
  title: 'Garcom para Evento',
  start_date: '2026-03-05',
  work_start_time: '18:00:00',
  work_end_time: '02:00:00',
}

// Application with in_progress status and all checkins confirmed — for delivery modal tests
const APP_IN_PROGRESS = [
  {
    id: 'app-1',
    job_id: 'job-123',
    worker_id: 'worker-1',
    status: 'in_progress',
    cover_letter: 'Olá, quero trabalhar.',
    created_at: new Date().toISOString(),
    worker: {
      id: 'worker-1',
      full_name: 'João Silva',
      avatar_url: null,
      city: 'São Paulo',
      level: 2,
      rating_average: 4.8,
      reviews_count: 10,
      tags: [],
    },
    worker_checkin_at: new Date().toISOString(),
    worker_checkout_at: new Date().toISOString(),
    company_checkin_confirmed_at: new Date().toISOString(),
    company_checkout_confirmed_at: new Date().toISOString(),
  },
]


function setupMocksWithApps(apps: unknown[], jobData: Record<string, unknown> = JOB_DATA) {
  const mockAddToast = vi.fn()
  const mockRemoveToast = vi.fn()
  vi.mocked(useToast).mockReturnValue({ addToast: mockAddToast, removeToast: mockRemoveToast })
  vi.mocked(useNavigate).mockReturnValue(vi.fn())

  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: 'company-user-1' } },
    error: null,
  } as Awaited<ReturnType<typeof supabase.auth.getUser>>)

  vi.mocked(WalletService.getOrCreateWallet).mockResolvedValue({
    id: 'wallet-1', balance: 500, user_id: 'company-user-1', user_type: 'company', created_at: '', updated_at: ''
  })

  const jobChain = buildChain({
    single: vi.fn().mockResolvedValue({ data: jobData, error: null }),
  })

  const appChain = buildChain({
    order: vi.fn().mockResolvedValue({ data: apps, error: null }),
    // `.update({...}).eq('id', appId).select('id')` — `.select('id')` obrigatório (padrão
    // `removeFromTeam`/patterns.md) em todo UPDATE guardado por RLS neste componente. Default
    // resolve como sucesso (1 linha afetada); testes específicos sobrescrevem `appChain.update`
    // quando precisam simular "0 linhas" (RLS negou em silêncio).
    update: vi.fn().mockReturnValue(buildChain({
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [{ id: 'app-default' }], error: null }),
    })),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  })

  // Por padrão, simula um turno com escrow prepago reservado (fluxo pull legado) —
  // é o que faz renderCompletionAction() mostrar "Confirmar Entrega" em vez de cair
  // no branch modo A ("Registrar Pagamento"). Testes específicos de modo A sobrescrevem.
  // Nota: o fetch real é `.select(...).eq('job_id', id)` sem `.order()` — o mock
  // precisa resolver direto no `eq()`, não em `order()`.
  const escrowChain = buildChain({
    eq: vi.fn().mockResolvedValue({
      data: [{ application_id: 'app-1', status: 'reserved', kind: 'prepaid' }],
      error: null,
    }),
  })

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === 'jobs') return jobChain as unknown as ReturnType<typeof supabase.from>
    if (table === 'applications') return appChain as unknown as ReturnType<typeof supabase.from>
    if (table === 'escrow_transactions') return escrowChain as unknown as ReturnType<typeof supabase.from>
    return buildChain() as unknown as ReturnType<typeof supabase.from>
  })

  return { mockAddToast, appChain }
}

function renderComponent() {
  return render(
    <MemoryRouter initialEntries={['/company/jobs/job-123/candidates']}>
      <Routes>
        <Route path="/company/jobs/:id/candidates" element={<CompanyJobCandidates />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CompanyJobCandidates — renderiza candidatos com status in_progress', () => {
  it('exibe candidato com status Em Andamento', async () => {
    setupMocksWithApps(APP_IN_PROGRESS)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('João Silva')).toBeInTheDocument()
    })

    expect(screen.getByText('Em Andamento')).toBeInTheDocument()
  })
})

describe('CompanyJobCandidates — modal de confirmação de entrega', () => {
  it('modal de confirmação abre ao clicar botão Confirmar Entrega', async () => {
    setupMocksWithApps(APP_IN_PROGRESS)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('João Silva')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Confirmar Entrega'))

    expect(screen.getByRole('heading', { name: /Confirmar Entrega/i })).toBeInTheDocument()
    expect(screen.getByText(/O pagamento será liberado imediatamente ao profissional/)).toBeInTheDocument()
  })

  it('modal fecha ao clicar Cancelar sem chamar releaseEscrow', async () => {
    setupMocksWithApps(APP_IN_PROGRESS)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('João Silva')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Confirmar Entrega'))

    expect(screen.getByText(/O pagamento será liberado imediatamente ao profissional/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Cancelar'))

    await waitFor(() => {
      expect(screen.queryByText(/O pagamento será liberado imediatamente ao profissional/)).not.toBeInTheDocument()
    })

    expect(WalletService.releaseOrCaptureEscrow).not.toHaveBeenCalled()
  })

  it('toast de sucesso aparece após releaseOrCaptureEscrow retornar sucesso', async () => {
    const { mockAddToast } = setupMocksWithApps(APP_IN_PROGRESS)
    vi.mocked(WalletService.releaseOrCaptureEscrow).mockResolvedValueOnce({ success: true })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('João Silva')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Confirmar Entrega'))

    await waitFor(() => {
      expect(screen.getByText(/O pagamento será liberado imediatamente ao profissional/)).toBeInTheDocument()
    })

    // Get "Confirmar" button inside modal (not the list button)
    const buttons = screen.getAllByRole('button')
    const confirmarModal = buttons.find(b => b.textContent?.trim() === 'Confirmar')
    expect(confirmarModal).toBeDefined()
    fireEvent.click(confirmarModal!)

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Entrega confirmada! Pagamento liberado ao profissional.',
        'success'
      )
    })
  })

  it('toast de erro aparece quando releaseOrCaptureEscrow retorna success=false', async () => {
    const { mockAddToast } = setupMocksWithApps(APP_IN_PROGRESS)
    vi.mocked(WalletService.releaseOrCaptureEscrow).mockResolvedValueOnce({ success: false, error: 'Falha no pagamento' })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('João Silva')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Confirmar Entrega'))

    await waitFor(() => {
      expect(screen.getByText(/O pagamento será liberado imediatamente ao profissional/)).toBeInTheDocument()
    })

    const buttons = screen.getAllByRole('button')
    const confirmarModal = buttons.find(b => b.textContent?.trim() === 'Confirmar')
    expect(confirmarModal).toBeDefined()
    fireEvent.click(confirmarModal!)

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Erro ao liberar pagamento. Tente novamente.',
        'error'
      )
    })
  })
})

// Application status='invited' com telefone cadastrado — botão WhatsApp + Cancelar Convite.
const APP_INVITED_WITH_PHONE = [
  {
    id: 'app-invited-1',
    job_id: 'job-123',
    worker_id: 'worker-2',
    status: 'invited',
    invited_by_company_at: new Date().toISOString(),
    invitation_response: null,
    cover_letter: '',
    created_at: new Date().toISOString(),
    worker: {
      id: 'worker-2',
      full_name: 'Maria Souza',
      avatar_url: null,
      city: 'São Paulo',
      level: 1,
      rating_average: 5,
      reviews_count: 0,
      tags: [],
      phone: '(11) 99999-9999',
    },
    worker_checkin_at: null,
    worker_checkout_at: null,
    company_checkin_confirmed_at: null,
    company_checkout_confirmed_at: null,
  },
]

// Mesmo status, sem telefone cadastrado — botão WhatsApp deve virar indicador desabilitado.
const APP_INVITED_NO_PHONE = [
  {
    ...APP_INVITED_WITH_PHONE[0],
    id: 'app-invited-2',
    worker: { ...APP_INVITED_WITH_PHONE[0].worker, phone: null },
  },
]

// Application status='hired' — elegível para "Dispensar deste turno".
const APP_HIRED = [
  {
    id: 'app-hired-1',
    job_id: 'job-123',
    worker_id: 'worker-3',
    status: 'hired',
    cover_letter: '',
    created_at: new Date().toISOString(),
    worker: {
      id: 'worker-3',
      full_name: 'Carlos Lima',
      avatar_url: null,
      city: 'São Paulo',
      level: 1,
      rating_average: 5,
      reviews_count: 0,
      tags: [],
      phone: '(11) 98888-8888',
    },
    worker_checkin_at: null,
    worker_checkout_at: null,
    company_checkin_confirmed_at: null,
    company_checkout_confirmed_at: null,
  },
]

describe('CompanyJobCandidates — Cancelar Convite (invited sem resposta)', () => {
  it('mostra o botão "Cancelar Convite" para convite aguardando resposta', async () => {
    setupMocksWithApps(APP_INVITED_WITH_PHONE)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Maria Souza')).toBeInTheDocument()
    })

    expect(screen.getByText('Cancelar Convite')).toBeInTheDocument()
  })

  it('chama update de applications para status cancelled ao clicar em Cancelar Convite', async () => {
    const { mockAddToast, appChain } = setupMocksWithApps(APP_INVITED_WITH_PHONE)
    // O service busca a application atual via .select().eq().maybeSingle() antes de atualizar.
    appChain.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'app-invited-1', status: 'invited' },
      error: null,
    })
    // `.select('id')` no fim do UPDATE (revisão pré-piloto — distinguir "negado por RLS
    // em silêncio" de sucesso real): precisa devolver a linha afetada, não null.
    appChain.update = vi.fn().mockReturnValue(chainableResolve({ data: [{ id: 'app-invited-1' }], error: null }))

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Maria Souza')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Cancelar Convite'))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Convite cancelado. Você pode convidar outro freela.',
        'success'
      )
    })

    expect(appChain.update).toHaveBeenCalledWith({ status: 'cancelled' })
  })
})

describe('CompanyJobCandidates — Avisar no WhatsApp', () => {
  it('mostra o botão de WhatsApp quando o freela tem telefone cadastrado', async () => {
    setupMocksWithApps(APP_INVITED_WITH_PHONE)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Maria Souza')).toBeInTheDocument()
    })

    expect(screen.getByText('Avisar no WhatsApp')).toBeInTheDocument()
  })

  it('abre uma aba wa.me com o telefone normalizado ao clicar', async () => {
    setupMocksWithApps(APP_INVITED_WITH_PHONE)
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Maria Souza')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Avisar no WhatsApp'))

    expect(openSpy).toHaveBeenCalledTimes(1)
    const [url] = openSpy.mock.calls[0]
    expect(String(url)).toMatch(/^https:\/\/wa\.me\/5511999999999\?text=/)

    openSpy.mockRestore()
  })

  it('não mostra o botão de WhatsApp quando o freela não tem telefone cadastrado', async () => {
    setupMocksWithApps(APP_INVITED_NO_PHONE)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Maria Souza')).toBeInTheDocument()
    })

    expect(screen.queryByText('Avisar no WhatsApp')).not.toBeInTheDocument()
    expect(screen.getByText('WhatsApp indisponível')).toBeInTheDocument()
  })
})

describe('CompanyJobCandidates — Dispensar deste turno', () => {
  it('abre modal de confirmação ao clicar em Dispensar', async () => {
    setupMocksWithApps(APP_HIRED)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Carlos Lima')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Dispensar'))

    expect(screen.getByRole('heading', { name: /Dispensar Freela/i })).toBeInTheDocument()
    expect(screen.getByText(/já foi contratado para este turno/)).toBeInTheDocument()
  })

  it('modal fecha ao clicar Cancelar sem chamar update', async () => {
    const { appChain } = setupMocksWithApps(APP_HIRED)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Carlos Lima')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Dispensar'))
    expect(screen.getByRole('heading', { name: /Dispensar Freela/i })).toBeInTheDocument()

    fireEvent.click(screen.getByText('Cancelar'))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Dispensar Freela/i })).not.toBeInTheDocument()
    })

    expect(appChain.update).not.toHaveBeenCalled()
  })

  it('confirma a dispensa e chama update de applications para status cancelled', async () => {
    const { mockAddToast, appChain } = setupMocksWithApps(APP_HIRED)
    // O service busca a application atual (id, status, job_id) e checa shift_payments
    // ativo antes de atualizar — sem pagamento ativo (mock padrão de shift_payments cai no
    // fallback buildChain(), que resolve maybeSingle() com data: null).
    appChain.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'app-hired-1', status: 'hired', job_id: 'job-123' },
      error: null,
    })
    // `.select('id')` no fim do UPDATE (mesma razão da guarda de Cancelar Convite acima).
    appChain.update = vi.fn().mockReturnValue(chainableResolve({ data: [{ id: 'app-hired-1' }], error: null }))

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Carlos Lima')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Dispensar'))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Dispensar Freela/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Confirmar Dispensa'))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Freela dispensado deste turno.', 'success')
    })

    expect(appChain.update).toHaveBeenCalledWith({ status: 'cancelled' })
  })
})

describe('CompanyJobCandidates — modal de avaliação (review)', () => {
  it('handleSubmitReview exibe toast de review duplicado quando error.code === 23505', async () => {
    const mockAddToast = vi.fn()
    const mockRemoveToast = vi.fn()
    vi.mocked(useToast).mockReturnValue({ addToast: mockAddToast, removeToast: mockRemoveToast })
    vi.mocked(useNavigate).mockReturnValue(vi.fn())

    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'company-user-1' } },
      error: null,
    } as Awaited<ReturnType<typeof supabase.auth.getUser>>)

    // App with completed status — "Avaliar" button visible
    const appWithCheckins = [{
      id: 'app-3',
      job_id: 'job-123',
      worker_id: 'worker-3',
      status: 'completed',
      cover_letter: 'Pronto para trabalhar.',
      created_at: new Date().toISOString(),
      worker: {
        id: 'worker-3',
        full_name: 'Pedro Santos',
        avatar_url: null,
        city: 'Belo Horizonte',
        level: 1,
        rating_average: 0,
        reviews_count: 0,
        tags: [],
      },
      worker_checkin_at: new Date().toISOString(),
      worker_checkout_at: new Date().toISOString(),
      company_checkin_confirmed_at: new Date().toISOString(),
      company_checkout_confirmed_at: new Date().toISOString(),
    }]

    const jobChain = buildChain({
      single: vi.fn().mockResolvedValue({ data: JOB_DATA, error: null }),
    })
    const appChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: appWithCheckins, error: null }),
      // handleSubmitReview faz `.update({status:'completed'}).eq('id', id).select('id')` —
      // `.select('id')` obrigatório (patterns.md); devolve a linha afetada por padrão.
      update: vi.fn().mockReturnValue(buildChain({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: 'app-3' }], error: null }),
        }),
      })),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    })
    const reviewsChain = buildChain({
      insert: vi.fn().mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      }),
    })
    const escrowChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    vi.mocked(WalletService.releaseOrCaptureEscrow).mockResolvedValue({ success: true })
    vi.mocked(WalletService.getOrCreateWallet).mockResolvedValue({ id: 'w1', balance: 500, user_id: 'company-user-1', user_type: 'company', created_at: '', updated_at: '' })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'jobs') return jobChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'applications') return appChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'escrow_transactions') return escrowChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'reviews') return reviewsChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Pedro Santos')).toBeInTheDocument()
    })

    // Click "Avaliar" button — opens the rating modal
    fireEvent.click(screen.getByText('Avaliar'))

    // Rating modal should be open
    await waitFor(() => {
      expect(screen.getByText('Avaliar Freela')).toBeInTheDocument()
    })

    // Submit the review
    fireEvent.click(screen.getByText('Enviar Avaliação'))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Você já avaliou este freela para este turno.',
        'error'
      )
    })
  })
})

// ---------------------------------------------------------------------------
// Regressão (revisão pré-piloto, onda 3 — QA BLOQUEADOR 1 e 2, tela "Presença e Pagamento").
//
// BLOQUEADOR 1: sem o freela apertar "saída" no celular, a empresa nunca conseguia confirmar
// a saída (o botão só existia quando `worker_checkout_at` já estava preenchido) e, por
// consequência, nunca conseguia registrar o pagamento nem emitir o recibo.
//
// BLOQUEADOR 2: "Dispensar" ficava disponível mesmo depois que o freela já tinha comparecido
// ao turno, tornando-o impagável e irreversível (UNIQUE(job_id, worker_id) impede reconvidar).
// ---------------------------------------------------------------------------

// in_progress, freela chegou (check-in próprio + confirmado pela empresa) mas foi embora sem
// marcar "saída" no app — cenário real do relatório (bar fecha tarde da noite).
const APP_CHECKED_IN_NO_CHECKOUT_MARK = [
  {
    id: 'app-no-checkout',
    job_id: 'job-123',
    worker_id: 'worker-no-checkout',
    status: 'in_progress',
    cover_letter: '',
    created_at: new Date().toISOString(),
    worker: {
      id: 'worker-no-checkout',
      full_name: 'Ana Trabalhou',
      avatar_url: null,
      city: 'São Paulo',
      level: 2,
      rating_average: 4.5,
      reviews_count: 3,
      tags: [],
    },
    worker_checkin_at: new Date().toISOString(),
    worker_checkout_at: null,
    company_checkin_confirmed_at: new Date().toISOString(),
    company_checkout_confirmed_at: null,
  },
]

// Mesmo cenário, mas o freela MARCOU check-out no app — rótulo do botão deve mudar.
const APP_CHECKED_OUT_BY_WORKER = [
  {
    ...APP_CHECKED_IN_NO_CHECKOUT_MARK[0],
    id: 'app-checked-out',
    worker_id: 'worker-checked-out',
    worker: { ...APP_CHECKED_IN_NO_CHECKOUT_MARK[0].worker, full_name: 'Bruno Marcou Saída' },
    worker_checkout_at: new Date().toISOString(),
  },
]

describe('CompanyJobCandidates — Confirmar Saída sem marcação do freela (BLOQUEADOR 1)', () => {
  it('permite a empresa registrar a saída mesmo quando o freela nunca marcou check-out no app', async () => {
    const { appChain, mockAddToast } = setupMocksWithApps(APP_CHECKED_IN_NO_CHECKOUT_MARK)
    // handleConfirmCheckout faz `.update({...}).eq('id', appId).select('id')` — `.select('id')`
    // é obrigatório (padrão `removeFromTeam`/patterns.md) pra distinguir "negado por RLS em
    // silêncio" de sucesso real; o mock devolve a linha afetada.
    appChain.update = vi.fn().mockReturnValue(chainableResolve({ data: [{ id: 'app-no-checkout' }], error: null }))

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Ana Trabalhou')).toBeInTheDocument()
    })

    // O card inteiro também tem role="button" (clique abre o perfil) — escopar a busca a
    // ele evita casar com o nome acessível agregado do card (que inclui todo texto interno).
    const card = screen.getByText('Ana Trabalhou').closest('[role="button"]') as HTMLElement
    const checkoutButton = within(card).getByRole('button', { name: /Registrar Saída/i })
    expect(checkoutButton).toBeInTheDocument()

    fireEvent.click(checkoutButton)

    // Freela não marcou saída — a empresa precisa informar o horário real (não é mais um
    // clique direto que grava `now()`): abre o modal de horário manual.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Registrar Saída/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /^Confirmar$/i }))

    await waitFor(() => {
      expect(appChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ company_checkout_confirmed_at: expect.any(String) })
      )
    })
    // Não inventa worker_checkout_at — só grava o campo que a empresa efetivamente confirmou
    // (o recibo distingue "freela marcou" de "empresa confirmou manualmente").
    const updatePayload = (appChain.update as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]
    expect(updatePayload).not.toHaveProperty('worker_checkout_at')
    // Confirmação visível — este gesto destrava "Registrar Pagamento", não pode ser silencioso.
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Saída confirmada!', 'success')
    })
  })

  it('reporta falha (não sucesso mentiroso) quando o UPDATE de checkout afeta 0 linhas (RLS negou em silêncio)', async () => {
    const { appChain, mockAddToast } = setupMocksWithApps(APP_CHECKED_IN_NO_CHECKOUT_MARK)
    appChain.update = vi.fn().mockReturnValue(chainableResolve({ data: [], error: null }))

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Ana Trabalhou')).toBeInTheDocument()
    })

    const card = screen.getByText('Ana Trabalhou').closest('[role="button"]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: /Registrar Saída/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Registrar Saída/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /^Confirmar$/i }))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Não foi possível confirmar a saída deste freela.', 'error')
    })
  })

  it('rotula a saída como "Confirmar Saída" (não "Registrar Saída") quando o freela já marcou check-out', async () => {
    setupMocksWithApps(APP_CHECKED_OUT_BY_WORKER)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Bruno Marcou Saída')).toBeInTheDocument()
    })

    const card = screen.getByText('Bruno Marcou Saída').closest('[role="button"]') as HTMLElement
    expect(within(card).getByRole('button', { name: /Confirmar Saída/i })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Revisão pré-piloto (QA final) — item 1: o recibo mostrava horas erradas quando a empresa
// registrava a saída sozinha, porque o handler gravava `new Date().toISOString()` (o momento
// do CLIQUE do gerente), não o horário real do turno. `shift_payments`/o registro de presença
// são imutáveis depois de gravados — o erro virava definitivo no recibo.
//
// Timestamps de chegada FIXOS (construídos via `new Date(ano, mês, dia, h, min)`, nunca
// `new Date()` do momento do teste) para o cálculo de rollover de dia ser 100% determinístico,
// independente de quando/onde o teste roda.
// ---------------------------------------------------------------------------

// 05/03/2026 18:10 — construído no MESMO frame local que o código usa internamente
// (`new Date(y, m-1, d, h, min)`), então a comparação de horas não depende do fuso da máquina
// que roda o teste.
const FIXED_CHECKIN_LOCAL = new Date(2026, 2, 5, 18, 10, 0, 0)

// in_progress, freela marcou a CHEGADA (bar abriu 18h10) mas foi embora sem apertar "saída"
// no app — o bar fecha às 02h e o gerente só confirma na manhã seguinte. Cenário do relatório.
const APP_OVERNIGHT_NO_CHECKOUT_MARK = [
  {
    id: 'app-overnight',
    job_id: 'job-123',
    worker_id: 'worker-overnight',
    status: 'in_progress',
    cover_letter: '',
    created_at: '2026-03-01T10:00:00Z',
    worker: {
      id: 'worker-overnight',
      full_name: 'Zeca Fechou o Bar',
      avatar_url: null,
      city: 'São Paulo',
      level: 2,
      rating_average: 4.7,
      reviews_count: 5,
      tags: [],
    },
    worker_checkin_at: FIXED_CHECKIN_LOCAL.toISOString(),
    worker_checkout_at: null,
    company_checkin_confirmed_at: FIXED_CHECKIN_LOCAL.toISOString(),
    company_checkout_confirmed_at: null,
  },
]

describe('CompanyJobCandidates — horário manual de chegada/saída não pode mentir (revisão pré-piloto)', () => {
  it('pré-preenche o modal de saída com o horário PLANEJADO do turno (work_end_time), nunca com "agora"', async () => {
    setupMocksWithApps(APP_OVERNIGHT_NO_CHECKOUT_MARK)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Zeca Fechou o Bar')).toBeInTheDocument()
    })

    const card = screen.getByText('Zeca Fechou o Bar').closest('[role="button"]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: /Registrar Saída/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Registrar Saída/i })).toBeInTheDocument()
    })
    const timeInput = screen.getByLabelText(/Horário real de saída/i) as HTMLInputElement
    // work_end_time do turno é 02:00 — nunca a hora do clique do gerente.
    expect(timeInput.value).toBe('02:00')
  })

  it('turno que vira a noite: saída "02:00" cai no dia SEGUINTE ao início do turno, produzindo o número certo de horas', async () => {
    const { appChain } = setupMocksWithApps(APP_OVERNIGHT_NO_CHECKOUT_MARK)
    appChain.update = vi.fn().mockReturnValue(chainableResolve({ data: [{ id: 'app-overnight' }], error: null }))

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Zeca Fechou o Bar')).toBeInTheDocument()
    })

    const card = screen.getByText('Zeca Fechou o Bar').closest('[role="button"]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: /Registrar Saída/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Registrar Saída/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /^Confirmar$/i }))

    await waitFor(() => {
      expect(appChain.update).toHaveBeenCalled()
    })
    const updatePayload = (appChain.update as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>
    // Não inventa worker_checkout_at — só o campo que a empresa confirmou (`validate_application_update`
    // no banco rejeitaria a empresa alterando os campos do freela de qualquer forma).
    expect(updatePayload).not.toHaveProperty('worker_checkout_at')

    const saved = new Date(updatePayload.company_checkout_confirmed_at as string)
    // Chegada foi 05/03 às 18h10; a saída informada (02:00) é "menor" que esse horário-do-dia
    // -> pertence ao dia SEGUINTE (06/03). Sem esse ajuste, o timestamp ficaria com a data do
    // turno (05/03) e o ReceiptView calcularia horas negativas/erradas ("menos 16 horas").
    expect(saved.getFullYear()).toBe(2026)
    expect(saved.getMonth()).toBe(2) // março, 0-indexed
    expect(saved.getDate()).toBe(6)
    expect(saved.getHours()).toBe(2)
    expect(saved.getMinutes()).toBe(0)

    // Confere as horas resultantes como o ReceiptView calcularia: checkin 18:10 (05/03) ->
    // checkout 02:00 (06/03) = 7h50 trabalhadas — nunca "menos 16 horas".
    const workedMinutes = (saved.getTime() - FIXED_CHECKIN_LOCAL.getTime()) / 60000
    expect(workedMinutes).toBe(7 * 60 + 50)
  })

  it('quando o freela JÁ marcou a saída no app, o botão confirma direto — sem abrir o modal de horário', async () => {
    const { appChain } = setupMocksWithApps(APP_CHECKED_OUT_BY_WORKER)
    appChain.update = vi.fn().mockReturnValue(chainableResolve({ data: [{ id: 'app-checked-out' }], error: null }))

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Bruno Marcou Saída')).toBeInTheDocument()
    })

    const card = screen.getByText('Bruno Marcou Saída').closest('[role="button"]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: /Confirmar Saída/i }))

    expect(screen.queryByRole('heading', { name: /Registrar Saída/i })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(appChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ company_checkout_confirmed_at: expect.any(String) })
      )
    })
  })

  it('badge de chegada distingue "Chegada OK" (freela marcou) de "Chegada registrada pela empresa" (só a empresa confirmou) — espelha o tratamento já existente da saída', async () => {
    const appCompanyOnlyCheckin = [
      {
        ...APP_OVERNIGHT_NO_CHECKOUT_MARK[0],
        id: 'app-checkin-empresa',
        worker_id: 'worker-checkin-empresa',
        worker: { ...APP_OVERNIGHT_NO_CHECKOUT_MARK[0].worker, full_name: 'Lia Confirmada Pela Empresa' },
        worker_checkin_at: null,
        company_checkin_confirmed_at: FIXED_CHECKIN_LOCAL.toISOString(),
      },
    ]
    setupMocksWithApps(appCompanyOnlyCheckin)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Lia Confirmada Pela Empresa')).toBeInTheDocument()
    })

    const card = screen.getByText('Lia Confirmada Pela Empresa').closest('[role="button"]') as HTMLElement
    expect(within(card).getByText('Chegada registrada pela empresa')).toBeInTheDocument()
    expect(within(card).queryByText('Chegada OK')).not.toBeInTheDocument()
  })

  it('turno sem work_end_time cadastrado (legado): modal abre com o campo vazio e "Confirmar" fica desabilitado até a empresa informar um horário', async () => {
    const jobWithoutTimes = { title: 'Turno legado sem horário planejado', start_date: '2026-03-05' }
    setupMocksWithApps(APP_OVERNIGHT_NO_CHECKOUT_MARK, jobWithoutTimes)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Zeca Fechou o Bar')).toBeInTheDocument()
    })

    const card = screen.getByText('Zeca Fechou o Bar').closest('[role="button"]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: /Registrar Saída/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Registrar Saída/i })).toBeInTheDocument()
    })
    const timeInput = screen.getByLabelText(/Horário real de saída/i) as HTMLInputElement
    // Sem `work_end_time` no job, não inventa um horário — o campo fica vazio.
    expect(timeInput.value).toBe('')
    expect(screen.getByRole('button', { name: /^Confirmar$/i })).toBeDisabled()

    // A empresa informa o horário real manualmente — aí sim o botão libera.
    fireEvent.change(timeInput, { target: { value: '02:00' } })
    expect(screen.getByRole('button', { name: /^Confirmar$/i })).not.toBeDisabled()
  })

  it('chegada com marcação do PRÓPRIO freela mostra "Chegada OK" (sem regressão)', async () => {
    setupMocksWithApps(APP_OVERNIGHT_NO_CHECKOUT_MARK)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Zeca Fechou o Bar')).toBeInTheDocument()
    })

    const card = screen.getByText('Zeca Fechou o Bar').closest('[role="button"]') as HTMLElement
    expect(within(card).getByText('Chegada OK')).toBeInTheDocument()
    expect(within(card).queryByText('Chegada registrada pela empresa')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Caso central do ADR-20260816: turno com DOIS freelas concluídos (modo A, sem escrow),
// cada um com o PRÓPRIO marcador de pagamento — nunca cruzados. O banco atual só permite 1
// marcador ativo por job_id; este teste mocka `listActivePaymentsByJob` diretamente (nível de
// serviço) para validar que a UI já sabe render N marcadores por job, pronta para depois da
// migration 20260816220000 sem qualquer outra mudança de código.
// ---------------------------------------------------------------------------

const APP_TWO_FREELAS_COMPLETED = [
  {
    id: 'app-freela-a',
    job_id: 'job-123',
    worker_id: 'worker-a',
    status: 'completed',
    cover_letter: '',
    created_at: new Date().toISOString(),
    worker: {
      id: 'worker-a', full_name: 'Freela A', avatar_url: null, city: 'São Paulo',
      level: 1, rating_average: 5, reviews_count: 0, tags: [],
    },
    worker_checkin_at: new Date().toISOString(),
    worker_checkout_at: new Date().toISOString(),
    company_checkin_confirmed_at: new Date().toISOString(),
    company_checkout_confirmed_at: new Date().toISOString(),
  },
  {
    id: 'app-freela-b',
    job_id: 'job-123',
    worker_id: 'worker-b',
    status: 'completed',
    cover_letter: '',
    created_at: new Date().toISOString(),
    worker: {
      id: 'worker-b', full_name: 'Freela B', avatar_url: null, city: 'São Paulo',
      level: 1, rating_average: 5, reviews_count: 0, tags: [],
    },
    worker_checkin_at: new Date().toISOString(),
    worker_checkout_at: new Date().toISOString(),
    company_checkin_confirmed_at: new Date().toISOString(),
    company_checkout_confirmed_at: new Date().toISOString(),
  },
]

describe('CompanyJobCandidates — pagamento por freela (ADR-20260816, turno com dois freelas)', () => {
  function setupTwoFreelasMocks() {
    const mockAddToast = vi.fn()
    const mockRemoveToast = vi.fn()
    const mockNavigate = vi.fn()
    vi.mocked(useToast).mockReturnValue({ addToast: mockAddToast, removeToast: mockRemoveToast })
    vi.mocked(useNavigate).mockReturnValue(mockNavigate)

    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'company-user-1' } },
      error: null,
    } as Awaited<ReturnType<typeof supabase.auth.getUser>>)

    const jobChain = buildChain({ single: vi.fn().mockResolvedValue({ data: JOB_DATA, error: null }) })
    const appChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: APP_TWO_FREELAS_COMPLETED, error: null }),
    })
    // Sem escrow (modo A) — kind map fica vazio para os dois.
    const escrowChain = buildChain({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) })
    // Só o freela A tem marcador ATIVO (recorded); o freela B não tem nenhum —
    // `listActivePaymentsByJob` devolve só a linha de A, ordenada por created_at.
    const paymentA = {
      id: 'sp-a', job_id: 'job-123', company_id: 'company-user-1', worker_id: 'worker-a',
      application_id: 'app-freela-a', source: 'external_pix', amount: 150, scheduled_for: null,
      paid_at: new Date().toISOString(), recorded_by: 'company-user-1', worker_confirmed_at: null,
      note: null, status: 'recorded', voided_at: null, void_reason: null, created_at: new Date().toISOString(),
    }
    const shiftPaymentsChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: [paymentA], error: null }),
    })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'jobs') return jobChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'applications') return appChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'escrow_transactions') return escrowChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'shift_payments') return shiftPaymentsChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    return { mockNavigate }
  }

  it('cada freela mostra o próprio estado de pagamento — A tem recibo, B ainda pode registrar', async () => {
    setupTwoFreelasMocks()
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Freela A')).toBeInTheDocument()
      expect(screen.getByText('Freela B')).toBeInTheDocument()
    })

    const cardA = screen.getByText('Freela A').closest('[role="button"]') as HTMLElement
    const cardB = screen.getByText('Freela B').closest('[role="button"]') as HTMLElement

    // Freela A já tem marcador 'recorded' — card mostra "Ver Recibo".
    expect(within(cardA).getByText('Ver Recibo')).toBeInTheDocument()
    expect(within(cardA).queryByText('Registrar Pagamento')).not.toBeInTheDocument()

    // Freela B não tem NENHUM marcador — nunca herda o "Ver Recibo" de A.
    expect(within(cardB).getByText('Registrar Pagamento')).toBeInTheDocument()
    expect(within(cardB).queryByText('Ver Recibo')).not.toBeInTheDocument()
  })

  it('"Ver Recibo" do freela A navega com ?worker=worker-a — endereça o freela certo', async () => {
    const { mockNavigate } = setupTwoFreelasMocks()
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Freela A')).toBeInTheDocument()
    })

    const cardA = screen.getByText('Freela A').closest('[role="button"]') as HTMLElement
    fireEvent.click(within(cardA).getByText('Ver Recibo'))

    expect(mockNavigate).toHaveBeenCalledWith('/recibo/job-123?worker=worker-a')
  })
})

// ---------------------------------------------------------------------------
// Revisão pré-piloto (QA final) — ordem chegada→saída EXIGIDA. Registrar/confirmar a saída
// antes da chegada estar confirmada quebra `buildManualAttendanceTimestamp` (sem referência de
// rollover) e `calculateWorkedHours` devolve null — o recibo perde as horas para sempre
// (`shift_payments` é imutável).
// ---------------------------------------------------------------------------

// hired, NADA confirmado ainda — nem chegada nem saída.
const APP_NOTHING_CONFIRMED = [
  {
    id: 'app-nada-confirmado',
    job_id: 'job-123',
    worker_id: 'worker-nada-confirmado',
    status: 'hired',
    cover_letter: '',
    created_at: new Date().toISOString(),
    worker: {
      id: 'worker-nada-confirmado', full_name: 'Igor Sem Chegada', avatar_url: null,
      city: 'São Paulo', level: 1, rating_average: 5, reviews_count: 0, tags: [],
    },
    worker_checkin_at: null,
    worker_checkout_at: null,
    company_checkin_confirmed_at: null,
    company_checkout_confirmed_at: null,
  },
]

describe('CompanyJobCandidates — ordem chegada→saída exigida (revisão pré-piloto)', () => {
  it('esconde "Registrar Saída" e mostra estado neutro quando a chegada AINDA não foi confirmada', async () => {
    setupMocksWithApps(APP_NOTHING_CONFIRMED)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Igor Sem Chegada')).toBeInTheDocument()
    })

    const card = screen.getByText('Igor Sem Chegada').closest('[role="button"]') as HTMLElement
    // Chegada ainda pendente — botão de presença disponível.
    expect(within(card).getByRole('button', { name: /Confirmar Presença/i })).toBeInTheDocument()
    // Saída NUNCA disponível antes da chegada confirmada — nem "Registrar" nem "Confirmar".
    expect(within(card).queryByRole('button', { name: /Registrar Saída/i })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /Confirmar Saída/i })).not.toBeInTheDocument()
    expect(within(card).getByText('Confirme a chegada primeiro')).toBeInTheDocument()
  })

  it('libera "Registrar Saída" assim que a chegada é confirmada', async () => {
    setupMocksWithApps(APP_CHECKED_IN_NO_CHECKOUT_MARK)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Ana Trabalhou')).toBeInTheDocument()
    })

    const card = screen.getByText('Ana Trabalhou').closest('[role="button"]') as HTMLElement
    expect(within(card).getByRole('button', { name: /Registrar Saída/i })).toBeInTheDocument()
    expect(within(card).queryByText('Confirme a chegada primeiro')).not.toBeInTheDocument()
  })
})

describe('CompanyJobCandidates — Dispensar pós-turno (BLOQUEADOR 2)', () => {
  it('esconde "Dispensar" quando o freela já fez check-in (turno já foi cumprido)', async () => {
    const appAlreadyCheckedIn = [
      {
        ...APP_HIRED[0],
        id: 'app-hired-2',
        worker_id: 'worker-ja-chegou',
        worker: { ...APP_HIRED[0].worker, full_name: 'Daniel Ja Chegou' },
        worker_checkin_at: new Date().toISOString(),
      },
    ]
    setupMocksWithApps(appAlreadyCheckedIn)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Daniel Ja Chegou')).toBeInTheDocument()
    })

    expect(screen.queryByText('Dispensar')).not.toBeInTheDocument()
  })

  // Regressão (QA final, rodada seguinte): a guarda anterior só olhava worker_checkin_at e
  // company_checkout_confirmed_at — "Dispensar" continuava disponível logo depois de
  // "Confirmar Presença" (que grava company_checkin_confirmed_at) quando o freela nunca abriu
  // o app, exatamente o caminho canônico do modo A.
  it('esconde "Dispensar" quando só a empresa confirmou a CHEGADA (company_checkin_confirmed_at, sem checkin do freela)', async () => {
    const appCheckinConfirmedByCompany = [
      {
        ...APP_HIRED[0],
        id: 'app-hired-4',
        worker_id: 'worker-presenca-confirmada',
        worker: { ...APP_HIRED[0].worker, full_name: 'Eva Presenca Confirmada' },
        status: 'in_progress',
        worker_checkin_at: null,
        company_checkin_confirmed_at: new Date().toISOString(),
        company_checkout_confirmed_at: null,
      },
    ]
    setupMocksWithApps(appCheckinConfirmedByCompany)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Eva Presenca Confirmada')).toBeInTheDocument()
    })

    expect(screen.queryByText('Dispensar')).not.toBeInTheDocument()
  })

  it('esconde "Dispensar" quando a saída já foi confirmada pela empresa (fallback sem worker_checkout_at)', async () => {
    const appCheckoutConfirmed = [
      {
        ...APP_HIRED[0],
        id: 'app-hired-3',
        worker_id: 'worker-saida-confirmada',
        worker: { ...APP_HIRED[0].worker, full_name: 'Carla Saida Confirmada' },
        company_checkout_confirmed_at: new Date().toISOString(),
      },
    ]
    setupMocksWithApps(appCheckoutConfirmed)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Carla Saida Confirmada')).toBeInTheDocument()
    })

    expect(screen.queryByText('Dispensar')).not.toBeInTheDocument()
  })

  it('mantém "Dispensar" para um freela contratado que ainda não compareceu', async () => {
    setupMocksWithApps(APP_HIRED)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Carlos Lima')).toBeInTheDocument()
    })

    expect(screen.getByText('Dispensar')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Classe "sucesso falso" (patterns.md — DELETE/UPDATE sob RLS negado silenciosamente) —
// registro de pagamento (modo A) seguido da conclusão do turno. Sem `.select('id')` no UPDATE
// `status → 'completed'`, um UPDATE negado pela RLS reportaria "concluído" com o turno ainda
// preso em 'hired'/'in_progress' — pago, mas sem saída (dead-end).
// ---------------------------------------------------------------------------

const APP_READY_FOR_PAYMENT = [
  {
    id: 'app-pay-1',
    job_id: 'job-123',
    worker_id: 'worker-pay-1',
    status: 'in_progress',
    cover_letter: '',
    created_at: new Date().toISOString(),
    worker: {
      id: 'worker-pay-1', full_name: 'Rita Paga', avatar_url: null, city: 'São Paulo',
      level: 1, rating_average: 5, reviews_count: 0, tags: [],
    },
    worker_checkin_at: new Date().toISOString(),
    worker_checkout_at: new Date().toISOString(),
    company_checkin_confirmed_at: new Date().toISOString(),
    company_checkout_confirmed_at: new Date().toISOString(),
  },
]

describe('CompanyJobCandidates — handleRecordPayment: status → completed após pagamento', () => {
  function setupPaymentMocks() {
    const mockAddToast = vi.fn()
    vi.mocked(useToast).mockReturnValue({ addToast: mockAddToast, removeToast: vi.fn() })
    vi.mocked(useNavigate).mockReturnValue(vi.fn())
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'company-user-1' } },
      error: null,
    } as Awaited<ReturnType<typeof supabase.auth.getUser>>)

    const jobChain = buildChain({ single: vi.fn().mockResolvedValue({ data: JOB_DATA, error: null }) })
    const appChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: APP_READY_FOR_PAYMENT, error: null }),
      // PaymentRecordService.recordExternalPayment valida o turno via
      // .select(...).eq('id', applicationId).maybeSingle() — sinal real de conclusão.
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'app-pay-1',
          job_id: 'job-123',
          worker_id: 'worker-pay-1',
          company_checkin_confirmed_at: new Date().toISOString(),
          company_checkout_confirmed_at: new Date().toISOString(),
        },
        error: null,
      }),
    })
    const companiesChain = buildChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'company-1' }, error: null }),
    })
    const shiftPaymentsChain = buildChain({
      // .insert({...}).select().single() precisa encadear — override para retornar a própria cadeia.
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'sp-1', job_id: 'job-123', company_id: 'company-1', worker_id: 'worker-pay-1',
          application_id: 'app-pay-1', source: 'cash', amount: 100, scheduled_for: null,
          paid_at: new Date().toISOString(), recorded_by: 'company-user-1', worker_confirmed_at: null,
          note: null, status: 'recorded', voided_at: null, void_reason: null, created_at: new Date().toISOString(),
        },
        error: null,
      }),
      order: vi.fn().mockResolvedValue({ data: [], error: null }), // listActivePaymentsByJob (sem marcador ativo ainda)
    })
    const escrowChain = buildChain({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'jobs') return jobChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'applications') return appChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'companies') return companiesChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'shift_payments') return shiftPaymentsChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'escrow_transactions') return escrowChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    return { mockAddToast, appChain }
  }

  async function openAndSubmitPaymentModal() {
    await waitFor(() => {
      expect(screen.getByText('Rita Paga')).toBeInTheDocument()
    })
    const card = screen.getByText('Rita Paga').closest('[role="button"]') as HTMLElement
    fireEvent.click(within(card).getByText('Registrar Pagamento'))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Registrar Pagamento/i })).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText(/Valor pago/i), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: /Confirmar Registro/i }))
  }

  it('sucesso: registra o pagamento e conclui o turno quando o UPDATE afeta 1 linha', async () => {
    const { mockAddToast, appChain } = setupPaymentMocks()
    // `.select('id')` no fim do UPDATE `status → 'completed'` — devolve a linha afetada.
    appChain.update = vi.fn().mockReturnValue(chainableResolve({ data: [{ id: 'app-pay-1' }], error: null }))

    renderComponent()
    await openAndSubmitPaymentModal()

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Pagamento registrado com sucesso!', 'success')
    })
    expect(mockAddToast).not.toHaveBeenCalledWith(expect.stringMatching(/erro ao concluir/), 'error')
  })

  it('reporta falha (não sucesso mentiroso) quando o UPDATE de conclusão afeta 0 linhas (RLS negou em silêncio)', async () => {
    const { mockAddToast, appChain } = setupPaymentMocks()
    // PostgREST 204 sem erro, mas 0 linhas casaram o USING — pagamento registrado, turno
    // fica preso em 'in_progress' (dead-end: pago mas sem saída).
    appChain.update = vi.fn().mockReturnValue(chainableResolve({ data: [], error: null }))

    renderComponent()
    await openAndSubmitPaymentModal()

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Pagamento registrado, mas houve erro ao concluir o turno. Contate o suporte.',
        'error',
      )
    })
    // Nunca reporta sucesso quando o banco não mudou o status do turno.
    expect(mockAddToast).not.toHaveBeenCalledWith('Pagamento registrado com sucesso!', 'success')
  })
})
