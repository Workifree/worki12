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
})

describe('CompanyJobDetails — pausar/reativar (alto risco)', () => {
  it('atualiza o status quando o UPDATE afeta 1 linha', async () => {
    const { jobsChain } = setupMocks()
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Garcom para Evento')).toBeInTheDocument()
    })

    const menuButtons = screen.getAllByRole('button')
    const moreButton = menuButtons.find(b => b.querySelector('.lucide-ellipsis') || b.className.includes('border-transparent'))
    fireEvent.click(moreButton!)

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

    const menuButtons = screen.getAllByRole('button')
    const moreButton = menuButtons.find(b => b.className.includes('border-transparent'))
    fireEvent.click(moreButton!)

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
  it('mostra sucesso e navega quando o UPDATE de exclusão afeta 1 linha', async () => {
    const { mockAddToast, mockNavigate } = setupMocks()
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Garcom para Evento')).toBeInTheDocument()
    })

    const menuButtons = screen.getAllByRole('button')
    const moreButton = menuButtons.find(b => b.className.includes('border-transparent'))
    fireEvent.click(moreButton!)

    await waitFor(() => {
      expect(screen.getByText('Excluir')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Excluir'))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Excluir Turno/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Turno excluído com sucesso.', 'success')
    })
    expect(mockNavigate).toHaveBeenCalledWith('/company/jobs')
  })

  it('mostra erro visível (não sucesso mentiroso) quando o UPDATE de exclusão afeta 0 linhas (RLS negou em silêncio)', async () => {
    const { mockAddToast, mockNavigate, jobsChain } = setupMocks()
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

    const menuButtons = screen.getAllByRole('button')
    const moreButton = menuButtons.find(b => b.className.includes('border-transparent'))
    fireEvent.click(moreButton!)

    await waitFor(() => {
      expect(screen.getByText('Excluir')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Excluir'))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Excluir Turno/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Não foi possível excluir o turno. Verifique se você ainda tem permissão sobre ele.',
        'error'
      )
    })
    expect(mockAddToast).not.toHaveBeenCalledWith('Turno excluído com sucesso.', 'success')
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

    const menuButtons = screen.getAllByRole('button')
    const moreButton = menuButtons.find(b => b.className.includes('border-transparent'))
    fireEvent.click(moreButton!)

    await waitFor(() => {
      expect(screen.getByText('Excluir')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Excluir'))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Excluir Turno/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    // 0 freelas cancelados NÃO produz nenhum toast de erro — é legítimo, a mensagem
    // permanece a genérica (sem contagem).
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Turno excluído com sucesso.', 'success')
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

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Garcom para Evento')).toBeInTheDocument()
    })

    const menuButtons = screen.getAllByRole('button')
    const moreButton = menuButtons.find(b => b.className.includes('border-transparent'))
    fireEvent.click(moreButton!)

    await waitFor(() => {
      expect(screen.getByText('Excluir')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Excluir'))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Excluir Turno/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Turno excluído com sucesso. 2 freelas notificados.', 'success')
    })
    expect(WalletService.refundEscrow).toHaveBeenCalled()
  })
})
