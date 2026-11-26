import { useEffect, useRef, useState } from 'react';
import { getLiveHub } from '../lib/realtime/defaultHub';
import { sourceKey } from '../lib/realtime/liveHub';
import type { LiveHub, LiveSource } from '../lib/realtime/liveHub';
import { createLiveRefresher } from '../lib/realtime/liveRefresher';
import type { LiveRefresher, RefreshContext } from '../lib/realtime/liveRefresher';

export interface UseLiveRefreshOptions {
    /** Ver `lib/realtime/liveSources.ts`. Lista vazia = desligado (ex.: empresa ainda carregando). */
    sources: LiveSource[];
    /** Recarga SILENCIOSA: sem spinner, sem tela de erro, sem mexer em formulário/modal. */
    onRefresh: (ctx: RefreshContext) => unknown;
    enabled?: boolean;
    /** `true` com modal aberto, edição ou envio em andamento: a recarga espera e roda ao liberar. */
    paused?: boolean;
    pollMs?: number;
    debounceMs?: number;
    /** Só para testes. */
    hub?: LiveHub;
}

/** `live`: tempo real confirmado. `fallback`: conferindo de tempos em tempos. */
export type LiveStatus = 'off' | 'live' | 'fallback';

export function useLiveRefresh(options: UseLiveRefreshOptions): { status: LiveStatus } {
    const { sources, enabled = true, paused = false, pollMs, debounceMs, hub } = options;
    const active = enabled && sources.length > 0;
    // Muda quando muda a unidade, o turno ou a pessoa: derruba a assinatura anterior.
    const key = active ? sources.map(sourceKey).join(';') : '';

    const latest = useRef(options);
    const refresherRef = useRef<LiveRefresher | null>(null);
    const [liveKey, setLiveKey] = useState('');

    useEffect(() => {
        latest.current = options;
    });

    useEffect(() => {
        if (!key) return;
        const refresher = createLiveRefresher({
            run: (ctx) => latest.current.onRefresh(ctx),
            pollMs,
            debounceMs,
        });
        refresher.setPaused(latest.current.paused ?? false);
        refresherRef.current = refresher;
        const unsubscribe = (hub ?? getLiveHub()).subscribe(latest.current.sources, {
            onEvent: (event) => refresher.request('event', event),
            onState: (live, resync) => {
                refresher.setLive(live);
                if (resync) refresher.request('reconnect');
                setLiveKey(live ? key : '');
            },
        });
        return () => {
            unsubscribe();
            refresher.dispose();
            refresherRef.current = null;
        };
    }, [key, pollMs, debounceMs, hub]);

    useEffect(() => {
        refresherRef.current?.setPaused(paused);
    }, [paused]);

    return { status: !active ? 'off' : liveKey === key ? 'live' : 'fallback' };
}
