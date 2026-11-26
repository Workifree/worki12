/** Peças que PC e celular compartilham. Nenhuma toca a página: só a interface do copiloto. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { BookOpen, Check, ChevronDown, CornerDownLeft, History, ListChecks, Send, Sparkles } from 'lucide-react'
import { Orb } from './Trigger'
import { PillButton } from './PillButton'
import { ConfirmCardView } from './ConfirmCardView'
import type { ChatItem, Pending } from '../../hooks/copilot/useCopilotAgent'
import { readLog } from '../../lib/copilot/log'
import { containsPII } from '../../lib/copilot/redact'
import type { CopilotRole } from '../../lib/copilot/routes'
import { quickAnswersFor } from '../../lib/copilot/suggestions'
import type { CopilotMode } from '../../lib/copilot/ui'
import type { CopilotViewProps } from './copilotView'

export const NOTICE_ID = 'copilot-aviso-dados'

export { Orb }

/** "Parar" do laboratório (pílula branca, contorno de tinta). O nome acessível segue sendo PARAR. */
export function StopButton({ onStop, block = false }: { onStop: () => void; block?: boolean }) {
  return (
    <button type="button" aria-label="PARAR" onClick={onStop} className={`wk-stop ${block ? 'wk-stop--block' : ''}`}>
      Parar
    </button>
  )
}

