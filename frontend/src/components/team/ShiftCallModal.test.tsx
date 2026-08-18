import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ShiftCallModal } from './ShiftCallModal'
import type { TeamMember, TeamListWithMembers, Job } from '../../types'

// ---------------------------------------------------------------------------
// Cobertura da lógica de interseção do chip de lista (F2 — R9/R10/R11):
//  - contagem do chip é a de DISPONÍVEIS (filtra membro fora do elenco/já no turno), não o
//    total de membros salvos na lista;
//  - clique é toggle liga/desliga (todos disponíveis marcados → clique remove; senão, adiciona);
//  - clique é UNIÃO — não apaga seleção manual nem a de outro chip;
//  - chip sem nenhum disponível renderiza desabilitado com "(0)".
// ---------------------------------------------------------------------------

const mockAddToast = vi.fn()
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }),
}))

const mockListTeamMembers = vi.fn()
vi.mock('../../services/teamConnectionService', () => ({
  TeamConnectionService: {
    listTeamMembers: (...args: unknown[]) => mockListTeamMembers(...args),
  },
}))

const mockListLists = vi.fn()
vi.mock('../../services/teamListService', () => ({
  TeamListService: {
    listLists: (...args: unknown[]) => mockListLists(...args),
  },
}))

const mockCreateShiftCall = vi.fn()
vi.mock('../../services/shiftCallService', () => ({
  ShiftCallService: {
    createShiftCall: (...args: unknown[]) => mockCreateShiftCall(...args),
  },
  CALL_EXPIRY_PRESETS: [
    { value: 0.5, label: '30 minutos' },
    { value: 2, label: '2 horas' },
  ],
  DEFAULT_CALL_EXPIRY_HOURS: 2,
  calcExpiryAtShiftStart: vi.fn(() => '2026-08-20T00:00:00.000Z'),
}))

function worker(id: string, fullName: string, role = 'Cozinheiro'): TeamMember {
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
      primary_role: role,
      rating_average: 4.5,
      completed_jobs_count: 1,
      city: 'São Paulo',
    },
  }
}

function cozinhaList(memberIds: string[]): TeamListWithMembers {
  return {
    id: 'list-cozinha',
    company_id: 'company-1',
    name: 'Cozinha',
    created_by: 'owner-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    memberIds,
  }
}

const job: Pick<Job, 'id' | 'title' | 'start_date' | 'work_start_time'> & { slots?: number } = {
  id: 'job-1',
  title: 'Turno de sexta',
  start_date: '2026-08-21',
  work_start_time: '18:00',
  slots: 6,
}

