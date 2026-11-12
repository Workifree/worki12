// @vitest-environment node
/**
 * Guarda de SEGURANÇA do service worker (public/sw.js).
 *
 * O sw.js é JavaScript puro servido como arquivo estático — o TypeScript e o lint não o enxergam.
 * Estes testes o executam como função isolada (`new Function`) com `self`, `caches` e `fetch` falsos para
 * travar a regra que não pode regredir: NUNCA interceptar/cachear Supabase, não-GET,
 * Authorization ou rotas de API; e manter o ciclo de vida (skipWaiting só por mensagem).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
// ?raw: lê o arquivo como texto pelo Vite (sem node:fs, que o tsconfig.app não tipa).
import swRaw from '../../public/sw.js?raw'

const ORIGIN = 'https://worki.test'
const SW_SOURCE = swRaw.replaceAll('__BUILD_ID__', 'test-build')

interface RequestLike {
  url: string
  method: string
  headers: Headers
  mode: string
  destination: string
}

interface SwEvent {
  request?: RequestLike
  data?: unknown
  source?: { postMessage: (message: unknown) => void }
  respondWith: (response: Promise<Response>) => void
  waitUntil: (promise: Promise<unknown>) => void
}

type Handler = (event: SwEvent) => void

/** CacheStorage mínimo: chave = URL. Preserva ordem de inserção como o real. */
class FakeCache {
  entries = new Map<string, Response>()
  private key(request: string | RequestLike): string {
    const raw = typeof request === 'string' ? request : request.url
    return raw.startsWith('/') ? ORIGIN + raw : raw
  }
  async put(request: string | RequestLike, response: Response) {
    this.entries.set(this.key(request), response)
  }
  async add(request: string) {
    const response = await fetchMock(request)
    if (!response.ok) throw new Error(`falha ao cachear ${request}`)
    await this.put(request, response)
  }
  async addAll(requests: string[]) {
    await Promise.all(requests.map((request) => this.add(request)))
  }
  async match(request: string | RequestLike) {
    return this.entries.get(this.key(request))?.clone()
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }))
  }
  async delete(request: string | { url: string }) {
    return this.entries.delete(typeof request === 'string' ? request : request.url)
  }
}

class FakeCacheStorage {
  stores = new Map<string, FakeCache>()
  async open(name: string) {
    let cache = this.stores.get(name)
    if (!cache) {
      cache = new FakeCache()
      this.stores.set(name, cache)
    }
    return cache
  }
  async keys() {
    return [...this.stores.keys()]
  }
  async delete(name: string) {
    return this.stores.delete(name)
  }
  async match(request: string | RequestLike, options?: { cacheName?: string }) {
    const names = options?.cacheName ? [options.cacheName] : [...this.stores.keys()]
    for (const name of names) {
      const hit = await this.stores.get(name)?.match(request)
      if (hit) return hit
    }
    return undefined
  }
}

let network: Map<string, () => Response>
let online: boolean
let fetchLog: string[]
let caches: FakeCacheStorage
let handlers: Record<string, Handler>
let skipWaiting: ReturnType<typeof vi.fn>
let claim: ReturnType<typeof vi.fn>

function fetchMock(input: string | RequestLike): Promise<Response> {
  const raw = typeof input === 'string' ? input : input.url
  const url = raw.startsWith('/') ? ORIGIN + raw : raw
  fetchLog.push(url)
  if (!online) return Promise.reject(new TypeError('Failed to fetch'))
  const make = network.get(url)
  return Promise.resolve(make ? make() : new Response('not found', { status: 404 }))
}

function loadSw() {
  handlers = {}
  skipWaiting = vi.fn()
  claim = vi.fn().mockResolvedValue(undefined)
  const self = {
    location: { origin: ORIGIN },
    clients: { claim },
    skipWaiting,
    addEventListener: (type: string, handler: Handler) => {
      handlers[type] = handler
    },
  }
  // O worker usa `self`, `caches` e `fetch` como globais: aqui entram como parâmetros (falsos).
  new Function('self', 'caches', 'fetch', SW_SOURCE)(self, caches, fetchMock)
}

function makeRequest(
  path: string,
  init: Partial<Omit<RequestLike, 'headers'>> & { headers?: Record<string, string> } = {},
): RequestLike {
  return {
    url: path.startsWith('http') ? path : ORIGIN + path,
    method: init.method ?? 'GET',
    headers: new Headers(init.headers),
    mode: init.mode ?? 'cors',
    destination: init.destination ?? '',
  }
}

