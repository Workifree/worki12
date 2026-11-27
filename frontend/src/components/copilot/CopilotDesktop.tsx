/** Computador: pílula flutuante no topo que vira a barra de comando (morph); ao executar, a pílula de status; o painel só quando o agente precisa de você. */
import { useRef } from 'react'
import { X } from 'lucide-react'
import { Composer, IdleBody, PendingCard, StepFeed, StopButton } from './CopilotParts'
import { Orb, TriggerBody } from './Trigger'
import { PillButton } from './PillButton'
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

export function Palette(view: CopilotViewProps) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogBehavior(ref, true, view.close)
  const ready = view.availability === 'ready' && view.consent
  return (
    <div
      className="wk-scrim fixed inset-0 z-[1] flex items-start justify-center p-3 pt-[16vh] max-sm:items-end max-sm:p-0 max-sm:pt-0"
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
        className="wk-glass wk-rise relative flex max-h-[min(78dvh,680px)] w-[min(440px,100%)] flex-col wk-cluely overflow-hidden"
      >
        <div className="wk-cmd__line" aria-hidden="true" />
        <div className={`wk-cmd__row ${ready ? 'wk-cmd__row--top' : ''}`}>
          <Orb working />
          {ready ? (
            <>
              <h2 className="sr-only">Como posso ajudar?</h2>
              <div className="min-w-0 flex-1">
                <Composer
                  large
                  bare
                  value={view.draft}
                  onChange={view.setDraft}
                  onSend={view.send}
                  onEmptyEnter={() => view.suggestions[0] && view.send(view.suggestions[0])}
                  placeholder={view.agent.followUp ? 'Responda aqui' : 'Quer que eu faça alguma coisa?'}
                  shortcutHint
                />
              </div>
            </>
          ) : (
            <h2 className="flex-1 text-[14px] font-bold">Como posso ajudar?</h2>
          )}
          <PillButton tone="ghost" aria-label="Fechar o copiloto" onClick={view.close} className="w-11 !px-0">
            <X size={18} aria-hidden="true" />
          </PillButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          <IdleBody view={view} compact />
        </div>
        {ready && (
          <p className="wk-cmd__foot max-sm:hidden">
            <span>↵ enviar</span>
            <span>Esc fechar</span>
          </p>
        )}
      </section>
    </div>
  )
}

type PillSlot = 'top' | 'bottom'
const PILL_SLOTS: readonly PillSlot[] = ['top', 'bottom']

/**
 * Trabalhando: a pílula de status do laboratório (orbe, passo com shimmer e Parar), fixa no topo e centralizada,
 * no lugar da pílula de gatilho. Desce para a base quando o agente precisa mexer embaixo dela. O painel
 * maior só aparece quando o agente espera por você (confirmar, tocar ou responder).
 */
function Working(view: CopilotViewProps) {
  const { agent } = view
  const panel = useRef<HTMLElement>(null)
  const pill = useRef<HTMLElement>(null)
  const drag = useDraggable(panel)
  const pendingElement = agent.pending && agent.pending.kind !== 'ask' ? agent.pending.element : null
  const target = agent.acting ?? pendingElement ?? agent.spot
  const corner = useAvoidTarget(target, panel, CORNERS, cornerBox)
  const slot = useAvoidTarget<PillSlot>(target, pill, PILL_SLOTS, (candidate, size) => ({
    left: (window.innerWidth - size.width) / 2,
    top: candidate === 'top' ? 12 : window.innerHeight - size.height - 24,
    width: size.width,
    height: size.height,
  } satisfies Box))
  const needsPerson = !!agent.pending

  // Esc para a tarefa: o atalho mora no CopilotPanel (vale no PC e no celular, na primeira tecla).

  const current = agent.steps.at(-1) ?? 'Olhando a tela'

  if (!needsPerson) {
    return (
      <section
        ref={pill}
        aria-label="Copiloto trabalhando"
        className={`wk-labpill wk-rise fixed inset-x-0 z-[1] mx-auto w-max max-w-[min(340px,calc(100%-20px))] ${slot === 'top' ? 'top-3' : 'bottom-6'}`}
      >
        <Orb working />
        <div className="min-w-0 flex-1 text-[13px]">
          <StepFeed steps={[current.replace(/^Estou /, '')]} />
        </div>
        <StopButton onStop={agent.stop} />
      </section>
    )
  }

  return (
    <section
      ref={panel}
      aria-label="Copiloto aguardando você"
      className={`wk-glass wk-rise fixed z-[1] flex max-h-[calc(100dvh-96px)] w-[min(400px,calc(100vw-32px))] flex-col overflow-hidden ${CORNER_CLASS[corner]}`}
      style={{ transform: `translate3d(${drag.offset.x}px, ${drag.offset.y}px, 0)` }}
    >
      <header
        {...drag.handleProps}
        className="wk-cmd__row cursor-grab touch-none select-none active:cursor-grabbing"
        title="Arraste para mover"
      >
        <Orb working />
        <h2 className="flex-1 text-[14px] font-bold">Preciso de você</h2>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-2 pt-3">
        <StepFeed steps={agent.steps} />
        {agent.pending && (
          <div className="wk-field p-3">
            <PendingCard pending={agent.pending} role={view.role} armDelayMs={view.confirmArmDelayMs} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 px-4 pb-4 pt-2">
        <StopButton onStop={agent.stop} block />
        <span className="shrink-0 text-[11px] text-[#6b7280]">ou aperte Esc</span>
      </div>
    </section>
  )
}

function Launcher({ onOpen }: { onOpen: () => void }) {
  return (
    // Voando no topo, centralizada, como a busca do laboratório: o clique ou Ctrl+K a transformam na barra (morph).
    <button type="button" aria-label="Abrir o copiloto" aria-haspopup="dialog" onClick={onOpen} className="wk-trigger fixed left-1/2 top-3 z-[1] -translate-x-1/2">
      <TriggerBody />
    </button>
  )
}

export function CopilotDesktop(view: CopilotViewProps) {
  if (view.agent.running) return <Working {...view} />
  if (view.open) return <Palette {...view} />
  return view.showLauncher ? <Launcher onOpen={view.openIt} /> : null
}
