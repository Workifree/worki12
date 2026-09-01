import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Dashboard from './Dashboard'

// ---------------------------------------------------------------------------
// F7 — R14/A10: CTA de disponibilidade no Dashboard. BLOCKER da revisão de frontend: o CTA
// precisa aparecer SÓ enquanto `availability_days IS NULL` (nunca declarou) e sumir assim que
// existir QUALQUER grade com pelo menos um período dentro. Cobre os DOIS lados — um teste que só
// prova "aparece" não prova A10 (o critério exige aparecer E sumir corretamente). O caso `{}`
// (objeto vazio, aceito pelo CHECK do banco por containment — achado do security-reviewer) é
// tratado como equivalente a "nunca declarou": sem isso, um freela com `{}` gravado por qualquer
// caminho perderia o CTA sem nunca ter declarado nada.
// ---------------------------------------------------------------------------

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(),
  },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

vi.mock('../components/PageMeta', () => ({
  default: () => null,
}))

vi.mock('../hooks/useShiftInvites', () => ({
  useWorkerInvites: () => ({
    pendingInvites: [],
    loading: false,
    respondingId: null,
    respond: vi.fn(),
  }),
}))

vi.mock('../hooks/useTeamConnections', () => ({
  useWorkerStores: () => ({
    myStores: [],
    pendingConnections: [],
    loading: false,
  }),
}))

import { supabase } from '../lib/supabase'

function workerRow(availabilityDays: unknown) {
  return {
    id: 'worker-1',
    full_name: 'Freela Teste',
    avatar_url: null,
    level: 1,
    xp: 0,
    earnings_total: 0,
    rating_average: null,
    completed_jobs_count: 0,
    roles: [],
    primary_role: null,
    availability_days: availabilityDays,
  }
}

/** `.from('workers').select('*').eq('id', userId).single()` — encadeável. */
function workersFromChain(row: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: row, error: null }),
      }),
    }),
  }
}

/** `.from('applications').select(...).eq(...).in(...)` (nextJob) e com `.order().limit()` (history). */
function applicationsFromChain() {
  const emptyResult = Promise.resolve({ data: [], error: null })
  const chain = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          // nextJob: `await ...in(...)` resolve direto
          then: emptyResult.then.bind(emptyResult),
          // history: `.in(...).order(...).limit(...)`
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    }),
  }
  return chain
}

/** `.from('shift_payments').select(...).eq(...).eq(...).is(...)` — pagamentos aguardando confirmação. */
function shiftPaymentsFromChain(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      }),
    }),
  }
}

function setupMocks(availabilityDays: unknown, pendingReceipts: unknown[] = []) {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: 'worker-1', email_confirmed_at: '2026-01-01T00:00:00Z' } },
    error: null,
  } as never)

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === 'workers') return workersFromChain(workerRow(availabilityDays)) as never
    if (table === 'applications') return applicationsFromChain() as never
    if (table === 'shift_payments') return shiftPaymentsFromChain(pendingReceipts) as never
    throw new Error(`tabela não mockada: ${table}`)
  })
}

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>,
  )
}

// Escopo de unidade (F13): os servicos passaram a resolver a empresa OPERADA pelo seam, em vez
// de `.eq('owner_id', user.id)`. O duble evita bater na RPC get_my_companies nos testes.
vi.mock('../services/companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
  getMyCompanies: vi.fn().mockResolvedValue([{ company_id: 'company-1' }]),
}))

describe('Dashboard — CTA de disponibilidade (F7 R14/A10)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('aparece quando availability_days é NULL (nunca declarou)', async () => {
    setupMocks(null)
    renderDashboard()

    expect(
      await screen.findByText(/declare sua disponibilidade/i),
    ).toBeInTheDocument()
  })

  it('aparece quando availability_days é {} (vazio, equivalente a nunca declarado)', async () => {
    setupMocks({})
    renderDashboard()

    expect(
      await screen.findByText(/declare sua disponibilidade/i),
    ).toBeInTheDocument()
  })

  it('some quando existe grade com pelo menos um período declarado', async () => {
    setupMocks({ '1': ['manha'] })
    renderDashboard()

    // Espera a tela terminar de carregar (sai do skeleton) antes de afirmar ausência.
    await waitFor(() => {
      expect(screen.getByText(/próximo turno/i)).toBeInTheDocument()
    })

    expect(screen.queryByText(/declare sua disponibilidade/i)).not.toBeInTheDocument()
  })
})

// ── Indicador persistente do pagamento a confirmar ─────────────────────────────────────────
// "Pagamento registrado — confirme" só existia como NOTIFICAÇÃO — transitória por definição
// (NN/g, Indicators/Validations/Notifications). O card no Início é a casa persistente da ação:
// quem perdeu a notificação continua encontrando o caminho. Estes testes fixam (a) que o card
// aparece com o valor e o nome da empresa quando há pagamento 'recorded' sem confirmação, e
// (b) que ele NÃO aparece quando não há — o Início não pode gritar à toa.
describe('Dashboard — pagamento aguardando confirmação (indicador persistente)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mostra o card com valor e empresa quando há pagamento registrado sem confirmação', async () => {
    setupMocks({ '1': ['tarde'] }, [
      { job_id: 'job-9', amount: 180, job: { title: 'Garçom sábado', company: { name: 'Cantina da Ana' } } },
    ])
    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText('Pagamento para confirmar')).toBeInTheDocument()
    })
    expect(screen.getByText(/R\$\s*180,00/)).toBeInTheDocument()
    expect(screen.getByText(/Cantina da Ana registrou este pagamento/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirmar recebimento/i })).toBeInTheDocument()
  })

  it('não mostra nada quando não há pagamento pendente', async () => {
    setupMocks({ '1': ['tarde'] }, [])
    renderDashboard()

    await waitFor(() => {
      expect(screen.queryByText(/carregando/i)).not.toBeInTheDocument()
    })
    expect(screen.queryByText('Pagamento para confirmar')).not.toBeInTheDocument()
  })
})
