/** Hub de tempo real dos testes (ligado em `setup.ts`): sempre "ao vivo" e disparado à mão. */
import type { LiveEvent, LiveHub, LiveListener, LiveSource } from '../lib/realtime/liveHub'

const subscribers = new Set<{ sources: LiveSource[]; listener: LiveListener }>()

export const testHub: LiveHub = {
    subscribe(sources, listener) {
        const entry = { sources, listener }
        subscribers.add(entry)
        listener.onState(true, false)
        return () => { subscribers.delete(entry) }
    },
    reset: () => subscribers.clear(),
    size: () => subscribers.size,
}

/** Simula uma mudança numa tabela: chega a quem assina a tabela. */
export function emitLive(table: string, row: Record<string, unknown> = {}) {
    const event: LiveEvent = { table, eventType: 'UPDATE', new: row, old: {} }
    for (const { sources, listener } of [...subscribers]) {
        if (sources.some((s) => s.table === table)) listener.onEvent(event)
    }
}

export const liveSubscriptions = () => [...subscribers].map((s) => s.sources)
