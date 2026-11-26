/** Estado da conversa e ponte entre o executor e a tela. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createOutlineHighlighter, type Highlighter } from '../../lib/copilot/highlight'
import type { CopilotRole } from '../../lib/copilot/routes'
import type { CopilotSession, SessionOptions } from '../../lib/copilot/session'
import type { VirtualPointer } from '../../lib/copilot/pointer'
import type { ConfirmCard, CopilotMode, CopilotUI } from '../../lib/copilot/ui'

export interface ChatItem {
  id: number
  from: 'me' | 'copilot'
  text: string
}

export type Pending =
  | { kind: 'confirm'; card: ConfirmCard; element: HTMLElement | null; resolve: (ok: boolean) => void }
  | { kind: 'show'; instruction: string; element: HTMLElement; resolve: (r: 'done' | 'skip') => void }
  | { kind: 'ask'; question: string; resolve: (answer: string) => void }

export interface AgentOverrides {
  isHuman?: SessionOptions['isHuman']
  stepDelaySeconds?: number
  navigationSettleMs?: number
  highlighter?: Highlighter
  /** Só testes: 0 = ponteiro sem animação e sem espera. */
  pointerTimeScale?: number
  reducedMotion?: () => boolean
  /** Força a experiência (celular ou PC), por parâmetro de teste. */
  deviceMode?: 'mobile' | 'desktop'
}

export interface UseCopilotAgentOptions {
  role: CopilotRole
  navigate: (path: string) => void
  createLlmFetch: (role: CopilotRole) => typeof fetch
  overrides?: AgentOverrides
  /** Seta (PC) ou dedo virtual (celular). Só imagem: nunca dispara evento. */
  pointer?: { current: VirtualPointer | null }
}

export function useCopilotAgent(options: UseCopilotAgentOptions) {
  const [messages, setMessages] = useState<ChatItem[]>([])
  const [steps, setSteps] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  /** Item que continua destacado depois da fala ou da entrega: o painel não pode ficar em cima dele. */
  const [spot, setSpot] = useState<HTMLElement | null>(null)
  /** Item que o agente está para tocar ou preencher: o painel sai da frente dele. */
  const [acting, setActing] = useState<HTMLElement | null>(null)
  /** Pergunta que o agente deixou no fim da resposta: a próxima fala da pessoa responde a ela. */
  const [followUp, setFollowUp] = useState<string | null>(null)
  const stepsRef = useRef<string[]>([])
  const followUpRef = useRef<string | null>(null)
  const sessionRef = useRef<CopilotSession | null>(null)
  const cancelledRef = useRef(false)
  const busyRef = useRef(false)
  const nextId = useRef(1)
  const [highlighter] = useState(() => options.overrides?.highlighter ?? createOutlineHighlighter())
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })

  useEffect(() => {
    followUpRef.current = followUp
  }, [followUp])

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
        if (element) {
          highlighter.show(element)
          void latest.current.pointer?.current?.pointAt(element, null, signal)
        }
        return waitFor<boolean>(signal, false, (resolve) => ({ kind: 'confirm', card, element, resolve }), highlighter.clear)
      },
      showMe(request, signal) {
        highlighter.show(request.element)
        void latest.current.pointer?.current?.pointAt(request.element, request.instruction, signal)
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
        setSpot(request.element)
        void latest.current.pointer?.current?.pointAt(request.element, `Aqui é com você: ${request.label}`.slice(0, 120))
      },
      highlight(element, message) {
        highlighter.show(element)
        setSpot(element)
        say('copilot', message)
        void latest.current.pointer?.current?.pointAt(element, message)
      },
      async actOn(request, signal) {
        const pointer = latest.current.pointer?.current
        if (!pointer) return
        setActing(request.element)
        try {
          await pointer.act(request.element, { action: request.kind, text: request.text }, signal)
        } finally {
          setActing(null)
        }
      },
      async scrolled(down, signal) {
        await latest.current.pointer?.current?.scrollHint(down, signal)
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
        stepsRef.current = [...stepsRef.current.slice(-19), text]
        setSteps(stepsRef.current)
      },
    }
  }, [highlighter, say])

  const start = useCallback(
    async (text: string, mode: CopilotMode) => {
      if (busyRef.current || !text.trim()) return
      busyRef.current = true
      cancelledRef.current = false
      highlighter.clear()
      setSpot(null)
      setRunning(true)
      stepsRef.current = []
      setSteps([])
      const answeringTo = followUpRef.current
      setFollowUp(null)
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
        const result = await session.run(answeringTo ? `Você me perguntou: "${answeringTo}". Minha resposta: ${text}` : text)
        say('copilot', result.message)
        // Terminou com uma pergunta: o próximo envio responde a ela, e o painel oferece respostas rápidas.
        if (result.status === 'done' && /\?\s*$/.test(result.message)) setFollowUp(result.message.slice(-240))
      } catch {
        const done = stepsRef.current.filter((step) => /^Estou (?:abrindo|preenchendo|vendo|escolhendo|mostrando)/.test(step)).slice(-2)
        say(
          'copilot',
          `Não consegui terminar agora.${done.length ? ` Até aqui: ${done.map((step) => step.replace(/^Estou /, '').toLowerCase()).join('; ')}.` : ''} A tela continua do jeito que está e você pode seguir tocando nela. Se quiser, tente de novo ou use "Ver os guias passo a passo".`,
        )
      } finally {
        latest.current.pointer?.current?.hide()
        setActing(null)
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
    latest.current.pointer?.current?.hide()
  }, [highlighter])

  useEffect(
    () => () => {
      cancelledRef.current = true
      sessionRef.current?.stop()
      highlighter.clear()
    },
    [highlighter],
  )

  const clearHighlight = useCallback(() => {
    highlighter.clear()
    setSpot(null)
  }, [highlighter])

  return { messages, steps, running, pending, spot, acting, followUp, start, stop, clearHighlight }
}
