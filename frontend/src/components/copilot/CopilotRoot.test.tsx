import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSimulatedStack, click, done, goTo, humanClick, installDomStubs, isHuman, humanKey, type, type Brain } from '../../lib/copilot/__tests__/harness'
import { Dialog } from '../ui/Dialog'
import { requestOpen } from '../../lib/copilot/openEvent'
import { GuiaContext, type GuiaContextValue } from '../../hooks/useGuide'
import { CopilotRoot, type CopilotRootProps } from './CopilotRoot'

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, loading: false }) }))

// O painel é carregado sob demanda: aquecer o módulo evita estourar o prazo do primeiro teste.
beforeAll(async () => {
  installDomStubs()
  await import('./CopilotPanel')
})
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
      <CopilotRoot enabled services={services} confirmArmDelayMs={0} overrides={{ isHuman, stepDelaySeconds: 0, navigationSettleMs: 0, pointerTimeScale: 0, deviceMode: 'desktop' }} {...props} />
    </MemoryRouter>,
  )
  return { ...utils, stack, services }
}

const open = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Abrir o Copiloto' }))
}
const acceptNotice = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Entendi, quero usar' }))
}
const ask = (text: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Como posso ajudar?' }), { target: { value: text } })
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
    expect(screen.queryByRole('button', { name: 'Abrir o Copiloto' })).toBeNull()
  })

  it('some com o aceite de Termos na tela', async () => {
    setup(undefined, {}, true, <div data-testid="tos-gate-modal" />)
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Abrir o Copiloto' })).toBeNull()
  })

  it('só consulta o servidor quando a pessoa abre', async () => {
    const { services } = setup()
    await screen.findByRole('button', { name: 'Abrir o Copiloto' })
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
    await waitFor(() => expect(target).toHaveAttribute('data-copilot-highlight'))
    expect(tap).not.toHaveBeenCalled()
    humanClick(target)
    await screen.findByText('Muito bem.', {}, { timeout: 8000 })
    expect(tap).toHaveBeenCalledTimes(1)
    expect(target).not.toHaveAttribute('data-copilot-highlight')
  })
})

