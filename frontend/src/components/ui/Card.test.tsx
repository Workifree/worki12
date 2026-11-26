import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Card } from './Card'

describe('Card', () => {
  it('padrão: fundo branco, rounded-2xl, borda cinza 1px e sem sombra', () => {
    render(<Card data-testid="c">x</Card>)
    const c = screen.getByTestId('c')
    expect(c).toHaveClass('bg-white', 'border', 'border-gray-200', 'rounded-2xl')
    expect(c.className).not.toMatch(/shadow|border-2|border-black/)
  })

  it('flat não tem borda; highlight tem borda 1,5px preta e brutal-xs', () => {
    const { rerender } = render(<Card data-testid="c" tone="flat">x</Card>)
    expect(screen.getByTestId('c')).toHaveClass('border-0')
    rerender(<Card data-testid="c" tone="highlight">x</Card>)
    expect(screen.getByTestId('c')).toHaveClass('border-ink', 'border-black', 'shadow-brutal-xs')
  })

  it('padding padrão md; aceita sm, lg e none', () => {
    const { rerender } = render(<Card data-testid="c">x</Card>)
    expect(screen.getByTestId('c')).toHaveClass('p-5')
    rerender(
      <Card data-testid="c" padding="sm">
        x
      </Card>,
    )
    expect(screen.getByTestId('c')).toHaveClass('p-4')
    rerender(
      <Card data-testid="c" padding="lg">
        x
      </Card>,
    )
    expect(screen.getByTestId('c')).toHaveClass('p-6')
    rerender(
      <Card data-testid="c" padding="none">
        x
      </Card>,
    )
    expect(screen.getByTestId('c').className).not.toMatch(/\bp-\d/)
  })

  it('interactive adiciona hover; sem a prop não adiciona', () => {
    const { rerender } = render(<Card data-testid="c">x</Card>)
    expect(screen.getByTestId('c').className).not.toContain('hover:')
    rerender(
      <Card data-testid="c" interactive>
        x
      </Card>,
    )
    expect(screen.getByTestId('c').className).toContain('hover:bg-gray-50')
  })

  it('renderiza o elemento pedido em "as"', () => {
    render(
      <Card as="section" data-testid="c">
        x
      </Card>,
    )
    expect(screen.getByTestId('c').tagName).toBe('SECTION')
  })

  it('mescla className extra', () => {
    render(
      <Card data-testid="c" className="mt-4">
        x
      </Card>,
    )
    expect(screen.getByTestId('c')).toHaveClass('mt-4', 'border-gray-200')
  })

  describe('onActivate', () => {
    it('vira role="button" focável com visual interativo', () => {
      render(
        <Card data-testid="c" onActivate={() => {}}>
          x
        </Card>,
      )
      const c = screen.getByRole('button')
      expect(c).toBe(screen.getByTestId('c'))
      expect(c).toHaveAttribute('tabindex', '0')
      expect(c.className).toContain('hover:bg-gray-50')
      expect(c.className).toContain('focus-visible:ring-2')
    })

    it('sem onActivate não ganha role nem tabindex (uso atual intacto)', () => {
      render(<Card data-testid="c">x</Card>)
      expect(screen.getByTestId('c')).not.toHaveAttribute('role')
      expect(screen.getByTestId('c')).not.toHaveAttribute('tabindex')
    })

    it('ativa com clique, Enter e Espaço no próprio card', () => {
      const onActivate = vi.fn()
      render(<Card onActivate={onActivate}>x</Card>)
      const c = screen.getByRole('button')
      fireEvent.click(c)
      fireEvent.keyDown(c, { key: 'Enter' })
      fireEvent.keyDown(c, { key: ' ' })
      expect(onActivate).toHaveBeenCalledTimes(3)
    })

    it('ignora outras teclas', () => {
      const onActivate = vi.fn()
      render(<Card onActivate={onActivate}>x</Card>)
      fireEvent.keyDown(screen.getByRole('button'), { key: 'a' })
      expect(onActivate).not.toHaveBeenCalled()
    })

    it('NÃO dispara quando clique/teclado vêm de botão interno', () => {
      const onActivate = vi.fn()
      const onInner = vi.fn()
      render(
        <Card onActivate={onActivate} data-testid="c">
          <span>texto</span>
          <button type="button" onClick={onInner}>
            Interno
          </button>
        </Card>,
      )
      const inner = screen.getByRole('button', { name: 'Interno' })
      fireEvent.click(inner)
      fireEvent.keyDown(inner, { key: 'Enter' })
      fireEvent.keyDown(inner, { key: ' ' })
      expect(onInner).toHaveBeenCalledTimes(1)
      expect(onActivate).not.toHaveBeenCalled()
    })

    it('clique em conteúdo não interativo do card ativa', () => {
      const onActivate = vi.fn()
      render(
        <Card onActivate={onActivate}>
          <span>texto</span>
        </Card>,
      )
      fireEvent.click(screen.getByText('texto'))
      expect(onActivate).toHaveBeenCalledTimes(1)
    })
  })
})
