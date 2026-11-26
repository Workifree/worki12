// Duas fases (sem --simular chama a API REAL e gasta crédito). Precisa de Node 22.18+.
//   Fase 1: todos os modelos, 1 repetição por tarefa.
//     node scripts/copiloto-eval/run.mjs [--modelos a,b,c] [--sem-zdr]
//   Fase 2: repetições só nos 2 ou 3 melhores.
//     node scripts/copiloto-eval/run.mjs --fase 2 --modelos x,y [--repetir 3]
//   Outras: --teto-usd 0.25, --tarefas id1,id2, --saida arquivo.json, --simular (sem rede nem chave).
// Direto: a chave vem só de OPENROUTER_API_KEY, no ambiente. Nunca é impressa nem salva.
// --via-proxy: chama a edge function copilot-llm logado na conta de teste (E2E_EMPRESA_* de
//   scripts/.e2e-credenciais; URL e anon key de frontend/.env.local). Respeita 20 chamadas/minuto.
//   --conta empresa|freela escolhe a conta de teste (padrão empresa: E2E_EMPRESA_*; freela: E2E_WORKER_*).
//   O papel das tarefas (role) segue o cenário, não a conta; a cota diária é por conta.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  MODELOS, PRODUCAO, SEM_ZDR, TETO_PADRAO, avaliar, estimar, fetchSimulado, ordenar, tabela, validarModelos,
} from './avaliador.mjs'
import { conferirFuncao, entrar, fetchViaProxy, lerEnv } from './via-proxy.mjs'
import { TAREFAS } from './tarefas.mjs'

const falha = (texto) => {
  console.error(texto)
  process.exit(2)
}

let v
try {
  v = parseArgs({
    options: {
      fase: { type: 'string', default: '1' }, modelos: { type: 'string' }, tarefas: { type: 'string' },
      repetir: { type: 'string' }, 'teto-usd': { type: 'string' }, saida: { type: 'string' },
      'sem-zdr': { type: 'boolean', default: false }, simular: { type: 'boolean', default: false },
      'via-proxy': { type: 'boolean', default: false }, conta: { type: 'string', default: 'empresa' },
    },
  }).values
} catch (erro) {
  falha(erro.message)
}

const lista = (texto) => [...new Set(texto.split(',').map((s) => s.trim()).filter(Boolean))]
const semZdr = v['sem-zdr']
if (v.fase !== '1' && v.fase !== '2') falha('--fase é 1 ou 2.')
const modelos = v.modelos ? lista(v.modelos) : semZdr ? MODELOS : [...PRODUCAO]
try {
  validarModelos(modelos, semZdr)
} catch (erro) {
  falha(`${erro.message}\nModelos: ${MODELOS.join(', ')}`)
}
if (v.fase === '2' && (!v.modelos || modelos.length < 2 || modelos.length > 3)) falha('Fase 2: informe 2 ou 3 em --modelos.')
if (v.fase === '1' && v.repetir) falha('A fase 1 tem 1 repetição; --repetir é da fase 2.')
const repetir = v.fase === '1' ? 1 : Number(v.repetir ?? 3)
if (!Number.isInteger(repetir) || repetir < 1 || repetir > 20) falha('--repetir vai de 1 a 20.')
const teto = Number(v['teto-usd'] ?? TETO_PADRAO)
if (!Number.isFinite(teto) || teto <= 0) falha('--teto-usd precisa ser um número positivo.')
const ids = v.tarefas ? lista(v.tarefas) : null
const tarefas = ids ? TAREFAS.filter((t) => ids.includes(t.id)) : TAREFAS
if (!tarefas.length || (ids && ids.length !== tarefas.length)) falha(`Tarefas: ${TAREFAS.map((t) => t.id).join(', ')}`)

