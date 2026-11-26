/** Chave `secret-openrouter`, liberação fechada por padrão e modo de avaliação. Sem rede. */
import { describe, expect, it, vi } from 'vitest'
import {
  EVAL_LIMITS, TEST_LIMITS, TEST_USER_IDS, handleCopilot, readLimits, type Deps,
} from '../../../../../supabase/functions/copilot-llm/handler.ts'
import { EVAL_MODELS, MODELS, readProviderConfig } from '../../../../../supabase/functions/copilot-llm/providers.ts'

const CHAVE = 'sk-or-v1-chave-ficticia-de-teste'
const TESTE = 'bdb8aeb9-1175-42ed-ac87-0ef5e9bc8dc4'
const COMUM = '00000000-0000-4000-8000-000000000001'
const QWEN = 'qwen/qwen3.7-flash'

const corpo = (extra: Record<string, unknown> = {}, tela = '') =>
  JSON.stringify({
    model: 'worki-copilot', role: 'company',
    messages: [{ role: 'system', content: '' }, { role: 'user', content: `<agent_state></agent_state><browser_state>${tela}</browser_state>` }],
    tools: [{ type: 'function', function: { name: 'AgentOutput' } }],
    ...extra,
  })

const resposta = (action: unknown = { wait: { seconds: 1 } }, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({
    provider: 'Ficticio',
    choices: [{ message: { tool_calls: [{ function: { name: 'AgentOutput', arguments: JSON.stringify({ action }) } }] } }],
    usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0004 },
    ...extra,
  }))

