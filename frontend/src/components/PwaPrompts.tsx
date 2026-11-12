import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Download, RefreshCw, Share, SquarePlus, WifiOff, X } from 'lucide-react'
import { Button, Card } from './ui'
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

const getOnline = () => navigator.onLine
const getOnlineOnServer = () => true

function IconBadge({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-black bg-primary-light text-primary"
    >
      {children}
    </span>
  )
}

/**
 * Camada PWA da interface: aviso de nova versão, convite de instalação e faixa de "sem internet".
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

  // Atualização tem prioridade: nunca empilha dois cartões. O convite de instalação não aparece em
  // login/convites/onboarding (fluxos com foco), nem quando o app já está instalado.
  const showInstall =
    !showUpdate &&
    installDelayElapsed &&
    !installDismissed &&
    !pwa.installed &&
    !standalone &&
    !isInstallPromptExcludedRoute(pathname) &&
    (pwa.installAvailable || ios)

  const dismissInstall = () => {
    rememberInstallDismissed()
    setInstallDismissed(true)
  }

  const handleInstall = async () => {
    const outcome = await promptInstall()
    if (outcome === 'dismissed') dismissInstall()
  }

  return (
    <>
      {!online && (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-black px-4 py-2 text-center text-xs font-bold text-white"
        >
          <WifiOff aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span>Você está sem internet. Algumas telas podem não carregar.</span>
        </div>
      )}

      {(showUpdate || showInstall) && (
        <div className="fixed inset-x-3 bottom-[calc(5.5rem_+_env(safe-area-inset-bottom))] z-40 md:inset-x-auto md:bottom-6 md:right-6 md:w-96">
          {showUpdate && (
            <Card
              padding="sm"
              role="status"
              aria-live="polite"
              className="shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] animate-slide-in"
            >
              <div className="flex items-start gap-3">
                <IconBadge>
                  <RefreshCw className="h-5 w-5" />
                </IconBadge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-black">Nova versão disponível</p>
                  <p className="mt-0.5 text-sm text-gray-600">Atualize para ter as últimas melhorias do Worki.</p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button size="md" onClick={applyPwaUpdate}>
                      Atualizar
                    </Button>
                    <Button size="md" variant="ghost" onClick={() => setUpdateDismissed(true)}>
                      Depois
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {showInstall && (
            <Card
              as="aside"
              padding="sm"
              aria-label="Instalar o Worki"
              className="shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] animate-slide-in"
            >
              <div className="flex items-start gap-3">
                <IconBadge>
                  <Download className="h-5 w-5" />
                </IconBadge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-black">
                    {pwa.installAvailable ? 'Instale o Worki' : 'Instale o Worki no iPhone'}
                  </p>
                  {pwa.installAvailable ? (
                    <>
                      <p className="mt-0.5 text-sm text-gray-600">
                        Abra seus turnos direto da tela inicial, como um aplicativo.
                      </p>
                      <div className="mt-3">
                        <Button size="md" iconLeft={<Download aria-hidden="true" className="h-4 w-4" />} onClick={handleInstall}>
                          Instalar
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="mt-0.5 text-sm text-gray-600">
                        Toque em{' '}
                        <span className="inline-flex items-center gap-1 font-bold text-black">
                          Compartilhar
                          <Share aria-hidden="true" className="h-4 w-4" />
                        </span>{' '}
                        e depois em{' '}
                        <span className="inline-flex items-center gap-1 font-bold text-black">
                          Adicionar à Tela de Início
                          <SquarePlus aria-hidden="true" className="h-4 w-4" />
                        </span>
                        .
                      </p>
                      <div className="mt-3">
                        <Button size="md" variant="secondary" onClick={dismissInstall}>
                          Entendi
                        </Button>
                      </div>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={dismissInstall}
                  aria-label="Dispensar convite de instalação"
                  className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  )
}
