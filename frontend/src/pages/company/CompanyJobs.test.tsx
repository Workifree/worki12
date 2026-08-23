import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { groupJobsByDay } from '../../lib/jobScheduling'
import CompanyJobs from './CompanyJobs'

// Mock WalletService — must not reference outer variables in factory
vi.mock('../../services/walletService', () => ({
  WalletService: {
    refundEscrow: vi.fn().mockResolvedValue({ success: true }),
  },
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
}))

vi.mock('../../contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ addToast: vi.fn(), removeToast: vi.fn() })),
}))

// Elenco/convites não são o foco destes testes — stub simples evita puxar supabase interno dos hooks.
vi.mock('../../hooks/useTeamConnections', () => ({
  useCompanyTeam: () => ({ teamMembers: [], pendingConnections: [], loading: false, companyId: 'company-1', addWorker: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('../../hooks/useShiftInvites', () => ({
  useCompanyInvites: () => ({ invites: [], loading: false, invitingWorkerId: null, invite: vi.fn() }),
}))

import { supabase } from '../../lib/supabase'
import { WalletService } from '../../services/walletService'
import { useToast } from '../../contexts/ToastContext'

// F13: as paginas de empresa resolvem a unidade OPERADA (gerente nao e dono, e `user.id`
// deixou de servir como company_id). O duble evita bater na RPC get_my_companies.
vi.mock('../../services/companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
}))

const JOB_DATA = {
  id: 'job-1',
  title: 'Garcom para Evento',
  type: 'freelance',
  status: 'open',
  location: 'São Paulo',
  created_at: new Date().toISOString(),
  // RELATIVO ao relógio, nunca uma data absoluta. `CompanyJobs` chama `groupJobsByDay` SEM
  // `referenceDate` (usa `new Date()`), e o bucket "Anteriores" nasce RECOLHIDO — uma data
  // fixa no futuro vira passado com o tempo, o turno some da tela e estes testes quebram
  // sozinhos, sem ninguém ter tocado no código. Foi o que aconteceu: '2026-08-20' era futuro
  // quando este arquivo foi escrito. É a mesma regra que o bloco de `groupJobsByDay` mais
  // abaixo já enuncia ("NUNCA `new Date()` real") — lá resolvida por injeção de referência,
  // aqui impossível porque o componente não expõe esse parâmetro.
  start_date: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
}

// jobs: `.update({status}).eq('id',id).select('id')` — `.select('id')` obrigatório (patterns.md).
function jobsUpdateChain(result: { data: unknown; error: unknown } = { data: [{ id: 'job-1' }], error: null }) {
  return { eq: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue(result) }) }
}

// applications: `.update({status:'cancelled'}).eq('job_id',id).in('status',[...]).select('id')`.
function applicationsUpdateChain(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  return {
    eq: vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue(result) }),
    }),
  }
}

function setupMocks() {
  const mockAddToast = vi.fn()
  vi.mocked(useToast).mockReturnValue({ addToast: mockAddToast, removeToast: vi.fn() })

  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: 'company-user-1' } },
    error: null,
  } as Awaited<ReturnType<typeof supabase.auth.getUser>>)

  const jobsChain = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        neq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [JOB_DATA], error: null }),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue(jobsUpdateChain()),
  }

  const applicationsChain = {
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
    update: vi.fn().mockReturnValue(applicationsUpdateChain()),
  }

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === 'jobs') return jobsChain as unknown as ReturnType<typeof supabase.from>
    if (table === 'applications') return applicationsChain as unknown as ReturnType<typeof supabase.from>
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() } as unknown as ReturnType<typeof supabase.from>
  })

  return { mockAddToast, jobsChain, applicationsChain }
}

