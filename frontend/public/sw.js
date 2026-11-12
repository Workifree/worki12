/* eslint-env serviceworker */
/*
 * Worki — service worker (escrito à mão, sem Workbox).
 *
 * REGRA Nº 1: este worker NUNCA guarda dado de usuário. Só entram em cache arquivos ESTÁTICOS e
 * PÚBLICOS do próprio site (casca HTML, /assets/* com hash, ícones, fontes). Ficam de fora, sem
 * exceção:
 *   - qualquer origem diferente da nossa (Supabase *.supabase.co, Sentry, Asaas...);
 *   - caminhos de API mesmo que algum dia sejam same-origin (/rest/, /auth/, /functions/,
 *     /realtime/, /storage/, /api/);
 *   - qualquer método que não seja GET;
 *   - requests com cabeçalho Authorization ou Range;
 *   - respostas com Cache-Control no-store/private, ou que não sejam 200.
 * Tudo que não casa com uma estratégia abaixo passa direto para a rede (o worker nem chama
 * respondWith) — o comportamento padrão do navegador é o fallback seguro.
 *
 * Estratégias:
 *   navegação (HTML)         network-first; sem rede -> casca em cache -> /offline.html
 *   /assets/* (hash no nome)  cache-first, imutável
 *   imagens / fontes / ícones stale-while-revalidate
 *
 * Versionamento: __BUILD_ID__ é trocado no `vite build` (plugin em vite.config.ts), então cada
 * deploy gera um sw.js diferente byte a byte -> o navegador detecta, instala o novo worker e a UI
 * (lib/pwa.ts + PwaPrompts) oferece "Atualizar". O worker novo NÃO assume sozinho: espera a
 * mensagem SKIP_WAITING enviada pelo botão.
 */

const BUILD_ID = '__BUILD_ID__'

/** Prefixo comum a todos os caches do Worki (lib/pwa.ts apaga por este prefixo). */
const CACHE_PREFIX = 'worki-'
/** Muda quando a ESTRUTURA dos caches muda (não a cada deploy). */
const SCHEMA = 'v1'

const CORE_CACHE = `${CACHE_PREFIX}core-${SCHEMA}-${BUILD_ID}` // casca + offline; trocado a cada deploy
const ASSETS_CACHE = `${CACHE_PREFIX}assets-${SCHEMA}` // /assets/* com hash: imutável, compartilhado entre deploys
const STATIC_CACHE = `${CACHE_PREFIX}static-${SCHEMA}` // imagens/fontes: stale-while-revalidate
const KNOWN_CACHES = [CORE_CACHE, ASSETS_CACHE, STATIC_CACHE]

const MAX_ASSET_ENTRIES = 160
const MAX_STATIC_ENTRIES = 80

const SHELL_URL = '/'
const OFFLINE_URL = '/offline.html'

/** Obrigatório no install: sem isto não há fallback offline. */
const PRECACHE_REQUIRED = [OFFLINE_URL, '/offline.js']
/** Melhor esforço: se algum falhar, o install segue. */
const PRECACHE_OPTIONAL = ['/manifest.webmanifest', '/icon-192.png', '/favicon.svg']

const API_PATH_PREFIXES = ['/rest/', '/auth/', '/functions/', '/realtime/', '/storage/', '/api/']

/* ------------------------------------------------------------------------------------------- *
 * Helpers
 * ------------------------------------------------------------------------------------------- */

function isHtmlResponse(response) {
  const type = response.headers.get('content-type') || ''
  return type.includes('text/html')
}

/**
 * Só vale guardar resposta 200, não-HTML (para assets) e sem diretiva de privacidade.
 * O rewrite SPA da Vercel devolve index.html (HTML, 200) para URL inexistente — sem esta checagem,
 * um /assets/chunk-antigo.js "quebrado" ficaria cacheado como HTML para sempre.
 */
function isCacheableStatic(response) {
  if (!response || response.status !== 200 || response.type === 'opaque') return false
  if (isHtmlResponse(response)) return false
  const cacheControl = (response.headers.get('cache-control') || '').toLowerCase()
  if (cacheControl.includes('no-store') || cacheControl.includes('private')) return false
  if ((response.headers.get('vary') || '').includes('*')) return false
  return true
}

function isApiPath(pathname) {
  return API_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  // keys() vem em ordem de inserção: apaga as mais antigas primeiro.
  for (let i = 0; i < keys.length - maxEntries; i += 1) {
    await cache.delete(keys[i])
  }
}

/** URLs /assets/... referenciadas pela casca (script, modulepreload, css). */
function extractAssetUrls(html) {
  const urls = new Set()
  const pattern = /(?:src|href)="(\/assets\/[^"]+)"/g
  let match = pattern.exec(html)
  while (match) {
    urls.add(match[1])
    match = pattern.exec(html)
  }
  return [...urls]
}

/**
 * Guarda a casca atual (index.html) e os assets que ela referencia. Sem isso, abrir o app pela
 * primeira vez já offline mostraria uma casca sem JavaScript. Melhor esforço: nunca derruba o install.
 */
async function precacheShell() {
  try {
    const response = await fetch(SHELL_URL, { cache: 'reload' })
    if (!response.ok || !isHtmlResponse(response)) return
    const html = await response.clone().text()
    const core = await caches.open(CORE_CACHE)
    await core.put(SHELL_URL, response)

    const assets = await caches.open(ASSETS_CACHE)
    await Promise.all(
      extractAssetUrls(html).map(async (url) => {
        try {
          if (await assets.match(url)) return
          const asset = await fetch(url)
          if (isCacheableStatic(asset)) await assets.put(url, asset)
        } catch {
          // asset isolado falhou — será baixado sob demanda (cache-first)
        }
      }),
    )
  } catch {
    // sem rede no install da casca: o runtime reaproveita a navegação seguinte
  }
}

