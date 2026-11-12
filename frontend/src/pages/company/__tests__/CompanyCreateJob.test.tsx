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

function getSubmitButton() {
  return screen.getByRole('button', { name: /criar turno/i })
}

// O formulario e uma pagina so (sem etapas): os helpers preenchem cada bloco.
function fillBasics() {
  fireEvent.change(screen.getByLabelText('Título do Turno'), { target: { value: 'Garçom para evento' } })
  fireEvent.change(screen.getByLabelText('Função'), { target: { value: 'garcom' } })
  fireEvent.change(screen.getByLabelText('Descrição Completa'), { target: { value: 'Atendimento no salão durante o evento.' } })
}

function fillSchedule() {
  fireEvent.change(screen.getByLabelText('Valor do orçamento'), { target: { value: '150' } })
  fireEvent.change(screen.getByLabelText('Data de início'), { target: { value: '2099-01-01' } })
  fireEvent.change(screen.getByLabelText('Horário de entrada'), { target: { value: '18:00' } })
  fireEvent.change(screen.getByLabelText('Horário de saída'), { target: { value: '23:00' } })
}

// F13: as paginas de empresa resolvem a unidade OPERADA (gerente nao e dono, e `user.id`
// deixou de servir como company_id). O duble evita bater na RPC get_my_companies.
vi.mock('../../../services/companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('company-1'),
}))
import { getAuthenticatedCompanyId } from '../../../services/companyScopeService'

describe('CompanyCreateJob — validação do formulário', () => {
  beforeEach(() => {
    localStorage.clear()  // o rascunho de um teste nao pode restaurar no seguinte
    vi.clearAllMocks()
  })

  it('começa com "Criar turno" desabilitado e diz o que falta', () => {
    renderPage()
    expect(getSubmitButton()).toBeDisabled()
    expect(screen.getByText(/falta preencher: o título do turno, a função, a descrição/i)).toBeInTheDocument()
  })

  it('continua desabilitado só com título preenchido', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Título do Turno'), { target: { value: 'Garçom para evento' } })
    expect(getSubmitButton()).toBeDisabled()
  })

  it('bloqueia sem descrição mesmo com o resto preenchido', () => {
    renderPage()
    fillBasics()
    fillSchedule()
    expect(getSubmitButton()).not.toBeDisabled()

    fireEvent.change(screen.getByLabelText('Descrição Completa'), { target: { value: '' } })
    expect(getSubmitButton()).toBeDisabled()
  })

  it('exige valor > 0, data e horários antes de habilitar "Criar turno"', () => {
    renderPage()
    fillBasics()

    const submitButton = getSubmitButton()
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

  it('mantém "Criar turno" desabilitado com data no passado, mesmo com o resto preenchido', () => {
    renderPage()
    fillBasics()
    fillSchedule()

    const submitButton = getSubmitButton()

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
    const today = new Date()
    const expectedMin = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(screen.getByLabelText('Data de início')).toHaveAttribute('min', expectedMin)
  })
})

describe('CompanyCreateJob — F8 (certification_requirement é ADVISORY, opcional)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('não bloqueia "Criar turno" quando o campo de certificação fica vazio', () => {
    renderPage()
    fillBasics()
    fillSchedule()

    // Divulgação progressiva (NN/g): os campos opcionais ficam atrás do toggle e o campo vazio
    // NÃO está no DOM até abrir — o clique aqui é o gesto real do usuário, e também o asserto
    // de que o toggle existe.
    fireEvent.click(screen.getByRole('button', { name: /requisitos, briefing e certificação \(opcional\)/i }))

    // Campo optativo: deixar a certificação vazia nunca trava o envio.
    expect(screen.getByLabelText('Certificação Exigida (opcional)')).toHaveValue('')
    expect(getSubmitButton()).not.toBeDisabled()
  })

  // REGRESSAO (achado navegando o produto, 23/08/2026): o payload levava `company_id: user.id`.
  // Para um GERENTE de unidade (F13) isso e o id da PESSOA, nao de uma empresa -- conferido em
  // producao, `is_company_owner(proprio_id)` devolve false, entao a RLS recusaria o INSERT e o
  // gerente simplesmente nao conseguiria abrir turno na unidade que opera.
  //
  // O id operado aqui e DIFERENTE do id da sessao de proposito: se o codigo voltar a usar
  // `user.id`, o payload sai com 'company-1' e este teste morre.
  it('company_id do turno vem da unidade OPERADA, nunca do id da sessao', async () => {
    vi.mocked(getAuthenticatedCompanyId).mockResolvedValue('unidade-operada-9')

    renderPage()
    fillBasics()
    fillSchedule()

    fireEvent.click(getSubmitButton())

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ company_id: 'unidade-operada-9' }),
      )
    })
  })

  it('o texto digitado em "Certificação Exigida" chega no payload de criação do turno (trim, sem filtrar nada)', async () => {
    renderPage()
    fillBasics()
    fillSchedule()
    // Abre a divulgação progressiva — o campo opcional só entra no DOM depois do toggle.
    fireEvent.click(screen.getByRole('button', { name: /requisitos, briefing e certificação \(opcional\)/i }))
    fireEvent.change(screen.getByLabelText('Certificação Exigida (opcional)'), {
      target: { value: '  CREF válido  ' },
    })

    fireEvent.click(getSubmitButton())

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ certification_requirement: 'CREF válido' }),
      )
    })
  })

  it('deixar o campo vazio envia certification_requirement=null (nunca string vazia)', async () => {
    renderPage()
    fillBasics()
    fillSchedule()

    fireEvent.click(getSubmitButton())

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ certification_requirement: null }),
      )
    })
  })
})
