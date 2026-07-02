import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Login from '../Login'

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
