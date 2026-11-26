/** Peças que PC e celular compartilham. Nenhuma toca a página: só a interface do copiloto. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Check, CornerDownLeft, OctagonX, Send, Sparkles } from 'lucide-react'
import { PillButton } from './PillButton'
import { IconButton } from '../ui/IconButton'
import { ConfirmCardView } from './ConfirmCardView'
import type { ChatItem, Pending } from '../../hooks/copilot/useCopilotAgent'
import { readLog } from '../../lib/copilot/log'
import { containsPII } from '../../lib/copilot/redact'
import type { CopilotRole } from '../../lib/copilot/routes'
import { quickAnswersFor } from '../../lib/copilot/suggestions'
import type { CopilotMode } from '../../lib/copilot/ui'
import type { CopilotViewProps } from './copilotView'

export const NOTICE_ID = 'copilot-aviso-dados'

/** Bolinha do copiloto: gira enquanto trabalha. */
export function Orb({ working = false }: { working?: boolean }) {
  return (
    <span className={`wk-orb ${working ? '' : 'wk-orb--idle'}`} aria-hidden="true">
      <Sparkles size={14} className="text-gray-800" />
    </span>
  )
}

export function StopButton({ onStop, className = '' }: { onStop: () => void; className?: string }) {
  return (
    <PillButton tone="danger" onClick={onStop} icon={<OctagonX size={20} aria-hidden="true" />} className={`shrink-0 tracking-wide ${className}`}>
      PARAR
    </PillButton>
  )
}

export function ModeSwitch({ mode, onChange }: { mode: CopilotMode; onChange: (m: CopilotMode) => void }) {
  const options: Array<[CopilotMode, string]> = [
    ['show', 'Me mostre'],
    ['do', 'Faça pra mim'],
  ]
  return (
    <div role="radiogroup" aria-label="Como o copiloto ajuda" className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          onClick={() => onChange(value)}
          className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black ${
            mode === value ? 'bg-black text-white shadow-sm' : 'text-gray-700 hover:bg-white'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** Campo de pedido. O aviso de dados pessoais fica COLADO nele (e avisa se a pessoa digitar um). */
export function Composer({
  value,
  onChange,
  onSend,
  large = false,
  placeholder = 'Como posso ajudar?',
  autoFocus = true,
  shortcutHint = false,
}: {
  value: string
  onChange: (text: string) => void
  onSend: (text: string) => void
  large?: boolean
  placeholder?: string
  autoFocus?: boolean
  shortcutHint?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true })
  }, [autoFocus])
  const pii = value.length > 5 && containsPII(value)
  return (
    <div>
      <form
        className={`flex items-center gap-2 rounded-xl bg-white pl-4 pr-1.5 ring-1 ring-black/15 focus-within:ring-2 focus-within:ring-black ${large ? 'min-h-14' : 'min-h-12'}`}
        onSubmit={(event) => {
          event.preventDefault()
          onSend(value)
        }}
      >
        <Sparkles size={large ? 22 : 18} aria-hidden="true" className="shrink-0 text-gray-500" />
        <textarea
          ref={ref}
          aria-label="Como posso ajudar?"
          aria-describedby={NOTICE_ID}
          placeholder={placeholder}
          rows={1}
          maxLength={600}
          value={value}
          enterKeyHint="send"
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              onSend(value)
            }
          }}
          // 16px evita o zoom automático do iOS ao focar.
          className={`min-w-0 flex-1 resize-none border-0 bg-transparent py-3 leading-6 outline-none placeholder:text-gray-500 ${large ? 'text-lg' : 'text-base'}`}
        />
        {shortcutHint && !value && (
          <kbd className="hidden shrink-0 rounded-md border border-gray-300 px-1.5 py-0.5 text-xs font-semibold text-gray-600 sm:block">Esc</kbd>
        )}
        <IconButton aria-label="Enviar pedido" variant="secondary" type="submit" disabled={!value.trim()} className="border-0 bg-black text-white enabled:hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-500">
          <Send size={20} />
        </IconButton>
      </form>
      <p id={NOTICE_ID} className="px-4 pt-1.5 text-xs text-gray-600">
        Não digite CPF, senha, chave PIX, telefone ou outros dados pessoais.
      </p>
      {pii && (
        <p role="status" className="mx-4 mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
          Isto parece um dado pessoal. Ele é escondido antes do envio, mas prefira não digitar.
        </p>
      )}
    </div>
  )
}

