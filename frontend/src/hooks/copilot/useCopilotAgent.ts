/** Estado da conversa e ponte entre o executor e a tela. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createOutlineHighlighter, type Highlighter } from '../../lib/copilot/highlight'
import type { CopilotRole } from '../../lib/copilot/routes'
import type { CopilotSession, SessionOptions } from '../../lib/copilot/session'
import type { ConfirmCard, CopilotMode, CopilotUI } from '../../lib/copilot/ui'

export interface ChatItem {
  id: number
  from: 'me' | 'copilot'
  text: string
}

export type Pending =
  | { kind: 'confirm'; card: ConfirmCard; resolve: (ok: boolean) => void }
  | { kind: 'show'; instruction: string; element: HTMLElement; resolve: (r: 'done' | 'skip') => void }
  | { kind: 'ask'; question: string; resolve: (answer: string) => void }

export interface AgentOverrides {
  isHuman?: SessionOptions['isHuman']
  stepDelaySeconds?: number
  navigationSettleMs?: number
  highlighter?: Highlighter
}

export interface UseCopilotAgentOptions {
  role: CopilotRole
  navigate: (path: string) => void
  createLlmFetch: (role: CopilotRole) => typeof fetch
  overrides?: AgentOverrides
}

export function useCopilotAgent(options: UseCopilotAgentOptions) {
  const [messages, setMessages] = useState<ChatItem[]>([])
  const [steps, setSteps] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const sessionRef = useRef<CopilotSession | null>(null)
  const cancelledRef = useRef(false)
  const busyRef = useRef(false)
  const nextId = useRef(1)
  const [highlighter] = useState(() => options.overrides?.highlighter ?? createOutlineHighlighter())
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })

  const say = useCallback((from: ChatItem['from'], text: string) => {
    setMessages((list) => [...list.slice(-30), { id: nextId.current++, from, text }])
  }, [])

  const ui = useMemo<CopilotUI>(() => {
    /** Promessa de uma resposta da pessoa, cancelada pelo PARAR. */
    function waitFor<T>(
      signal: AbortSignal,
      fallback: T,
      build: (finish: (value: T) => void) => Pending,
      cleanup?: () => void,
    ): Promise<T> {
      return new Promise<T>((resolve) => {
        let settled = false
        const finish = (value: T) => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', onAbort)
          cleanup?.()
          setPending(null)
          resolve(value)
        }
        const onAbort = () => finish(fallback)
        if (signal.aborted) return resolve(fallback)
        signal.addEventListener('abort', onAbort)
        setPending(build(finish))
      })
    }
    return {
      confirm(card, element, signal) {
        if (element) highlighter.show(element)
        return waitFor<boolean>(signal, false, (resolve) => ({ kind: 'confirm', card, resolve }), highlighter.clear)
      },
      showMe(request, signal) {
        highlighter.show(request.element)
        let detach = () => {}
        return waitFor<'done' | 'skip'>(
          signal,
          'skip',
          (resolve) => {
            if (request.kind === 'tap') {
              const human = latest.current.overrides?.isHuman ?? ((e: Event) => e.isTrusted)
              const onTap = (event: Event) => {
                // Deixa o clique da pessoa chegar na tela antes de seguir.
                if (human(event)) setTimeout(() => resolve('done'), 0)
              }
              request.element.addEventListener('click', onTap, { capture: true })
              detach = () => request.element.removeEventListener('click', onTap, { capture: true })
            }
            return { kind: 'show', instruction: request.instruction, element: request.element, resolve }
          },
          () => {
            detach()
            highlighter.clear()
          },
        )
      },
      handoff(request) {
        highlighter.show(request.element)
      },
      highlight(element, message) {
        highlighter.show(element)
        say('copilot', message)
      },
      ask(question, signal) {
        say('copilot', question)
        return waitFor<string>(signal, '', (resolve) => ({
          kind: 'ask',
          question,
          resolve: (answer) => {
            say('me', answer)
            resolve(answer)
          },
        }))
      },
      step(text) {
        setSteps((list) => [...list.slice(-19), text])
      },
    }
  }, [highlighter, say])

  const start = useCallback(
    async (text: string, mode: CopilotMode) => {
      if (busyRef.current || !text.trim()) return
      busyRef.current = true
      cancelledRef.current = false
      highlighter.clear()
      setRunning(true)
      setSteps([])
      say('me', text.trim())
      try {
        // O motor (page-agent) só é baixado quando a pessoa pede algo.
        const { createCopilotSession } = await import('../../lib/copilot/session')
        if (cancelledRef.current) {
          say('copilot', 'Parei, como você pediu.')
          return
        }
        const { role, navigate, createLlmFetch, overrides } = latest.current
        const session = createCopilotSession({
          role,
          mode,
          ui,
          navigate: (path) => navigate(path),
          llmFetch: createLlmFetch(role),
          isHuman: overrides?.isHuman,
          stepDelaySeconds: overrides?.stepDelaySeconds,
          navigationSettleMs: overrides?.navigationSettleMs,
        })
        sessionRef.current = session
        const result = await session.run(text)
        say('copilot', result.message)
      } catch {
        say('copilot', 'Não consegui continuar. Tente de novo em instantes.')
      } finally {
        sessionRef.current = null
        busyRef.current = false
        setPending(null)
        setRunning(false)
      }
    },
    [highlighter, say, ui],
  )

  const stop = useCallback(() => {
    cancelledRef.current = true
    sessionRef.current?.stop()
    highlighter.clear()
  }, [highlighter])

  useEffect(
    () => () => {
      cancelledRef.current = true
      sessionRef.current?.stop()
      highlighter.clear()
    },
    [highlighter],
  )

  return { messages, steps, running, pending, start, stop, clearHighlight: highlighter.clear }
}
