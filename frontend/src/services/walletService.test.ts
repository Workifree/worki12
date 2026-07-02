import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Wallet, WalletTransaction, EscrowTransaction } from './walletService'

// Mock supabase
// mockSingle serve tanto .single() quanto .maybeSingle() — ambos resolvem { data, error } e o
// teste controla o cenário (linha existe / ausente) via mockResolvedValueOnce, igual no client real.
const mockSingle = vi.fn()
const mockSelect = vi.fn(() => ({
  single: mockSingle,
  maybeSingle: mockSingle,
  eq: vi.fn(() => ({ single: mockSingle, maybeSingle: mockSingle })),
  order: vi.fn(() => ({ data: [] })),
}))
const mockEq = vi.fn(() => ({ single: mockSingle, maybeSingle: mockSingle, select: mockSelect, order: vi.fn(() => ({ data: [] })) }))
const mockInsert = vi.fn(() => ({ select: vi.fn(() => ({ single: mockSingle, maybeSingle: mockSingle })) }))
const mockFrom = vi.fn(() => ({ select: mockSelect, eq: mockEq, insert: mockInsert }))
const mockRpc = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  }
}))

vi.mock('./api', () => ({
  invokeFunction: vi.fn()
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Wallet types', () => {
  it('Wallet interface tem campos esperados', () => {
    const wallet: Wallet = {
      id: 'uuid-1',
      user_id: 'user-1',
      balance: 100.50,
      user_type: 'company',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    expect(wallet.balance).toBe(100.50)
    expect(wallet.user_type).toBe('company')
  })

  it('Wallet aceita worker e company', () => {
    const workerWallet: Wallet = {
      id: 'uuid-2',
      user_id: 'user-2',
      balance: 0,
      user_type: 'worker',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    expect(workerWallet.user_type).toBe('worker')
  })

  it('Wallet aceita asaas_customer_id opcional', () => {
    const wallet: Wallet = {
      id: 'uuid-3',
      user_id: 'user-3',
      balance: 250,
      user_type: 'company',
      asaas_customer_id: 'cus_abc123',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    expect(wallet.asaas_customer_id).toBe('cus_abc123')
  })

  it('WalletTransaction aceita todos os tipos', () => {
    const types: WalletTransaction['type'][] = [
      'credit', 'debit', 'escrow_reserve', 'escrow_release', 'initial_balance'
    ]

    types.forEach(type => {
      const tx: WalletTransaction = {
        id: 'tx-1',
        wallet_id: 'wallet-1',
        amount: 50,
        type,
        description: 'Test',
        reference_id: null,
        created_at: '2024-01-01T00:00:00Z',
      }
      expect(tx.type).toBe(type)
    })
  })

  it('WalletTransaction aceita description e reference_id null', () => {
    const tx: WalletTransaction = {
      id: 'tx-1',
      wallet_id: 'wallet-1',
      amount: -100,
      type: 'debit',
      description: null,
      reference_id: null,
      created_at: '2024-01-01T00:00:00Z',
    }

    expect(tx.description).toBeNull()
    expect(tx.reference_id).toBeNull()
    expect(tx.amount).toBeLessThan(0)
  })

  it('EscrowTransaction aceita todos os status', () => {
    const statuses: EscrowTransaction['status'][] = ['reserved', 'released', 'refunded']

    statuses.forEach(status => {
      const escrow: EscrowTransaction = {
        id: 'escrow-1',
        job_id: 'job-1',
        application_id: null,
        amount: 200,
        company_wallet_id: 'wallet-1',
        worker_wallet_id: null,
        status,
        created_at: '2024-01-01T00:00:00Z',
        released_at: null,
      }
      expect(escrow.status).toBe(status)
    })
  })

  it('EscrowTransaction pode ter job join', () => {
    const escrow: EscrowTransaction = {
      id: 'escrow-1',
      job_id: 'job-1',
      application_id: 'app-1',
      amount: 300,
      company_wallet_id: 'wallet-1',
      worker_wallet_id: 'wallet-2',
      status: 'released',
      created_at: '2024-01-01T00:00:00Z',
      released_at: '2024-01-02T00:00:00Z',
      job: { title: 'Garcom para evento' },
    }

    expect(escrow.job?.title).toBe('Garcom para evento')
    expect(escrow.released_at).not.toBeNull()
  })

  it('EscrowTransaction released tem released_at preenchido', () => {
    const escrow: EscrowTransaction = {
      id: 'escrow-2',
      job_id: 'job-2',
      application_id: 'app-2',
      amount: 150,
      company_wallet_id: 'wallet-1',
      worker_wallet_id: 'wallet-3',
      status: 'released',
      created_at: '2024-01-01T00:00:00Z',
      released_at: '2024-01-05T12:00:00Z',
    }

    expect(escrow.status).toBe('released')
    expect(escrow.released_at).toBeTruthy()
    expect(escrow.worker_wallet_id).toBeTruthy()
  })
})

describe('WalletService methods', () => {
  it('getOrCreateWallet retorna wallet existente', async () => {
    const existingWallet = {
      id: 'w-1', user_id: 'u-1', balance: 500, user_type: 'worker',
      created_at: '2024-01-01', updated_at: '2024-01-01'
    }

    mockSingle.mockResolvedValueOnce({ data: existingWallet, error: null })

    const { WalletService } = await import('./walletService')
    const result = await WalletService.getOrCreateWallet('u-1', 'worker')

    expect(result).toEqual(existingWallet)
    expect(mockFrom).toHaveBeenCalledWith('wallets')
  })

  // Caracterização do fix B2: no primeiro acesso (onboarding) ainda não existe linha em `wallets`.
  // A busca inicial usa `.maybeSingle()` (não `.single()`) para que a AUSÊNCIA de linha resolva
  // como `{ data: null, error: null }` (sem 406) em vez de lançar erro — só então o fluxo cria a
  // wallet via INSERT.
  it('getOrCreateWallet cria wallet nova quando ainda nao existe (sem 406 na busca inicial)', async () => {
    const newWallet = {
      id: 'w-2', user_id: 'u-2', balance: 0, user_type: 'worker',
      created_at: '2024-01-01', updated_at: '2024-01-01'
    }

    // 1ª resolução: busca inicial (.maybeSingle()) — ausência de linha, sem erro.
    mockSingle.mockResolvedValueOnce({ data: null, error: null })
    // 2ª resolução: INSERT ... .select().single() — cria e retorna a wallet nova.
    mockSingle.mockResolvedValueOnce({ data: newWallet, error: null })

    const { WalletService } = await import('./walletService')
    const result = await WalletService.getOrCreateWallet('u-2', 'worker')

    expect(result).toEqual(newWallet)
    expect(mockInsert).toHaveBeenCalledWith({ user_id: 'u-2', balance: 0.00, user_type: 'worker' })
  })

  it('getBalance retorna 0 quando wallet nao existe', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null })

    const { WalletService } = await import('./walletService')
    const balance = await WalletService.getBalance('unknown-user')

    expect(balance).toBe(0)
  })

  it('getTransactions retorna array vazio quando wallet nao existe', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null })

    const { WalletService } = await import('./walletService')
    const txs = await WalletService.getTransactions('unknown-user')

    expect(txs).toEqual([])
  })

  it('reserveEscrow retorna erro de saldo insuficiente', async () => {
    mockRpc.mockResolvedValueOnce({
      error: { message: 'Saldo insuficiente', code: 'P0001' }
    })

    const { WalletService } = await import('./walletService')
    const result = await WalletService.reserveEscrow('job-1', 1000, 'user-1')

    expect(result.success).toBe(false)
    expect(result.error).toContain('Saldo insuficiente')
  })

  it('reserveEscrow retorna sucesso', async () => {
    mockRpc.mockResolvedValueOnce({ error: null })

    const { WalletService } = await import('./walletService')
    const result = await WalletService.reserveEscrow('job-1', 100, 'user-1')

    expect(result.success).toBe(true)
  })

  it('refundEscrow retorna sucesso mesmo sem escrow existente', async () => {
    mockRpc.mockResolvedValueOnce({
      error: { message: 'No reserved escrow found', code: 'P0001' }
    })

    const { WalletService } = await import('./walletService')
    const result = await WalletService.refundEscrow('job-1')

    expect(result.success).toBe(true)
  })

  it('withdrawFunds chama invokeFunction com parametros corretos', async () => {
    const { invokeFunction } = await import('./api')
    const mockInvoke = vi.mocked(invokeFunction)
    mockInvoke.mockResolvedValueOnce({ success: true })

    const { WalletService } = await import('./walletService')
    const result = await WalletService.withdrawFunds(100, '12345678900', 'CPF')

    expect(result.success).toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith('asaas-withdraw', {
      amount: 100, pixKey: '12345678900', pixKeyType: 'CPF'
    })
  })

  it('withdrawFunds retorna erro quando invokeFunction falha', async () => {
    const { invokeFunction } = await import('./api')
    const mockInvoke = vi.mocked(invokeFunction)
    mockInvoke.mockRejectedValueOnce(new Error('Saldo insuficiente'))

    const { WalletService } = await import('./walletService')
    const result = await WalletService.withdrawFunds(10000, '12345678900', 'CPF')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Saldo insuficiente')
  })

  it('createDeposit chama invokeFunction com payload', async () => {
    const { invokeFunction } = await import('./api')
    const mockInvoke = vi.mocked(invokeFunction)
    mockInvoke.mockResolvedValueOnce({ paymentId: 'pay_123', pixQrCodeUrl: 'https://...' })

    const { WalletService } = await import('./walletService')
    const result = await WalletService.createDeposit({ amount: 200, name: 'Test', cpfCnpj: '12345678900' })

    expect(result.paymentId).toBe('pay_123')
    expect(mockInvoke).toHaveBeenCalledWith('asaas-deposit', {
      amount: 200, name: 'Test', cpfCnpj: '12345678900'
    })
  })

  it('syncBalance retorna resultado do invokeFunction', async () => {
    const { invokeFunction } = await import('./api')
    const mockInvoke = vi.mocked(invokeFunction)
    mockInvoke.mockResolvedValueOnce({ success: true, hasUpdates: true, totalSynced: 3 })

    const { WalletService } = await import('./walletService')
    const result = await WalletService.syncBalance()

    expect(result.success).toBe(true)
    expect(result.totalSynced).toBe(3)
  })

  it('getBalance retorna saldo da wallet existente', async () => {
    mockSingle.mockResolvedValueOnce({ data: { balance: 350.75 }, error: null })

    const { WalletService } = await import('./walletService')
    const balance = await WalletService.getBalance('user-with-balance')

    expect(balance).toBe(350.75)
    expect(mockFrom).toHaveBeenCalledWith('wallets')
  })

  it('withdrawFunds valida valor minimo retornando erro para valor zero', async () => {
    const { invokeFunction } = await import('./api')
    const mockInvoke = vi.mocked(invokeFunction)
    mockInvoke.mockRejectedValueOnce(new Error('Valor minimo nao atingido'))

    const { WalletService } = await import('./walletService')
    const result = await WalletService.withdrawFunds(0, '12345678900', 'CPF')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Valor minimo nao atingido')
  })

  it('withdrawFunds valida valor minimo retornando erro para valor negativo', async () => {
    const { invokeFunction } = await import('./api')
    const mockInvoke = vi.mocked(invokeFunction)
    mockInvoke.mockRejectedValueOnce(new Error('Valor invalido'))

    const { WalletService } = await import('./walletService')
    const result = await WalletService.withdrawFunds(-50, '12345678900', 'CPF')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Valor invalido')
  })
})
