import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MyJobs from '../MyJobs'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(),
  },
}))

vi.mock('../../contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ addToast: vi.fn(), removeToast: vi.fn() })),
}))

vi.mock('../../lib/logger', () => ({ logError: vi.fn() }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: vi.fn(() => vi.fn()),
  }
})

// Mock RateModal to simplify tests
vi.mock('../../components/RateModal', () => ({
  default: () => null,
}))

// Mock JobLifecycleStepper to simplify tests
vi.mock('../../components/JobLifecycleStepper', () => ({
  default: () => <div data-testid="lifecycle-stepper">Stepper</div>,
}))

// Mock PageMeta
vi.mock('../../components/PageMeta', () => ({
  default: () => null,
}))

import { supabase } from '../../lib/supabase'
import { useToast } from '../../contexts/ToastContext'
import { useNavigate } from 'react-router-dom'
import { computeWorkerSteps, type JobApplication } from '../MyJobs'

interface ApplicationRow {
  id: string
  status: string
  created_at: string
  worker_checkin_at: string | null
  worker_checkout_at: string | null
  company_checkin_confirmed_at: string | null
  company_checkout_confirmed_at: string | null
  job: {
    id: string
    title: string
    budget: number
    start_date: string | null
    work_start_time: string | null
    work_end_time: string | null
    location: string | null
    company: {
      id: string
      name: string
      logo_url: string | null
    } | null
  } | null
}

const APP_IN_PROGRESS: ApplicationRow = {
  id: 'app-2',
  status: 'in_progress',
  created_at: '2026-03-15T08:00:00Z',
  worker_checkin_at: '2026-03-17T08:00:00Z',
  worker_checkout_at: null,
  company_checkin_confirmed_at: null,
  company_checkout_confirmed_at: null,
  job: {
    id: 'job-2',
    title: 'Barman para Festa',
    budget: 200,
    start_date: '2026-03-17',
    work_start_time: '08:00',
    work_end_time: '16:00',
    location: 'Rio de Janeiro',
    company: { id: 'company-2', name: 'Bar & Cia', logo_url: null },
  },
}

const APP_COMPLETED: ApplicationRow = {
  id: 'app-3',
  status: 'completed',
  created_at: '2026-03-01T10:00:00Z',
  worker_checkin_at: '2026-03-05T08:00:00Z',
  worker_checkout_at: '2026-03-05T16:00:00Z',
  company_checkin_confirmed_at: '2026-03-05T08:30:00Z',
  company_checkout_confirmed_at: '2026-03-05T16:30:00Z',
  job: {
    id: 'job-3',
    title: 'Cozinheiro para Evento',
    budget: 300,
    start_date: '2026-03-05',
    work_start_time: '08:00',
    work_end_time: '16:00',
    location: 'Belo Horizonte',
    company: { id: 'company-3', name: 'Restaurante Top', logo_url: null },
  },
}

function buildChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
  }
  return { ...chain, ...overrides }
}

// Cadeia "thenable" que aceita QUALQUER número de .eq()/.select() encadeados antes de resolver —
// necessária para handleCheckin/handleCheckout, que fazem `.update(...).eq('id', appId).select('id')`
// (o `buildChain` padrão não é "awaitable" por si só — resolve para o próprio objeto chain, não
// para `{data, error}`, então testes que precisam simular uma resolução real usam isto).
function chainableResolve(result: { data: unknown; error: unknown } = { data: null, error: null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {}
  obj.eq = vi.fn(() => obj)
  obj.select = vi.fn(() => obj)
  obj.then = (onFulfilled?: (v: typeof result) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected)
  return obj
}

function setupMocks(apps: ApplicationRow[] = [], conversationOverrides: Record<string, unknown> = {}) {
  const mockAddToast = vi.fn()
  const mockNavigate = vi.fn()
  vi.mocked(useToast).mockReturnValue({ addToast: mockAddToast, removeToast: vi.fn() })
  vi.mocked(useNavigate).mockReturnValue(mockNavigate)

  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: 'worker-1' } },
    error: null,
  } as Awaited<ReturnType<typeof supabase.auth.getUser>>)

  const reviewsChain = buildChain({
    eq: vi.fn().mockResolvedValue({ data: [], error: null }),
  })

  const appsChain = buildChain({
    order: vi.fn().mockResolvedValue({ data: apps, error: null }),
  })

  const conversationChain = buildChain(conversationOverrides)

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === 'reviews') return reviewsChain as unknown as ReturnType<typeof supabase.from>
    if (table === 'applications') return appsChain as unknown as ReturnType<typeof supabase.from>
    if (table === 'Conversation') return conversationChain as unknown as ReturnType<typeof supabase.from>
    return buildChain() as unknown as ReturnType<typeof supabase.from>
  })

  return { mockAddToast, mockNavigate, conversationChain }
}