function setup(userId = TESTE, vars: Record<string, string | undefined> = {}, upstream: () => Promise<Response> = async () => resposta()) {
  const env: Record<string, string | undefined> = { 'secret-openrouter': CHAVE, ...vars }
  const logs: string[] = []
  const deps: Deps = {
    env: (n) => env[n],
    getUserId: async () => userId,
    reserve: vi.fn(async () => ({ allowed: true, day: '2026-11-25' })),
    settle: vi.fn(async () => {}),
    fetch: vi.fn(upstream),
    log: (e, d) => logs.push(JSON.stringify({ e, ...d })),
  }
  const call = async (raw?: string) => {
    const response = await handleCopilot(
      new Request('https://x/f', { method: raw === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer t' }, body: raw }),
      deps,
    )
    const text = await response.text()
    return { status: response.status, text, body: JSON.parse(text) }
  }
  const enviado = () => JSON.parse(vi.mocked(deps.fetch).mock.calls[0][1].body)
  return { deps, logs, call, enviado }
}

describe('chave secret-openrouter', () => {
  const cfg = (vars: Record<string, string>) => readProviderConfig((n) => vars[n])

  it('sozinha: openrouter com o modelo padrão', () => {
    expect(cfg({ 'secret-openrouter': CHAVE })).toEqual({ provider: 'openrouter', model: 'tencent/hy4-flash', apiKey: CHAVE })
  })

  it('COPILOT_LLM_API_KEY tem prioridade e continua exigindo provedor e modelo', () => {
    expect(cfg({ 'secret-openrouter': CHAVE, COPILOT_LLM_API_KEY: 'outra' })).toBeNull()
    expect(cfg({ 'secret-openrouter': CHAVE, COPILOT_LLM_API_KEY: 'outra', COPILOT_LLM_PROVIDER: 'openai', COPILOT_LLM_MODEL: 'gpt-4.1-mini' })?.apiKey).toBe('outra')
  })

  it('nunca vai para outro provedor', () => {
    expect(cfg({ 'secret-openrouter': CHAVE, COPILOT_LLM_PROVIDER: 'openai', COPILOT_LLM_MODEL: 'gpt-4.1-mini' })).toBeNull()
    expect(cfg({ 'secret-openrouter': CHAVE, COPILOT_LLM_PROVIDER: 'anthropic', COPILOT_LLM_MODEL: 'claude-haiku-5-5' })).toBeNull()
  })

  it.each([
    ['HTTP 401 com eco', async () => new Response(`chave ${CHAVE}`, { status: 401 })],
    ['exceção com a chave', async () => Promise.reject(new Error(`falha ${CHAVE}`))],
    ['erro dentro de 200', async () => new Response(JSON.stringify({ error: { code: 402, message: CHAVE }, provider: CHAVE }))],
    ['nome de provedor com a chave', async () => resposta(undefined, { provider: CHAVE })],
  ])('%s: não volta ao cliente nem vai para o log', async (_n, upstream) => {
    for (const extra of [{}, { eval: { model: QWEN } }]) {
      const t = setup(TESTE, {}, upstream)
      const r = await t.call(corpo(extra))
      expect(r.text + t.logs.join()).not.toContain(CHAVE)
    }
  })
})

describe('liberação aberta por padrão (decisão do dono, 26/11/2026)', () => {
  it('só os dois ids de teste formam a lista de reserva', () => {
    expect(TEST_USER_IDS).toEqual([TESTE, 'a4c775db-c05d-4e3b-b8fe-48661d371cb9'])
  })

  it.each([undefined, '', 'true', 'TRUE', '1'])('usuário comum com COPILOT_PUBLIC=%s: liberado', async (valor) => {
    expect((await setup(COMUM, { COPILOT_PUBLIC: valor }).call()).status).toBe(200)
  })

  it('COPILOT_PUBLIC=false fecha: só as contas de teste, ou a lista COPILOT_ALLOWED_USERS', async () => {
    const t = setup(COMUM, { COPILOT_PUBLIC: 'false' })
    for (const raw of [undefined, corpo(), corpo({ eval: { model: QWEN } })]) {
      const r = await t.call(raw)
      expect([r.status, r.body.error.message]).toEqual([403, 'not_released'])
    }
    expect(t.deps.reserve).not.toHaveBeenCalled()
    expect(t.deps.fetch).not.toHaveBeenCalled()
    for (const id of TEST_USER_IDS) expect((await setup(id, { COPILOT_PUBLIC: 'false' }).call()).status).toBe(200)
    expect((await setup(COMUM, { COPILOT_PUBLIC: 'false', COPILOT_ALLOWED_USERS: ` x, ${COMUM} ` }).call()).status).toBe(200)
    expect((await setup(TESTE, { COPILOT_PUBLIC: 'false', COPILOT_ALLOWED_USERS: COMUM }).call()).status).toBe(403)
  })
})

describe('usuário comum nunca escolhe modelo', () => {
  const liberados: Record<string, string>[] = [{ COPILOT_PUBLIC: 'true' }, { COPILOT_ALLOWED_USERS: COMUM }]

  it.each(liberados)('liberado por %o: eval é 403, sem cota e sem provedor', async (vars) => {
    for (const valor of [{ model: QWEN }, { model: 'anthropic/claude-haiku-5.5' }, null, {}, 'x']) {
      const t = setup(COMUM, vars)
      const r = await t.call(corpo({ eval: valor }))
      expect([r.status, r.body.error.message]).toEqual([403, 'eval_not_allowed'])
      expect(t.deps.reserve).not.toHaveBeenCalled()
      expect(t.deps.fetch).not.toHaveBeenCalled()
    }
  })

  it('model no corpo ou campos extras são recusados', async () => {
    for (const extra of [{ model: QWEN }, { provider: { zdr: false } }]) {
      expect((await setup(COMUM, { COPILOT_PUBLIC: 'true' }).call(corpo(extra))).status).toBe(400)
    }
  })
})

describe('fora de eval nada muda', () => {
  it('conta de teste: modelo do servidor, ZDR, sem usage/max_price, limites comuns, resposta sem eval', async () => {
    const t = setup()
    const r = await t.call(corpo())
    expect(r.status).toBe(200)
    expect(t.enviado().model).toBe('tencent/hy4-flash')
    expect(t.enviado().provider).toEqual({ data_collection: 'deny', zdr: true, require_parameters: true, allow_fallbacks: true })
    expect(t.enviado()).not.toHaveProperty('usage')
    expect(Object.keys(r.body).sort()).toEqual(['choices', 'usage'])
    expect(vi.mocked(t.deps.reserve).mock.calls[0][1]).toEqual({ ...readLimits(() => undefined), ...TEST_LIMITS })
  })
})

describe('modo de avaliação', () => {
  it('lista = os 8 de produção mais o qwen', () => {
    expect([...EVAL_MODELS]).toEqual([...MODELS.openrouter, QWEN])
    expect(MODELS.openrouter).toHaveLength(8)
    expect(MODELS.openrouter).not.toContain(QWEN)
  })

  it.each([...EVAL_MODELS])('%s: privacidade, preço máximo e custo', async (model) => {
    const t = setup()
    const r = await t.call(corpo({ eval: { model } }))
    expect(r.status).toBe(200)
    const sent = t.enviado()
    expect(sent.model).toBe(model)
    expect(sent.usage).toEqual({ include: true })
    expect(sent.provider).toEqual({
      data_collection: 'deny', require_parameters: true, allow_fallbacks: true, max_price: { prompt: 0.5, completion: 2 },
      ...(model === QWEN ? {} : { zdr: true }),
    })
    expect(r.body.eval).toEqual({
      model, provider: 'Ficticio', input_tokens: 100, output_tokens: 20, cost_usd: 0.0004, flags: [], latency_ms: expect.any(Number),
      answered_model: model, attempts: 1,
    })
  })

  it.each([
    [{ model: 'openai/gpt-6-luna' }, 'eval_model_not_allowed'],
    [{ model: `${QWEN}:free` }, 'eval_model_not_allowed'],
    [{ model: QWEN, zdr: false }, 'invalid_eval'],
    [null, 'invalid_eval'],
  ])('recusa %o', async (valor, motivo) => {
    const t = setup()
    const r = await t.call(corpo({ eval: valor }))
    expect([r.status, r.body.error.message]).toEqual([400, motivo])
    expect(t.deps.fetch).not.toHaveBeenCalled()
  })

  it('exige o provedor openrouter', async () => {
    const t = setup(TESTE, { COPILOT_LLM_API_KEY: 'k', COPILOT_LLM_PROVIDER: 'openai', COPILOT_LLM_MODEL: 'gpt-4.1-mini' })
    expect((await t.call(corpo({ eval: { model: QWEN } }))).status).toBe(503)
    expect(t.deps.fetch).not.toHaveBeenCalled()
  })

  it('redação continua valendo na entrada e na saída; ferramenta fora da lista é recusada com custo', async () => {
    const t = setup(TESTE, {}, async () => resposta({ done: { text: 'CPF 529.982.247-25' } }))
    const r = await t.call(corpo({ eval: { model: QWEN } }, 'email a.b@c.com'))
    expect(vi.mocked(t.deps.fetch).mock.calls[0][1].body).not.toContain('a.b@c.com')
    expect(r.text).not.toContain('529.982')
    expect(r.body.eval.flags).toEqual(['dado_pessoal'])
    const ruim = await setup(TESTE, {}, async () => resposta({ execute_javascript: { script: 'alert(1)' } })).call(corpo({ eval: { model: QWEN } }))
    expect(ruim.status).toBe(502)
    expect(ruim.text).not.toContain('alert')
    expect(ruim.body.eval).toMatchObject({ cost_usd: 0.0004, flags: ['acao_fora_da_lista'] })
  })

  it('cota: limite próprio com teto, orçamento global intacto, e recusa não chama o provedor', async () => {
    const t = setup(TESTE, { COPILOT_GLOBAL_DAILY_TOKENS: '1000000' })
    await t.call(corpo({ eval: { model: QWEN } }))
    expect(vi.mocked(t.deps.reserve).mock.calls[0][1]).toEqual({ ...EVAL_LIMITS, ...TEST_LIMITS, globalDailyTokens: 1_000_000 })
    expect(t.deps.settle).toHaveBeenCalled()
    const cheio = setup()
    cheio.deps.reserve = async () => ({ allowed: false, reason: 'user_budget' })
    expect((await cheio.call(corpo({ eval: { model: QWEN } }))).status).toBe(429)
    expect(cheio.deps.fetch).not.toHaveBeenCalled()
  })
})

describe('limites das contas de teste', () => {
  const limitesDe = async (id: string, extra: Record<string, unknown> = {}) => {
    const t = setup(id, { COPILOT_PUBLIC: 'true' })
    await t.call(corpo(extra))
    return vi.mocked(t.deps.reserve).mock.calls[0][1]
  }

  it('as duas contas de teste: 1500 por dia e 2,5M de tokens, com e sem eval; teto global igual', async () => {
    for (const id of TEST_USER_IDS) {
      for (const extra of [{}, { eval: { model: QWEN } }]) {
        expect(await limitesDe(id, extra)).toEqual({ perMinute: 30, perDay: 1500, userDailyTokens: 2_500_000, globalDailyTokens: 3_000_000 })
      }
    }
  })

  it('usuário comum não muda', async () => {
    expect(await limitesDe(COMUM)).toEqual({ perMinute: 20, perDay: 200, userDailyTokens: 600_000, globalDailyTokens: 3_000_000 })
  })
})

describe('resposta em texto solto', () => {
  const texto = (content: string, finish = 'stop') => async () =>
    new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content } }], usage: { prompt_tokens: 9, completion_tokens: 3 } }))

  it('prosa terminada vira done (só fala, sem sucesso)', async () => {
    const r = await setup(COMUM, { COPILOT_PUBLIC: 'true' }, texto('Seus turnos ficam em Meus turnos.')).call(corpo())
    expect(r.status).toBe(200)
    expect(JSON.parse(r.body.choices[0].message.tool_calls[0].function.arguments).action)
      .toEqual({ done: { text: 'Seus turnos ficam em Meus turnos.', success: false } })
  })

  it.each([
    ['JSON de ação', '{"action":{"click_element_by_index":{"index":1}}}', 'stop'],
    ['marcação de ferramenta', 'ok <tool_call>x</tool_call>', 'stop'],
    ['cortada', 'Seus turnos', 'length'],
    ['vazia', '   ', 'stop'],
  ])('%s continua erro', async (_n, content, finish) => {
    const r = await setup(COMUM, { COPILOT_PUBLIC: 'true' }, texto(content, finish)).call(corpo())
    expect(r.status).toBe(502)
  })
})

