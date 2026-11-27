/** Provedor `openrouter` da edge function `copilot-llm` e custo da redação. Sem rede. */
import { describe, expect, it, vi } from 'vitest'
import { handleCopilot, validateRequestBody, type Deps } from '../../../../../supabase/functions/copilot-llm/handler.ts'
import { buildProviderCall, parseProviderResponse, readProviderConfig } from '../../../../../supabase/functions/copilot-llm/providers.ts'
import { agentOutputSchema } from '../../../../../supabase/functions/copilot-llm/contract.ts'
import { containsPII, redactPII } from '../../../../../supabase/functions/copilot-llm/redact.ts'

const MODELOS = [
  'thinkingmachines/inkling-2-mini', 'z-ai/glm-5.3-flash', 'deepseek/deepseek-v4.1-flash',
  'inclusionai/ling-3.0-flash', 'upstage/solar-mini-4-5', 'google/gemma-4-26b-a4b-it', 'anthropic/claude-haiku-5.5',
]
const AUTO = ['anthropic/claude-haiku-5.5', 'inclusionai/ling-3.0-flash']

const env = (model: string, extra: Record<string, string> = {}) => (name: string) =>
  ({ COPILOT_LLM_PROVIDER: 'openrouter', COPILOT_LLM_MODEL: model, COPILOT_LLM_API_KEY: 'chave-teste', COPILOT_PUBLIC: 'true', ...extra })[name]

const toolCall = (args: string) => ({ function: { name: 'AgentOutput', arguments: args } })
const OK = JSON.stringify({ action: { wait: { seconds: 1 } } })
const payload = (choice: unknown, usage: unknown = { prompt_tokens: 100, completion_tokens: 20 }) => ({ choices: [choice], usage })
const corpo = (user: string) =>
  JSON.stringify({
    model: 'worki-copilot', role: 'company',
    messages: [{ role: 'system', content: '' }, { role: 'user', content: `<agent_state></agent_state><browser_state>${user}</browser_state>` }],
    tools: [{ type: 'function', function: { name: 'AgentOutput' } }],
  })

async function run(data: unknown) {
  const deps: Deps = {
    env: env('anthropic/claude-haiku-5.5'),
    getUserId: async () => 'usuario-ficticio',
    reserve: async () => ({ allowed: true, day: '2026-11-25' }),
    settle: vi.fn(async () => {}),
    fetch: async () => new Response(JSON.stringify(data)),
    log: () => {},
  }
  const request = new Request('https://x/f', { method: 'POST', headers: { authorization: 'Bearer t' }, body: corpo('') })
  const response = await handleCopilot(request, deps)
  return { status: response.status, body: await response.json(), settle: vi.mocked(deps.settle) }
}

