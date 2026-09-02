import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import CompanyPublicProfile from '../CompanyPublicProfile'

// Mock supabase
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}))

// Mock useNavigate (não precisamos navegar de verdade nos testes)
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// "Falar com a empresa" usa useToast só para feedback de erro — mocka o provider.
vi.mock('../../contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ addToast: vi.fn(), removeToast: vi.fn() })),
}))

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

  it('mostra estado "Empresa não encontrada" só para PGRST116 (zero linhas); erro genérico vira ErroDeCarga', async () => {
    // Erro genérico (rede/timeout): NÃO pode afirmar que a empresa não existe.
    const companiesChainErroRede = buildChain({
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'timeout' } }),
    })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'companies') return companiesChainErroRede as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })
    const { unmount } = renderComponent()
    await waitFor(() => {
      expect(screen.getByText(/Não conseguimos carregar/i)).toBeInTheDocument()
    })
    expect(screen.queryByText('Empresa não encontrada')).not.toBeInTheDocument()
    unmount()

    // PGRST116 (zero linhas do .single()): aí sim, não encontrada.
    const companiesChain = buildChain({
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'no rows', code: 'PGRST116' } }),
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

  it('mostra "Falar com a empresa" quando há relação (application existente) e cria a Conversation ao clicar', async () => {
    const companiesChain = buildChain({
      single: vi.fn().mockResolvedValue({ data: COMPANY_DATA, error: null }),
    })
    const reviewsChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })
    const applicationsChain = buildChain({
      limit: vi.fn().mockResolvedValue({ data: [{ id: 'app-1' }], error: null }),
    })
    const conversationInsert = vi.fn().mockResolvedValue({ data: null, error: null })
    const conversationChain = buildChain({
      limit: vi.fn().mockResolvedValue({ data: [], error: null }), // nenhuma Conversation existente ainda
      insert: conversationInsert,
    })

    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'worker-1' } },
      error: null,
    } as Awaited<ReturnType<typeof supabase.auth.getUser>>)

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'companies') return companiesChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'reviews') return reviewsChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'applications') return applicationsChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'Conversation') return conversationChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    const chatButton = await screen.findByRole('button', { name: /Falar com a empresa/i })
    fireEvent.click(chatButton)

    await waitFor(() => {
      expect(conversationInsert).toHaveBeenCalledWith(
        expect.objectContaining({ application_uuid: 'app-1', islocked: false })
      )
    })
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/messages?conversation='))
    })
  })

  it('não mostra "Falar com a empresa" quando não há relação (sem application)', async () => {
    const companiesChain = buildChain({
      single: vi.fn().mockResolvedValue({ data: COMPANY_DATA, error: null }),
    })
    const reviewsChain = buildChain({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })
    const applicationsChain = buildChain({
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'worker-1' } },
      error: null,
    } as Awaited<ReturnType<typeof supabase.auth.getUser>>)

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'companies') return companiesChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'reviews') return reviewsChain as unknown as ReturnType<typeof supabase.from>
      if (table === 'applications') return applicationsChain as unknown as ReturnType<typeof supabase.from>
      return buildChain() as unknown as ReturnType<typeof supabase.from>
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Cafeteria Central')).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: /Falar com a empresa/i })).not.toBeInTheDocument()
  })
})
