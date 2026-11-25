import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import ChatComposerField from './ChatComposerField'

function montar() {
  const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault())
  render(
    <form onSubmit={onSubmit}>
      <ChatComposerField value="oi" onChange={() => {}} inputRef={createRef<HTMLTextAreaElement>()} />
    </form>,
  )
  return { onSubmit, campo: screen.getByRole('textbox', { name: 'Mensagem' }) }
}

afterEach(() => vi.unstubAllGlobals())

describe('ChatComposerField', () => {
  it('desktop: Enter envia; Shift+Enter e composição não', () => {
    const { onSubmit, campo } = montar()
    expect(campo.tagName).toBe('TEXTAREA')
    expect(fireEvent.keyDown(campo, { key: 'Enter', shiftKey: true })).toBe(true)
    expect(fireEvent.keyDown(campo, { key: 'Enter', isComposing: true })).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(campo, { key: 'Enter' })).toBe(false)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('toque: Enter quebra linha e não envia', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { onSubmit, campo } = montar()
    expect(fireEvent.keyDown(campo, { key: 'Enter' })).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(campo).toHaveAttribute('enterkeyhint', 'enter')
  })
})
