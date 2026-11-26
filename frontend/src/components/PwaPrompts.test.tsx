import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import companyLayoutSrc from '../layouts/CompanyLayout.tsx?raw'
import mainLayoutSrc from '../layouts/MainLayout.tsx?raw'
import PwaPrompts, { PWA_SESSION_START_KEY } from './PwaPrompts'
import { INSTALL_DISMISS_KEY } from '../lib/pwa'

// Store controlável no lugar do estado real do navegador. Os helpers puros de `lib/pwa`
// (dispensa em localStorage, rotas excluídas) ficam REAIS — é o comportamento que queremos exercitar.
const pwaMock = vi.hoisted(() => {
  interface State {
    updateAvailable: boolean
    installAvailable: boolean
    installed: boolean
  }
  let current: State = { updateAvailable: false, installAvailable: false, installed: false }
  const listeners = new Set<() => void>()
  return {
    getPwaState: () => current,
    subscribePwa: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(patch: Partial<State>) {
      current = { ...current, ...patch }
      listeners.forEach((l) => l())
    },
    reset() {
      current = { updateAvailable: false, installAvailable: false, installed: false }
      listeners.clear()
    },
    applyPwaUpdate: vi.fn(),
    promptInstall: vi.fn(),
    isIosSafari: vi.fn(() => false),
    isStandalone: vi.fn(() => false),
  }
})

vi.mock('../lib/pwa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/pwa')>()
  return {
    ...actual,
    getPwaState: pwaMock.getPwaState,
    subscribePwa: pwaMock.subscribePwa,
    applyPwaUpdate: pwaMock.applyPwaUpdate,
    promptInstall: pwaMock.promptInstall,
    isIosSafari: pwaMock.isIosSafari,
    isStandalone: pwaMock.isStandalone,
  }
})

function renderAt(path = '/dashboard', installDelayMs = 0) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PwaPrompts installDelayMs={installDelayMs} />
    </MemoryRouter>,
  )
}

