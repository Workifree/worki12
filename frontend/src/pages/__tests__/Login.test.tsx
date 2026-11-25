import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import Login from '../Login'

function Destino() {
  return <div data-testid="destino">{useLocation().pathname}</div>
}

// Mock supabase
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}))

vi.mock('../../lib/logger', () => ({ logError: vi.fn() }))

import { supabase } from '../../lib/supabase'

function renderLogin(initialEntry = '/login?type=work') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Login />
    </MemoryRouter>
  )
}

describe('Login', () => {
  it('renderiza formulario com campos de email e senha', () => {
    renderLogin()

    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Senha')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument()
  })

  it('exibe erro ao submeter formulario vazio', async () => {
    renderLogin()

    const emailInput = screen.getByLabelText('Email')
    const senhaInput = screen.getByLabelText('Senha')

    // Both fields have required attribute and HTML validation
    expect(emailInput).toBeRequired()
    expect(senhaInput).toBeRequired()
  })

  it('possui link para esqueci minha senha', () => {
    renderLogin()

    const link = screen.getByText('Esqueci minha senha')
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/esqueci-senha')
  })

  it('permite alternar entre login e cadastro', async () => {
    const user = userEvent.setup()
    renderLogin()

    // Initially in login mode
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument()

    // Switch to sign up mode
    await user.click(screen.getByText('Cadastre-se'))

    expect(screen.getByRole('button', { name: /criar conta/i })).toBeInTheDocument()
  })
})

describe('Login — R1: papel divergente no login (nunca redireciona silenciosamente)', () => {
  it('mostra aviso claro e NAO redireciona quando conta ja existe com o OUTRO papel', async () => {
    const user = userEvent.setup()
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { user: { id: 'u1', user_metadata: { user_type: 'hire' } }, session: {} },
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>)

    // Usuario chega via ?type=work mas a conta é 'hire' (empresa)
    renderLogin('/login?type=work')

    await user.type(screen.getByLabelText('Email'), 'ja@existe.com')
    await user.type(screen.getByLabelText('Senha'), 'senhaSegura123')
    await user.click(screen.getByRole('button', { name: /entrar/i }))

    await waitFor(() => {
      expect(screen.getByText(/já está cadastrado como/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /ir para o dashboard de empresa/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /usar outro e-mail/i })).toBeInTheDocument()
  })

  it('nao mostra aviso quando o papel da conta bate com o type da URL', async () => {
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { user: { id: 'u2', user_metadata: { user_type: 'work' } }, session: {} },
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>)

    const user = userEvent.setup()
    renderLogin('/login?type=work')

    await user.type(screen.getByLabelText('Email'), 'ok@existe.com')
    await user.type(screen.getByLabelText('Senha'), 'senhaSegura123')
    await user.click(screen.getByRole('button', { name: /entrar/i }))

    await waitFor(() => {
      expect(supabase.auth.signInWithPassword).toHaveBeenCalled()
    })
    expect(screen.queryByText(/já está cadastrado como/i)).not.toBeInTheDocument()
  })
})

