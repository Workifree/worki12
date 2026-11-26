/* eslint-env serviceworker */
/*
 * Worki — service worker (escrito à mão, sem Workbox).
 *
 * REGRA Nº 1: este worker NUNCA guarda dado de usuário. Só entram em cache arquivos ESTÁTICOS e
 * PÚBLICOS do próprio site (página offline, /assets/* com hash, ícones, fontes). Ficam de fora, sem
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
 *   navegação (HTML)         network-first; sem rede -> /offline.html. O HTML do app NÃO é
 *                            cacheado: sem rede o app não consegue validar a sessão e mostraria
 *                            login/onboarding, como se a pessoa tivesse sido deslogada.
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
const SCHEMA = 'v2'

const CORE_PREFIX = `${CACHE_PREFIX}core-`
const CORE_CACHE = `${CACHE_PREFIX}core-${SCHEMA}-${BUILD_ID}` // página offline; trocado a cada deploy
const ASSETS_CACHE = `${CACHE_PREFIX}assets-${SCHEMA}` // /assets/* com hash: imutável, compartilhado entre deploys
const STATIC_CACHE = `${CACHE_PREFIX}static-${SCHEMA}` // imagens/fontes: stale-while-revalidate
const KNOWN_CACHES = [CORE_CACHE, ASSETS_CACHE, STATIC_CACHE]

const MAX_ASSET_ENTRIES = 160
const MAX_STATIC_ENTRIES = 80

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
      // Garante o fallback offline: o cache core pode ter sumido enquanto este worker esperava.
      if (!(await caches.match(OFFLINE_URL, { cacheName: CORE_CACHE }))) {
        // Sem rede agora: a ativação não pode falhar por isso.
        await precacheCore().catch(() => undefined)
      }
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
    // Logout: apaga os caches e recompõe só o essencial para o modo offline. Os outros caches
    // `core` ficam: um deles pode ser do worker novo em espera (só têm arquivos públicos).
    event.waitUntil(
      (async () => {
        const names = await caches.keys()
        await Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && !name.startsWith(CORE_PREFIX))
            .map((name) => caches.delete(name)),
        )
        await caches.delete(CORE_CACHE)
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

async function handleNavigation(request) {
  try {
    return await fetch(request)
  } catch {
    const offline = await caches.match(OFFLINE_URL, { cacheName: CORE_CACHE })
    return offline || new Response('Sem conexão', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
}

/** Guardar em cache é melhor esforço: cota cheia não pode derrubar uma resposta que a rede entregou. */
async function storeSafely(cacheName, cache, request, response, maxEntries) {
  try {
    await cache.put(request, response)
    await trimCache(cacheName, maxEntries)
  } catch {
    // segue sem cache
  }
}

async function cacheFirstImmutable(request) {
  const cache = await caches.open(ASSETS_CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (isCacheableStatic(response)) {
    await storeSafely(ASSETS_CACHE, cache, request, response.clone(), MAX_ASSET_ENTRIES)
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
        await storeSafely(STATIC_CACHE, cache, event.request, response.clone(), MAX_STATIC_ENTRIES)
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

  // Navegação: só rotas do SPA (sem extensão). Arquivos abertos direto seguem para a rede.
  if (request.mode === 'navigate') {
    if (/\.[a-z0-9]+$/i.test(url.pathname)) return
    event.respondWith(handleNavigation(request))
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
 * Web Push (avisos multicanal). Não toca no cache nem no ciclo de vida acima.
 * Emissor: supabase/functions/notice-dispatch. O clique só ABRE uma tela: nunca executa ação.
 * ------------------------------------------------------------------------------------------- */

const DEFAULT_NOTICE_TITLE = 'Worki'

/** Só caminho relativo desta origem. Qualquer outra coisa vira '/'. */
function safeNoticePath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return '/'
  // barra invertida e espaços/controles são normalizados pelo navegador e poderiam virar outra origem
  if (path.includes('\\') || /\s|\p{Cc}/u.test(path)) return '/'
  try {
    return new URL(path, self.location.origin).origin === self.location.origin ? path : '/'
  } catch {
    return '/'
  }
}

function readPush(event) {
  try {
    const data = event.data ? event.data.json() : null
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

self.addEventListener('push', (event) => {
  const message = readPush(event)
  const data = message.data && typeof message.data === 'object' ? message.data : {}
  const options = {
    body: typeof message.body === 'string' ? message.body : 'Você tem um aviso novo. Abra o Worki.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    lang: 'pt-BR',
    data: { path: safeNoticePath(data.path), eventId: typeof data.eventId === 'string' ? data.eventId : null },
  }
  // mesma tag = o aviso é substituído, não empilhado
  if (typeof message.tag === 'string' && message.tag) options.tag = message.tag
  // Sempre mostra algo: o iOS cancela a inscrição de quem recebe push silencioso.
  const title = typeof message.title === 'string' && message.title ? message.title : DEFAULT_NOTICE_TITLE
  event.waitUntil(self.registration.showNotification(title, options))
})

async function openNotice(data) {
  const path = safeNoticePath(data.path)
  const target = new URL(path, self.location.origin)
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  // Reaproveita a janela que JÁ está nessa tela. Não navega as outras: perderia formulário aberto.
  const existing = windows.find((client) => {
    const url = new URL(client.url)
    return url.origin === target.origin && url.pathname === target.pathname
  })
  if (existing) {
    if (data.eventId) existing.postMessage({ type: 'NOTICE_OPENED', eventId: data.eventId })
    return existing.focus()
  }
  // ?aviso= deixa o app registrar a abertura (services/pushService.watchNoticeOpens).
  if (data.eventId) target.searchParams.set('aviso', data.eventId)
  return self.clients.openWindow(target.pathname + target.search)
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openNotice(event.notification.data || {}))
})