function renderComponent() {
  return render(
    <MemoryRouter>
      <MyJobs />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MyJobs - Tabs de status', () => {
  it('renderiza todas as tabs de status (pivô: sem Candidaturas)', async () => {
    setupMocks([APP_IN_PROGRESS])
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Convites')).toBeInTheDocument()
    })

    expect(screen.getByText('Em Andamento')).toBeInTheDocument()
    expect(screen.getByText('Agendados')).toBeInTheDocument()
    expect(screen.getByText(/Histórico/)).toBeInTheDocument()
    // Aba "Candidaturas" foi removida no pivô push (invite-only).
    expect(screen.queryByText('Candidaturas')).not.toBeInTheDocument()
  })

  it('troca de tab ao clicar e mostra turnos corretos', async () => {
    setupMocks([APP_IN_PROGRESS, APP_COMPLETED])
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Meus Turnos')).toBeInTheDocument()
    })

    // Em Andamento
    fireEvent.click(screen.getByText('Em Andamento'))
    await waitFor(() => {
      expect(screen.getByText('Barman para Festa')).toBeInTheDocument()
    })

    // Histórico
    fireEvent.click(screen.getByText(/Histórico/))
    await waitFor(() => {
      expect(screen.getByText('Cozinheiro para Evento')).toBeInTheDocument()
    })
  })
})

