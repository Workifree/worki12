/** Reserva de modelo no proxy: principal, 2ª e 3ª opção só em falha de infraestrutura do provedor. Sem rede. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleCopilot, type Deps } from '../../../../../supabase/functions/copilot-llm/handler.ts'
import { DEFAULT_FALLBACKS, modelChain } from '../../../../../supabase/functions/copilot-llm/providers.ts'

const CHAVE = 'sk-or-v1-chave-ficticia-de-teste'
const TESTE = 'bdb8aeb9-1175-42ed-ac87-0ef5e9bc8dc4'
// Ordem padrão, definida pela medição real de custo e tempo (26/11/2026). Nomes por POSIÇÃO: HAIKU = 1º (hy4-flash),
// GLM = 2º (deepseek), INKLING = 3º (inkling-2-mini); o 4º é o glm-5.3-flash.
const HAIKU = 'tencent/hy4-flash'
const GLM = 'deepseek/deepseek-v4.1-flash'
const INKLING = 'thinkingmachines/inkling-2-mini'
const QUARTO = 'z-ai/glm-5.3-flash'
const QWEN = 'qwen/qwen3.7-flash'

const corpo = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    model: 'worki-copilot', role: 'company',
    messages: [{ role: 'system', content: '' }, { role: 'user', content: '<agent_state></agent_state><browser_state></browser_state>' }],
    tools: [{ type: 'function', function: { name: 'AgentOutput' } }],
    ...extra,
  })

const ok = (prompt = 100, completion = 20) =>
  new Response(JSON.stringify({
    provider: 'Ficticio',
    choices: [{ message: { tool_calls: [{ function: { name: 'AgentOutput', arguments: JSON.stringify({ action: { wait: { seconds: 1 } } }) } }] } }],
    usage: { prompt_tokens: prompt, completion_tokens: completion },
  }))
const http = (status: number) => async () => new Response('eco do pedido', { status })
const rede = async () => Promise.reject(new Error('socket'))
const tempo = async () => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' }))
const dentroDe200 = async () =>
  new Response(JSON.stringify({ error: { code: 502, message: 'Provider returned error' }, usage: { prompt_tokens: 50, completion_tokens: 5 } }))
const soTexto = async () =>
  new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Só texto.' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }))

type Handler = () => Promise<Response>

function setup(porModelo: Record<string, Handler>, vars: Record<string, string | undefined> = {}, userId = TESTE) {
  const env: Record<string, string | undefined> = { 'secret-openrouter': CHAVE, ...vars }
  const logs: Array<Record<string, unknown>> = []
  const deps: Deps = {
    env: (n) => env[n],
    getUserId: async () => userId,
    reserve: vi.fn(async () => ({ allowed: true, day: '2026-11-25' })),
    settle: vi.fn(async () => {}),
    fetch: vi.fn(async (_url, init) => (porModelo[JSON.parse(init.body).model] ?? (async () => ok()))()),
    log: (event, data) => logs.push({ event, ...data }),
  }
  const call = async (extra: Record<string, unknown> = {}) => {
    const response = await handleCopilot(
      new Request('https://x/f', { method: 'POST', headers: { authorization: 'Bearer t' }, body: corpo(extra) }),
      deps,
    )
    return { status: response.status, body: await response.json() }
  }
  const modelos = () => vi.mocked(deps.fetch).mock.calls.map((c) => JSON.parse(c[1].body).model as string)
  const enviados = () => vi.mocked(deps.fetch).mock.calls.map((c) => JSON.parse(c[1].body))
  const trocas = () => logs.filter((l) => l.event === 'fallback')
  return { deps, call, modelos, enviados, trocas, logs }
}

afterEach(() => vi.useRealTimers())

describe('reserva de modelo', () => {
  it('padrão: hy4-flash, deepseek, inkling-2-mini, glm-5.3-flash (do mais barato ao mais caro, sem haiku)', () => {
    expect(DEFAULT_FALLBACKS).toEqual([HAIKU, GLM, INKLING, QUARTO])
    // O modelo do secret não vai na frente da ordem barata → cara.
    const cfg = { provider: 'openrouter' as const, model: 'anthropic/claude-haiku-5.5', apiKey: CHAVE }
    expect(modelChain(cfg, () => undefined).models).toEqual([HAIKU, GLM, INKLING, QUARTO])
  })

  it.each([
    ['HTTP 503', http(503)],
    ['HTTP 429 do provedor', http(429)],
    ['HTTP 500', http(500)],
    ['erro de rede', rede],
    ['timeout', tempo],
    ['"Provider returned error" dentro de um 200', dentroDe200],
  ])('falha do principal (%s): responde o 2º', async (_n, falha) => {
    const t = setup({ [HAIKU]: falha })
    const r = await t.call()
    expect(r.status).toBe(200)
    expect(t.modelos()).toEqual([HAIKU, GLM])
    expect(t.trocas()).toHaveLength(1)
    expect(t.trocas()[0]).toMatchObject({ event: 'fallback', de: HAIKU, para: GLM })
    expect(typeof t.trocas()[0].motivo).toBe('string')
  })

  it('falha dos dois primeiros: responde o 3º', async () => {
    const t = setup({ [HAIKU]: http(503), [GLM]: tempo })
    expect((await t.call()).status).toBe(200)
    expect(t.modelos()).toEqual([HAIKU, GLM, INKLING])
    expect(t.trocas().map((l) => [l.de, l.para])).toEqual([[HAIKU, GLM], [GLM, INKLING]])
    expect(t.trocas()[1].motivo).toBe('timeout')
  })

  it.each([401, 402, 403])('HTTP %i não cai em reserva: falha clara', async (status) => {
    const t = setup({ [HAIKU]: http(status) })
    const r = await t.call()
    expect([r.status, r.body.error.message]).toEqual([502, `provider_${status}`])
    expect(t.modelos()).toEqual([HAIKU])
    expect(t.trocas()).toHaveLength(0)
  })

  it('402 dentro de um 200 também não cai em reserva', async () => {
    const t = setup({ [HAIKU]: async () => new Response(JSON.stringify({ error: { code: 402 } })) })
    const r = await t.call()
    expect([r.status, r.body.error.message]).toEqual([502, 'provider_402'])
    expect(t.modelos()).toEqual([HAIKU])
  })

  it('quatro falhas: 502 all_providers_failed, no máximo 4 chamadas', async () => {
    const t = setup({ [HAIKU]: http(503), [GLM]: rede, [INKLING]: http(500), [QUARTO]: http(503) })
    const r = await t.call()
    expect([r.status, r.body]).toEqual([502, { error: { message: 'all_providers_failed' } }])
    expect(t.modelos()).toEqual([HAIKU, GLM, INKLING, QUARTO])
  })

  it('a cota conta UMA vez por pedido e o acerto traz os tokens de quem respondeu (e de quem cobrou)', async () => {
    const t = setup({ [HAIKU]: dentroDe200, [GLM]: http(503) })
    expect((await t.call()).status).toBe(200)
    expect(t.deps.reserve).toHaveBeenCalledTimes(1)
    expect(t.deps.settle).toHaveBeenCalledTimes(1)
    // INKLING respondeu 100/20; o HAIKU falhou mas cobrou 50/5.
    expect(vi.mocked(t.deps.settle).mock.calls[0].slice(3)).toEqual([150, 25])

    const falha = setup({ [HAIKU]: http(503), [GLM]: http(503), [INKLING]: http(503) })
    await falha.call()
    expect(falha.deps.reserve).toHaveBeenCalledTimes(1)
    expect(falha.deps.settle).toHaveBeenCalledTimes(1)
  })

  it('resposta inválida do modelo não troca de modelo: nova tentativa no mesmo', async () => {
    const t = setup({ [HAIKU]: soTexto })
    const r = await t.call()
    expect(r.status).toBe(200)
    expect(t.modelos()).toEqual([HAIKU, HAIKU])
    expect(t.trocas()).toHaveLength(0)
    expect(JSON.stringify(r.body)).toContain('Só texto.')
  })

  it('secret com modelo fora da allowlist de produção é ignorado, sem erro e sem registrar o nome', async () => {
    const t = setup({ [HAIKU]: http(503), [GLM]: http(503) }, {
      COPILOT_LLM_FALLBACKS: `gpt-4o, ${QWEN}, ${GLM}:free, ${HAIKU}, ${GLM}, ${GLM}, ${INKLING}`,
    })
    expect((await t.call()).status).toBe(200)
    // Duplicatas e itens inválidos saem; ordem do secret preservada.
    expect(t.modelos()).toEqual([HAIKU, GLM, INKLING])
    expect(JSON.stringify(t.logs)).not.toContain('gpt-4o')
    expect(t.logs.some((l) => l.event === 'reserva_ignorada')).toBe(true)
  })

  it('secret só com itens inválidos ou vazio: sem reserva, código do próprio provedor', async () => {
    for (const valor of ['gpt-4o,qwen/qwen3.7-flash', '']) {
      const t = setup({ [HAIKU]: http(503) }, { COPILOT_LLM_FALLBACKS: valor })
      const r = await t.call()
      expect([r.status, r.body.error.message]).toEqual([502, 'provider_503'])
      expect(t.modelos()).toEqual([HAIKU])
    }
    const lim = setup({ [HAIKU]: http(429) }, { COPILOT_LLM_FALLBACKS: '' })
    expect((await lim.call()).status).toBe(429)
  })

  it('COPILOT_LLM_MODEL no secret vira o principal; limite de 3 modelos', async () => {
    const t = setup({ [GLM]: http(503) }, { COPILOT_LLM_MODEL: GLM, COPILOT_LLM_FALLBACKS: `${HAIKU},${INKLING},${GLM}` })
    expect((await t.call()).status).toBe(200)
    expect(t.modelos()).toEqual([GLM, HAIKU])
    expect(modelChain({ provider: 'openrouter', model: GLM, apiKey: CHAVE }, (n) => (n === 'COPILOT_LLM_FALLBACKS' ? `${HAIKU},${INKLING},${GLM},${HAIKU}` : undefined)).models)
      .toEqual([GLM, HAIKU, INKLING])
  })

  it('ZDR, privacidade e tool_choice conforme o modelo valem para TODOS', async () => {
    const t = setup({ [HAIKU]: http(503), [GLM]: http(503) })
    await t.call()
    const [a, b, c] = t.enviados()
    for (const corpoEnviado of [a, b, c]) {
      expect(corpoEnviado.provider).toEqual({ data_collection: 'deny', zdr: true, require_parameters: true, allow_fallbacks: true })
      expect(Object.keys(corpoEnviado).sort()).toEqual(['max_tokens', 'messages', 'model', 'provider', 'tool_choice', 'tools'])
      expect(corpoEnviado.models).toBeUndefined()
    }
    // Os quatro modelos baratos aceitam ferramenta forçada (confirmado em /api/v1/endpoints/zdr, 26/11/2026).
    for (const corpoEnviado of [a, b, c]) {
      expect(corpoEnviado.tool_choice).toEqual({ type: 'function', function: { name: 'AgentOutput' } })
    }
  })

  it('só OpenRouter tem reservas', () => {
    expect(modelChain({ provider: 'openai', model: 'gpt-4.1-mini', apiKey: 'k' }, () => undefined).models).toEqual(['gpt-4.1-mini'])
    expect(modelChain({ provider: 'anthropic', model: 'claude-haiku-5-5', apiKey: 'k' }, () => GLM).models).toEqual(['claude-haiku-5-5'])
  })

  it('avaliação compara um modelo só: nunca cai em reserva e mostra quem respondeu', async () => {
    const falha = setup({ [QWEN]: http(503) })
    const r = await falha.call({ eval: { model: QWEN } })
    expect([r.status, r.body.error.message]).toEqual([502, 'provider_503'])
    expect(falha.modelos()).toEqual([QWEN])

    const certo = setup({})
    const ok200 = await certo.call({ eval: { model: INKLING } })
    expect(ok200.body.eval).toMatchObject({ model: INKLING, answered_model: INKLING, attempts: 1 })
    // Fora da avaliação, o campo de debug não existe.
    expect(JSON.stringify((await setup({}).call()).body)).not.toContain('answered_model')
  })
})

describe('disjuntor', () => {
  it('modelo que falhou fica 60 s fora da fila e depois volta', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const t = setup({ [HAIKU]: http(503) })
    await t.call()
    expect(t.modelos()).toEqual([HAIKU, GLM])

    vi.mocked(t.deps.fetch).mockClear()
    vi.setSystemTime(Date.now() + 30_000)
    await t.call()
    expect(t.modelos()).toEqual([GLM])

    vi.mocked(t.deps.fetch).mockClear()
    vi.setSystemTime(Date.now() + 31_000)
    await t.call()
    expect(t.modelos()).toEqual([HAIKU, GLM])
  })

  it('com todos fora da fila, tenta o principal mesmo assim', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const t = setup({ [HAIKU]: http(503), [GLM]: http(503), [INKLING]: http(503), [QUARTO]: http(503) })
    expect((await t.call()).status).toBe(502)
    vi.mocked(t.deps.fetch).mockClear()
    const r = await t.call()
    expect(t.modelos()).toEqual([HAIKU])
    expect(r.status).toBe(502)
  })

  it('401 e resposta inválida não abrem o disjuntor', async () => {
    const t = setup({ [HAIKU]: http(401) })
    await t.call()
    vi.mocked(t.deps.fetch).mockClear()
    await t.call()
    expect(t.modelos()).toEqual([HAIKU])
  })
})
