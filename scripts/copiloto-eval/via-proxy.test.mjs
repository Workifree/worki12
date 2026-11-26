// node --test scripts/copiloto-eval/*.test.mjs
// O avaliador fala com o `handleCopilot` REAL; só o OpenRouter, o login e o relógio são simulados.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { EVAL_LIMITS, TEST_USER_IDS, handleCopilot } from '../../supabase/functions/copilot-llm/handler.ts'
import { EVAL_MAX_PRICE, EVAL_MODELS } from '../../supabase/functions/copilot-llm/providers.ts'
import { MODELOS, PRECO_MAXIMO, avaliar, fetchSimulado } from './avaliador.mjs'
import { TAREFAS } from './tarefas.mjs'
import { INTERVALO_MS, conferirFuncao, entrar, fetchViaProxy, lerEnv } from './via-proxy.mjs'

const sessao = { endpoint: 'https://x.supabase.co/functions/v1/copilot-llm', headers: { authorization: 'Bearer token-secreto', apikey: 'anon' } }
const model = 'upstage/solar-mini-4-5'

/** Proxy real com cota em memória que imita `copilot_reserve` (janela de 1 min e teto de tokens). */
function ambiente({ upstream = fetchSimulado(TAREFAS), userId = TEST_USER_IDS[0], reserve, custoTokens } = {}) {
  let relogio = 0
  const janela = []
  const uso = { chamadas: 0, tokens: 0, pico: 0 }
  const deps = {
    env: (n) => ({ 'secret-openrouter': 'chave-ficticia' })[n],
    getUserId: async () => userId,
    reserve: reserve ?? (async (_u, limites, estimativa) => {
      while (janela.length && janela[0] <= relogio - 60_000) janela.shift()
      if (janela.length >= limites.perMinute) return { allowed: false, reason: 'rate_minute' }
      if (uso.chamadas >= limites.perDay) return { allowed: false, reason: 'rate_day' }
      uso.pico = Math.max(uso.pico, uso.tokens + estimativa)
      if (uso.tokens + estimativa > limites.userDailyTokens) return { allowed: false, reason: 'user_budget' }
      janela.push(relogio)
      uso.chamadas++
      return { allowed: true, day: 'd' }
    }),
    settle: async (_u, _d, _e, entrada, saida) => { uso.tokens += custoTokens ?? entrada + saida },
    fetch: upstream,
    log: () => {},
  }
  const transporte = fetchViaProxy(sessao, {
    fetch: async (url, init) => handleCopilot(new Request(url, init), deps),
    agora: () => relogio,
    esperar: async (ms) => { relogio += ms },
  })
  return { transporte, uso }
}
const rodar = (a, opcoes = {}) =>
  avaliar(TAREFAS, { modelos: MODELOS, semZdr: true, apiKey: 'via-proxy', fetch: a.transporte, ...opcoes })

test('fase 1 completa: 96 chamadas dentro dos limites, mesmo a 4 mil tokens cada', async () => {
  const a = ambiente({ custoTokens: 4000 })
  const r = await rodar(a)
  assert.equal(r.parada, null)
  assert.equal(a.uso.chamadas, 96)
  assert.ok(a.uso.pico < 600_000 && a.uso.pico < EVAL_LIMITS.userDailyTokens)
  assert.ok(INTERVALO_MS * EVAL_LIMITS.perMinute > 60_000)
  for (const l of r.resumo.linhas) assert.deepEqual([l.acertos, l.violacoes, l.erros], [TAREFAS.length, 0, 0])
  assert.ok(r.gastoUSD > 0 && r.gastoUSD < 0.25)
  assert.ok(r.resultados.every((x) => !x.custoEstimado && x.provedores[0] === 'Simulado' && x.latenciaMs < INTERVALO_MS))
  assert.ok(!JSON.stringify(r).includes('token-secreto'))
})

test('modelos e preço máximo do avaliador iguais aos da função', () => {
  assert.deepEqual([...MODELOS].sort(), [...EVAL_MODELS].sort())
  assert.deepEqual(PRECO_MAXIMO, EVAL_MAX_PRICE)
})

test('teto: não inicia chamada que possa passar dele', async () => {
  const a = ambiente()
  const r = await rodar(a, { teto: 0.0001 })
  assert.deepEqual([r.parada, a.uso.chamadas, r.gastoUSD], ['teto', 0, 0])
})