async function precacheCore() {
  const core = await caches.open(CORE_CACHE)
  await core.addAll(PRECACHE_REQUIRED)
  await Promise.all(
    PRECACHE_OPTIONAL.map(async (url) => {
      try {
        await core.add(url)
      } catch {
        // opcional
      }
    }),
  )
  await precacheShell()
}

/* ------------------------------------------------------------------------------------------- *
 * Ciclo de vida
 * ------------------------------------------------------------------------------------------- */

self.addEventListener('install', (event) => {
  // SEM skipWaiting aqui: a troca de versão só acontece quando o usuário aceita (mensagem abaixo).
  event.waitUntil(precacheCore())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && !KNOWN_CACHES.includes(name))
          .map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

/* ------------------------------------------------------------------------------------------- *
 * Mensagens da página (lib/pwa.ts)
 * ------------------------------------------------------------------------------------------- */

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || typeof data.type !== 'string') return

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting()
    return
  }

  if (data.type === 'CLEAR_CACHES') {
    // Logout: apaga TUDO e recompõe só o essencial para o modo offline.
    event.waitUntil(
      (async () => {
        const names = await caches.keys()
        await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)))
        await precacheCore()
      })(),
    )
    return
  }

  if (data.type === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', buildId: BUILD_ID })
  }
})

/* ------------------------------------------------------------------------------------------- *
 * Estratégias de fetch
 * ------------------------------------------------------------------------------------------- */

async function handleNavigation(event) {
  try {
    const response = await fetch(event.request)
    // Atualiza a casca em cache a cada navegação bem-sucedida (todas as rotas do SPA devolvem o mesmo index.html).
    if (response.ok && isHtmlResponse(response)) {
      const copy = response.clone()
      event.waitUntil(
        caches.open(CORE_CACHE).then((cache) => cache.put(SHELL_URL, copy)),
      )
    }
    return response
  } catch {
    // Sem rede: 1) casca do app (abre a UI e as telas já visitadas), 2) página offline.
    const shell = await caches.match(SHELL_URL, { cacheName: CORE_CACHE })
    if (shell) return shell
    const offline = await caches.match(OFFLINE_URL, { cacheName: CORE_CACHE })
    return offline || new Response('Sem conexão', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
}

async function cacheFirstImmutable(request) {
  const cache = await caches.open(ASSETS_CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (isCacheableStatic(response)) {
    await cache.put(request, response.clone())
    await trimCache(ASSETS_CACHE, MAX_ASSET_ENTRIES)
  }
  return response
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(STATIC_CACHE)
  // Os arquivos pré-cacheados no install (ícone, offline.js) vivem no cache 'core' — consultado
  // também, senão o modo offline não os acharia.
  const hit = (await cache.match(event.request)) || (await caches.match(event.request, { cacheName: CORE_CACHE }))
  const refresh = fetch(event.request)
    .then(async (response) => {
      if (isCacheableStatic(response)) {
        await cache.put(event.request, response.clone())
        await trimCache(STATIC_CACHE, MAX_STATIC_ENTRIES)
      }
      return response
    })
    .catch(() => undefined)

  if (hit) {
    event.waitUntil(refresh)
    return hit
  }
  const fresh = await refresh
  return fresh || Response.error()
}

const STATIC_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf)$/i

self.addEventListener('fetch', (event) => {
  const request = event.request

  // Seguro por padrão: só GET, sem Authorization, sem Range.
  if (request.method !== 'GET') return
  if (request.headers.has('authorization') || request.headers.has('range')) return

  const url = new URL(request.url)

  // Só a nossa origem. Supabase, Sentry, Asaas etc. NUNCA passam por aqui.
  if (url.origin !== self.location.origin) return
  if (isApiPath(url.pathname)) return

  // O próprio worker e o manifesto sempre vão à rede (o navegador cuida da revalidação).
  if (url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest') return

  // Navegação: só rotas do SPA (sem extensão). /offline.html aberto direto não é "casca".
  if (request.mode === 'navigate') {
    if (/\.[a-z0-9]+$/i.test(url.pathname)) return
    event.respondWith(handleNavigation(event))
    return
  }

  // Assets com hash do Vite: imutáveis.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirstImmutable(request))
    return
  }

  // Ícones, imagens e fontes estáticas do próprio site.
  if (
    request.destination === 'image' ||
    request.destination === 'font' ||
    STATIC_EXTENSIONS.test(url.pathname) ||
    url.pathname === '/offline.js'
  ) {
    event.respondWith(staleWhileRevalidate(event))
  }
  // Todo o resto (ex.: JSON, XHR same-origin) segue direto para a rede.
})

/* ------------------------------------------------------------------------------------------- *
 * PUSH — fase futura (exige backend + chaves VAPID)
 *
 * Quando houver backend de push, os handlers entram aqui:
 *   self.addEventListener('push', (event) => { ... self.registration.showNotification(...) })
 *   self.addEventListener('notificationclick', (event) => { ... clients.openWindow(url) })
 * Mantidos fora do arquivo hoje de propósito: handler de push sem emissor é superfície morta.
 * ------------------------------------------------------------------------------------------- */
