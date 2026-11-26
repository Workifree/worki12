/**
 * Repetição do PEDIDO ao modelo. É segura porque acontece antes de qualquer ferramenta rodar
 * (a repetição do page-agent, que reexecutaria a ação, continua desligada).
 */
const REPETIVEIS = new Set(['model_no_action', 'invalid_model_output', 'provider_429'])
export const MAX_REPETICOES = 2

export interface RetryOptions {
  signal: AbortSignal
  onRetry?: () => void
  /** Código da última falha que chegou ao laço (para a mensagem final). */
  onFailure?: (code: string) => void
  delayMs?: number
}

async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as { error?: { message?: unknown } }
    return typeof body.error?.message === 'string' ? body.error.message : `http_${response.status}`
  } catch {
    return `http_${response.status}`
  }
}

export function withRetry(send: typeof fetch, options: RetryOptions): typeof fetch {
  return async (url, init) => {
    for (let attempt = 0; ; attempt++) {
      const response = await send(url, init)
      if (response.ok) return response
      const code = await errorCode(response)
      if (attempt >= MAX_REPETICOES || !REPETIVEIS.has(code) || options.signal.aborted) {
        options.onFailure?.(code)
        return response
      }
      options.onRetry?.()
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, (options.delayMs ?? 1200) * (attempt + 1))
        options.signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
      })
      if (options.signal.aborted) return response
    }
  }
}

const COTA = new Set(['rate_day', 'user_budget', 'global_budget', 'quota_exceeded'])

/** Mensagem final quando o Copiloto falha: o que já foi feito e o que a pessoa faz agora. */
export function failureMessage(code: string, done: readonly string[], screen: string): string {
  const feito = done.length ? `Até aqui eu: ${done.slice(-4).join('; ')}.` : 'Não cheguei a mexer em nada.'
  const onde = `Você está na tela "${screen}" e pode continuar tocando nela normalmente.`
  if (COTA.has(code)) {
    return `O limite de uso do Copiloto acabou por hoje. ${feito} ${onde} Os guias passo a passo continuam funcionando.`
  }
  if (code === 'rate_minute') return `Foram muitos pedidos em pouco tempo. ${feito} Espere um minuto e peça de novo.`
  return `O Copiloto falhou e não consegui terminar. ${feito} ${onde} Se quiser, peça de novo ou use "Ver os guias passo a passo".`
}