export function Chips({ items, onPick, label }: { items: readonly string[]; onPick: (text: string) => void; label: string }) {
  if (!items.length) return null
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item}>
          <button
            type="button"
            onClick={() => onPick(item)}
            className="min-h-11 rounded-xl border border-black/15 bg-white px-4 text-left text-sm font-semibold text-black hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
          >
            {item}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Texto do passo com brilho que passa (janela deslizante, só transform). A cópia que brilha é decorativa. */
function Shimmer({ text }: { text: string }) {
  const outer = useRef<HTMLSpanElement>(null)
  const inner = useRef<HTMLSpanElement>(null)
  // A largura do texto vai direto para o CSS (sem estado: nada de render a mais).
  useLayoutEffect(() => {
    outer.current?.style.setProperty('--w', `${inner.current?.offsetWidth ?? 0}px`)
  }, [text])
  return (
    <span ref={outer} className="wk-shim">
      <span ref={inner}>{text}</span>
      <span className="wk-shim__win" aria-hidden="true">
        <span className="wk-shim__txt">{text}</span>
      </span>
    </span>
  )
}

/** Passo a passo ao vivo: o atual em destaque, os anteriores apagados. */
export function StepFeed({ steps, compact = false }: { steps: string[]; compact?: boolean }) {
  const current = steps.at(-1) ?? 'Olhando a tela'
  const before = steps.slice(-4, -1)
  // Na pílula do celular o texto é curto ("Preenchendo ...") e pode usar duas linhas; sem brilho (ele pede uma linha só).
  const short = current.replace(/^Estou /, '').replace(/^./, (c) => c.toUpperCase())
  return (
    <div>
      {compact ? (
        <p role="status" aria-live="polite" className="line-clamp-2 break-words text-sm font-semibold leading-snug text-black">
          {short}
        </p>
      ) : (
        <p role="status" aria-live="polite" className="min-w-0 truncate text-sm font-semibold text-black">
          <Shimmer text={current} />
        </p>
      )}
      {!compact && before.length > 0 && (
        <ol className="mt-2 space-y-1 text-xs text-gray-600" aria-label="Passos anteriores">
          {before.map((step, i) => (
            <li key={`${i}-${step}`} className="flex items-start gap-1.5 break-words">
              <Check size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-green-700" />
              {step.replace(/^Estou /, '')}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export function ChatLog({ messages }: { messages: ChatItem[] }) {
  return (
    <ul aria-live="polite" className="space-y-2">
      {messages.map((message) => (
        <li
          key={message.id}
          className={`break-words rounded-2xl px-3.5 py-2.5 text-sm leading-snug ${
            message.from === 'me' ? 'ml-10 bg-black text-white' : 'mr-6 bg-gray-100 text-black'
          }`}
        >
          <span className="sr-only">{message.from === 'me' ? 'Você: ' : 'Copiloto: '}</span>
          {message.text}
        </li>
      ))}
    </ul>
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
        aria-describedby={NOTICE_ID}
        value={answer}
        maxLength={300}
        autoFocus
        autoComplete="off"
        placeholder="Escreva sua resposta"
        onChange={(event) => setAnswer(event.target.value)}
        className="min-h-12 min-w-0 flex-1 rounded-xl border-0 bg-white px-4 text-base ring-1 ring-black/15 focus:outline-none focus:ring-2 focus:ring-black"
      />
      <PillButton type="submit" tone="dark">
        Responder
      </PillButton>
    </form>
  )
}

/** O que o agente espera da pessoa: confirmar, tocar ou responder. */
export function PendingCard({ pending, role, armDelayMs }: { pending: Pending; role: CopilotRole; armDelayMs?: number }) {
  if (pending.kind === 'confirm') {
    return <ConfirmCardView card={pending.card} role={role} armDelayMs={armDelayMs} onAnswer={pending.resolve} />
  }
  if (pending.kind === 'show') {
    return (
      <div className="space-y-3">
        <p className="break-words text-sm font-semibold">{pending.instruction}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <PillButton tone="ghost" onClick={() => pending.resolve('skip')}>
            Pular e encerrar
          </PillButton>
          <PillButton tone="light" onClick={() => pending.resolve('done')}>
            Já fiz
          </PillButton>
        </div>
      </div>
    )
  }
  const quick = quickAnswersFor(pending.question)
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 text-xs font-bold uppercase tracking-wide text-gray-600">
        <CornerDownLeft size={14} aria-hidden="true" className="mt-0.5" /> O copiloto precisa saber
      </p>
      <p className="break-words text-base font-semibold leading-snug">{pending.question}</p>
      <Chips items={[...quick, 'Deixa para lá']} onPick={pending.resolve} label="Respostas rápidas" />
      <AskForm onAnswer={pending.resolve} />
    </div>
  )
}

export function ConsentNotice({ role, onAccept, onGuide }: { role: CopilotRole; onAccept: () => void; onGuide?: () => void }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-base font-bold">Antes de começar</p>
      {/* TEXTO LEGAL: marcado para revisão jurídica antes de qualquer abertura geral (LGPD, transferência internacional). */}
      <p data-legal-review="copilot-consent">
        Para ajudar, enviamos o texto do seu pedido e os nomes dos botões e campos da tela, já sem dados
        pessoais, a um serviço de inteligência artificial de outra empresa (OpenRouter e os provedores de
        modelo que ele usa, que podem processar no exterior, inclusive nos EUA). CPF, CNPJ, telefone, e-mail,
        chave PIX e senhas são escondidos antes do envio, e textos como nomes e mensagens são ocultados. Não
        escreva dados pessoais no pedido.
      </p>
      <p>O Copiloto não paga, não exclui, não aceita convites e não registra presença: isso é só seu.</p>
      <PillButton tone={role === 'company' ? 'dark' : 'green'} className="w-full" onClick={onAccept}>
        Entendi, quero usar
      </PillButton>
      {onGuide && (
        <PillButton tone="ghost" className="w-full" onClick={onGuide}>
          Prefiro só o guia
        </PillButton>
      )}
    </div>
  )
}

export function Unavailable({ onGuide, onHelp }: { onGuide?: () => void; onHelp: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm">
        O Copiloto não está disponível agora. O app funciona normalmente, e o guia continua
        mostrando onde fica cada coisa.
      </p>
      {onGuide ? (
        <PillButton tone="light" className="w-full" onClick={onGuide}>
          Abrir o guia
        </PillButton>
      ) : (
        <PillButton tone="light" className="w-full" onClick={onHelp}>
          Abrir a Ajuda
        </PillButton>
      )}
    </div>
  )
}

/** Corpo do "pronto para pedir": modos, sugestões, histórico, conversa e rodapé. Igual em PC e celular. */
export function IdleBody({ view, children }: { view: CopilotViewProps; children?: ReactNode }) {
  const { agent, availability, consent } = view
  const closeThen = (fn?: () => void) => () => {
    view.close()
    fn?.()
  }
  if (availability === 'checking') return <p role="status" className="text-sm text-gray-600">Carregando...</p>
  if (availability === 'unavailable') {
    return <Unavailable onGuide={view.onOpenGuide && closeThen(view.onOpenGuide)} onHelp={closeThen(() => view.navigate('/ajuda'))} />
  }
  if (!consent) {
    return <ConsentNotice role={view.role} onAccept={view.accept} onGuide={view.onOpenGuide && closeThen(view.onOpenGuide)} />
  }
  const hasChat = agent.messages.length > 0
  return (
    <div className="space-y-4">
      {children}
      <ModeSwitch mode={view.mode} onChange={view.setMode} />
      <p className="text-xs text-gray-600">
        {view.mode === 'show' ? 'Eu mostro na tela e você toca.' : 'Eu navego e preencho. Antes de gravar ou enviar, peço sua confirmação.'}
      </p>
      {hasChat ? (
        <ChatLog messages={agent.messages} />
      ) : (
        <>
          <Chips items={view.suggestions} onPick={view.send} label="Sugestões de pedido" />
          {view.history.length > 0 && (
            <section aria-label="Pedidos recentes" className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wide text-gray-600">Recentes</h3>
                <button type="button" onClick={view.forgetHistory} className="min-h-11 px-2 text-xs font-semibold text-gray-600 underline">
                  Limpar
                </button>
              </div>
              <Chips items={view.history} onPick={view.send} label="Pedidos recentes" />
            </section>
          )}
        </>
      )}
      {agent.followUp && <Chips items={quickAnswersFor(agent.followUp)} onPick={view.send} label="Respostas rápidas" />}
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
      <div className="flex flex-wrap gap-x-4">
        {view.onOpenGuide && (
          <PillButton tone="ghost" className="justify-start px-2" onClick={closeThen(view.onOpenGuide)}>
            Ver os guias passo a passo
          </PillButton>
        )}
        <button
          type="button"
          aria-expanded={view.showLog}
          onClick={() => view.setShowLog(!view.showLog)}
          className="min-h-11 text-sm font-semibold underline"
        >
          O que o copiloto fez neste aparelho
        </button>
      </div>
      {view.showLog && (
        <ul className="space-y-1 text-xs text-gray-600">
          {readLog().slice(-20).map((entry, i) => (
            <li key={i} className="break-words">
              {new Date(entry.at).toLocaleTimeString('pt-BR')} - {entry.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
