// Provedores aceitos. Host e modelo são listas fechadas: um secret errado (ou o endpoint de
// demonstração de terceiros) não é aceito, e a função responde 503.
import { TOOL_NAME } from './contract.ts'

export type ProviderName = 'openai' | 'anthropic' | 'openrouter'

export const MODELS: Record<ProviderName, readonly string[]> = {
  anthropic: ['claude-haiku-5-5', 'claude-haiku-4-5', 'claude-sonnet-5-5'],
  openai: ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini'],
  // Só modelos com endpoint ZDR e ferramentas (/api/v1/endpoints/zdr, 26/11/2026). Sem GPT e sem
  // variantes `:free`, `:batch` ou qualquer outro sufixo.
  openrouter: [
    'thinkingmachines/inkling-2-mini', 'z-ai/glm-5.3-flash', 'deepseek/deepseek-v4.1-flash',
    'inclusionai/ling-3.0-flash', 'upstage/solar-mini-4-5', 'google/gemma-4-26b-a4b-it', 'anthropic/claude-haiku-5.5',
  ],
}

export const ENDPOINTS: Record<ProviderName, string> = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
}

/**
 * Privacidade do roteamento: fixa no código, nenhum secret altera. `allow_fallbacks` (padrão da API)
 * só troca entre endpoints que passam pelos outros três filtros; sem endpoint elegível, a chamada falha.
 */
export const OPENROUTER_ROUTING = Object.freeze({
  data_collection: 'deny',
  zdr: true,
  require_parameters: true,
  allow_fallbacks: true,
})

/**
 * Modelos sem `tool_choice` forçado em todos os endpoints elegíveis (`supports_tool_choice.function`
 * em /api/v1/endpoints/zdr, 26/11/2026). Neles vai `auto`; sem chamada da ferramenta, é erro.
 */
export const OPENROUTER_AUTO_TOOL_CHOICE: readonly string[] = [
  'anthropic/claude-haiku-5.5', 'inclusionai/ling-3.0-flash',
  // Fora da produção; só o avaliador usa.
  'qwen/qwen3.7-flash',
]

export const MAX_OUTPUT_TOKENS = 2000

/** Sem endpoint ZDR: só no modo de avaliação (contas de teste, dados fictícios). Nunca em produção. */
export const EVAL_NO_ZDR_MODELS: readonly string[] = ['qwen/qwen3.7-flash']
export const EVAL_MODELS: readonly string[] = [...MODELS.openrouter, ...EVAL_NO_ZDR_MODELS]
/** Preço máximo por endpoint (US$/Mtok) no modo de avaliação: torna calculável o pior custo. */
export const EVAL_MAX_PRICE = Object.freeze({ prompt: 0.5, completion: 2 })

export interface ProviderConfig {
  provider: ProviderName
  model: string
  apiKey: string
}

export function readProviderConfig(env: (name: string) => string | undefined): ProviderConfig | null {
  if (env('COPILOT_ENABLED') === 'false') return null
  const ownKey = env('COPILOT_LLM_API_KEY')?.trim()
  const routerKey = ownKey ? undefined : env('secret-openrouter')?.trim()
  const apiKey = ownKey || routerKey
  const provider = (env('COPILOT_LLM_PROVIDER')?.trim() || (routerKey ? 'openrouter' : '')) as ProviderName | ''
  // A chave do OpenRouter nunca é enviada a outro provedor.
  if (routerKey && provider !== 'openrouter') return null
  const model = env('COPILOT_LLM_MODEL')?.trim() || (routerKey ? 'anthropic/claude-haiku-5.5' : '')
  if (!apiKey || !provider || !model) return null
  if (!Object.prototype.hasOwnProperty.call(MODELS, provider)) return null
  if (!MODELS[provider].includes(model)) return null
  return { provider, model, apiKey }
}

/** Reservas padrão do OpenRouter, na ordem: só para falha de infraestrutura do provedor. */
export const DEFAULT_FALLBACKS: readonly string[] = ['z-ai/glm-5.3-flash', 'deepseek/deepseek-v4.1-flash']
export const MAX_ATTEMPTS = 3

/**
 * Fila de modelos de um pedido: principal + reservas (`COPILOT_LLM_FALLBACKS`, separadas por vírgula).
 * Só OpenRouter tem reservas, e cada item precisa estar na allowlist de PRODUÇÃO (com ZDR): item fora
 * dela é ignorado (contado em `ignored`, sem nome), nunca vira erro. Sem duplicatas, no máximo 3.
 */
export function modelChain(
  config: ProviderConfig,
  env: (name: string) => string | undefined,
): { models: string[]; ignored: number } {
  if (config.provider !== 'openrouter') return { models: [config.model], ignored: 0 }
  const raw = env('COPILOT_LLM_FALLBACKS')
  const asked = raw === undefined ? [...DEFAULT_FALLBACKS] : raw.split(',').map((m) => m.trim()).filter(Boolean)
  const valid = asked.filter((m) => MODELS.openrouter.includes(m))
  const models = [...new Set([config.model, ...valid])].slice(0, MAX_ATTEMPTS)
  return { models, ignored: asked.length - valid.length }
}

export interface ProviderCall {
  url: string
  init: { method: 'POST'; headers: Record<string, string>; body: string }
}

