// Lógica da função, sem Deno nem rede direta: tudo entra por `Deps`, para ser testável.
// Regra de log: NUNCA conteúdo (pedido, tela, resposta, token). Só eventos e números.
import { ACTIONS, CLIENT_MODEL, DESTINATIONS, SYSTEM_PROMPT, TOOL_NAME, agentOutputSchema, type Role } from './contract.ts'
import {
  EVAL_MODELS, MAX_ATTEMPTS, MAX_OUTPUT_TOKENS, buildEvalCall, buildProviderCall, modelChain, parseProviderResponse,
  readProviderConfig, type ProviderResult,
} from './providers.ts'
import { containsPII, normalizeText, redactPII } from './redact.ts'

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

// Reserva de modelo: tempos e disjuntor. O disjuntor vive por instância de `Deps` (em produção, um só).
const ATTEMPT_TIMEOUT_MS = 20_000
const TOTAL_BUDGET_MS = 55_000
const MIN_ATTEMPT_MS = 3_000
const BREAKER_MS = 60_000
/** Configuração (401/403) e saldo (402): falha clara, sem tentar outro modelo. */
const FATAL_CODES: readonly number[] = [401, 402, 403]
const INFRA_STATUS = (status: number) => status === 404 || status === 408 || status === 429 || status >= 500
const breakers = new WeakMap<Deps, Map<string, number>>()

/** Forma mínima do corpo do provedor que o proxy lê (o resto é ignorado). */
interface ProviderPayload {
  error?: { code?: unknown }
  provider?: unknown
  usage?: { cost?: unknown }
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

/** Contas de teste: únicas liberadas por padrão e únicas que usam o modo de avaliação. */
export const TEST_USER_IDS: readonly string[] = [
  'bdb8aeb9-1175-42ed-ac87-0ef5e9bc8dc4',
  'a4c775db-c05d-4e3b-b8fe-48661d371cb9',
]

/** Aberto a todos por padrão (decisão do dono, 26/11/2026). `COPILOT_PUBLIC=false` fecha e volta à lista de teste (`COPILOT_ALLOWED_USERS`). */
export function isReleased(userId: string, env: Deps['env']): boolean {
  if (env('COPILOT_PUBLIC') !== 'false') return true
  const listed = (env('COPILOT_ALLOWED_USERS') ?? '').split(',').map((id) => id.trim()).filter(Boolean)
  return (listed.length ? listed : TEST_USER_IDS).includes(userId)
}

/** Limite próprio das chamadas de avaliação das contas de teste. O orçamento global não muda. */
export const EVAL_LIMITS = Object.freeze({ perMinute: 20, perDay: 400, userDailyTokens: 1_500_000 })

/**
 * Só as duas contas de teste (rodadas de comparação). Usuário comum e teto global não mudam.
 * Vale com e sem `eval`; um secret maior continua valendo.
 */
export const TEST_LIMITS = Object.freeze({ perMinute: 30, perDay: 1500, userDailyTokens: 2_500_000 })

export function limitsFor(userId: string, evaluating: boolean, env: Deps['env']): Limits {
  const base = readLimits(env)
  if (!TEST_USER_IDS.includes(userId)) return base
  const floor = evaluating ? EVAL_LIMITS : base
  return {
    ...base,
    perMinute: Math.max(floor.perMinute, TEST_LIMITS.perMinute),
    perDay: Math.max(floor.perDay, TEST_LIMITS.perDay),
    userDailyTokens: Math.max(floor.userDailyTokens, TEST_LIMITS.userDailyTokens),
  }
}

export interface ValidRequest {
  role: Role
  user: string
  /** Campo `eval` cru: só o handler, que conhece o usuário, decide se vale. */
  eval?: unknown
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
  const allowedKeys = new Set(['model', 'role', 'messages', 'tools', 'eval'])
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
  // NFKC pode multiplicar o tamanho (um caractere vira 18): o teto vale antes e depois.
  if (content.length > MAX_USER_CHARS || normalizeText(content).length > MAX_USER_CHARS) return 'too_large'
  // Terceira redação (a do cliente não é confiável) e trava final.
  const user = redactPII(content)
  if (containsPII(user)) return 'pii_detected'
  return { role, user, ...(Object.prototype.hasOwnProperty.call(body, 'eval') ? { eval: body.eval } : {}) }
}

export interface CleanOutput {
  evaluation_previous_goal?: string
  memory?: string
  next_goal?: string
  action: Record<string, Record<string, unknown>>
}

/** Só no modo de avaliação: sinaliza o que o validador barra ou redige, sem devolver a saída crua. */
function rawOutputFlags(args: unknown): string[] {
  let action = (args as { action?: unknown } | null)?.action
  if (typeof action === 'string') {
    try {
      action = JSON.parse(action)
    } catch {
      return []
    }
  }
  if (!action || typeof action !== 'object') return []
  const flags = new Set<string>()
  for (const [name, values] of Object.entries(action)) {
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, name)) flags.add('acao_fora_da_lista')
    else if (values && typeof values === 'object') {
      if (Object.values(values).some((v) => typeof v === 'string' && containsPII(v))) flags.add('dado_pessoal')
    }
  }
  return [...flags]
}

