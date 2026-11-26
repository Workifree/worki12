import { describe, expect, it, vi } from 'vitest'
import { failureMessage, withRetry } from './retry'

const erro = (status: number, code: string) => new Response(JSON.stringify({ error: { message: code } }), { status })
const run = (send: typeof fetch, extra: { onRetry?: () => void; onFailure?: (c: string) => void } = {}) =>
  withRetry(send, { signal: new AbortController().signal, delayMs: 0, ...extra })('x', {})

describe('repetição do pedido ao modelo', () => {
  it.each(['model_no_action', 'invalid_model_output', 'provider_429'])('%s: tenta de novo e passa', async (code) => {
    const send = vi.fn().mockResolvedValueOnce(erro(502, code)).mockResolvedValue(new Response('{}'))
    const onRetry = vi.fn()
    expect((await run(send, { onRetry })).status).toBe(200)
    expect(send).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('desiste depois de duas repetições', async () => {
    const send = vi.fn(async () => erro(502, 'model_no_action'))
    const onFailure = vi.fn()
    expect((await run(send, { onFailure })).status).toBe(502)
    expect(send).toHaveBeenCalledTimes(3)
    expect(onFailure).toHaveBeenCalledWith('model_no_action')
  })

  it.each([[429, 'rate_day'], [500, 'x'], [401, 'unauthorized']])('%s %s: não repete', async (status, code) => {
    const send = vi.fn(async () => erro(status, code))
    await run(send)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('a mensagem final diz o que já fez e onde a pessoa está', () => {
    const m = failureMessage('model_no_action', ['abri a tela Meus turnos'], 'Meus turnos')
    expect(m).toContain('abri a tela Meus turnos')
    expect(m).toContain('"Meus turnos"')
    expect(failureMessage('rate_day', [], 'Hoje')).toContain('limite')
  })
})
