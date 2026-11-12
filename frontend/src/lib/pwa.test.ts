import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Cada teste carrega o módulo do zero: `lib/pwa` guarda estado em variáveis de módulo
// (evento de instalação capturado, worker em espera, flag de init).
async function loadPwa() {
  vi.resetModules()
  return import('./pwa')
}

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing'
  postMessage = vi.fn()
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null
  installing: FakeWorker | null = null
  update = vi.fn().mockResolvedValue(undefined)
}

class FakeContainer extends EventTarget {
  controller: FakeWorker | null = null
  registration = new FakeRegistration()
  register = vi.fn().mockImplementation(async () => this.registration)
}

function installContainer(container: FakeContainer) {
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true })
}

function removeContainer() {
  // `delete` em propriedade da instância remove o stub e volta a "não suportado" (jsdom não tem SW).
  delete (navigator as unknown as Record<string, unknown>).serviceWorker
}

function fireInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  }
  event.prompt = vi.fn().mockResolvedValue(undefined)
  event.userChoice = Promise.resolve({ outcome })
  window.dispatchEvent(event)
  return event
}

describe('lib/pwa — instalação', () => {
  beforeEach(() => {
    removeContainer()
  })

  it('captura beforeinstallprompt, bloqueia o mini-infobar e expõe installAvailable', async () => {
    const pwa = await loadPwa()
    pwa.initPwa({ registerServiceWorker: false })
    expect(pwa.getPwaState().installAvailable).toBe(false)

    const event = fireInstallPrompt()

    expect(event.defaultPrevented).toBe(true)
    expect(pwa.getPwaState().installAvailable).toBe(true)
  })

  it('promptInstall abre o diálogo nativo, devolve o resultado e consome o evento (uso único)', async () => {
    const pwa = await loadPwa()
    pwa.initPwa({ registerServiceWorker: false })
    const event = fireInstallPrompt('accepted')

    await expect(pwa.promptInstall()).resolves.toBe('accepted')

    expect(event.prompt).toHaveBeenCalledTimes(1)
    expect(pwa.getPwaState()).toMatchObject({ installAvailable: false, installed: true })
    await expect(pwa.promptInstall()).resolves.toBe('unavailable')
  })

  it('promptInstall dispensado não marca como instalado', async () => {
    const pwa = await loadPwa()
    pwa.initPwa({ registerServiceWorker: false })
    fireInstallPrompt('dismissed')

    await expect(pwa.promptInstall()).resolves.toBe('dismissed')
    expect(pwa.getPwaState().installed).toBe(false)
  })

  it('promptInstall sem evento capturado devolve "unavailable"', async () => {
    const pwa = await loadPwa()
    pwa.initPwa({ registerServiceWorker: false })
    await expect(pwa.promptInstall()).resolves.toBe('unavailable')
  })

  it('appinstalled marca instalado e limpa o convite', async () => {
    const pwa = await loadPwa()
    pwa.initPwa({ registerServiceWorker: false })
    fireInstallPrompt()

    window.dispatchEvent(new Event('appinstalled'))

    expect(pwa.getPwaState()).toMatchObject({ installed: true, installAvailable: false })
  })

  it('initPwa é idempotente: duas chamadas não duplicam listeners', async () => {
    const pwa = await loadPwa()
    const listener = vi.fn()
    pwa.subscribePwa(listener)
    pwa.initPwa({ registerServiceWorker: false })
    pwa.initPwa({ registerServiceWorker: false })

    fireInstallPrompt()

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('subscribePwa notifica só em mudança real e permite cancelar', async () => {
    const pwa = await loadPwa()
    pwa.initPwa({ registerServiceWorker: false })
    const listener = vi.fn()
    const unsubscribe = pwa.subscribePwa(listener)

    window.dispatchEvent(new Event('appinstalled'))
    window.dispatchEvent(new Event('appinstalled')) // mesmo estado: sem nova notificação
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    fireInstallPrompt()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('reconhece modo standalone (display-mode e navigator.standalone do iOS)', async () => {
    const pwa = await loadPwa()
    expect(pwa.isStandalone()).toBe(false)

    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(display-mode: standalone)' }))
    expect(pwa.isStandalone()).toBe(true)
    vi.unstubAllGlobals()

    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    expect(pwa.isStandalone()).toBe(true)
    delete (navigator as unknown as Record<string, unknown>).standalone
  })
})

describe('lib/pwa — detecção de plataforma', () => {
  const originalUa = navigator.userAgent
  const setUa = (ua: string) => Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })

  afterEach(() => setUa(originalUa))

  it('Safari no iPhone → true', async () => {
    const pwa = await loadPwa()
    setUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1')
    expect(pwa.isIosSafari()).toBe(true)
  })

  it('Chrome no iPhone (CriOS) → false', async () => {
    const pwa = await loadPwa()
    setUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0 Mobile/15E148 Safari/604.1')
    expect(pwa.isIosSafari()).toBe(false)
  })

  it('Chrome no Android → false', async () => {
    const pwa = await loadPwa()
    setUa('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Mobile Safari/537.36')
    expect(pwa.isIosSafari()).toBe(false)
  })
})

describe('lib/pwa — dispensa do convite', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('sem registro → não dispensado', async () => {
    const pwa = await loadPwa()
    expect(pwa.isInstallDismissed()).toBe(false)
  })

  it('dispensado dentro do TTL → true; depois do TTL → volta a poder aparecer', async () => {
    const pwa = await loadPwa()
    const now = 1_700_000_000_000
    pwa.rememberInstallDismissed(now)

    expect(pwa.isInstallDismissed(now + 1000)).toBe(true)
    expect(pwa.isInstallDismissed(now + pwa.INSTALL_DISMISS_TTL_MS + 1)).toBe(false)
  })

  it('valor corrompido no localStorage é ignorado', async () => {
    const pwa = await loadPwa()
    window.localStorage.setItem(pwa.INSTALL_DISMISS_KEY, 'lixo')
    expect(pwa.isInstallDismissed()).toBe(false)
  })

  it('localStorage indisponível (modo privado) nunca lança', async () => {
    const pwa = await loadPwa()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(() => pwa.rememberInstallDismissed()).not.toThrow()
    expect(pwa.isInstallDismissed()).toBe(false)
  })
})

describe('lib/pwa — rotas sem convite de instalação', () => {
  it.each([
    ['/login', true],
    ['/convite/abc123', true],
    ['/convite-gerente/abc123', true],
    ['/esqueci-senha', true],
    ['/redefinir-senha', true],
    ['/worker/onboarding', true],
    ['/company/onboarding', true],
    ['/dashboard', false],
    ['/my-jobs', false],
    ['/company/dashboard', false],
    ['/loginfoo', false],
  ])('%s → excluída=%s', async (path, excluded) => {
    const pwa = await loadPwa()
    expect(pwa.isInstallPromptExcludedRoute(path)).toBe(excluded)
  })
})

describe('lib/pwa — service worker', () => {
  let container: FakeContainer

  beforeEach(() => {
    container = new FakeContainer()
    installContainer(container)
  })

  afterEach(() => {
    removeContainer()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('não registra quando desabilitado (dev/teste)', async () => {
    const pwa = await loadPwa()
    pwa.registerServiceWorker(false)
    pwa.initPwa({ registerServiceWorker: false })
    await Promise.resolve()
    expect(container.register).not.toHaveBeenCalled()
  })

  it('não quebra quando o navegador não suporta service worker', async () => {
    removeContainer()
    const pwa = await loadPwa()
    expect(() => pwa.registerServiceWorker(true)).not.toThrow()
  })

  it('registra /sw.js com escopo "/" e sem cache HTTP do script', async () => {
    const pwa = await loadPwa()
    pwa.registerServiceWorker(true)

    await vi.waitFor(() => expect(container.register).toHaveBeenCalledTimes(1))
    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
  })

  it('nova versão instalada com página já controlada → updateAvailable', async () => {
    const pwa = await loadPwa()
    container.controller = new FakeWorker()
    pwa.registerServiceWorker(true)
    await vi.waitFor(() => expect(container.register).toHaveBeenCalled())

    const installing = new FakeWorker()
    container.registration.installing = installing
    container.registration.dispatchEvent(new Event('updatefound'))
    expect(pwa.getPwaState().updateAvailable).toBe(false) // ainda instalando

    installing.state = 'installed'
    installing.dispatchEvent(new Event('statechange'))

    expect(pwa.getPwaState().updateAvailable).toBe(true)
  })

  it('primeira instalação (sem controller) NÃO conta como atualização', async () => {
    const pwa = await loadPwa()
    container.controller = null
    pwa.registerServiceWorker(true)
    await vi.waitFor(() => expect(container.register).toHaveBeenCalled())

    const installing = new FakeWorker()
    container.registration.installing = installing
    container.registration.dispatchEvent(new Event('updatefound'))
    installing.state = 'installed'
    installing.dispatchEvent(new Event('statechange'))

    expect(pwa.getPwaState().updateAvailable).toBe(false)
  })

  it('worker já em espera na abertura da página → updateAvailable', async () => {
    const pwa = await loadPwa()
    container.controller = new FakeWorker()
    container.registration.waiting = new FakeWorker()
    pwa.registerServiceWorker(true)

    await vi.waitFor(() => expect(pwa.getPwaState().updateAvailable).toBe(true))
  })

  it('applyPwaUpdate manda SKIP_WAITING ao worker em espera e recarrega só quando ele assume', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const pwa = await loadPwa()
    const waiting = new FakeWorker()
    container.controller = new FakeWorker()
    container.registration.waiting = waiting
    pwa.registerServiceWorker(true)
    await vi.waitFor(() => expect(pwa.getPwaState().updateAvailable).toBe(true))

    pwa.applyPwaUpdate()
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(reload).not.toHaveBeenCalled()

    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('controllerchange SEM o usuário ter pedido (claim da 1ª instalação) não recarrega a tela', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const pwa = await loadPwa()
    pwa.registerServiceWorker(true)
    await vi.waitFor(() => expect(container.register).toHaveBeenCalled())

    container.dispatchEvent(new Event('controllerchange'))

    expect(reload).not.toHaveBeenCalled()
  })

  it('applyPwaUpdate recarrega por garantia se o controllerchange não vier', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const pwa = await loadPwa()
    container.controller = new FakeWorker()
    container.registration.waiting = new FakeWorker()
    pwa.registerServiceWorker(true)
    await vi.waitFor(() => expect(pwa.getPwaState().updateAvailable).toBe(true))

    vi.useFakeTimers()
    pwa.applyPwaUpdate()
    vi.advanceTimersByTime(3500)

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('clearServiceWorkerCaches pede CLEAR_CACHES ao worker ativo (logout)', async () => {
    const pwa = await loadPwa()
    container.controller = new FakeWorker()

    pwa.clearServiceWorkerCaches()

    expect(container.controller.postMessage).toHaveBeenCalledWith({ type: 'CLEAR_CACHES' })
  })

  it('clearServiceWorkerCaches nunca lança, mesmo sem worker nem Cache API', async () => {
    removeContainer()
    const pwa = await loadPwa()
    expect(() => pwa.clearServiceWorkerCaches()).not.toThrow()
  })
})
