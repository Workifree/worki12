import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ForgotPassword from '../ForgotPassword'

// Mock supabase
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: vi.fn(),
    },
  },
}))

function renderForgotPassword() {
  return render(
    <MemoryRouter>
      <ForgotPassword />
    </MemoryRouter>
  )
}

describe('ForgotPassword', () => {
  it('renderiza campo de email', () => {
    renderForgotPassword()

    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('seu@email.com')).toBeInTheDocument()
    expect(screen.getByText('Esqueci a Senha')).toBeInTheDocument()
  })

  it('exibe erro para email sem arroba ao submeter', () => {
    renderForgotPassword()

    const emailInput = screen.getByLabelText('Email')
    // Set value without @ to trigger component validation
    fireEvent.change(emailInput, { target: { value: 'semdominio' } })

    // Submit form directly to bypass native HTML5 email validation
    const form = emailInput.closest('form')!
    fireEvent.submit(form)

    expect(screen.getByText('Informe um e-mail válido.')).toBeInTheDocument()
  })

  it('desabilita botao quando email esta vazio', () => {
    renderForgotPassword()

    const submitBtn = screen.getByRole('button', { name: /enviar link/i })
    expect(submitBtn).toBeDisabled()
  })

  it('exibe titulo e descricao corretos', () => {
    renderForgotPassword()

    expect(screen.getByText('Esqueci a Senha')).toBeInTheDocument()
    expect(screen.getByText('Enviaremos um link para seu email')).toBeInTheDocument()
  })
})
