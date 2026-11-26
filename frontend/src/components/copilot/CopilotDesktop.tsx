/** Computador: barra de comando no centro e, ao executar, painel flutuante (arrastável, minimizável). */
import { useEffect, useRef, useState } from 'react'
import { Minus, Sparkles, Square, X } from 'lucide-react'
import { IconButton } from '../ui/IconButton'
import { Composer, IdleBody, Orb, PendingCard, StepFeed, StopButton } from './CopilotParts'
import type { CopilotViewProps } from './copilotView'
import { useAvoidTarget, type Box } from '../../hooks/copilot/useAvoidTarget'
import { useDialogBehavior } from '../../hooks/copilot/useDialogBehavior'
import { useDraggable } from '../../hooks/copilot/useDraggable'

type Corner = 'br' | 'bl' | 'tr' | 'tl'
const CORNERS: readonly Corner[] = ['br', 'bl', 'tr', 'tl']
const EDGE = 24
const TOP_EDGE = 72

function cornerBox(corner: Corner, size: { width: number; height: number }): Box {
  const left = corner.endsWith('r') ? window.innerWidth - size.width - EDGE : EDGE
  const top = corner.startsWith('b') ? window.innerHeight - size.height - EDGE : TOP_EDGE
  return { left, top, ...size }
}

const CORNER_CLASS: Record<Corner, string> = {
  br: 'bottom-6 right-6',
  bl: 'bottom-6 left-6',
  tr: 'right-6 top-[72px]',
  tl: 'left-6 top-[72px]',
}

function Palette(view: CopilotViewProps) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogBehavior(ref, true, view.close)
  const ready = view.availability === 'ready' && view.consent
  return (
    <div
      className="fixed inset-0 z-[1] flex items-center justify-center bg-black/25 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) view.close()
      }}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Copiloto do Worki"
        data-copilot-palette=""
        className="wk-glass wk-rise flex max-h-[min(82dvh,720px)] w-[min(680px,100%)] flex-col overflow-hidden rounded-[28px] text-black"
      >
        <header className="flex items-center gap-2 px-5 pb-1 pt-4">
          <Orb />
          <h2 className="flex-1 text-sm font-bold">Copiloto do Worki</h2>
          <IconButton aria-label="Fechar o copiloto" onClick={view.close} className="rounded-full">
            <X size={20} />
          </IconButton>
        </header>
        {ready && (
          <div className="px-4 pb-3 pt-1">
            <Composer
              large
              value={view.draft}
              onChange={view.setDraft}
              onSend={view.send}
              placeholder={view.agent.followUp ? 'Responda aqui' : 'Como posso ajudar?'}
              shortcutHint
            />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-1">
          <IdleBody view={view} />
        </div>
        {ready && (
          <p className="border-t border-black/10 px-5 py-2 text-xs text-gray-600">
            <kbd className="font-semibold">Esc</kbd> fecha · <kbd className="font-semibold">Ctrl K</kbd> abre de qualquer tela
          </p>
        )}
      </section>
    </div>
  )
}

function Working(view: CopilotViewProps) {
  const { agent } = view
  const panel = useRef<HTMLElement>(null)
  const [minimized, setMinimized] = useState(false)
  const drag = useDraggable(panel)
  const pendingElement = agent.pending && agent.pending.kind !== 'ask' ? agent.pending.element : null
  const target = agent.acting ?? pendingElement ?? agent.spot
  const corner = useAvoidTarget(target, panel, CORNERS, cornerBox)
  const needsPerson = !!agent.pending

  // Pedido de confirmação, de toque ou pergunta: o painel abre sozinho.
  if (needsPerson && minimized) setMinimized(false)

  // Esc para a tarefa: atalho de quem não está com o mouse na mão.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && event.isTrusted) agent.stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [agent])

  const current = agent.steps.at(-1) ?? 'Olhando a tela'

  if (minimized && !needsPerson) {
    return (
      <section
        aria-label="Copiloto trabalhando"
        className="wk-glass wk-rise fixed bottom-6 left-1/2 z-[1] flex w-[min(520px,calc(100vw-32px))] -translate-x-1/2 items-center gap-3 rounded-full py-2 pl-3 pr-2 text-black"
      >
        <Orb working />
        <p role="status" aria-live="polite" className="min-w-0 flex-1 truncate text-sm font-semibold">
          {current}
        </p>
        <IconButton aria-label="Expandir o painel do copiloto" onClick={() => setMinimized(false)} className="rounded-full">
          <Square size={16} />
        </IconButton>
        <StopButton onStop={agent.stop} />
      </section>
    )
  }

  return (
    <section
      ref={panel}
      aria-label="Copiloto trabalhando"
      className={`wk-glass wk-rise fixed z-[1] flex max-h-[calc(100dvh-96px)] w-[min(400px,calc(100vw-32px))] flex-col overflow-hidden rounded-[28px] text-black ${CORNER_CLASS[corner]}`}
      style={{ transform: `translate3d(${drag.offset.x}px, ${drag.offset.y}px, 0)` }}
    >
      <header
        {...drag.handleProps}
        className="flex cursor-grab touch-none select-none items-center gap-2 px-4 pb-1 pt-3 active:cursor-grabbing"
        title="Arraste para mover"
      >
        <Orb working />
        <h2 className="flex-1 text-sm font-bold">Copiloto trabalhando</h2>
        <IconButton aria-label="Minimizar o painel do copiloto" onClick={() => setMinimized(true)} disabled={needsPerson} className="rounded-full">
          <Minus size={18} />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-2 pt-1">
        <StepFeed steps={agent.steps} />
        {agent.pending && (
          <div className="rounded-2xl bg-white/80 p-3 ring-1 ring-black/10">
            <PendingCard pending={agent.pending} role={view.role} armDelayMs={view.confirmArmDelayMs} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 px-4 pb-4 pt-2">
        <StopButton onStop={agent.stop} className="flex-1" />
        <span className="text-xs text-gray-600">ou aperte Esc</span>
      </div>
    </section>
  )
}

function Launcher({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label="Abrir o copiloto"
      onClick={onOpen}
      className="wk-glass fixed bottom-5 left-1/2 z-[1] flex min-h-12 -translate-x-1/2 items-center gap-2 rounded-full px-4 text-sm font-semibold text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
    >
      <Sparkles size={18} aria-hidden="true" />
      Como posso ajudar?
      <kbd className="rounded-md border border-gray-300 px-1.5 py-0.5 text-xs text-gray-600">Ctrl K</kbd>
    </button>
  )
}

export function CopilotDesktop(view: CopilotViewProps) {
  if (view.agent.running) return <Working {...view} />
  if (view.open) return <Palette {...view} />
  return view.showLauncher ? <Launcher onOpen={view.openIt} /> : null
}