for (const [nome, opcoes, parada] of [
  ['402 do provedor', { upstream: async () => new Response('x', { status: 402 }) }, 'proxy_provider_402'],
  ['402 dentro de 200', { upstream: async () => new Response('{"error":{"code":402}}') }, 'proxy_provider_402'],
  ['401 do provedor', { upstream: async () => new Response('x', { status: 401 }) }, 'proxy_provider_401'],
  ['cota da função', { reserve: async () => ({ allowed: false, reason: 'user_budget' }) }, 'proxy_user_budget'],
  ['sem controle de cota', { reserve: async () => { throw new Error('rpc') } }, 'proxy_quota_unavailable'],
  ['não liberado', { userId: 'comum' }, 'proxy_not_released'],
]) {
  test(`parada limpa: ${nome}`, async () => {
    const r = await rodar(ambiente(opcoes))
    assert.equal(r.parada, parada)
    assert.equal(r.resultados.length, 1)
    assert.equal(r.gastoUSD, 0)
  })
}

test('falha do provedor não para; 5xx conta o pior caso e 404 não cobra', async () => {
  for (const [status, cobra] of [[500, true], [404, false]]) {
    const r = await rodar(ambiente({ upstream: async () => new Response('x', { status }) }), { modelos: [model], semZdr: false })
    assert.equal(r.parada, null)
    assert.equal(r.resultados.length, TAREFAS.length)
    assert.equal(r.gastoUSD > 0, cobra)
  }
})

test('saída barrada pela função: custo contado e violação preservada', async () => {
  const upstream = async () => new Response(JSON.stringify({
    usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 },
    choices: [{ message: { tool_calls: [{ function: { name: 'AgentOutput', arguments: '{"action":{"execute_javascript":{}}}' } }] } }],
  }))
  const r = await avaliar([TAREFAS[0]], { modelos: [model], apiKey: 'k', fetch: ambiente({ upstream }).transporte })
  assert.equal(r.gastoUSD, 0.001)
  assert.deepEqual(r.resultados[0].violacoes, [{ passo: 1, tipo: 'acao_fora_da_lista' }])
  assert.deepEqual(r.resultados[0].erros, [])
})

test('função publicada sem modo de avaliação: para na primeira resposta', async () => {
  const transporte = fetchViaProxy(sessao, { fetch: async () => new Response('{"choices":[]}'), intervaloMs: 0 })
  const r = await avaliar(TAREFAS, { modelos: [model], apiKey: 'k', fetch: transporte })
  assert.equal(r.parada, 'proxy_sem_modo_eval')
  assert.equal(r.resultados.length, 1)
})

test('login: lê os arquivos e nunca leva senha ou corpo do erro na mensagem', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'cred-'))
  const arquivo = join(pasta, 'c')
  writeFileSync(arquivo, '# x\r\nE2E_EMPRESA_EMAIL=teste@exemplo.com\r\nE2E_EMPRESA_PASSWORD="senha=ficticia"\r\n')
  assert.deepEqual(lerEnv(arquivo), { E2E_EMPRESA_EMAIL: 'teste@exemplo.com', E2E_EMPRESA_PASSWORD: 'senha=ficticia' })
  rmSync(pasta, { recursive: true })
  const dados = { url: 'https://x.supabase.co/', anonKey: 'anon', email: 'teste@exemplo.com', senha: 'senha-ficticia' }
  const ok = await entrar({ ...dados, fetch: async () => new Response('{"access_token":"t"}') })
  assert.equal(ok.endpoint, sessao.endpoint)
  await assert.rejects(
    entrar({ ...dados, fetch: async () => new Response('eco senha-ficticia', { status: 400 }) }),
    (e) => !/ficticia|teste@/.test(e.message),
  )
  await assert.rejects(entrar({ ...dados, url: 'http://evil.example', fetch: null }), /https/)
  await assert.rejects(entrar({ ...dados, senha: '', rotulo: 'E2E_WORKER', fetch: null }), /E2E_WORKER_EMAIL/)
  await assert.rejects(conferirFuncao(ok, async () => new Response('{}', { status: 403 })), /403/)
})

test('429 de um fornecedor: tenta de novo, tira só aquele modelo e não encerra a execução', async () => {
  const lento = MODELOS[0]
  const a = ambiente({
    upstream: undefined,
  })
  // Envolve o transporte: o primeiro modelo sempre recebe "sem vaga"; os demais seguem normais.
  let pedidosAoLento = 0
  const transporte = async (url, init, ctx) => {
    if (ctx.model === lento) {
      pedidosAoLento++
      return new Response(JSON.stringify({ _proxy: { falha: 'provider_429', transitorio: true, parar: false, cobrar: false } }))
    }
    return a.transporte(url, init, ctx)
  }
  const esperas = []
  const r = await rodar({ transporte }, { esperar: async (ms) => { esperas.push(ms) } })
  assert.equal(r.parada, null)
  assert.equal(pedidosAoLento, 3)
  assert.deepEqual(esperas, [20_000, 40_000])
  assert.deepEqual(r.semVaga, [lento])
  assert.equal(r.resumo.linhas.length, MODELOS.length - 1)
  assert.equal(r.resumo.rodadasComparaveis, TAREFAS.length)
})
