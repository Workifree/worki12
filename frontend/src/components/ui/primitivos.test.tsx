import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ActionBar, Button, ButtonLink, EmptyState, ErrorState, ProgressBar, SlotBadge, StatusBadge, Tabs } from '.'
import { cx } from './cx'

describe('primitivos da fundação', () => {
  it('StatusBadge usa o glossário e nunca mostra o enum', () => {
    render(<StatusBadge domain="application" status="cancelled" />)
    expect(screen.getByText('Cancelado')).toBeInTheDocument()
    expect(screen.queryByText('cancelled')).not.toBeInTheDocument()
  })

  it('ActionBar fixa no computador só quando pedido (stickyOnDesktop)', () => {
    const { container, rerender } = render(<ActionBar primary={<Button>Publicar</Button>} />)
    expect(container.firstElementChild?.className).toContain('md:static')
    rerender(<ActionBar stickyOnDesktop primary={<Button>Publicar</Button>} />)
    expect(container.firstElementChild?.className).not.toContain('md:static')
    expect(container.firstElementChild?.className).toContain('md:bottom-0')
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
    expect(link).toHaveClass('bg-[#2563EB]', 'shadow-brutal-sm')
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

describe('SlotBadge (contador de vagas do laboratório)', () => {
  it('completo = verde, faltando = âmbar, desconhecido = cinza; sempre com texto por extenso', () => {
    const { rerender } = render(<SlotBadge filled={5} total={5} />)
    expect(screen.getByRole('img', { name: '5 de 5 vagas preenchidas' })).toHaveClass('bg-[#D7F5E4]')
    rerender(<SlotBadge filled={1} total={3} />)
    expect(screen.getByRole('img', { name: '1 de 3 vagas preenchidas' })).toHaveClass('bg-[#FFE9B8]')
    expect(screen.getByText('1/3')).toBeInTheDocument()
    rerender(<SlotBadge filled={null} total={2} />)
    expect(screen.getByRole('img', { name: '2 vagas, ocupação não carregada' })).toHaveClass('bg-gray-100')
    expect(screen.getByText('–/2')).toBeInTheDocument()
    rerender(<SlotBadge filled={1} total={1} />)
    expect(screen.getByRole('img', { name: '1 de 1 vaga preenchida' })).toBeInTheDocument()
  })
})
