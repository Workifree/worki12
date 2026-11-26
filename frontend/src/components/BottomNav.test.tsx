import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BottomNav from './BottomNav'

vi.mock('../hooks/useCurrentCompany', () => ({ useCurrentCompany: () => null }))
vi.mock('../hooks/useCompanyNavContext', () => ({
  useCompanyNavContext: () => ({ isEncarregado: false, hasTeam: false }),
}))

function renderNav(path: string, type: 'worker' | 'company') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav type={type} />
    </MemoryRouter>,
  )
}

describe('BottomNav', () => {
  it('marca só a rota atual e dá nome a todos os itens', () => {
    renderNav('/my-jobs', 'worker')

    const nav = screen.getByRole('navigation', { name: 'Menu de navegação' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual(['Início', 'Turnos', 'Empresas', 'Recebimentos', 'Mensagens'])
    expect(links.filter((a) => a.getAttribute('aria-current') === 'page')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Turnos' })).toHaveAttribute('aria-current', 'page')
  })

  it('é a barra do celular: fixa na base, com safe-area e publicada como [data-bottom-nav]', () => {
    renderNav('/company/jobs', 'company')

    const nav = screen.getByRole('navigation', { name: 'Menu de navegação' })
    expect(nav).toHaveAttribute('data-bottom-nav')
    expect(nav).toHaveClass('md:hidden', 'fixed', 'bottom-0', 'pb-safe')
  })

  it('rótulo com 12px ou mais (text-xs) e alvo mínimo de 44px', () => {
    renderNav('/dashboard', 'worker')

    const link = screen.getByRole('link', { name: 'Início' })
    expect(link).toHaveClass('min-h-11', 'min-w-11')
    expect(within(link).getByText('Início')).toHaveClass('text-xs')
  })
})
