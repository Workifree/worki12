import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { HTMLAttributes, ReactNode, RefObject } from 'react'
import { useLocation } from 'react-router-dom'
import { Download, RefreshCw, Share, SquarePlus, WifiOff, X } from 'lucide-react'
import { Button, Card, DialogActions, DialogHeader, IconButton } from './ui'
import { Dialog } from './ui/Dialog'
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

/**
 * Uso mínimo na SESSÃO (não na página) antes de oferecer a instalação. Além disso o convite nunca
 * aparece na primeira tela carregada: só depois de a pessoa navegar ao menos uma vez.
 */
const DEFAULT_INSTALL_DELAY_MS = 20000
/** Início da sessão de uso (sessionStorage): recarregar a página não zera a contagem. */
export const PWA_SESSION_START_KEY = 'worki:pwa-sessao-inicio'

export interface PwaPromptsProps {
  /** Uso mínimo (ms) na sessão até o convite poder aparecer. 0 (testes) desliga as duas travas. */
  installDelayMs?: number
}

/** Quanto falta para completar `delayMs` de uso na sessão. Sem storage, conta a partir de agora. */
function remainingSessionDelay(delayMs: number): number {
  try {
    const now = Date.now()
    const saved = Number(window.sessionStorage.getItem(PWA_SESSION_START_KEY))
    const start = Number.isFinite(saved) && saved > 0 && saved <= now ? saved : now
    if (start === now) window.sessionStorage.setItem(PWA_SESSION_START_KEY, String(now))
    return Math.max(0, delayMs - (now - start))
  } catch {
    return delayMs
  }
}

/** Celular (< 640px): convite e aviso viram linhas compactas. */
const COMPACT_QUERY = '(max-width: 639px)'
function subscribeCompact(onChange: () => void): () => void {
  const mql = typeof window !== 'undefined' ? window.matchMedia?.(COMPACT_QUERY) : undefined
  mql?.addEventListener?.('change', onChange)
  return () => mql?.removeEventListener?.('change', onChange)
}
const getCompact = () => typeof window !== 'undefined' && window.matchMedia?.(COMPACT_QUERY)?.matches === true
const getCompactOnServer = () => false

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

/** Passo a passo do Safari no iPhone (não há prompt de instalação nativo). */
function IosSteps() {
  return (
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
  const [sheetOpen, setSheetOpen] = useState(false)
  const compact = useSyncExternalStore(subscribeCompact, getCompact, getCompactOnServer)
  const standalone = useMemo(() => isStandalone(), [])
  const ios = useMemo(() => isIosSafari(), [])

  // "Nunca no primeiro carregamento": a primeira rota desta página não recebe o convite.
  // Ajuste de estado no render (padrão do React para "derivar do anterior"): vira true uma vez só.
  const [firstPath] = useState(pathname)
  const [navigated, setNavigated] = useState(installDelayMs <= 0)
  if (!navigated && pathname !== firstPath) setNavigated(true)

  useEffect(() => {
    if (installDelayMs <= 0) return
    const timer = window.setTimeout(() => setInstallDelayElapsed(true), remainingSessionDelay(installDelayMs))
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
    navigated &&
    !installDismissed &&
    !pwa.installed &&
    !standalone &&
    !isInstallPromptExcludedRoute(pathname) &&
    !telaDeDinheiro &&
    (pwa.installAvailable || ios)

  const dismissInstall = () => {
    rememberInstallDismissed()
    setInstallDismissed(true)
    setSheetOpen(false)
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
          className="flex h-10 min-w-0 max-w-full items-center gap-2 self-center rounded-xl bg-gray-900 px-3 text-xs font-semibold text-white shadow-overlay md:self-start"
        >
          <WifiOff aria-hidden="true" className="h-4 w-4 shrink-0" />
          {/* Uma linha só (40px). No celular, texto curto; a frase inteira segue para o leitor de tela. */}
          <span className="min-w-0 truncate">
            {compact ? (
              <>
                Sem internet
                <span className="sr-only">. Algumas telas podem não carregar.</span>
              </>
            ) : (
              'Você está sem internet. Algumas telas podem não carregar.'
            )}
          </span>
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

      {showInstall && compact && (
        // Celular: UMA linha de 56px (texto curto + Instalar + dispensar). O texto completo e o
        // passo a passo do iPhone ficam na folha que abre em "Instalar".
        <aside
          aria-label="Instalar o Workyn"
          data-page-agent-ignore="true"
          className="worki-pwa-install flex h-14 items-center gap-2 rounded-2xl border border-gray-200 bg-white pl-3 pr-1 shadow-overlay motion-safe:animate-slide-in"
        >
          <Download aria-hidden="true" className="h-5 w-5 shrink-0 text-primary-ink" />
          <p className="min-w-0 flex-1 truncate text-sm font-bold text-black">Instale o Workyn</p>
          <Button size="md" variant="secondary" className="h-11 shrink-0 px-4" onClick={() => setSheetOpen(true)}>
            Instalar
          </Button>
          <IconButton aria-label="Agora não" onClick={dismissInstall}>
            <X size={20} />
          </IconButton>
        </aside>
      )}

      {showInstall && compact && sheetOpen && (
        <Dialog onClose={() => setSheetOpen(false)} labelledBy="pwa-install-sheet-title" className="w-full max-w-md">
          <DialogHeader
            title={pwa.installAvailable ? 'Instale o Workyn' : 'Instale o Workyn no iPhone'}
            titleId="pwa-install-sheet-title"
            onClose={() => setSheetOpen(false)}
          />
          <p className="text-sm text-gray-700">
            {pwa.installAvailable ? (
              'Abra seus turnos direto da tela inicial, como um aplicativo.'
            ) : (
              <IosSteps />
            )}
          </p>
          <DialogActions>
            {pwa.installAvailable ? (
              <>
                <Button variant="ghost" onClick={dismissInstall}>
                  Agora não
                </Button>
                <Button variant="secondary" onClick={handleInstall}>
                  Instalar agora
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={dismissInstall}>
                Entendi
              </Button>
            )}
          </DialogActions>
        </Dialog>
      )}

      {showInstall && !compact && (
        <FloatingCard
          aria-label="Instalar o Workyn"
          data-page-agent-ignore="true"
          className="worki-pwa-install"
          icon={<Download className="h-5 w-5" />}
          title={pwa.installAvailable ? 'Instale o Workyn' : 'Instale o Workyn no iPhone'}
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
            <IosSteps />
          )}
        </FloatingCard>
      )}
    </div>
  )
}
