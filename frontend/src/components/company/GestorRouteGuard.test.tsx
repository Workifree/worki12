import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GestorRouteGuard from './GestorRouteGuard'
import { getMyCompanies } from '../../services/companyScopeService'

vi.mock('../../services/companyScopeService', async () => {
  const actual = await vi.importActual<typeof import('../../services/companyScopeService')>('../../services/companyScopeService')
  return { ...actual, getMyCompanies: vi.fn() }
})
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getUser: vi.fn() } } }))

const mounted = vi.fn()
function Tela() {
  mounted()
  return <p>conteúdo do gestor</p>
}
const as = (role: string) => vi.mocked(getMyCompanies).mockResolvedValue([{ company_id: 'c1', role }] as never)
const open = (path: string) => render(<MemoryRouter initialEntries={[path]}><GestorRouteGuard><Tela /></GestorRouteGuard></MemoryRouter>)

beforeEach(() => vi.clearAllMocks())

describe('D-5: guarda única das rotas do Gestor', () => {
  it.each([
    '/company/indicacoes', '/company/relatorio', '/company/operacao', '/company/configuracoes/equipe',
  ])('encarregado em %s: sem acesso, e a tela nunca chega a montar', async (path) => {
    as('encarregado')
    open(path)
    expect(await screen.findByRole('heading', { name: /não tem acesso/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Voltar ao Início' })).toBeInTheDocument()
    expect(mounted).not.toHaveBeenCalled()
  })

  it('encarregado entra no Elenco (R7/R10b)', () => {
    as('encarregado')
    open('/company/team')
    expect(screen.getByText('conteúdo do gestor')).toBeInTheDocument()
  })

  it('dono vê o relatório', async () => {
    as('owner')
    open('/company/relatorio')
    expect(await screen.findByText('conteúdo do gestor')).toBeInTheDocument()
  })
})
