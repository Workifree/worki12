import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  NOT_A_WORKER_ERROR: 'Apenas freelas entram em um Elenco por este link.',
  TeamConnectionService: {
    isWorkerInviteToken: vi.fn((token: string) => token.startsWith('w_')),
    resolveWorkerInviteToken: vi.fn((t: string) => (t === 'w_quebrado' ? null : 'worker-id')),
    resolveInviteToken: vi.fn((t: string) => (t === 'quebrado' ? null : 'company-id')),
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
  sessionStorage.clear()
})

async function convidar() {
  fireEvent.click(await screen.findByRole('button', { name: 'Convidar para o Elenco' }))
}

describe('InviteAccept — veto do freela (R-05)', () => {
  it('NÃO afirma sucesso quando o freela bloqueou a empresa (result.blocked=true)', async () => {
    vi.mocked(TeamConnectionService.addWorkerToTeamByToken).mockResolvedValue({
      connection: { id: 'conn-1' } as never,
      alreadyExists: true,
      blocked: true,
    })

    renderWithToken('w_workertoken123')
    await convidar()

    await waitFor(() => {
      expect(screen.getByText('Não é possível adicionar este freela agora.')).toBeInTheDocument()
    })

    // Não pode sugerir sucesso nem revelar que houve bloqueio.
    expect(screen.queryByText('Já está no seu Elenco')).not.toBeInTheDocument()
    expect(screen.queryByText('Convite enviado')).not.toBeInTheDocument()
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
    await convidar()

    await waitFor(() => {
      expect(screen.getByText('Já está no seu Elenco')).toBeInTheDocument()
    })
  })

  it('mostra sucesso quando a conexão é criada (sem alreadyExists)', async () => {
    vi.mocked(TeamConnectionService.addWorkerToTeamByToken).mockResolvedValue({
      connection: { id: 'conn-2' } as never,
    })

    renderWithToken('w_workertoken123')
    await convidar()

    await waitFor(() => {
      expect(screen.getByText('Convite enviado')).toBeInTheDocument()
    })
  })
})

describe('InviteAccept — caminhos do link', () => {
  function deslogado() {
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({ data: { user: null }, error: null } as never)
  }

  it('deslogado com link do Elenco: vai ao login guardando o convite, sem forçar papel', async () => {
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
      error: 'Apenas freelas entram em um Elenco por este link.',
    })
    renderWithToken('abc123')

    fireEvent.click(await screen.findByRole('button', { name: 'Entrar no Elenco' }))
    expect(await screen.findByText('Apenas freelas entram em um Elenco por este link.')).toBeInTheDocument()
    expect(screen.queryByText(/peça um novo link/i)).not.toBeInTheDocument()
    expect(sessionStorage.getItem('pending_invite_token')).toBeNull()
  })
})

describe('InviteAccept — consentimento: abrir o link não aceita nada', () => {
  function logado(userType: string) {
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: { id: 'u', email: 'a@x.com', user_metadata: { user_type: userType } } },
      error: null,
    } as never)
  }

  it.each([
    ['abc123', 'work', 'Entrar no Elenco'],
    ['w_abc', 'hire', 'Convidar para o Elenco'],
  ])('montar %s não chama o aceite; só o clique chama', async (token, papel, rotulo) => {
    logado(papel)
    vi.mocked(TeamConnectionService.addToTeamByToken).mockResolvedValue({ connection: { status: 'accepted' } as never })
    vi.mocked(TeamConnectionService.addWorkerToTeamByToken).mockResolvedValue({ connection: { status: 'pending' } as never })

    renderWithToken(token)
    const botao = await screen.findByRole('button', { name: rotulo })
    expect(screen.getByRole('button', { name: 'Agora não' })).toBeInTheDocument()
    expect(TeamConnectionService.addToTeamByToken).not.toHaveBeenCalled()
    expect(TeamConnectionService.addWorkerToTeamByToken).not.toHaveBeenCalled()

    fireEvent.click(botao)
    const chamado = token.startsWith('w_') ? TeamConnectionService.addWorkerToTeamByToken : TeamConnectionService.addToTeamByToken
    await waitFor(() => expect(chamado).toHaveBeenCalledTimes(1))
  })

  it('"Agora não" descarta o convite pendente sem chamar o aceite', async () => {
    logado('work')
    sessionStorage.setItem('pending_invite_token', 'abc123')
    renderWithToken('abc123')
    fireEvent.click(await screen.findByRole('button', { name: 'Agora não' }))
    expect(sessionStorage.getItem('pending_invite_token')).toBeNull()
    expect(TeamConnectionService.addToTeamByToken).not.toHaveBeenCalled()
  })

  it('link malformado sem login: diz que é inválido em vez de mandar cadastrar', async () => {
    renderWithToken('quebrado')
    expect(await screen.findByText('Link de convite inválido')).toBeInTheDocument()
    expect(screen.queryByTestId('login')).not.toBeInTheDocument()
  })

  it('convite que já estava pendente não é anunciado como aceito', async () => {
    logado('work')
    vi.mocked(TeamConnectionService.addToTeamByToken).mockResolvedValue({ connection: { status: 'pending' } as never })
    renderWithToken('abc123')
    fireEvent.click(await screen.findByRole('button', { name: 'Entrar no Elenco' }))
    expect(await screen.findByText('Falta você responder em Empresas')).toBeInTheDocument()
  })
})
