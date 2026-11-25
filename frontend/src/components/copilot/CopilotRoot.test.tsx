import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSimulatedStack, click, done, goTo, humanClick, installDomStubs, isHuman, type Brain } from '../../lib/copilot/__tests__/harness'
import { Dialog } from '../ui/Dialog'
import { CopilotRoot, type CopilotRootProps } from './CopilotRoot'

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, loading: false }) }))

beforeAll(installDomStubs)
beforeEach(() => {
  window.localStorage.clear()
  goTo('/company/jobs')
  for (const method of ['log', 'group', 'groupEnd', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {})
  }
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function setup(brain: Brain = () => done(), props: CopilotRootProps = {}, available = true, page: React.ReactNode = null, path = '/company/jobs') {
  const stack = createSimulatedStack(brain)
  const services = { checkAvailability: vi.fn(async () => available), createLlmFetch: () => stack.llmFetch }
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      {page}
      <CopilotRoot enabled services={services} confirmArmDelayMs={0} overrides={{ isHuman, stepDelaySeconds: 0, navigationSettleMs: 0 }} {...props} />
    </MemoryRouter>,
  )
  return { ...utils, stack, services }
}

const open = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Abrir o copiloto' }))
}
const acceptNotice = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Entendi, quero usar' }))
}
const ask = (text: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'O que você precisa?' }), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }))
}

describe('ativação', () => {
  it('desligado por padrão: nada é renderizado', () => {
    render(<MemoryRouter><CopilotRoot /></MemoryRouter>)
    expect(document.querySelector('[data-testid="copilot-host"]')).toBeNull()
  })

  it('some em rota de convite', async () => {
    setup(undefined, {}, true, null, '/convite/abc')
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Abrir o copiloto' })).toBeNull()
  })

  it('some com o aceite de Termos na tela', async () => {
    setup(undefined, {}, true, <div data-testid="tos-gate-modal" />)
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Abrir o copiloto' })).toBeNull()
  })

  it('só consulta o servidor quando a pessoa abre', async () => {
    const { services } = setup()
    await screen.findByRole('button', { name: 'Abrir o copiloto' })
    expect(services.checkAvailability).not.toHaveBeenCalled()
  })
})

describe('sem a IA, o app segue com o guia', () => {
  it('esconde o modo agente e oferece o guia', async () => {
    const onOpenGuide = vi.fn()
    setup(undefined, { onOpenGuide }, false)
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir o guia' }))
    expect(onOpenGuide).toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
  })
})

describe('conversa', () => {
  it('pede ciência sobre o envio antes do primeiro uso, e os dois modos existem', async () => {
    const { stack } = setup()
    await open()
    await screen.findByText(/inteligência artificial de outra empresa/)
    expect(screen.queryByRole('textbox')).toBeNull()
    await acceptNotice()
    expect(screen.getByRole('radio', { name: 'Me mostre' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Faça pra mim' })).toBeInTheDocument()
    expect(stack.bodies).toHaveLength(0)
    ask('oi')
    // O ciclo do agente passa de 1 s (padrão do findBy) quando a máquina está carregada.
    await screen.findByText('Pronto.', {}, { timeout: 8000 })
  })

  it('confirmação aparece com o alvo real; confirmar executa uma vez', async () => {
    const save = vi.fn()
    setup(({ step, find }) => (step === 0 ? click(find(/Salvar lista/)) : done()), {}, true, <button type="button" onClick={save}>Salvar lista</button>)
    await open()
    await acceptNotice()
    fireEvent.click(screen.getByRole('radio', { name: 'Faça pra mim' }))
    ask('salve a lista')
    const card = await screen.findByRole('alertdialog', {}, { timeout: 8000 })
    expect(within(card).getByText('Tocar no botão "Salvar lista"')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PARAR' })).toBeInTheDocument()
    humanClick(within(card).getByRole('button', { name: 'Confirmar' }))
    await screen.findByText('Pronto.', {}, { timeout: 8000 })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('com um <dialog> aberto, o copiloto e o PARAR ficam DENTRO do modal; ao fechar, voltam ao body', async () => {
    const page = (
      <Dialog onClose={() => {}} labelledBy="h">
        <h2 id="h">Nova lista</h2>
        <button type="button">Salvar lista</button>
      </Dialog>
    )
    setup(({ find }) => click(find(/Salvar lista/)), {}, true, page)
    await open()
    const dialog = document.querySelector('dialog')!
    const host = screen.getByTestId('copilot-host')
    await waitFor(() => expect(dialog.contains(host)).toBe(true))
    await acceptNotice()
    fireEvent.click(screen.getByRole('radio', { name: 'Faça pra mim' }))
    ask('salve')
    await screen.findByRole('alertdialog', {}, { timeout: 8000 })
    const stop = screen.getByRole('button', { name: 'PARAR' })
    expect(dialog.contains(stop)).toBe(true)
    humanClick(stop)
    await screen.findByText('Parei, como você pediu.', {}, { timeout: 8000 })
    act(() => dialog.removeAttribute('open'))
    await waitFor(() => expect(host.parentElement).toBe(document.body))
  })

  it('"Me mostre": destaca e segue quando a pessoa toca no item de verdade', async () => {
    const tap = vi.fn()
    setup(({ step, find }) => (step === 0 ? click(find(/Salvar lista/)) : done('Muito bem.')), {}, true, <button type="button" onClick={tap}>Salvar lista</button>)
    await open()
    await acceptNotice()
    ask('como salvo?')
    await screen.findByText('Toque em "Salvar lista".', {}, { timeout: 8000 })
    const target = screen.getByRole('button', { name: 'Salvar lista' })
    expect(target).toHaveAttribute('data-copilot-highlight')
    expect(tap).not.toHaveBeenCalled()
    humanClick(target)
    await screen.findByText('Muito bem.', {}, { timeout: 8000 })
    expect(tap).toHaveBeenCalledTimes(1)
    expect(target).not.toHaveAttribute('data-copilot-highlight')
  })
})