/**
 * Em campo de TEXTO, aceita número ou booleano (o modelo manda `text: 1` para "1 vaga"): vira string.
 * Para campo numérico/booleano NÃO há conversão: texto no lugar de número continua recusado.
 */
function coerce(value: unknown, type: 'string' | 'boolean' | 'number' | 'integer'): unknown {
  if (type === 'string' && ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean')) return String(value)
  return value
}

/**
 * Resposta do modelo: reconstruída campo a campo. Qualquer coisa fora da lista -> `output: null`, com
 * `why` dizendo QUAL regra falhou (só nome de ação/campo, nunca o conteúdo) para o log do proxy.
 */
export function validateModelOutputWhy(args: unknown, role: Role): { output: CleanOutput | null; why?: string } {
  const bad = (why: string) => ({ output: null, why })
  if (!args || typeof args !== 'object') return bad('args')
  const input = args as Record<string, unknown>
  let action = input.action
  if (typeof action === 'string') {
    try {
      action = JSON.parse(action)
    } catch {
      return bad('action_json')
    }
  }
  if (!action || typeof action !== 'object') return bad('action_ausente')
  const names = Object.keys(action)
  if (names.length !== 1) return bad(`acoes_${names.length}`)
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, names[0])) return bad(`acao_fora:${names[0].slice(0, 30)}`)
  const name = names[0]
  const values = (action as Record<string, unknown>)[name]
  if (!values || typeof values !== 'object') return bad(`${name}:sem_campos`)
  const spec = ACTIONS[name].fields
  const extra = Object.keys(values).find((key) => !Object.prototype.hasOwnProperty.call(spec, key))
  if (extra !== undefined) return bad(`${name}:campo_extra:${extra.slice(0, 30)}`)
  const clean: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(spec)) {
    const value = coerce((values as Record<string, unknown>)[key], field.type)
    if (value === undefined || value === null) {
      if (field.required) return bad(`${name}:falta:${key}`)
      continue
    }
    if (field.type === 'string') {
      if (typeof value !== 'string') return bad(`${name}:${key}:tipo`)
      clean[key] = redactPII(value).slice(0, field.maxLength)
    } else if (field.type === 'boolean') {
      if (typeof value !== 'boolean') return bad(`${name}:${key}:tipo`)
      clean[key] = value
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value)) return bad(`${name}:${key}:tipo`)
      if (field.type === 'integer' && !Number.isInteger(value)) return bad(`${name}:${key}:inteiro`)
      if (value < (field.min ?? -Infinity) || value > (field.max ?? Infinity)) return bad(`${name}:${key}:faixa`)
      clean[key] = value
    }
  }
  if (name === 'navigate' && !(DESTINATIONS[role] as readonly string[]).includes(clean.destination as string)) return bad('navigate:destino')
  const output: CleanOutput = { action: { [name]: clean } }
  for (const key of ['evaluation_previous_goal', 'memory', 'next_goal'] as const) {
    if (typeof input[key] === 'string') output[key] = redactPII(input[key] as string).slice(0, 400)
  }
  return { output }
}

export function validateModelOutput(args: unknown, role: Role): CleanOutput | null {
  return validateModelOutputWhy(args, role).output
}

