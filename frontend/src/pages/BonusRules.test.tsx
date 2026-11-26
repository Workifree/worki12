import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import BonusRules from './BonusRules'

describe('BonusRules', () => {
  it('renderiza o regulamento sem exigir login', () => {
    render(
      <MemoryRouter>
        <BonusRules />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: /regulamento da trilha de bônus/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /como e quando o pix sai/i })).toBeInTheDocument()
    expect(screen.getByText(/Topei o desafio/)).toBeInTheDocument()
  })
})
