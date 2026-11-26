// @vitest-environment node
/** Handlers de push do public/sw.js (o ciclo de vida e o cache são cobertos em serviceWorker.test.ts). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import swRaw from '../../public/sw.js?raw'

const ORIGIN = 'https://worki.test'

type Handler = (event: Record<string, unknown>) => void

let handlers: Record<string, Handler>
let showNotification: ReturnType<typeof vi.fn>
let openWindow: ReturnType<typeof vi.fn>
let windows: { url: string; focus: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> }[]
let skipWaiting: ReturnType<typeof vi.fn>

beforeEach(() => {
  handlers = {}
  windows = []
  showNotification = vi.fn().mockResolvedValue(undefined)
  openWindow = vi.fn().mockResolvedValue(undefined)
  skipWaiting = vi.fn()
  const self = {
    location: { origin: ORIGIN },
    clients: { claim: vi.fn(), matchAll: async () => windows, openWindow },
    registration: { showNotification },
    skipWaiting,
    addEventListener: (type: string, handler: Handler) => {
      handlers[type] = handler
    },
  }
  new Function('self', 'caches', 'fetch', swRaw)(self, {}, vi.fn())
})

async function dispatch(type: string, event: Record<string, unknown>) {
  const waits: Promise<unknown>[] = []
  handlers[type]({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) })
  await Promise.all(waits)
}

const push = (payload: unknown) => dispatch('push', { data: { json: () => payload } })
const click = (data: unknown) => dispatch('notificationclick', { notification: { close: vi.fn(), data } })

describe('sw.js — push', () => {
  it('mostra título, corpo e usa a tag do evento para não empilhar', async () => {
    await push({ title: 'Chamado de turno', body: 'corpo', tag: 'ev-1', data: { path: '/my-jobs', eventId: 'ev-1' } })

    expect(showNotification).toHaveBeenCalledWith(
      'Chamado de turno',
      expect.objectContaining({ body: 'corpo', tag: 'ev-1', data: { path: '/my-jobs', eventId: 'ev-1' } }),
    )
    expect(skipWaiting).not.toHaveBeenCalled()
  })

  it('payload ilegível ou vazio ainda mostra um aviso genérico', async () => {
    await dispatch('push', {
      data: {
        json: () => {
          throw new Error('x')
        },
      },
    })
    await dispatch('push', { data: null })

    expect(showNotification).toHaveBeenCalledTimes(2)
    expect(showNotification.mock.calls[0][0]).toBe('Worki')
  })

  it.each([
    'https://mal.example/x',
    '//mal.example/x',
    '/\\mal.example',
    '/\t/mal.example',
    '/\n/mal.example',
    'javascript:alert(1)',
    'my-jobs',
    42,
  ])('caminho externo ou inválido (%j) nunca é aberto', async (path) => {
    await click({ path })

    expect(openWindow).toHaveBeenCalledWith('/')
  })

  it('abre a rota com o id do aviso', async () => {
    await click({ path: '/my-jobs', eventId: 'ev-1' })

    expect(openWindow).toHaveBeenCalledWith('/my-jobs?aviso=ev-1')
  })

  it('foca a janela que já está na tela e avisa a abertura por mensagem', async () => {
    const client = { url: `${ORIGIN}/my-jobs`, focus: vi.fn().mockResolvedValue(undefined), postMessage: vi.fn() }
    windows = [client]

    await click({ path: '/my-jobs', eventId: 'ev-1' })

    expect(client.focus).toHaveBeenCalled()
    expect(client.postMessage).toHaveBeenCalledWith({ type: 'NOTICE_OPENED', eventId: 'ev-1' })
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('janela em outra tela não é navegada (não perde formulário): abre a rota', async () => {
    const client = { url: `${ORIGIN}/profile`, focus: vi.fn(), postMessage: vi.fn() }
    windows = [client]

    await click({ path: '/my-jobs' })

    expect(client.focus).not.toHaveBeenCalled()
    expect(openWindow).toHaveBeenCalledWith('/my-jobs')
  })
})