describe('MyJobs - Botao check-out', () => {
  it('exibe botao Check-out para turnos in_progress com checkin e sem checkout', async () => {
    setupMocks([APP_IN_PROGRESS])
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Meus Turnos')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Em Andamento'))

    await waitFor(() => {
      expect(screen.getByText('Barman para Festa')).toBeInTheDocument()
    })

    // worker_checkin_at setado e worker_checkout_at null → botão Check-out visível
    expect(screen.getByText('Check-out')).toBeInTheDocument()
  })

  // Caso central (QA pré-piloto): a empresa registrou a saída sozinha
  // (company_checkout_confirmed_at) sem o freela ter tocado no app (worker_checkout_at null).
  // O freela que abrir o app NÃO pode ver um CTA "Check-out" ativo — se tocar, sobrescreveria o
  // worker_checkout_at, e o recibo prioriza esse campo sobre a confirmação da empresa mesmo em
  // turno já pago (ReceiptView).
  it('esconde o CTA Check-out e mostra "Empresa registrou sua saída" quando a empresa confirmou sem o freela', async () => {
    const companyCheckedOutApp: ApplicationRow = {
      ...APP_IN_PROGRESS,
      worker_checkin_at: '2026-03-17T08:00:00Z',
      worker_checkout_at: null,
      company_checkin_confirmed_at: '2026-03-17T08:05:00Z',
      company_checkout_confirmed_at: '2026-03-17T16:10:00Z',
    }
    setupMocks([companyCheckedOutApp])
    renderComponent()

    fireEvent.click(await screen.findByText('Em Andamento'))
    await screen.findByText('Barman para Festa')

    // Não pode existir CTA "Check-out" (button) — a empresa já fechou essa etapa.
    expect(screen.queryByRole('button', { name: 'Check-out' })).not.toBeInTheDocument()
    // O freela vê que foi a EMPRESA quem registrou a saída, não ele.
    expect(screen.getByText('Empresa registrou sua saída')).toBeInTheDocument()
  })

  // Mesmo problema no check-in: empresa pode confirmar chegada sem o freela ter apertado
  // "Check-in" (handleConfirmCheckin em CompanyJobCandidates não seta worker_checkin_at).
  it('esconde o CTA Check-in e mostra "Empresa registrou sua chegada" quando a empresa confirmou sem o freela', async () => {
    const companyCheckedInApp: ApplicationRow = {
      ...APP_IN_PROGRESS,
      status: 'in_progress',
      worker_checkin_at: null,
      worker_checkout_at: null,
      company_checkin_confirmed_at: '2026-03-17T08:05:00Z',
      company_checkout_confirmed_at: null,
    }
    setupMocks([companyCheckedInApp])
    renderComponent()

    fireEvent.click(await screen.findByText('Em Andamento'))
    await screen.findByText('Barman para Festa')

    expect(screen.queryByRole('button', { name: 'Check-in' })).not.toBeInTheDocument()
    expect(screen.getByText('Empresa registrou sua chegada')).toBeInTheDocument()
    // Check-out também não pode ficar disponível: o freela nunca chegou a fazer check-in
    // por conta própria, mas a etapa "chegada" já está fechada, então o botão de saída aparece.
    expect(screen.getByRole('button', { name: 'Check-out' })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Classe "sucesso falso" (patterns.md — DELETE/UPDATE sob RLS negado silenciosamente) —
// check-in/check-out do freela. Sem `.select('id')` no UPDATE, um UPDATE negado pela RLS
// (0 linhas, sem erro) reportaria "check-in realizado"/prosseguiria silenciosamente com o
// banco intocado.
// ---------------------------------------------------------------------------

// status='in_progress' (não 'hired') para cair de forma determinística na aba "Em Andamento"
// (isInProgress = app.status === 'in_progress', sem depender de data/horário do turno).
const APP_SCHEDULED_NO_CHECKIN: ApplicationRow = {
  ...APP_IN_PROGRESS,
  id: 'app-scheduled-1',
  status: 'in_progress',
  worker_checkin_at: null,
  company_checkin_confirmed_at: null,
}

describe('MyJobs - handleCheckin/handleCheckout: UPDATE negado pela RLS não pode ser sucesso', () => {
  it('check-in com sucesso: UPDATE afetou 1 linha', async () => {
    const { mockAddToast } = setupMocks([APP_SCHEDULED_NO_CHECKIN])
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'applications') {
        return buildChain({
          order: vi.fn().mockResolvedValue({ data: [APP_SCHEDULED_NO_CHECKIN], error: null }),
          update: vi.fn().mockReturnValue(chainableResolve({ data: [{ id: 'app-scheduled-1' }], error: null })),
        }) as unknown as ReturnType<typeof supabase.from>
      }
      if (table === 'reviews') return buildChain({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })
    renderComponent()

    fireEvent.click(await screen.findByText('Em Andamento'))
    const checkinButton = await screen.findByRole('button', { name: /Check-in/i })
    fireEvent.click(checkinButton)

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Check-in realizado com sucesso!', 'success')
    })
  })

  it('reporta falha (não sucesso mentiroso) quando o UPDATE de check-in afeta 0 linhas (RLS negou em silêncio)', async () => {
    const { mockAddToast } = setupMocks([APP_SCHEDULED_NO_CHECKIN])
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'applications') {
        return buildChain({
          order: vi.fn().mockResolvedValue({ data: [APP_SCHEDULED_NO_CHECKIN], error: null }),
          update: vi.fn().mockReturnValue(chainableResolve({ data: [], error: null })),
        }) as unknown as ReturnType<typeof supabase.from>
      }
      if (table === 'reviews') return buildChain({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })
    renderComponent()

    fireEvent.click(await screen.findByText('Em Andamento'))
    const checkinButton = await screen.findByRole('button', { name: /Check-in/i })
    fireEvent.click(checkinButton)

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Não foi possível fazer check-in. Atualize a página e tente novamente.',
        'error',
      )
    })
    expect(mockAddToast).not.toHaveBeenCalledWith('Check-in realizado com sucesso!', 'success')
  })

  it('check-out com sucesso: UPDATE afetou 1 linha', async () => {
    setupMocks([APP_IN_PROGRESS])
    const appsChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: [APP_IN_PROGRESS], error: null }),
      update: vi.fn().mockReturnValue(chainableResolve({ data: [{ id: APP_IN_PROGRESS.id }], error: null })),
    })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'applications') return appsChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'reviews') return buildChain({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })
    renderComponent()

    fireEvent.click(await screen.findByText('Em Andamento'))
    const checkoutButton = await screen.findByRole('button', { name: 'Check-out' })
    fireEvent.click(checkoutButton)

    await waitFor(() => {
      expect(appsChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ worker_checkout_at: expect.any(String) }),
      )
    })
  })

  it('reporta falha (não sucesso mentiroso) quando o UPDATE de check-out afeta 0 linhas (RLS negou em silêncio)', async () => {
    const { mockAddToast } = setupMocks([APP_IN_PROGRESS])
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'applications') {
        return buildChain({
          order: vi.fn().mockResolvedValue({ data: [APP_IN_PROGRESS], error: null }),
          update: vi.fn().mockReturnValue(chainableResolve({ data: [], error: null })),
        }) as unknown as ReturnType<typeof supabase.from>
      }
      if (table === 'reviews') return buildChain({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })
    renderComponent()

    fireEvent.click(await screen.findByText('Em Andamento'))
    const checkoutButton = await screen.findByRole('button', { name: 'Check-out' })
    fireEvent.click(checkoutButton)

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Não foi possível fazer check-out. Atualize a página e tente novamente.',
        'error',
      )
    })
  })
})

