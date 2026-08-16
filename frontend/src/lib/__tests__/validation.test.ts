import { describe, it, expect } from 'vitest'
import { validateCPF, validateCNPJ, validateCPFOrCNPJ, formatCpfCnpj, validateEmail, getPasswordStrength, normalizePixKeyForStorage } from '../validation'

describe('validateCPF', () => {
    it('aceita CPF valido (52998224725)', () => {
        expect(validateCPF('52998224725')).toBe(true)
    })

    it('aceita CPF valido formatado (529.982.247-25)', () => {
        expect(validateCPF('529.982.247-25')).toBe(true)
    })

    it('aceita CPF valido (111.444.777-35)', () => {
        expect(validateCPF('11144477735')).toBe(true)
    })

    it('rejeita CPF com digitos verificadores incorretos', () => {
        expect(validateCPF('52998224700')).toBe(false)
    })

    it('rejeita CPF com todos os digitos iguais (11111111111)', () => {
        expect(validateCPF('11111111111')).toBe(false)
    })

    it('rejeita CPF com todos os digitos iguais (00000000000)', () => {
        expect(validateCPF('00000000000')).toBe(false)
    })

    it('rejeita CPF com todos os digitos iguais (99999999999)', () => {
        expect(validateCPF('99999999999')).toBe(false)
    })

    it('rejeita CPF com tamanho incorreto (menos de 11)', () => {
        expect(validateCPF('1234567890')).toBe(false)
    })

    it('rejeita CPF com tamanho incorreto (mais de 11)', () => {
        expect(validateCPF('123456789012')).toBe(false)
    })

    it('rejeita CPF vazio', () => {
        expect(validateCPF('')).toBe(false)
    })
})

describe('validateCNPJ', () => {
    it('aceita CNPJ valido (11.222.333/0001-81)', () => {
        expect(validateCNPJ('11222333000181')).toBe(true)
    })

    it('aceita CNPJ valido formatado', () => {
        expect(validateCNPJ('11.222.333/0001-81')).toBe(true)
    })

    it('rejeita CNPJ com digitos verificadores incorretos', () => {
        expect(validateCNPJ('11222333000100')).toBe(false)
    })

    it('rejeita CNPJ com todos os digitos iguais (11111111111111)', () => {
        expect(validateCNPJ('11111111111111')).toBe(false)
    })

    it('rejeita CNPJ com todos os digitos iguais (00000000000000)', () => {
        expect(validateCNPJ('00000000000000')).toBe(false)
    })

    it('rejeita CNPJ com todos os digitos iguais (99999999999999)', () => {
        expect(validateCNPJ('99999999999999')).toBe(false)
    })

    it('rejeita CNPJ com tamanho incorreto', () => {
        expect(validateCNPJ('1122233300018')).toBe(false)
    })

    it('rejeita CNPJ vazio', () => {
        expect(validateCNPJ('')).toBe(false)
    })
})

describe('validateCPFOrCNPJ', () => {
    it('aceita CPF valido desformatado e formatado', () => {
        expect(validateCPFOrCNPJ('52998224725')).toBe(true)
        expect(validateCPFOrCNPJ('529.982.247-25')).toBe(true)
    })

    it('aceita CNPJ valido desformatado e formatado', () => {
        expect(validateCPFOrCNPJ('11222333000181')).toBe(true)
        expect(validateCPFOrCNPJ('11.222.333/0001-81')).toBe(true)
    })

    it('rejeita CPF invalido', () => {
        expect(validateCPFOrCNPJ('52998224700')).toBe(false)
    })

    it('rejeita CNPJ invalido', () => {
        expect(validateCPFOrCNPJ('11222333000100')).toBe(false)
    })

    it('rejeita comprimentos que nao sao nem CPF nem CNPJ', () => {
        expect(validateCPFOrCNPJ('1234567890')).toBe(false) // 10 digitos
        expect(validateCPFOrCNPJ('123456789012')).toBe(false) // 12 digitos
        expect(validateCPFOrCNPJ('1234567890123')).toBe(false) // 13 digitos
        expect(validateCPFOrCNPJ('123456789012345')).toBe(false) // 15 digitos
        expect(validateCPFOrCNPJ('')).toBe(false)
    })
})

describe('formatCpfCnpj', () => {
    it('formata CPF (11 digitos) corretamente', () => {
        expect(formatCpfCnpj('52998224725')).toBe('529.982.247-25')
    })

    it('formata CNPJ (14 digitos) corretamente', () => {
        expect(formatCpfCnpj('11222333000181')).toBe('11.222.333/0001-81')
    })

    it('formata parcialmente enquanto digita CPF', () => {
        expect(formatCpfCnpj('123')).toBe('123')
        expect(formatCpfCnpj('1234')).toBe('123.4')
        expect(formatCpfCnpj('1234567')).toBe('123.456.7')
        expect(formatCpfCnpj('1234567890')).toBe('123.456.789-0')
    })
})

