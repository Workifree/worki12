import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DepositModal from '../DepositModal'

const mockAddToast = vi.fn()

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}))

vi.mock('../../services/walletService', () => ({
  WalletService: {
    createDeposit: vi.fn(),
  },
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    from: vi.fn(),
  },
}))

describe('DepositModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renderiza formulario de deposito quando aberto', () => {
    render(<DepositModal {...defaultProps} />)

    expect(screen.getByText('Adicionar creditos')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('50,00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Pagar R\$/ })).toBeInTheDocument()
  })

  it('nao renderiza quando isOpen=false', () => {
    render(<DepositModal {...defaultProps} isOpen={false} />)

    expect(screen.queryByText('Adicionar creditos')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('50,00')).not.toBeInTheDocument()
  })

  it('exibe aviso e mantem botao desabilitado para valor abaixo do minimo (R$ 50)', () => {
    render(<DepositModal {...defaultProps} />)

    const input = screen.getByPlaceholderText('50,00')
    fireEvent.change(input, { target: { value: '2' } })

    expect(screen.getByText('Minimo R$ 50,00')).toBeInTheDocument()

    const button = screen.getByRole('button', { name: /Pagar R\$/ })
    expect(button).toBeDisabled()
  })

  it('mantem botao desabilitado para valor acima do maximo (R$ 50.000)', () => {
    render(<DepositModal {...defaultProps} />)

    const input = screen.getByPlaceholderText('50,00')
    fireEvent.change(input, { target: { value: '60000' } })

    const button = screen.getByRole('button', { name: /Pagar R\$/ })
    expect(button).toBeDisabled()
  })

  it('botao desabilitado quando campo valor esta vazio', () => {
    render(<DepositModal {...defaultProps} />)

    const button = screen.getByRole('button', { name: /Pagar R\$/ })
    expect(button).toBeDisabled()
  })
})
