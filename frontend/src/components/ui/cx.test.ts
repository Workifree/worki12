import { describe, it, expect } from 'vitest'
import { cx } from './cx'

describe('cx', () => {
  it('ignora valores falsy e junta o resto', () => {
    expect(cx('a', false, null, undefined, '', 'b')).toBe('a b')
  })

  it('o último vence em conflitos do Tailwind (sem precisar de "!")', () => {
    expect(cx('px-3', 'px-0')).toBe('px-0')
    expect(cx('h-11', 'h-24')).toBe('h-24')
    expect(cx('text-black', 'text-red-600')).toBe('text-red-600')
    expect(cx('bg-primary', 'bg-black')).toBe('bg-black')
  })

  it('resolve sombras arbitrárias e raio custom (pill)', () => {
    expect(cx('shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]', 'shadow-none')).toBe('shadow-none')
    expect(cx('rounded-xl', 'rounded-pill')).toBe('rounded-pill')
  })

  it('não confunde propriedades diferentes nem modificadores diferentes', () => {
    expect(cx('border-2', 'border-black')).toBe('border-2 border-black')
    expect(cx('text-sm', 'text-white')).toBe('text-sm text-white')
    expect(cx('p-5', 'sm:p-6')).toBe('p-5 sm:p-6')
    expect(cx('shadow-sm', 'hover:shadow-md')).toBe('shadow-sm hover:shadow-md')
  })
})
