/**
 * PWA — registro do service worker, detecção de nova versão e convite de instalação.
 *
 * Este módulo é a única ponte entre o navegador (service worker, `beforeinstallprompt`) e a UI
 * (`components/PwaPrompts.tsx`). A UI lê o estado por `subscribePwa` / `getPwaState`
 * (compatível com `useSyncExternalStore`) e dispara ações por `applyPwaUpdate` / `promptInstall`.
 *
 * Por que `initPwa()` roda em `main.tsx` e não dentro de um componente: o Chrome dispara
 * `beforeinstallprompt` UMA vez, bem cedo; se o listener só existir depois que o React montou,
 * o evento já passou e o convite de instalação nunca aparece.
 *
 * Segurança: o service worker (`public/sw.js`) nunca guarda chamadas ao Supabase nem respostas
 * autenticadas. Mesmo assim, no logout pedimos que ele esvazie os caches (`CLEAR_CACHES`) —
 * defesa em profundidade para aparelho compartilhado.
 */
import { logError } from './logger'

const SW_URL = '/sw.js'
const SW_SCOPE = '/'

/** Reverifica se há versão nova a cada hora (além de cada vez que a aba volta ao foco). */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

/** Se o `controllerchange` não vier, recarrega mesmo assim — o botão "Atualizar" nunca fica mudo. */
const RELOAD_FALLBACK_MS = 3000

/** Prefixo dos caches do service worker (deve casar com `CACHE_PREFIX` em public/sw.js). */
const CACHE_PREFIX = 'worki-'

export const INSTALL_DISMISS_KEY = 'worki:pwa-install-dismissed-at'
/** Depois de dispensado, o convite de instalação só volta em 30 dias. */
export const INSTALL_DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface PwaState {
  /** Há um service worker novo instalado e esperando — `applyPwaUpdate()` ativa e recarrega. */
  updateAvailable: boolean
  /** Chrome/Edge/Android: `beforeinstallprompt` capturado — `promptInstall()` abre o diálogo nativo. */
  installAvailable: boolean
  /** App já está instalado (rodando em modo standalone ou `appinstalled` nesta sessão). */
  installed: boolean
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>
}

interface NavigatorWithStandalone extends Navigator {
  /** Só existe no Safari iOS. */
  standalone?: boolean
}

let state: PwaState = { updateAvailable: false, installAvailable: false, installed: false }
const listeners = new Set<() => void>()

let initialized = false
let deferredPrompt: BeforeInstallPromptEvent | null = null
let waitingWorker: ServiceWorker | null = null
let reloadOnControllerChange = false

function setState(patch: Partial<PwaState>): void {
  const next = { ...state, ...patch }
  if (
    next.updateAvailable === state.updateAvailable &&
    next.installAvailable === state.installAvailable &&
    next.installed === state.installed
  ) {
    return
  }
  state = next // novo objeto a cada mudança real: snapshot estável para useSyncExternalStore
  listeners.forEach((listener) => listener())
}

export function getPwaState(): PwaState {
  return state
}

export function subscribePwa(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** true quando o app está aberto como PWA instalado (Android/desktop e iOS). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) {
      return true
    }
  } catch {
    // matchMedia indisponível — cai no teste do iOS abaixo
  }
  return (navigator as NavigatorWithStandalone).standalone === true
}

/**
 * Safari no iPhone/iPad (inclui iPadOS, que se anuncia como Macintosh). Chrome/Firefox/Edge no iOS
 * ficam de fora: neles o caminho "Compartilhar → Adicionar à Tela de Início" é diferente.
 */
export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const iPadOs = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
  const isIos = /iPhone|iPad|iPod/.test(ua) || iPadOs
  if (!isIos) return false
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
}

/** O convite de instalação foi dispensado recentemente? (localStorage pode falhar — modo privado.) */
export function isInstallDismissed(now: number = Date.now()): boolean {
  try {
    const raw = window.localStorage.getItem(INSTALL_DISMISS_KEY)
    if (!raw) return false
    const at = Number(raw)
    if (!Number.isFinite(at)) return false
    return now - at < INSTALL_DISMISS_TTL_MS
  } catch {
    return false
  }
}

export function rememberInstallDismissed(now: number = Date.now()): void {
  try {
    window.localStorage.setItem(INSTALL_DISMISS_KEY, String(now))
  } catch {
    // sem localStorage: o convite simplesmente volta na próxima sessão
  }
}

function markUpdateAvailable(worker: ServiceWorker): void {
  waitingWorker = worker
  setState({ updateAvailable: true })
}

