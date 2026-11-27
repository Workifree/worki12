import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import CompanyJobDetails from './CompanyJobDetails'

// Mock WalletService — must not reference outer variables in factory
vi.mock('../../services/walletService', () => ({
  WalletService: {
    refundEscrow: vi.fn().mockResolvedValue({ success: true }),
  },
}))

// Mock supabase — factory with only inline vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(),
  },
}))

vi.mock('../../contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ addToast: vi.fn(), removeToast: vi.fn() })),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: vi.fn(() => vi.fn()),
  }
})

import { supabase } from '../../lib/supabase'
import { WalletService } from '../../services/walletService'
import { useToast } from '../../contexts/ToastContext'
import { useNavigate } from 'react-router-dom'

// F13: as paginas de empresa resolvem a unidade OPERADA (gerente nao e dono, e `user.id`
// deixou de servir como company_id). O duble evita bater na RPC get_my_companies.
vi.mock('../../services/companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
  // useCurrentCompany (papel de quem cancela o turno): sem empresa no cenário.
  getMyCompanies: vi.fn().mockResolvedValue([]),
  pickCurrentCompany: () => null,
  subscribeCompanyScope: () => () => undefined,
  isGestor: () => true,
  hasTeamNav: () => false,
}))

const JOB_DATA = {
  id: 'job-1',
  title: 'Garcom para Evento',
  description: 'Descricao do turno',
  requirements: 'Requisitos',
  category: 'Eventos',
  type: 'freelance',
  location: 'São Paulo',
  budget: 150,
  budget_type: 'daily',
  scope: 'single',
  status: 'open',
  created_at: new Date().toISOString(),
  start_date: '2026-08-20',
}

// applications: thenable encadeável para as duas leituras de contagem — `.select(...).eq('job_id',id)`
// (candidates_count, terminal) e `.select(...).eq('job_id',id).in('status',[...])` (activeWorkersCount).
function applicationsReadThenable(result: { count: number; error: unknown } = { count: 0, error: null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {}
  obj.eq = vi.fn(() => obj)
  obj.in = vi.fn(() => obj)
  obj.then = (onFulfilled?: (v: typeof result) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected)
  return obj
}

// applications: `.update({status:'cancelled'}).eq('job_id',id).in('status',[...]).select('id')` —
// `.select('id')` obrigatório (patterns.md), termina a cadeia resolvendo {data, error}.
function applicationsUpdateChain(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  return {
    eq: vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue(result),
      }),
    }),
  }
}

// jobs: `.update({status}).eq('id',id).select('id')` — `.select('id')` obrigatório (patterns.md).
function jobsUpdateChain(result: { data: unknown; error: unknown } = { data: [{ id: 'job-1' }], error: null }) {
  return {
    eq: vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue(result),
    }),
  }
}

function setupMocks(jobData: Record<string, unknown> = JOB_DATA) {
  const mockAddToast = vi.fn()
  const mockNavigate = vi.fn()
  vi.mocked(useToast).mockReturnValue({ addToast: mockAddToast, removeToast: vi.fn() })
  vi.mocked(useNavigate).mockReturnValue(mockNavigate)

  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: 'company-user-1' } },
    error: null,
  } as Awaited<ReturnType<typeof supabase.auth.getUser>>)

  const jobsChain = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: jobData, error: null }),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue(jobsUpdateChain()),
  }

  const applicationsChain = {
    select: vi.fn(() => applicationsReadThenable()),
    update: vi.fn().mockReturnValue(applicationsUpdateChain()),
  }

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === 'jobs') return jobsChain as unknown as ReturnType<typeof supabase.from>
    if (table === 'applications') return applicationsChain as unknown as ReturnType<typeof supabase.from>
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() } as unknown as ReturnType<typeof supabase.from>
  })

  return { mockAddToast, mockNavigate, jobsChain, applicationsChain }
}

/** Resposta da RPC `cancel_job` (a exclusão passa por ela). */
function mockCancelJob(outcome: string, cancelledApplications = 0) {
  vi.mocked(supabase.rpc).mockResolvedValue({
    data: { outcome, cancelled_applications: cancelledApplications, cancelled_calls: 0, closed_candidates: 0 },
    error: null,
  } as never)
}

