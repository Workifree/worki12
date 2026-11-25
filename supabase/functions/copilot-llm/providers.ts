// Provedores aceitos. Host e modelo são listas fechadas: um secret errado (ou o endpoint de
// demonstração de terceiros) não é aceito, e a função responde 503.
import { TOOL_NAME } from './contract.ts'

export type ProviderName = 'openai' | 'anthropic'

export const MODELS: Record<ProviderName, readonly string[]> = {
  anthropic: ['claude-haiku-5-5', 'claude-haiku-4-5', 'claude-sonnet-5-5'],
  openai: ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini'],
}

export const ENDPOINTS: Record<ProviderName, string> = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
}

export const MAX_OUTPUT_TOKENS = 2000

export interface ProviderConfig {
  provider: ProviderName
  model: string
  apiKey: string
}

export function readProviderConfig(env: (name: string) => string | undefined): ProviderConfig | null {
  if (env('COPILOT_ENABLED') === 'false') return null
  const apiKey = env('COPILOT_LLM_API_KEY')?.trim()
  const provider = env('COPILOT_LLM_PROVIDER')?.trim() as ProviderName | undefined
  const model = env('COPILOT_LLM_MODEL')?.trim()
  if (!apiKey || !provider || !model) return null
  if (!Object.prototype.hasOwnProperty.call(MODELS, provider)) return null
  if (!MODELS[provider].includes(model)) return null
  return { provider, model, apiKey }
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

export interface ProviderResult {
  /** Argumentos da ferramenta, ainda não validados. `null` = o modelo não chamou a ferramenta. */
  args: unknown
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
      inputTokens: num(data?.usage?.input_tokens) + num(data?.usage?.cache_read_input_tokens),
      outputTokens: num(data?.usage?.output_tokens),
    }
  }
  const call = data?.choices?.[0]?.message?.tool_calls?.[0]
  let args: unknown = null
  if (call?.function?.name === TOOL_NAME && typeof call.function.arguments === 'string') {
    try {
      args = JSON.parse(call.function.arguments)
    } catch {
      args = null
    }
  }
  return { args, inputTokens: num(data?.usage?.prompt_tokens), outputTokens: num(data?.usage?.completion_tokens) }
}
