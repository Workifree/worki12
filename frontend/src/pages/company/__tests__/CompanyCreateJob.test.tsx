import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CompanyCreateJob from '../CompanyCreateJob'

// F8 — spy hoisted e COMPARTILHADO entre chamadas de `.from('jobs')`: `insert` precisa ser o
// MESMO mock em toda a suíte para o teste de `certification_requirement` conseguir inspecionar
// o payload de fato enviado (cada `from()` devolveria um objeto novo se o spy não fosse hoisted).
const { mockInsert } = vi.hoisted(() => ({ mockInsert: vi.fn().mockReturnThis() }))

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'company-1' } } })),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
      single: vi.fn(() => Promise.resolve({ data: { id: 'job-new-1' }, error: null })),
      insert: mockInsert,
      update: vi.fn().mockReturnThis(),
    })),
  },
}))

vi.mock('../../../lib/logger', () => ({
  logError: vi.fn(),
}))

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}))

vi.mock('../../../hooks/useTeamConnections', () => ({
  useCompanyTeam: () => ({ teamMembers: [], loading: false }),
}))

vi.mock('../../../hooks/useShiftInvites', () => ({
  useCompanyInvites: () => ({ invite: vi.fn(), invitingWorkerId: null, invites: [] }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({}),
  }
})

function renderPage() {
  return render(
    <MemoryRouter>
      <CompanyCreateJob />
    </MemoryRouter>
  )
}

function getNextButton() {
  return screen.getByRole('button', { name: /próximo/i })
}

describe('CompanyCreateJob — validação por etapa (canProceed)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passo 1: botão "Próximo" começa desabilitado sem título nem função', () => {
    renderPage()
    expect(getNextButton()).toBeDisabled()
  })

  it('passo 1: continua desabilitado só com título preenchido', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Título do Turno'), { target: { value: 'Garçom para evento' } })
    expect(getNextButton()).toBeDisabled()
  })

  it('passo 1: habilita com título e função preenchidos', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Título do Turno'), { target: { value: 'Garçom para evento' } })
    fireEvent.change(screen.getByLabelText('Função'), { target: { value: 'garcom' } })
    expect(getNextButton()).not.toBeDisabled()
  })

  it('passo 2: bloqueia sem descrição e libera ao preencher', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Título do Turno'), { target: { value: 'Garçom para evento' } })
    fireEvent.change(screen.getByLabelText('Função'), { target: { value: 'garcom' } })
    fireEvent.click(getNextButton())

    expect(getNextButton()).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Descrição Completa'), { target: { value: 'Atendimento no salão durante o evento.' } })
    expect(getNextButton()).not.toBeDisabled()
  })

  it('passo 3: exige valor > 0, data e horários antes de habilitar "Criar Turno"', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Título do Turno'), { target: { value: 'Garçom para evento' } })
    fireEvent.change(screen.getByLabelText('Função'), { target: { value: 'garcom' } })
    fireEvent.click(getNextButton())
    fireEvent.change(screen.getByLabelText('Descrição Completa'), { target: { value: 'Atendimento no salão durante o evento.' } })
    fireEvent.click(getNextButton())

    const submitButton = screen.getByRole('button', { name: /criar turno/i })
    expect(submitButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Valor do orçamento'), { target: { value: '150' } })
    expect(submitButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Data de início'), { target: { value: '2099-01-01' } })
    expect(submitButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Horário de entrada'), { target: { value: '18:00' } })
    expect(submitButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Horário de saída'), { target: { value: '23:00' } })
    expect(submitButton).not.toBeDisabled()
  })

  it('passo 3: mantém "Criar Turno" desabilitado com data no passado, mesmo com o resto preenchido', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Título do Turno'), { target: { value: 'Garçom para evento' } })
    fireEvent.change(screen.getByLabelText('Função'), { target: { value: 'garcom' } })
    fireEvent.click(getNextButton())
    fireEvent.change(screen.getByLabelText('Descrição Completa'), { target: { value: 'Atendimento no salão durante o evento.' } })
    fireEvent.click(getNextButton())

    fireEvent.change(screen.getByLabelText('Valor do orçamento'), { target: { value: '150' } })
    fireEvent.change(screen.getByLabelText('Horário de entrada'), { target: { value: '18:00' } })
    fireEvent.change(screen.getByLabelText('Horário de saída'), { target: { value: '23:00' } })

    const submitButton = screen.getByRole('button', { name: /criar turno/i })

    // Data fixa no passado — não depende do relógio do ambiente de teste.
    fireEvent.change(screen.getByLabelText('Data de início'), { target: { value: '2020-01-01' } })
    expect(submitButton).toBeDisabled()

    // Corrigindo para uma data futura, o botão libera — confirma que é a data (e não
    // outro campo) que estava bloqueando.
    fireEvent.change(screen.getByLabelText('Data de início'), { target: { value: '2099-01-01' } })
    expect(submitButton).not.toBeDisabled()
  })

  it('input de data de início tem "min" igual a hoje (barra data no passado no seletor do browser)', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Título do Turno'), { target: { value: 'Garçom para evento' } })
    fireEvent.change(screen.getByLabelText('Função'), { target: { value: 'garcom' } })
    fireEvent.click(getNextButton())
    fireEvent.change(screen.getByLabelText('Descrição Completa'), { target: { value: 'Atendimento no salão durante o evento.' } })
    fireEvent.click(getNextButton())

    const today = new Date()
    const expectedMin = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(screen.getByLabelText('Data de início')).toHaveAttribute('min', expectedMin)
  })
})

