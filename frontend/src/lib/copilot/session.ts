/**
 * Uma tarefa do copiloto: `PageAgentCore` (laço e protocolo do page-agent) montado com o
 * controlador guardado, ferramentas restritas e a guarda de eventos armada do início ao fim.
 */
import { PageAgentCore, tool } from '@page-agent/core'
import * as z from 'zod/v4'
import { TOS_GATE_SELECTOR } from './dom'
import { createActionGuard, type ActionGuard } from './guard'
import { GuardedPageController, type StopReason } from './guardedController'
import { writeLog } from './log'
import { cleanLabel } from './observe'
import { redactPII } from './redact'
import { failureMessage, withRetry } from './retry'
import { classifyClick } from './risk'
import { NAV_DESTINATIONS, destinationFor, pathPolicy, screenName, type CopilotRole } from './routes'
import { CLIENT_MODEL } from './transport'
import type { CopilotMode, CopilotUI } from './ui'
import { wordsOf } from './vocabulary'

export const MAX_STEPS = 20
const MAX_REQUEST_CHARS = 600

export interface SessionOptions {
  role: CopilotRole
  mode: CopilotMode
  ui: CopilotUI
  navigate: (path: string) => void
  /** Em produção: `createCopilotFetch(...)`. Em teste: o modelo simulado atrás dele. */
  llmFetch: typeof fetch
  maxSteps?: number
  maxActions?: number
  stepDelaySeconds?: number
  navigationSettleMs?: number
  confirmTtlMs?: number
  retryDelayMs?: number
  /** Só para testes. */
  isHuman?: (event: Event) => boolean
}

export type SessionStatus = 'done' | 'failed' | 'stopped' | 'handoff' | 'declined' | 'blocked' | 'limit' | 'error'

export interface SessionResult {
  status: SessionStatus
  /** Texto puro, para a pessoa. */
  message: string
}