describe('texto solto: nova tentativa no proxy', () => {
  const prosa = (content: string) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 9, completion_tokens: 3 } }))

  it('a 2ª chamada leva a instrução, usa a ferramenta e as duas contam no orçamento', async () => {
    let n = 0
    const t = setup(COMUM, { COPILOT_PUBLIC: 'true' }, async () => (n++ === 0 ? prosa('Vou explicar.') : resposta()))
    const r = await t.call(corpo())
    expect(r.status).toBe(200)
    expect(t.deps.fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(vi.mocked(t.deps.fetch).mock.calls[1][1].body).messages[1].content).toContain('SOMENTE chamando a ferramenta')
    expect(JSON.parse(r.body.choices[0].message.tool_calls[0].function.arguments).action).toEqual({ wait: { seconds: 1 } })
    expect(vi.mocked(t.deps.settle).mock.calls[0].slice(3)).toEqual([109, 23])
  })

  it('só texto nas duas: uma única nova tentativa e vira done', async () => {
    const t = setup(COMUM, { COPILOT_PUBLIC: 'true' }, async () => prosa('Abra Meus turnos.'))
    const r = await t.call(corpo())
    expect(t.deps.fetch).toHaveBeenCalledTimes(2)
    expect(r.status).toBe(200)
    expect(vi.mocked(t.deps.settle).mock.calls[0].slice(3)).toEqual([18, 6])
  })
})
