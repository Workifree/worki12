/**
 * Assinaturas de `postgres_changes` compartilhadas (um canal por origem, com contagem de uso).
 *
 * `SUBSCRIBED` NÃO prova que há tempo real: quando a tabela não está publicada, o servidor aceita o
 * join (SUBSCRIBED) e só depois manda um evento `system` com `status: 'error'`. Um canal só conta
 * como "ao vivo" depois do `system: ok` — é isso que desliga o polling.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logError } from '../logger';

export interface LiveSource {
    table: string;
    /** Padrão '*'. DELETE não aceita filtro (nem passa por RLS: chega só a chave primária). */
    event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
    /** Sintaxe do Realtime, ex.: `company_id=eq.<uuid>`. */
    filter?: string;
}

export interface LiveEvent {
    table: string;
    eventType: 'INSERT' | 'UPDATE' | 'DELETE';
    new: Record<string, unknown>;
    old: Record<string, unknown>;
}

export interface LiveListener {
    onEvent: (event: LiveEvent) => void;
    /** `live`: TODAS as origens deste assinante confirmadas. `resync`: algo voltou e pode ter perdido eventos. */
    onState: (live: boolean, resync: boolean) => void;
}

export type LiveClient = Pick<SupabaseClient, 'channel' | 'removeChannel' | 'auth'>;

export interface LiveHubOptions {
    /** Sem `system: ok` neste prazo, o canal é tratado como fora do ar. */
    confirmTimeoutMs?: number;
    /** Espera antes de fechar um canal sem uso (evita derrubar e recriar em troca de tela). */
    releaseDelayMs?: number;
    /** Conexão que demorou mais que isto pode ter perdido eventos depois da carga da tela. */
    firstGapMs?: number;
    reopenDelayMs?: number;
}

type ChannelState = 'connecting' | 'live' | 'down';

interface Entry {
    key: string;
    source: LiveSource;
    channel: ReturnType<LiveClient['channel']> | null;
    state: ChannelState;
    openedAt: number;
    wasDown: boolean;
    listeners: Set<Subscriber>;
    confirmTimer?: ReturnType<typeof setTimeout>;
    releaseTimer?: ReturnType<typeof setTimeout>;
    reopenTimer?: ReturnType<typeof setTimeout>;
}

interface Subscriber {
    listener: LiveListener;
    keys: string[];
}

export const sourceKey = (s: LiveSource) => `${s.table}|${s.event ?? '*'}|${s.filter ?? ''}`;

