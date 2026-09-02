import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ResetPassword from '../ResetPassword'

// Mock supabase
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      updateUser: vi.fn(),
    },
  },
}))

function renderResetPassword() {
  return render(
    <MemoryRouter>
      <ResetPassword />
    </MemoryRouter>
  )
}

describe('ResetPassword', () => {
  it('renderiza campos de senha e confirmacao', () => {
    renderResetPassword()

    expect(screen.getByLabelText('Nova senha')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirmar senha')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /nova senha/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /redefinir senha/i })).toBeInTheDocument()
  })

  it('exibe erro quando senhas nao coincidem', async () => {
    renderResetPassword()
    const user = userEvent.setup()

    const senhaInput = screen.getByLabelText('Nova senha')
    const confirmarInput = screen.getByLabelText('Confirmar senha')

    await user.type(senhaInput, 'Senha123!')
    await user.type(confirmarInput, 'SenhaDiferente!')

    const submitBtn = screen.getByRole('button', { name: /redefinir senha/i })
    await user.click(submitBtn)

    expect(screen.getByText('As senhas não coincidem.')).toBeInTheDocument()
  })

  it('exibe indicador de forca da senha', async () => {
    renderResetPassword()
    const user = userEvent.setup()

    const senhaInput = screen.getByLabelText('Nova senha')

    // Type a weak password
    await user.type(senhaInput, 'abc')
    expect(screen.getByText(/For[cç]a:/)).toBeInTheDocument()
    expect(screen.getByText(/Fraca/)).toBeInTheDocument()

    // Clear and type a strong password
    await user.clear(senhaInput)
    await user.type(senhaInput, 'Abc123!@#xyz')
    expect(screen.getByText(/Forte/)).toBeInTheDocument()
  })

  it('desabilita botao quando campos estao vazios', () => {
    renderResetPassword()

    const submitBtn = screen.getByRole('button', { name: /redefinir senha/i })
    expect(submitBtn).toBeDisabled()
  })

  it('exibe erro para senha curta', async () => {
    renderResetPassword()
    const user = userEvent.setup()

    const senhaInput = screen.getByLabelText('Nova senha')
    const confirmarInput = screen.getByLabelText('Confirmar senha')

    await user.type(senhaInput, 'abc')
    await user.type(confirmarInput, 'abc')

    const submitBtn = screen.getByRole('button', { name: /redefinir senha/i })
    await user.click(submitBtn)

    expect(screen.getByText('A senha deve ter pelo menos 8 caracteres.')).toBeInTheDocument()
  })
})
