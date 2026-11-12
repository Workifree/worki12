import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { IconButton } from './IconButton'

describe('IconButton', () => {
  it('expõe o aria-label como nome acessível e usa type="button"', () => {
    render(
      <IconButton aria-label="Fechar">
        <svg data-testid="i" />
      </IconButton>,
    )
    const btn = screen.getByRole('button', { name: 'Fechar' })
    expect(btn).toHaveAttribute('type', 'button')
  })

  it('alvo de toque 44px quadrado', () => {
    render(<IconButton aria-label="Editar">x</IconButton>)
    expect(screen.getByRole('button')).toHaveClass('h-11', 'w-11')
  })

  it('esconde o ícone de leitores de tela', () => {
    render(
      <IconButton aria-label="Editar">
        <svg data-testid="i" />
      </IconButton>,
    )
    expect(screen.getByTestId('i').parentElement).toHaveAttribute('aria-hidden', 'true')
  })

  it.each([
    ['ghost', 'bg-transparent'],
    ['secondary', 'border-black'],
    ['danger', 'text-red-600'],
  ] as const)('variante %s aplica %s', (variant, cls) => {
    render(
      <IconButton aria-label="Ação" variant={variant}>
        x
      </IconButton>,
    )
    expect(screen.getByRole('button')).toHaveClass(cls)
  })

  it('tem foco visível', () => {
    render(<IconButton aria-label="Ação">x</IconButton>)
    expect(screen.getByRole('button').className).toContain('focus-visible:ring-2')
  })

  it('dispara onClick e respeita disabled', () => {
    const onClick = vi.fn()
    const { rerender } = render(
      <IconButton aria-label="Ação" onClick={onClick}>
        x
      </IconButton>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
    rerender(
      <IconButton aria-label="Ação" onClick={onClick} disabled>
        x
      </IconButton>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('encaminha ref e className extra', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <IconButton aria-label="Ação" ref={ref} className="-mr-2">
        x
      </IconButton>,
    )
    expect(ref.current).toBe(screen.getByRole('button'))
    expect(ref.current).toHaveClass('-mr-2')
  })
})
