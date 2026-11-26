import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLiveHub } from './liveHub'
import type { LiveClient } from './liveHub'
import { createAlertTracker } from './liveAlerts'
import { fakeClient } from './testFakes'

const listener = () => ({ onEvent: vi.fn(), onState: vi.fn() })
const lastState = (l: ReturnType<typeof listener>) => l.onState.mock.calls[l.onState.mock.calls.length - 1]

describe('createLiveHub', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    const source = { table: 'applications', filter: 'worker_id=eq.1' }

    it('SUBSCRIBED sozinho não é tempo real: só o system ok liga', () => {
        const fake = fakeClient()
        const hub = createLiveHub(fake.client as unknown as LiveClient)
        const a = listener()
        hub.subscribe([source], a)
        fake.channels[0].status('SUBSCRIBED')
        expect(lastState(a)).toEqual([false, false])
        fake.channels[0].system('ok')
        expect(lastState(a)[0]).toBe(true)
    })

    it('tabela não publicada (system error) fica fora do ar mesmo com SUBSCRIBED', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const fake = fakeClient()
        const hub = createLiveHub(fake.client as unknown as LiveClient)
        const a = listener()
        hub.subscribe([source, { table: 'job_live_signals' }], a)
        fake.channels[0].status('SUBSCRIBED')
        fake.channels[0].system('ok')
        fake.channels[1].status('SUBSCRIBED')
        fake.channels[1].system('error')
        expect(lastState(a)[0]).toBe(false)
        // a origem boa continua entregando
        fake.channels[0].change({ eventType: 'UPDATE', new: { id: 'x' }, old: {} })
        expect(a.onEvent).toHaveBeenCalledWith(expect.objectContaining({ table: 'applications', eventType: 'UPDATE' }))
        warn.mockRestore()
    })

    it('sem confirmação no prazo cai; ao voltar pede ressincronização', () => {
        const fake = fakeClient()
        const hub = createLiveHub(fake.client as unknown as LiveClient, { confirmTimeoutMs: 1000 })
        const a = listener()
        hub.subscribe([source], a)
        fake.channels[0].status('SUBSCRIBED')
        fake.channels[0].system('ok')
        fake.channels[0].status('CHANNEL_ERROR')
        expect(lastState(a)).toEqual([false, false])
        fake.channels[0].system('ok')
        expect(lastState(a)).toEqual([true, true])
    })

    it('compartilha o canal e só remove quando o último sai (com folga para troca de tela)', () => {
        const fake = fakeClient()
        const hub = createLiveHub(fake.client as unknown as LiveClient, { releaseDelayMs: 500 })
        const a = listener(), b = listener()
        const offA = hub.subscribe([source], a)
        const offB = hub.subscribe([source], b)
        expect(fake.channels).toHaveLength(1)
        offA()
        offB()
        const offC = hub.subscribe([source], listener())
        vi.advanceTimersByTime(1000)
        expect(fake.removed).toHaveLength(0)
        offC()
        vi.advanceTimersByTime(500)
        expect(fake.removed).toHaveLength(1)
        expect(hub.size()).toBe(0)
    })

    it('canal fechado por fora é reaberto; o fechamento intencional não', () => {
        const fake = fakeClient()
        const hub = createLiveHub(fake.client as unknown as LiveClient, { reopenDelayMs: 100, releaseDelayMs: 0 })
        const off = hub.subscribe([source], listener())
        fake.channels[0].status('CLOSED')
        vi.advanceTimersByTime(100)
        expect(fake.channels).toHaveLength(2)
        off()
        vi.advanceTimersByTime(1)
        fake.channels[1].status('CLOSED')
        vi.advanceTimersByTime(1000)
        expect(fake.channels).toHaveLength(2)
    })

    it('logout e troca de conta fecham tudo e eventos atrasados são ignorados', () => {
        const fake = fakeClient()
        const hub = createLiveHub(fake.client as unknown as LiveClient)
        const a = listener()
        hub.subscribe([source], a)
        fake.auth('SIGNED_IN', 'u1')
        fake.auth('TOKEN_REFRESHED', 'u1')
        vi.advanceTimersByTime(1)
        expect(hub.size()).toBe(1)
        fake.auth('SIGNED_OUT', null)
        vi.advanceTimersByTime(1)
        expect(hub.size()).toBe(0)
        expect(fake.removed).toHaveLength(1)
        fake.channels[0].change({ eventType: 'INSERT', new: {}, old: {} })
        expect(a.onEvent).not.toHaveBeenCalled()
    })
})

describe('createAlertTracker', () => {
    const row = (id: string, minute: number, extra = {}) => ({
        id, type: 'status_change', title: 'Maria aceitou o turno', message: `Maria aceitou o turno "${id}".`,
        link: null, read_at: null, created_at: `2026-11-25T10:${String(minute).padStart(2, '0')}:00Z`, ...extra,
    })

    it('não anuncia o que já existia, anuncia o novo uma única vez', () => {
        const t = createAlertTracker()
        expect(t.collect([row('a', 1)])).toEqual([])
        expect(t.collect([row('b', 2), row('a', 1)])).toEqual([{ message: 'Maria aceitou o turno "b".', type: 'success' }])
        expect(t.collect([row('b', 2), row('a', 1)])).toEqual([])
    })

    it('ignora lido, silenciado e linha antiga que reaparece na janela', () => {
        const t = createAlertTracker()
        t.collect([row('a', 5)])
        expect(t.collect([row('lida', 7, { read_at: 'x' }), row('chat', 6, { type: 'message' }), row('velha', 1)],
            (r) => r.type === 'message')).toEqual([])
    })

    it('rajada vira o mais recente + um resumo; lista vazia na base ainda anuncia depois', () => {
        const t = createAlertTracker()
        t.collect([])
        const out = t.collect([row('c', 3), row('b', 2), row('a', 1)])
        expect(out).toEqual([
            { message: 'Maria aceitou o turno "c".', type: 'success' },
            { message: 'Mais 2 avisos novos no sino.', type: 'info' },
        ])
    })
})