describe('MyJobs - computeWorkerSteps (lógica pura)', () => {
  function buildJob(overrides: Partial<JobApplication> = {}): JobApplication {
    return {
      id: 'app-1',
      job_id: 'job-1',
      status: 'in_progress',
      title: 'Turno',
      company_id: 'company-1',
      company_name: 'Empresa',
      company_logo: null,
      pay: 100,
      date: '17/03/2026',
      raw_date: '2026-03-17',
      time: '08:00',
      end_time: '16:00',
      location: 'SP',
      month: 'MAR',
      day: 17,
      worker_checkin_at: null,
      worker_checkout_at: null,
      company_checkin_confirmed_at: null,
      company_checkout_confirmed_at: null,
      ...overrides,
    }
  }

  it('sem nenhum registro: chegada active, resto pending', () => {
    const steps = computeWorkerSteps(buildJob())
    expect(steps[0].status).toBe('active')
    expect(steps[1].status).toBe('pending')
    expect(steps[2].status).toBe('pending')
  })

  it('checkout confirmado SÓ pela empresa (sem worker_checkout_at) conta como completo — não fica travado em "active"', () => {
    const steps = computeWorkerSteps(
      buildJob({
        worker_checkin_at: '2026-03-17T08:00:00Z',
        worker_checkout_at: null,
        company_checkout_confirmed_at: '2026-03-17T16:10:00Z',
      })
    )
    expect(steps[0].status).toBe('complete') // Chegada registrada
    expect(steps[1].status).toBe('complete') // Check-out — fechado pela empresa
    expect(steps[2].status).toBe('complete') // Aguardando empresa — já confirmado
  })

  it('checkin confirmado SÓ pela empresa (sem worker_checkin_at) conta como chegada completa', () => {
    const steps = computeWorkerSteps(
      buildJob({
        worker_checkin_at: null,
        company_checkin_confirmed_at: '2026-03-17T08:05:00Z',
      })
    )
    expect(steps[0].status).toBe('complete')
  })

  it('turno totalmente concluído pelo freela: todos os steps completos', () => {
    const steps = computeWorkerSteps(
      buildJob({
        worker_checkin_at: '2026-03-17T08:00:00Z',
        worker_checkout_at: '2026-03-17T16:00:00Z',
        company_checkin_confirmed_at: '2026-03-17T08:05:00Z',
        company_checkout_confirmed_at: '2026-03-17T16:10:00Z',
      })
    )
    expect(steps.every((s) => s.status === 'complete')).toBe(true)
  })
})

