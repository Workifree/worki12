/** Sugestões de pedido por papel e tela, e o histórico curto de pedidos (só neste aparelho). */
import { containsPII, redactPII } from './redact'
import type { CopilotRole } from './routes'

const WORKER: Array<[RegExp, string[]]> = [
  [/^\/my-jobs/, ['Mostre meus convites', 'Como registro minha chegada?', 'Onde vejo turnos antigos?']],
  [/^\/recebimentos|^\/recibo/, ['Quanto tenho para receber?', 'Como confirmo um recebimento?']],
  [/^\/profile/, ['Mudar minha disponibilidade', 'Onde troco minha foto?', 'Onde coloco minha chave PIX?']],
  [/^\/messages/, ['Como falo com a empresa?']],
  [/^\/carteira/, ['Onde vejo as empresas que me chamaram?']],
]
const COMPANY: Array<[RegExp, string[]]> = [
  [/^\/company\/jobs/, ['Chamar freelas para um turno', 'Onde vejo quem aceitou?']],
  [/^\/company\/create/, ['Me ajude a criar um turno', 'Como repito um turno?']],
  [/^\/company\/team/, ['Como convido alguém para o elenco?', 'Criar uma lista do elenco']],
  [/^\/company\/hoje|^\/company\/dashboard/, ['Quem trabalha amanhã?', 'Me ajude a criar um turno']],
  [/^\/company\/relatorio/, ['Onde vejo o que paguei no mês?']],
]

const BASE: Record<CopilotRole, string[]> = {
  worker: ['Tenho algum convite?', 'Onde vejo meus recebimentos?', 'Como mudo minha disponibilidade?'],
  company: ['Me ajude a criar um turno', 'Como chamo freelas para um turno?', 'Onde vejo meu elenco?'],
}

export function suggestionsFor(role: CopilotRole, pathname: string, max = 4): string[] {
  const table = role === 'company' ? COMPANY : WORKER
  const specific = table.find(([pattern]) => pattern.test(pathname))?.[1] ?? []
  return [...new Set([...specific, ...BASE[role]])].slice(0, max)
}

const HISTORY_KEY = 'worki:copilot:historico-v1'
const HISTORY_MAX = 5
const MARCADOR_PII = /\[(?:cpf|cnpj|telefone|email|senha|codigo|token|pix|id|numero|nascimento|data-antiga|oculto)\]/i

export function readHistory(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown
    // O que já estava gravado (versão anterior) também passa pelo filtro: nada com dado pessoal volta à tela.
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string' && !!x.trim() && !containsPII(x) && !MARCADOR_PII.test(x)).slice(0, HISTORY_MAX)
      : []
  } catch {
    return []
  }
}

/**
 * Guarda no aparelho só o pedido já redigido, no máximo 5. Pedido com padrão de dado pessoal (CPF,
 * telefone, e-mail etc.) não é guardado de jeito nenhum, nem com marcador no lugar.
 */
export function rememberRequest(text: string): string[] {
  if (containsPII(text)) return readHistory()
  const clean = redactPII(text).replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!clean || MARCADOR_PII.test(clean) || containsPII(clean)) return readHistory()
  const next = [clean, ...readHistory().filter((x) => x !== clean)].slice(0, HISTORY_MAX)
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {
    // sem armazenamento: só não lembra
  }
  return next
}

export function clearHistory(): void {
  try {
    window.localStorage.removeItem(HISTORY_KEY)
  } catch {
    // nada a limpar
  }
}

/** Opções que a própria pergunta do agente sugere ("Por exemplo: A, B ou C"), viram respostas rápidas. */
export function quickAnswersFor(question: string): string[] {
  const match = /(?:por exemplo|ex\.?|como)\s*[:,]?\s*([^?.]{6,160})/i.exec(question)
  const options = match
    ? match[1]
        .split(/\s*(?:,|;|\bou\b)\s*/i)
        .map((part) => part.replace(/^(?:ou|e)\s+/i, '').trim())
        .filter((part) => part.length >= 3 && part.length <= 48)
        .slice(0, 3)
    : []
  // Pergunta de sim ou não só quando a própria pergunta não trouxe opções.
  const yesNo =
    !options.length && /\?\s*$/.test(question.trim()) && /\b(?:quer|posso|devo|pode|confirma|certeza)\b/i.test(question) ? ['Sim', 'Não'] : []
  return [...new Set([...options, ...yesNo])].slice(0, 4)
}
