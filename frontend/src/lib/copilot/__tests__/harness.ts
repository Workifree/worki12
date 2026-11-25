/**
 * Bancada de teste: cadeia REAL (PageAgentCore -> transporte -> handler do proxy) com um
 * provedor de LLM simulado e determinístico no fim. `provider.bodies` é exatamente o que
 * sairia para a empresa de IA.
 */
import { handleCopilot, type Deps } from '../../../../../supabase/functions/copilot-llm/handler.ts'
import { createCopilotFetch } from '../transport'
import type { CopilotRole } from '../routes'
import type { ConfirmCard, CopilotUI } from '../ui'

export interface Seen {
  step: number
  /** Mensagem de usuário que chegou ao provedor. */
  user: string
  screen: string
  /** Índice do primeiro item da tela cuja linha casa com o padrão. */
  find(pattern: RegExp): number
}

export type Brain = (seen: Seen) => Record<string, unknown>

export const done = (text = 'Pronto.', success = true) => ({ done: { text, success } })
export const click = (index: number) => ({ click_element_by_index: { index } })
export const type = (index: number, text: string) => ({ input_text: { index, text } })

export function createSimulatedStack(brain: Brain, role: CopilotRole = 'company') {
  const bodies: string[] = []
  const wire: string[] = []
  const logs: string[] = []
  const brainErrors: string[] = []
  const provider = async (_url: string, init: { body: string }) => {
    bodies.push(init.body)
    const user = (JSON.parse(init.body) as { messages: Array<{ content: string }> }).messages[1].content
    const screen = user.slice(user.indexOf('<browser_state>'), user.indexOf('</browser_state>'))
    let action: Record<string, unknown>
    try {
      action = brain({
        step: bodies.length - 1,
        user,
        screen,
        find(pattern) {
          const line = screen.split('\n').find((l) => /^\[\d+\]</.test(l) && pattern.test(l))
          if (!line) throw new Error(`item não encontrado: ${pattern}\n${screen}`)
          return Number(/^\[(\d+)\]/.exec(line)![1])
        },
      })
    } catch (error) {
      // O handler transforma a exceção em 502; sem isto a causa some.
      brainErrors.push(String(error))
      throw error
    }
    const message = {
      role: 'assistant',
      tool_calls: [{ id: 'c', type: 'function', function: { name: 'AgentOutput', arguments: JSON.stringify({ next_goal: 'seguir', action }) } }],
    }
    return new Response(
      JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      { status: 200 },
    )
  }
  const env: Record<string, string> = {
    COPILOT_LLM_PROVIDER: 'openai',
    COPILOT_LLM_MODEL: 'gpt-4.1-mini',
    COPILOT_LLM_API_KEY: 'chave-de-teste',
  }
  const deps: Deps = {
    env: (name) => env[name],
    getUserId: async (token) => (token === 'jwt-bom' ? 'user-1' : null),
    reserve: async () => ({ allowed: true, day: '2026-11-25' }),
    settle: async () => {},
    fetch: provider,
    log: (event, data) => logs.push(JSON.stringify({ event, ...data })),
  }
  const llmFetch = createCopilotFetch({
    endpoint: 'https://proxy.test/functions/v1/copilot-llm/chat/completions',
    role,
    getHeaders: async () => ({ Authorization: 'Bearer jwt-bom' }),
    fetchImpl: (async (url: string, init: RequestInit) => {
      wire.push(String(init.body))
      return handleCopilot(new Request(url, { method: init.method, headers: init.headers, body: init.body }), deps)
    }) as typeof fetch,
  })
  return { llmFetch, bodies, wire, logs, brainErrors, deps, env }
}

let human = false
export const isHuman = () => human

/** Simula o toque de uma pessoa (jsdom não gera eventos `isTrusted`). */
export function humanClick(element: Element) {
  human = true
  try {
    ;(element as HTMLElement).click()
  } finally {
    human = false
  }
}

export interface FakeUI extends CopilotUI {
  cards: ConfirmCard[]
  handoffs: string[]
  steps: string[]
  highlighted: HTMLElement[]
}

export function fakeUI(overrides: Partial<CopilotUI> = {}): FakeUI {
  const ui: FakeUI = {
    cards: [],
    handoffs: [],
    steps: [],
    highlighted: [],
    async confirm(card) {
      ui.cards.push(card)
      return false
    },
    async showMe() {
      return 'skip'
    },
    handoff(request) {
      ui.handoffs.push(request.label)
      ui.highlighted.push(request.element)
    },
    highlight(element) {
      ui.highlighted.push(element)
    },
    async ask() {
      return ''
    },
    step(text) {
      ui.steps.push(text)
    },
    ...overrides,
  }
  return ui
}

/** O que o jsdom não implementa e o page-agent usa. */
export function installDomStubs() {
  document.elementFromPoint = () => null
  Element.prototype.scrollIntoView = () => {}
  if (typeof globalThis.PointerEvent === 'undefined') {
    globalThis.PointerEvent = class extends MouseEvent {} as unknown as typeof PointerEvent
  }
}

export function goTo(path: string) {
  window.history.replaceState({}, '', path)
}
