import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PwaPrompts from './PwaPrompts'
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

    it('"Dispensar" esconde o convite e grava a dispensa em localStorage', () => {
      renderAt()
      act(() => pwaMock.set({ installAvailable: true }))

      fireEvent.click(screen.getByRole('button', { name: 'Dispensar convite de instalação' }))

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
      fireEvent.click(screen.getByRole('button', { name: 'Dispensar convite de instalação' }))
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

    it('antes do atraso inicial; depois dele, aparece', () => {
      vi.useFakeTimers()
      renderAt('/dashboard', 6000)
      act(() => pwaMock.set({ installAvailable: true }))
      expect(screen.queryByLabelText('Instalar o Worki')).not.toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(6000)
      })

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
  })
})
