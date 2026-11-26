import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getInvitePreviewName } from './invitePreviewService'

const rpc = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))
vi.mock('../lib/logger', () => ({ logError: vi.fn() }))

beforeEach(() => {
  rpc.mockReset()
})

describe('getInvitePreviewName', () => {
  it('devolve o nome quando a prévia responde ok para o tipo pedido', async () => {
    rpc.mockResolvedValue({ data: { outcome: 'ok', inviter_name: 'Momma Doces', kind: 'elenco' }, error: null })
    await expect(getInvitePreviewName('t', 'elenco')).resolves.toBe('Momma Doces')
    expect(rpc).toHaveBeenCalledWith('get_invite_preview', { p_token: 't' })
  })

  it.each([
    ['RPC inexistente', { data: null, error: { code: 'PGRST202' } }],
    ['não encontrado', { data: { outcome: 'not_found' }, error: null }],
    ['outro tipo', { data: { outcome: 'ok', inviter_name: 'X', kind: 'gerente' }, error: null }],
  ])('%s: null (texto genérico)', async (_n, resposta) => {
    rpc.mockResolvedValue(resposta)
    await expect(getInvitePreviewName('t', 'elenco')).resolves.toBeNull()
  })

  it('falha de rede não propaga', async () => {
    rpc.mockRejectedValue(new Error('rede'))
    await expect(getInvitePreviewName('t', 'elenco')).resolves.toBeNull()
  })
})
