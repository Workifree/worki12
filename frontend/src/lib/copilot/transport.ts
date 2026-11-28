/**
 * Último ponto antes da rede. O `transformPageContent` do page-agent não cobre pedido,
 * histórico, URL nem a linha do elemento clicado; por isso o corpo FINAL é reconstruído aqui:
 * só os campos conhecidos, redigidos de novo, e abortado se ainda sobrar padrão de dado pessoal.
 */
import { devEvalModel } from './evalModel'
import { containsPII, redactPII } from './redact'
import type { CopilotRole } from './routes'

export const TOOL_NAME = 'AgentOutput'
export const CLIENT_MODEL = 'worki-copilot'
const MAX_USER_CHARS = 40_000

export class UnsafeRequestError extends Error {}

export interface SafeRequest {
  model: string
  role: CopilotRole
  messages: [{ role: 'system'; content: string }, { role: 'user'; content: string }]
  tools: [{ type: 'function'; function: { name: string } }]
}

export function buildSafeRequest(rawBody: unknown, role: CopilotRole): SafeRequest {
  if (typeof rawBody !== 'string') throw new UnsafeRequestError('corpo ausente')
  let parsed: { messages?: unknown }
  try {
    parsed = JSON.parse(rawBody) as { messages?: unknown }
  } catch {
    throw new UnsafeRequestError('corpo ilegível')
  }
  const messages = parsed.messages
  if (!Array.isArray(messages) || messages.length !== 2) throw new UnsafeRequestError('formato inesperado')
  const [system, user] = messages as Array<{ role?: unknown; content?: unknown }>
  if (system.role !== 'system' || user.role !== 'user' || typeof user.content !== 'string') {
    throw new UnsafeRequestError('formato inesperado')
  }
  const content = redactPII(user.content)
  if (containsPII(content)) throw new UnsafeRequestError('sobrou dado pessoal no corpo')
  if (content.length > MAX_USER_CHARS) throw new UnsafeRequestError('corpo grande demais')
  return {
    model: CLIENT_MODEL,
    role,
    // O prompt de sistema verdadeiro é do servidor.
    messages: [
      { role: 'system', content: '' },
      { role: 'user', content },
    ],
    tools: [{ type: 'function', function: { name: TOOL_NAME } }],
  }
}

export interface CopilotFetchOptions {
  endpoint: string
  role: CopilotRole
  getHeaders: () => Promise<Record<string, string>>
  fetchImpl?: typeof fetch
}

/** `customFetch` do page-agent: IGNORA a URL pedida e só fala com o proxy do Workyn. */
export function createCopilotFetch(options: CopilotFetchOptions): typeof fetch {
  return async (_url, init) => {
    const body = buildSafeRequest(init?.body, options.role)
    const send = options.fetchImpl ?? fetch
    return send(options.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await options.getHeaders()) },
      // `import.meta.env.DEV` é `false` no build: produção nunca envia `eval`.
      body: JSON.stringify(import.meta.env.DEV ? { ...body, ...devEvalModel() } : body),
      signal: init?.signal,
      credentials: 'omit',
      redirect: 'error',
    })
  }
}