describe('MyJobs - Estado vazio por tab', () => {
  it('exibe estado vazio na tab Em Andamento quando nao ha turnos', async () => {
    setupMocks([])
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Meus Turnos')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Em Andamento'))

    await waitFor(() => {
      expect(screen.getByText('Nenhum trabalho em andamento.')).toBeInTheDocument()
    })
  })

  it('exibe estado vazio na tab Agendados quando nao ha turnos', async () => {
    setupMocks([])
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Meus Turnos')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Agendados'))

    await waitFor(() => {
      expect(screen.getByText('Nenhum turno agendado no momento.')).toBeInTheDocument()
    })
  })

  it('exibe estado vazio na tab Historico quando nao ha turnos', async () => {
    setupMocks([])
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Meus Turnos')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(/Histórico/))

    await waitFor(() => {
      expect(screen.getByText('Seu histórico está vazio.')).toBeInTheDocument()
    })
  })
})

describe('MyJobs - Erro de autenticacao', () => {
  it('navega para login quando usuario nao autenticado', async () => {
    const mockNavigate = vi.fn()
    vi.mocked(useToast).mockReturnValue({ addToast: vi.fn(), removeToast: vi.fn() })
    vi.mocked(useNavigate).mockReturnValue(mockNavigate)
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: null },
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.getUser>>)

    renderComponent()

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login')
    })
  })
})

describe('MyJobs - Falar com a empresa', () => {
  it('cria a Conversation e navega ao clicar em "Falar com a empresa" (Em Andamento)', async () => {
    const { mockNavigate, conversationChain } = setupMocks([APP_IN_PROGRESS], {
      limit: vi.fn().mockResolvedValue({ data: [], error: null }), // nenhuma Conversation existente ainda
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    })
    renderComponent()

    fireEvent.click(await screen.findByText('Em Andamento'))
    const chatButton = await screen.findByRole('button', { name: /Falar com a empresa/i })
    fireEvent.click(chatButton)

    await waitFor(() => {
      expect(conversationChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ application_uuid: APP_IN_PROGRESS.id, islocked: false })
      )
    })
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/messages?conversation='))
    })
  })

  it('reusa a Conversation existente em vez de criar outra', async () => {
    const { mockNavigate, conversationChain } = setupMocks([APP_IN_PROGRESS], {
      limit: vi.fn().mockResolvedValue({ data: [{ id: 'conv-existing' }], error: null }),
    })
    renderComponent()

    fireEvent.click(await screen.findByText('Em Andamento'))
    const chatButton = await screen.findByRole('button', { name: /Falar com a empresa/i })
    fireEvent.click(chatButton)

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/messages?conversation=conv-existing')
    })
    expect(conversationChain.insert).not.toHaveBeenCalled()
  })

  it('mostra "Falar com a empresa" também na aba Agendados', async () => {
    const scheduledApp: ApplicationRow = {
      ...APP_IN_PROGRESS,
      id: 'app-4',
      status: 'hired',
      worker_checkin_at: null,
      job: { ...APP_IN_PROGRESS.job!, start_date: '2099-01-01' },
    }
    setupMocks([scheduledApp])
    renderComponent()

    fireEvent.click(await screen.findByText('Agendados'))

    expect(await screen.findByRole('button', { name: /Falar com a empresa/i })).toBeInTheDocument()
  })
})
