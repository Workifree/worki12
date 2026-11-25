import { describe, it, expect } from 'vitest'
import { maskPixInput, pixKeyError } from './pixKey'

describe('chave PIX', () => {
  it('aplica máscara por tipo', () => {
    expect(maskPixInput('cpf', '52998224725')).toBe('529.982.247-25')
    expect(maskPixInput('cnpj', '11222333000181')).toBe('11.222.333/0001-81')
    expect(maskPixInput('telefone', '11999998888')).toBe('(11) 99999-8888')
    expect(maskPixInput('telefone', '1133334444')).toBe('(11) 3333-4444')
    expect(maskPixInput('email', 'a@b.com')).toBe('a@b.com')
  })

  it('valida por tipo', () => {
    expect(pixKeyError('cpf', '529.982.247-25')).toBeNull()
    expect(pixKeyError('cpf', '123')).not.toBeNull()
    expect(pixKeyError('telefone', '(11) 99999-8888')).toBeNull()
    expect(pixKeyError('telefone', '99999')).not.toBeNull()
    expect(pixKeyError('email', 'nome@exemplo.com')).toBeNull()
    expect(pixKeyError('email', 'nome@')).not.toBeNull()
    expect(pixKeyError('aleatoria', '123e4567-e89b-12d3-a456-426614174000')).toBeNull()
    expect(pixKeyError('aleatoria', 'abc123')).not.toBeNull()
  })
})