function renderComponent() {
  return render(
    <MemoryRouter initialEntries={['/company/jobs']}>
      <CompanyJobs />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CompanyJobs — pausar/reativar (alto risco)', () => {
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

describe('CompanyJobs — excluir turno (alto risco)', () => {
  it('mostra sucesso quando o UPDATE de exclusão afeta 1 linha', async () => {
    const { mockAddToast } = setupMocks()
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Garcom para Evento')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /mais opções do turno/i }))
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
  })

  it('mostra erro visível (não sucesso mentiroso) quando o UPDATE de exclusão afeta 0 linhas (RLS negou em silêncio)', async () => {
    const { mockAddToast, jobsChain } = setupMocks()
    jobsChain.update = vi.fn().mockReturnValue(jobsUpdateChain({ data: [], error: null }))

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Garcom para Evento')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /mais opções do turno/i }))
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
  })
})

describe('CompanyJobs — cancelar candidaturas ao excluir (lote — 0 linhas é legítimo)', () => {
  it('exclui com sucesso mesmo quando NENHUMA application é cancelada (turno sem ninguém contratado)', async () => {
    const { mockAddToast } = setupMocks()
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Garcom para Evento')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /mais opções do turno/i }))
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
  })

  it('ajusta a mensagem de sucesso quando N applications são de fato canceladas', async () => {
    const { mockAddToast, applicationsChain } = setupMocks()
    applicationsChain.update = vi.fn().mockReturnValue(
      applicationsUpdateChain({ data: [{ id: 'app-1' }, { id: 'app-2' }], error: null })
    )

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Garcom para Evento')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /mais opções do turno/i }))
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

// Referência fixa (NUNCA `new Date()` real — vira o teste dependente do relógio do ambiente):
// sábado, 2026-08-16. Todo o teste é relativo a essa data, não à data de execução do CI.
const TODAY = new Date(2026, 7, 16) // mês 0-indexado: 7 = agosto

interface FakeJob {
  id: string
  start_date?: string | null
  work_start_time?: string | null
}

function job(id: string, start_date?: string | null, work_start_time?: string | null): FakeJob {
  return { id, start_date, work_start_time }
}

describe('groupJobsByDay — agenda por dia (CompanyJobs)', () => {
  it('caso de virada: turno de HOJE e turno de AMANHÃ vão para seções distintas', () => {
    const jobs = [job('hoje-1', '2026-08-16'), job('amanha-1', '2026-08-17')]
    const buckets = groupJobsByDay(jobs, TODAY)

    const today = buckets.find((b) => b.key === 'today')
    const tomorrow = buckets.find((b) => b.key === 'tomorrow')

    expect(today?.label).toBe('Hoje')
    expect(today?.jobs.map((j) => j.id)).toEqual(['hoje-1'])
    expect(tomorrow?.label).toBe('Amanhã')
    expect(tomorrow?.jobs.map((j) => j.id)).toEqual(['amanha-1'])
  })

  it('NÃO deixa o turno de amanhã cair na seção de hoje (regressão do off-by-one de fuso)', () => {
    const buckets = groupJobsByDay([job('amanha-1', '2026-08-17')], TODAY)
    const todayJobs = buckets.find((b) => b.key === 'today')?.jobs ?? []
    expect(todayJobs).toHaveLength(0)
  })

  it('turno sem start_date vai para "Sem Data" — nunca é escondido', () => {
    const buckets = groupJobsByDay([job('sem-data', null), job('sem-data-2', undefined)], TODAY)
    const noDate = buckets.find((b) => b.key === 'no_date')
    expect(noDate?.label).toBe('Sem Data')
    expect(noDate?.jobs).toHaveLength(2)
  })

  it('agrupa o restante da semana (2 a 6 dias à frente) em "Esta Semana", ordenado por data', () => {
    const jobs = [job('d5', '2026-08-21'), job('d2', '2026-08-18'), job('d6', '2026-08-22')]
    const buckets = groupJobsByDay(jobs, TODAY)
    const week = buckets.find((b) => b.key === 'week')
    expect(week?.label).toBe('Esta Semana')
    expect(week?.jobs.map((j) => j.id)).toEqual(['d2', 'd5', 'd6'])
  })

  it('turnos a mais de 6 dias vão para "Depois"', () => {
    const buckets = groupJobsByDay([job('longe', '2026-09-01')], TODAY)
    const later = buckets.find((b) => b.key === 'later')
    expect(later?.label).toBe('Depois')
    expect(later?.jobs.map((j) => j.id)).toEqual(['longe'])
  })

  it('turnos passados vão para "Anteriores", ordenados do mais recente para o mais antigo', () => {
    const jobs = [job('antigo', '2026-08-01'), job('recente', '2026-08-15')]
    const buckets = groupJobsByDay(jobs, TODAY)
    const past = buckets.find((b) => b.key === 'past')
    expect(past?.label).toBe('Anteriores')
    expect(past?.jobs.map((j) => j.id)).toEqual(['recente', 'antigo'])
  })

  it('não retorna seções vazias', () => {
    const buckets = groupJobsByDay([job('hoje-1', '2026-08-16')], TODAY)
    expect(buckets).toHaveLength(1)
    expect(buckets[0].key).toBe('today')
  })

  it('lista vazia não gera nenhuma seção', () => {
    expect(groupJobsByDay([], TODAY)).toEqual([])
  })

  it('ordena "Hoje" por horário de início (ascendente), não pela ordem de criação', () => {
    // Dois turnos no mesmo dia (almoço e jantar), inseridos fora de ordem.
    const jobs = [job('jantar', '2026-08-16', '18:00'), job('almoco', '2026-08-16', '11:00')]
    const buckets = groupJobsByDay(jobs, TODAY)
    const today = buckets.find((b) => b.key === 'today')
    expect(today?.jobs.map((j) => j.id)).toEqual(['almoco', 'jantar'])
  })

  it('ordena "Amanhã" por horário de início (ascendente)', () => {
    const jobs = [job('tarde', '2026-08-17', '15:00'), job('manha', '2026-08-17', '08:00')]
    const buckets = groupJobsByDay(jobs, TODAY)
    const tomorrow = buckets.find((b) => b.key === 'tomorrow')
    expect(tomorrow?.jobs.map((j) => j.id)).toEqual(['manha', 'tarde'])
  })

  it('turno de hoje sem horário definido cai para o fim, sem sumir da seção', () => {
    const jobs = [job('sem-horario', '2026-08-16', null), job('com-horario', '2026-08-16', '09:00')]
    const buckets = groupJobsByDay(jobs, TODAY)
    const today = buckets.find((b) => b.key === 'today')
    expect(today?.jobs.map((j) => j.id)).toEqual(['com-horario', 'sem-horario'])
  })

  it('preserva a ordem canônica das seções (Hoje, Amanhã, Esta Semana, Depois, Sem Data, Anteriores)', () => {
    const jobs = [
      job('past', '2026-08-01'),
      job('nodate', null),
      job('later', '2026-09-01'),
      job('week', '2026-08-19'),
      job('tomorrow', '2026-08-17'),
      job('today', '2026-08-16'),
    ]
    const buckets = groupJobsByDay(jobs, TODAY)
    expect(buckets.map((b) => b.key)).toEqual(['today', 'tomorrow', 'week', 'later', 'no_date', 'past'])
  })
})
