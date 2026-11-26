/** Regressão: PARAR no meio da digitação não pode deixar o campo ser preenchido depois. */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createCopilotSession } from '../session'
import { createSimulatedStack, fakeUI, goTo, installDomStubs, isHuman, type } from './harness'

beforeAll(installDomStubs)
afterEach(cleanup)

describe('PARAR durante a digitação', () => {
  it.each([0, 40, 150])('parando %i ms depois de começar, nada é escrito', async (atraso) => {
    goTo('/company/create')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const onInput = vi.fn()
    const view = render(<input aria-label="Título do turno" onInput={onInput} />)
    let stop = () => {}
    const stack = createSimulatedStack(({ find }) => type(find(/Título/), 'ZZ-TESTE'))
    const ui = fakeUI({
      step: (text) => {
        if (text.startsWith('Estou preenchendo')) setTimeout(() => stop(), atraso)
      },
    })
    const session = createCopilotSession({ role: 'company', mode: 'do', ui, navigate: () => {}, llmFetch: stack.llmFetch, isHuman, stepDelaySeconds: 0 })
    stop = session.stop
    const result = await session.run('preencha o título com ZZ-TESTE')
    // Espera além do tempo que uma escrita atrasada levaria.
    await new Promise((r) => setTimeout(r, 900))
    expect(result.status).toBe('stopped')
    expect((view.container.querySelector('input') as HTMLInputElement).value).toBe('')
    expect(onInput).not.toHaveBeenCalled()
  })
})
