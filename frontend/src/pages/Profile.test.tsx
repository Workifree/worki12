import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Profile from './Profile'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
      signOut: vi.fn().mockResolvedValue({}),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    functions: {
      invoke: vi.fn(),
    },
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: '' } })),
      })),
    },
  },
}))

vi.mock('../contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ addToast: vi.fn(), removeToast: vi.fn() })),
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: { id: 'worker-1' }, loading: false, signOut: vi.fn().mockResolvedValue(undefined) })),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: vi.fn(() => vi.fn()),
  }
})

vi.mock('../lib/logger', () => ({ logError: vi.fn() }))
vi.mock('../lib/validation', () => ({
  getPasswordStrength: () => ({ label: 'Forte', color: 'bg-green-500', width: 'w-full', score: 4 }),
  EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  validateCPFOrCNPJ: (doc: string) => {
    const clean = doc.replace(/\D/g, '')
    return clean.length === 11 || clean.length === 14
  },
  formatCpfCnpj: (value: string) => value,
  // `handleSave` sempre chama isto (mesmo quando o freela não tocou no PIX) — faltava no mock e
  // nenhum teste anterior batia em `handleSave` para revelar a lacuna (F7 é o primeiro a salvar).
  normalizePixKeyForStorage: (_type: string, value: string) => value,
}))

import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'

const WORKER_DATA = {
  id: 'worker-1',
  full_name: 'Maria Silva',
  city: 'São Paulo',
  phone: '11999999999',
  bio: 'Profissional experiente',
  pix_key: 'maria@email.com',
  primary_role: 'Garçom',
  roles: ['Garçom', 'Barman'],
  cover_url: null,
  avatar_url: null,
  verified_identity: false,
  level: 2,
  xp: 150,
  rating_average: 4.5,
  completed_jobs_count: 5,
  earnings_total: 1000,
  experience_years: '2 anos',
  availability: ['Fins de semana'],
}

function buildChain(overrides: Record<string, unknown> = {}) {
  // `select('id')` é o ÚLTIMO elo da cadeia de `handleSave`/`handleUpload` (awaited direto, sem
  // `.single()` depois — ver Profile.tsx `handleSave`) e precisa resolver a Promise ali mesmo;
  // já `select('*')` (fetch inicial) só encadeia para `.eq().single()`. Diferenciar pelo argumento
  // deixa o MESMO mock servir os dois fluxos sem um segundo builder.
  const chain: Record<string, unknown> = {
    select: vi.fn((cols?: string) =>
      cols === 'id' ? Promise.resolve({ data: [{ id: 'worker-1' }], error: null }) : chain,
    ),
    eq: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue({ data: WORKER_DATA, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: WORKER_DATA, error: null }),
    update: vi.fn(() => chain),
  }
  // Aplica overrides NO PRÓPRIO objeto `chain` (não numa cópia) — `select`/`eq`/`update` fecham
  // sobre esta referência para se auto-encadear; uma cópia com overrides por cima (`{...chain,
  // ...overrides}`) deixaria `.eq().single()` resolvendo com o `single` ORIGINAL, não o override.
  Object.assign(chain, overrides)
  return chain
}

function setupMocks() {
  const mockAddToast = vi.fn()
  vi.mocked(useToast).mockReturnValue({ addToast: mockAddToast, removeToast: vi.fn() })
  vi.mocked(useNavigate).mockReturnValue(vi.fn())

  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: 'worker-1' } },
    error: null,
  } as Awaited<ReturnType<typeof supabase.auth.getUser>>)

  vi.mocked(supabase.from).mockReturnValue(buildChain() as unknown as ReturnType<typeof supabase.from>)

  return { mockAddToast }
}

function renderComponent() {
  return render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>
  )
}

