// Transporte `--via-proxy`: o avaliador fala com a edge function `copilot-llm` (a chave do provedor
// fica lá), logado como a conta de teste. Senha e token só existem em memória: nada é impresso,
// gravado nem repassado em mensagem de erro.
import { readFileSync } from 'node:fs'
import { CLIENT_MODEL, TOOL_NAME } from '../../supabase/functions/copilot-llm/contract.ts'

/** 20 chamadas por minuto é o limite da função: uma a cada 3,1 s não o alcança. */
export const INTERVALO_MS = 3100

export function lerEnv(arquivo) {
  const pares = {}
  for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linha)
    if (m) pares[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2')
  }
  return pares
}

export async function entrar({ url, anonKey, email, senha, rotulo = 'E2E_EMPRESA', fetch = globalThis.fetch }) {
  if (!url || !anonKey) throw new Error('Faltam VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em frontend/.env.local.')
  if (!email || !senha) throw new Error(`Faltam ${rotulo}_EMAIL e ${rotulo}_PASSWORD em scripts/.e2e-credenciais.`)
  const base = url.replace(/\/+$/, '')
  if (!base.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
    throw new Error('VITE_SUPABASE_URL precisa ser https.')
  }
  const response = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ email, password: senha }),
  })
  // O corpo do erro de login não é lido.
  if (!response.ok) throw new Error(`Login da conta de teste falhou (HTTP ${response.status}).`)
  const token = (await response.json())?.access_token
  if (!token) throw new Error('Login da conta de teste não devolveu sessão.')
  return { endpoint: `${base}/functions/v1/copilot-llm`, headers: { authorization: `Bearer ${token}`, apikey: anonKey } }
}

/** GET de disponibilidade: não gasta crédito nem cota. */
export async function conferirFuncao(sessao, fetch = globalThis.fetch) {
  const response = await fetch(sessao.endpoint, {
    method: 'GET', headers: sessao.headers, redirect: 'error', signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`copilot-llm indisponível para a conta de teste (HTTP ${response.status}).`)
}

const codigo = (valor) => (typeof valor === 'string' && /^[a-z0-9_]{1,40}$/.test(valor) ? valor : null)
const envelope = (corpo) => new Response(JSON.stringify(corpo))

/** Erros sem chamada ao provedor que ainda assim não interrompem a execução (só a tarefa). */
const SEGUE = /^provider_(400|404|408|413|422)$/

/**
 * Mesma assinatura do `fetch` que o avaliador usa com o OpenRouter, mais o contexto da tarefa.
 * Do pedido original só saem a mensagem do usuário (dados fictícios) e o modelo.
 */
export function fetchViaProxy(sessao, {
  fetch = globalThis.fetch, intervaloMs = INTERVALO_MS, agora = () => Date.now(),
  esperar = (ms) => new Promise((ok) => setTimeout(ok, ms)),
} = {}) {
  let ultima = -Infinity
  return async (_url, init, { tarefa, model }) => {
    const falta = ultima + intervaloMs - agora()
    if (falta > 0) await esperar(falta)
    ultima = agora()
    const user = JSON.parse(init.body).messages[1].content
    const response = await fetch(sessao.endpoint, {
      method: 'POST',
      redirect: 'error',
      // Prazo novo: o de quem chamou começou antes da espera do ritmo.
      signal: AbortSignal.timeout(60_000),
      headers: { ...sessao.headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: CLIENT_MODEL,
        role: tarefa.role,
        messages: [{ role: 'system', content: '' }, { role: 'user', content: user }],
        tools: [{ type: 'function', function: { name: TOOL_NAME } }],
        eval: { model },
      }),
    })
    let data = null
    try {
      data = await response.json()
    } catch {
      data = null
    }
    const info = data?.eval
    const base = { latenciaMs: info?.latency_ms, flags: info?.flags ?? [] }
    const usage = { prompt_tokens: info?.input_tokens, completion_tokens: info?.output_tokens, cost: info?.cost_usd }

    if (response.ok) {
      // Resposta sem `eval` = função publicada sem o modo de avaliação: o modelo pedido não foi usado.
      if (info?.model !== model) {
        return envelope({ _proxy: { falha: 'sem_modo_eval', parar: true, cobrar: true } })
      }
      return envelope({ provider: info.provider, usage, choices: data.choices, _proxy: base })
    }
    const erro = codigo(data?.error?.message) ?? `http_${response.status}`
    if (erro === 'model_no_action' || erro === 'invalid_model_output') {
      return envelope({ provider: info?.provider, usage, choices: [], _proxy: { ...base, erro } })
    }
    // 429 DO PROVEDOR é fila cheia de um fornecedor, não o limite da chave: tenta de novo e não encerra a execução.
    if (erro === 'provider_429') {
      return envelope({ _proxy: { falha: erro, transitorio: true, parar: false, cobrar: false } })
    }
    const limite = response.status === 429 || ['provider_401', 'provider_402', 'provider_403'].includes(erro)
    // Com `eval` na resposta (ou 5xx sem corpo reconhecível) pode ter havido cobrança.
    const cobrar = !limite && !SEGUE.test(erro) && (Boolean(info) || (response.status >= 500 && !codigo(data?.error?.message)))
    // Falha do modelo ou do provedor encerra só a tarefa; recusa da própria função encerra tudo.
    const parar = limite || !(erro.startsWith('provider_') || (cobrar && response.status >= 500))
    return envelope({ _proxy: { falha: erro, parar, cobrar, custo: info?.cost_usd, latenciaMs: info?.latency_ms } })
  }
}
