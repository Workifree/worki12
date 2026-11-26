/**
 * Peças leves do gatilho do copiloto (orbe e a pílula "Pergunte ao Worki"). Ficam fora do painel
 * para o cabeçalho poder usá-las sem puxar o painel completo (que carrega sob demanda).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import './copilot-base.css'
import { applyMotionMode } from '../../lib/copilot/motion'

applyMotionMode()

/** Bolinha do copiloto (laboratório): espectro com brilho e halo; gira e respira só enquanto `working`. */
export function Orb({ working = false, done = false, small = false, bare = false }: { working?: boolean; done?: boolean; small?: boolean; bare?: boolean }) {
  return (
    <span className={`wk-orb ${working ? '' : 'wk-orb--idle'} ${done ? 'wk-orb--done' : ''} ${small ? 'wk-orb--sm' : ''} ${bare ? 'wk-orb--bare' : ''}`} aria-hidden="true">
      <i className="wk-orb__halo" />
      <i className="wk-orb__core" />
    </span>
  )
}

/** Texto com brilho que passa (janela deslizante, só transform). A cópia que brilha é decorativa. */
export function Shimmer({ text }: { text: string }) {
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

/** Mensagens que rodam na pílula do cabeçalho (celular): deixam claro que é uma IA que age. */
export const HEADER_MESSAGES = ['Copiloto Worki', 'Eu faço por você'] as const

function RotatingMessage() {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const reduced = document.documentElement.getAttribute('data-copilot-motion') === 'reduced'
    if (reduced) return
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % HEADER_MESSAGES.length), 4200)
    return () => window.clearInterval(timer)
  }, [])
  return <Shimmer text={HEADER_MESSAGES[index]} />
}

/** Conteúdo da pílula: brilho do espectro em volta, orbe, texto e o atalho. `compact` = "Copiloto Worki" com IA e brilho (cabeçalho do celular). */
export function TriggerBody({ compact = false }: { compact?: boolean }) {
  return (
    <>
      <span className="wk-trigger__halo" aria-hidden="true" />
      <span className="wk-trigger__ring" aria-hidden="true">
        <span className="wk-trigger__sweep" />
      </span>
      <Orb small bare working />
      <span className="wk-trigger__txt">
        {compact ? (
          <>
            <RotatingMessage />
            <span className="wk-trigger__ia" aria-hidden="true">IA</span>
          </>
        ) : (
          <>
            Precisa de ajuda? <small>Pergunte ao Worki</small>
          </>
        )}
      </span>
      {!compact && <kbd>Ctrl K</kbd>}
    </>
  )
}
