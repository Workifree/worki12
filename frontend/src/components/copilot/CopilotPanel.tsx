/**
 * Interface do copiloto, em pt-BR. Não usa o painel do page-agent (só en/zh, e ficaria inerte
 * com um modal aberto).
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { OctagonX, Send, Sparkles, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { ConfirmCardView } from './ConfirmCardView'
import { useCopilotAgent, type AgentOverrides, type Pending } from '../../hooks/copilot/useCopilotAgent'
import { useKeyboardInset } from '../../hooks/copilot/useKeyboardInset'
import { useTopLayerHost } from '../../hooks/copilot/useTopLayerHost'
import { readLog } from '../../lib/copilot/log'
import type { CopilotRole } from '../../lib/copilot/routes'
import type { CopilotMode } from '../../lib/copilot/ui'

export const OPEN_EVENT = 'worki:copilot:open'
const CONSENT_KEY = 'worki:copilot:aviso-v1'

export interface CopilotServices {
  checkAvailability: () => Promise<boolean>
  createLlmFetch: (role: CopilotRole) => typeof fetch
}

export interface CopilotPanelProps {
  role: CopilotRole
  navigate: (path: string) => void
  services: CopilotServices
  /** Abre o guia sem IA (lib/guide). Sem isto, o modo guia aponta para a Ajuda. */
  onOpenGuide?: () => void
  /** `false`: sem a aba lateral; abra com `window.dispatchEvent(new Event(OPEN_EVENT))`. */
  showLauncher?: boolean
  confirmArmDelayMs?: number
  overrides?: AgentOverrides
}

const SUGGESTIONS: Record<CopilotRole, string[]> = {
  company: ['Me ajude a criar um turno', 'Como chamo freelas para um turno?', 'Onde vejo meu elenco?'],
  worker: ['Tenho algum convite?', 'Onde vejo meus recebimentos?', 'Como mudo minha disponibilidade?'],
}

function readConsent(): boolean {
  try {
    return window.localStorage.getItem(CONSENT_KEY) === 'sim'
  } catch {
    return false
  }
}

function StopButton({ onStop }: { onStop: () => void }) {
  return (
    <Button variant="danger" onClick={onStop} iconLeft={<OctagonX size={20} aria-hidden="true" />} className="shrink-0">
      PARAR
    </Button>
  )
}

