import { describe, it, expect } from 'vitest'
import { groupByWorker, isHiddenEmptyConversation, type GroupableConversation } from './messageGroups'

const conv = (id: string, worker: string | null, extra: Partial<GroupableConversation> = {}): GroupableConversation => ({
    id, worker_id: worker, unread_count: 0, last_message_at: '2026-11-20T10:00:00Z', ...extra,
})

describe('groupByWorker', () => {
    it('uma linha por freela, com não lidas somadas e a conversa mais recente à frente', () => {
        const groups = groupByWorker([
            conv('a1', 'ana', { unread_count: 1, last_message_at: '2026-11-20T10:00:00Z' }),
            conv('a2', 'ana', { unread_count: 2, last_message_at: '2026-11-21T10:00:00Z' }),
            conv('b1', 'bia', { last_message_at: '2026-11-22T10:00:00Z' }),
        ])
        expect(groups.map((g) => g.key)).toEqual(['ana', 'bia'])
        expect(groups[0].unread_count).toBe(3)
        expect(groups[0].conversations.map((c) => c.id)).toEqual(['a2', 'a1'])
        expect(groups[0].latest.id).toBe('a2')
    })

    it('sem não lidas, ordena pela atividade mais recente', () => {
        const groups = groupByWorker([
            conv('a1', 'ana', { last_message_at: '2026-11-20T10:00:00Z' }),
            conv('b1', 'bia', { last_message_at: '2026-11-22T10:00:00Z' }),
        ])
        expect(groups.map((g) => g.key)).toEqual(['bia', 'ana'])
    })

    it('a conversa vazia não vira a prévia do freela quando há outra com mensagem', () => {
        const [group] = groupByWorker([
            conv('a1', 'ana', { no_messages: true, last_message_at: '2026-11-25T10:00:00Z' }),
            conv('a2', 'ana', { last_message_at: '2026-11-20T10:00:00Z' }),
        ])
        expect(group.latest.id).toBe('a2')
        expect(group.no_messages).toBe(false)
    })

    it('conversa sem freela identificado fica na própria linha', () => {
        expect(groupByWorker([conv('x', null), conv('y', null)])).toHaveLength(2)
    })
})

describe('isHiddenEmptyConversation', () => {
    const base = { applicationStatus: 'hired', jobStatus: 'open', hasMessages: false, previewsComplete: true }

    it('esconde cancelada ou de turno apagado SEM mensagem', () => {
        expect(isHiddenEmptyConversation({ ...base, applicationStatus: 'cancelled' })).toBe(true)
        expect(isHiddenEmptyConversation({ ...base, jobStatus: 'deleted' })).toBe(true)
    })

    it('com mensagem, aparece', () => {
        expect(isHiddenEmptyConversation({ ...base, applicationStatus: 'cancelled', hasMessages: true })).toBe(false)
    })

    it('sem prova de que está vazia (prévias truncadas), aparece', () => {
        expect(isHiddenEmptyConversation({ ...base, applicationStatus: 'cancelled', previewsComplete: false })).toBe(false)
    })

    it('conversa viva e vazia aparece', () => {
        expect(isHiddenEmptyConversation(base)).toBe(false)
    })
})