export function createLiveHub(client: LiveClient, options: LiveHubOptions = {}) {
    const { confirmTimeoutMs = 12000, releaseDelayMs = 1500, firstGapMs = 1500, reopenDelayMs = 5000 } = options;
    const entries = new Map<string, Entry>();
    let sequence = 0;
    let authWatched = false;
    let sessionUser: string | null | undefined;

    const isLive = (sub: Subscriber) => sub.keys.every((k) => entries.get(k)?.state === 'live');

    const setState = (entry: Entry, state: ChannelState) => {
        if (entry.state === state) return;
        const resync = state === 'live' && (entry.wasDown || Date.now() - entry.openedAt > firstGapMs);
        entry.state = state;
        if (state === 'down') entry.wasDown = true;
        for (const sub of [...entry.listeners]) sub.listener.onState(isLive(sub), resync);
    };

    const closeChannel = (entry: Entry) => {
        clearTimeout(entry.confirmTimer);
        clearTimeout(entry.reopenTimer);
        const channel = entry.channel;
        entry.channel = null; // antes do remove: o CLOSED que vem dele é intencional
        if (channel) void Promise.resolve(client.removeChannel(channel)).catch((e) => logError('liveHub.removeChannel', e));
    };

    const open = (entry: Entry) => {
        const { table, event = '*', filter } = entry.source;
        // Nome único: `removeChannel` é assíncrono e um canal homônimo seria reaproveitado já fechando.
        const channel = client.channel(`live:${++sequence}:${table}`);
        entry.channel = channel;
        entry.openedAt = Date.now();
        const current = () => entry.channel === channel;
        const armConfirm = () => {
            clearTimeout(entry.confirmTimer);
            entry.confirmTimer = setTimeout(() => { if (current() && entry.state !== 'live') setState(entry, 'down'); }, confirmTimeoutMs);
        };
        const binding = { event, schema: 'public', table, ...(filter ? { filter } : {}) };
        channel
            .on('postgres_changes' as never, binding as never, ((payload: Omit<LiveEvent, 'table'>) => {
                if (!current()) return;
                const live: LiveEvent = { table, eventType: payload.eventType, new: payload.new ?? {}, old: payload.old ?? {} };
                for (const sub of [...entry.listeners]) sub.listener.onEvent(live);
            }) as never)
            .on('system' as never, {} as never, ((msg: { extension?: string; status?: string; message?: string }) => {
                if (!current() || msg.extension !== 'postgres_changes') return;
                clearTimeout(entry.confirmTimer);
                if (msg.status === 'ok') setState(entry, 'live');
                else {
                    // Esperado enquanto a tabela não está publicada: o polling cobre.
                    console.warn(`[tempo real] ${table}: ${msg.message ?? 'assinatura recusada'}`);
                    setState(entry, 'down');
                }
            }) as never)
            .subscribe((status: string) => {
                if (!current()) return;
                if (status === 'SUBSCRIBED') {
                    if (entry.state !== 'live') armConfirm();
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    setState(entry, 'down'); // o realtime-js tenta o rejoin sozinho
                } else if (status === 'CLOSED') {
                    // Fechado por fora: o realtime-js não reabre.
                    setState(entry, 'down');
                    closeChannel(entry);
                    entry.reopenTimer = setTimeout(() => { if (entries.get(entry.key) === entry) open(entry); }, reopenDelayMs);
                }
            });
        armConfirm();
    };

    const reset = () => {
        const all = [...entries.values()];
        entries.clear();
        for (const entry of all) {
            clearTimeout(entry.releaseTimer);
            closeChannel(entry);
            for (const sub of entry.listeners) sub.listener.onState(false, false);
        }
    };

    const watchAuth = () => {
        if (authWatched) return;
        authWatched = true;
        client.auth.onAuthStateChange((event, session) => {
            const next = session?.user?.id ?? null;
            const changedUser = !!sessionUser && !!next && next !== sessionUser;
            sessionUser = next;
            // Fora do callback: chamar o client aqui dentro prende o lock do auth.
            if (event === 'SIGNED_OUT' || changedUser) setTimeout(reset, 0);
        });
    };

    return {
        subscribe(sources: LiveSource[], listener: LiveListener): () => void {
            watchAuth();
            const sub: Subscriber = { listener, keys: [...new Set(sources.map(sourceKey))] };
            for (const source of sources) {
                const key = sourceKey(source);
                let entry = entries.get(key);
                if (!entry) {
                    entry = { key, source, channel: null, state: 'connecting', openedAt: Date.now(), wasDown: false, listeners: new Set() };
                    entries.set(key, entry);
                    entry.listeners.add(sub);
                    open(entry);
                } else {
                    clearTimeout(entry.releaseTimer);
                    entry.listeners.add(sub);
                }
            }
            listener.onState(sub.keys.length > 0 && isLive(sub), false);
            return () => {
                for (const key of sub.keys) {
                    const entry = entries.get(key);
                    if (!entry || !entry.listeners.delete(sub) || entry.listeners.size > 0) continue;
                    entry.releaseTimer = setTimeout(() => {
                        if (entry.listeners.size > 0 || entries.get(key) !== entry) return;
                        entries.delete(key);
                        closeChannel(entry);
                    }, releaseDelayMs);
                }
            };
        },
        /** Fecha tudo (logout / troca de conta). */
        reset,
        size: () => entries.size,
    };
}

export type LiveHub = ReturnType<typeof createLiveHub>;
