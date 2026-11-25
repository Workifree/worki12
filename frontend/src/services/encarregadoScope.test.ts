import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabase } from '../lib/supabase'
import { canSeeJob, type JobScope } from './jobScopeService'
import { fillMissingWorkers } from './workerCardsService'
import { TeamConnectionService } from './teamConnectionService'

vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getUser: vi.fn() } } }))
vi.mock('./companyScopeService', () => ({
  getAuthenticatedCompanyId: vi.fn().mockResolvedValue('c1'),
  getMyCompanies: vi.fn().mockResolvedValue([]),
  pickCurrentCompany: () => null,
}))

const scope: JobScope = {
  companyId: 'c1', restricted: true, userId: 'eu',
  coverages: [{ fromUserId: 'colega', startsOn: '2026-11-20', endsOn: '2026-11-22' }],
}

describe('D-4: turnos que o encarregado enxerga', () => {
  it('próprio e coberto na janela; nunca o do Gestor, sem responsável ou fora da janela', () => {
    expect(canSeeJob(scope, { responsible_id: 'eu', start_date: null })).toBe(true)
    expect(canSeeJob(scope, { responsible_id: 'colega', start_date: '2026-11-21T15:00:00Z' })).toBe(true)
    expect(canSeeJob(scope, { responsible_id: 'colega', start_date: '2026-11-23T15:00:00Z' })).toBe(false)
    expect(canSeeJob(scope, { responsible_id: 'gestor', start_date: '2026-11-21T15:00:00Z' })).toBe(false)
    expect(canSeeJob(scope, { responsible_id: null, start_date: '2026-11-21T15:00:00Z' })).toBe(false)
  })

  it('Gestor vê todos', () => {
    expect(canSeeJob({ ...scope, restricted: false }, { responsible_id: null })).toBe(true)
  })
})

describe('D-3 e D-6: embed workers nulo para o encarregado', () => {
  beforeEach(() => {
    vi.mocked(supabase.rpc).mockImplementation(((fn: string) => Promise.resolve(
      fn === 'list_team_connection_cards'
        ? { data: { outcome: 'ok', items: [{ worker_id: 'w1', worker: { id: 'w1', full_name: 'Ana Souza' } }] }, error: null }
        : { data: { outcome: 'ok', items: [{ worker_id: 'w2', full_name: 'Bia Lima', phone: '11999999999', pix_key: 'bia@pix' }] }, error: null },
    )) as never)
  })

  it('listTeamMembers nunca devolve worker nulo', async () => {
    const rows = [
      { id: 'tc1', worker_id: 'w1', worker: null },
      { id: 'tc9', worker_id: 'w9', worker: null },
    ]
    vi.mocked(supabase.from).mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }) }),
    } as never)
    const members = await TeamConnectionService.listTeamMembers()
    expect(members.map((m) => [m.worker.id, m.worker.full_name])).toEqual([['w1', 'Ana Souza'], ['w9', 'Freela']])
  })

  it('no próprio turno usa o cartão do turno, sem inventar nível nem nota', async () => {
    const [row] = await fillMissingWorkers([{ worker_id: 'w2', worker: null as unknown }], 'job-1')
    expect(row.worker).toMatchObject({ full_name: 'Bia Lima', pix_key: 'bia@pix' })
    expect(row.worker).not.toHaveProperty('level')
    expect(row.worker).not.toHaveProperty('rating_average')
    expect(supabase.rpc).toHaveBeenCalledWith('get_shift_worker_payment_card', { p_job_id: 'job-1' })
  })

  it('embed presente: nenhuma RPC a mais', async () => {
    vi.mocked(supabase.rpc).mockClear()
    await fillMissingWorkers([{ worker_id: 'w1', worker: { id: 'w1' } }], 'job-1')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})
