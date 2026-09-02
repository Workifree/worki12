import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Notifications from './Notifications'

// Mocks — factories must not reference outer variables
vi.mock('../contexts/NotificationContext', () => ({
  useNotifications: vi.fn(),
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: { user_metadata: { user_type: 'work' } } })),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: vi.fn(() => vi.fn()),
  }
})

import { useNotifications, type Notification } from '../contexts/NotificationContext'

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notif-1',
    type: 'system',
    title: 'Notificação teste',
    message: 'Mensagem de teste',
    read_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function renderComponent() {
  return render(
    <MemoryRouter>
      <Notifications />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Notifications page', () => {
  it('renderiza empty state quando notifications está vazio', () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [],
      unreadCount: 0, carregando: false, erroCarga: false,
      markAsRead: vi.fn(),
      markAllAsRead: vi.fn(),
    })

    renderComponent()

    expect(screen.getByText(/Nenhuma notificação por aqui ainda/)).toBeInTheDocument()
    expect(screen.getByText('Ir para o Dashboard')).toBeInTheDocument()
  })

  it('filtro Pagamentos exibe apenas notificações com type=payment', () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [
        makeNotification({ id: '1', type: 'payment', title: 'Pagamento recebido' }),
        makeNotification({ id: '2', type: 'message', title: 'Nova mensagem' }),
        makeNotification({ id: '3', type: 'system', title: 'Atualização do sistema' }),
      ],
      unreadCount: 3, carregando: false, erroCarga: false,
      markAsRead: vi.fn(),
      markAllAsRead: vi.fn(),
    })

    renderComponent()

    // All visible initially
    expect(screen.getByText('Pagamento recebido')).toBeInTheDocument()
    expect(screen.getByText('Nova mensagem')).toBeInTheDocument()
    expect(screen.getByText('Atualização do sistema')).toBeInTheDocument()

    // Click "Pagamentos" filter
    fireEvent.click(screen.getByText('Pagamentos'))

    // Only payment notification visible
    expect(screen.getByText('Pagamento recebido')).toBeInTheDocument()
    expect(screen.queryByText('Nova mensagem')).not.toBeInTheDocument()
    expect(screen.queryByText('Atualização do sistema')).not.toBeInTheDocument()
  })

  it('clicar em notificação chama markAsRead com o id correto', () => {
    const mockMarkAsRead = vi.fn().mockResolvedValue(undefined)

    vi.mocked(useNotifications).mockReturnValue({
      notifications: [
        makeNotification({ id: 'notif-abc', title: 'Notificação clicável' }),
      ],
      unreadCount: 1, carregando: false, erroCarga: false,
      markAsRead: mockMarkAsRead,
      markAllAsRead: vi.fn(),
    })

    renderComponent()

    fireEvent.click(screen.getByText('Notificação clicável'))

    expect(mockMarkAsRead).toHaveBeenCalledWith('notif-abc')
  })

  it('botão Marcar todas chama markAllAsRead', () => {
    const mockMarkAllAsRead = vi.fn().mockResolvedValue(undefined)

    vi.mocked(useNotifications).mockReturnValue({
      notifications: [
        makeNotification({ id: '1', read_at: null }),
      ],
      unreadCount: 1, carregando: false, erroCarga: false,
      markAsRead: vi.fn(),
      markAllAsRead: mockMarkAllAsRead,
    })

    renderComponent()

    fireEvent.click(screen.getByText('Marcar todas como lidas'))

    expect(mockMarkAllAsRead).toHaveBeenCalledTimes(1)
  })

  it('paginação exibe máximo 20 itens por página', () => {
    const twentyFiveNotifications = Array.from({ length: 25 }, (_, i) =>
      makeNotification({ id: `n-${i}`, title: `Notificação ${i + 1}` })
    )

    vi.mocked(useNotifications).mockReturnValue({
      notifications: twentyFiveNotifications,
      unreadCount: 25, carregando: false, erroCarga: false,
      markAsRead: vi.fn(),
      markAllAsRead: vi.fn(),
    })

    renderComponent()

    // Only 20 items on first page
    const items = screen.getAllByText(/Notificação \d+/)
    expect(items.length).toBe(20)

    // "Próxima" button should be visible
    expect(screen.getByText(/Próxima/)).toBeInTheDocument()
    // "Página anterior" should be disabled
    expect(screen.getByText(/Página anterior/)).toBeDisabled()
  })
})
