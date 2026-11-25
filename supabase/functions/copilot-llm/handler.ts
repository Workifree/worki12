// Lógica da função, sem Deno nem rede direta: tudo entra por `Deps`, para ser testável.
// Regra de log: NUNCA conteúdo (pedido, tela, resposta, token). Só eventos e números.
import { ACTIONS, CLIENT_MODEL, DESTINATIONS, SYSTEM_PROMPT, TOOL_NAME, agentOutputSchema, type Role } from './contract.ts'
import { MAX_OUTPUT_TOKENS, buildProviderCall, parseProviderResponse, readProviderConfig } from './providers.ts'
import { containsPII, redactPII } from './redact.ts'

export interface Limits {
  perMinute: number
  perDay: number
  userDailyTokens: number
  globalDailyTokens: number
}

export interface Reservation {
  allowed: boolean
  reason?: string
  /** Dia contábil devolvido pelo banco, para o acerto. */
  day?: string
}

export interface Deps {
  env(name: string): string | undefined
  /** `null` para token ausente, inválido, anônimo ou chave anon. */
  getUserId(token: string): Promise<string | null>
  reserve(userId: string, limits: Limits, estimate: number): Promise<Reservation>
  settle(userId: string, day: string, estimate: number, inputTokens: number, outputTokens: number): Promise<void>
  fetch(url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }): Promise<Response>
  log(event: string, data?: Record<string, number | string>): void
}

const DEFAULT_ORIGINS = ['https://worki-opal.vercel.app', 'http://localhost:5173']
export const MAX_BODY_BYTES = 120_000
export const MAX_USER_CHARS = 40_000

function allowedOrigins(deps: Deps): string[] {
  const extra = (deps.env('COPILOT_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => /^https?:\/\/[^*\s]+$/.test(o))
  return [...DEFAULT_ORIGINS, ...extra]
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  }
}

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function readLimits(env: Deps['env']): Limits {
  return {
    perMinute: positive(env('COPILOT_LIMIT_PER_MINUTE'), 20),
    perDay: positive(env('COPILOT_LIMIT_PER_DAY'), 200),
    userDailyTokens: positive(env('COPILOT_USER_DAILY_TOKENS'), 600_000),
    globalDailyTokens: positive(env('COPILOT_GLOBAL_DAILY_TOKENS'), 3_000_000),
  }
}

export interface ValidRequest {
  role: Role
  user: string
}

/** Aceita só o formato exato do cliente do Worki e redige de novo. */
export function validateRequestBody(raw: string): ValidRequest | string {
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return 'invalid_json'
  }
  if (!body || typeof body !== 'object') return 'invalid_body'
  const allowedKeys = new Set(['model', 'role', 'messages', 'tools'])
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) return 'unknown_field'
  if (body.model !== CLIENT_MODEL) return 'model_not_allowed'
  const role = body.role
  if (role !== 'company' && role !== 'worker') return 'invalid_role'
  const tools = body.tools as Array<{ type?: string; function?: { name?: string } }>
  if (!Array.isArray(tools) || tools.length !== 1 || tools[0]?.function?.name !== TOOL_NAME) return 'tool_not_allowed'
  const messages = body.messages as Array<{ role?: string; content?: unknown }>
  if (!Array.isArray(messages) || messages.length !== 2) return 'invalid_messages'
  if (messages[0]?.role !== 'system' || messages[1]?.role !== 'user') return 'invalid_messages'
  const content = messages[1].content
  if (typeof content !== 'string' || !content.includes('<agent_state>') || !content.includes('<browser_state>')) {
    return 'invalid_messages'
  }
  if (content.length > MAX_USER_CHARS) return 'too_large'
  // Terceira redação (a do cliente não é confiável) e trava final.
  const user = redactPII(content)
  if (containsPII(user)) return 'pii_detected'
  return { role, user }
}

export interface CleanOutput {
  evaluation_previous_goal?: string
  memory?: string
  next_goal?: string
  action: Record<string, Record<string, unknown>>
}

