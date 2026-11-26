// Redação de dados pessoais do copiloto.
//
// ESTE ARQUIVO EXISTE EM DUAS CÓPIAS IDÊNTICAS (cliente e edge function):
//   frontend/src/lib/copilot/redact.ts
//   supabase/functions/copilot-llm/redact.ts
// O teste `redact.test.ts` falha se as duas divergirem. Sem imports, de propósito.
//
// Limite conhecido: expressão regular não reconhece nome, endereço nem número escrito por
// extenso. O texto da página passa ANTES por um filtro de vocabulário (observe.ts).

// Controle e formato (largura zero, hífen suave, bidi) e uso privado; tab e quebras ficam.
const INVISIVEIS = /[\p{Cc}\p{Cf}\p{Co}]/gu
const MANTIDOS = new Set(['\t', '\n', '\r'])

/** Unifica dígitos de largura total etc. e remove caracteres invisíveis usados para furar regex. */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').replace(INVISIVEIS, (c) => (MANTIDOS.has(c) ? c : ''))
}

type Rule = readonly [RegExp, string | ((match: string, ...groups: string[]) => string)]

const MESES = 'janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro'
const DATA = `(?:\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s+de\\s+(?:${MESES})(?:\\s+de\\s+\\d{4})?)`

const ANTES_DAS_DATAS: readonly Rule[] = [
  // Senha informada em texto livre.
  [/\b(senha|password|passcode)(\s*[:=]\s*|\s+(?:é|eh|is)\s+)(?!\[)[^\s<>"']+/giu, '$1$2[senha]'],
  [/\b(senha|password|passcode)(\s+)(?=[^\s<>"']*\d)(?!\[)[^\s<>"']{4,}/giu, '$1$2[senha]'],
  // Códigos de uso único.
  [/\b(c[oó]digo|otp|token|pin)\b([^\d\n[\]]{0,24}?)\b\d(?:[ -]?\d){3,7}\b/giu, '$1$2[codigo]'],
  // Tokens de convite em caminho (inclusive codificado em redirect=).
  [/((?:\/|%2F)convite(?:-[a-z]+)?(?:\/|%2F))(?!\[)[^\s"'<>?#&)\]]+/giu, '$1[token]'],
  // Parâmetros de URL que carregam segredo ou identificador.
  [/([?&#](?:token|access_token|refresh_token|code|key|apikey|api_key|otp|redirect|conversation|worker|email)=)(?!\[)[^&\s"'<>)\]]+/giu, '$1[oculto]'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]'],
  [/\bsk-[\w-]{12,}/g, '[token]'],
  // E-mail (inclusive %40 e "arroba").
  [/[\p{L}\d._%+-]+(?:@|%40)[\p{L}\d-]+(?:\.[\p{L}\d-]+)+/gu, '[email]'],
  [/[\p{L}\d._+-]+\s*[([]?\s*\b(?:arroba|at)\b\s*[)\]]?\s*[\p{L}\d-]+(?:\s*[([]?\s*(?:\.|\bponto\b|\bdot\b)\s*[)\]]?\s*[\p{L}]{2,})+/giu, '[email]'],
  [/[\p{L}\d._%+-]+@[\p{L}\d-]+/gu, '[email]'],
  // PIX copia e cola (EMV).
  [/000201[^\n]{20,500}?6304[0-9A-Fa-f]{4}/g, '[pix]'],
  [/000201\S{20,}/g, '[pix]'],
  // UUID: id de registro e também chave PIX aleatória.
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]'],
  [/\b[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}\/[A-Z0-9]{4}-\d{2}\b/gi, '[cnpj]'],
  [/\b\d{3}[.,\s]\d{3}[.,\s]\d{3}[-.,\s]?\d{2}\b/g, '[cpf]'],
  // Data de nascimento pelo contexto.
  [new RegExp(`\\b(nasc[\\p{L}.]*|anivers[\\p{L}]*)([^\\d\\n]{0,30}?)${DATA}`, 'giu'), '$1$2[nascimento]'],
]

const DEPOIS_DAS_DATAS: readonly Rule[] = [
  // Telefone brasileiro.
  [/(?:\+\s?55[\s.-]?)?\(\s?\d{2}\s?\)\s?9?[\s.-]?\d{4}[\s.-]?\d{4}\b/g, '[telefone]'],
  [/(?:\+\s?55[\s.-]?)?\b\d{2}[\s.-]9[\s.-]?\d{4}[\s.-]?\d{4}\b/g, '[telefone]'],
  [/\b9\d{4}[\s.-]\d{4}\b/g, '[telefone]'],
  [/\b[2-9]\d{3}-\d{4}\b/g, '[telefone]'],
  // Qualquer sequência longa de dígitos (CPF sem pontuação, CNPJ, telefone, conta, PIX).
  [/\+?\d(?:[ .\-/()_]{0,3}\d){7,}/g, '[numero]'],
  // Cadeias opacas longas (hash, token, chave).
  [/(?<![\w-])(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{20,}(?![\w-])/g, '[token]'],
]

// Valor em dinheiro não é dado pessoal: sai da frente das regras numéricas e volta intacto. Só com o
// símbolo R$ e agrupamento de milhar válido; o que vier colado ("-09", ".12") segue as regras de CPF.
const DINHEIRO = /R\$\s?(?:\d{1,3}(?:\.\d{3}){1,2}|\d{1,7})(?:,\d{1,2})?(?!\d|[-.]\d)/g

const DATA_COMPLETA =new RegExp(
  `\\b(?:(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4})|(\\d{4})-(\\d{2})-(\\d{2})|\\d{1,2}\\s+de\\s+(?:${MESES})\\s+de\\s+(\\d{4}))(?!\\d)`,
  'giu',
)

/** Idade mínima (anos) para uma data completa ser tratada como possível data de nascimento. */
const ANOS_DATA_ANTIGA = 14

/**
 * Teto de tamanho que torna as regras lineares: várias varrem o trecho inteiro a partir de cada
 * posição (custo quadrático). Trecho sem espaço acima do teto sai INTEIRO (nada vaza por corte), e
 * sequências longas de espaços são encurtadas.
 */
const TRECHO_LONGO = /\S{201,}/g
const ESPACOS_LONGOS = /(\s{16})\s+/g

function limitar(text: string): string {
  return text.replace(ESPACOS_LONGOS, '$1').replace(TRECHO_LONGO, '[oculto]')
}

function apply(text: string, rules: readonly Rule[]): string {
  return rules.reduce(
    (acc, [pattern, replacement]) =>
      typeof replacement === 'string' ? acc.replace(pattern, replacement) : acc.replace(pattern, replacement),
    text,
  )
}

export function redactPII(input: string, now: Date = new Date()): string {
  const guardadas: string[] = []
  const limite = now.getFullYear() - ANOS_DATA_ANTIGA
  // Marcador em área de uso privado (a normalização já removeu qualquer um vindo da entrada).
  const guardar = (match: string) => {
    guardadas.push(match)
    return `\uE000${String.fromCharCode(0xe100 + guardadas.length - 1)}\uE001`
  }
  let text = limitar(normalizeText(input)).replace(DINHEIRO, guardar)
  text = apply(text, ANTES_DAS_DATAS)

  // Datas antigas saem; datas recentes (agenda de turnos) são protegidas das regras numéricas.
  text = text.replace(DATA_COMPLETA, (match, ...g: string[]) => {
    const ano = Number(g[2] || g[3] || g[6])
    if (ano <= limite) return '[data-antiga]'
    const dia = Number(g[0] || g[5] || 1)
    const mes = Number(g[1] || g[4] || 1)
    if (ano > now.getFullYear() + 5 || dia > 31 || mes > 12) return match
    return guardar(match)
  })

  text = apply(text, DEPOIS_DAS_DATAS)
  return text.replace(/\uE000([^\uE001])\uE001/g, (_m, c: string) => guardadas[c.charCodeAt(0) - 0xe100] ?? '')
}

/** Verdadeiro se ainda há algo que a redação mudaria. Usado como última trava (fail-closed). */
export function containsPII(text: string, now: Date = new Date()): boolean {
  return redactPII(text, now) !== normalizeText(text)
}
