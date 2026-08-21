import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ShiftCallModal } from './ShiftCallModal'
import type { TeamMember, TeamListWithMembers, Job } from '../../types'

// ---------------------------------------------------------------------------
// Cobertura da lógica de interseção do chip de lista (F2 — R9/R10/R11):
//  - contagem do chip é a de DISPONÍVEIS (filtra membro fora do elenco/já no turno), não o
//    total de membros salvos na lista;
//  - clique é toggle liga/desliga (todos disponíveis marcados → clique remove; senão, adiciona);
//  - clique é UNIÃO — não apaga seleção manual nem a de outro chip;
//  - chip sem nenhum disponível renderiza desabilitado com "(0)".
// ---------------------------------------------------------------------------

const mockAddToast = vi.fn()
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn() }),
}))

const mockListTeamMembers = vi.fn()
vi.mock('../../services/teamConnectionService', () => ({
  TeamConnectionService: {
    listTeamMembers: (...args: unknown[]) => mockListTeamMembers(...args),
  },
}))

const mockListLists = vi.fn()
vi.mock('../../services/teamListService', () => ({
  TeamListService: {
    listLists: (...args: unknown[]) => mockListLists(...args),
  },
}))

const mockCreateShiftCall = vi.fn()
vi.mock('../../services/shiftCallService', () => ({
  ShiftCallService: {
    createShiftCall: (...args: unknown[]) => mockCreateShiftCall(...args),
  },
  CALL_EXPIRY_PRESETS: [
    { value: 0.5, label: '30 minutos' },
    { value: 2, label: '2 horas' },
  ],
  DEFAULT_CALL_EXPIRY_HOURS: 2,
  calcExpiryAtShiftStart: vi.fn(() => '2026-08-20T00:00:00.000Z'),
}))

// F5 — guarda de risco de vínculo. Território de outro agente (services/linkRiskService.ts);
// aqui só o mock para os testes de F2 (chips) continuarem passando sem depender da RPC real.
// Default: aviso ligado, limite padrão, ninguém com carga preexistente (comportamento neutro —
// nenhum selo aparece a menos que um teste explicitamente configure `mockCountForShift`).
const mockGetConfig = vi.fn()
const mockCountForShift = vi.fn()
const mockCountForRange = vi.fn()
vi.mock('../../services/linkRiskService', () => ({
  LinkRiskService: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args),
    countForShift: (...args: unknown[]) => mockCountForShift(...args),
    countForRange: (...args: unknown[]) => mockCountForRange(...args),
  },
}))
mockGetConfig.mockResolvedValue({ enabled: true, threshold: 2 })
mockCountForShift.mockResolvedValue(new Map())
mockCountForRange.mockResolvedValue(new Map())