describe('CompanyCreateJob — F8 (certification_requirement é ADVISORY, opcional)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('não bloqueia "Próximo" no passo 2 quando o campo de certificação fica vazio', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Título do Turno'), { target: { value: 'Garçom para evento' } })
    fireEvent.change(screen.getByLabelText('Função'), { target: { value: 'garcom' } })
    fireEvent.click(getNextButton())
    fireEvent.change(screen.getByLabelText('Descrição Completa'), { target: { value: 'Atendimento no salão durante o evento.' } })

    // Campo optativo: preencher SÓ a descrição (nunca a certificação) já libera o "Próximo".
    expect(screen.getByLabelText('Certificação Exigida (opcional)')).toHaveValue('')
    expect(getNextButton()).not.toBeDisabled()
  })

  it('o texto digitado em "Certificação Exigida" chega no payload de criação do turno (trim, sem filtrar nada)', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Título do Turno'), { target: { value: 'Garçom para evento' } })
    fireEvent.change(screen.getByLabelText('Função'), { target: { value: 'garcom' } })
    fireEvent.click(getNextButton())
    fireEvent.change(screen.getByLabelText('Descrição Completa'), { target: { value: 'Atendimento no salão durante o evento.' } })
    fireEvent.change(screen.getByLabelText('Certificação Exigida (opcional)'), {
      target: { value: '  CREF válido  ' },
    })
    fireEvent.click(getNextButton())

    fireEvent.change(screen.getByLabelText('Valor do orçamento'), { target: { value: '150' } })
    fireEvent.change(screen.getByLabelText('Data de início'), { target: { value: '2099-01-01' } })
    fireEvent.change(screen.getByLabelText('Horário de entrada'), { target: { value: '18:00' } })
    fireEvent.change(screen.getByLabelText('Horário de saída'), { target: { value: '23:00' } })

    fireEvent.click(screen.getByRole('button', { name: /criar turno/i }))

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ certification_requirement: 'CREF válido' }),
      )
    })
  })

  it('deixar o campo vazio envia certification_requirement=null (nunca string vazia)', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Título do Turno'), { target: { value: 'Garçom para evento' } })
    fireEvent.change(screen.getByLabelText('Função'), { target: { value: 'garcom' } })
    fireEvent.click(getNextButton())
    fireEvent.change(screen.getByLabelText('Descrição Completa'), { target: { value: 'Atendimento no salão durante o evento.' } })
    fireEvent.click(getNextButton())

    fireEvent.change(screen.getByLabelText('Valor do orçamento'), { target: { value: '150' } })
    fireEvent.change(screen.getByLabelText('Data de início'), { target: { value: '2099-01-01' } })
    fireEvent.change(screen.getByLabelText('Horário de entrada'), { target: { value: '18:00' } })
    fireEvent.change(screen.getByLabelText('Horário de saída'), { target: { value: '23:00' } })

    fireEvent.click(screen.getByRole('button', { name: /criar turno/i }))

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ certification_requirement: null }),
      )
    })
  })
})
