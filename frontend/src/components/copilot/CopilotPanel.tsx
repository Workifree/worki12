/**
 * Orquestra o copiloto: UM agente, UMA lógica, duas telas (CopilotDesktop e CopilotMobile).
 * Interface em pt-BR; não usa o painel do page-agent (só en/zh, e ficaria inerte com um modal aberto).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { CopilotDesktop } from './CopilotDesktop'
import { CopilotMobile } from './CopilotMobile'
import type { Availability, CopilotViewProps } from './copilotView'
import './copilot.css'
import { useCopilotAgent, type AgentOverrides } from '../../hooks/copilot/useCopilotAgent'
import { useTopLayerHost } from '../../hooks/copilot/useTopLayerHost'
import { useDeviceMode } from '../../lib/copilot/device'
import { prefersReducedMotion } from '../../lib/copilot/motion'
import { OPEN_EVENT, type OpenDetail } from '../../lib/copilot/openEvent'
import { createVirtualPointer, type VirtualPointer } from '../../lib/copilot/pointer'
import type { CopilotRole } from '../../lib/copilot/routes'
import { clearHistory, readHistory, rememberRequest, suggestionsFor } from '../../lib/copilot/suggestions'
import type { CopilotMode } from '../../lib/copilot/ui'
import { createGlowVfx, type Vfx } from '../../lib/copilot/vfx'

export { OPEN_EVENT }
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
  /** `false`: sem a aba/pílula de abrir; abra com `requestOpen()` ou Ctrl+K. */
  showLauncher?: boolean
  confirmArmDelayMs?: number
  overrides?: AgentOverrides
  /** Rota atual (para as sugestões). */
  pathname?: string
  /** A cada pedido de abertura recebido pela raiz (antes de este componente existir). */
  openRequest?: { id: number; origin?: OpenDetail }
}

function readConsent(): boolean {
  try {
    return window.localStorage.getItem(CONSENT_KEY) === 'sim'
  } catch {
    return false
  }
}

