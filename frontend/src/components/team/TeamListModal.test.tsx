import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { TeamListModal } from './TeamListModal'
import type { TeamMember, TeamListWithMembers } from '../../types'

const mockAddToast = vi.fn()
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }),
}))

const mockCreateList = vi.fn()
const mockRenameList = vi.fn()
const mockSetMembers = vi.fn()
vi.mock('../../services/teamListService', () => ({
  TeamListService: {
    createList: (...args: unknown[]) => mockCreateList(...args),
    renameList: (...args: unknown[]) => mockRenameList(...args),
    setMembers: (...args: unknown[]) => mockSetMembers(...args),
    deleteList: vi.fn(),
    listLists: vi.fn(),
  },
}))

function worker(id: string, fullName: string, role = 'Garçom'): TeamMember {
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

const teamMembers = [worker('w1', 'Ana Silva'), worker('w2', 'Bruno Costa')]

beforeEach(() => {
  vi.clearAllMocks()
})

// Escopo de unidade (F13): os servicos passaram a resolver a empresa OPERADA pelo seam, em vez
// de `.eq('owner_id', user.id)`. O duble evita bater na RPC get_my_companies nos testes.
vi.mock('../../services/companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
  getMyCompanies: vi.fn().mockResolvedValue([{ company_id: 'company-1' }]),
}))

describe('TeamListModal — criação', () => {
  it('salvar com nome + membros marcados chama createList(name, workerIds) e fecha', async () => {
    mockCreateList.mockResolvedValue({ list: { id: 'list-1', name: 'Cozinha' } })
    const onSaved = vi.fn()
    const onClose = vi.fn()

    render(<TeamListModal teamMembers={teamMembers} onClose={onClose} onSaved={onSaved} />)

    expect(screen.getByText('Nova Lista')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Nome da lista'), { target: { value: 'Cozinha' } })
    fireEvent.click(screen.getByText('Ana Silva').closest('label')!.querySelector('input')!)

    fireEvent.click(screen.getByRole('button', { name: /Salvar/ }))

    await waitFor(() => {
      expect(mockCreateList).toHaveBeenCalledWith('Cozinha', ['w1'])
    })
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
    expect(mockAddToast).toHaveBeenCalledWith('Lista criada.', 'success')
  })

  it('salvar sem marcar ninguém é válido — createList(name, [])', async () => {
    mockCreateList.mockResolvedValue({ list: { id: 'list-2', name: 'Bar' } })

    render(<TeamListModal teamMembers={teamMembers} onClose={vi.fn()} onSaved={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Nome da lista'), { target: { value: 'Bar' } })
    fireEvent.click(screen.getByRole('button', { name: /Salvar/ }))

    await waitFor(() => {
      expect(mockCreateList).toHaveBeenCalledWith('Bar', [])
    })
  })

  it('botão Salvar fica desabilitado com nome vazio/em branco', () => {
    render(<TeamListModal teamMembers={teamMembers} onClose={vi.fn()} onSaved={vi.fn()} />)

    const saveButton = screen.getByRole('button', { name: /Salvar/ })
    expect(saveButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Nome da lista'), { target: { value: '   ' } })
    expect(saveButton).toBeDisabled()
  })

  it('mostra erro via toast quando o service falha e não fecha o modal', async () => {
    mockCreateList.mockResolvedValue({ list: null, error: 'Não foi possível criar a lista.' })
    const onClose = vi.fn()

    render(<TeamListModal teamMembers={teamMembers} onClose={onClose} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Nome da lista'), { target: { value: 'Cozinha' } })
    fireEvent.click(screen.getByRole('button', { name: /Salvar/ }))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Não foi possível criar a lista.', 'error')
    })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('TeamListModal — edição', () => {
  function existingList(): TeamListWithMembers {
    return {
      id: 'list-1',
      company_id: 'company-1',
      name: 'Cozinha',
      created_by: 'owner-1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      memberIds: ['w1'],
    }
  }

  it('pré-carrega nome e membros já marcados; salvar só com diff de membros não chama renameList', async () => {
    mockSetMembers.mockResolvedValue({ success: true })

    render(<TeamListModal list={existingList()} teamMembers={teamMembers} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.getByText('Editar Lista')).toBeInTheDocument()
    expect(screen.getByLabelText('Nome da lista')).toHaveValue('Cozinha')

    const ana = screen.getByText('Ana Silva').closest('label')!.querySelector('input') as HTMLInputElement
    expect(ana.checked).toBe(true)

    // desmarca Ana, marca Bruno — diff de membros
    fireEvent.click(ana)
    fireEvent.click(screen.getByText('Bruno Costa').closest('label')!.querySelector('input')!)

    fireEvent.click(screen.getByRole('button', { name: /Salvar/ }))

    await waitFor(() => {
      expect(mockSetMembers).toHaveBeenCalledWith('list-1', ['w2'])
    })
    expect(mockRenameList).not.toHaveBeenCalled()
  })

  it('renomear + trocar membros chama renameList e depois setMembers', async () => {
    mockRenameList.mockResolvedValue({ success: true })
    mockSetMembers.mockResolvedValue({ success: true })

    render(<TeamListModal list={existingList()} teamMembers={teamMembers} onClose={vi.fn()} onSaved={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Nome da lista'), { target: { value: 'Cozinha e Chapa' } })
    fireEvent.click(screen.getByRole('button', { name: /Salvar/ }))

    await waitFor(() => {
      expect(mockRenameList).toHaveBeenCalledWith('list-1', 'Cozinha e Chapa')
      expect(mockSetMembers).toHaveBeenCalledWith('list-1', ['w1'])
    })
  })
})
