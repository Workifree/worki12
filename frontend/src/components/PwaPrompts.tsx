import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { HTMLAttributes, ReactNode, RefObject } from 'react'
import { useLocation } from 'react-router-dom'
import { Download, RefreshCw, Share, SquarePlus, WifiOff } from 'lucide-react'
import { Button, Card } from './ui'
import { cx } from './ui/cx'
import {
  applyPwaUpdate,
  getPwaState,
  isInstallDismissed,
  isInstallPromptExcludedRoute,
  isIosSafari,
  isStandalone,
  promptInstall,
  rememberInstallDismissed,
  subscribePwa,
} from '../lib/pwa'

/** Espera antes de oferecer a instalação: o convite não pode disputar atenção com a primeira tela. */
const DEFAULT_INSTALL_DELAY_MS = 6000

export interface PwaPromptsProps {
  /** Atraso (ms) até o convite de instalação poder aparecer. Em teste, 0. */
  installDelayMs?: number
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/** Variável CSS com a altura da pilha: o `main` soma ao próprio `padding-bottom` (index.css). */
export const PWA_HEIGHT_VAR = '--worki-pwa-h'

/** Publica a altura da pilha enquanto ela existe; some (0) quando desmonta. */
function usePublishStackHeight(ref: RefObject<HTMLDivElement | null>, active: boolean) {
  useLayoutEffect(() => {
    const root = document.documentElement
    const node = ref.current
    if (!active || !node) {
      root.style.removeProperty(PWA_HEIGHT_VAR)
      return
    }
    const publish = () => {
      const h = Math.ceil(node.getBoundingClientRect().height)
      root.style.setProperty(PWA_HEIGHT_VAR, `${h > 0 ? h + 12 : 0}px`)
    }
    publish()
    const RO = typeof window !== 'undefined' ? window.ResizeObserver : undefined
    const observer = RO ? new RO(publish) : null
    observer?.observe(node)
    return () => {
      observer?.disconnect()
      root.style.removeProperty(PWA_HEIGHT_VAR)
    }
  }, [ref, active])
}

const getOnline = () => navigator.onLine
const getOnlineOnServer = () => true

function IconBadge({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary-ink"
    >
      {children}
    </span>
  )
}

/** Casca única dos cartões flutuantes: ícone, texto curto e ações na mesma linha quando cabe. */
function FloatingCard({
  icon,
  title,
  children,
  actions,
  className,
  ...rest
}: {
  icon: ReactNode
  title: string
  children?: ReactNode
  actions: ReactNode
} & HTMLAttributes<HTMLElement>) {
  return (
    <Card
      as="aside"
      padding="none"
      tone="highlight"
      className={cx('px-3 py-3 shadow-overlay motion-safe:animate-slide-in', className)}
      {...rest}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <IconBadge>{icon}</IconBadge>
        <div className="min-w-0 flex-1 basis-40">
          <p className="text-sm font-bold leading-tight text-black">{title}</p>
          {children && <p className="mt-0.5 text-xs leading-snug text-gray-600">{children}</p>}
        </div>
        <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">{actions}</div>
      </div>
    </Card>
  )
}

/**
 * Camada PWA da interface: aviso de nova versão, convite de instalação e aviso de "sem internet",
 * todos como cartões flutuantes numa pilha fixa (nunca empurram o layout).
 * Montada uma única vez dentro do <BrowserRouter> (App.tsx). Toda a lógica de navegador vive em
 * `lib/pwa.ts`; aqui só há apresentação e a decisão de QUANDO mostrar.
 */
export default function PwaPrompts({ installDelayMs = DEFAULT_INSTALL_DELAY_MS }: PwaPromptsProps) {
  const { pathname } = useLocation()
  const pwa = useSyncExternalStore(subscribePwa, getPwaState, getPwaState)
  const online = useSyncExternalStore(subscribeOnline, getOnline, getOnlineOnServer)

  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [installDismissed, setInstallDismissed] = useState(() => isInstallDismissed())
  const [installDelayElapsed, setInstallDelayElapsed] = useState(installDelayMs <= 0)
  const standalone = useMemo(() => isStandalone(), [])
  const ios = useMemo(() => isIosSafari(), [])

  useEffect(() => {
    if (installDelayMs <= 0) return
    const timer = window.setTimeout(() => setInstallDelayElapsed(true), installDelayMs)
    return () => window.clearTimeout(timer)
  }, [installDelayMs])

  const showUpdate = pwa.updateAvailable && !updateDismissed
  // Telas de dinheiro: o convite de instalação não disputa com o recibo.
  const telaDeDinheiro = pathname.startsWith('/recibo') || pathname.startsWith('/recebimentos')

  // Atualização tem prioridade: nunca empilha dois cartões. O convite de instalação não aparece em
  // login/convites/onboarding (fluxos com foco), nem quando o app já está instalado.
  const showInstall =
    !showUpdate &&
    installDelayElapsed &&
    !installDismissed &&
    !pwa.installed &&
    !standalone &&
    !isInstallPromptExcludedRoute(pathname) &&
    !telaDeDinheiro &&
    (pwa.installAvailable || ios)

  const dismissInstall = () => {
    rememberInstallDismissed()
    setInstallDismissed(true)
  }

  const handleInstall = async () => {
    const outcome = await promptInstall()
    if (outcome === 'dismissed') dismissInstall()
  }

  const visible = !online || showUpdate || showInstall
  const stackRef = useRef<HTMLDivElement>(null)
  usePublishStackHeight(stackRef, visible)

  if (!visible) return null

  return (
    // Pilha FIXA (`.worki-pwa-stack`, index.css), mas que RESERVA o próprio espaço: a altura vai
    // para `--worki-pwa-h` e o `main` soma ao padding de baixo, então o fim da tela nunca fica
    // escondido atrás dela. No chat ela sobe para o topo (não cobre o campo de mensagem).
    <div ref={stackRef} className="worki-pwa-stack">
      {!online && (
        <div
          role="status"
          className="flex items-center gap-2 self-center rounded-xl bg-gray-900 px-3 py-2 text-xs font-semibold text-white shadow-overlay md:self-start"
        >
          <WifiOff aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span>Você está sem internet. Algumas telas podem não carregar.</span>
        </div>
      )}

      {showUpdate && (
        <FloatingCard
          role="status"
          aria-live="polite"
          icon={<RefreshCw className="h-5 w-5" />}
          title="Nova versão disponível"
          actions={
            <>
              <Button size="sm" variant="ghost" onClick={() => setUpdateDismissed(true)}>
                Depois
              </Button>
              <Button size="sm" variant="secondary" onClick={applyPwaUpdate}>
                Atualizar
              </Button>
            </>
          }
        >
          Atualize para ter as últimas melhorias.
        </FloatingCard>
      )}

      {showInstall && (
        <FloatingCard
          aria-label="Instalar o Worki"
          data-page-agent-ignore="true"
          className="worki-pwa-install"
          icon={<Download className="h-5 w-5" />}
          title={pwa.installAvailable ? 'Instale o Worki' : 'Instale o Worki no iPhone'}
          actions={
            pwa.installAvailable ? (
              <>
                <Button size="sm" variant="ghost" onClick={dismissInstall}>
                  Agora não
                </Button>
                <Button size="sm" variant="secondary" onClick={handleInstall}>
                  Instalar
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={dismissInstall}>
                Entendi
              </Button>
            )
          }
        >
          {pwa.installAvailable ? (
            'Abra seus turnos direto da tela inicial.'
          ) : (
            <>
              Toque em{' '}
              <span className="inline-flex items-center gap-1 font-bold text-black">
                Compartilhar
                <Share aria-hidden="true" className="h-3.5 w-3.5" />
              </span>{' '}
              e depois em{' '}
              <span className="inline-flex items-center gap-1 font-bold text-black">
                Adicionar à Tela de Início
                <SquarePlus aria-hidden="true" className="h-3.5 w-3.5" />
              </span>
              .
            </>
          )}
        </FloatingCard>
      )}
    </div>
  )
}
