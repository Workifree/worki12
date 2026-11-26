/**
 * Ponto de montagem: dentro do `BrowserRouter` e do `AuthProvider`.
 * Desligado (padrão) não renderiza nada e não baixa nada.
 */
import { Suspense, lazy, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useGuide } from '../../hooks/useGuide'
import { OPEN_EVENT, isOpenShortcut, requestOpen, type OpenDetail } from '../../lib/copilot/openEvent'
import { TOS_GATE_SELECTOR } from '../../lib/copilot/dom'
import { isCopilotEnabled } from '../../lib/copilot/flags'
import { pathPolicy, type CopilotRole } from '../../lib/copilot/routes'
import { checkAgentAvailability, createAgentFetch } from '../../services/copilot/copilotService'
import type { CopilotPanelProps, CopilotServices } from './CopilotPanel'

const CopilotPanel = lazy(() => import('./CopilotPanel'))

const DEFAULT_SERVICES: CopilotServices = {
  checkAvailability: checkAgentAvailability,
  createLlmFetch: createAgentFetch,
}

/** Telas dos dois papéis: mantêm o papel de onde a pessoa veio. */
const SHARED = /^\/(?:ajuda|recibo|termos|privacidade)/

/** Com o aceite de Termos na frente, o copiloto some (e a tarefa, se houver, é encerrada). */
function useTermsGateOpen(enabled: boolean): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!enabled) return
    const check = () => setOpen(!!document.querySelector(TOS_GATE_SELECTOR))
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [enabled])
  return open
}

export type CopilotRootProps = Partial<
  Pick<CopilotPanelProps, 'onOpenGuide' | 'showLauncher' | 'mobileLauncher' | 'services' | 'overrides' | 'confirmArmDelayMs'>
> & {
  /** Sobrepõe a flag de build (testes). */
  enabled?: boolean
}

/**
 * Pedidos de abertura (botão de ajuda, Ctrl+K) valem mesmo antes de o painel, carregado sob
 * demanda, existir: a raiz guarda o último e o repassa.
 */
function useOpenRequests(enabled: boolean) {
  const [request, setRequest] = useState<{ id: number; origin?: OpenDetail } | undefined>()
  useEffect(() => {
    if (!enabled) return
    const onOpen = (event: Event) =>
      setRequest((last) => ({ id: (last?.id ?? 0) + 1, origin: (event as CustomEvent<OpenDetail | undefined>).detail }))
    const onKey = (event: KeyboardEvent) => {
      if (!isOpenShortcut(event) || event.defaultPrevented) return
      event.preventDefault()
      // Com o atalho, a gota nasce na pílula (ou no botão de ajuda) em vez de um ponto qualquer da página.
      const pill = Array.from(document.querySelectorAll<HTMLElement>('button[aria-label="Abrir o copiloto"],button[aria-label="Ajuda e copiloto"]')).find((node) => node.getBoundingClientRect().width > 0)
      const box = pill?.getBoundingClientRect()
      requestOpen(box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight * 0.4 })
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen)
      window.removeEventListener('keydown', onKey)
    }
  }, [enabled])
  return request
}

function ActiveCopilot({ services = DEFAULT_SERVICES, ...props }: Omit<CopilotRootProps, 'enabled'>) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const guide = useGuide()
  const gate = useTermsGateOpen(!!user)
  const openRequest = useOpenRequests(!!user)
  const current: CopilotRole | null = SHARED.test(pathname) ? null : pathname.startsWith('/company') ? 'company' : 'worker'
  // Tela dos dois papéis aberta direto (recarga ou link, ex.: /recibo): quem informa o papel é o guia.
  const informed: CopilotRole | null = guide?.papel ? (guide.papel === 'freela' ? 'worker' : 'company') : null
  const [role, setRole] = useState<CopilotRole>(current ?? informed ?? 'worker')
  const wanted = current ?? informed
  if (wanted && wanted !== role) setRole(wanted)

  if (!user || gate || pathPolicy(pathname) === 'blocked') return null
  return (
    <Suspense fallback={null}>
      <CopilotPanel
        {...props}
        key={`${user.id}:${role}`}
        role={role}
        services={services}
        navigate={navigate}
        pathname={pathname}
        openRequest={openRequest}
      />
    </Suspense>
  )
}

export function CopilotRoot({ enabled = isCopilotEnabled(), ...props }: CopilotRootProps) {
  return enabled ? <ActiveCopilot {...props} /> : null
}

export default CopilotRoot