/** Dispara o evento `fetch` e devolve a resposta (ou `null` se o worker NÃO interceptou). */
async function dispatchFetch(request: RequestLike): Promise<Response | null> {
  let responded: Promise<Response> | null = null
  const waits: Promise<unknown>[] = []
  handlers.fetch({
    request,
    respondWith: (promise) => {
      responded = promise
    },
    waitUntil: (promise) => {
      waits.push(promise)
    },
  })
  const response = responded ? await (responded as Promise<Response>) : null
  await Promise.all(waits)
  return response
}

async function runLifecycle(type: 'install' | 'activate') {
  const waits: Promise<unknown>[] = []
  handlers[type]({ respondWith: () => undefined, waitUntil: (p) => waits.push(p) })
  await Promise.all(waits)
}

async function sendMessage(data: unknown, source?: SwEvent['source']) {
  const waits: Promise<unknown>[] = []
  handlers.message({ data, source, respondWith: () => undefined, waitUntil: (p) => waits.push(p) })
  await Promise.all(waits)
}

const html = (body = '<html></html>') => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
const js = () => new Response('console.log(1)', { status: 200, headers: { 'content-type': 'text/javascript' } })
const png = (headers: Record<string, string> = {}) =>
  new Response('png', { status: 200, headers: { 'content-type': 'image/png', ...headers } })

const SHELL_HTML =
  '<html><head><script type="module" src="/assets/index-abc.js"></script>' +
  '<link rel="stylesheet" href="/assets/index-abc.css"></head><body></body></html>'

beforeEach(() => {
  online = true
  fetchLog = []
  caches = new FakeCacheStorage()
  network = new Map<string, () => Response>([
    [`${ORIGIN}/`, () => html(SHELL_HTML)],
    // O rewrite SPA da Vercel devolve a mesma casca para qualquer rota do app.
    [`${ORIGIN}/my-jobs`, () => html(SHELL_HTML)],
    [`${ORIGIN}/company/jobs`, () => html(SHELL_HTML)],
    [`${ORIGIN}/offline.html`, () => html('<h1>offline</h1>')],
    [`${ORIGIN}/offline.js`, js],
    [`${ORIGIN}/manifest.webmanifest`, () => new Response('{}', { status: 200, headers: { 'content-type': 'application/manifest+json' } })],
    [`${ORIGIN}/icon-192.png`, () => png()],
    [`${ORIGIN}/favicon.svg`, () => new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } })],
    [`${ORIGIN}/assets/index-abc.js`, js],
    [`${ORIGIN}/assets/index-abc.css`, () => new Response('a{}', { status: 200, headers: { 'content-type': 'text/css' } })],
  ])
  loadSw()
})

