import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ActionBar, Button, ButtonLink, EmptyState, ErrorState, ProgressBar, StatusBadge, Tabs } from '.'
import { cx } from './cx'

describe('primitivos da fundação', () => {
  it('StatusBadge usa o glossário e nunca mostra o enum', () => {
    render(<StatusBadge domain="application" status="cancelled" />)
    expect(screen.getByText('Cancelado')).toBeInTheDocument()
    expect(screen.queryByText('cancelled')).not.toBeInTheDocument()
  })

  it('ErrorState oferece "Tentar de novo"', () => {
    const onRetry = vi.fn()
    render(<ErrorState onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('EmptyState mostra título e próximo passo', () => {
    render(<EmptyState title="Nada aqui." action={<Button>Criar</Button>} />)
    expect(screen.getByRole('heading', { name: 'Nada aqui.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Criar' })).toBeInTheDocument()
  })

  it('ButtonLink é link, sem pseudo :enabled', () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/x" variant="dark">Criar turno</ButtonLink>
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: 'Criar turno' })
    expect(link.className).not.toContain('enabled:')
    expect(link).toHaveClass('bg-black', 'shadow-brutal-sm')
  })

  it('ActionBar: secundária antes da principal no DOM', () => {
    render(<ActionBar secondary={<Button>Voltar</Button>} primary={<Button>Salvar</Button>} />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Voltar', 'Salvar'])
  })

  it('ProgressBar limita o valor e tem nome', () => {
    render(<ProgressBar value={150} label="Perfil" />)
    expect(screen.getByRole('progressbar', { name: 'Perfil' })).toHaveAttribute('value', '100')
  })

  it('Tabs: seleção por clique e uma só aba no Tab', () => {
    const onChange = vi.fn()
    render(
      <Tabs label="Turnos" value="a" onChange={onChange} tabs={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]} />,
    )
    expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('tabindex', '-1')
    fireEvent.click(screen.getByRole('tab', { name: 'B' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('cx trata as sombras do tema como sombra', () => {
    expect(cx('shadow-brutal', 'shadow-none')).toBe('shadow-none')
  })
})
