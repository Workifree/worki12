import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
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
  NOT_A_WORKER_ERROR: 'Apenas freelas entram em um elenco por este link.',
  TeamConnectionService: {
    isWorkerInviteToken: vi.fn((token: string) => token.startsWith('w_')),
    addWorkerToTeamByToken: vi.fn(),
    addToTeamByToken: vi.fn(),
  },
}))

import { TeamConnectionService } from '../services/teamConnectionService'
import { supabase } from '../lib/supabase'

function LoginFalso() {
  return <div data-testid="login">{useLocation().search}</div>
}

function renderWithToken(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/convite/${token}`]}>
      <Routes>
        <Route path="/convite/:token" element={<InviteAccept />} />
        <Route path="/login" element={<LoginFalso />} />
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

describe('InviteAccept — caminhos do link', () => {
  function deslogado() {
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({ data: { user: null }, error: null } as never)
  }

  it('deslogado com link do elenco: vai ao login guardando o convite, sem forçar papel', async () => {
    deslogado()
    renderWithToken('abc123')

    expect((await screen.findByTestId('login')).textContent).toBe('?redirect=%2Fconvite%2Fabc123')
    expect(sessionStorage.getItem('pending_invite_token')).toBe('abc123')
    expect(TeamConnectionService.addToTeamByToken).not.toHaveBeenCalled()
  })

  it('deslogado com link de contato de freela (w_): pede conta de empresa', async () => {
    deslogado()
    renderWithToken('w_abc')

    expect((await screen.findByTestId('login')).textContent).toBe('?type=hire&redirect=%2Fconvite%2Fw_abc')
  })

  it('empresa abrindo o próprio link: não manda pedir link novo e descarta o convite pendente', async () => {
    sessionStorage.setItem('pending_invite_token', 'abc123')
    vi.mocked(TeamConnectionService.addToTeamByToken).mockResolvedValue({
      connection: null,
      error: 'Apenas freelas entram em um elenco por este link.',
    })
    renderWithToken('abc123')

    expect(await screen.findByText(/o link está certo/i)).toBeInTheDocument()
    expect(screen.queryByText(/peça à empresa um novo link/i)).not.toBeInTheDocument()
    expect(sessionStorage.getItem('pending_invite_token')).toBeNull()
  })
})
