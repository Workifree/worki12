/** Cliente falso do Realtime para os testes de `lib/realtime` e `useLiveRefresh`. */
type Cb = (arg: never) => void

export function fakeClient() {
    const channels: ReturnType<typeof makeChannel>[] = []
    const removed: unknown[] = []
    let authCb: ((event: string, session: unknown) => void) | undefined

    function makeChannel(name: string) {
        const handlers: Record<string, Cb> = {}
        let statusCb: ((s: string) => void) | undefined
        const channel = {
            name,
            on(kind: string, _filter: unknown, cb: Cb) { handlers[kind] = cb; return channel },
            subscribe(cb: (s: string) => void) { statusCb = cb; return channel },
            status: (s: string) => statusCb?.(s),
            system: (status: 'ok' | 'error') => handlers.system?.({ extension: 'postgres_changes', status } as never),
            change: (payload: Record<string, unknown>) => handlers.postgres_changes?.(payload as never),
        }
        return channel
    }

    return {
        channels,
        removed,
        auth: (event: string, userId: string | null) => authCb?.(event, userId ? { user: { id: userId } } : null),
        client: {
            channel(name: string) { const c = makeChannel(name); channels.push(c); return c },
            removeChannel(c: unknown) { removed.push(c); return Promise.resolve('ok') },
            auth: { onAuthStateChange(cb: (event: string, session: unknown) => void) { authCb = cb; return { data: { subscription: { unsubscribe() {} } } } } },
        },
    }
}
