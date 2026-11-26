import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabase } from '../lib/supabase'
import { getMyWorkerProfile, setMyWorkerIdentity } from './workerIdentityService'

vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }))
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))

const answer = (data: unknown, error: unknown = null) =>
    vi.mocked(supabase.rpc).mockResolvedValue({ data, error } as never)

function fallbackRow(row: unknown) {
    const single = vi.fn().mockResolvedValue({ data: row, error: null })
    vi.mocked(supabase.from).mockReturnValue({ select: () => ({ eq: () => ({ single }) }) } as never)
}

beforeEach(() => vi.clearAllMocks())

describe('getMyWorkerProfile', () => {
    it('lê pela RPC, sem tocar a tabela', async () => {
        answer({ id: 'w1' })
        await expect(getMyWorkerProfile('w1')).resolves.toEqual({ data: { id: 'w1' }, error: null })
        expect(supabase.from).not.toHaveBeenCalled()
    })

    it.each(['PGRST202', '42883'])('RPC inexistente (%s): usa a leitura antiga', async (code) => {
        answer(null, { code })
        fallbackRow({ id: 'w1', cpf: null })
        await expect(getMyWorkerProfile('w1')).resolves.toMatchObject({ data: { id: 'w1' } })
    })

    it('outro erro não cai no fallback', async () => {
        answer(null, { code: '42501' })
        await expect(getMyWorkerProfile('w1')).resolves.toMatchObject({ data: null, error: { code: '42501' } })
        expect(supabase.from).not.toHaveBeenCalled()
    })

    it('null vira erro, como o .single()', async () => {
        answer(null)
        const result = await getMyWorkerProfile('w1')
        expect(result.data).toBeNull()
        expect(result.error).toBeTruthy()
    })
})

describe('setMyWorkerIdentity', () => {
    it('RPC inexistente devolve unavailable', async () => {
        answer(null, { code: 'PGRST202' })
        await expect(setMyWorkerIdentity()).resolves.toEqual({ outcome: 'unavailable' })
    })

    it('falha de rede não é tratada como RPC ausente', async () => {
        answer(null, { message: 'fetch failed' })
        await expect(setMyWorkerIdentity({ cpf: '52998224725' })).resolves.toEqual({ outcome: 'error' })
    })

    it.each(['saved', 'cpf_locked', 'birth_date_locked', 'invalid_cpf', 'invalid_birth_date', 'anonymized'])(
        'repassa %s', async (outcome) => {
            answer({ outcome })
            await expect(setMyWorkerIdentity({ cpf: '52998224725', birthDate: '1990-01-01' })).resolves.toEqual({ outcome })
            expect(supabase.rpc).toHaveBeenCalledWith('set_my_worker_identity', {
                p_cpf: '52998224725', p_birth_date: '1990-01-01',
            })
        },
    )
})
