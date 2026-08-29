import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MyJobs from './MyJobs'

// ---------------------------------------------------------------------------
// Confirmação de véspera (D-1, F4) — card de resposta em UM toque em MyJobs.
//
// Mocka `AttendanceConfirmationService` e `ShiftInviteService` (via `useWorkerInvites`, hook
// que internamente usa `ShiftInviteService.listPendingInvites`) no molde dos testes já
// existentes do projeto (`CompanyTeam.test.tsx`, `CompanyJobCandidates.test.tsx`) — mock
// completo por módulo com `vi.fn()` inline na factory.
// ---------------------------------------------------------------------------

// Mock supabase — factory com só vi.fn() inline (padrão do projeto).
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
}))

vi.mock('../contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ addToast: vi.fn(), removeToast: vi.fn() })),
}))

vi.mock('../lib/logger', () => ({ logError: vi.fn() }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// `useWorkerInvites` (F1, convites push) — hook não editável neste território, mockado por
// completo com lista vazia: a aba "Convites" não é o alvo deste teste, e o card de confirmação
// de véspera fica FORA das abas (sempre visível), então não depende deste hook.
vi.mock('../hooks/useShiftInvites', () => ({
  useWorkerInvites: () => ({
    pendingInvites: [],
    loading: false,
    respondingId: null,
    respond: vi.fn(),
  }),
}))

// AttendanceConfirmationService (F4) — service não editável neste território, mockado por
// completo. `getMyPendingConfirmations`/`respondConfirmation` são sobrescritos por teste.
const mockGetMyPendingConfirmations = vi.fn()
const mockRespondConfirmation = vi.fn()
vi.mock('../services/attendanceConfirmationService', () => ({
  AttendanceConfirmationService: {
    getMyPendingConfirmations: (...args: unknown[]) => mockGetMyPendingConfirmations(...args),
    respondConfirmation: (...args: unknown[]) => mockRespondConfirmation(...args),
    requestConfirmation: vi.fn(),
    getConfirmationsForJob: vi.fn().mockResolvedValue([]),
  },
}))

import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'

// Cadeia "thenable" universal: qualquer método encadeado (`select`/`eq`/`not`/`order`/...)
// devolve o próprio objeto, e `await` no ponto final (seja `.order(...)` em `applications`, seja
// `.eq(...)` direto em `reviews`) resolve para o mesmo resultado configurado. `fetchJobs` em
// MyJobs.tsx usa dois formatos de cadeia diferentes (`reviews` termina em `.eq()`, `applications`
// termina em `.order()`) — um chain universal cobre os dois sem precisar de dois helpers.
function thenableChain(result: { data: unknown; error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {}
  const methods = ['select', 'eq', 'not', 'order', 'in', 'limit', 'update', 'insert', 'maybeSingle', 'single']
  methods.forEach((m) => {
    obj[m] = vi.fn(() => obj)
  })
  obj.then = (onFulfilled?: (v: typeof result) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected)
  return obj
}

const TOMORROW_ISO = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

// Application 'hired' com turno amanhã — vira `jobs.scheduled` em MyJobs (não é hoje, então não
// cai em `in_progress`). `id` (id da APPLICATION, não da vaga) precisa bater com
// `confirmation.application_id` para o card conseguir cruzar os dois e montar (empresa, data,
// horário, local) sem uma query extra.
const APPLICATION_ROW = {
  id: 'app-conf-1',
  status: 'hired',
  created_at: new Date().toISOString(),
  worker_checkin_at: null,
  worker_checkout_at: null,
  company_checkin_confirmed_at: null,
  company_checkout_confirmed_at: null,
  job: {
    id: 'job-1',
    title: 'Garçom para Evento',
    budget: 150,
    start_date: TOMORROW_ISO,
    work_start_time: '18:00',
    work_end_time: '23:00',
    location: 'Shopping ABC',
    company: { id: 'company-1', name: 'Divino Fogão', logo_url: null },
  },
}

const PENDING_CONFIRMATION = {
  id: 'sac-1',
  application_id: 'app-conf-1',
  job_id: 'job-1',
  worker_id: 'worker-1',
  source: 'auto' as const,
  requested_by: null,
  requested_at: new Date().toISOString(),
  response: null,
  responded_at: null,
}

function setupMocks(startDateIso: string = TOMORROW_ISO) {
  const applicationRow = {
    ...APPLICATION_ROW,
    job: { ...APPLICATION_ROW.job, start_date: startDateIso },
  }
  const mockAddToast = vi.fn()
  vi.mocked(useToast).mockReturnValue({ addToast: mockAddToast, removeToast: vi.fn() })

  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: 'worker-1' } },
    error: null,
  } as Awaited<ReturnType<typeof supabase.auth.getUser>>)

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === 'applications') {
      return thenableChain({ data: [applicationRow], error: null }) as unknown as ReturnType<typeof supabase.from>
    }
    if (table === 'reviews') {
      return thenableChain({ data: [], error: null }) as unknown as ReturnType<typeof supabase.from>
    }
    return thenableChain({ data: [], error: null }) as unknown as ReturnType<typeof supabase.from>
  })

  mockGetMyPendingConfirmations.mockResolvedValue([PENDING_CONFIRMATION])

  return { mockAddToast }
}

