import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Menu } from './Menu'
import { placeMenu } from './menuPosition'

const setup = () => {
  const edit = vi.fn()
  const remove = vi.fn()
  const card = vi.fn()
  render(
    <div onClick={card}>
      <Menu
        label="Mais opções do turno"
        items={[{ label: 'Editar', onSelect: edit }, false, { label: 'Excluir', onSelect: remove, danger: true }]}
      />
    </div>,
  )
  return { edit, remove, card, trigger: screen.getByRole('button', { name: 'Mais opções do turno' }) }
}

describe('Menu', () => {
  it('abre com foco no primeiro item e não propaga o clique para o cartão', () => {
    const { trigger, card } = setup()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: 'Editar' })).toHaveFocus()
    expect(card).not.toHaveBeenCalled()
  })

  it('setas, Home e End percorrem os itens; Esc fecha e devolve o foco', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Excluir' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Editar' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'End' })
    expect(screen.getByRole('menuitem', { name: 'Excluir' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('escolher um item fecha e chama a ação; toque fora fecha sem chamar nada', () => {
    const { trigger, edit, remove } = setup()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editar' }))
    expect(edit).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('placeMenu', () => {
  const bounds = { width: 390, top: 56, bottom: 778 }
  const size = { width: 240, height: 300 }

  it('abre para baixo quando cabe', () => {
    expect(placeMenu({ top: 200, bottom: 244, right: 370 }, size, bounds)).toMatchObject({
      opensUp: false,
      top: 250,
      left: 130,
    })
  })

  it('vira para cima perto da barra inferior e nunca passa do limite', () => {
    const place = placeMenu({ top: 700, bottom: 744, right: 370 }, size, bounds)
    expect(place.opensUp).toBe(true)
    expect(place.top + Math.min(size.height, place.maxHeight)).toBeLessThanOrEqual(700)
    expect(place.top).toBeGreaterThanOrEqual(bounds.top)
  })

  it('não cabe de nenhum lado: usa a área útil e mostra tudo', () => {
    const place = placeMenu({ top: 300, bottom: 344, right: 300 }, { width: 240, height: 440 }, { width: 320, top: 56, bottom: 576 })
    expect(place.maxHeight).toBeGreaterThanOrEqual(440)
    expect(place.top).toBeGreaterThanOrEqual(56)
    expect(place.top + 440).toBeLessThanOrEqual(576)
  })

  it('tela baixa: limita a altura (o menu rola) e não sai pela esquerda', () => {
    const place = placeMenu({ top: 200, bottom: 244, right: 100 }, size, { width: 320, top: 56, bottom: 320 })
    expect(place.maxHeight).toBeLessThan(size.height)
    expect(place.left).toBe(8)
  })
})