export function buildProviderCall(
  config: ProviderConfig,
  system: string,
  user: string,
  schema: Record<string, unknown>,
): ProviderCall {
  const description = 'Chame uma vez por passo, com uma única ação.'
  if (config.provider === 'anthropic') {
    // Haiku aceita ferramenta forçada (e então não gasta com raciocínio); Sonnet 5.5 recusa com 400.
    const toolChoice = config.model.startsWith('claude-haiku')
      ? { type: 'tool', name: TOOL_NAME, disable_parallel_tool_use: true }
      : { type: 'auto', disable_parallel_tool_use: true }
    return {
      url: ENDPOINTS.anthropic,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2026-10-21',
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system,
          messages: [{ role: 'user', content: user }],
          tools: [{ name: TOOL_NAME, description, input_schema: schema }],
          tool_choice: toolChoice,
        }),
      },
    }
  }
  if (config.provider === 'openrouter') {
    // Com `require_parameters`, cada parâmetro extra elimina endpoints: não vão `parallel_tool_calls`,
    // `temperature` nem `store`. Sem HTTP-Referer, X-Title ou `user`: nada identifica pessoa ou app.
    return {
      url: ENDPOINTS.openrouter,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          tools: [{ type: 'function', function: { name: TOOL_NAME, description, parameters: schema } }],
          tool_choice: OPENROUTER_AUTO_TOOL_CHOICE.includes(config.model)
            ? 'auto'
            : { type: 'function', function: { name: TOOL_NAME } },
          max_tokens: MAX_OUTPUT_TOKENS,
          provider: OPENROUTER_ROUTING,
        }),
      },
    }
  }
  return {
    url: ENDPOINTS.openai,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        tools: [{ type: 'function', function: { name: TOOL_NAME, description, parameters: schema } }],
        tool_choice: { type: 'function', function: { name: TOOL_NAME } },
        parallel_tool_calls: false,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        store: false,
      }),
    },
  }
}

/** Chamada do modo de avaliação. Quem chama já conferiu a conta e `config.model` em EVAL_MODELS. */
export function buildEvalCall(
  config: ProviderConfig,
  system: string,
  user: string,
  schema: Record<string, unknown>,
): ProviderCall {
  const call = buildProviderCall(config, system, user, schema)
  const body = JSON.parse(call.init.body)
  const { zdr, ...semZdr } = OPENROUTER_ROUTING
  body.provider = {
    ...semZdr,
    ...(EVAL_NO_ZDR_MODELS.includes(config.model) ? {} : { zdr }),
    max_price: EVAL_MAX_PRICE,
  }
  body.usage = { include: true }
  return { url: call.url, init: { ...call.init, body: JSON.stringify(body) } }
}

export interface ProviderResult {
  /** Argumentos da ferramenta, ainda não validados. `null` = o modelo não chamou a ferramenta. */
  args: unknown
  /** Resposta sem nenhuma chamada de ferramenta (texto solto, recusa), possível com `auto`. */
  noAction?: boolean
  /** Resposta completa em texto, sem ferramenta. Nunca é interpretada como ação. */
  text?: string
  inputTokens: number
  outputTokens: number
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

export function parseProviderResponse(provider: ProviderName, payload: unknown): ProviderResult {
  // deno-lint-ignore no-explicit-any
  const data = payload as any
  if (provider === 'anthropic') {
    const block = Array.isArray(data?.content)
      ? data.content.find((c: { type?: string; name?: string }) => c.type === 'tool_use' && c.name === TOOL_NAME)
      : null
    return {
      args: data?.stop_reason === 'refusal' ? null : (block?.input ?? null),
      noAction: !block || data?.stop_reason === 'refusal',
      inputTokens: num(data?.usage?.input_tokens) + num(data?.usage?.cache_read_input_tokens),
      outputTokens: num(data?.usage?.output_tokens),
    }
  }
  const choice = data?.choices?.[0]
  const calls = choice?.message?.tool_calls
  const usage = { inputTokens: num(data?.usage?.prompt_tokens), outputTokens: num(data?.usage?.completion_tokens) }
  // Texto da resposta nunca vira ação: só a chamada da ferramenta conta.
  if (!Array.isArray(calls) || calls.length === 0) {
    const content = choice?.message?.content
    // Só resposta terminada e em prosa: JSON, marcação de ferramenta, recusa ou corte continuam sendo erro.
    const prose =
      choice?.finish_reason === 'stop' && !choice.error && !choice.message?.refusal && typeof content === 'string' &&
      content.trim() && !/^\s*[{\[<`]|AgentOutput|<\/?(?:tool|function|invoke)/i.test(content)
    return { args: null, noAction: true, ...(prose ? { text: content.trim() } : {}), ...usage }
  }
  // OpenRouter: sem `parallel_tool_calls`, várias chamadas são possíveis; não se escolhe uma. Resposta
  // cortada, filtrada ou com erro também não é executada.
  if (provider === 'openrouter' && (calls.length > 1 || choice.error || ['length', 'content_filter', 'error'].includes(choice.finish_reason))) {
    return { args: null, ...usage }
  }
  const call = calls[0]
  let args: unknown = null
  if (call?.function?.name === TOOL_NAME && typeof call.function.arguments === 'string') {
    try {
      args = JSON.parse(call.function.arguments)
    } catch {
      args = null
    }
  }
  return { args, ...usage }
}