export default function CopilotPanel({
  role,
  navigate,
  services,
  onOpenGuide,
  showLauncher = true,
  confirmArmDelayMs,
  overrides,
  pathname,
  openRequest,
}: CopilotPanelProps) {
  const host = useTopLayerHost()
  const device = useDeviceMode(overrides?.deviceMode)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<CopilotMode>('show')
  const [draft, setDraft] = useState('')
  const [consent, setConsent] = useState(readConsent)
  const [availability, setAvailability] = useState<Availability>('checking')
  const [showLog, setShowLog] = useState(false)
  const [history, setHistory] = useState(readHistory)
  const pointer = useRef<VirtualPointer | null>(null)
  const vfx = useRef<Vfx | null>(null)
  const [origin, setOrigin] = useState<OpenDetail | undefined>(undefined)
  const [handledRequest, setHandledRequest] = useState(0)

  // Seta no PC, dedo virtual no celular. Criados dentro da raiz `data-copilot-ui`.
  useEffect(() => {
    const made = createVirtualPointer(host, {
      kind: device === 'mobile' ? 'finger' : 'cursor',
      timeScale: overrides?.pointerTimeScale,
      reducedMotion: overrides?.reducedMotion,
      vibrate: true,
    })
    pointer.current = made
    return () => {
      made.dispose()
      pointer.current = null
    }
  }, [host, device, overrides?.pointerTimeScale, overrides?.reducedMotion])

  useEffect(() => {
    const glow = createGlowVfx(host, { mobile: device === 'mobile' })
    vfx.current = glow
    return () => {
      glow.dispose()
      vfx.current = null
    }
  }, [host, device])

  const agent = useCopilotAgent({ role, navigate, createLlmFetch: services.createLlmFetch, overrides, pointer })

  useEffect(() => {
    if (agent.running) vfx.current?.activate(origin)
    else vfx.current?.deactivate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.running, device])

  // Abertura: a "gota" nasce no ponto que abriu (botão ou atalho).
  useEffect(() => {
    if (open) vfx.current?.drop(origin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /**
   * Barra de comando no PC: View Transition em MORPH. O botão (ou campo) que abriu se transforma na
   * barra aberta, e ela volta a ser o botão ao fechar. O elemento de origem e a barra levam o mesmo
   * `view-transition-name`; a raiz não faz crossfade. Sem a API, com movimento reduzido, no celular ou sem
   * um botão de origem visível: abre e fecha direto, e o CSS faz a entrada de 260 ms.
   */
  /** Botão visível que abriu (o que está sob o toque, o botão de ajuda do cabeçalho ou a pílula do próprio copiloto). */
  const findOrigin = useCallback((at?: OpenDetail): HTMLElement | null => {
    const visible = (node: HTMLElement | null | undefined) => (node && node.getBoundingClientRect().width > 0 ? node : null)
    const hit = at ? document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>('button,a,[role="button"]') : null
    return (
      visible(hit) ??
      Array.from(document.querySelectorAll<HTMLElement>('button[aria-label="Ajuda e copiloto"],button[aria-label="Abrir o copiloto"]')).find((node) => visible(node)) ??
      null
    )
  }, [])

  const canMorph = useCallback(() => {
    const doc = document as unknown as { startViewTransition?: unknown }
    return device === 'desktop' && typeof doc.startViewTransition === 'function' && !prefersReducedMotion()
  }, [device])

  /**
   * Abrir: o nome de transição está no botão ANTES (estado antigo) e na barra DEPOIS.
   * Fechar: o inverso (a barra, depois o botão que reapareceu). Raiz sem crossfade.
   */
  const morph = useCallback(
    (direction: 'open' | 'close', change: () => void, at?: OpenDetail) => {
      const origin = direction === 'open' ? findOrigin(at) : null
      if (!canMorph() || (direction === 'open' && !origin)) {
        change()
        return
      }
      const doc = document as unknown as { startViewTransition: (update: () => void) => { finished: Promise<unknown> } }
      const root = document.documentElement
      let named: HTMLElement | null = origin
      root.setAttribute('data-wk-vt', '')
      if (origin) origin.style.viewTransitionName = 'wk-cmd-vt'
      const transition = doc.startViewTransition(() => {
        if (origin) origin.style.viewTransitionName = ''
        flushSync(change)
        if (direction === 'close') {
          named = findOrigin(at)
          if (named) named.style.viewTransitionName = 'wk-cmd-vt'
        }
      })
      const clear = () => {
        root.removeAttribute('data-wk-vt')
        if (named) named.style.viewTransitionName = ''
      }
      transition.finished.then(clear, clear)
    },
    [canMorph, findOrigin],
  )

  const openAnimated = useCallback((at?: OpenDetail) => morph('open', () => setOpen(true), at), [morph])

  useEffect(() => {
    const onOpen = (event: Event) => {
      const at = (event as CustomEvent<OpenDetail | undefined>).detail
      setOrigin(at)
      openAnimated(at)
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [openAnimated])

  // Pedido que chegou antes de este componente (carregado sob demanda) existir.
  if (openRequest && openRequest.id !== handledRequest) {
    setHandledRequest(openRequest.id)
    setOrigin(openRequest.origin)
    setOpen(true)
  }

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

  const accept = useCallback(() => {
    setConsent(true)
    try {
      window.localStorage.setItem(CONSENT_KEY, 'sim')
    } catch {
      // vale só para esta visita
    }
  }, [])

  const { start, running, clearHighlight } = agent
  const send = useCallback(
    (text: string) => {
      if (!text.trim() || running) return
      setDraft('')
      setHistory(rememberRequest(text))
      void start(text, mode)
    },
    [start, running, mode],
  )

  const close = useCallback(() => {
    clearHighlight()
    morph('close', () => setOpen(false), origin)
  }, [clearHighlight, morph, origin])

  const view: CopilotViewProps = {
    role,
    agent,
    open,
    close,
    openIt: () => openAnimated(),
    showLauncher,
    availability,
    consent,
    accept,
    mode,
    setMode,
    draft,
    setDraft,
    send,
    suggestions: suggestionsFor(role, pathname ?? window.location.pathname),
    history,
    forgetHistory: () => {
      clearHistory()
      setHistory([])
    },
    onOpenGuide,
    navigate,
    confirmArmDelayMs,
    showLog,
    setShowLog,
  }

  return createPortal(device === 'mobile' ? <CopilotMobile {...view} /> : <CopilotDesktop {...view} />, host)
}
