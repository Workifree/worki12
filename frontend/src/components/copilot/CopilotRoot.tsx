/**
 * Ponto de montagem: dentro do `BrowserRouter` e do `AuthProvider`.
 * Desligado (padrão) não renderiza nada e não baixa nada.
 */
import { Suspense, lazy, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
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

const GATE = '[data-testid="tos-gate-modal"]'

/** Com o aceite de Termos na frente, o copiloto some (e a tarefa, se houver, é encerrada). */
function useTermsGateOpen(enabled: boolean): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!enabled) return
    const check = () => setOpen(!!document.querySelector(GATE))
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [enabled])
  return open
}

export type CopilotRootProps = Partial<
  Pick<CopilotPanelProps, 'onOpenGuide' | 'showLauncher' | 'services' | 'overrides' | 'confirmArmDelayMs'>
> & {
  /** Sobrepõe a flag de build (testes). */
  enabled?: boolean
}

function ActiveCopilot({ services = DEFAULT_SERVICES, ...props }: Omit<CopilotRootProps, 'enabled'>) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const gate = useTermsGateOpen(!!user)
  const current: CopilotRole | null = SHARED.test(pathname) ? null : pathname.startsWith('/company') ? 'company' : 'worker'
  const [role, setRole] = useState<CopilotRole>(current ?? 'worker')
  if (current && current !== role) setRole(current)

  if (!user || gate || pathPolicy(pathname) === 'blocked') return null
  return (
    <Suspense fallback={null}>
      <CopilotPanel {...props} key={`${user.id}:${role}`} role={role} services={services} navigate={navigate} />
    </Suspense>
  )
}

export function CopilotRoot({ enabled = isCopilotEnabled(), ...props }: CopilotRootProps) {
  return enabled ? <ActiveCopilot {...props} /> : null
}

export default CopilotRoot
