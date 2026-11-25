import { validateCNPJ, validateCPF, validateEmail, type PixKeyType } from '../../lib/validation'

/** Máscara só visual: a persistência passa por `normalizePixKeyForStorage`. */
export function maskPixInput(type: PixKeyType, value: string): string {
  if (type === 'email' || type === 'aleatoria') return value
  const d = value.replace(/\D/g, '')
  if (type === 'cpf') {
    return d
      .slice(0, 11)
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1-$2')
  }
  if (type === 'cnpj') {
    return d
      .slice(0, 14)
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2')
  }
  const t = d.slice(0, 11)
  if (t.length <= 2) return t
  const rest = t.slice(2)
  const cut = rest.length > 8 ? 5 : 4
  return rest.length > cut ? `(${t.slice(0, 2)}) ${rest.slice(0, cut)}-${rest.slice(cut)}` : `(${t.slice(0, 2)}) ${rest}`
}

/** Devolve a mensagem de erro, ou null quando a chave é válida para o tipo. */
export function pixKeyError(type: PixKeyType, value: string): string | null {
  const v = value.trim()
  const digits = v.replace(/\D/g, '')
  switch (type) {
    case 'cpf':
      return digits.length === 11 && validateCPF(digits) ? null : 'CPF inválido: confira os 11 dígitos.'
    case 'cnpj':
      return digits.length === 14 && validateCNPJ(digits) ? null : 'CNPJ inválido: confira os 14 dígitos.'
    case 'telefone':
      return digits.length === 10 || digits.length === 11 ? null : 'Informe o telefone com DDD.'
    case 'email':
      return validateEmail(v) ? null : 'E-mail inválido.'
    case 'aleatoria':
      return /^[0-9a-f]{32}$/i.test(v.replace(/-/g, ''))
        ? null
        : 'A chave aleatória tem 32 letras e números (com ou sem traços).'
  }
}
