import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom'
import AcceptManagerInvite from './AcceptManagerInvite'

const mockGetUser = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
  },
}))

vi.mock('../lib/logger', () => ({ logError: vi.fn() }))

vi.mock('../services/organizationService', () => ({
  acceptManagerInvite: vi.fn(),
}))

import { acceptManagerInvite } from '../services/organizationService'

// Espia a query string com que o convite chega ao /login: o `type` decide se a pessoa ve a
// copy de freela ou a de empresa, e o convite de gerente SO funciona com conta de empresa.
function LoginEspiao() {
  const [params] = useSearchParams()
  return (
    <div data-testid="login-page" data-type={params.get('type') ?? ''} data-redirect={params.get('redirect') ?? ''}>
      Login
    </div>
  )
}

function renderWithToken(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/convite-gerente/${token}`]}>
      <Routes>
        <Route path="/convite-gerente/:token" element={<AcceptManagerInvite />} />
        <Route path="/login" element={<LoginEspiao />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AcceptManagerInvite (F13, R8/R9)', () => {
  it('sem sessão: preserva o token e manda para /login?redirect=...', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    renderWithToken('tok-abc')

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument()
    })
    expect(screen.getByTestId('login-page')).toHaveAttribute('data-redirect', '/convite-gerente/tok-abc')
  })

  // REGRESSAO (achado navegando o produto, 23/08/2026): o link ia para `/login?redirect=...`
  // SEM `type`, e o /login assume 'work' por default -- o convidado era recebido com a copy de
  // freela ("Comece a trabalhar. Ganhe dinheiro no seu proprio horario"). Quem se cadastrasse por
  // ali viraria worker, e worker nao pode ser gerente (`worker_cannot_be_manager`): o convite
  // ficava inutilizavel justamente pela unica pessoa a quem foi enviado.
  it('sem sessão: manda para o lado EMPRESA do login (gerente nunca e conta de freela)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    renderWithToken('tok-abc')

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument()
    })
    expect(screen.getByTestId('login-page')).toHaveAttribute('data-type', 'hire')
  })

  it('outcome=accepted: mostra sucesso e não afirma erro', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'manager-1' } } })
    vi.mocked(acceptManagerInvite).mockResolvedValue({ outcome: 'accepted', companyId: 'comp-9' })

    renderWithToken('tok-abc')

    await waitFor(() => {
      expect(screen.getByText('Convite Aceito!')).toBeInTheDocument()
    })
  })

  it('outcome=expired: NUNCA afirma sucesso, mostra copy de convite expirado', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'manager-1' } } })
    vi.mocked(acceptManagerInvite).mockResolvedValue({ outcome: 'expired' })

    renderWithToken('tok-velho')

    await waitFor(() => {
      expect(screen.getByText('Convite expirado')).toBeInTheDocument()
    })
    expect(screen.queryByText('Convite Aceito!')).not.toBeInTheDocument()
  })

  it('outcome=token_already_used: NUNCA aceita silenciosamente token usado por outra conta', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'manager-2' } } })
    vi.mocked(acceptManagerInvite).mockResolvedValue({ outcome: 'token_already_used' })

    renderWithToken('tok-usado')

    await waitFor(() => {
      expect(screen.getByText('Convite já usado')).toBeInTheDocument()
    })
  })

  it('worker_cannot_be_manager: conta de freela não vira gerente', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'worker-1' } } })
    vi.mocked(acceptManagerInvite).mockResolvedValue({ outcome: 'worker_cannot_be_manager' })

    renderWithToken('tok-abc')

    await waitFor(() => {
      expect(screen.getByText('Conta incompatível')).toBeInTheDocument()
    })
  })
})