describe('openrouter: pedido', () => {
  it.each(MODELOS)('%s: endpoint fixo, privacidade fixa e só o nome público do app', (model) => {
    const config = readProviderConfig(env(model, {
      COPILOT_LLM_ENDPOINT: 'https://evil.example', COPILOT_OPENROUTER_ZDR: 'false', COPILOT_OPENROUTER_DATA_COLLECTION: 'allow',
    }))!
    const call = buildProviderCall(config, 's', 'u', agentOutputSchema('company'))
    expect(call.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    // Só o nome público do app (atribuição no OpenRouter): nada da pessoa, do turno ou da empresa vai nos cabeçalhos.
    expect(Object.keys(call.init.headers).sort()).toEqual(['authorization', 'content-type', 'http-referer', 'x-title'])
    expect(call.init.headers['x-title']).toBe('Worki Copiloto')
    const sent = JSON.parse(call.init.body)
    expect(sent.provider).toEqual({ data_collection: 'deny', zdr: true, require_parameters: true, allow_fallbacks: true })
    expect(Object.keys(sent).sort()).toEqual(['max_tokens', 'messages', 'model', 'provider', 'tool_choice', 'tools'])
    expect(sent.max_tokens).toBe(2000)
    expect(sent.tool_choice).toEqual(AUTO.includes(model) ? 'auto' : { type: 'function', function: { name: 'AgentOutput' } })
  })

  it.each([
    'openai/gpt-6-luna', 'openai/gpt-oss-20b', 'qwen/qwen3.7-flash', 'google/gemini-2.5-flash-lite',
    'z-ai/glm-5.3-flash:batch', 'google/gemma-4-26b-a4b-it:free', 'openrouter/auto',
  ])('recusa o modelo %s', (model) => {
    expect(readProviderConfig(env(model))).toBeNull()
  })
})

describe('openrouter: resposta', () => {
  it('ação válida passa e os tokens vão para o orçamento', async () => {
    const r = await run(payload({ finish_reason: 'tool_calls', message: { tool_calls: [toolCall(OK)] } }))
    expect(r.status).toBe(200)
    expect(r.settle.mock.calls[0].slice(3)).toEqual([100, 20])
  })

  it.each([
    ['texto com JSON de ação', { finish_reason: 'stop', message: { content: OK } }],
    ['lista vazia', { message: { tool_calls: [] } }],
    ['sem choices', undefined],
  ])('%s: model_no_action, sem inventar ação', async (_n, choice) => {
    const r = await run(payload(choice))
    expect(r.status).toBe(502)
    expect(r.body).toEqual({ error: { message: 'model_no_action' } })
  })

  it.each([
    ['JSON quebrado', { message: { tool_calls: [toolCall('{"action":{"wait":')] } }],
    ['argumentos que não são texto', { message: { tool_calls: [{ function: { name: 'AgentOutput', arguments: { action: {} } } }] } }],
    ['null', { message: { tool_calls: [toolCall('null')] } }],
    ['vetor', { message: { tool_calls: [toolCall('[1]')] } }],
    ['ferramenta de outro nome', { message: { tool_calls: [{ function: { name: 'run_sql', arguments: OK } }] } }],
    ['chamada vazia', { message: { tool_calls: [null] } }],
    ['duas chamadas', { message: { tool_calls: [toolCall(OK), toolCall(OK)] } }],
    ['resposta cortada', { finish_reason: 'length', message: { tool_calls: [toolCall(OK)] } }],
    ['erro na escolha', { error: { code: 502 }, message: { tool_calls: [toolCall(OK)] } }],
  ])('%s: invalid_model_output', async (_n, choice) => {
    const r = await run(payload(choice))
    expect(r.status).toBe(502)
    expect(r.body).toEqual({ error: { message: 'invalid_model_output' } })
  })

  it('contagem ausente ou parcial mantém a estimativa, nunca zero', async () => {
    const choice = { message: { tool_calls: [toolCall(OK)] } }
    for (const usage of [null, { prompt_tokens: 50 }]) {
      const [, , estimate, input, output] = (await run(payload(choice, usage))).settle.mock.calls[0]
      expect(input).toBe(usage ? 50 : estimate - 2000)
      expect(output).toBe(2000)
    }
    expect(parseProviderResponse('openrouter', null)).toMatchObject({ args: null, noAction: true, inputTokens: 0 })
  })
})

describe('redação: custo linear e cobertura', () => {
  const unidades = [
    'a', '1', 'a.', '1 ', '1-', 'a-', 'a@', '@a.', 'a_', 'a%40', '.', '-', '+', 'é', 'a1', '000201', 'c', 'nasc', 'anivers',
    'eyJ', 'sk-a', 'senha:', ' ', '\n', '( ', 'codigo ', 'a arroba a ponto ', '1 de ', '/convite/', '?token=', '1/_(',
  ]

  it('40 mil caracteres adversariais em menos de 1 s (as duas passadas do proxy)', () => {
    for (const unidade of unidades) {
      const corrido = unidade.repeat(40_000).slice(0, 40_000)
      // Blocos logo abaixo do teto de trecho: o pior caso que as regras ainda varrem.
      const emBlocos = corrido.match(/[^]{1,200}/g)!.join(' ').slice(0, 40_000)
      for (const texto of [corrido, emBlocos]) {
        const inicio = performance.now()
        containsPII(redactPII(texto))
        expect(performance.now() - inicio, JSON.stringify(unidade)).toBeLessThan(1000)
      }
    }
  }, 60_000)

  it('trecho gigante e espaços longos não deixam dado passar', () => {
    const longo = `${'a'.repeat(300)}.pessoa@exemplo.com${'z'.repeat(300)}`
    expect(redactPII(longo)).toBe('[oculto]')
    expect(redactPII(`pessoa arroba${' '.repeat(5000)}exemplo ponto com`)).toContain('[email]')
    expect(redactPII(`cpf 529.982.247-25 ${'x'.repeat(500)} fim`)).toBe('cpf [cpf] [oculto] fim')
    const uma = redactPII(`${longo}${' '.repeat(100)}fim`)
    expect(containsPII(uma)).toBe(false)
  })

  it('texto que a normalização expande além do teto é recusado antes da redação', () => {
    expect(validateRequestBody(corpo('ﷺ'.repeat(5000)))).toBe('too_large')
  })
})
