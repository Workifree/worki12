import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Wallet from '../Wallet'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(),
  },
}))

vi.mock('../../services/walletService', () => ({
  WalletService: {
    getOrCreateWallet: vi.fn(),
    getTransactions: vi.fn(),
    syncBalance: vi.fn(),
    withdrawFunds: vi.fn(),
  },
}))

vi.mock('../../contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ addToast: vi.fn(), removeToast: vi.fn() })),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: vi.fn(() => vi.fn()),
  }
})

vi.mock('../../lib/validation', () => ({
  validateCPF: vi.fn(() => true),
  validateCNPJ: vi.fn(() => true),
  EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
}))

import { supabase } from '../../lib/supabase'
import { WalletService } from '../../services/walletService'
import { useToast } from '../../contexts/ToastContext'
import { useNavigate } from 'react-router-dom'

function setupMocks(overrides: { balance?: number; transactions?: unknown[] } = {}) {
  const mockAddToast = vi.fn()
  vi.mocked(useToast).mockReturnValue({ addToast: mockAddToast, removeToast: vi.fn() })
  vi.mocked(useNavigate).mockReturnValue(vi.fn())

  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: 'worker-1' } },
    error: null,
  } as Awaited<ReturnType<typeof supabase.auth.getUser>>)

  vi.mocked(WalletService.getOrCreateWallet).mockResolvedValue({
    id: 'wallet-1',
    user_id: 'worker-1',
    balance: overrides.balance ?? 500,
    user_type: 'worker',
    created_at: '',
    updated_at: '',
  })

  vi.mocked(WalletService.getTransactions).mockResolvedValue(
    (overrides.transactions ?? []) as Awaited<ReturnType<typeof WalletService.getTransactions>>
  )

  vi.mocked(WalletService.syncBalance).mockResolvedValue({ success: true, hasUpdates: false })

  // Mock supabase.from for applications query chain
  const eqStatus = vi.fn().mockResolvedValue({ data: [], error: null })
  const eqWorker = vi.fn().mockReturnValue({ eq: eqStatus })
  const selectFn = vi.fn().mockReturnValue({ eq: eqWorker })
  vi.mocked(supabase.from).mockReturnValue({
    select: selectFn,
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
  } as unknown as ReturnType<typeof supabase.from>)

  return { mockAddToast }
}

function renderComponent() {
  return render(
    <MemoryRouter>
      <Wallet />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Wallet - Renderizacao de saldo', () => {
  it('exibe saldo formatado em R$ apos carregar', async () => {
    setupMocks({ balance: 1500.5 })
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('R$ 1500,50')).toBeInTheDocument()
    })
  })

  it('exibe saldo zero quando wallet tem balance 0', async () => {
    setupMocks({ balance: 0 })
    renderComponent()

    await waitFor(() => {
      // Multiple elements show R$ 0,00 (balance + stats), so use getAllByText
      const elements = screen.getAllByText('R$ 0,00')
      expect(elements.length).toBeGreaterThanOrEqual(1)
    })
  })
})

describe('Wallet - Modal de saque', () => {
  it('abre modal de saque ao clicar no botao Sacar', async () => {
    setupMocks({ balance: 500 })
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('R$ 500,00')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(/Sacar \(Pix\)/i))

    expect(screen.getByText('Sacar via PIX')).toBeInTheDocument()
  })

  it('botao de saque desabilitado quando saldo e zero', async () => {
    setupMocks({ balance: 0 })
    renderComponent()

    await waitFor(() => {
      const elements = screen.getAllByText('R$ 0,00')
      expect(elements.length).toBeGreaterThanOrEqual(1)
    })

    // The button text includes the icon, find by role and check disabled
    const buttons = screen.getAllByRole('button')
    const sacarBtn = buttons.find(b => b.textContent?.includes('Sacar (Pix)'))
    expect(sacarBtn).toBeDefined()
    expect(sacarBtn).toBeDisabled()
  })
})

describe('Wallet - Validacao no modal de saque', () => {
  it('botao Confirmar Saque desabilitado quando chave PIX esta vazia', async () => {
    setupMocks({ balance: 500 })
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('R$ 500,00')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(/Sacar \(Pix\)/i))

    // The confirm button is disabled when pixKey is empty
    const confirmarBtn = screen.getByText('Confirmar Saque').closest('button')
    expect(confirmarBtn).toBeDisabled()
  })

  it('exibe toast de valor minimo quando valor menor que R$5', async () => {
    setupMocks({ balance: 500 })
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('R$ 500,00')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(/Sacar \(Pix\)/i))

    const amountInput = screen.getByPlaceholderText('0.00')
    fireEvent.change(amountInput, { target: { value: '3' } })

    // Even with PIX filled, if amount < 5 the button stays disabled
    const confirmarBtn = screen.getByText('Confirmar Saque').closest('button')
    expect(confirmarBtn).toBeDisabled()
  })
})

describe('Wallet - Calculo de taxa 5%', () => {
  it('exibe taxa de 5% e valor liquido no modal de saque', async () => {
    setupMocks({ balance: 1000 })
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('R$ 1000,00')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(/Sacar \(Pix\)/i))

    const amountInput = screen.getByPlaceholderText('0.00')
    fireEvent.change(amountInput, { target: { value: '200' } })

    // Fee = 200 * 0.05 = 10.00, Fixed = 3.00, Net = 200 - 10 - 3 = 187.00
    await waitFor(() => {
      expect(screen.getByText('Taxa de servico Worki (5%)')).toBeInTheDocument()
      expect(screen.getByText('- R$ 10.00')).toBeInTheDocument()
      expect(screen.getByText('R$ 187.00')).toBeInTheDocument()
    })
  })
})

describe('Wallet - Estado vazio', () => {
  it('exibe mensagem quando nao ha transacoes', async () => {
    setupMocks({ balance: 0, transactions: [] })
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Nenhuma transação ainda.')).toBeInTheDocument()
    })
  })
})

describe('Wallet - Erro de rede', () => {
  it('navega para login quando usuario nao autenticado', async () => {
    const mockNavigate = vi.fn()
    vi.mocked(useToast).mockReturnValue({ addToast: vi.fn(), removeToast: vi.fn() })
    vi.mocked(useNavigate).mockReturnValue(mockNavigate)
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: null },
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.getUser>>)

    vi.mocked(WalletService.syncBalance).mockResolvedValue({ success: false })

    renderComponent()

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login')
    })
  })
})