export function ModeSwitch({ mode, onChange }: { mode: CopilotMode; onChange: (m: CopilotMode) => void }) {
  const options: Array<[CopilotMode, string]> = [
    ['show', 'Me mostre'],
    ['do', 'Faça pra mim'],
  ]
  return (
    <div role="radiogroup" aria-label="Como o copiloto ajuda" className="wk-seg">
      {options.map(([value, label]) => (
        <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => onChange(value)}>
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
  bare = false,
  onEmptyEnter,
  placeholder = 'Como posso ajudar?',
  autoFocus = true,
  shortcutHint = false,
}: {
  value: string
  onChange: (text: string) => void
  onSend: (text: string) => void
  large?: boolean
  /** Dentro da linha da barra (sem moldura própria, como o laboratório). */
  bare?: boolean
  /** Enter com o campo vazio (a primeira sugestão, destacada na lista). */
  onEmptyEnter?: () => void
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
        className={`flex min-w-0 flex-1 items-center gap-2 ${bare ? 'pr-0' : 'wk-field pl-3 pr-1.5'} ${large ? 'min-h-12' : 'min-h-12'}`}
        onSubmit={(event) => {
          event.preventDefault()
          onSend(value)
        }}
      >
        {!bare && <Sparkles size={large ? 22 : 18} aria-hidden="true" className="shrink-0 text-[#6b7280]" />}
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
              if (!value.trim() && onEmptyEnter) onEmptyEnter()
              else onSend(value)
            }
          }}
          // 16px evita o zoom automático do iOS ao focar.
          className={`min-w-0 flex-1 resize-none border-0 bg-transparent py-3 leading-6 outline-none placeholder:text-[#6b7280] ${large ? 'text-[14px]' : 'text-base'}`}
        />
        {shortcutHint && !value && (
          <kbd className="hidden shrink-0 rounded-md border-[1.5px] border-[#e3e6eb] px-1.5 text-[10.5px] text-[#6b7280] sm:block">Esc</kbd>
        )}
        <button type="submit" aria-label="Enviar pedido" disabled={!value.trim()} className="wk-btn wk-btn--primary inline-flex w-11 shrink-0 items-center justify-center p-0">
          <Send size={18} aria-hidden="true" />
        </button>
      </form>
      <p id={NOTICE_ID} className={`pt-1.5 text-xs text-[#4b5563] ${bare ? '' : 'px-1'}`}>
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

/** Lista de sugestões da barra de comando (laboratório): quadradinho colorido + texto. */
export function CommandList({ items, onPick, label, primary = false }: { items: readonly string[]; onPick: (text: string) => void; label: string; primary?: boolean }) {
  if (!items.length) return null
  return (
    <ul aria-label={label} className="wk-cmd__list -mx-1 !p-0">
      {items.map((item, i) => (
        <li key={item}>
          <button type="button" onClick={() => onPick(item)} className={`wk-cmd__item wk-cmd__item--${i % 3} ${primary && i === 0 ? 'wk-cmd__item--first' : ''}`}>
            <i aria-hidden="true" />
            {item}
            {primary && i === 0 && <small className="ml-auto text-[11.5px] font-medium text-[#6b7280]" aria-hidden="true">↵</small>}
          </button>
        </li>
      ))}
    </ul>
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
            className="wk-btn text-left"
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
        <p role="status" aria-live="polite" className="line-clamp-2 break-words text-[13px] font-semibold leading-snug text-[#0f1720]">
          {short}
        </p>
      ) : (
        <p role="status" aria-live="polite" className="min-w-0 truncate text-[13px] font-semibold text-[#0f1720]">
          <Shimmer key={current} text={current} />
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
            message.from === 'me' ? 'ml-10 bg-[#0f1720] text-white' : 'mr-6 bg-[#eef1f6] text-[#0f1720]'
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
        className="wk-field min-h-12 min-w-0 flex-1 px-4 text-base outline-none"
      />
      <PillButton type="submit" tone="primary">
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

export function ConsentNotice({ onAccept, onGuide }: { role?: CopilotRole; onAccept: () => void; onGuide?: () => void }) {
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
      <PillButton tone="primary" className="w-full" onClick={onAccept}>
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

/** Título de seção da barra: pequeno, em caixa-alta, com uma ação opcional à direita. */
function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-1">
      <div className="flex min-h-6 items-center justify-between px-1">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-[#6b7280]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Linha de ajuda (guia, passos, atividade): ícone na caixinha do laboratório + texto + detalhe. */
function HelpRow({ icon, title, detail, onClick, expanded }: { icon: ReactNode; title: string; detail?: string; onClick: () => void; expanded?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={expanded} className="wk-cmd__item wk-cmd__item--plain">
      <i aria-hidden="true">{icon}</i>
      <span className="min-w-0 flex-1">
        <span className="block">{title}</span>
        {detail && <span className="block text-[11.5px] font-medium text-[#6b7280]">{detail}</span>}
      </span>
      {expanded !== undefined && <ChevronDown size={16} aria-hidden="true" className={`shrink-0 text-[#6b7280] transition-transform ${expanded ? 'rotate-180' : ''}`} />}
    </button>
  )
}

/**
 * Corpo do "pronto para pedir", do mais usado ao menos usado (igual em PC e celular):
 * 1. conversa em andamento (se houver) e respostas rápidas; 2. como o copiloto ajuda (Me mostre/Faça pra mim);
 * 3. Sugestões e Recentes; 4. Ajuda (guias e passos da última tarefa); 5. Atividade neste aparelho, discreta no fim.
 */
export function IdleBody({ view, children }: { view: CopilotViewProps; children?: ReactNode }) {
  const { agent, availability, consent } = view
  const [showSteps, setShowSteps] = useState(false)
  const closeThen = (fn?: () => void) => () => {
    view.close()
    fn?.()
  }
  if (availability === 'checking') return <p role="status" className="text-sm text-[#4b5563]">Carregando...</p>
  if (availability === 'unavailable') {
    return <Unavailable onGuide={view.onOpenGuide && closeThen(view.onOpenGuide)} onHelp={closeThen(() => view.navigate('/ajuda'))} />
  }
  if (!consent) {
    return <ConsentNotice role={view.role} onAccept={view.accept} onGuide={view.onOpenGuide && closeThen(view.onOpenGuide)} />
  }
  const hasChat = agent.messages.length > 0
  const hasSteps = agent.steps.length > 0
  return (
    <div className="space-y-4">
      {children}
      {hasChat && <ChatLog messages={agent.messages} />}
      {agent.followUp && <Chips items={quickAnswersFor(agent.followUp)} onPick={view.send} label="Respostas rápidas" />}

      <div className="space-y-1.5">
        <ModeSwitch mode={view.mode} onChange={view.setMode} />
        <p className="px-1 text-[11.5px] text-[#6b7280]">
          {view.mode === 'show' ? 'Eu mostro na tela e você toca.' : 'Eu navego e preencho. Antes de gravar ou enviar, peço sua confirmação.'}
        </p>
      </div>

      {!hasChat && (
        <>
          <Section title="Sugestões">
            <CommandList primary items={view.suggestions} onPick={view.send} label="Sugestões de pedido" />
          </Section>
          {view.history.length > 0 && (
            <Section
              title="Recentes"
              action={
                <button type="button" aria-label="Limpar histórico" onClick={view.forgetHistory} className="min-h-6 px-1 text-[11.5px] font-semibold text-[#6b7280] underline hover:text-[#0f1720]">
                  Limpar
                </button>
              }
            >
              <CommandList items={view.history} onPick={view.send} label="Pedidos recentes" />
            </Section>
          )}
        </>
      )}

      <Section title="Ajuda">
        <div className="grid gap-0.5">
          {view.onOpenGuide && (
            <HelpRow
              icon={<BookOpen size={13} />}
              title="Guias passo a passo"
              detail="Mostram onde fica cada coisa, sem IA"
              onClick={closeThen(view.onOpenGuide)}
            />
          )}
          {hasSteps && (
            <HelpRow
              icon={<ListChecks size={13} />}
              title="Passos da última tarefa"
              detail={`${agent.steps.length} ${agent.steps.length === 1 ? 'passo' : 'passos'}`}
              expanded={showSteps}
              onClick={() => setShowSteps((v) => !v)}
            />
          )}
        </div>
        {hasSteps && showSteps && (
          <ol className="ml-[42px] list-decimal space-y-1 pb-1 pl-4 text-[12.5px] text-[#4b5563]">
            {agent.steps.map((step, i) => (
              <li key={i} className="break-words">{step}</li>
            ))}
          </ol>
        )}
      </Section>

      <div className="border-t border-[#e3e6eb] pt-1">
        <HelpRow
          icon={<History size={13} />}
          title="Atividade neste aparelho"
          detail="O que o copiloto fez aqui"
          expanded={view.showLog}
          onClick={() => view.setShowLog(!view.showLog)}
        />
        {view.showLog && (
          <ul className="ml-[42px] space-y-1 pb-1 text-[12px] text-[#4b5563]">
            {readLog().slice(-20).length === 0 && <li>Nada ainda.</li>}
            {readLog().slice(-20).map((entry, i) => (
              <li key={i} className="break-words">
                <span className="tabular-nums text-[#6b7280]">{new Date(entry.at).toLocaleTimeString('pt-BR')}</span> · {entry.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