describe('PwaPrompts', () => {
  beforeEach(() => {
    pwaMock.reset()
    pwaMock.applyPwaUpdate.mockReset()
    pwaMock.promptInstall.mockReset()
    pwaMock.isIosSafari.mockReturnValue(false)
    pwaMock.isStandalone.mockReturnValue(false)
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('não renderiza nada quando não há o que oferecer', () => {
    renderAt()
    expect(screen.queryByText('Nova versão disponível')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Instalar o Worki')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  describe('atualização', () => {
    it('mostra o banner quando há versão nova e "Atualizar" aplica a atualização', () => {
      renderAt()
      act(() => pwaMock.set({ updateAvailable: true }))

      expect(screen.getByText('Nova versão disponível')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))

      expect(pwaMock.applyPwaUpdate).toHaveBeenCalledTimes(1)
    })

    it('"Depois" dispensa o banner nesta sessão', () => {
      renderAt()
      act(() => pwaMock.set({ updateAvailable: true }))

      fireEvent.click(screen.getByRole('button', { name: 'Depois' }))

      expect(screen.queryByText('Nova versão disponível')).not.toBeInTheDocument()
      expect(pwaMock.applyPwaUpdate).not.toHaveBeenCalled()
    })

    it('aparece mesmo em /login (a exclusão de rotas vale só para o convite de instalação)', () => {
      renderAt('/login')
      act(() => pwaMock.set({ updateAvailable: true }))
      expect(screen.getByText('Nova versão disponível')).toBeInTheDocument()
    })
  })

  describe('instalação (Android/Chrome)', () => {
    it('mostra o convite quando o beforeinstallprompt foi capturado e "Instalar" abre o diálogo nativo', async () => {
      pwaMock.promptInstall.mockResolvedValue('accepted')
      renderAt()
      act(() => pwaMock.set({ installAvailable: true }))

      expect(screen.getByLabelText('Instalar o Worki')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /Instalar/ }))

      await waitFor(() => expect(pwaMock.promptInstall).toHaveBeenCalledTimes(1))
      expect(window.localStorage.getItem(INSTALL_DISMISS_KEY)).toBeNull() // aceitou: nada a lembrar
    })

    it('se o usuário recusa o diálogo nativo, lembra a dispensa e esconde o convite', async () => {
      pwaMock.promptInstall.mockResolvedValue('dismissed')
      renderAt()
      act(() => pwaMock.set({ installAvailable: true }))

      fireEvent.click(screen.getByRole('button', { name: /Instalar/ }))

      await waitFor(() => expect(screen.queryByLabelText('Instalar o Worki')).not.toBeInTheDocument())
      expect(window.localStorage.getItem(INSTALL_DISMISS_KEY)).not.toBeNull()
    })

    it('"Agora não" esconde o convite e grava a dispensa em localStorage', () => {
      renderAt()
      act(() => pwaMock.set({ installAvailable: true }))

      fireEvent.click(screen.getByRole('button', { name: 'Agora não' }))

      expect(screen.queryByLabelText('Instalar o Worki')).not.toBeInTheDocument()
      expect(window.localStorage.getItem(INSTALL_DISMISS_KEY)).not.toBeNull()
    })

    it('não reaparece em uma nova montagem enquanto a dispensa está valendo', () => {
      window.localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()))
      renderAt()
      act(() => pwaMock.set({ installAvailable: true }))

      expect(screen.queryByLabelText('Instalar o Worki')).not.toBeInTheDocument()
    })

    it('volta a aparecer depois que a dispensa expirou (30 dias)', () => {
      window.localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now() - 31 * 24 * 60 * 60 * 1000))
      renderAt()
      act(() => pwaMock.set({ installAvailable: true }))

      expect(screen.getByLabelText('Instalar o Worki')).toBeInTheDocument()
    })

    it('funciona mesmo com localStorage quebrado (modo privado)', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError')
      })
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })
      renderAt()
      act(() => pwaMock.set({ installAvailable: true }))

      expect(screen.getByLabelText('Instalar o Worki')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Agora não' }))
      expect(screen.queryByLabelText('Instalar o Worki')).not.toBeInTheDocument()
    })
  })

  describe('instalação (iOS Safari)', () => {
    beforeEach(() => pwaMock.isIosSafari.mockReturnValue(true))

    it('explica "Compartilhar → Adicionar à Tela de Início" (não há API de instalação no iOS)', () => {
      renderAt()

      const card = screen.getByLabelText('Instalar o Worki')
      expect(card).toHaveTextContent('Compartilhar')
      expect(card).toHaveTextContent('Adicionar à Tela de Início')
      expect(screen.queryByRole('button', { name: /^Instalar$/ })).not.toBeInTheDocument()
    })

    it('"Entendi" dispensa e lembra', () => {
      renderAt()
      fireEvent.click(screen.getByRole('button', { name: 'Entendi' }))

      expect(screen.queryByLabelText('Instalar o Worki')).not.toBeInTheDocument()
      expect(window.localStorage.getItem(INSTALL_DISMISS_KEY)).not.toBeNull()
    })
  })

  describe('quando NÃO convidar a instalar', () => {
    it.each(['/login', '/convite/abc123', '/convite-gerente/abc123', '/worker/onboarding'])('em %s', (path) => {
      renderAt(path)
      act(() => pwaMock.set({ installAvailable: true }))
      expect(screen.queryByLabelText('Instalar o Worki')).not.toBeInTheDocument()
    })

    it('quando o app já roda instalado (display-mode: standalone)', () => {
      pwaMock.isStandalone.mockReturnValue(true)
      pwaMock.isIosSafari.mockReturnValue(true)
      renderAt()
      act(() => pwaMock.set({ installAvailable: true }))
      expect(screen.queryByLabelText('Instalar o Worki')).not.toBeInTheDocument()
    })

    it('quando acabou de instalar (appinstalled)', () => {
      renderAt()
      act(() => pwaMock.set({ installAvailable: true }))
      act(() => pwaMock.set({ installed: true, installAvailable: false }))
      expect(screen.queryByLabelText('Instalar o Worki')).not.toBeInTheDocument()
    })

    it('enquanto há atualização pendente (um cartão por vez)', () => {
      renderAt()
      act(() => pwaMock.set({ installAvailable: true, updateAvailable: true }))

      expect(screen.getByText('Nova versão disponível')).toBeInTheDocument()
      expect(screen.queryByLabelText('Instalar o Worki')).not.toBeInTheDocument()
    })

    it('só depois de 20s de uso na sessão E nunca na primeira tela carregada', () => {
      vi.useFakeTimers()
      window.sessionStorage.clear()
      function Ir() {
        const navigate = useNavigate()
        return <button onClick={() => navigate('/my-jobs')}>ir</button>
      }
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <Ir />
          <PwaPrompts installDelayMs={20000} />
        </MemoryRouter>,
      )
      act(() => pwaMock.set({ installAvailable: true }))
      act(() => {
        vi.advanceTimersByTime(19000)
      })
      expect(screen.queryByLabelText('Instalar o Worki')).not.toBeInTheDocument()

      // 20s passaram, mas ainda é a primeira tela da página: nada.
      act(() => {
        vi.advanceTimersByTime(1500)
      })
      expect(screen.queryByLabelText('Instalar o Worki')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'ir' }))
      expect(screen.getByLabelText('Instalar o Worki')).toBeInTheDocument()
    })

    it('a contagem de 20s é da sessão: recarregar não zera', () => {
      vi.useFakeTimers()
      window.sessionStorage.setItem(PWA_SESSION_START_KEY, String(Date.now() - 25000))
      function Ir() {
        const navigate = useNavigate()
        return <button onClick={() => navigate('/my-jobs')}>ir</button>
      }
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <Ir />
          <PwaPrompts installDelayMs={20000} />
        </MemoryRouter>,
      )
      act(() => pwaMock.set({ installAvailable: true }))
      act(() => {
        vi.advanceTimersByTime(0)
      })
      fireEvent.click(screen.getByRole('button', { name: 'ir' }))
      expect(screen.getByLabelText('Instalar o Worki')).toBeInTheDocument()
    })
  })

  describe('faixa offline', () => {
    it('aparece quando a conexão cai e some quando volta', () => {
      renderAt()
      expect(screen.queryByText(/sem internet/i)).not.toBeInTheDocument()

      act(() => {
        vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
        window.dispatchEvent(new Event('offline'))
      })
      expect(screen.getByText(/sem internet/i)).toBeInTheDocument()

      act(() => {
        vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true)
        window.dispatchEvent(new Event('online'))
      })
      expect(screen.queryByText(/sem internet/i)).not.toBeInTheDocument()
    })

    it('é um cartão da pilha FIXA (nunca empurra o layout) e a pilha respeita a safe-area no CSS', () => {
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
      const { container } = renderAt()

      const banner = screen.getByRole('status')
      expect(container.firstElementChild).toHaveClass('worki-pwa-stack')
      expect(container.firstElementChild).toContainElement(banner)
      // Posição, z-index e safe-area vivem em `.worki-pwa-stack` (index.css); o cartão em si não posiciona.
      expect(banner.className).not.toMatch(/(^| )(fixed|absolute|sticky)( |$)/)
    })

    it('reserva o próprio espaço: publica --worki-pwa-h enquanto visível e limpa ao sumir', () => {
      const spy = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
      const rect = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockReturnValue({ height: 40, width: 300, top: 0, left: 0, right: 300, bottom: 40, x: 0, y: 0, toJSON: () => ({}) })
      renderAt()
      expect(document.documentElement.style.getPropertyValue('--worki-pwa-h')).toBe('52px')

      act(() => {
        spy.mockReturnValue(true)
        window.dispatchEvent(new Event('online'))
      })
      expect(document.documentElement.style.getPropertyValue('--worki-pwa-h')).toBe('')
      rect.mockRestore()
    })

    it('D-9: a reserva acompanha a pilha quando ela cresce (instalar + sem internet) e é somada ao padding do main', async () => {
      // ResizeObserver controlável: a pilha abre com o convite e depois ganha o aviso de offline.
      let notify: (() => void) | null = null
      class FakeRO {
        constructor(cb: () => void) {
          notify = cb
        }
        observe() {}
        disconnect() {}
      }
      vi.stubGlobal('ResizeObserver', FakeRO)
      let altura = 114
      const rect = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockImplementation(() => ({ height: altura, width: 366, top: 0, left: 0, right: 366, bottom: altura, x: 0, y: 0, toJSON: () => ({}) }))
      pwaMock.set({ installAvailable: true })
      renderAt('/company/jobs')
      expect(screen.getByLabelText('Instalar o Worki')).toBeInTheDocument()
      expect(document.documentElement.style.getPropertyValue('--worki-pwa-h')).toBe('126px')

      altura = 170
      act(() => notify?.())
      expect(document.documentElement.style.getPropertyValue('--worki-pwa-h')).toBe('182px')

      // A variável só reserva espaço se o CSS do main a somar ao padding de baixo (index.css).
      // Lido do disco: no Vitest o CSS importado vem vazio (css desligado); o Vitest roda a partir de frontend/.
      const fs = await vi.importActual<{ readFileSync: (p: string, enc: 'utf8') => string }>('node:fs')
      const indexCss = fs.readFileSync('src/index.css', 'utf8')
      expect(indexCss).toMatch(/\.worki-layout main\s*\{\s*padding-bottom:\s*calc\([^)]*var\(--worki-pwa-h/)
      for (const [layout, src] of [['CompanyLayout', companyLayoutSrc], ['MainLayout', mainLayoutSrc]]) {
        expect(src, layout).toMatch(/className="worki-layout[ "][\s\S]*<main /)
      }
      rect.mockRestore()
      vi.unstubAllGlobals()
    })

    it('com offline, atualização e instalação juntas, tudo cabe na mesma pilha', () => {
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
      const { container } = renderAt()
      act(() => pwaMock.set({ updateAvailable: true }))

      expect(container.querySelectorAll('.worki-pwa-stack')).toHaveLength(1)
      expect(screen.getByText(/sem internet/i)).toBeInTheDocument()
      expect(screen.getByText('Nova versão disponível')).toBeInTheDocument()
    })
  })

  describe('celular (< 640px): linhas compactas', () => {
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (q: string) => ({
        matches: q === '(max-width: 639px)',
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    })
    afterEach(() => vi.unstubAllGlobals())

    it('convite é UMA linha de 56px (h-14) com Instalar e dispensar de 44px; texto completo na folha', () => {
      pwaMock.set({ installAvailable: true })
      renderAt('/company/jobs')
      const linha = screen.getByLabelText('Instalar o Worki')
      expect(linha).toHaveClass('h-14')
      expect(linha).not.toHaveTextContent('Abra seus turnos')
      const dispensar = screen.getByRole('button', { name: 'Agora não' })
      expect(dispensar).toHaveClass('h-11', 'w-11')
      expect(screen.getByRole('button', { name: 'Instalar' })).toHaveClass('h-11')

      fireEvent.click(screen.getByRole('button', { name: 'Instalar' }))
      expect(screen.getByText(/Abra seus turnos direto da tela inicial/)).toBeInTheDocument()
      pwaMock.promptInstall.mockResolvedValue('accepted')
      fireEvent.click(screen.getByRole('button', { name: 'Instalar agora' }))
      expect(pwaMock.promptInstall).toHaveBeenCalledTimes(1)
    })

    it('iPhone: a folha traz o passo a passo e "Entendi" dispensa', () => {
      pwaMock.isIosSafari.mockReturnValue(true)
      renderAt('/dashboard')
      fireEvent.click(screen.getByRole('button', { name: 'Instalar' }))
      expect(screen.getByText(/Adicionar à Tela de Início/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Entendi' }))
      expect(screen.queryByLabelText('Instalar o Worki')).not.toBeInTheDocument()
      expect(window.localStorage.getItem(INSTALL_DISMISS_KEY)).not.toBeNull()
    })

    it('aviso sem internet é uma linha de 40px (h-10) com texto curto', () => {
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
      renderAt()
      const aviso = screen.getByRole('status')
      expect(aviso).toHaveClass('h-10')
      expect(aviso).toHaveTextContent(/Sem internet/)
    })
  })
})