/** Vai junto do pedido na 2ª tentativa, quando o modelo respondeu em texto solto. */
export const TOOL_REMINDER = `

<instructions>
Sua resposta anterior veio em texto solto e foi descartada. Responda SOMENTE chamando a ferramenta ${TOOL_NAME}, com UMA ação. Para falar com a pessoa, use done.
</instructions>`

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
  if (!isReleased(userId, deps.env)) return refuse(403, 'not_released')

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

  let evalModel: string | null = null
  if ('eval' in valid) {
    if (!TEST_USER_IDS.includes(userId)) return refuse(403, 'eval_not_allowed')
    const asked = valid.eval as Record<string, unknown> | null
    if (!asked || typeof asked !== 'object' || Object.keys(asked).join() !== 'model') return refuse(400, 'invalid_eval')
    if (typeof asked.model !== 'string' || !EVAL_MODELS.includes(asked.model)) return refuse(400, 'eval_model_not_allowed')
    if (config.provider !== 'openrouter') return refuse(503, 'eval_unavailable')
    evalModel = asked.model
  }

  const estimate = Math.ceil((SYSTEM_PROMPT.length + valid.user.length + 4000) / 3) + MAX_OUTPUT_TOKENS
  let reservation: Reservation
  try {
    reservation = await deps.reserve(userId, limitsFor(userId, !!evalModel, deps.env), estimate)
  } catch {
    // Sem controle de custo (migration não aplicada, banco fora) não há chamada ao provedor.
    return refuse(503, 'quota_unavailable')
  }
  if (!reservation.allowed || !reservation.day) return refuse(429, reservation.reason ?? 'quota_exceeded')

  const schema = agentOutputSchema(valid.role)
  const callFor = (user: string, model: string) =>
    evalModel
      ? buildEvalCall({ ...config, model }, SYSTEM_PROMPT, user, schema)
      : buildProviderCall({ ...config, model }, SYSTEM_PROMPT, user, schema)
  // Fila do pedido: principal + reservas (só OpenRouter, só allowlist de produção). A avaliação
  // compara UM modelo, então nunca cai em reserva. Modelo que falhou fica fora da fila por um tempo.
  const chain = evalModel ? { models: [evalModel], ignored: 0 } : modelChain(config, deps.env)
  if (chain.ignored) deps.log('reserva_ignorada', { itens: chain.ignored })
  const breaker = breakers.get(deps) ?? new Map<string, number>()
  breakers.set(deps, breaker)
  const open = chain.models.filter((m) => (breaker.get(m) ?? 0) <= Date.now())
  const queue = open.length ? open : [chain.models[0]]
  // Metadados da avaliação (nunca conteúdo). Fora dela fica `null` e nenhuma resposta muda.
  const report: Record<string, unknown> | null = evalModel ? { model: evalModel } : null
  let started = 0
  const fail = (status: number, code: string) => {
    if (!report) return refuse(status, code)
    report.latency_ms ??= Date.now() - started
    deps.log('recusado', { status, code })
    return reply(status, { error: { message: code }, eval: report })
  }
  let inputTokens = estimate - MAX_OUTPUT_TOKENS
  let outputTokens = MAX_OUTPUT_TOKENS
  try {
    started = Date.now()
    let payload: ProviderPayload = {}
    let result: ProviderResult | null = null
    let model = queue[0]
    let attempts = 0
    let fatal = 0
    // Tokens de tentativas que falharam mas cobraram: somam no acerto da cota (que é UMA por pedido).
    let spentIn = 0
    let spentOut = 0
    let last = { status: 502, code: 'provider_unreachable' }
    for (const candidate of queue) {
      const remaining = TOTAL_BUDGET_MS - (Date.now() - started)
      if (attempts >= MAX_ATTEMPTS || (attempts > 0 && remaining < MIN_ATTEMPT_MS)) break
      attempts++
      model = candidate
      const call = callFor(valid.user, model)
      let motive: string
      try {
        const response = await deps.fetch(call.url, {
          ...call.init,
          signal: AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, remaining)),
        })
        if (!response.ok) {
          // O corpo do erro do provedor pode ecoar o pedido: não é lido nem registrado.
          // Só falha de infraestrutura troca de modelo; configuração, saldo e pedido ruim falham claro.
          if (!INFRA_STATUS(response.status)) return fail(502, `provider_${response.status}`)
          motive = `http_${response.status}`
          last = { status: response.status === 429 ? 429 : 502, code: `provider_${response.status}` }
        } else {
          payload = await response.json()
          const parsed = parseProviderResponse(config.provider, payload)
          const code = Number(payload?.error?.code)
          if (FATAL_CODES.includes(code)) {
            fatal = code
            result = parsed
            break
          }
          // Só o erro do provedor (nível do corpo) é infraestrutura; resposta ruim do modelo não troca de modelo.
          if (payload?.error) {
            motive = 'provider_error'
            last = { status: 502, code: 'provider_error' }
            spentIn += parsed.inputTokens
            spentOut += parsed.outputTokens
          } else {
            result = parsed
            break
          }
        }
      } catch (error) {
        const name = (error as { name?: string } | null)?.name
        motive = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'rede'
        last = { status: 502, code: 'provider_unreachable' }
      }
      breaker.set(model, Date.now() + BREAKER_MS)
      const next = queue[attempts]
      if (next && attempts < MAX_ATTEMPTS) deps.log('fallback', { de: model, para: next, motivo: motive })
    }
    if (!result) {
      // Sem reservas configuradas, o código é o do próprio provedor.
      return chain.models.length > 1 ? fail(502, 'all_providers_failed') : fail(last.status, last.code)
    }
    if (report) Object.assign(report, { answered_model: model, attempts })
    let cost: unknown = payload?.usage?.cost
    // Texto solto (comum com `tool_choice: auto`): UMA nova tentativa, no mesmo modelo. Nenhuma ação foi executada.
    const left = TOTAL_BUDGET_MS - (Date.now() - started)
    if (result.noAction && !fatal && left >= MIN_ATTEMPT_MS) {
      const first = result
      try {
        const again = callFor(valid.user + TOOL_REMINDER, model)
        const second = await deps.fetch(again.url, { ...again.init, signal: AbortSignal.timeout(Math.min(30_000, left)) })
        if (second.ok) {
          payload = await second.json()
          const retried = parseProviderResponse(config.provider, payload)
          const other: unknown = payload?.usage?.cost
          if (typeof cost === 'number' && typeof other === 'number') cost += other
          // As duas chamadas contam no orçamento.
          result = {
            ...retried,
            text: retried.noAction ? (retried.text ?? first.text) : undefined,
            inputTokens: first.inputTokens + retried.inputTokens,
            outputTokens: first.outputTokens + retried.outputTokens,
          }
          deps.log('nova_tentativa')
        }
      } catch {
        // A primeira resposta continua valendo.
      }
    }
    if (report) {
      const served = payload?.provider
      Object.assign(report, {
        latency_ms: Date.now() - started,
        // Só nome curto de provedor passa: nenhum texto livre do provedor volta.
        provider:
          typeof served === 'string' && /^[\w .()/-]{1,60}$/.test(served) && !served.includes(config.apiKey) ? served : null,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost_usd: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null,
        flags: rawOutputFlags(result.args),
      })
    }
    // O OpenRouter pode devolver "sem crédito" ou chave inválida dentro de um 200: falha clara.
    if (fatal) return fail(502, `provider_${fatal}`)
    // Contagem ausente mantém a estimativa daquele lado: o orçamento nunca recebe zero por omissão.
    if (result.inputTokens) inputTokens = result.inputTokens
    if (result.outputTokens) outputTokens = result.outputTokens
    inputTokens += spentIn
    outputTokens += spentOut
    // Texto solto (comum com `tool_choice: auto`) vira só uma FALA para a pessoa: `done` não toca na tela.
    const checked = validateModelOutputWhy(
      result.text ? { action: { done: { text: result.text.slice(0, 1500), success: false } } } : result.args,
      valid.role,
    )
    const output = checked.output
    if (!output) {
      // Só o NOME da regra que falhou (ação/campo), nunca o conteúdo: serve para diagnosticar sem vazar dado.
      if (!result.noAction) deps.log('output_invalido', { why: checked.why ?? 'desconhecido' })
      return fail(502, result.noAction ? 'model_no_action' : 'invalid_model_output')
    }
    deps.log('ok', { inputTokens, outputTokens })
    return reply(200, {
      ...(report ? { eval: report } : {}),
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
    return fail(502, 'provider_unreachable')
  } finally {
    try {
      await deps.settle(userId, reservation.day, estimate, inputTokens, outputTokens)
    } catch {
      // A reserva (estimativa alta) permanece contada: erra para o lado do orçamento.
      deps.log('acerto_falhou')
    }
  }
}
