import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import InviteAccept from './InviteAccept'

// Mock supabase — sessão de empresa ativa (necessária pra `processInvite` seguir em frente
// em vez de redirecionar pro login).
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'company-1' } }, error: null }),
    },
  },
}))

// Mock TeamConnectionService — InviteAccept chama os métodos direto, sem passar por supabase.from.
vi.mock('../services/teamConnectionService', () => ({
  TeamConnectionService: {
    isWorkerInviteToken: vi.fn((token: string) => token.startsWith('w_')),
    addWorkerToTeamByToken: vi.fn(),
    addToTeamByToken: vi.fn(),
  },
}))

import { TeamConnectionService } from '../services/teamConnectionService'

function renderWithToken(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/convite/${token}`]}>
      <Routes>
        <Route path="/convite/:token" element={<InviteAccept />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('InviteAccept — veto do freela (R-05)', () => {
  it('NÃO afirma sucesso quando o freela bloqueou a empresa (result.blocked=true)', async () => {
    vi.mocked(TeamConnectionService.addWorkerToTeamByToken).mockResolvedValue({
      connection: { id: 'conn-1' } as never,
      alreadyExists: true,
      blocked: true,
    })

    renderWithToken('w_workertoken123')

    await waitFor(() => {
      expect(screen.getByText('Não é possível adicionar este freela agora.')).toBeInTheDocument()
    })

    // Não pode sugerir sucesso nem revelar que houve bloqueio.
    expect(screen.queryByText('Já está no seu elenco')).not.toBeInTheDocument()
    expect(screen.queryByText('Freela Convidado!')).not.toBeInTheDocument()
    expect(screen.queryByText(/bloque/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/vet/i)).not.toBeInTheDocument()
  })

  it('mantém a mensagem de idempotência normal quando a conexão já existe e NÃO está bloqueada', async () => {
    vi.mocked(TeamConnectionService.addWorkerToTeamByToken).mockResolvedValue({
      connection: { id: 'conn-1' } as never,
      alreadyExists: true,
      blocked: false,
    })

    renderWithToken('w_workertoken123')

    await waitFor(() => {
      expect(screen.getByText('Já está no seu elenco')).toBeInTheDocument()
    })
  })

  it('mostra sucesso quando a conexão é criada (sem alreadyExists)', async () => {
    vi.mocked(TeamConnectionService.addWorkerToTeamByToken).mockResolvedValue({
      connection: { id: 'conn-2' } as never,
    })

    renderWithToken('w_workertoken123')

    await waitFor(() => {
      expect(screen.getByText('Freela Convidado!')).toBeInTheDocument()
    })
  })
})