function renderComponent() {
  return render(
    <MemoryRouter>
      <MyJobs />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

// Escopo de unidade (F13): os servicos passaram a resolver a empresa OPERADA pelo seam, em vez
// de `.eq('owner_id', user.id)`. O duble evita bater na RPC get_my_companies nos testes.
vi.mock('../services/companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
  getMyCompanies: vi.fn().mockResolvedValue([{ company_id: 'company-1' }]),
}))

describe('MyJobs — Confirmação de véspera (D-1, F4)', () => {
  // REGRESSAO (achado navegando o produto, 23/08/2026): o titulo era o literal "Confirma seu
  // turno de amanhã?", mas `request_attendance_confirmation` aceita turno de ate 7 dias. Pedi
  // confirmacao de um turno de 28/08 no dia 23 e o app disse ao freela que o turno era AMANHA,
  // enquanto a notificacao do mesmo pedido dizia "28/08" — dois canais se contradizendo sobre
  // o dia de comparecer.
  it('turno a 5 dias mostra a DATA, nao "amanhã" (os dois canais tem de dizer o mesmo dia)', async () => {
    const em5dias = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    setupMocks(em5dias.toISOString())
    renderComponent()

    const diaMes = em5dias.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    await waitFor(() => {
      expect(screen.getByText(`Confirma seu turno de ${diaMes}?`)).toBeInTheDocument()
    })
    expect(screen.queryByText('Confirma seu turno de amanhã?')).not.toBeInTheDocument()
  })

  // ⚠️ O RELOGIO PRECISA SER CONGELADO AQUI, e o motivo e o proprio assunto do teste.
  //
  // A versao anterior fazia `new Date()` e somava DUAS HORAS. Entre 22h e a meia-noite isso
  // atravessa o dia civil: o turno passa a ser de AMANHA, o componente diz "amanha" -- corretamente
  // -- e o teste, que procura "hoje", quebra. Ele passava 22 horas por dia e falhava nas outras 2.
  // Descoberto as 23h42 de 28/08/2026, com a suite inteira verde no resto do dia.
  //
  // Mesma familia dos achados de ancora de meia-noite ja documentados no analytics (debito #18):
  // teste que depende do relogio da maquina nao esta testando o codigo, esta testando a hora.
  it('turno de HOJE diz "de hoje", nao a data seca', async () => {
    // `shouldAdvanceTime` mantem o relogio congelado para o COMPONENTE e ainda deixa o `waitFor`
    // e as promises do render andarem -- congelar sem isso trava a espera assincrona.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 7, 12, 9, 0, 0))   // 12/08/2026, 09h local: +2h nao vira o dia
    const hoje = new Date()
    hoje.setHours(hoje.getHours() + 2)
    setupMocks(hoje.toISOString())
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Confirma seu turno de hoje?')).toBeInTheDocument()
    })
    vi.useRealTimers()
  })

  it('mostra o card de confirmação pendente com os dados do turno de amanhã', async () => {
    setupMocks()
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Confirma seu turno de amanhã?')).toBeInTheDocument()
    })

    expect(screen.getByText('Garçom para Evento')).toBeInTheDocument()
    expect(screen.getByText('Divino Fogão')).toBeInTheDocument()
    expect(screen.getByText('Sim, vou')).toBeInTheDocument()
    expect(screen.getByText('Não vou poder')).toBeInTheDocument()
  })

  it('"Sim, vou" chama respondConfirmation com \'confirmed\' — UM toque, sem modal, e o card VIRA um badge (R7/A3, não some)', async () => {
    const { mockAddToast } = setupMocks()
    mockRespondConfirmation.mockResolvedValueOnce({ outcome: 'confirmed' })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Sim, vou')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Sim, vou'))

    await waitFor(() => {
      expect(mockRespondConfirmation).toHaveBeenCalledWith('app-conf-1', 'confirmed')
    })
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Presença confirmada! Bom turno.', 'success')
    })

    // R7/A3 (requisito duro): o card continua na tela — os botões viram um badge "Confirmado",
    // o freela consegue conferir "será que eu respondi?" sem precisar lembrar.
    await waitFor(() => {
      expect(screen.getByText('Confirmado')).toBeInTheDocument()
    })
    expect(screen.getByText('Confirma seu turno de amanhã?')).toBeInTheDocument()
    expect(screen.queryByText('Sim, vou')).not.toBeInTheDocument()
    expect(screen.queryByText('Não vou poder')).not.toBeInTheDocument()
  })

  it('"Não vou poder" chama respondConfirmation com \'cannot_attend\', e o card vira o badge "Avisou que não vai" (R7/A4, não some)', async () => {
    const { mockAddToast } = setupMocks()
    mockRespondConfirmation.mockResolvedValueOnce({ outcome: 'cannot_attend' })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Não vou poder')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Não vou poder'))

    await waitFor(() => {
      expect(mockRespondConfirmation).toHaveBeenCalledWith('app-conf-1', 'cannot_attend')
    })
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Empresa avisada que você não vai poder ir.', 'success')
    })

    await waitFor(() => {
      expect(screen.getByText('Avisou que não vai')).toBeInTheDocument()
    })
    expect(screen.getByText('Confirma seu turno de amanhã?')).toBeInTheDocument()
    expect(screen.queryByText('Sim, vou')).not.toBeInTheDocument()
    expect(screen.queryByText('Não vou poder')).not.toBeInTheDocument()
  })

  it("'already_responded' aparece como informação (toast 'info'), não como erro", async () => {
    const { mockAddToast } = setupMocks()
    mockRespondConfirmation.mockResolvedValueOnce({ outcome: 'already_responded' })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Sim, vou')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Sim, vou'))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Você já respondeu a este pedido.', 'info')
    })
    // Nunca reporta esse outcome como 'error' — duplo toque/retry não é uma falha do freela.
    expect(mockAddToast).not.toHaveBeenCalledWith(expect.any(String), 'error')

    // Badge neutro (não sabemos qual resposta REAL ficou gravada nesse outcome) — o card
    // continua na tela (R7), sem sugerir 'confirmed'/'cannot_attend' por palpite.
    await waitFor(() => {
      expect(screen.getByText('Você já respondeu')).toBeInTheDocument()
    })
    expect(screen.queryByText('Sim, vou')).not.toBeInTheDocument()
  })
})
