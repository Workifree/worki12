import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TosGateModal from './TosGateModal'

// Mock supabase — use vi.fn() directly inside factory (hoisting safety)
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => Promise.resolve({ data: [{ id: 'user-1' }], error: null })),
        })),
      })),
    })),
    auth: {
      getUser: vi.fn(() =>
        Promise.resolve({ data: { user: { id: 'user-1' } } })
      ),
    },
  },
}))

// Mock useToast — use vi.fn() directly inside factory
const mockAddToast = vi.fn()
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({
    addToast: mockAddToast,
    removeToast: vi.fn(),
  }),
}))

import { supabase } from '../lib/supabase'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TosGateModal', () => {
  it('renderiza com checkbox desmarcado inicialmente', () => {
    render(
      <TosGateModal userRole="worker" onAccepted={vi.fn()} />
    )

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    expect(screen.getByText('Termos de Uso Atualizados')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /aceitar e continuar/i })).toBeInTheDocument()
  })

  it('botão desabilitado quando checkbox desmarcado', () => {
    render(
      <TosGateModal userRole="worker" onAccepted={vi.fn()} />
    )

    const button = screen.getByRole('button', { name: /aceitar e continuar/i })
    expect(button).toBeDisabled()
  })

  it('botão habilitado quando checkbox marcado', () => {
    render(
      <TosGateModal userRole="company" onAccepted={vi.fn()} />
    )

    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)

    const button = screen.getByRole('button', { name: /aceitar e continuar/i })
    expect(button).not.toBeDisabled()
  })

  // Alto risco (patterns.md — UPDATE sob RLS negado em silêncio): aceite dos Termos é
  // contratual, não preferência de UI. Sem `.select('id')`, um UPDATE negado pela RLS
  // devolveria 204 sem erro e o usuário ficaria em loop (aceita, gate reaparece, aceita de novo).
  it('mostra erro visível e NÃO chama onAccepted quando o UPDATE afeta 0 linhas (RLS negou em silêncio)', async () => {
    vi.mocked(supabase.from).mockReturnValue({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const mockOnAccepted = vi.fn()
    render(<TosGateModal userRole="worker" onAccepted={mockOnAccepted} />)

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /aceitar e continuar/i }))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'Não foi possível confirmar o aceite dos termos. Tente novamente ou contate o suporte.',
        'error'
      )
    })
    expect(mockOnAccepted).not.toHaveBeenCalled()
  })
})