function worker(id: string, fullName: string, role = 'Cozinheiro'): TeamMember {
  return {
    connection: {
      id: `conn-${id}`,
      company_id: 'company-1',
      worker_id: id,
      status: 'accepted',
      source: 'phone',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    worker: {
      id,
      full_name: fullName,
      primary_role: role,
      rating_average: 4.5,
      completed_jobs_count: 1,
      city: 'São Paulo',
    },
  }
}

function cozinhaList(memberIds: string[]): TeamListWithMembers {
  return {
    id: 'list-cozinha',
    company_id: 'company-1',
    name: 'Cozinha',
    created_by: 'owner-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    memberIds,
  }
}

const job: Pick<Job, 'id' | 'title' | 'start_date' | 'work_start_time'> & { slots?: number } = {
  id: 'job-1',
  title: 'Turno de sexta',
  start_date: '2026-08-21',
  work_start_time: '18:00',
  slots: 6,
}

function renderModal(props: { excludeWorkerIds?: string[] } = {}) {
  return render(
    <ShiftCallModal
      job={job}
      excludeWorkerIds={props.excludeWorkerIds ?? []}
      onClose={vi.fn()}
      onDispatched={vi.fn()}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ShiftCallModal — chips de listas salvas (F2)', () => {
  it('zero listas: nenhuma linha de chip aparece (comportamento visual intacto)', async () => {
    mockListTeamMembers.mockResolvedValue([worker('w1', 'Ana')])
    mockListLists.mockResolvedValue([])

    renderModal()

    await waitFor(() => {
      expect(screen.getByText('Ana')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /Cozinha/ })).not.toBeInTheDocument()
  })

  it('chip mostra a contagem de DISPONÍVEIS, ignorando membro que saiu do elenco (R10/R11)', async () => {
    // Lista salva tem 6 membros, mas só 5 seguem 'accepted' hoje (worker-6 saiu/bloqueou —
    // não aparece mais em listTeamMembers, que já filtra status='accepted').
    const members = [1, 2, 3, 4, 5].map((n) => worker(`w${n}`, `Freela ${n}`))
    mockListTeamMembers.mockResolvedValue(members)
    mockListLists.mockResolvedValue([cozinhaList(['w1', 'w2', 'w3', 'w4', 'w5', 'w6'])])

    renderModal()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cozinha (5)' })).toBeInTheDocument()
    })
  })

  it('chip exclui quem já está no turno atual (excludeWorkerIds) da contagem e da seleção (R10)', async () => {
    const members = [1, 2, 3, 4, 5, 6].map((n) => worker(`w${n}`, `Freela ${n}`))
    mockListTeamMembers.mockResolvedValue(members)
    mockListLists.mockResolvedValue([cozinhaList(['w1', 'w2', 'w3', 'w4', 'w5', 'w6'])])

    renderModal({ excludeWorkerIds: ['w6'] })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cozinha (5)' })).toBeInTheDocument()
    })
  })

  it('clique no chip seleciona só os disponíveis; clique de novo desseleciona SEM mexer em seleção manual fora da lista (toggle liga/desliga + A8)', async () => {
    // A8 exige explicitamente que desligar o chip não mexa em seleções manuais feitas fora
    // daquela lista — por isso este cenário já nasce com um outsider marcado manualmente,
    // igual ao teste de A12 (união), só que aqui o eixo verificado é o toggle-OFF.
    const outsider = worker('w-outsider', 'Fulano Fora Da Lista', 'Caixa')
    const members = [worker('w1', 'Freela 1'), worker('w2', 'Freela 2'), worker('w3', 'Freela 3'), outsider]
    mockListTeamMembers.mockResolvedValue(members)
    mockListLists.mockResolvedValue([cozinhaList(['w1', 'w2', 'w3'])])

    renderModal()

    await screen.findByText('Fulano Fora Da Lista')
    const outsiderRow = screen.getByText('Fulano Fora Da Lista').closest('label')
    expect(outsiderRow).not.toBeNull()
    const outsiderCheckbox = outsiderRow!.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(outsiderCheckbox)
    expect(outsiderCheckbox.checked).toBe(true)

    const chip = await screen.findByRole('button', { name: 'Cozinha (3)' })
    fireEvent.click(chip)

    // Os 3 da lista entram em UNIÃO com o outsider já marcado manualmente (4 no total).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Chamar 4 freelas/ })).toBeInTheDocument()
    })
    const listCheckboxes = ['Freela 1', 'Freela 2', 'Freela 3'].map(
      (name) => screen.getByText(name).closest('label')!.querySelector('input') as HTMLInputElement,
    )
    expect(listCheckboxes.every((c) => c.checked)).toBe(true)
    expect(outsiderCheckbox.checked).toBe(true)
    expect(chip).toHaveAttribute('aria-pressed', 'true')

    // Clique de novo (toggle-OFF): remove só os 3 da lista — o outsider, selecionado
    // manualmente fora da lista, permanece marcado (A8: não mexe em seleção manual).
    fireEvent.click(chip)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Enviar convite' })).toBeInTheDocument()
    })
    expect(listCheckboxes.every((c) => c.checked)).toBe(false)
    expect(outsiderCheckbox.checked).toBe(true)
    expect(chip).toHaveAttribute('aria-pressed', 'false')
  })

  it('clique no chip é UNIÃO: não apaga seleção manual feita fora da lista (R9/A12)', async () => {
    const outsider = worker('w-outsider', 'Fulano Fora Da Lista', 'Caixa')
    const members = [worker('w1', 'Freela 1'), worker('w2', 'Freela 2'), outsider]
    mockListTeamMembers.mockResolvedValue(members)
    mockListLists.mockResolvedValue([cozinhaList(['w1', 'w2'])])

    renderModal()

    // Seleciona manualmente o freela de fora da lista.
    await screen.findByText('Fulano Fora Da Lista')
    const outsiderRow = screen.getByText('Fulano Fora Da Lista').closest('label')
    expect(outsiderRow).not.toBeNull()
    const outsiderCheckbox = outsiderRow!.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(outsiderCheckbox)

    // Clica no chip "Cozinha" — soma os 2 da lista à seleção manual já feita.
    const chip = await screen.findByRole('button', { name: 'Cozinha (2)' })
    fireEvent.click(chip)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Chamar 3 freelas/ })).toBeInTheDocument()
    })
    expect(outsiderCheckbox.checked).toBe(true)
  })

  it('lista com zero disponíveis renderiza chip desabilitado com "(0)" (R10/A11)', async () => {
    mockListTeamMembers.mockResolvedValue([worker('w-other', 'Outro Freela')])
    // Nenhum dos memberIds da lista "Chapa" está mais no elenco disponível.
    mockListLists.mockResolvedValue([
      { ...cozinhaList(['w-gone-1', 'w-gone-2']), id: 'list-chapa', name: 'Chapa' },
    ])

    renderModal()

    const chip = await screen.findByRole('button', { name: 'Chapa (0)' })
    expect(chip).toBeDisabled()
    fireEvent.click(chip)
    expect(screen.getByRole('button', { name: 'Selecione os freelas' })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// F5 — guarda de risco de vínculo (`ddl-aprovado.md`). Selo por membro (R6.1/R7): fato, nunca
// conclusão jurídica; só para SELECIONADOS cuja contagem prospectiva (existente + este chamado)
// ultrapassa o limite; nunca bloqueia o disparo (A7); some por completo quando desligado.
// ---------------------------------------------------------------------------
describe('ShiftCallModal — guarda de risco de vínculo (F5)', () => {
  it('mostra o selo só depois de SELECIONAR um freela cuja contagem prospectiva ultrapassa o limite', async () => {
    mockListTeamMembers.mockResolvedValue([worker('w1', 'Ana')])
    mockListLists.mockResolvedValue([])
    mockGetConfig.mockResolvedValueOnce({ enabled: true, threshold: 2 })
    mockCountForShift.mockResolvedValueOnce(new Map([['w1', 2]])) // 2 existentes + 1 deste chamado = 3

    renderModal()

    const row = await screen.findByText('Ana')
    expect(screen.queryByText(/Já 3x esta semana/)).not.toBeInTheDocument()

    const checkbox = row.closest('label')!.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(checkbox)

    await waitFor(() => {
      expect(screen.getByText(/Já 3x esta semana/)).toBeInTheDocument()
    })
    // A7: nunca desabilita o disparo.
    expect(screen.getByRole('button', { name: 'Enviar convite' })).not.toBeDisabled()
  })

  it('dentro do limite (existente + 1 = limite): nenhum selo aparece', async () => {
    mockListTeamMembers.mockResolvedValue([worker('w1', 'Bruno')])
    mockListLists.mockResolvedValue([])
    mockGetConfig.mockResolvedValueOnce({ enabled: true, threshold: 2 })
    mockCountForShift.mockResolvedValueOnce(new Map([['w1', 1]])) // 1 + 1 = 2, não ultrapassa

    renderModal()

    const row = await screen.findByText('Bruno')
    const checkbox = row.closest('label')!.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(checkbox)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Enviar convite' })).toBeInTheDocument()
    })
    expect(screen.queryByText(/esta semana/)).not.toBeInTheDocument()
  })

  it('config desligada (enabled=false): nenhum selo/banner, e a contagem nem é buscada', async () => {
    mockListTeamMembers.mockResolvedValue([worker('w1', 'Carla')])
    mockListLists.mockResolvedValue([])
    mockGetConfig.mockResolvedValueOnce({ enabled: false, threshold: 2 })

    renderModal()

    const row = await screen.findByText('Carla')
    const checkbox = row.closest('label')!.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(checkbox)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Enviar convite' })).toBeInTheDocument()
    })
    expect(screen.queryByText(/esta semana/)).not.toBeInTheDocument()
    expect(mockCountForShift).not.toHaveBeenCalled()
  })

  it('banner de rodapé aparece com pelo menos 1 selecionado em risco e não impede o disparo (A7)', async () => {
    mockListTeamMembers.mockResolvedValue([worker('w1', 'Diego')])
    mockListLists.mockResolvedValue([])
    mockGetConfig.mockResolvedValueOnce({ enabled: true, threshold: 2 })
    mockCountForShift.mockResolvedValueOnce(new Map([['w1', 3]])) // 3 + 1 = 4
    mockCreateShiftCall.mockResolvedValueOnce({ error: null, call: { id: 'call-1' }, invited: 1 })

    renderModal()

    const row = await screen.findByText('Diego')
    const checkbox = row.closest('label')!.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(checkbox)

    await waitFor(() => {
      expect(screen.getByText(/Diego já teria 4ª vez confirmada/)).toBeInTheDocument()
    })
    const dispatchButton = screen.getByRole('button', { name: 'Enviar convite' })
    expect(dispatchButton).not.toBeDisabled()
    fireEvent.click(dispatchButton)
    await waitFor(() => expect(mockCreateShiftCall).toHaveBeenCalled())
  })

  // MÉDIO (revisão de frontend) — `linkRiskService.test.ts` já prova que o SERVICE degrada sem
  // lançar; isto não prova que a TELA sobrevive quando a dependência falha de verdade (ex.: uma
  // regressão que troque `riskCountsEffective`/o `Promise.allSettled` por algo que propague a
  // rejeição). Aqui simulamos a RPC falhando no nível do MODAL (rejeição crua no mock, não o
  // fallback interno do service real) e provamos que a lista renderiza, a seleção funciona e o
  // disparo continua funcionando (A7) — a guarda nunca pode travar o gesto central do F1.
  it('RPC de config falhando: a lista do elenco renderiza, a seleção funciona e o disparo dispara normalmente', async () => {
    mockListTeamMembers.mockResolvedValue([worker('w1', 'Elis')])
    mockListLists.mockResolvedValue([])
    mockGetConfig.mockRejectedValueOnce(new Error('PGRST202 — RPC ausente (deploy adiantado)'))
    // Sem config resolvida, a contagem ainda dispara (fail-safe do gate — ver teste de F5-02
    // abaixo) e devolve uma contagem que estouraria o limite padrão, para provar que o selo
    // aparece mesmo com `riskConfig=null`.
    mockCountForShift.mockResolvedValueOnce(new Map([['w1', 2]])) // 2 + 1 = 3 > DEFAULT (2)
    mockCreateShiftCall.mockResolvedValueOnce({ error: null, call: { id: 'call-1' }, invited: 1 })

    renderModal()

    // A lista do elenco não pode travar em "carregando" por causa da guarda de vínculo.
    const row = await screen.findByText('Elis')
    expect(screen.queryByText(/Verificando frequência/)).not.toBeInTheDocument()

    const checkbox = row.closest('label')!.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)

    const dispatchButton = await screen.findByRole('button', { name: 'Enviar convite' })
    expect(dispatchButton).not.toBeDisabled()
    fireEvent.click(dispatchButton)
    await waitFor(() => expect(mockCreateShiftCall).toHaveBeenCalledWith('job-1', ['w1'], expect.anything()))
  })

  // F5-02 (mutação sobrevivente) — `enabled !== false` trata `riskConfig=null`/`undefined` como
  // LIGADO (fail-safe: a guarda nunca desliga em silêncio quando a config não resolveu). O
  // mutante `=== true` inverteria esse fail-safe: `undefined === true` é `false`, desligando a
  // guarda bem no cenário em que ela mais importa (RPC de config indisponível). Aqui a config
  // falha e a contagem devolve estouro — o selo TEM que aparecer.
  it('fail-safe (F5-02): config indisponível não desliga o selo em silêncio — undefined trata como ligado', async () => {
    mockListTeamMembers.mockResolvedValue([worker('w1', 'Helena')])
    mockListLists.mockResolvedValue([])
    mockGetConfig.mockRejectedValueOnce(new Error('rede indisponível'))
    mockCountForShift.mockResolvedValueOnce(new Map([['w1', 5]])) // 5 + 1 = 6, estoura qualquer limite

    renderModal()

    const row = await screen.findByText('Helena')
    const checkbox = row.closest('label')!.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(checkbox)

    await waitFor(() => {
      expect(screen.getByText(/Já 6x esta semana/)).toBeInTheDocument()
    })
  })

  // F5-01 (mutação sobrevivente) — o limite REAL vem de `riskConfig.threshold` (A4: configurável
  // por empresa, decisão do owner — 2, 4, o que fizer sentido). O mutante que troca por
  // `DEFAULT_LINK_RISK_THRESHOLD` fixo faria este teste falhar: com threshold=4, 3+1=4 NÃO avisa
  // e 4+1=5 avisa — com o DEFAULT (2) fixo, os dois estourariam e o selo de "3x" apareceria
  // também, o que este teste explicitamente nega.
  it('limite configurável (A4): threshold=4 da empresa é respeitado, não o DEFAULT fixo', async () => {
    mockListTeamMembers.mockResolvedValue([worker('w1', 'Ivo'), worker('w2', 'Julia')])
    mockListLists.mockResolvedValue([])
    mockGetConfig.mockResolvedValueOnce({ enabled: true, threshold: 4 })
    mockCountForShift.mockResolvedValueOnce(
      new Map([
        ['w1', 3], // 3 + 1 = 4 → não ultrapassa threshold=4
        ['w2', 4], // 4 + 1 = 5 → ultrapassa threshold=4
      ]),
    )

    renderModal()

    const rowIvo = await screen.findByText('Ivo')
    fireEvent.click(rowIvo.closest('label')!.querySelector('input[type="checkbox"]') as HTMLInputElement)
    const rowJulia = screen.getByText('Julia')
    fireEvent.click(rowJulia.closest('label')!.querySelector('input[type="checkbox"]') as HTMLInputElement)

    await waitFor(() => {
      expect(screen.getByText(/Já 5x esta semana/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/Já 4x esta semana/)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// F7 — Disponibilidade declarada pelo freela (`ddl-aprovado.md` §3.5). ORDENA, nunca filtra:
// quem casa com o dia+período do turno vem primeiro; quem não casa e quem nunca declarou ficam
// no MESMO patamar (nem selo, nem prioridade). Landmine central (LM-7): a ordenação NUNCA pode
// redisparar `countForShift` (F5) — a chave que dispara aquele efeito é derivada de `available`,
// que tem de continuar intacto/na ordem original.
// ---------------------------------------------------------------------------
describe('ShiftCallModal — disponibilidade declarada (F7)', () => {
  // job.start_date = '2026-08-21' é uma SEXTA (weekday 5); work_start_time '18:00' → período 'noite'.

  it('quem declarou disponibilidade para o dia+período do turno aparece primeiro', async () => {
    const semDeclarar = worker('w1', 'Ana Sem Grade')
    const declaraOutroPeriodo = {
      ...worker('w2', 'Beto Outro Periodo'),
      worker: { ...worker('w2', 'Beto Outro Periodo').worker, availability_days: { '5': ['manha'] } },
    }
    const declaraCerto = {
      ...worker('w3', 'Carla Disponivel'),
      worker: { ...worker('w3', 'Carla Disponivel').worker, availability_days: { '5': ['noite'] } },
    }
    mockListTeamMembers.mockResolvedValue([semDeclarar, declaraOutroPeriodo, declaraCerto])
    mockListLists.mockResolvedValue([])

    renderModal()

    await screen.findByText('Ana Sem Grade')
    const rows = screen.getAllByRole('checkbox').map((el) => el.closest('label')!.textContent ?? '')
    // Carla (declarou sexta à noite, igual ao turno) vem primeiro; os outros dois mantêm a ordem
    // relativa original entre si (sort estável — nenhuma penalização para quem não declarou).
    expect(rows[0]).toContain('Carla Disponivel')
    expect(rows[1]).toContain('Ana Sem Grade')
    expect(rows[2]).toContain('Beto Outro Periodo')
  })

  it('selo "Disponível" aparece só para quem casa com o turno — quem não declarou fica sem selo, sem penalização', async () => {
    const semDeclarar = worker('w1', 'Ana Sem Grade')
    const declaraCerto = {
      ...worker('w3', 'Carla Disponivel'),
      worker: { ...worker('w3', 'Carla Disponivel').worker, availability_days: { '5': ['noite'] } },
    }
    mockListTeamMembers.mockResolvedValue([semDeclarar, declaraCerto])
    mockListLists.mockResolvedValue([])

    renderModal()

    await screen.findByText('Ana Sem Grade')
    const carlaRow = screen.getByText('Carla Disponivel').closest('label')!
    const anaRow = screen.getByText('Ana Sem Grade').closest('label')!
    expect(carlaRow.textContent).toContain('Disponível')
    expect(anaRow.textContent).not.toContain('Disponível')
  })

  it('sem horário resolvível (work_start_time inválido): ninguém é destacado, ordem permanece a original', async () => {
    const declaraCerto = {
      ...worker('w1', 'Ana'),
      worker: { ...worker('w1', 'Ana').worker, availability_days: { '5': ['noite'] } },
    }
    const outro = worker('w2', 'Beto')
    mockListTeamMembers.mockResolvedValue([declaraCerto, outro])
    mockListLists.mockResolvedValue([])

    render(
      <ShiftCallModal
        job={{ ...job, work_start_time: null as unknown as string }}
        excludeWorkerIds={[]}
        onClose={vi.fn()}
        onDispatched={vi.fn()}
      />,
    )

    await screen.findByText('Ana')
    expect(screen.queryByText('Disponível')).not.toBeInTheDocument()
    const rows = screen.getAllByRole('checkbox').map((el) => el.closest('label')!.textContent ?? '')
    expect(rows[0]).toContain('Ana')
    expect(rows[1]).toContain('Beto')
  })

  it('LM-7: ordenar por disponibilidade NÃO redispara a RPC de contagem da F5', async () => {
    const declaraCerto = {
      ...worker('w1', 'Ana'),
      worker: { ...worker('w1', 'Ana').worker, availability_days: { '5': ['noite'] } },
    }
    const outro = worker('w2', 'Beto')
    mockListTeamMembers.mockResolvedValue([declaraCerto, outro])
    mockListLists.mockResolvedValue([])
    mockGetConfig.mockResolvedValueOnce({ enabled: true, threshold: 2 })
    mockCountForShift.mockResolvedValueOnce(new Map())

    renderModal()

    await screen.findByText('Ana')
    await waitFor(() => {
      expect(mockCountForShift).toHaveBeenCalledTimes(1)
    })

    // A reordenação da F7 já aconteceu no primeiro paint (síncrona). Um re-render adicional
    // (ex.: seleção de um freela, que só mexe em `selected`) não pode fazer `countForShift`
    // disparar de novo — a dependência do efeito da F5 é `available` (nunca mutado/reordenado
    // pela F7), não `ordered`.
    fireEvent.click(screen.getByText('Ana').closest('label')!.querySelector('input[type="checkbox"]')!)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Enviar convite' })).toBeInTheDocument()
    })
    expect(mockCountForShift).toHaveBeenCalledTimes(1)
  })
})

describe('ShiftCallModal — F8 (certificação exigida do turno é ADVISORY, R11)', () => {
  it('mostra o banner com o texto exato de certification_requirement quando o turno o declara', async () => {
    mockListTeamMembers.mockResolvedValue([worker('w1', 'Ana')])
    mockListLists.mockResolvedValue([])

    render(
      <ShiftCallModal
        job={{ ...job, certification_requirement: 'CREF válido' }}
        excludeWorkerIds={[]}
        onClose={vi.fn()}
        onDispatched={vi.fn()}
      />,
    )

    await screen.findByText('Ana')
    expect(screen.getByText(/Este turno pede: CREF válido/)).toBeInTheDocument()
  })

  it('não mostra nenhum banner quando o turno não declara certification_requirement', async () => {
    mockListTeamMembers.mockResolvedValue([worker('w1', 'Ana')])
    mockListLists.mockResolvedValue([])

    renderModal()

    await screen.findByText('Ana')
    expect(screen.queryByText(/Este turno pede:/)).not.toBeInTheDocument()
  })

  it('banner é só aviso: seleção e disparo continuam disponíveis mesmo com certification_requirement declarado', async () => {
    mockListTeamMembers.mockResolvedValue([worker('w1', 'Ana')])
    mockListLists.mockResolvedValue([])

    render(
      <ShiftCallModal
        job={{ ...job, certification_requirement: 'Manipulação de alimentos' }}
        excludeWorkerIds={[]}
        onClose={vi.fn()}
        onDispatched={vi.fn()}
      />,
    )

    await screen.findByText('Ana')
    // Nenhum checkbox fica desabilitado, e o botão de disparo segue habilitável — o requisito
    // é só um aviso (R11), nunca uma trava sobre a lista de seleção.
    const checkbox = screen.getByText('Ana').closest('label')!.querySelector('input[type="checkbox"]')!
    expect(checkbox).not.toBeDisabled()
    fireEvent.click(checkbox)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Enviar convite' })).not.toBeDisabled()
    })
  })
})