function ModeSwitch({ mode, onChange }: { mode: CopilotMode; onChange: (m: CopilotMode) => void }) {
  const options: Array<[CopilotMode, string]> = [
    ['show', 'Me mostre'],
    ['do', 'Faça pra mim'],
  ]
  return (
    <div role="radiogroup" aria-label="Como o copiloto ajuda" className="grid grid-cols-2 gap-1 rounded-xl border-2 border-black p-1">
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          onClick={() => onChange(value)}
          className={`min-h-11 rounded-lg px-2 text-sm font-bold ${mode === value ? 'bg-black text-white' : 'bg-white text-black'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function AskForm({ onAnswer }: { onAnswer: (text: string) => void }) {
  const [answer, setAnswer] = useState('')
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (answer.trim()) onAnswer(answer.trim())
      }}
    >
      <input
        aria-label="Sua resposta ao copiloto"
        value={answer}
        maxLength={300}
        onChange={(event) => setAnswer(event.target.value)}
        className="min-h-11 min-w-0 flex-1 rounded-xl border-2 border-black px-3 text-base"
      />
      <Button type="submit" variant="dark">
        Responder
      </Button>
    </form>
  )
}

/** Cartões que aparecem durante a tarefa: ficam do lado oposto ao item destacado. */
function placementFor(pending: Pending | null): 'top' | 'bottom' {
  if (pending?.kind !== 'show') return 'bottom'
  const rect = pending.element.getBoundingClientRect()
  return rect.top > window.innerHeight / 2 ? 'top' : 'bottom'
}

export default function CopilotPanel({
  role,
  navigate,
  services,
  onOpenGuide,
  showLauncher = true,
  confirmArmDelayMs,
  overrides,
}: CopilotPanelProps) {
  const host = useTopLayerHost()
  const keyboard = useKeyboardInset()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<CopilotMode>('show')
  const [draft, setDraft] = useState('')
  const [consent, setConsent] = useState(readConsent)
  const [availability, setAvailability] = useState<'checking' | 'ready' | 'unavailable'>('checking')
  const [showLog, setShowLog] = useState(false)
  const agent = useCopilotAgent({ role, navigate, createLlmFetch: services.createLlmFetch, overrides })
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])

  const { checkAvailability } = services
  useEffect(() => {
    if (!open) return
    let alive = true
    checkAvailability()
      .then((ok) => alive && setAvailability(ok ? 'ready' : 'unavailable'))
      .catch(() => alive && setAvailability('unavailable'))
    return () => {
      alive = false
    }
  }, [open, checkAvailability])

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [agent.messages.length])

  const accept = () => {
    setConsent(true)
    try {
      window.localStorage.setItem(CONSENT_KEY, 'sim')
    } catch {
      // vale só para esta visita
    }
  }

  const send = (text: string) => {
    if (!text.trim() || agent.running) return
    setDraft('')
    void agent.start(text, mode)
  }

  const close = () => {
    agent.clearHighlight()
    setOpen(false)
  }

  const bottomStyle = { bottom: keyboard ? `${keyboard}px` : undefined }
  const sheet =
    'fixed inset-x-0 bottom-0 flex max-h-[75dvh] flex-col rounded-t-2xl border-2 border-black bg-white text-black shadow-brutal-lg ' +
    'pb-[env(safe-area-inset-bottom)] sm:inset-x-auto sm:right-4 sm:w-[25rem] sm:rounded-2xl sm:mb-4'

  let body: React.ReactNode = null

  if (agent.running) {
    const placement = placementFor(agent.pending)
    const current = agent.steps.at(-1) ?? 'Olhando a tela'
    body = (
      <>
        <div className="fixed inset-x-2 top-2 flex items-center gap-2 rounded-2xl border-2 border-black bg-white p-2 pl-3 text-black shadow-brutal pt-[max(0.5rem,env(safe-area-inset-top))] sm:inset-x-auto sm:right-4 sm:w-[25rem]">
          <p role="status" aria-live="polite" className="min-w-0 flex-1 break-words text-sm font-semibold">
            {current}...
          </p>
          <StopButton onStop={agent.stop} />
        </div>
        {agent.pending && (
          <div
            className={`fixed inset-x-2 max-h-[65dvh] overflow-y-auto rounded-2xl border-2 border-black bg-white p-4 text-black shadow-brutal-lg sm:inset-x-auto sm:right-4 sm:w-[25rem] ${
              placement === 'top' ? 'top-24' : 'bottom-2 mb-[env(safe-area-inset-bottom)]'
            }`}
            style={placement === 'bottom' && keyboard ? { bottom: `${keyboard + 8}px` } : undefined}
          >
            {agent.pending.kind === 'confirm' && (
              <ConfirmCardView
                card={agent.pending.card}
                role={role}
                armDelayMs={confirmArmDelayMs}
                onAnswer={agent.pending.resolve}
              />
            )}
            {agent.pending.kind === 'show' && (
              <div className="space-y-3">
                <p className="break-words text-sm font-semibold">{agent.pending.instruction}</p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={() => agent.pending?.kind === 'show' && agent.pending.resolve('skip')}>
                    Pular e encerrar
                  </Button>
                  <Button variant="secondary" onClick={() => agent.pending?.kind === 'show' && agent.pending.resolve('done')}>
                    Já fiz
                  </Button>
                </div>
              </div>
            )}
            {agent.pending.kind === 'ask' && (
              <div className="space-y-3">
                <p className="break-words text-sm font-semibold">{agent.pending.question}</p>
                <AskForm onAnswer={agent.pending.resolve} />
              </div>
            )}
          </div>
        )}
      </>
    )
  } else if (open) {
    body = (
      <section aria-label="Copiloto do Worki" className={sheet} style={bottomStyle}>
        <header className="flex items-center justify-between gap-2 border-b-2 border-black py-2 pl-4 pr-2">
          <h2 className="text-lg font-bold">Copiloto</h2>
          <IconButton aria-label="Fechar o copiloto" onClick={close}>
            <X size={20} />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
          {availability === 'checking' && <p role="status" className="text-sm text-gray-600">Carregando...</p>}

          {availability === 'unavailable' && (
            <div className="space-y-3">
              <p className="text-sm">
                O assistente automático não está disponível agora. O app funciona normalmente, e o guia continua
                mostrando onde fica cada coisa.
              </p>
              {onOpenGuide ? (
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={() => {
                    close()
                    onOpenGuide()
                  }}
                >
                  Abrir o guia
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={() => {
                    close()
                    navigate('/ajuda')
                  }}
                >
                  Abrir a Ajuda
                </Button>
              )}
            </div>
          )}

          {availability === 'ready' && !consent && (
            <div className="space-y-3 text-sm">
              <p className="font-semibold">Antes de começar</p>
              <p>
                Para ajudar, o que você escrever aqui e os botões e campos da tela são enviados a um serviço de
                inteligência artificial de outra empresa. CPF, CNPJ, telefone, e-mail, chave PIX e senhas são
                escondidos antes do envio, e textos como nomes e mensagens são ocultados. Não escreva dados
                pessoais no pedido.
              </p>
              <p>O copiloto não paga, não exclui, não aceita convites e não registra presença: isso é só seu.</p>
              <Button variant={role === 'company' ? 'dark' : 'primary'} fullWidth onClick={accept}>
                Entendi, quero usar
              </Button>
              {onOpenGuide && (
                <Button
                  variant="ghost"
                  fullWidth
                  onClick={() => {
                    close()
                    onOpenGuide()
                  }}
                >
                  Prefiro só o guia
                </Button>
              )}
            </div>
          )}

          {availability === 'ready' && consent && (
            <>
              <ModeSwitch mode={mode} onChange={setMode} />
              <p className="text-xs text-gray-600">
                {mode === 'show'
                  ? 'Eu mostro na tela e você toca.'
                  : 'Eu navego e preencho. Antes de gravar ou enviar, peço sua confirmação.'}
              </p>
              {agent.messages.length === 0 ? (
                <ul className="space-y-2">
                  {SUGGESTIONS[role].map((suggestion) => (
                    <li key={suggestion}>
                      <Button variant="secondary" fullWidth onClick={() => send(suggestion)}>
                        {suggestion}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul aria-live="polite" className="space-y-2">
                  {agent.messages.map((message) => (
                    <li
                      key={message.id}
                      className={`break-words rounded-xl border-2 px-3 py-2 text-sm ${
                        message.from === 'me' ? 'ml-8 border-black bg-gray-100' : 'mr-8 border-black bg-white'
                      }`}
                    >
                      <span className="sr-only">{message.from === 'me' ? 'Você: ' : 'Copiloto: '}</span>
                      {message.text}
                    </li>
                  ))}
                </ul>
              )}
              {agent.steps.length > 0 && (
                <details className="text-sm">
                  <summary className="min-h-11 cursor-pointer py-3 font-semibold">Passo a passo da última tarefa</summary>
                  <ol className="list-decimal space-y-1 pl-5 text-gray-600">
                    {agent.steps.map((step, i) => (
                      <li key={i} className="break-words">{step}</li>
                    ))}
                  </ol>
                </details>
              )}
              <button
                type="button"
                aria-expanded={showLog}
                onClick={() => setShowLog((v) => !v)}
                className="min-h-11 text-sm font-semibold underline"
              >
                O que o copiloto fez neste aparelho
              </button>
              {showLog && (
                <ul className="space-y-1 text-xs text-gray-600">
                  {readLog().slice(-20).map((entry, i) => (
                    <li key={i} className="break-words">
                      {new Date(entry.at).toLocaleTimeString('pt-BR')} - {entry.text}
                    </li>
                  ))}
                </ul>
              )}
              <div ref={endRef} />
            </>
          )}
        </div>
        {availability === 'ready' && consent && (
          <form
            className="flex items-end gap-2 border-t-2 border-black p-3"
            onSubmit={(event) => {
              event.preventDefault()
              send(draft)
            }}
          >
            <textarea
              aria-label="O que você precisa?"
              placeholder="O que você precisa?"
              rows={1}
              maxLength={600}
              value={draft}
              enterKeyHint="send"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  send(draft)
                }
              }}
              // 16px evita o zoom automático do iOS ao focar.
              className="max-h-28 min-h-11 min-w-0 flex-1 resize-none rounded-xl border-2 border-black px-3 py-2 text-base"
            />
            <IconButton aria-label="Enviar pedido" variant="secondary" type="submit" disabled={!draft.trim()}>
              <Send size={20} />
            </IconButton>
          </form>
        )}
      </section>
    )
  } else if (showLauncher) {
    body = (
      // Aba na borda, no meio da tela: um botão flutuante no rodapé cobriria a ActionBar.
      <button
        type="button"
        aria-label="Abrir o copiloto"
        onClick={() => setOpen(true)}
        className="fixed right-0 top-[58%] flex h-14 w-11 items-center justify-center rounded-l-xl border-2 border-r-0 border-black bg-white text-black shadow-brutal-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
      >
        <Sparkles size={22} aria-hidden="true" />
      </button>
    )
  }

  return createPortal(body, host)
}