// Segurança, Sessão e Zona de Perigo ficam ocultas por padrão atrás do botão
// "Configurações da Conta" — os testes que interagem com essas seções
// precisam abri-las primeiro.
function openAccountSettings() {
  fireEvent.click(screen.getByRole('button', { name: /configura(ç|c)ões da conta/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Profile - Renderizacao', () => {
  it('exibe nome do usuario apos carregar', async () => {
    setupMocks()
    renderComponent()
    await waitFor(() => { expect(screen.getByText('Maria Silva')).toBeInTheDocument() })
  })
})

describe('Profile — modal de exclusão de conta', () => {
  it('botão Confirmar Exclusão desabilitado quando confirmText !== EXCLUIR', async () => {
    setupMocks()
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Maria Silva')).toBeInTheDocument()
    })

    openAccountSettings()
    fireEvent.click(screen.getByText('Excluir minha conta'))

    const confirmarBtn = screen.getByText('Confirmar Exclusão')
    expect(confirmarBtn).toBeDisabled()
  })

  it('botão habilitado quando confirmText === EXCLUIR', async () => {
    setupMocks()
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Maria Silva')).toBeInTheDocument()
    })

    openAccountSettings()
    fireEvent.click(screen.getByText('Excluir minha conta'))

    const input = screen.getByPlaceholderText('EXCLUIR')
    fireEvent.change(input, { target: { value: 'EXCLUIR' } })

    const confirmarBtn = screen.getByText('Confirmar Exclusão')
    expect(confirmarBtn).not.toBeDisabled()
  })

  it('navigate para /login é chamado quando invokeFunction resolve com sucesso', async () => {
    setupMocks()
    const mockNavigate = vi.fn()
    vi.mocked(useNavigate).mockReturnValue(mockNavigate)
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { success: true }, error: null })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Maria Silva')).toBeInTheDocument()
    })

    openAccountSettings()
    fireEvent.click(screen.getByText('Excluir minha conta'))

    const input = screen.getByPlaceholderText('EXCLUIR')
    fireEvent.change(input, { target: { value: 'EXCLUIR' } })

    fireEvent.click(screen.getByText('Confirmar Exclusão'))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login')
    })
  })

  it('toast de erro aparece quando invokeFunction rejeita com error message', async () => {
    const { mockAddToast } = setupMocks()
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null,
      error: { message: 'Você tem pagamentos pendentes.' },
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Maria Silva')).toBeInTheDocument()
    })

    openAccountSettings()
    fireEvent.click(screen.getByText('Excluir minha conta'))

    const input = screen.getByPlaceholderText('EXCLUIR')
    fireEvent.change(input, { target: { value: 'EXCLUIR' } })

    fireEvent.click(screen.getByText('Confirmar Exclusão'))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Você tem pagamentos pendentes.',
        'error'
      )
    })
  })
})

describe('Profile - Seguranca', () => {
  it('botao Alterar Senha desabilitado com campos vazios', async () => {
    setupMocks()
    renderComponent()
    await waitFor(() => { expect(screen.getByText('Maria Silva')).toBeInTheDocument() })
    openAccountSettings()
    expect(screen.getByRole('button', { name: /alterar senha/i })).toBeDisabled()
  })
})

describe('Profile — logout (R3/R4)', () => {
  it('chama AuthContext.signOut e navega para /login ao clicar em Sair da conta', async () => {
    setupMocks()
    const mockSignOut = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'worker-1' }, loading: false, signOut: mockSignOut } as unknown as ReturnType<typeof useAuth>)
    const mockNavigate = vi.fn()
    vi.mocked(useNavigate).mockReturnValue(mockNavigate)

    renderComponent()
    await waitFor(() => { expect(screen.getByText('Maria Silva')).toBeInTheDocument() })

    openAccountSettings()
    fireEvent.click(screen.getByRole('button', { name: /sair da conta/i }))

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled()
      expect(mockNavigate).toHaveBeenCalledWith('/login')
    })
  })

  it('mostra toast de erro quando signOut falha, sem travar em silencio', async () => {
    const { mockAddToast } = setupMocks()
    const mockSignOut = vi.fn().mockRejectedValue(new Error('network error'))
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'worker-1' }, loading: false, signOut: mockSignOut } as unknown as ReturnType<typeof useAuth>)

    renderComponent()
    await waitFor(() => { expect(screen.getByText('Maria Silva')).toBeInTheDocument() })

    openAccountSettings()
    fireEvent.click(screen.getByRole('button', { name: /sair da conta/i }))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Não foi possível sair. Tente novamente.', 'error')
    })
  })
})

