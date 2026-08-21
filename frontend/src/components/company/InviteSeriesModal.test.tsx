import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import InviteSeriesModal from './InviteSeriesModal'
import type { InviteSeriesTarget } from './seriesWeekRisk'
import type { TeamMember } from '../../types'

// ---------------------------------------------------------------------------
// F5-04 (revisão de frontend) — zero teste de componente cobria a fiação da guarda de vínculo
// no `InviteSeriesModal`: o split da chave composta `${workerId}|${weekStart}` devolvida por
// `countForRange`, o range (min/max) derivado de `targets`, e o gating por `riskEnabled`. Um bug
// em qualquer um dos três passaria batido pela suíte anterior.
// ---------------------------------------------------------------------------

const mockAddToast = vi.fn()
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }),
}))

const mockUseCompanyTeam = vi.fn()
vi.mock('../../hooks/useTeamConnections', () => ({
  useCompanyTeam: (...args: unknown[]) => mockUseCompanyTeam(...args),
}))

const mockCreateShiftCall = vi.fn()
vi.mock('../../services/shiftCallService', () => ({
  ShiftCallService: {
    createShiftCall: (...args: unknown[]) => mockCreateShiftCall(...args),
  },
}))

const mockGetConfig = vi.fn()
const mockCountForRange = vi.fn()
vi.mock('../../services/linkRiskService', () => ({
  LinkRiskService: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args),
    countForRange: (...args: unknown[]) => mockCountForRange(...args),
  },
}))

function member(id: string, fullName: string): TeamMember {
  return {
    connection: {
      id: `conn-${id}`,
      company_id: 'company-1',
      worker_id: id,
      status: 'accepted',
      source: 'phone',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    worker: {
      id,
      full_name: fullName,
      primary_role: 'Garçom',
      rating_average: 4.5,
      completed_jobs_count: 1,
      city: 'São Paulo',
    },
  }
}

// Uma única ocorrência-alvo, numa semana cujo domingo é 2026-08-16 (quarta 2026-08-19 cai
// naquela semana). `weeksOverThreshold` soma esta ocorrência à carga preexistente.
const TARGETS: InviteSeriesTarget[] = [{ jobId: 'job-1', occurrenceDate: '2026-08-19' }]

function renderModal(targets: InviteSeriesTarget[] = TARGETS) {
  return render(<InviteSeriesModal targets={targets} onClose={vi.fn()} onDone={vi.fn()} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCountForRange.mockResolvedValue(new Map())
  mockGetConfig.mockResolvedValue({ enabled: true, threshold: 2 })
})

describe('InviteSeriesModal — fiação da guarda de vínculo (F5)', () => {
  it('faz o split correto da chave composta workerId|weekStart e soma à carga da série (selo por freela)', async () => {
    const members = [member('w1', 'Karina'), member('w2', 'Leandro')]
    mockUseCompanyTeam.mockReturnValue({ teamMembers: members, loading: false })
    mockGetConfig.mockResolvedValueOnce({ enabled: true, threshold: 2 })
    // w1 já tem 2 confirmados na semana de 16/08; w2 não tem carga preexistente naquela semana.
    mockCountForRange.mockResolvedValueOnce(
      new Map([
        ['w1|2026-08-16', 2],
        ['w2|2026-08-23', 5], // semana DIFERENTE — não deve contaminar a semana de w1/dos targets
      ]),
    )

    renderModal()

    // w1: 1 (ocorrência-alvo) + 2 (preexistente) = 3, > threshold(2) → selo aparece.
    await waitFor(() => {
      expect(screen.getByText(/Ficaria 3x com você na sem\. 16\/08 a 22\/08/)).toBeInTheDocument()
    })
    // w2: preexistente é de OUTRA semana (23/08), não soma à semana dos targets (16/08) — sem selo.
    expect(screen.queryByText(/Ficaria \dx com você na sem\. 23\/08/)).not.toBeInTheDocument()
  })

  it('deriva o range para countForRange do min/max das ocorrências-alvo (mesmo fora de ordem)', async () => {
    const members = [member('w1', 'Marcia')]
    mockUseCompanyTeam.mockReturnValue({ teamMembers: members, loading: false })
    const unsortedTargets: InviteSeriesTarget[] = [
      { jobId: 'job-3', occurrenceDate: '2026-09-06' },
      { jobId: 'job-1', occurrenceDate: '2026-08-16' },
      { jobId: 'job-2', occurrenceDate: '2026-08-23' },
    ]

    renderModal(unsortedTargets)

    await waitFor(() => {
      expect(mockCountForRange).toHaveBeenCalledWith(['w1'], '2026-08-16', '2026-09-06')
    })
  })

  it('riskEnabled=false: nenhum selo aparece mesmo com carga preexistente estourada, e o rodapé de config some', async () => {
    const members = [member('w1', 'Nadia')]
    mockUseCompanyTeam.mockReturnValue({ teamMembers: members, loading: false })
    mockGetConfig.mockResolvedValueOnce({ enabled: false, threshold: 2 })
    mockCountForRange.mockResolvedValueOnce(new Map([['w1|2026-08-16', 10]]))

    renderModal()

    await screen.findByText('Nadia')
    await waitFor(() => {
      expect(mockCountForRange).toHaveBeenCalled()
    })
    expect(screen.queryByText(/Ficaria/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Sua empresa avisa a partir de/)).not.toBeInTheDocument()
  })
})
