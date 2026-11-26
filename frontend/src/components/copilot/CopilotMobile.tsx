/**
 * Celular: bottom sheet de comando (alça, composer acima do teclado, chips) e, ao executar, uma
 * pílula compacta embaixo, acima da barra de navegação, para não cobrir o que o agente toca.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { X } from 'lucide-react'
import { Composer, IdleBody, PendingCard, StepFeed, StopButton } from './CopilotParts'
import { Orb } from './Trigger'
import { PillButton } from './PillButton'
import type { CopilotViewProps } from './copilotView'
import { useAvoidTarget, type Box } from '../../hooks/copilot/useAvoidTarget'
import { useDialogBehavior } from '../../hooks/copilot/useDialogBehavior'
import { useKeyboardInset } from '../../hooks/copilot/useKeyboardInset'

/** Altura ocupada pela barra de navegação de baixo (0 se não houver). */
function useBottomNavHeight(): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const measure = () => {
      const nav = document.querySelector('[data-bottom-nav]')
      const rect = nav?.getBoundingClientRect()
      setHeight(rect && rect.height > 0 && rect.top < window.innerHeight ? Math.round(window.innerHeight - rect.top) : 0)
    }
    measure()
    window.addEventListener('resize', measure)
    const timer = window.setInterval(measure, 800)
    return () => {
      window.removeEventListener('resize', measure)
      window.clearInterval(timer)
    }
  }, [])
  return height
}

function Sheet(view: CopilotViewProps) {
  const ref = useRef<HTMLElement>(null)
  const keyboard = useKeyboardInset()
  const [drag, setDrag] = useState(0)
  const startY = useRef<number | null>(null)
  useDialogBehavior(ref, true, view.close)
  const ready = view.availability === 'ready' && view.consent

  const onDown = (event: ReactPointerEvent<HTMLElement>) => {
    startY.current = event.clientY
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (startY.current !== null) setDrag(Math.max(0, event.clientY - startY.current))
  }
  const onUp = () => {
    if (drag > 90) view.close()
    startY.current = null
    setDrag(0)
  }

  return (
    <div className="wk-scrim fixed inset-0 z-[1]" onMouseDown={(event) => event.target === event.currentTarget && view.close()}>
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Copiloto do Worki"
        className="wk-panel wk-sheet absolute inset-x-0 flex flex-col overflow-hidden !rounded-b-none border-b-0"
        style={{
          bottom: keyboard,
          maxHeight: `min(88dvh, calc(100dvh - ${keyboard}px - 8px))`,
          transform: drag ? `translate3d(0, ${drag}px, 0)` : undefined,
        }}
      >
        <div
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className="touch-none select-none pb-1 pt-2"
          aria-hidden="true"
        >
          <div className="mx-auto h-1.5 w-11 rounded-full bg-[#0f1720]/25" />
        </div>
        <div className="wk-cmd__line !rounded-b-none" aria-hidden="true" />
        <header className="wk-cmd__row">
          <Orb working />
          <h2 className="flex-1 text-[14px] font-bold">Como posso ajudar?</h2>
          <PillButton tone="ghost" aria-label="Fechar o copiloto" onClick={view.close} className="w-11 !px-0">
            <X size={18} aria-hidden="true" />
          </PillButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          <IdleBody view={view} />
        </div>
        {ready && (
          <div className="border-t border-[#e3e6eb] bg-[#fafbfc] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2" style={keyboard ? { paddingBottom: 8 } : undefined}>
            <Composer
              value={view.draft}
              onChange={view.setDraft}
              onSend={view.send}
              autoFocus={false}
              onEmptyEnter={() => view.suggestions[0] && view.send(view.suggestions[0])}
              placeholder={view.agent.followUp ? 'Responda aqui' : 'Como posso ajudar?'}
            />
          </div>
        )}
      </section>
    </div>
  )
}

type Slot = 'bottom' | 'top'
const SLOTS: readonly Slot[] = ['bottom', 'top']

function Working(view: CopilotViewProps) {
  const { agent } = view
  const ref = useRef<HTMLElement>(null)
  const navHeight = useBottomNavHeight()
  const keyboard = useKeyboardInset()
  const pendingElement = agent.pending && agent.pending.kind !== 'ask' ? agent.pending.element : null
  const target = agent.acting ?? pendingElement ?? agent.spot
  const slot = useAvoidTarget<Slot>(target, ref, SLOTS, (candidate, size) => ({
    left: 8,
    top: candidate === 'bottom' ? window.innerHeight - size.height - navHeight - 8 : 64,
    width: size.width,
    height: size.height,
  } satisfies Box))
  const lifted = keyboard ? keyboard + 8 : navHeight ? navHeight + 8 : null
  const style =
    slot === 'bottom'
      ? { bottom: lifted !== null ? `${lifted}px` : 'calc(env(safe-area-inset-bottom) + 8px)' }
      : { top: 'calc(env(safe-area-inset-top) + 60px)' }
  const current = agent.steps.at(-1)

  if (agent.pending) {
    return (
      <section
        ref={ref}
        aria-label="Copiloto aguardando você"
        className="wk-panel wk-rise fixed inset-x-2 z-[1] flex max-h-[62dvh] flex-col gap-3 overflow-y-auto overscroll-contain p-4"
        style={style}
      >
        <PendingCard pending={agent.pending} role={view.role} armDelayMs={view.confirmArmDelayMs} />
        <StopButton onStop={agent.stop} block />
      </section>
    )
  }

  return (
    <section
      ref={ref}
      aria-label="Copiloto trabalhando"
      className="wk-solid wk-pill wk-rise fixed inset-x-2 z-[1] flex items-center"
      style={style}
    >
      <Orb working />
      <div className="min-w-0 flex-1 text-[13px]">
        <StepFeed steps={current ? [current] : []} compact />
      </div>
      <StopButton onStop={agent.stop} />
    </section>
  )
}

function Launcher({ onOpen }: { onOpen: () => void }) {
  return (
    // Aba na borda, no meio da tela (só quando não há a pílula do cabeçalho): um botão no rodapé cobriria a barra de ações.
    <button
      type="button"
      aria-label="Abrir o copiloto"
      onClick={onOpen}
      className="wk-trigger fixed right-0 top-[58%] z-[1] !min-h-14 !w-11 !justify-center !rounded-l-[18px] !rounded-r-none !border-r-0 !p-0"
    >
      <Orb small bare working />
    </button>
  )
}

export function CopilotMobile(view: CopilotViewProps) {
  if (view.agent.running) return <Working {...view} />
  if (view.open) return <Sheet {...view} />
  return view.showLauncher && view.mobileLauncher ? <Launcher onOpen={view.openIt} /> : null
}