describe('D-5: foco no cartão de confirmação', () => {
  it('o foco vai para o cartão, Tab não escapa e, ao fechar, volta para fora do cartão', async () => {
    setup(({ step, find }) => (step === 0 ? click(find(/Salvar lista/)) : done()), {}, true, <button type="button">Salvar lista</button>)
    await open()
    await acceptNotice()
    fireEvent.click(screen.getByRole('radio', { name: 'Faça pra mim' }))
    ask('salve a lista')
    const card = await screen.findByRole('alertdialog', {}, { timeout: 8000 })
    const nao = within(card).getByRole('button', { name: 'Não fazer' })
    const sim = within(card).getByRole('button', { name: 'Confirmar' })
    await waitFor(() => expect(document.activeElement).toBe(nao))
    // Tab no último volta ao primeiro; Shift+Tab no primeiro vai ao último.
    sim.focus()
    humanKey(sim, { key: 'Tab' })
    expect(document.activeElement).toBe(nao)
    humanKey(nao, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(sim)
    humanClick(nao)
    await screen.findByText(/Parei|não confirm/i, {}, { timeout: 8000 })
    expect(card.isConnected && card.contains(document.activeElement)).toBe(false)
  })
})

describe('D-6: Esc para na primeira tecla', () => {
  it('Esc logo depois de enviar já para (nada é tocado)', async () => {
    const save = vi.fn()
    setup(({ find }) => click(find(/Salvar lista/)), { overrides: { isHuman, stepDelaySeconds: 0, navigationSettleMs: 0, pointerTimeScale: 0, deviceMode: 'mobile' } }, true, <button type="button" onClick={save}>Salvar lista</button>)
    await open()
    await acceptNotice()
    fireEvent.click(screen.getByRole('radio', { name: 'Faça pra mim' }))
    ask('salve a lista')
    fireEvent.keyDown(window, { key: 'Escape' })
    await screen.findByText('Parei, como você pediu.', {}, { timeout: 8000 })
    expect(save).not.toHaveBeenCalled()
  })

  it('Esc durante a digitação (ponteiro animando) para na primeira tecla e nada é escrito', async () => {
    const onInput = vi.fn()
    setup(
      ({ find }) => type(find(/Título/), 'ZZ-TESTE'),
      { overrides: { isHuman, stepDelaySeconds: 0, navigationSettleMs: 0, pointerTimeScale: 1, deviceMode: 'desktop' } },
      true,
      <input aria-label="Título do turno" onInput={onInput} />,
      '/company/create',
    )
    await open()
    await acceptNotice()
    fireEvent.click(screen.getByRole('radio', { name: 'Faça pra mim' }))
    ask('preencha o título com ZZ-TESTE')
    await screen.findAllByText(/preenchendo/i, {}, { timeout: 8000 })
    fireEvent.keyDown(window, { key: 'Escape' })
    await screen.findByText('Parei, como você pediu.', {}, { timeout: 8000 })
    await new Promise((r) => setTimeout(r, 900))
    expect((screen.getByLabelText('Título do turno') as HTMLInputElement).value).toBe('')
    expect(onInput).not.toHaveBeenCalled()
  })
})

describe('bloqueio de entrada enquanto a IA age', () => {
  it('a camada existe só rodando, o Parar segue clicável e ela some ao parar', async () => {
    const save = vi.fn()
    setup(({ find }) => click(find(/Salvar lista/)), { overrides: { isHuman, stepDelaySeconds: 0, navigationSettleMs: 0, pointerTimeScale: 0, deviceMode: 'mobile' } }, true, <button type="button" onClick={save}>Salvar lista</button>)
    await open()
    await acceptNotice()
    expect(document.querySelector('[data-copilot-block]')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Faça pra mim' }))
    ask('salve a lista')
    await waitFor(() => expect(document.querySelector('[data-copilot-block]')).not.toBeNull())
    expect(document.querySelector('[data-copilot-block]')?.closest('[data-copilot-ui]')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    await screen.findByText('Parei, como você pediu.', {}, { timeout: 8000 })
    expect(document.querySelector('[data-copilot-block]')).toBeNull()
  })
})

describe('D-8: Recentes', () => {
  it('guarda só pedido sem dado pessoal, no máximo 5, e "Limpar histórico" apaga', async () => {
    const { rememberRequest, readHistory } = await import('../../lib/copilot/suggestions')
    expect(rememberRequest('meu cpf é 123.456.789-09')).toEqual([])
    expect(rememberRequest('liga para (11) 98765-4321')).toEqual([])
    for (const n of [1, 2, 3, 4, 5, 6]) rememberRequest(`abrir turnos ${'x'.repeat(n)}`)
    expect(readHistory()).toHaveLength(5)
    expect(window.localStorage.getItem('worki:copilot:historico-v1')).not.toMatch(/123|9876/)
    // Gravação antiga com dado pessoal não volta à tela.
    window.localStorage.setItem('worki:copilot:historico-v1', JSON.stringify(['paga o [cpf]', 'abrir Elenco']))
    expect(readHistory()).toEqual(['abrir Elenco'])
    setup()
    await open()
    await acceptNotice()
    fireEvent.click(await screen.findByRole('button', { name: 'Limpar histórico' }))
    expect(window.localStorage.getItem('worki:copilot:historico-v1')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Pedidos recentes' })).toBeNull()
  })

  it('sem localStorage (navegação privada) não quebra', async () => {
    const { rememberRequest, readHistory } = await import('../../lib/copilot/suggestions')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
    expect(readHistory()).toEqual([])
    expect(() => rememberRequest('abrir Elenco')).not.toThrow()
  })
})

describe('barra de comando e duas experiências', () => {
  it('Ctrl+K abre a barra de comando de qualquer tela, sem aba nem botão', async () => {
    setup(undefined, { showLauncher: false })
    await act(async () => {
      await import('./CopilotPanel')
    })
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const dialog = await screen.findByRole('dialog', { name: 'Copiloto' })
    expect(within(dialog).getByRole('heading', { name: 'Como posso ajudar?' })).toBeInTheDocument()
    // Esc fecha e devolve o foco.
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Copiloto' })).toBeNull())
  })

  it('PC usa a seta; celular usa o dedo virtual e o bottom sheet (sem seta de mouse)', async () => {
    const desktop = setup()
    await open()
    await screen.findByRole('dialog', { name: 'Copiloto' })
    expect(document.querySelector('[data-copilot-pointer="cursor"]')).not.toBeNull()
    expect(document.querySelector('[data-copilot-pointer="finger"]')).toBeNull()
    desktop.unmount()
    cleanup()

    setup(undefined, { overrides: { isHuman, stepDelaySeconds: 0, navigationSettleMs: 0, pointerTimeScale: 0, deviceMode: 'mobile' } })
    await open()
    await screen.findByRole('dialog', { name: 'Copiloto' })
    expect(document.querySelector('[data-copilot-pointer="finger"]')).not.toBeNull()
    expect(document.querySelector('[data-copilot-pointer="cursor"]')).toBeNull()
  })

  it('sem aviso de dado pessoal: o campo fica limpo (o mascaramento segue silencioso)', async () => {
    setup()
    await open()
    await acceptNotice()
    await screen.findByRole('textbox', { name: 'Como posso ajudar?' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Como posso ajudar?' }), { target: { value: 'meu cpf é 123.456.789-09' } })
    expect(screen.queryByText(/Não digite CPF/)).toBeNull()
    expect(screen.queryByText(/parece um dado pessoal/)).toBeNull()
  })

  it('quando o agente PERGUNTA: mostra a pergunta com respostas rápidas e segue com a resposta (não encerra sozinho)', async () => {
    const question = 'Qual turno? Por exemplo: o de hoje, o de amanhã ou o de sábado'
    setup(({ step }) => (step === 0 ? { ask_user: { question } } : done('Abri o de amanhã.')))
    await open()
    await acceptNotice()
    fireEvent.click(screen.getByRole('radio', { name: 'Faça pra mim' }))
    ask('abra o turno')
    await screen.findByText(question, {}, { timeout: 8000 })
    expect(screen.getByRole('button', { name: 'PARAR' })).toBeInTheDocument()
    const chips = screen.getByRole('list', { name: 'Respostas rápidas' })
    expect(within(chips).getByRole('button', { name: 'o de hoje' })).toBeInTheDocument()
    expect(within(chips).getByRole('button', { name: 'Deixa para lá' })).toBeInTheDocument()
    humanClick(within(chips).getByRole('button', { name: 'o de amanhã' }))
    await screen.findByText('Abri o de amanhã.', {}, { timeout: 8000 })
    expect(screen.queryByText(/Parei/)).toBeNull()
  })

  it('"deixa para lá" na pergunta encerra com mensagem própria, não com a do botão PARAR', async () => {
    setup(({ step }) => (step === 0 ? { ask_user: { question: 'Qual turno?' } } : done()))
    await open()
    await acceptNotice()
    fireEvent.click(screen.getByRole('radio', { name: 'Faça pra mim' }))
    ask('abra o turno')
    humanClick(await screen.findByRole('button', { name: 'Deixa para lá' }, { timeout: 8000 }))
    await screen.findByText(/Certo, parei por aqui/, {}, { timeout: 8000 })
    expect(screen.queryByText('Parei, como você pediu.')).toBeNull()
  })

  it('em /recibo aberto direto o papel vem do guia (empresa não vira freela)', async () => {
    const guide = { papel: 'gestor' } as unknown as GuiaContextValue
    const stack = createSimulatedStack(() => done())
    const createLlmFetch = vi.fn(() => stack.llmFetch)
    render(
      <GuiaContext.Provider value={guide}>
        <MemoryRouter initialEntries={['/recibo/12']}>
          <CopilotRoot enabled services={{ checkAvailability: async () => true, createLlmFetch }} confirmArmDelayMs={0} overrides={{ isHuman, stepDelaySeconds: 0, navigationSettleMs: 0, pointerTimeScale: 0, deviceMode: 'desktop' }} />
        </MemoryRouter>
      </GuiaContext.Provider>,
    )
    await open()
    await acceptNotice().catch(() => {})
    ask('oi')
    await waitFor(() => expect(createLlmFetch).toHaveBeenCalledWith('company'), { timeout: 8000 })
    // Espera a tarefa acabar: enquanto roda, a guarda de eventos fica armada e barraria o Esc do teste seguinte.
    await screen.findByText('Pronto.', {}, { timeout: 8000 })
  })

  it('PC: o botão vira a barra de comando (View Transition em morph) e a barra volta a ser o botão; sem a API, abre direto', async () => {
    const doc = document as unknown as { startViewTransition?: unknown }
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 120, 44))
    const names: string[] = []
    const start = vi.fn((update: () => void) => {
      // O nome de transição precisa estar no elemento de origem ANTES da troca (estado antigo).
      names.push(`antes:${screen.queryByRole('button', { name: 'Abrir o Copiloto' })?.style.viewTransitionName ?? 'sem-botão'}`)
      update()
      names.push(`depois:${screen.queryByRole('button', { name: 'Abrir o Copiloto' })?.style.viewTransitionName ?? 'sem-botão'}`)
      expect(document.documentElement.hasAttribute('data-wk-vt')).toBe(true)
      return { finished: Promise.resolve() }
    })
    doc.startViewTransition = start
    try {
      setup()
      await screen.findByRole('button', { name: 'Abrir o Copiloto' })
      act(() => requestOpen({ x: 10, y: 10 }))
      const dialog = await screen.findByRole('dialog', { name: 'Copiloto' })
      expect(start).toHaveBeenCalledTimes(1)
      expect(names[0]).toBe('antes:wk-cmd-vt')
      expect(dialog).toHaveAttribute('data-copilot-palette')
      await waitFor(() => expect(document.documentElement.hasAttribute('data-wk-vt')).toBe(false))
      // Fechar também faz o morph de volta (a barra → o botão).
      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Copiloto' })).toBeNull())
      expect(start).toHaveBeenCalledTimes(2)
      expect(names.at(-1)).toBe('depois:wk-cmd-vt')
    } finally {
      delete doc.startViewTransition
    }
    cleanup()
    setup()
    await screen.findByRole('button', { name: 'Abrir o Copiloto' })
    act(() => requestOpen())
    await screen.findByRole('dialog', { name: 'Copiloto' })
  })
})
