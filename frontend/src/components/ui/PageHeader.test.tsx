import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageHeader } from './PageHeader'
import { Button } from './Button'

describe('PageHeader', () => {
  it('renderiza o título como h1 por padrão', () => {
    render(<PageHeader title="Meu Elenco" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Meu Elenco' })).toBeInTheDocument()
  })

  it('permite h2', () => {
    render(<PageHeader title="Seção" as="h2" />)
    expect(screen.getByRole('heading', { level: 2, name: 'Seção' })).toBeInTheDocument()
  })

  it('título usa escala contida (font-bold, sem uppercase)', () => {
    render(<PageHeader title="Título" />)
    const h = screen.getByRole('heading')
    expect(h).toHaveClass('text-2xl', 'font-bold', 'tracking-tight')
    expect(h).not.toHaveClass('uppercase')
    expect(h).not.toHaveClass('font-black')
  })

  it('mostra subtítulo só quando informado', () => {
    const { rerender } = render(<PageHeader title="T" />)
    expect(screen.queryByText('Sub')).not.toBeInTheDocument()
    rerender(<PageHeader title="T" subtitle="Sub" />)
    expect(screen.getByText('Sub')).toBeInTheDocument()
  })

  it('renderiza a ação primária no slot', () => {
    render(<PageHeader title="T" action={<Button>Convidar</Button>} />)
    expect(screen.getByRole('button', { name: 'Convidar' })).toBeInTheDocument()
  })

  it('empilha no mobile e alinha em linha a partir de sm', () => {
    render(<PageHeader title="T" />)
    const header = screen.getByRole('banner')
    expect(header).toHaveClass('flex-col', 'sm:flex-row')
  })

  it('margem inferior padrão mb-6 sm:mb-8', () => {
    render(<PageHeader title="T" />)
    expect(screen.getByRole('banner')).toHaveClass('mb-6', 'sm:mb-8')
  })

  it('flush remove a margem inferior sem precisar de "!mb-0"', () => {
    render(<PageHeader title="T" flush />)
    const header = screen.getByRole('banner')
    expect(header).toHaveClass('mb-0')
    expect(header).not.toHaveClass('mb-6')
    expect(header).not.toHaveClass('sm:mb-8')
  })
})
