import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from './Button'

describe('Button', () => {
  it('usa type="button" por padrão (não submete formulário sem querer)', () => {
    render(<Button>Salvar</Button>)
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveAttribute('type', 'button')
  })

  it('permite type="submit" explícito', () => {
    render(<Button type="submit">Enviar</Button>)
    expect(screen.getByRole('button', { name: 'Enviar' })).toHaveAttribute('type', 'submit')
  })

  it.each([
    ['primary', 'bg-primary-dark'],
    ['dark', 'bg-black'],
    ['secondary', 'bg-white'],
    ['ghost', 'bg-transparent'],
    ['danger', 'bg-red-600'],
  ] as const)('variante %s aplica %s', (variant, cls) => {
    render(<Button variant={variant}>Ok</Button>)
    expect(screen.getByRole('button')).toHaveClass(cls)
  })

  it('variantes com moldura mantêm borda preta 2px e sombra offset (Article 13)', () => {
    render(<Button variant="dark">Ok</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toHaveClass('border-2', 'border-black', 'rounded-xl', 'font-bold')
    expect(btn.className).toContain('shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]')
  })

  it('tamanho md (padrão) tem h-11 = alvo de toque 44px', () => {
    render(<Button>Ok</Button>)
    expect(screen.getByRole('button')).toHaveClass('h-11')
  })

  it.each([
    ['sm', 'h-9'],
    ['md', 'h-11'],
    ['lg', 'h-12'],
  ] as const)('tamanho %s aplica %s', (size, cls) => {
    render(<Button size={size}>Ok</Button>)
    expect(screen.getByRole('button')).toHaveClass(cls)
  })

  it('não usa caixa-alta por padrão; uppercase é opt-in', () => {
    const { rerender } = render(<Button>Ok</Button>)
    expect(screen.getByRole('button')).not.toHaveClass('uppercase')
    rerender(<Button uppercase>Ok</Button>)
    expect(screen.getByRole('button')).toHaveClass('uppercase')
  })

  it('fullWidth aplica w-full', () => {
    render(<Button fullWidth>Ok</Button>)
    expect(screen.getByRole('button')).toHaveClass('w-full')
  })

  it('dispara onClick quando habilitado', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Ok</Button>)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('disabled bloqueia o clique', () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Ok
      </Button>,
    )
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('loading desabilita o clique, mostra spinner e marca aria-busy', () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Salvar
      </Button>,
    )
    const btn = screen.getByRole('button', { name: 'Salvar' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('button-spinner')).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('sem loading não renderiza spinner nem aria-busy', () => {
    render(<Button>Salvar</Button>)
    expect(screen.queryByTestId('button-spinner')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy')
  })

  it('renderiza iconLeft e iconRight (esconde iconRight durante loading)', () => {
    const { rerender } = render(
      <Button iconLeft={<span data-testid="l" />} iconRight={<span data-testid="r" />}>
        Ok
      </Button>,
    )
    expect(screen.getByTestId('l')).toBeInTheDocument()
    expect(screen.getByTestId('r')).toBeInTheDocument()
    rerender(
      <Button loading iconLeft={<span data-testid="l" />} iconRight={<span data-testid="r" />}>
        Ok
      </Button>,
    )
    expect(screen.queryByTestId('l')).not.toBeInTheDocument()
    expect(screen.queryByTestId('r')).not.toBeInTheDocument()
  })

  it('encaminha ref e className extra', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Button ref={ref} className="mt-2">
        Ok
      </Button>,
    )
    expect(ref.current).toBe(screen.getByRole('button'))
    expect(ref.current).toHaveClass('mt-2')
  })
})

describe('Button — contraste e movimento', () => {
  it('primary usa primary-dark (AA com texto branco), nunca o verde de marca puro', () => {
    render(<Button>Ok</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toHaveClass('bg-primary-dark', 'text-white')
    expect(btn).not.toHaveClass('bg-primary')
  })

  it('respeita prefers-reduced-motion', () => {
    render(<Button>Ok</Button>)
    expect(screen.getByRole('button')).toHaveClass('motion-reduce:transition-none', 'motion-reduce:transform-none')
  })

  it('className do chamador sobrescreve o padrão sem "!" (cx resolve conflito)', () => {
    render(<Button className="h-14 px-0">Ok</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toHaveClass('h-14', 'px-0')
    expect(btn).not.toHaveClass('h-11')
    expect(btn).not.toHaveClass('px-5')
  })
})
