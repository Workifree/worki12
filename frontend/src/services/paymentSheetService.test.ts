import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
const mockRpc = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}))

vi.mock('./companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
}))

import {
  PaymentSheetService, maskCpf, maskPixKey, inferPixKeyType, pixTypeLabel, toPaymentSheetCSV,
} from './paymentSheetService'
import type { PaymentSheetRow } from '../types'

function sheetRow(over: Partial<PaymentSheetRow> = {}): PaymentSheetRow {
  return {
    worker_id: 'w-1', full_name: 'Ana Souza', cpf: '529.982.247-25', pix_key: 'ana@email.com',
    shifts_count: 3, hours_total: 21.5, hours_missing_count: 1, total_paid: 300, total_to_pay: 120.5,
    has_estimated_amount: true, tags: ['Loja Centro', 'Evento'], payment_ids: ['p1', 'p2'],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null })
})

describe('máscaras', () => {
  it('CPF mostra só o meio', () => {
    expect(maskCpf('529.982.247-25')).toBe('***.982.247-**')
    expect(maskCpf('52998224725')).toBe('***.982.247-**')
    expect(maskCpf(null)).toBe('—')
  })

  it('PIX mostra só o fim e nunca vaza o começo', () => {
    expect(maskPixKey('ana@email.com')).toBe('••••.com')
    expect(maskPixKey('11999998888')).toBe('••••8888')
    expect(maskPixKey('abc')).toBe('••••')
    expect(maskPixKey('ana@email.com')).not.toContain('ana')
    expect(maskPixKey(null)).toBe('—')
  })
})

describe('inferPixKeyType', () => {
  it.each([
    ['ana@email.com', 'email'],
    ['123e4567-e89b-12d3-a456-426614174000', 'aleatoria'],
    ['529.982.247-25', 'cpf'],
    ['52998224725', 'cpf'],
    ['11.222.333/0001-81', 'cnpj'],
    ['11999998888', 'telefone'], // 11 dígitos com DV de CPF inválido
    ['+5511999998888', 'telefone'],
    ['(11) 99999-8888', 'telefone'],
  ])('%s -> %s', (value, expected) => {
    expect(inferPixKeyType(value)).toBe(expected)
  })

  it('não reconhece lixo e vazio', () => {
    expect(inferPixKeyType('chave qualquer')).toBeNull()
    expect(inferPixKeyType('')).toBeNull()
    expect(inferPixKeyType(null)).toBeNull()
  })

  it('o rótulo diz "provável"', () => {
    expect(pixTypeLabel('ana@email.com')).toBe('E-mail (provável)')
    expect(pixTypeLabel('chave qualquer')).toBe('Não identificado')
  })
})

describe('getPaymentSheet', () => {
  it('chama get_payment_sheet com a empresa do seam e filtros', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'ok', rows: [sheetRow()], generated_at: '2026-11-27T10:00:00Z', log_id: 'log-1' }, error: null })
    const sheet = await PaymentSheetService.getPaymentSheet({ from: '2026-11-01', to: '2026-11-30', workerId: '', responsibleId: 'r-1', tagId: null })
    expect(mockRpc).toHaveBeenCalledWith('get_payment_sheet', {
      p_company_id: 'company-1', p_from: '2026-11-01', p_to: '2026-11-30',
      p_worker_id: null, p_responsible_id: 'r-1', p_tag_id: null,
    })
    expect(sheet.outcome).toBe('ok')
    expect(sheet.rows[0].total_paid).toBe(300)
    expect(sheet.log_id).toBe('log-1')
  })

  it('forbidden volta como dado, sem linhas', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'forbidden', rows: [] }, error: null })
    const sheet = await PaymentSheetService.getPaymentSheet({ from: '2026-11-01', to: '2026-11-30' })
    expect(sheet.outcome).toBe('forbidden')
    expect(sheet.rows).toEqual([])
  })

  it('erro da RPC lança', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(PaymentSheetService.getPaymentSheet({ from: '2026-11-01', to: '2026-11-30' })).rejects.toBeTruthy()
  })
})

describe('toPaymentSheetCSV', () => {
  it('BOM, ;, vírgula decimal e CPF/PIX COMPLETOS no arquivo', () => {
    const csv = toPaymentSheetCSV([sheetRow()])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const [header, line] = csv.slice(1).split('\r\n')
    expect(header.split(';')).toHaveLength(12)
    expect(line).toBe('Ana Souza;529.982.247-25;ana@email.com;E-mail (provável);3;21,50;1;300,00;120,50;Sim;Loja Centro, Evento;p1, p2')
  })

  it('protege nome e etiqueta contra fórmula; anonimizado sai com CPF/PIX vazios', () => {
    const csv = toPaymentSheetCSV([sheetRow({ full_name: '=1+1', cpf: null, pix_key: null, tags: ['-x'], has_estimated_amount: false })])
    const cells = csv.slice(1).split('\r\n')[1].split(';')
    expect(cells[0]).toBe("'=1+1")
    expect(cells[1]).toBe('')
    expect(cells[2]).toBe('')
    expect(cells[3]).toBe('')
    expect(cells[9]).toBe('Não')
    expect(cells[10]).toBe("'-x")
  })
})
