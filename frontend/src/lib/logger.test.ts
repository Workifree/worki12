import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@sentry/react', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setUser: vi.fn(),
  init: vi.fn(),
  getClient: vi.fn(() => ({})),
}))

import * as Sentry from '@sentry/react'
import { logError, logWarn, initMonitoring, captureException, setMonitoringUser } from './logger'

const DSN = 'https://chave@o0.ingest.sentry.io/1'
type Client = typeof import('./sentryClient')

// Os testes deste bloco dependem da ordem (a fachada guarda estado de modulo); o ultimo deixa o
// SDK ligado, que e o que os testes de logError/logWarn abaixo esperam.
describe('initMonitoring', () => {
  it('sem DSN nao carrega o SDK nem enfileira nada', async () => {
    const load = vi.fn()
    await initMonitoring({ dsn: undefined }, load)
    captureException(new Error('descartado'))

    expect(load).not.toHaveBeenCalled()
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('falha ao carregar o SDK nao quebra o app e permite tentar de novo', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      initMonitoring({ dsn: DSN }, () => Promise.reject(new Error('chunk 404'))),
    ).resolves.toBeUndefined()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('enfileira erros iniciais e globais e repassa em ordem depois do init', async () => {
    let entregar!: (client: Client) => void
    const beforeSend = vi.fn(() => null)
    const pronto = initMonitoring(
      { dsn: DSN, beforeSend },
      () => new Promise<Client>((resolve) => { entregar = resolve }),
    )
    const antes = new Error('antes')
    const global = new Error('window.onerror')
    const rejeicao = new Error('rejeicao')
    setMonitoringUser({ id: 'u1' })
    captureException(antes)
    window.dispatchEvent(new ErrorEvent('error', { error: global }))
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: rejeicao }))
    expect(Sentry.captureException).not.toHaveBeenCalled()

    entregar(Sentry as unknown as Client)
    await pronto

    // o scrub (beforeSend) vai no init, que roda antes de qualquer envio da fila
    expect(Sentry.init).toHaveBeenCalledWith({ dsn: DSN, beforeSend })
    expect(vi.mocked(Sentry.captureException).mock.calls.map(([e]) => e)).toEqual([antes, global, rejeicao])
    const ordem = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    expect(ordem(Sentry.init)).toBeLessThan(ordem(Sentry.setUser))
    expect(ordem(Sentry.setUser)).toBeLessThan(ordem(Sentry.captureException))

    // com o SDK no ar, os handlers provisorios saem (sem envio em dobro)
    vi.mocked(Sentry.captureException).mockClear()
    // sem ouvinte, o vitest trataria o evento sintetico como erro real do teste
    const engolir = (event: Event) => event.preventDefault()
    window.addEventListener('error', engolir)
    window.dispatchEvent(new ErrorEvent('error', { error: global }))
    window.removeEventListener('error', engolir)
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('logError - em ambiente DEV (PROD=false)', () => {
  it('NAO chama Sentry.captureException quando import.meta.env.PROD e false', () => {
    const error = new Error('erro dev')
    logError('Contexto dev', error)

    expect(Sentry.captureException).not.toHaveBeenCalled()
    expect(Sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('chama console.error em modo DEV', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('teste console')
    logError('Contexto', error)

    expect(consoleSpy).toHaveBeenCalledWith('Contexto', error)
    consoleSpy.mockRestore()
  })
})

describe('logError - em ambiente PROD (PROD=true)', () => {
  beforeEach(() => {
    vi.stubEnv('PROD', true)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('chama Sentry.captureException quando error e instancia de Error', () => {
    const error = new Error('erro de teste')
    logError('Contexto do erro', error)

    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      extra: { message: 'Contexto do erro' },
    })
  })

  it('chama Sentry.captureMessage quando error nao e instancia de Error', () => {
    logError('Contexto do erro', 'string de erro')

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Contexto do erro: string de erro',
      'error'
    )
  })

  it('chama Sentry.captureMessage com apenas message quando error e undefined', () => {
    logError('Apenas mensagem')

    expect(Sentry.captureMessage).toHaveBeenCalledWith('Apenas mensagem', 'error')
  })
})

describe('logWarn - em ambiente DEV (PROD=false)', () => {
  it('NAO chama Sentry.captureMessage quando import.meta.env.PROD e false', () => {
    logWarn('Aviso dev', 'detalhe')

    expect(Sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('chama console.warn em modo DEV', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logWarn('Aviso', 'detalhe')

    expect(consoleSpy).toHaveBeenCalledWith('Aviso', 'detalhe')
    consoleSpy.mockRestore()
  })
})

describe('logWarn - em ambiente PROD (PROD=true)', () => {
  beforeEach(() => {
    vi.stubEnv('PROD', true)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('chama Sentry.captureMessage com nivel warning', () => {
    logWarn('Aviso de teste', 'detalhe')

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Aviso de teste: detalhe',
      'warning'
    )
  })

  it('chama Sentry.captureMessage com string vazia quando detail e undefined', () => {
    logWarn('Aviso sem detalhe')

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Aviso sem detalhe: ',
      'warning'
    )
  })
})