// ---------------------------------------------------------------------------
// F7 — Disponibilidade declarada pelo freela (grade dia × período).
// Contrato normativo: `.harness/spec/disponibilidade-freela/ddl-aprovado.md` §3.6.
// LM-8: `null` e `{}` não podem coexistir como "não declarou" — a poda é obrigatória.
// ---------------------------------------------------------------------------
describe('Profile — disponibilidade declarada (F7)', () => {
  it('sem grade salva: mostra CTA de adoção, nunca uma grade vazia sem contexto', async () => {
    setupMocks()
    renderComponent()
    await waitFor(() => { expect(screen.getByText('Maria Silva')).toBeInTheDocument() })

    expect(screen.getByText(/você ainda não declarou sua disponibilidade/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /declarar disponibilidade/i })).toBeInTheDocument()
  })

  it('CTA de adoção entra em modo de edição (mesmo gesto de "Editar Perfil")', async () => {
    setupMocks()
    renderComponent()
    await waitFor(() => { expect(screen.getByText('Maria Silva')).toBeInTheDocument() })

    fireEvent.click(screen.getByRole('button', { name: /declarar disponibilidade/i }))

    expect(screen.getAllByRole('button', { name: /^salvar$/i })[0]).toBeInTheDocument()
  })

  it('marca um dia+período e salva: grava a chave como array, nunca `{}` vazio', async () => {
    setupMocks()
    renderComponent()
    await waitFor(() => { expect(screen.getByText('Maria Silva')).toBeInTheDocument() })

    fireEvent.click(screen.getByRole('button', { name: /editar perfil/i }))

    // Sexta (weekday '5') período Noite — mesmo par usado no ShiftCallModal.test.tsx.
    fireEvent.click(screen.getByRole('button', { name: /sex — noite/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /^salvar$/i })[0])

    await waitFor(() => {
      const chain = vi.mocked(supabase.from).mock.results[0]?.value as { update: ReturnType<typeof vi.fn> }
      expect(chain.update).toHaveBeenCalledWith(
        expect.objectContaining({ availability_days: { '5': ['noite'] } }),
      )
    })
  })

  it('marca e desmarca o mesmo slot: grava `availability_days: null`, NUNCA `{}` (LM-8)', async () => {
    setupMocks()
    renderComponent()
    await waitFor(() => { expect(screen.getByText('Maria Silva')).toBeInTheDocument() })

    fireEvent.click(screen.getByRole('button', { name: /editar perfil/i }))

    const slot = screen.getByRole('button', { name: /sex — noite/i })
    fireEvent.click(slot) // marca
    fireEvent.click(slot) // desmarca — dia some da grade local
    fireEvent.click(screen.getAllByRole('button', { name: /^salvar$/i })[0])

    await waitFor(() => {
      const chain = vi.mocked(supabase.from).mock.results[0]?.value as { update: ReturnType<typeof vi.fn> }
      expect(chain.update).toHaveBeenCalledWith(
        expect.objectContaining({ availability_days: null }),
      )
    })
  })

  it('grade já declarada aparece como resumo em modo de visualização, sem CTA de adoção', async () => {
    const mockAddToast = vi.fn()
    vi.mocked(useToast).mockReturnValue({ addToast: mockAddToast, removeToast: vi.fn() })
    vi.mocked(useNavigate).mockReturnValue(vi.fn())
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'worker-1' } },
      error: null,
    } as Awaited<ReturnType<typeof supabase.auth.getUser>>)
    vi.mocked(supabase.from).mockReturnValue(
      buildChain({
        single: vi.fn().mockResolvedValue({
          data: { ...WORKER_DATA, availability_days: { '5': ['noite', 'tarde'] } },
          error: null,
        }),
      }) as unknown as ReturnType<typeof supabase.from>,
    )

    renderComponent()
    await waitFor(() => { expect(screen.getByText('Maria Silva')).toBeInTheDocument() })

    expect(screen.queryByRole('button', { name: /declarar disponibilidade/i })).not.toBeInTheDocument()
    expect(screen.getByText(/sex: noite, tarde/i)).toBeInTheDocument()
  })
})