describe('Login — R2: cadastro com e-mail ja existente mostra mensagem especifica', () => {
  it('exibe mensagem mencionando o outro papel quando signUp falha com "User already registered"', async () => {
    const user = userEvent.setup()
    vi.mocked(supabase.auth.signUp).mockRejectedValue(new Error('User already registered'))

    renderLogin('/login?type=work')
    await user.click(screen.getByText('Cadastre-se'))

    await user.type(screen.getByLabelText('Email'), 'ja@existe.com')
    await user.type(screen.getByLabelText('Senha'), 'senhaSegura123')
    await user.click(screen.getByRole('button', { name: /criar conta/i }))

    await waitFor(() => {
      expect(screen.getByText(/já tem conta cadastrada como empresa/i)).toBeInTheDocument()
    })
  })

  it('exibe mensagem de e-mail ja existente quando signUp retorna sucesso ofuscado (identities vazio)', async () => {
    const user = userEvent.setup()
    // Anti-enumeracao do Supabase: signUp de e-mail ja existente e confirmado NAO
    // retorna erro — retorna data.user com identities: [] e sem session.
    vi.mocked(supabase.auth.signUp).mockResolvedValue({
      data: { user: { id: 'u3', identities: [], user_metadata: { user_type: 'work' } }, session: null },
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.signUp>>)

    renderLogin('/login?type=work')
    await user.click(screen.getByText('Cadastre-se'))

    await user.type(screen.getByLabelText('Email'), 'ja@existe.com')
    await user.type(screen.getByLabelText('Senha'), 'senhaSegura123')
    await user.click(screen.getByRole('button', { name: /criar conta/i }))

    await waitFor(() => {
      expect(screen.getByText(/este e-mail já tem uma conta/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/conta criada/i)).not.toBeInTheDocument()
  })

  it('mantem o fluxo de "Conta criada" quando identities tem itens (cadastro novo de verdade)', async () => {
    const user = userEvent.setup()
    vi.mocked(supabase.auth.signUp).mockResolvedValue({
      data: { user: { id: 'u4', identities: [{ id: 'id1' }], user_metadata: { user_type: 'work' } }, session: null },
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.signUp>>)

    renderLogin('/login?type=work')
    await user.click(screen.getByText('Cadastre-se'))

    await user.type(screen.getByLabelText('Email'), 'novo@exemplo.com')
    await user.type(screen.getByLabelText('Senha'), 'senhaSegura123')
    await user.click(screen.getByRole('button', { name: /criar conta/i }))

    await waitFor(() => {
      expect(screen.getByText(/conta criada! verifique seu email/i)).toBeInTheDocument()
    })
  })
})

describe('Login — destino de redirect', () => {
  async function entrar(entry: string) {
    const user = userEvent.setup()
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { user: { id: 'u9', user_metadata: { user_type: 'work' } }, session: {} },
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>)
    render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Destino />} />
        </Routes>
      </MemoryRouter>,
    )
    await user.type(screen.getByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Senha'), 'senhaSegura123')
    await user.click(screen.getByRole('button', { name: /entrar/i }))
    return (await screen.findByTestId('destino')).textContent
  }

  it.each(['//site-externo.com', '/\\site-externo.com', '/%2F%2Fsite-externo.com', '/%5Csite-externo.com'])(
    'ignora o redirect externo %s e vai para o painel',
    async (alvo) => {
      expect(await entrar(`/login?redirect=${encodeURIComponent(alvo)}`)).toBe('/dashboard')
    },
  )

  it('respeita o redirect interno do convite', async () => {
    expect(await entrar('/login?redirect=%2Fconvite%2Fabc123')).toBe('/convite/abc123')
  })

  async function cadastrar(entry: string) {
    const user = userEvent.setup()
    vi.mocked(supabase.auth.signUp).mockReset()
    vi.mocked(supabase.auth.signUp).mockResolvedValue({
      data: { user: { id: 'u10', identities: [{ id: 'i' }], user_metadata: {} }, session: null },
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.signUp>>)
    renderLogin(entry)
    await user.click(screen.getByText('Cadastre-se'))
    await user.type(screen.getByLabelText('Email'), 'novo@exemplo.com')
    await user.type(screen.getByLabelText('Senha'), 'senhaSegura123')
    await user.click(screen.getByRole('button', { name: /criar conta/i }))
    await waitFor(() => expect(supabase.auth.signUp).toHaveBeenCalled())
    return vi.mocked(supabase.auth.signUp).mock.calls[0][0] as {
      options?: { emailRedirectTo?: string; data?: unknown }
    }
  }

  it('cadastro vindo do convite leva o convite no retorno da confirmação de e-mail', async () => {
    const args = await cadastrar('/login?redirect=%2Fconvite%2Fabc123')
    expect(args.options?.emailRedirectTo).toBe(`${window.location.origin}/convite/abc123`)
  })

  it('redirect externo nunca vira emailRedirectTo', async () => {
    const args = await cadastrar('/login?redirect=%2F%2Fsite-externo.com')
    expect(args.options).not.toHaveProperty('emailRedirectTo')
  })

  it('link de contato de freela cria conta de empresa', async () => {
    const args = await cadastrar('/login?redirect=%2Fconvite%2Fw_abc')
    expect(args.options?.data).toEqual({ user_type: 'hire' })
  })
})
