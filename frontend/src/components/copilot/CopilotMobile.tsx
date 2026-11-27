/**
 * Celular: bottom sheet de comando (alça, composer acima do teclado, chips) e, ao executar, uma
 * pílula compacta embaixo, acima da barra de navegação, para não cobrir o que o agente toca.
 */
import { useEffect, useRef, useState } from 'react'
import { PendingCard, StepFeed, StopButton } from './CopilotParts'
import { Palette } from './CopilotDesktop'
import { Orb } from './Trigger'
import type { CopilotViewProps } from './copilotView'
import { useAvoidTarget, type Box } from '../../hooks/copilot/useAvoidTarget'
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
        <StopButton onStop={agent.stop} block touch />
      </section>
    )
  }

  // Como no laboratório (variante E): pílula flutuante no topo, centrada, enxuta, com o passo atual e o Parar.
  return (
    <section
      ref={ref}
      aria-label="Copiloto trabalhando"
      data-copilot-working=""
      className="wk-labpill wk-rise fixed right-2.5 z-[1] w-max max-w-[min(260px,calc(100%-20px))]"
      style={{ top: 'calc(env(safe-area-inset-top) + 10px)' }}
    >
      <Orb working />
      <div className="min-w-0 flex-1 text-[13px]">
        <StepFeed steps={current ? [current.replace(/^Estou /, '')] : []} />
      </div>
      <StopButton onStop={agent.stop} touch />
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
  if (view.open) return <Palette {...view} />
  return view.showLauncher && view.mobileLauncher ? <Launcher onOpen={view.openIt} /> : null
}