/** Resposta do modelo: reconstruída campo a campo. Qualquer coisa fora da lista -> `null`. */
export function validateModelOutput(args: unknown, role: Role): CleanOutput | null {
  if (!args || typeof args !== 'object') return null
  const input = args as Record<string, unknown>
  let action = input.action
  if (typeof action === 'string') {
    try {
      action = JSON.parse(action)
    } catch {
      return null
    }
  }
  if (!action || typeof action !== 'object') return null
  const names = Object.keys(action)
  if (names.length !== 1 || !Object.prototype.hasOwnProperty.call(ACTIONS, names[0])) return null
  const name = names[0]
  const values = (action as Record<string, unknown>)[name]
  if (!values || typeof values !== 'object') return null
  const spec = ACTIONS[name].fields
  if (Object.keys(values).some((key) => !Object.prototype.hasOwnProperty.call(spec, key))) return null
  const clean: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(spec)) {
    const value = (values as Record<string, unknown>)[key]
    if (value === undefined || value === null) {
      if (field.required) return null
      continue
    }
    if (field.type === 'string') {
      if (typeof value !== 'string') return null
      clean[key] = redactPII(value).slice(0, field.maxLength)
    } else if (field.type === 'boolean') {
      if (typeof value !== 'boolean') return null
      clean[key] = value
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      if (field.type === 'integer' && !Number.isInteger(value)) return null
      if (value < (field.min ?? -Infinity) || value > (field.max ?? Infinity)) return null
      clean[key] = value
    }
  }
  if (name === 'navigate' && !(DESTINATIONS[role] as readonly string[]).includes(clean.destination as string)) return null
  const output: CleanOutput = { action: { [name]: clean } }
  for (const key of ['evaluation_previous_goal', 'memory', 'next_goal'] as const) {
    if (typeof input[key] === 'string') output[key] = redactPII(input[key] as string).slice(0, 400)
  }
  return output
}

export async function handleCopilot(request: Request, deps: Deps): Promise<Response> {
  const origin = request.headers.get('origin')
  const originOk = !origin || allowedOrigins(deps).includes(origin)
  const headers = corsHeaders(originOk ? origin : null)
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
  const refuse = (status: number, code: string) => {
    deps.log('recusado', { status, code })
    return reply(status, { error: { message: code } })
  }

  if (!originOk) return refuse(403, 'origin_not_allowed')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'GET' && request.method !== 'POST') return refuse(405, 'method_not_allowed')

  const token = /^Bearer (.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]
  let userId: string | null = null
  try {
    userId = token ? await deps.getUserId(token) : null
  } catch {
    userId = null
  }
  if (!userId) return refuse(401, 'unauthorized')

  const config = readProviderConfig(deps.env)
  if (!config) return refuse(503, 'copilot_unavailable')
  if (request.method === 'GET') return reply(200, { available: true })

  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return refuse(413, 'too_large')
  let raw: string
  try {
    raw = await request.text()
  } catch {
    return refuse(400, 'invalid_body')
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return refuse(413, 'too_large')
  const valid = validateRequestBody(raw)
  if (typeof valid === 'string') return refuse(valid === 'too_large' ? 413 : 400, valid)

  const estimate = Math.ceil((SYSTEM_PROMPT.length + valid.user.length + 4000) / 3) + MAX_OUTPUT_TOKENS
  let reservation: Reservation
  try {
    reservation = await deps.reserve(userId, readLimits(deps.env), estimate)
  } catch {
    // Sem controle de custo (migration não aplicada, banco fora) não há chamada ao provedor.
    return refuse(503, 'quota_unavailable')
  }
  if (!reservation.allowed || !reservation.day) return refuse(429, reservation.reason ?? 'quota_exceeded')

  const call = buildProviderCall(config, SYSTEM_PROMPT, valid.user, agentOutputSchema(valid.role))
  let inputTokens = estimate - MAX_OUTPUT_TOKENS
  let outputTokens = MAX_OUTPUT_TOKENS
  try {
    const response = await deps.fetch(call.url, { ...call.init, signal: AbortSignal.timeout(45_000) })
    if (!response.ok) {
      // O corpo do erro do provedor pode ecoar o pedido: não é lido nem registrado.
      return refuse(response.status === 429 ? 429 : 502, `provider_${response.status}`)
    }
    const result = parseProviderResponse(config.provider, await response.json())
    if (result.inputTokens || result.outputTokens) {
      inputTokens = result.inputTokens
      outputTokens = result.outputTokens
    }
    const output = validateModelOutput(result.args, valid.role)
    if (!output) return refuse(502, 'invalid_model_output')
    deps.log('ok', { inputTokens, outputTokens })
    return reply(200, {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: TOOL_NAME, arguments: JSON.stringify(output) } },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    })
  } catch {
    return refuse(502, 'provider_unreachable')
  } finally {
    try {
      await deps.settle(userId, reservation.day, estimate, inputTokens, outputTokens)
    } catch {
      // A reserva (estimativa alta) permanece contada: erra para o lado do orçamento.
      deps.log('acerto_falhou')
    }
  }
}