describe('sw.js — o que NUNCA intercepta (segurança)', () => {
  it('Supabase (outra origem) passa direto para a rede, em qualquer caminho', async () => {
    for (const path of ['/rest/v1/jobs', '/auth/v1/token', '/functions/v1/admin-data', '/realtime/v1/websocket', '/storage/v1/object/avatars/a.png']) {
      const response = await dispatchFetch(makeRequest(`https://abc.supabase.co${path}`))
      expect(response, path).toBeNull()
    }
  })

  it('nenhuma outra origem é interceptada (Sentry, Asaas, CDN)', async () => {
    expect(await dispatchFetch(makeRequest('https://o1.ingest.sentry.io/api/1/envelope/'))).toBeNull()
    expect(await dispatchFetch(makeRequest('https://api.asaas.com/v3/payments'))).toBeNull()
    expect(await dispatchFetch(makeRequest('https://cdn.example.com/logo.png', { destination: 'image' }))).toBeNull()
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('método %s nunca é interceptado', async (method) => {
    expect(await dispatchFetch(makeRequest('/assets/index-abc.js', { method }))).toBeNull()
    expect(await dispatchFetch(makeRequest('/my-jobs', { method, mode: 'navigate' }))).toBeNull()
  })

  it('request com Authorization ou Range nunca é interceptado', async () => {
    expect(await dispatchFetch(makeRequest('/assets/index-abc.js', { headers: { Authorization: 'Bearer x' } }))).toBeNull()
    expect(await dispatchFetch(makeRequest('/icon-192.png', { destination: 'image', headers: { Range: 'bytes=0-10' } }))).toBeNull()
  })

  it('caminhos de API same-origin (/rest, /auth, /functions, /realtime, /storage, /api) nunca são interceptados', async () => {
    for (const path of ['/rest/v1/x.png', '/auth/v1/user', '/functions/v1/x', '/realtime/v1/x', '/storage/v1/x.png', '/api/anything']) {
      expect(await dispatchFetch(makeRequest(path, { destination: 'image' })), path).toBeNull()
    }
  })

  it('o próprio sw.js e o manifesto sempre vão à rede', async () => {
    expect(await dispatchFetch(makeRequest('/sw.js'))).toBeNull()
    expect(await dispatchFetch(makeRequest('/manifest.webmanifest'))).toBeNull()
  })

  it('GET same-origin que não é navegação/asset/imagem (ex.: JSON) segue para a rede', async () => {
    expect(await dispatchFetch(makeRequest('/dados.json'))).toBeNull()
  })

  it('/offline.html aberto direto não é tratado como casca do SPA', async () => {
    expect(await dispatchFetch(makeRequest('/offline.html', { mode: 'navigate' }))).toBeNull()
  })
})

describe('sw.js — navegação (network-first)', () => {
  it('online: devolve a resposta da rede e atualiza a casca em cache', async () => {
    const response = await dispatchFetch(makeRequest('/my-jobs', { mode: 'navigate' }))

    expect(response).not.toBeNull()
    expect(await response!.text()).toBe(SHELL_HTML)
    const core = [...caches.stores.keys()].find((name) => name.startsWith('worki-core-'))!
    expect(await caches.stores.get(core)!.match('/')).toBeDefined()
  })

  it('offline com casca em cache: abre o app (casca), não a página de erro do navegador', async () => {
    await dispatchFetch(makeRequest('/my-jobs', { mode: 'navigate' })) // visita online
    online = false

    const response = await dispatchFetch(makeRequest('/company/jobs', { mode: 'navigate' }))

    expect(await response!.text()).toBe(SHELL_HTML)
  })

  it('offline sem casca: cai em /offline.html (pré-cacheado no install)', async () => {
    await runLifecycle('install')
    const core = [...caches.stores.keys()].find((name) => name.startsWith('worki-core-'))!
    await caches.stores.get(core)!.delete(`${ORIGIN}/`) // simula install sem a casca
    online = false

    const response = await dispatchFetch(makeRequest('/my-jobs', { mode: 'navigate' }))

    expect(await response!.text()).toBe('<h1>offline</h1>')
  })

  it('offline sem nada em cache: 503 em texto (nunca quebra com exceção)', async () => {
    online = false
    const response = await dispatchFetch(makeRequest('/my-jobs', { mode: 'navigate' }))
    expect(response!.status).toBe(503)
  })

  it('não guarda como casca uma resposta de erro (404/500) nem não-HTML', async () => {
    network.set(`${ORIGIN}/quebrada`, () => new Response('erro', { status: 500, headers: { 'content-type': 'text/html' } }))
    await dispatchFetch(makeRequest('/quebrada', { mode: 'navigate' }))
    const core = [...caches.stores.keys()].find((name) => name.startsWith('worki-core-'))
    expect(core ? await caches.stores.get(core)!.match('/') : undefined).toBeUndefined()
  })
})

describe('sw.js — assets com hash (cache-first imutável)', () => {
  it('1ª vez vai à rede e guarda; 2ª vez sai do cache sem tocar a rede', async () => {
    await dispatchFetch(makeRequest('/assets/index-abc.js', { destination: 'script' }))
    fetchLog = []

    const response = await dispatchFetch(makeRequest('/assets/index-abc.js', { destination: 'script' }))

    expect(await response!.text()).toBe('console.log(1)')
    expect(fetchLog).toEqual([])
  })

  it('NÃO guarda HTML servido no lugar de um asset (rewrite SPA devolvendo 200 + index.html)', async () => {
    network.set(`${ORIGIN}/assets/antigo-123.js`, () => html('<!doctype html>'))
    await dispatchFetch(makeRequest('/assets/antigo-123.js', { destination: 'script' }))
    fetchLog = []

    await dispatchFetch(makeRequest('/assets/antigo-123.js', { destination: 'script' }))

    expect(fetchLog).toEqual([`${ORIGIN}/assets/antigo-123.js`]) // foi à rede de novo: não ficou preso em cache
  })

  it('NÃO guarda 404', async () => {
    await dispatchFetch(makeRequest('/assets/nao-existe.js', { destination: 'script' }))
    fetchLog = []
    await dispatchFetch(makeRequest('/assets/nao-existe.js', { destination: 'script' }))
    expect(fetchLog.length).toBe(1)
  })

  it('limita o tamanho do cache (descarta os mais antigos)', async () => {
    for (let i = 0; i < 170; i += 1) {
      network.set(`${ORIGIN}/assets/chunk-${i}.js`, js)
      await dispatchFetch(makeRequest(`/assets/chunk-${i}.js`, { destination: 'script' }))
    }
    const assets = caches.stores.get('worki-assets-v1')!
    expect(assets.entries.size).toBeLessThanOrEqual(160)
    expect(assets.entries.has(`${ORIGIN}/assets/chunk-169.js`)).toBe(true)
    expect(assets.entries.has(`${ORIGIN}/assets/chunk-0.js`)).toBe(false)
  })
})

describe('sw.js — imagens e fontes (stale-while-revalidate)', () => {
  it('serve do cache e revalida em segundo plano', async () => {
    network.set(`${ORIGIN}/logo.png`, () => png())
    await dispatchFetch(makeRequest('/logo.png', { destination: 'image' }))
    fetchLog = []

    const response = await dispatchFetch(makeRequest('/logo.png', { destination: 'image' }))

    expect(await response!.text()).toBe('png')
    expect(fetchLog).toEqual([`${ORIGIN}/logo.png`]) // revalidou
  })

  it('respostas com Cache-Control private/no-store não entram em cache', async () => {
    network.set(`${ORIGIN}/foto.png`, () => png({ 'cache-control': 'private, max-age=60' }))
    network.set(`${ORIGIN}/foto2.png`, () => png({ 'cache-control': 'no-store' }))
    await dispatchFetch(makeRequest('/foto.png', { destination: 'image' }))
    await dispatchFetch(makeRequest('/foto2.png', { destination: 'image' }))

    const statics = caches.stores.get('worki-static-v1')
    expect(statics?.entries.size ?? 0).toBe(0)
  })

  it('offline: ícone pré-cacheado no install continua disponível', async () => {
    await runLifecycle('install')
    online = false

    const response = await dispatchFetch(makeRequest('/icon-192.png', { destination: 'image' }))

    expect(await response!.text()).toBe('png')
  })
})

describe('sw.js — ciclo de vida e mensagens', () => {
  it('install pré-cacheia offline + casca + assets referenciados, e NÃO chama skipWaiting sozinho', async () => {
    await runLifecycle('install')

    expect(skipWaiting).not.toHaveBeenCalled()
    const core = caches.stores.get([...caches.stores.keys()].find((n) => n.startsWith('worki-core-'))!)!
    expect(core.entries.has(`${ORIGIN}/offline.html`)).toBe(true)
    expect(core.entries.has(`${ORIGIN}/`)).toBe(true)
    const assets = caches.stores.get('worki-assets-v1')!
    expect(assets.entries.has(`${ORIGIN}/assets/index-abc.js`)).toBe(true)
    expect(assets.entries.has(`${ORIGIN}/assets/index-abc.css`)).toBe(true)
  })

  it('install não falha se a casca estiver indisponível (melhor esforço)', async () => {
    network.set(`${ORIGIN}/`, () => new Response('x', { status: 500 }))
    await expect(runLifecycle('install')).resolves.toBeUndefined()
  })

  it('SKIP_WAITING só por mensagem', async () => {
    await sendMessage({ type: 'SKIP_WAITING' })
    expect(skipWaiting).toHaveBeenCalledTimes(1)
  })

  it('mensagens desconhecidas ou malformadas são ignoradas', async () => {
    await sendMessage(undefined)
    await sendMessage('texto')
    await sendMessage({ type: 'OUTRA' })
    expect(skipWaiting).not.toHaveBeenCalled()
  })

  it('activate apaga caches antigos do Worki, preserva os atuais e os de terceiros, e assume o controle', async () => {
    await runLifecycle('install')
    await caches.open('worki-core-v1-build-antigo')
    await caches.open('worki-assets-v0')
    await caches.open('outro-app-cache')

    await runLifecycle('activate')

    const names = await caches.keys()
    expect(names).not.toContain('worki-core-v1-build-antigo')
    expect(names).not.toContain('worki-assets-v0')
    expect(names).toContain('outro-app-cache')
    expect(names).toContain('worki-core-v1-test-build')
    expect(names).toContain('worki-assets-v1')
    expect(claim).toHaveBeenCalled()
  })

  it('CLEAR_CACHES (logout) apaga tudo do Worki e recompõe só o essencial offline', async () => {
    await runLifecycle('install')
    await dispatchFetch(makeRequest('/logo.png', { destination: 'image' }))
    await caches.open('outro-app-cache')

    await sendMessage({ type: 'CLEAR_CACHES' })

    const names = await caches.keys()
    expect(names).toContain('outro-app-cache')
    expect(caches.stores.get('worki-static-v1')).toBeUndefined()
    const core = caches.stores.get('worki-core-v1-test-build')!
    expect(core.entries.has(`${ORIGIN}/offline.html`)).toBe(true)
  })

  it('GET_VERSION responde ao cliente com o id do build', async () => {
    const postMessage = vi.fn()
    await sendMessage({ type: 'GET_VERSION' }, { postMessage })
    expect(postMessage).toHaveBeenCalledWith({ type: 'VERSION', buildId: 'test-build' })
  })
})