describe('validateEmail', () => {
    it('aceita email valido simples', () => {
        expect(validateEmail('user@example.com')).toBe(true)
    })

    it('aceita email com subdominio', () => {
        expect(validateEmail('user@mail.example.com')).toBe(true)
    })

    it('aceita email com ponto no nome', () => {
        expect(validateEmail('first.last@example.com')).toBe(true)
    })

    it('aceita email com + no nome', () => {
        expect(validateEmail('user+tag@example.com')).toBe(true)
    })

    it('rejeita email sem @', () => {
        expect(validateEmail('userexample.com')).toBe(false)
    })

    it('rejeita email sem dominio', () => {
        expect(validateEmail('user@')).toBe(false)
    })

    it('rejeita email sem nome', () => {
        expect(validateEmail('@example.com')).toBe(false)
    })

    it('rejeita email com espaco', () => {
        expect(validateEmail('user @example.com')).toBe(false)
    })

    it('rejeita email sem TLD', () => {
        expect(validateEmail('user@example')).toBe(false)
    })

    it('rejeita string vazia', () => {
        expect(validateEmail('')).toBe(false)
    })
})

describe('normalizePixKeyForStorage', () => {
    it('remove mascara de CPF antes de persistir', () => {
        expect(normalizePixKeyForStorage('cpf', '529.982.247-25')).toBe('52998224725')
    })

    it('remove mascara de CNPJ antes de persistir', () => {
        expect(normalizePixKeyForStorage('cnpj', '11.222.333/0001-81')).toBe('11222333000181')
    })

    it('remove mascara de telefone antes de persistir', () => {
        expect(normalizePixKeyForStorage('telefone', '(11) 99999-9999')).toBe('11999999999')
    })

    it('mantem e-mail como digitado (so trim)', () => {
        expect(normalizePixKeyForStorage('email', '  user@example.com  ')).toBe('user@example.com')
    })

    it('mantem chave aleatoria (UUID) como digitada (so trim)', () => {
        expect(normalizePixKeyForStorage('aleatoria', '  a1b2c3d4-e5f6-7890-abcd-ef1234567890  ')).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    })

    it('e idempotente: aplicar duas vezes no valor ja normalizado nao muda o resultado', () => {
        const once = normalizePixKeyForStorage('cpf', '529.982.247-25')
        const twice = normalizePixKeyForStorage('cpf', once)
        expect(twice).toBe(once)
    })

    it('valor ja sem mascara passa direto (idempotencia entre tipos)', () => {
        expect(normalizePixKeyForStorage('telefone', '11999999999')).toBe('11999999999')
        expect(normalizePixKeyForStorage('email', 'user@example.com')).toBe('user@example.com')
    })
})

describe('getPasswordStrength', () => {
    it('senha vazia retorna Fraca (score 0)', () => {
        const result = getPasswordStrength('')
        expect(result.label).toBe('Fraca')
        expect(result.score).toBe(0)
    })

    it('senha curta (<8 chars) retorna Fraca', () => {
        const result = getPasswordStrength('abc')
        expect(result.label).toBe('Fraca')
        expect(result.score).toBeLessThanOrEqual(1)
    })

    it('senha com 8+ chars minusculas retorna Fraca (score 1)', () => {
        const result = getPasswordStrength('abcdefgh')
        expect(result.label).toBe('Fraca')
        expect(result.score).toBe(1)
    })

    it('senha com 8+ chars e numeros retorna Razoavel (score 2)', () => {
        const result = getPasswordStrength('abcdefg1')
        expect(result.label).toBe('Razoavel')
        expect(result.score).toBe(2)
    })

    it('senha com 8+ chars, maiusculas e minusculas retorna Razoavel (score 2)', () => {
        const result = getPasswordStrength('Abcdefgh')
        expect(result.label).toBe('Razoavel')
        expect(result.score).toBe(2)
    })

    it('senha com 8+ chars, maiusculas, minusculas e numeros retorna Media (score 3)', () => {
        const result = getPasswordStrength('Abcdefg1')
        expect(result.label).toBe('Media')
        expect(result.score).toBe(3)
    })

    it('senha com 12+ chars, maiusculas, minusculas e numeros retorna Forte (score 4)', () => {
        const result = getPasswordStrength('Abcdefghijk1')
        expect(result.label).toBe('Forte')
        expect(result.score).toBe(4)
    })

    it('senha com tudo (12+ chars, maiuscula, minuscula, numero, especial) retorna Forte (score 5)', () => {
        const result = getPasswordStrength('Abcdefghij1!')
        expect(result.label).toBe('Forte')
        expect(result.score).toBe(5)
    })

    it('retorna cores corretas para cada nivel', () => {
        expect(getPasswordStrength('abc').color).toBe('bg-red-500')
        expect(getPasswordStrength('abcdefg1').color).toBe('bg-yellow-500')
        expect(getPasswordStrength('Abcdefg1').color).toBe('bg-blue-500')
        expect(getPasswordStrength('Abcdefghij1!').color).toBe('bg-green-500')
    })

    it('retorna widths corretos para cada nivel', () => {
        expect(getPasswordStrength('abc').width).toBe('w-1/4')
        expect(getPasswordStrength('abcdefg1').width).toBe('w-1/2')
        expect(getPasswordStrength('Abcdefg1').width).toBe('w-3/4')
        expect(getPasswordStrength('Abcdefghij1!').width).toBe('w-full')
    })
})
