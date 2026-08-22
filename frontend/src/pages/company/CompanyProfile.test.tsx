import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CompanyProfile from './CompanyProfile'

// ---------------------------------------------------------------------------
// F5 (guarda de vínculo) — LM-5: a cascata de fallback de `handleSave` (ddl-aprovado.md) é a
// peça de maior custo da feature — se ela quebrar, a empresa perde a capacidade de editar o
// perfil INTEIRO (logo, capa, endereço), não só a config nova, porque um deploy da Vercel pode
// acontecer ANTES da migration que cria `link_risk_alert_enabled`/`link_risk_alert_threshold`
// ser aplicada manualmente em produção. Estes testes provam a cadeia de 3 camadas fim a fim,
// mockando `supabase.from('companies').update(...).eq(...).select('id')` — nunca leitura de
// código apenas.
// ---------------------------------------------------------------------------

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
      updateUser: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn(),
    // F13 (R12) — CompanyProfile resolve a unidade via `get_my_companies()` (companyScopeService)
    // em vez de `user.id` direto. Default: uma única linha role='owner' (o caso dominante hoje,
    // A9) para não mudar o comportamento dos testes de fallback do LM-5 abaixo.
    rpc: vi.fn(),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: '' } })),
      })),
    },
  },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ signOut: vi.fn() }),
}))

const mockAddToast = vi.fn()
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

// Fora de escopo desta feature (ProfileReviews resolve autoria via RPC própria) — stub simples
// para isolar o teste da cascata de salvamento.
vi.mock('../../components/ProfileReviews', () => ({
  default: () => null,
}))

import { supabase } from '../../lib/supabase'

const COMPANY_ROW = {
  name: 'Divino Fogão',
  industry: 'Alimentação',
  description: 'Rede de restaurantes',
  website: 'https://divinofogao.example',
  email: 'contato@divinofogao.example',
  address: 'Av. Paulista, 1000',
  default_briefing: 'Camisa branca, calça jeans.',
  link_risk_alert_enabled: true,
  link_risk_alert_threshold: 2,
}

/** `.update(payload).eq('id', userId).select('id')` — encadeável, resolve {data, error}. */
function updateChain(result: { data: unknown; error: unknown }) {
  return {
    eq: vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue(result),
    }),
  }
}

function setupMocks() {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: 'company-user-1' } },
    error: null,
  } as Awaited<ReturnType<typeof supabase.auth.getUser>>)

  vi.mocked(supabase.rpc).mockImplementation((fn: string) => {
    if (fn === 'get_my_companies') {
      return Promise.resolve({
        data: [{
          company_id: 'company-user-1',
          company_name: 'Divino Fogão',
          role: 'owner',
          organization_id: 'org-1',
          organization_name: 'Divino Fogão',
          onboarding_completed: true,
          accepted_tos: true,
        }],
        error: null,
      }) as unknown as ReturnType<typeof supabase.rpc>
    }
    return Promise.resolve({ data: null, error: null }) as unknown as ReturnType<typeof supabase.rpc>
  })

  const mockUpdate = vi.fn()
  const companiesChain = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: COMPANY_ROW, error: null }),
      }),
    }),
    update: mockUpdate,
  }

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === 'companies') return companiesChain as unknown as ReturnType<typeof supabase.from>
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() } as unknown as ReturnType<typeof supabase.from>
  })

  return { mockUpdate }
}

async function renderAndEnterEditMode() {
  const mocks = setupMocks()
  render(<CompanyProfile />)

  await waitFor(() => {
    expect(screen.getAllByText('Divino Fogão').length).toBeGreaterThan(0)
  })

  fireEvent.click(screen.getByRole('button', { name: /Editar Perfil/i }))

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Salvar Alterações' })).toBeInTheDocument()
  })

  return mocks
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CompanyProfile — cascata de fallback do LM-5 (guarda de vínculo)', () => {
  it('caminho 1: payload completo passa de primeira — nenhum retry', async () => {
    const { mockUpdate } = await renderAndEnterEditMode()
    mockUpdate.mockReturnValueOnce(updateChain({ data: [{ id: 'company-user-1' }], error: null }))

    fireEvent.click(screen.getByRole('button', { name: 'Salvar Alterações' }))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Perfil atualizado com sucesso!', 'success')
    })

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const payload = mockUpdate.mock.calls[0][0]
    expect(payload).toMatchObject({
      name: 'Divino Fogão',
      default_briefing: 'Camisa branca, calça jeans.',
      link_risk_alert_enabled: true,
      link_risk_alert_threshold: 2,
    })
  })

  it('caminho 2: erro menciona link_risk_alert_enabled → retry SEM as colunas novas, COM default_briefing', async () => {
    const { mockUpdate } = await renderAndEnterEditMode()
    mockUpdate
      .mockReturnValueOnce(
        updateChain({
          data: null,
          error: {
            message: "Could not find the 'link_risk_alert_enabled' column of 'companies' in the schema cache",
            code: 'PGRST204',
          },
        }),
      )
      .mockReturnValueOnce(updateChain({ data: [{ id: 'company-user-1' }], error: null }))

    fireEvent.click(screen.getByRole('button', { name: 'Salvar Alterações' }))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Perfil atualizado com sucesso!', 'success')
    })

    expect(mockUpdate).toHaveBeenCalledTimes(2)
    const retryPayload = mockUpdate.mock.calls[1][0]
    expect(retryPayload).not.toHaveProperty('link_risk_alert_enabled')
    expect(retryPayload).not.toHaveProperty('link_risk_alert_threshold')
    expect(retryPayload).toMatchObject({
      name: 'Divino Fogão',
      default_briefing: 'Camisa branca, calça jeans.',
    })
  })

  it('caminho 3: erro subsequente menciona default_briefing → fallback final para basePayload puro', async () => {
    const { mockUpdate } = await renderAndEnterEditMode()
    mockUpdate
      .mockReturnValueOnce(
        updateChain({
          data: null,
          error: {
            message: "Could not find the 'link_risk_alert_threshold' column of 'companies' in the schema cache",
            code: 'PGRST204',
          },
        }),
      )
      .mockReturnValueOnce(
        updateChain({
          data: null,
          error: {
            message: "Could not find the 'default_briefing' column of 'companies' in the schema cache",
            code: 'PGRST204',
          },
        }),
      )
      .mockReturnValueOnce(updateChain({ data: [{ id: 'company-user-1' }], error: null }))

    fireEvent.click(screen.getByRole('button', { name: 'Salvar Alterações' }))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Perfil atualizado com sucesso!', 'success')
    })

    expect(mockUpdate).toHaveBeenCalledTimes(3)
    const finalPayload = mockUpdate.mock.calls[2][0]
    expect(finalPayload).not.toHaveProperty('link_risk_alert_enabled')
    expect(finalPayload).not.toHaveProperty('link_risk_alert_threshold')
    expect(finalPayload).not.toHaveProperty('default_briefing')
    expect(finalPayload).toEqual({
      name: 'Divino Fogão',
      industry: 'Alimentação',
      description: 'Rede de restaurantes',
      website: 'https://divinofogao.example',
      email: 'contato@divinofogao.example',
      address: 'Av. Paulista, 1000',
    })
  })
})