/** Texto vindo do modelo vira texto puro: sem link clicável nem endereço. */
export function plainText(text: unknown, limit = 600): string {
  if (typeof text !== 'string') return ''
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '(link removido)')
    // Índices são da leitura interna da tela: a pessoa não os vê.
    .replace(/\s*\(?\[\d{1,3}\]\)?/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

function today(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

const FINAL: Partial<Record<StopReason, { status: SessionStatus; message: string }>> = {
  user: { status: 'stopped', message: 'Parei, como você pediu.' },
  declined: { status: 'declined', message: 'Certo, parei sem fazer esse passo.' },
  blocked: { status: 'blocked', message: 'Parei: a trava de segurança barrou uma ação.' },
  'out-of-scope': { status: 'stopped', message: 'Parei: nesta tela o copiloto não atua.' },
  limit: { status: 'limit', message: 'Parei: não consegui concluir e eu estava dando voltas. Peça em partes menores ou use "Ver os guias passo a passo".' },
}

/** Resposta "pode parar" a uma pergunta do agente: a pessoa mudou de ideia, não apertou PARAR. */
const FIM_PELA_RESPOSTA = 'Certo, parei por aqui. Se quiser, é só pedir de novo.'

const PARAR_NA_RESPOSTA =
  /^(?:(?:n[aã]o sei|n[aã]o),?\s*)?(?:(?:pode )?parar?|para(?: com isso| tudo)?|pare|deixa(?: isso)?(?: (?:pra|para) l[aá]| quieto)?|esquece|cancela(?: isso| tudo)?)[\s.!]*$/i

export function wantsToStop(answer: string): boolean {
  return PARAR_NA_RESPOSTA.test(answer.trim())
}

export interface CopilotSession {
  run(request: string): Promise<SessionResult>
  /** Botão PARAR. Vale imediatamente, mesmo com ação ou pergunta pendente. */
  stop(): void
  readonly guard: ActionGuard
}

export function createCopilotSession(options: SessionOptions): CopilotSession {
  const abort = new AbortController()
  const guard = createActionGuard({
    isHuman: options.isHuman,
    onViolation: (violation) => writeLog('bloqueado', violation.reason),
  })
  let agent: PageAgentCore | null = null
  let stopReason: StopReason | null = null
  let stopDetail = ''
  let used = false

  const stop = (reason: StopReason, detail = '') => {
    if (!stopReason) {
      stopReason = reason
      stopDetail = detail
    }
    guard.revoke()
    abort.abort()
    // Sem await: pode ser chamado de dentro de uma ferramenta.
    void agent?.stop()
  }

  const allowedWords = new Set<string>()
  /** O que de fato aconteceu na tela, em frases curtas, para a mensagem de falha. */
  const feitos: string[] = []
  let emCurso = ''
  let lastFailure = 'erro'
  const gaveUp = (): SessionResult => ({
    status: 'error',
    message: failureMessage(lastFailure, feitos, screenName(window.location.pathname)),
  })
  /** Mensagem final sempre útil: o que foi feito e onde a pessoa pode continuar tocando. */
  const useful = (base: string): string => {
    const feito = feitos.length ? ` Até aqui eu: ${feitos.slice(-3).join('; ')}.` : ''
    const onde = ` Você está na tela "${screenName(window.location.pathname)}" e pode continuar por ela.`
    return `${base}${feito}${onde}`
  }
  const controller = new GuardedPageController({
    guard,
    ui: options.ui,
    mode: () => options.mode,
    signal: abort.signal,
    stop,
    allowedWords,
    maxActions: options.maxActions,
    confirmTtlMs: options.confirmTtlMs,
  })

  const destinations = Object.keys(NAV_DESTINATIONS[options.role]) as [string, ...string[]]
  const settle = () => new Promise((resolve) => setTimeout(resolve, options.navigationSettleMs ?? 700))

  /** Vezes que cada tela foi aberta: modelos fracos ficam indo e voltando. */
  const visits = new Map<string, number>()

  const customTools = {
    execute_javascript: null,
    scroll_horizontally: null,
    navigate: tool({
      description: 'Abre uma tela do app. Use somente um destino da lista.',
      inputSchema: z.object({ destination: z.enum(destinations) }),
      execute: async function (input: { destination: string }) {
        if (abort.signal.aborted) return 'Tarefa interrompida.'
        const path = destinationFor(options.role, input.destination)
        if (!path || pathPolicy(path) === 'blocked') return 'Destino não permitido.'
        const name = screenName(path)
        const times = (visits.get(path) ?? 0) + 1
        visits.set(path, times)
        if (times >= 4) {
          stop('limit')
          return 'Tarefa encerrada: a mesma tela foi aberta vezes demais.'
        }
        if (times === 3) {
          return `Você já abriu "${name}" duas vezes. NÃO navegue de novo: toque ou destaque um item da tela (ex.: um botão Editar), ou responda com done.`
        }
        const dirty = controller.filled.some((el) => el.isConnected)
        // Abrir tela é navegação: não pede cartão (nem no "Me mostre"). Só avisa se há preenchimento a perder.
        if (dirty && window.location.pathname !== path) {
          const approved = await options.ui.confirm(
            {
              screen: screenName(window.location.pathname),
              action: `Abrir a tela "${name}"`,
              reason: 'O que foi preenchido aqui pode se perder.',
              fields: [],
            },
            null,
            abort.signal,
          )
          if (!approved) {
            stop('declined')
            return 'A pessoa não quis abrir a tela.'
          }
        }
        if (abort.signal.aborted) return 'Tarefa interrompida.'
        options.navigate(path)
        controller.filled = []
        writeLog('acao', `Abri a tela ${name}`)
        await settle()
        return `Abri a tela ${name}.`
      },
    }),
    highlight: tool({
      description: 'Destaca um item da tela e explica, sem tocar nele.',
      inputSchema: z.object({ index: z.int().min(0), message: z.string() }),
      execute: async function (input: { index: number; message: string }) {
        const entry = controller.resolve(input.index)
        if (typeof entry === 'string') return entry
        if (classifyClick(entry.element).level === 'blocked') return 'Este item não pode ser destacado.'
        options.ui.highlight(entry.element, plainText(input.message, 240))
        // O modelo precisa saber o que destacou de fato, para não afirmar outra coisa.
        return `Destaquei o item "${entry.safeLabel}".`
      },
    }),
  }

  const describeStep = (name: string, input: unknown): string | null => {
    const args = (input ?? {}) as { index?: number; destination?: string }
    const label = args.index === undefined ? '' : controller.localLabel(args.index)
    switch (name) {
      case 'click_element_by_index': return `Estou vendo o botão "${label}"`
      case 'input_text': return `Estou preenchendo "${label}"`
      case 'select_dropdown_option': return `Estou escolhendo em "${label}"`
      case 'navigate': {
        const path = destinationFor(options.role, args.destination ?? '')
        return path ? `Estou abrindo ${screenName(path)}` : null
      }
      case 'highlight': return `Estou mostrando "${label}"`
      case 'scroll': return 'Estou rolando a tela'
      case 'wait': return 'Esperando a tela carregar'
      default: return null
    }
  }

  return {
    guard,
    stop: () => stop('user'),
    async run(request) {
      if (used) throw new Error('Cada sessão roda uma tarefa só.')
      used = true
      if (pathPolicy(window.location.pathname) === 'blocked') {
        return { status: 'stopped', message: FINAL['out-of-scope']!.message }
      }
      // Redigido na origem: o laço, o histórico em memória e o console nunca veem o dado.
      const task = redactPII(request).slice(0, MAX_REQUEST_CHARS).trim()
      if (!task) return { status: 'error', message: 'Escreva o que você precisa.' }
      wordsOf(task).forEach((word) => allowedWords.add(word))
      writeLog('pedido', cleanLabel(task, allowedWords))

      agent = new PageAgentCore({
        pageController: controller,
        // A URL é ignorada pelo transporte; `.invalid` nunca resolve.
        baseURL: 'https://copilot.invalid',
        model: CLIENT_MODEL,
        // 0 de propósito: a repetição do page-agent reexecuta também a FERRAMENTA (clique duplo).
        maxRetries: 0,
        maxSteps: options.maxSteps ?? MAX_STEPS,
        stepDelay: options.stepDelaySeconds,
        // PLACEHOLDER: o page-agent exige algum valor aqui, mas o prompt de sistema verdadeiro é do SERVIDOR
        // (supabase/functions/copilot-llm/contract.ts). O transporte descarta o `system` que sair daqui.
        customSystemPrompt: 'worki',
        customTools,
        experimentalScriptExecutionTool: false,
        experimentalLlmsTxt: false,
        customFetch: withRetry(options.llmFetch, {
          signal: abort.signal,
          delayMs: options.retryDelayMs,
          onRetry: () => options.ui.step('O Copiloto falhou neste passo. Tentando de novo'),
          onFailure: (code) => {
            lastFailure = code
          },
        }),
        instructions: {
          system: [
            `Hoje é ${today()} (fuso de São Paulo).`,
            options.mode === 'show'
              ? 'Modo ME MOSTRE: a pessoa quer aprender. Cada passo é feito por ela.'
              : 'Modo FAÇA PRA MIM: execute, um passo por vez.',
            // Provado em tela: um cartão sem botão não é lido, e o modelo somava o resto como se fosse tudo.
            'Você não vê textos soltos, só botões, campos e títulos; podem faltar itens. Não some valores, não conte itens nem diga que uma lista está completa: leve a pessoa à tela e peça que confira.',
          ].join('\n'),
        },
        onBeforeStep: () => {
          if (pathPolicy(window.location.pathname) === 'blocked' || document.querySelector(TOS_GATE_SELECTOR)) {
            stop('out-of-scope')
          }
        },
      })
      agent.onAskUser = async (question, askOptions) => {
        // O sinal do page-agent também interrompe a espera (AbortError); o PARAR da interface segue
        // resolvendo a pergunta vazia, como antes.
        const external = askOptions?.signal
        const raw = await new Promise<string>((resolve, reject) => {
          const onAbort = () => reject(new DOMException('Pergunta interrompida.', 'AbortError'))
          if (external?.aborted) return onAbort()
          external?.addEventListener('abort', onAbort, { once: true })
          options.ui
            .ask(plainText(question, 300), abort.signal)
            .then(resolve, reject)
            .finally(() => external?.removeEventListener('abort', onAbort))
        })
        const answer = redactPII(raw).slice(0, 300)
        // "Pode parar" vale na hora, sem depender de o modelo obedecer.
        if (wantsToStop(answer)) stop('user', 'resposta')
        wordsOf(answer).forEach((word) => allowedWords.add(word))
        return answer
      }
      agent.addEventListener('activity', (event) => {
        const activity = (event as CustomEvent<{ type: string; tool?: string; input?: unknown }>).detail
        if (!activity.tool) return
        if (activity.type === 'executed') {
          const output = String((activity as { output?: unknown }).output ?? '')
          if (emCurso && /(?:Abri|Toquei|Preenchi|Escolhi|Destaquei) /.test(output)) feitos.push(emCurso)
          emCurso = ''
          return
        }
        if (activity.type !== 'executing') return
        const text = describeStep(activity.tool, activity.input)
        if (!text) return
        emCurso = text
          .replace('Estou abrindo ', 'abri a tela ')
          .replace('Estou vendo o botão', 'toquei em')
          .replace('Estou preenchendo', 'preenchi')
          .replace('Estou escolhendo em', 'escolhi em')
          .replace('Estou mostrando', 'destaquei')
        options.ui.step(text)
      })

      guard.arm()
      try {
        const result = await agent.execute(task)
        if (stopReason === 'handoff') {
          return {
            status: 'handoff',
            message: `Parei aqui: "${stopDetail}" é uma ação que só você pode fazer. Deixei destacado; confira e toque se quiser.`,
          }
        }
        if (stopReason === 'user' && stopDetail === 'resposta') return { status: 'stopped', message: useful(FIM_PELA_RESPOSTA) }
        if (stopReason === 'user') return { ...FINAL.user!, message: feitos.length ? useful(FINAL.user!.message) : FINAL.user!.message }
        if (stopReason && FINAL[stopReason]) return { ...FINAL[stopReason]!, message: useful(FINAL[stopReason]!.message) }
        const last = result.history.at(-1)
        if (last?.type === 'step' && last.action.name === 'done') {
          return { status: result.success ? 'done' : 'failed', message: plainText(result.data) || 'Terminei.' }
        }
        if (/step count exceeded/i.test(result.data)) return { ...FINAL.limit!, message: useful(FINAL.limit!.message) }
        return gaveUp()
      } catch {
        return gaveUp()
      } finally {
        writeLog('parou', 'Tarefa encerrada.')
        guard.disarm()
        abort.abort()
        agent.dispose()
        agent = null
      }
    },
  }
}