function renderComponent() {
  return render(
    <MemoryRouter initialEntries={['/company/jobs/job-1']}>
      <Routes>
        <Route path="/company/jobs/:id" element={<CompanyJobDetails />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCancelJob('cancelled')
})

describe('CompanyJobDetails — pausar/reativar (alto risco)', () => {
  it('atualiza o status quando o UPDATE afeta 1 linha', async () => {
    const { jobsChain } = setupMocks()
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Garcom para Evento')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /mais opções do turno/i }))

    await waitFor(() => {
      expect(screen.getByText('Pausar')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Pausar'))

    await waitFor(() => {
      expect(jobsChain.update).toHaveBeenCalledWith({ status: 'paused' })
    })
  })

  it('mostra erro visível quando o UPDATE de status afeta 0 linhas (RLS negou em silêncio)', async () => {
    const { mockAddToast, jobsChain } = setupMocks()
    jobsChain.update = vi.fn().mockReturnValue(jobsUpdateChain({ data: [], error: null }))
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'jobs') return jobsChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'applications') {
        return { select: vi.fn(() => applicationsReadThenable()), update: vi.fn().mockReturnValue(applicationsUpdateChain()) } as unknown as ReturnType<typeof supabase.from>
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() } as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Garcom para Evento')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /mais opções do turno/i }))

    await waitFor(() => {
      expect(screen.getByText('Pausar')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Pausar'))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Não foi possível atualizar o turno: verifique se você ainda tem permissão sobre ele.',
        'error'
      )
    })
  })
})

describe('CompanyJobDetails — excluir turno (alto risco)', () => {
  it('exclui pela RPC cancel_job, mostra sucesso e navega', async () => {
    const { mockAddToast, mockNavigate } = setupMocks()
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Garcom para Evento')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /mais opções do turno/i }))

    await waitFor(() => {
      expect(screen.getByText('Excluir')).toBeInTheDocument()
    })
    // D-8: dono único (sem equipe) não ganha "Cancelar turno"
    expect(screen.queryByText('Cancelar turno')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Excluir'))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Excluir Turno/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Turno excluído.', 'success')
    })
    expect(mockNavigate).toHaveBeenCalledWith('/company/jobs')
  })

  it('mostra o motivo (não sucesso mentiroso) quando cancel_job recusa', async () => {
    const { mockAddToast, mockNavigate, jobsChain } = setupMocks()
    jobsChain.update = vi.fn().mockReturnValue(jobsUpdateChain({ data: [], error: null }))
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'jobs') return jobsChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'applications') {
        return { select: vi.fn(() => applicationsReadThenable()), update: vi.fn().mockReturnValue(applicationsUpdateChain()) } as unknown as ReturnType<typeof supabase.from>
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() } as unknown as ReturnType<typeof supabase.from>
    })

    mockCancelJob('forbidden')
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Garcom para Evento')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /mais opções do turno/i }))

    await waitFor(() => {
      expect(screen.getByText('Excluir')).toBeInTheDocument()
    })
    // D-8: dono único (sem equipe) não ganha "Cancelar turno"
    expect(screen.queryByText('Cancelar turno')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Excluir'))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Excluir Turno/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.any(String),
        'error'
      )
    })
    expect(mockAddToast).not.toHaveBeenCalledWith('Turno excluído.', 'success')
    expect(mockNavigate).not.toHaveBeenCalledWith('/company/jobs')
  })
})

describe('CompanyJobDetails — cancelar candidaturas ao excluir (lote — 0 linhas é legítimo)', () => {
  it('exclui com sucesso mesmo quando NENHUMA application é cancelada (turno sem ninguém contratado)', async () => {
    const { mockAddToast } = setupMocks()
    // Default já resolve `applications.update(...).select('id')` com data: [] — nenhum freela contratado.
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Garcom para Evento')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /mais opções do turno/i }))

    await waitFor(() => {
      expect(screen.getByText('Excluir')).toBeInTheDocument()
    })
    // D-8: dono único (sem equipe) não ganha "Cancelar turno"
    expect(screen.queryByText('Cancelar turno')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Excluir'))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Excluir Turno/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    // 0 freelas cancelados NÃO produz nenhum toast de erro — é legítimo, a mensagem
    // permanece a genérica (sem contagem).
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Turno excluído.', 'success')
    })
  })

  it('ajusta a mensagem de sucesso quando N applications são de fato canceladas', async () => {
    const { mockAddToast, applicationsChain } = setupMocks()
    applicationsChain.update = vi.fn().mockReturnValue(
      applicationsUpdateChain({ data: [{ id: 'app-1' }, { id: 'app-2' }], error: null })
    )
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'jobs') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: JOB_DATA, error: null }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue(jobsUpdateChain()),
        } as unknown as ReturnType<typeof supabase.from>
      }
      if (table === 'applications') return applicationsChain as unknown as ReturnType<typeof supabase.from>
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() } as unknown as ReturnType<typeof supabase.from>
    })

    mockCancelJob('cancelled', 2)
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Garcom para Evento')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /mais opções do turno/i }))

    await waitFor(() => {
      expect(screen.getByText('Excluir')).toBeInTheDocument()
    })
    // D-8: dono único (sem equipe) não ganha "Cancelar turno"
    expect(screen.queryByText('Cancelar turno')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Excluir'))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Excluir Turno/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Turno cancelado. 2 freelas avisados.', 'success')
    })
    // sem escrow reservado: nada de estorno
    expect(WalletService.refundEscrow).not.toHaveBeenCalled()
    expect(supabase.rpc).toHaveBeenCalledWith('cancel_job', { p_job_id: 'job-1', p_reason: null })
  })
})

describe('CompanyJobDetails — turno que a pessoa não enxerga (RLS)', () => {
  function setupBlocked(error: unknown) {
    setupMocks()
    const jobsChain = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error }),
          }),
        }),
      }),
    }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'jobs') return jobsChain as unknown as ReturnType<typeof supabase.from>
      return { select: vi.fn(() => applicationsReadThenable()) } as unknown as ReturnType<typeof supabase.from>
    })
  }

  it('0 linhas (PGRST116/406) mostra "Turno indisponível" sem "Tentar de novo"', async () => {
    setupBlocked({ code: 'PGRST116', status: 406, message: 'The result contains 0 rows' })
    renderComponent()
    expect(await screen.findByText('Turno indisponível')).toBeInTheDocument()
    expect(screen.getByText(/não tem acesso a este turno ou ele foi removido/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Voltar para Turnos' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /tentar de novo/i })).toBeNull()
    expect(screen.queryByText(/verifique sua conexão/i)).toBeNull()
  })

  it('falha de rede real mantém a mensagem de conexão com "Tentar de novo"', async () => {
    setupBlocked({ message: 'Failed to fetch' })
    renderComponent()
    expect(await screen.findByRole('button', { name: /tentar de novo/i })).toBeInTheDocument()
    expect(screen.queryByText('Turno indisponível')).toBeNull()
  })
})
