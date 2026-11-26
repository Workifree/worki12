import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLiveRefresh } from './useLiveRefresh'
import type { UseLiveRefreshOptions } from './useLiveRefresh'
import { createLiveHub } from '../lib/realtime/liveHub'
import type { LiveClient } from '../lib/realtime/liveHub'
import { jobSources } from '../lib/realtime/liveSources'
import { fakeClient } from '../lib/realtime/testFakes'

let visibility: DocumentVisibilityState = 'visible'
let online = true

function setup(extra: Partial<UseLiveRefreshOptions> = {}) {
    const fake = fakeClient()
    const hub = createLiveHub(fake.client as unknown as LiveClient, { releaseDelayMs: 0 })
    const onRefresh = vi.fn()
    const view = renderHook(
        (props: Partial<UseLiveRefreshOptions>) => useLiveRefresh({ sources: [{ table: 'applications' }], onRefresh, hub, ...props }),
        { initialProps: extra },
    )
    const goLive = (i = 0) => act(() => { fake.channels[i].status('SUBSCRIBED'); fake.channels[i].system('ok') })
    const emit = (i = 0) => act(() => { fake.channels[i].change({ eventType: 'UPDATE', new: { id: 'x' }, old: {} }) })
    return { fake, hub, onRefresh, view, goLive, emit }
}
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('useLiveRefresh', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        visibility = 'visible'
        online = true
        vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
        vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
    })
    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('agrupa uma rajada em uma recarga silenciosa com os eventos', async () => {
        const { onRefresh, goLive, emit, view } = setup()
        goLive()
        expect(view.result.current.status).toBe('live')
        emit(); emit(); emit()
        await wait(450)
        expect(onRefresh).toHaveBeenCalledTimes(1)
        expect(onRefresh.mock.calls[0][0]).toMatchObject({ silent: true, reasons: ['event'] })
        expect(onRefresh.mock.calls[0][0].events).toHaveLength(3)
    })

    it('ao vivo não faz polling; sem confirmação confere a cada 20s e para ao confirmar', async () => {
        const { onRefresh, goLive, view } = setup()
        expect(view.result.current.status).toBe('fallback')
        await wait(20500)
        expect(onRefresh).toHaveBeenCalledTimes(1)
        expect(onRefresh.mock.calls[0][0].reasons).toEqual(['poll'])
        goLive()
        await wait(500) // ressincroniza o intervalo perdido
        expect(onRefresh.mock.calls[1][0].reasons).toEqual(['reconnect'])
        await wait(60000)
        expect(onRefresh).toHaveBeenCalledTimes(2)
    })

    it('aba oculta: sem polling e evento guardado até voltar', async () => {
        const { onRefresh, emit } = setup()
        visibility = 'hidden'
        act(() => { document.dispatchEvent(new Event('visibilitychange')) })
        emit()
        await wait(90000)
        expect(onRefresh).not.toHaveBeenCalled()
        visibility = 'visible'
        act(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')) })
        await wait(500)
        expect(onRefresh).toHaveBeenCalledTimes(1)
    })

    it('rede caiu: nada roda; ao voltar recarrega uma vez', async () => {
        const { onRefresh, goLive } = setup()
        goLive()
        online = false
        act(() => { window.dispatchEvent(new Event('offline')) })
        await wait(60000)
        expect(onRefresh).not.toHaveBeenCalled()
        online = true
        act(() => { window.dispatchEvent(new Event('online')) })
        await wait(500)
        expect(onRefresh).toHaveBeenCalledTimes(1)
        expect(onRefresh.mock.calls[0][0].reasons).toEqual(['online'])
    })

    it('pausado (modal aberto) segura a recarga e roda ao liberar', async () => {
        const { onRefresh, goLive, emit, view } = setup()
        goLive()
        view.rerender({ paused: true })
        emit()
        await wait(60000)
        expect(onRefresh).not.toHaveBeenCalled()
        view.rerender({ paused: false })
        await wait(500)
        expect(onRefresh).toHaveBeenCalledTimes(1)
    })

    it('não roda duas recargas juntas e erro não derruba as próximas', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const { onRefresh, goLive, emit } = setup()
        let reject: (e: Error) => void = () => {}
        onRefresh.mockImplementationOnce(() => new Promise((_ok, no) => { reject = no }))
        goLive()
        emit()
        await wait(450)
        emit()
        await wait(3000)
        expect(onRefresh).toHaveBeenCalledTimes(1)
        await act(async () => { reject(new Error('rede')) })
        await wait(500)
        expect(onRefresh).toHaveBeenCalledTimes(2)
    })

    it('trocar de turno/unidade e desmontar limpam canais, timers e resultado antigo', async () => {
        const { fake, hub, onRefresh, view, emit } = setup({ sources: jobSources('a') })
        const before = fake.channels.length
        emit(1)
        await wait(450)
        const ctx = onRefresh.mock.calls[0][0]
        view.rerender({ sources: jobSources('b') })
        expect(ctx.isCurrent()).toBe(false)
        await wait(10)
        // a origem sem filtro (shift_call_targets) é igual nas duas e continua no mesmo canal
        expect(fake.removed).toHaveLength(before - 1)
        view.unmount()
        await wait(60000)
        expect(hub.size()).toBe(0)
        expect(onRefresh).toHaveBeenCalledTimes(1)
    })

    it('sem origens fica desligado', async () => {
        const { fake, onRefresh, view } = setup({ sources: [] })
        await wait(60000)
        expect(view.result.current.status).toBe('off')
        expect(fake.channels).toHaveLength(0)
        expect(onRefresh).not.toHaveBeenCalled()
    })
})
