import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NotificationBell from '../NotificationBell'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

const mockMarkAsRead = vi.fn()
const mockMarkAllAsRead = vi.fn()
let mockNotifications: Array<{
  id: string
  type: string
  title: string
  message: string
  read_at: string | null
  created_at: string
  link?: string
}> = []
let mockUnreadCount = 0
let mockUserType: string | undefined = undefined

vi.mock('../../contexts/NotificationContext', () => ({
  useNotifications: () => ({
    notifications: mockNotifications,
    unreadCount: mockUnreadCount,
    markAsRead: mockMarkAsRead,
    markAllAsRead: mockMarkAllAsRead,
  }),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockUserType === undefined ? null : { user_metadata: { user_type: mockUserType } },
  }),
}))

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNotifications = []
    mockUnreadCount = 0
    mockUserType = undefined
  })

  it('renderiza icone de sino', () => {
    render(<NotificationBell />)

    const button = screen.getByLabelText('Notificações')
    expect(button).toBeInTheDocument()
  })

  it('mostra badge com contagem quando ha notificacoes nao lidas', () => {
    mockUnreadCount = 3
    mockNotifications = [
      {
        id: '1',
        type: 'system',
        title: 'Notificacao 1',
        message: 'Mensagem 1',
        read_at: null,
        created_at: '2026-03-10T10:00:00Z',
      },
      {
        id: '2',
        type: 'payment',
        title: 'Notificacao 2',
        message: 'Mensagem 2',
        read_at: null,
        created_at: '2026-03-10T09:00:00Z',
      },
      {
        id: '3',
        type: 'message',
        title: 'Notificacao 3',
        message: 'Mensagem 3',
        read_at: null,
        created_at: '2026-03-10T08:00:00Z',
      },
    ]

    render(<NotificationBell />)

    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('nao mostra badge quando nao ha notificacoes nao lidas', () => {
    mockUnreadCount = 0

    render(<NotificationBell />)

    const badge = screen.queryByText('0')
    expect(badge).not.toBeInTheDocument()
  })

  it('mostra 9+ quando ha mais de 9 notificacoes nao lidas', () => {
    mockUnreadCount = 15

    render(<NotificationBell />)

    expect(screen.getByText('9+')).toBeInTheDocument()
  })

  it('navega para /notifications ao clicar em "Ver todas" quando usuario e freela', () => {
    mockUserType = 'freelancer'

    render(<NotificationBell />)
    fireEvent.click(screen.getByLabelText('Notificações'))
    fireEvent.click(screen.getByText('Ver todas as notificações'))

    expect(mockNavigate).toHaveBeenCalledWith('/notifications')
  })

  it('navega para /company/notifications ao clicar em "Ver todas" quando usuario e empresa', () => {
    mockUserType = 'hire'

    render(<NotificationBell />)
    fireEvent.click(screen.getByLabelText('Notificações'))
    fireEvent.click(screen.getByText('Ver todas as notificações'))

    expect(mockNavigate).toHaveBeenCalledWith('/company/notifications')
  })
})