function renderModal(props: { excludeWorkerIds?: string[] } = {}) {
  return render(
    <ShiftCallModal
      job={job}
      excludeWorkerIds={props.excludeWorkerIds ?? []}
      onClose={vi.fn()}
      onDispatched={vi.fn()}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ShiftCallModal — chips de listas salvas (F2)', () => {
  it('zero listas: nenhuma linha de chip aparece (comportamento visual intacto)', async () => {
    mockListTeamMembers.mockResolvedValue([worker('w1', 'Ana')])
    mockListLists.mockResolvedValue([])

    renderModal()

    await waitFor(() => {
      expect(screen.getByText('Ana')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /Cozinha/ })).not.toBeInTheDocument()
  })

  it('chip mostra a contagem de DISPONÍVEIS, ignorando membro que saiu do elenco (R10/R11)', async () => {
    // Lista salva tem 6 membros, mas só 5 seguem 'accepted' hoje (worker-6 saiu/bloqueou —
    // não aparece mais em listTeamMembers, que já filtra status='accepted').
    const members = [1, 2, 3, 4, 5].map((n) => worker(`w${n}`, `Freela ${n}`))
    mockListTeamMembers.mockResolvedValue(members)
    mockListLists.mockResolvedValue([cozinhaList(['w1', 'w2', 'w3', 'w4', 'w5', 'w6'])])

    renderModal()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cozinha (5)' })).toBeInTheDocument()
    })
  })

  it('chip exclui quem já está no turno atual (excludeWorkerIds) da contagem e da seleção (R10)', async () => {
    const members = [1, 2, 3, 4, 5, 6].map((n) => worker(`w${n}`, `Freela ${n}`))
    mockListTeamMembers.mockResolvedValue(members)
    mockListLists.mockResolvedValue([cozinhaList(['w1', 'w2', 'w3', 'w4', 'w5', 'w6'])])

    renderModal({ excludeWorkerIds: ['w6'] })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cozinha (5)' })).toBeInTheDocument()
    })
  })

  it('clique no chip seleciona só os disponíveis; clique de novo desseleciona SEM mexer em seleção manual fora da lista (toggle liga/desliga + A8)', async () => {
    // A8 exige explicitamente que desligar o chip não mexa em seleções manuais feitas fora
    // daquela lista — por isso este cenário já nasce com um outsider marcado manualmente,
    // igual ao teste de A12 (união), só que aqui o eixo verificado é o toggle-OFF.
    const outsider = worker('w-outsider', 'Fulano Fora Da Lista', 'Caixa')
    const members = [worker('w1', 'Freela 1'), worker('w2', 'Freela 2'), worker('w3', 'Freela 3'), outsider]
    mockListTeamMembers.mockResolvedValue(members)
    mockListLists.mockResolvedValue([cozinhaList(['w1', 'w2', 'w3'])])

    renderModal()

    await screen.findByText('Fulano Fora Da Lista')
    const outsiderRow = screen.getByText('Fulano Fora Da Lista').closest('label')
    expect(outsiderRow).not.toBeNull()
    const outsiderCheckbox = outsiderRow!.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(outsiderCheckbox)
    expect(outsiderCheckbox.checked).toBe(true)

    const chip = await screen.findByRole('button', { name: 'Cozinha (3)' })
    fireEvent.click(chip)

    // Os 3 da lista entram em UNIÃO com o outsider já marcado manualmente (4 no total).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Chamar 4 freelas/ })).toBeInTheDocument()
    })
    const listCheckboxes = ['Freela 1', 'Freela 2', 'Freela 3'].map(
      (name) => screen.getByText(name).closest('label')!.querySelector('input') as HTMLInputElement,
    )
    expect(listCheckboxes.every((c) => c.checked)).toBe(true)
    expect(outsiderCheckbox.checked).toBe(true)
    expect(chip).toHaveAttribute('aria-pressed', 'true')

    // Clique de novo (toggle-OFF): remove só os 3 da lista — o outsider, selecionado
    // manualmente fora da lista, permanece marcado (A8: não mexe em seleção manual).
    fireEvent.click(chip)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Enviar convite' })).toBeInTheDocument()
    })
    expect(listCheckboxes.every((c) => c.checked)).toBe(false)
    expect(outsiderCheckbox.checked).toBe(true)
    expect(chip).toHaveAttribute('aria-pressed', 'false')
  })

  it('clique no chip é UNIÃO: não apaga seleção manual feita fora da lista (R9/A12)', async () => {
    const outsider = worker('w-outsider', 'Fulano Fora Da Lista', 'Caixa')
    const members = [worker('w1', 'Freela 1'), worker('w2', 'Freela 2'), outsider]
    mockListTeamMembers.mockResolvedValue(members)
    mockListLists.mockResolvedValue([cozinhaList(['w1', 'w2'])])

    renderModal()

    // Seleciona manualmente o freela de fora da lista.
    await screen.findByText('Fulano Fora Da Lista')
    const outsiderRow = screen.getByText('Fulano Fora Da Lista').closest('label')
    expect(outsiderRow).not.toBeNull()
    const outsiderCheckbox = outsiderRow!.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(outsiderCheckbox)

    // Clica no chip "Cozinha" — soma os 2 da lista à seleção manual já feita.
    const chip = await screen.findByRole('button', { name: 'Cozinha (2)' })
    fireEvent.click(chip)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Chamar 3 freelas/ })).toBeInTheDocument()
    })
    expect(outsiderCheckbox.checked).toBe(true)
  })

  it('lista com zero disponíveis renderiza chip desabilitado com "(0)" (R10/A11)', async () => {
    mockListTeamMembers.mockResolvedValue([worker('w-other', 'Outro Freela')])
    // Nenhum dos memberIds da lista "Chapa" está mais no elenco disponível.
    mockListLists.mockResolvedValue([
      { ...cozinhaList(['w-gone-1', 'w-gone-2']), id: 'list-chapa', name: 'Chapa' },
    ])

    renderModal()

    const chip = await screen.findByRole('button', { name: 'Chapa (0)' })
    expect(chip).toBeDisabled()
    fireEvent.click(chip)
    expect(screen.getByRole('button', { name: 'Selecione os freelas' })).toBeInTheDocument()
  })
})
