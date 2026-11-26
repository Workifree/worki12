/** A pergunta do agente respeita o PARAR e o sinal de cancelamento do page-agent. */
import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createCopilotSession } from '../session'
import { createSimulatedStack, fakeUI, goTo, installDomStubs, isHuman } from './harness'

beforeAll(installDomStubs)
afterEach(cleanup)

describe('onAskUser', () => {
  it('PARAR com a pergunta na tela encerra e não deixa a tarefa pendurada', async () => {
    goTo('/company/create')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'group').mockImplementation(() => {})
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
    let stop = () => {}
    let signalSeen: AbortSignal | null = null
    const ui = fakeUI({
      ask(_question, signal) {
        signalSeen = signal
        setTimeout(() => stop(), 20)
        return new Promise<string>((resolve) => signal.addEventListener('abort', () => resolve(''), { once: true }))
      },
    })
    const stack = createSimulatedStack(() => ({ ask_user: { question: 'Qual turno?' } }))
    const session = createCopilotSession({ role: 'company', mode: 'do', ui, navigate: () => {}, llmFetch: stack.llmFetch, isHuman, stepDelaySeconds: 0 })
    stop = session.stop
    let status = ''
    await act(async () => {
      status = (await session.run('abra o turno')).status
    })
    expect(signalSeen).not.toBeNull()
    expect(status).toBe('stopped')
  })
})