function trackRegistration(registration: ServiceWorkerRegistration): void {
  const container = navigator.serviceWorker

  // Já havia um worker esperando quando a página abriu (ex.: aba antiga) — e só é "atualização"
  // se esta página já está sob controle de outro worker (senão é a primeira instalação).
  if (registration.waiting && container.controller) {
    markUpdateAvailable(registration.waiting)
  }

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing
    if (!installing) return
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && container.controller) {
        markUpdateAvailable(installing)
      }
    })
  })

  const checkForUpdate = () => {
    // Offline, `update()` rejeita — é esperado, não é erro de produto.
    registration.update().catch(() => undefined)
  }
  window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate()
  })
}

async function register(): Promise<void> {
  const container = navigator.serviceWorker

  container.addEventListener('controllerchange', () => {
    // Só recarrega quando FOI o usuário que pediu a atualização. Na primeira instalação o
    // `clients.claim()` do worker também dispara `controllerchange` e não deve recarregar a tela.
    if (!reloadOnControllerChange) return
    reloadOnControllerChange = false
    window.location.reload()
  })

  try {
    const registration = await container.register(SW_URL, { scope: SW_SCOPE, updateViaCache: 'none' })
    trackRegistration(registration)
  } catch (error) {
    logError('pwa:register', error)
  }
}

/**
 * Registra o service worker. Só em produção (`import.meta.env.PROD`): em dev o SW cacheando
 * módulos do Vite esconde mudanças e confunde o HMR. O parâmetro existe para teste.
 */
export function registerServiceWorker(enabled: boolean = import.meta.env.PROD): void {
  if (!enabled) return
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  // Depois do `load`, para o registro não competir com o carregamento inicial do app.
  if (document.readyState === 'complete') {
    void register()
  } else {
    window.addEventListener('load', () => void register(), { once: true })
  }
}

/**
 * Liga os listeners de instalação e registra o service worker (produção). Idempotente — chamar
 * duas vezes (StrictMode, HMR) não duplica listeners.
 */
export function initPwa(options: { registerServiceWorker?: boolean } = {}): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  setState({ installed: isStandalone() })

  window.addEventListener('beforeinstallprompt', (event) => {
    // Impede o mini-infobar automático do Chrome; o convite é nosso (PwaPrompts), no momento certo.
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    setState({ installAvailable: true })
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    setState({ installed: true, installAvailable: false })
  })

  registerServiceWorker(options.registerServiceWorker)
}

/** Ativa o service worker novo e recarrega a página quando ele assumir o controle. */
export function applyPwaUpdate(): void {
  if (!waitingWorker) {
    window.location.reload()
    return
  }
  reloadOnControllerChange = true
  waitingWorker.postMessage({ type: 'SKIP_WAITING' })
  window.setTimeout(() => {
    if (reloadOnControllerChange) {
      reloadOnControllerChange = false
      window.location.reload()
    }
  }, RELOAD_FALLBACK_MS)
}

/** Abre o diálogo nativo de instalação (Chrome/Edge/Android). O evento só pode ser usado uma vez. */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferredPrompt
  if (!event) return 'unavailable'
  deferredPrompt = null
  setState({ installAvailable: false })
  try {
    await event.prompt()
    const { outcome } = await event.userChoice
    if (outcome === 'accepted') setState({ installed: true })
    return outcome
  } catch (error) {
    logError('pwa:promptInstall', error)
    return 'dismissed'
  }
}

/**
 * Esvazia os caches do service worker (chamado no logout). Com worker ativo, pede por mensagem
 * `CLEAR_CACHES` (ele também recompõe o essencial para o modo offline); sem worker, apaga
 * direto pela Cache API. Nunca lança: logout não pode falhar por causa de cache.
 */
export function clearServiceWorkerCaches(): void {
  try {
    if (typeof navigator === 'undefined') return
    const controller = 'serviceWorker' in navigator ? navigator.serviceWorker.controller : null
    if (controller) {
      controller.postMessage({ type: 'CLEAR_CACHES' })
      return
    }
    if (typeof caches !== 'undefined') {
      void caches
        .keys()
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k))))
        .catch(() => undefined)
    }
  } catch {
    // ignorado de propósito
  }
}

/** Rotas em que o convite de instalação NÃO aparece (autenticação, convites, onboarding — fluxos com foco). */
const INSTALL_PROMPT_EXCLUDED_PREFIXES = [
  '/login',
  '/convite/',
  '/convite-gerente/',
  '/esqueci-senha',
  '/redefinir-senha',
]

export function isInstallPromptExcludedRoute(pathname: string): boolean {
  if (pathname.includes('/onboarding')) return true
  return INSTALL_PROMPT_EXCLUDED_PREFIXES.some((prefix) =>
    prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}
