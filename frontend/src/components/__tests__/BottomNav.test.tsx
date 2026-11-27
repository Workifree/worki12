import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BottomNav from '../BottomNav'
import type { MyCompany } from '../../types'

let mockCompany: MyCompany | null = null
vi.mock('../../hooks/useCurrentCompany', () => ({ useCurrentCompany: () => mockCompany }))

function company(overrides: Partial<MyCompany> = {}): MyCompany {
  return {
    company_id: 'c1', company_name: 'Loja', role: 'owner', organization_id: 'o1', organization_name: null,
    onboarding_completed: true, accepted_tos: true, team_enabled: false, ...overrides,
  }
}

function renderBottomNav(type: 'worker' | 'company' = 'worker', path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav type={type} />
    </MemoryRouter>
  )
}

const labels = () =>
  within(screen.getByLabelText('Menu de navegação')).getAllByRole('link').map((a) => a.getAttribute('aria-label'))

describe('BottomNav', () => {
  beforeEach(() => {
    sessionStorage.clear()
    mockCompany = null
  })

  it('freela: cinco itens (o perfil foi para o cabeçalho) com as rotas certas', () => {
    renderBottomNav('worker')

    expect(labels()).toEqual(['Início', 'Meus Turnos', 'Empresas', 'Recebimentos', 'Mensagens'])
    expect(screen.getByLabelText('Meus Turnos')).toHaveAttribute('href', '/my-jobs')
    expect(screen.getByLabelText('Empresas')).toHaveAttribute('href', '/carteira')
  })

  it('empresa: cinco itens, sem "Criar" nem "Perfil"', () => {
    mockCompany = company()
    renderBottomNav('company', '/company/dashboard')

    expect(labels()).toEqual(['Início', 'Turnos', 'Elenco', 'Mensagens', 'Gestão'])
    expect(screen.getByLabelText('Início')).toHaveAttribute('href', '/company/dashboard')
    expect(screen.getByLabelText('Gestão')).toHaveAttribute('href', '/company/gestao')
  })

  it('com equipe, Início leva à tela Hoje e fica ativo nas duas abas', () => {
    mockCompany = company({ team_enabled: true })
    renderBottomNav('company', '/company/dashboard')

    expect(screen.getByLabelText('Início')).toHaveAttribute('href', '/company/hoje')
    expect(screen.getByLabelText('Início')).toHaveAttribute('aria-current', 'page')
  })

  it('encarregado: no máximo 5 itens, com Relatórios e Ajuda sob "Mais" (alvos de 44px)', () => {
    mockCompany = company({ role: 'encarregado' })
    renderBottomNav('company', '/company/hoje')

    expect(labels()).toEqual(['Início', 'Turnos', 'Elenco', 'Mensagens', 'Mais'])
    expect(screen.getByLabelText('Mais')).toHaveAttribute('href', '/company/gestao')
    for (const link of within(screen.getByLabelText('Menu de navegação')).getAllByRole('link')) {
      expect(link.className).toContain('min-h-11')
      expect(link.className).toContain('min-w-11')
    }
  })

  it('encarregado: Relatórios, Ajuda e Trilha marcam "Mais" na barra', () => {
    mockCompany = company({ role: 'encarregado' })
    for (const path of ['/company/relatorio', '/ajuda', '/company/gestao']) {
      const { unmount } = renderBottomNav('company', path)
      expect(screen.getByLabelText('Mais')).toHaveAttribute('aria-current', 'page')
      unmount()
    }
  })

  it('papel ainda carregando e sem dica: menu restrito, Início já aponta para Hoje (sem piscar)', () => {
    renderBottomNav('company', '/company/dashboard')

    // Sem dica, assume o menu restrito: nada de Gestão (que o Encarregado não usa).
    expect(screen.queryByLabelText('Gestão')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Mais')).toBeInTheDocument()
    expect(screen.getByLabelText('Início')).toHaveAttribute('href', '/company/hoje')
  })

  it('papel carregando com dica de Gestor: menu completo desde o primeiro render', () => {
    sessionStorage.setItem('worki_nav_role_hint', 'gestor')
    renderBottomNav('company', '/company/dashboard')

    expect(screen.getByLabelText('Elenco')).toBeInTheDocument()
  })

  it('sub-rota mantém o item ativo (freela e empresa)', () => {
    renderBottomNav('worker', '/indicacoes')
    expect(screen.getByLabelText('Empresas').className).toContain('text-primary')
    expect(screen.getByLabelText('Início').className).toContain('text-gray-600')
  })

  it('empresa: detalhe do turno marca Turnos', () => {
    mockCompany = company()
    renderBottomNav('company', '/company/jobs/abc/candidates')

    expect(screen.getByLabelText('Turnos')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('Turnos').className).toContain('text-blue-700')
  })
})
