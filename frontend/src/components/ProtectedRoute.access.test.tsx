import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { invalidateCompanyScope } from '../services/companyScopeService'
import ProtectedRoute from './ProtectedRoute'

const mockGetSession = vi.fn()
const mockRpc = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    rpc: (name: string) => mockRpc(name),
  },
}))
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }))

const ENCERRADO = 'Seu acesso a essa empresa foi encerrado'

/** Sem empresa nenhuma; `state` é a resposta de my_access_state (null = a RPC falha). */
function banco(state: object | null) {
  mockRpc.mockImplementation((name: string) => {
    if (name === 'my_access_state') {
      return Promise.resolve(state ? { data: state, error: null } : { data: null, error: new Error('falhou') })
    }
    return Promise.resolve({ data: [], error: null })
  })
}

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/company/dashboard" element={<div>painel</div>} />
          <Route path="/company/onboarding" element={<div>onboarding</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  localStorage.clear()
  invalidateCompanyScope()
  mockGetSession.mockResolvedValue({
    data: { session: { user: { id: 'ex-1', user_metadata: { user_type: 'hire' } } } },
    error: null,
  })
})

describe('ProtectedRoute — acesso encerrado (my_access_state)', () => {
  const removido = { removed: true, has_active: false, owns_company: false }

  it.each(['/company/dashboard', '/company/onboarding'])(
    '%s: ex-membro sem marca no aparelho vê a tela de acesso encerrado',
    async (path) => {
      banco(removido)
      renderRoute(path)
      expect(await screen.findByText(ENCERRADO)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Cadastrar minha própria empresa' })).toBeInTheDocument()
      expect(screen.queryByText('onboarding')).not.toBeInTheDocument()
    },
  )

  it('a escolha de cadastrar a própria empresa vence o bloqueio (e a marca local)', async () => {
    banco(removido)
    localStorage.setItem('worki_team_member_hint:ex-1', '1')
    sessionStorage.setItem('worki_own_company_intent:ex-1', '1')
    renderRoute('/company/dashboard')
    expect(await screen.findByText('onboarding')).toBeInTheDocument()
  })

  it.each([
    ['RPC falha (null)', null],
    ['nunca foi removido', { removed: false, has_active: false, owns_company: false }],
    ['tem empresa própria', { removed: true, has_active: false, owns_company: true }],
  ])('%s: mantém o caminho de onboarding', async (_nome, state) => {
    banco(state)
    renderRoute('/company/dashboard')
    expect(await screen.findByText('onboarding')).toBeInTheDocument()
    expect(screen.queryByText(ENCERRADO)).not.toBeInTheDocument()
  })

  it('RPC falha com marca local: continua em acesso encerrado, como antes', async () => {
    banco(null)
    localStorage.setItem('worki_team_member_hint:ex-1', '1')
    renderRoute('/company/dashboard')
    expect(await screen.findByText(ENCERRADO)).toBeInTheDocument()
  })
})
