/**
 * Uma tarefa do copiloto: `PageAgentCore` (laço e protocolo do page-agent) montado com o
 * controlador guardado, ferramentas restritas e a guarda de eventos armada do início ao fim.
 */
import { PageAgentCore, tool } from '@page-agent/core'
import * as z from 'zod/v4'
import { createActionGuard, type ActionGuard } from './guard'
import { GuardedPageController, type StopReason } from './guardedController'
import { writeLog } from './log'
import { cleanLabel } from './observe'
import { redactPII } from './redact'
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
  limit: { status: 'limit', message: 'Parei: a tarefa ficou longa demais. Peça em partes menores.' },
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
        const dirty = controller.filled.some((el) => el.isConnected)
        if (options.mode === 'show' || (dirty && window.location.pathname !== path)) {
          const approved = await options.ui.confirm(
            {
              screen: screenName(window.location.pathname),
              action: `Abrir a tela "${name}"`,
              reason: dirty ? 'O que foi preenchido aqui pode se perder.' : 'Você pediu para só mostrar.',
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
        return 'Destaquei o item.'
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
        customSystemPrompt: 'worki',
        customTools,
        experimentalScriptExecutionTool: false,
        experimentalLlmsTxt: false,
        customFetch: options.llmFetch,
        instructions: {
          system: [
            `Hoje é ${today()} (fuso de São Paulo).`,
            options.mode === 'show'
              ? 'Modo ME MOSTRE: a pessoa quer aprender. Cada passo é feito por ela.'
              : 'Modo FAÇA PRA MIM: execute, um passo por vez.',
          ].join('\n'),
        },
        onBeforeStep: () => {
          if (pathPolicy(window.location.pathname) === 'blocked' || document.querySelector('[data-testid="tos-gate-modal"]')) {
            stop('out-of-scope')
          }
        },
      })
      agent.onAskUser = async (question) => {
        const answer = redactPII(await options.ui.ask(plainText(question, 300), abort.signal)).slice(0, 300)
        wordsOf(answer).forEach((word) => allowedWords.add(word))
        return answer
      }
      agent.addEventListener('activity', (event) => {
        const activity = (event as CustomEvent<{ type: string; tool?: string; input?: unknown }>).detail
        if (activity.type !== 'executing' || !activity.tool) return
        const text = describeStep(activity.tool, activity.input)
        if (text) options.ui.step(text)
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
        if (stopReason && FINAL[stopReason]) return FINAL[stopReason]!
        const last = result.history.at(-1)
        if (last?.type === 'step' && last.action.name === 'done') {
          return { status: result.success ? 'done' : 'failed', message: plainText(result.data) || 'Terminei.' }
        }
        if (/step count exceeded/i.test(result.data)) return FINAL.limit!
        return { status: 'error', message: 'Não consegui continuar. Tente de novo em instantes.' }
      } catch {
        return { status: 'error', message: 'Não consegui continuar. Tente de novo em instantes.' }
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
