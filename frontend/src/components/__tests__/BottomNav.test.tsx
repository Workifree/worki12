import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BottomNav from '../BottomNav'

function renderBottomNav(type: 'worker' | 'company' = 'worker', path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav type={type} />
    </MemoryRouter>
  )
}

describe('BottomNav', () => {
  it('renderiza links de navegacao para worker', () => {
    renderBottomNav('worker')

    expect(screen.getByLabelText('Início')).toBeInTheDocument()
    expect(screen.getByLabelText('Vagas')).toBeInTheDocument()
    expect(screen.getByLabelText('Carteira')).toBeInTheDocument()
    expect(screen.getByLabelText('Clientes')).toBeInTheDocument()
    expect(screen.getByLabelText('Msgs')).toBeInTheDocument()
    expect(screen.getByLabelText('Perfil')).toBeInTheDocument()
  })

  it('renderiza links de navegacao para company', () => {
    renderBottomNav('company', '/company/dashboard')

    expect(screen.getByLabelText('Início')).toBeInTheDocument()
    expect(screen.getByLabelText('Elenco')).toBeInTheDocument()
    expect(screen.getByLabelText('Criar')).toBeInTheDocument()
    expect(screen.getByLabelText('Carteira')).toBeInTheDocument()
    expect(screen.getByLabelText('Perfil')).toBeInTheDocument()
  })

  it('worker tem 6 itens de navegacao', () => {
    renderBottomNav('worker')

    const nav = screen.getByLabelText('Menu de navegacao')
    const links = nav.querySelectorAll('a')
    expect(links).toHaveLength(6)
  })

  it('company tem 5 itens de navegacao', () => {
    renderBottomNav('company', '/company/dashboard')

    const nav = screen.getByLabelText('Menu de navegacao')
    const links = nav.querySelectorAll('a')
    expect(links).toHaveLength(5)
  })

  it('links de worker apontam para rotas corretas', () => {
    renderBottomNav('worker')

    expect(screen.getByLabelText('Início')).toHaveAttribute('href', '/dashboard')
    expect(screen.getByLabelText('Vagas')).toHaveAttribute('href', '/jobs')
    expect(screen.getByLabelText('Carteira')).toHaveAttribute('href', '/wallet')
    expect(screen.getByLabelText('Clientes')).toHaveAttribute('href', '/carteira')
    expect(screen.getByLabelText('Perfil')).toHaveAttribute('href', '/profile')
  })

  it('links de company apontam para rotas corretas', () => {
    renderBottomNav('company', '/company/dashboard')

    expect(screen.getByLabelText('Início')).toHaveAttribute('href', '/company/dashboard')
    expect(screen.getByLabelText('Elenco')).toHaveAttribute('href', '/company/team')
    expect(screen.getByLabelText('Criar')).toHaveAttribute('href', '/company/create')
    expect(screen.getByLabelText('Carteira')).toHaveAttribute('href', '/company/wallet')
    expect(screen.getByLabelText('Perfil')).toHaveAttribute('href', '/company/profile')
  })

  it('possui aria-label no elemento nav', () => {
    renderBottomNav('worker')

    expect(screen.getByLabelText('Menu de navegacao')).toBeInTheDocument()
  })

  it('destaca rota ativa para worker', () => {
    renderBottomNav('worker', '/jobs')

    const activeLink = screen.getByLabelText('Vagas')
    expect(activeLink.className).toContain('text-primary')

    const inactiveLink = screen.getByLabelText('Início')
    expect(inactiveLink.className).toContain('text-gray-400')
  })

  it('destaca rota ativa para company', () => {
    renderBottomNav('company', '/company/team')

    const activeLink = screen.getByLabelText('Elenco')
    expect(activeLink.className).toContain('text-blue-600')

    const inactiveLink = screen.getByLabelText('Início')
    expect(inactiveLink.className).toContain('text-gray-400')
  })
})
