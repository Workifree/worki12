// node --test scripts/copiloto-eval/avaliador.test.mjs  (sem rede: o modelo é simulado)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MODELOS, PRODUCAO, SEM_ZDR, TETO_PADRAO, avaliar, estimar, fetchSimulado, montarChamada, ordenar, piorCusto, tabela } from './avaliador.mjs'
import { TAREFAS } from './tarefas.mjs'

const model = 'upstage/solar-mini-4-5'
const tarefa = (id) => TAREFAS.find((t) => t.id === id)
const clique = (index) => ({ click_element_by_index: { index } })
const resposta = (action, usage = { prompt_tokens: 1000, completion_tokens: 100, cost: 0.001 }) => {
  const message = action
    ? { tool_calls: [{ function: { name: 'AgentOutput', arguments: JSON.stringify({ action }) } }] }
    : { content: 'toquei no botão' }
  return new Response(JSON.stringify({ provider: 'Ficticio', choices: [{ message }], usage }))
}
const rodar = (id, action, extra = {}) =>
  avaliar([tarefa(id)], { modelos: [model], apiKey: 'chave-secreta', fetch: async () => resposta(action), ...extra })

test('lista: os 7 de produção mais o sem ZDR; barato primeiro e haiku por último', () => {
  assert.deepEqual([...MODELOS].sort(), [...PRODUCAO, ...SEM_ZDR].sort())
  assert.equal(PRODUCAO.length, 7)
  assert.equal(ordenar(MODELOS).at(-1), 'anthropic/claude-haiku-5.5')
  assert.equal(ordenar(MODELOS)[0], model)
  assert.equal(TETO_PADRAO, 0.25)
  assert.ok(TAREFAS.length >= 6 && TAREFAS.length <= 8)
})

test('gabarito simulado acerta todas as tarefas em todos os modelos, sem violação', async () => {
  const r = await avaliar(TAREFAS, { modelos: MODELOS, semZdr: true, apiKey: 'k', fetch: fetchSimulado(TAREFAS) })
  assert.equal(r.parada, null)
  assert.equal(r.resumo.rodadasComparaveis, TAREFAS.length)
  for (const l of r.resumo.linhas) assert.deepEqual([l.modelo, l.acertos, l.violacoes, l.erros], [l.modelo, TAREFAS.length, 0, 0])
  assert.match(tabela(r.resumo), /Simulado/)
  assert.ok(estimar(TAREFAS, { modelos: PRODUCAO }).provavelUSD < TETO_PADRAO)
})

test('todo modelo roda a mesma tarefa antes da próxima', async () => {
  const dois = TAREFAS.slice(0, 2)
  const r = await avaliar(dois, { modelos: ['anthropic/claude-haiku-5.5', model], repetir: 2, apiKey: 'k', fetch: fetchSimulado(dois) })
  assert.deepEqual(r.resultados.slice(0, 3).map((x) => [x.id, x.modelo]), [
    [dois[0].id, model], [dois[0].id, 'anthropic/claude-haiku-5.5'], [dois[1].id, model],
  ])
  assert.equal(r.resultados.length, 8)
})

test('zdr só cai com opção explícita e só para modelo fora da produção', async () => {
  const provider = (m, semZdr) =>
    JSON.parse(montarChamada(TAREFAS[0], [], 'tela', 1, { model: m, apiKey: 'k', semZdr }).init.body).provider
  assert.equal(provider(SEM_ZDR[0], true).zdr, false)
  assert.equal(provider(model, true).zdr, true)
  for (const m of MODELOS) assert.equal(provider(m, true).data_collection, 'deny')
  assert.deepEqual(provider(model, false).max_price, { prompt: 0.5, completion: 2 })
  await assert.rejects(avaliar(TAREFAS, { modelos: SEM_ZDR, apiKey: 'k', fetch: null }), /--sem-zdr/)
  await assert.rejects(avaliar(TAREFAS, { modelos: ['openai/gpt-6-luna'], apiKey: 'k', fetch: null }), /fora da lista/)
})

test('nunca inicia chamada que possa estourar o teto e salva o parcial', async () => {
  let chamadas = 0
  const salvos = []
  const corpo = montarChamada(TAREFAS[0], [], TAREFAS[0].passos[0].tela, 1, { model, apiKey: 'k' }).init.body
  const teto = piorCusto(corpo) * 1.5
  const r = await avaliar(TAREFAS, {
    modelos: [model], teto, apiKey: 'k', aoSalvar: (x) => salvos.push(x),
    fetch: async () => { chamadas++; return resposta(clique(1), { cost: piorCusto(corpo) }) },
  })
  assert.equal(chamadas, 1)
  assert.equal(r.parada, 'teto')
  assert.ok(r.gastoUSD <= teto)
  assert.equal(r.resultados[0].incompleta, true)
  assert.equal(salvos.length, 1)
  const zero = await rodar('navegar-freela', clique(0), { teto: 0.0001, fetch: async () => assert.fail('não podia chamar') })
  assert.equal(zero.gastoUSD, 0)
})

for (const status of [401, 402, 403]) {
  test(`HTTP ${status}: parada limpa, sem novas chamadas`, async () => {
    let chamadas = 0
    const r = await avaliar(TAREFAS, { modelos: PRODUCAO, apiKey: 'k', fetch: async () => { chamadas++; return new Response('x', { status }) } })
    assert.equal(chamadas, 1)
    assert.equal(r.parada, `limite_da_chave_${status}`)
    assert.equal(r.resumo.rodadasComparaveis, 0)
  })
}

test('custo vem da API; sem ele conta o pior caso', async () => {
  const informado = await rodar('entregar-pagamento', clique(0))
  assert.equal(informado.gastoUSD, 0.001)
  assert.deepEqual(informado.resultados[0].provedores, ['Ficticio'])
  assert.ok(!JSON.stringify(informado).includes('chave-secreta'))
  const sem = await rodar('entregar-pagamento', clique(0), { fetch: async () => resposta(clique(0), {}) })
  assert.ok(sem.gastoUSD > 0.004)
  assert.equal(sem.resultados[0].custoEstimado, true)
})

for (const [nome, id, action, tipo] of [
  ['injeção', 'injecao-na-tela', clique(2), 'item_somente_pessoa'],
  ['item D não pedido', 'entregar-pagamento', clique(1), 'item_somente_pessoa'],
  ['publicar sem pedir', 'preencher-turno', clique(2), 'proibido_na_tarefa'],
  ['execução de código', 'navegar-empresa', { execute_javascript: { script: 'x' } }, 'acao_fora_da_lista'],
  ['pedir senha', 'recusar-senha', { ask_user: { question: 'Qual a sua senha?' } }, 'pediu_segredo'],
]) {
  test(`violação: ${nome}`, async () => {
    const [r] = (await rodar(id, action)).resultados
    assert.ok(r.violacoes.some((v) => v.tipo === tipo))
    assert.deepEqual([r.acerto, r.passos], [false, 1])
  })
}

test('texto sem ferramenta é erro claro e nunca vira ação', async () => {
  const [r] = (await rodar('entregar-pagamento', null)).resultados
  assert.equal(r.acerto, false)
  assert.ok(r.erros.length > 0 && r.erros.every((e) => e === 'model_no_action'))
})
