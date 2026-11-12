import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Field } from './Field'

describe('Field', () => {
  it('associa o label ao input (getByLabelText)', () => {
    render(
      <Field label="Nome">
        <input type="text" />
      </Field>,
    )
    const input = screen.getByLabelText('Nome')
    expect(input.tagName).toBe('INPUT')
    expect(screen.getByText('Nome')).toHaveAttribute('for', input.id)
  })

  it('funciona com textarea e select', () => {
    render(
      <>
        <Field label="Descrição">
          <textarea />
        </Field>
        <Field label="Cidade">
          <select>
            <option>SP</option>
          </select>
        </Field>
      </>,
    )
    expect(screen.getByLabelText('Descrição').tagName).toBe('TEXTAREA')
    expect(screen.getByLabelText('Cidade').tagName).toBe('SELECT')
  })

  it('respeita id fornecido pelo controle', () => {
    render(
      <Field label="CPF">
        <input id="cpf-x" />
      </Field>,
    )
    expect(screen.getByLabelText('CPF')).toHaveAttribute('id', 'cpf-x')
  })

  it('aplica classes canônicas do input e preserva className do controle', () => {
    render(
      <Field label="Nome">
        <input className="uppercase" />
      </Field>,
    )
    const input = screen.getByLabelText('Nome')
    expect(input).toHaveClass('border-2', 'border-black', 'rounded-xl', 'h-11', 'px-4', 'uppercase')
    expect(input.className).toContain('focus:ring-2')
    expect(input.className).toContain('focus:ring-primary')
  })

  it('hint fica ligado via aria-describedby', () => {
    render(
      <Field label="Nome" hint="Como no documento">
        <input />
      </Field>,
    )
    const input = screen.getByLabelText('Nome')
    const hint = screen.getByText('Como no documento')
    expect(input.getAttribute('aria-describedby')).toContain(hint.id)
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('erro vira alert, marca aria-invalid e entra no aria-describedby', () => {
    render(
      <Field label="Nome" error="Campo obrigatório">
        <input />
      </Field>,
    )
    const input = screen.getByLabelText('Nome')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Campo obrigatório')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toContain(alert.id)
  })

  it('com erro e hint, ambos ficam descritos E visíveis (hint não vira sr-only)', () => {
    render(
      <Field label="Nome" hint="Dica" error="Erro">
        <input />
      </Field>,
    )
    const input = screen.getByLabelText('Nome')
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ')
    expect(ids).toContain(screen.getByText('Dica').id)
    expect(ids).toContain(screen.getByRole('alert').id)
    expect(screen.getByText('Dica')).not.toHaveClass('sr-only')
    expect(screen.getByText('Dica')).toHaveClass('text-xs', 'text-gray-600')
  })

  it('placeholder tem contraste suficiente (gray-500)', () => {
    render(
      <Field label="Nome">
        <input placeholder="Seu nome" />
      </Field>,
    )
    const cls = screen.getByLabelText('Nome').className
    expect(cls).toContain('placeholder:text-gray-500')
    expect(cls).not.toContain('placeholder:text-gray-400')
  })

  it('textarea não força h-11: usa altura mínima própria', () => {
    render(
      <Field label="Descrição">
        <textarea />
      </Field>,
    )
    const ta = screen.getByLabelText('Descrição')
    expect(ta).not.toHaveClass('h-11')
    expect(ta).toHaveClass('min-h-24', 'py-3')
  })

  it('className do controle sobrescreve a altura padrão sem "!"', () => {
    render(
      <Field label="Descrição">
        <textarea className="min-h-40" />
      </Field>,
    )
    const ta = screen.getByLabelText('Descrição')
    expect(ta).toHaveClass('min-h-40')
    expect(ta).not.toHaveClass('min-h-24')
    render(
      <Field label="Nome">
        <input className="h-14" />
      </Field>,
    )
    const input = screen.getByLabelText('Nome')
    expect(input).toHaveClass('h-14')
    expect(input).not.toHaveClass('h-11')
  })

  it('required adiciona asterisco decorativo (aria-hidden)', () => {
    render(
      <Field label="Nome" required>
        <input required />
      </Field>,
    )
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByLabelText(/Nome/)).toBeRequired()
  })

  it('ids são únicos entre campos', () => {
    render(
      <>
        <Field label="A">
          <input />
        </Field>
        <Field label="B">
          <input />
        </Field>
      </>,
    )
    expect(screen.getByLabelText('A').id).not.toBe(screen.getByLabelText('B').id)
  })
})
