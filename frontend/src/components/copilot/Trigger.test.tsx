import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HEADER_MESSAGES, TriggerBody } from './Trigger'
import { StopButton } from './CopilotParts'

describe('pílula do cabeçalho (celular)', () => {
  it('diz que é o Copiloto, uma IA, com a mensagem em shimmer', () => {
    const { container } = render(<TriggerBody compact />)
    expect(HEADER_MESSAGES[0]).toBe('Copiloto')
    expect(screen.getAllByText('Copiloto').length).toBeGreaterThan(0)
    expect(screen.getByText('IA')).toBeInTheDocument()
    expect(container.querySelector('.wk-shim__win')).not.toBeNull()
  })
})

describe('Parar no celular', () => {
  it('tem a classe de alvo de toque de 44px', () => {
    render(<StopButton onStop={() => {}} touch />)
    expect(screen.getByRole('button', { name: 'PARAR' })).toHaveClass('wk-stop--touch')
  })
})