const viaProxy = v['via-proxy']
if (v.conta !== 'empresa' && v.conta !== 'freela') falha('--conta é empresa ou freela.')
if (v.conta !== 'empresa' && !viaProxy) falha('--conta só vale com --via-proxy.')
if (viaProxy && v.simular) falha('Escolha --via-proxy ou --simular.')
// Via proxy a chave fica na função: o valor abaixo só preenche o pedido local, que não é enviado.
const apiKey = v.simular ? 'simulado' : viaProxy ? 'via-proxy' : process.env.OPENROUTER_API_KEY?.trim()
if (!apiKey) falha('Defina OPENROUTER_API_KEY no ambiente (ou use --via-proxy ou --simular).')

if (semZdr && modelos.some((m) => SEM_ZDR.includes(m))) {
  console.warn(
    `AVISO: --sem-zdr desliga o ZDR para ${modelos.filter((m) => SEM_ZDR.includes(m)).join(', ')}. ` +
      'O provedor pode reter o texto enviado. Use apenas os dados fictícios deste avaliador; esses modelos não vão para produção.',
  )
}
const previsao = estimar(tarefas, { modelos, repetir, semZdr })
console.log(
  `Fase ${v.fase}: ${modelos.length} modelos x ${tarefas.length} tarefas x ${repetir}. ` +
    `Estimativa: ${previsao.chamadas} chamadas, cerca de US$ ${previsao.provavelUSD.toFixed(4)} ` +
    `(pior caso teórico US$ ${previsao.piorUSD.toFixed(2)}). Teto: US$ ${teto.toFixed(2)}.${v.simular ? ' SIMULADO.' : ''}`,
)
console.log(`Ordem: ${ordenar(modelos).join(', ')}`)

const aqui = dirname(fileURLToPath(import.meta.url))
let transporte = v.simular ? fetchSimulado(tarefas) : fetch
if (viaProxy) {
  try {
    const app = lerEnv(resolve(aqui, '../../frontend/.env.local'))
    const conta = lerEnv(resolve(aqui, '../.e2e-credenciais'))
    // Só o nome da variável é usado; o valor nunca é impresso.
    const prefixo = v.conta === 'freela' ? 'E2E_WORKER' : 'E2E_EMPRESA'
    const sessao = await entrar({
      url: app.VITE_SUPABASE_URL, anonKey: app.VITE_SUPABASE_ANON_KEY,
      email: conta[`${prefixo}_EMAIL`], senha: conta[`${prefixo}_PASSWORD`], rotulo: prefixo,
    })
    await conferirFuncao(sessao)
    transporte = fetchViaProxy(sessao)
  } catch (erro) {
    falha(erro.message)
  }
}
const carimbo = new Date().toISOString().replace(/[:.]/g, '-')
const saida = resolve(v.saida ?? resolve(aqui, 'resultados', `fase${v.fase}${v.simular ? '-simulado' : ''}-${carimbo}.json`))
mkdirSync(dirname(saida), { recursive: true })
const salvar = (relatorio) =>
  writeFileSync(saida, JSON.stringify({ fase: Number(v.fase), simulado: v.simular, viaProxy, conta: viaProxy ? v.conta : undefined, ...relatorio }, null, 2))

const relatorio = await avaliar(tarefas, {
  modelos, repetir, teto, semZdr, apiKey, aoSalvar: salvar,
  fetch: transporte,
})
salvar(relatorio)

console.log(`\n${tabela(relatorio.resumo)}`)
console.log(
  `\nRodadas comparáveis (todos os modelos): ${relatorio.resumo.rodadasComparaveis}. ` +
    `Gasto: US$ ${relatorio.gastoUSD.toFixed(6)}. * = inclui custo não informado pela API, contado pelo pior caso.`,
)
if (relatorio.semVaga?.length) console.log(`Fora da comparação por fila no fornecedor (429): ${relatorio.semVaga.join(', ')}`)
if (relatorio.parada) console.log(`PARADA antes do fim: ${relatorio.parada}. Resultado parcial salvo.`)
console.log(`JSON: ${saida}`)
process.exitCode = relatorio.parada ? 3 : 0
