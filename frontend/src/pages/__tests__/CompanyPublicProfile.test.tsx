import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import CompanyPublicProfile from '../CompanyPublicProfile'

// Mock supabase
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}))

// Mock useNavigate (não precisamos navegar de verdade nos testes)
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: vi.fn(() => vi.fn()),
  }
})

import { supabase } from '../../lib/supabase'

function buildChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: [], error: null }),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
  return { ...chain, ...overrides }
}

const COMPANY_DATA = {
  id: 'company-1',
  name: 'Cafeteria Central',
  logo_url: null,
  cover_url: null,
  industry: 'Alimentação',
  description: 'A melhor cafeteria da região.',
  address: 'Av. Paulista, 1000',
  website: null,
  default_briefing: 'Camisa branca, calça jeans, chegar 10 min antes.',
  rating_average: 4.8,
  reviews_count: 12,
}

function renderComponent(id = 'company-1') {
  return render(
    <MemoryRouter initialEntries={[`/empresa/${id}`]}>
      <Routes>
        <Route path="/empresa/:id" element={<CompanyPublicProfile />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CompanyPublicProfile', () => {
  it('renderiza nome, briefing padrão e nota da empresa (R2)', async () => {
    const companiesChain = buildChain({
      single: vi.fn().mockResolvedValue({ data: COMPANY_DATA, error: null }),
    })
    const reviewsChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'companies') return companiesChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'reviews') return reviewsChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Cafeteria Central')).toBeInTheDocument()
    })

    // Briefing padrão em destaque — informação valiosa para o freela decidir o convite.
    expect(screen.getByText(/Camisa branca, calça jeans/)).toBeInTheDocument()
    // Nota + contagem de avaliações.
    expect(screen.getByText('4.8')).toBeInTheDocument()
    expect(screen.getByText('(12)')).toBeInTheDocument();
  })

  it('mostra estado "Empresa não encontrada" quando a busca falha', async () => {
    const companiesChain = buildChain({
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'companies') return companiesChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Empresa não encontrada')).toBeInTheDocument()
    })
  })

  it('mostra estado vazio do briefing quando a empresa não definiu um', async () => {
    const companiesChain = buildChain({
      single: vi.fn().mockResolvedValue({
        data: { ...COMPANY_DATA, default_briefing: null },
        error: null,
      }),
    })
    const reviewsChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'companies') return companiesChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'reviews') return reviewsChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Cafeteria Central')).toBeInTheDocument()
    })

    expect(screen.getByText('Esta empresa ainda não definiu um briefing padrão.')).toBeInTheDocument()
  })
})
