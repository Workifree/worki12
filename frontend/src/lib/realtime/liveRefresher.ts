/**
 * Decide QUANDO recarregar: agrupa eventos (debounce), nunca roda duas recargas ao mesmo tempo,
 * espera a aba ficar visível e a tela sair da pausa (modal/edição), recupera ao voltar o foco ou a
 * rede e faz polling só enquanto o tempo real não está confirmado.
 */
import { logError } from '../logger';
import type { LiveEvent } from './liveHub';

export type RefreshReason = 'event' | 'reconnect' | 'visible' | 'online' | 'poll';

export interface RefreshContext {
    /** Recarga de fundo: não ligar spinner, não trocar a tela por erro, não sobrescrever formulário. */
    silent: true;
    reasons: RefreshReason[];
    events: LiveEvent[];
    /** `false` depois que a tela saiu ou a unidade/turno mudou: descarte o resultado. */
    isCurrent: () => boolean;
}

export interface RefresherOptions {
    run: (ctx: RefreshContext) => unknown;
    debounceMs?: number;
    /** Teto do agrupamento: rajada contínua de eventos não adia para sempre. */
    maxWaitMs?: number;
    /** Polling de contingência, limitado a 15–30s. */
    pollMs?: number;
    /** Intervalo mínimo entre recargas por foco/aba (foco e visibilidade disparam juntos). */
    focusThrottleMs?: number;
}

export function createLiveRefresher(options: RefresherOptions) {
    const { run, debounceMs = 400, maxWaitMs = 2000, focusThrottleMs = 3000 } = options;
    const pollMs = Math.min(30000, Math.max(15000, options.pollMs ?? 20000));
    let disposed = false;
    let paused = false;
    let live = false;
    let running = false;
    let lastRunAt = Date.now(); // a tela acabou de carregar
    let reasons = new Set<RefreshReason>();
    let events: LiveEvent[] = [];
    let firstPendingAt = 0;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    const visible = () => document.visibilityState !== 'hidden';
    const online = () => navigator.onLine !== false;
    const canRun = () => !disposed && !paused && visible() && online();

    const flush = async () => {
        debounceTimer = undefined;
        if (running || reasons.size === 0 || !canRun()) return; // fica pendente
        const ctx: RefreshContext = { silent: true, reasons: [...reasons], events, isCurrent: () => !disposed };
        reasons = new Set();
        events = [];
        firstPendingAt = 0;
        running = true;
        lastRunAt = Date.now();
        try {
            await run(ctx);
        } catch (error) {
            logError('liveRefresh', error);
        } finally {
            running = false;
            if (reasons.size > 0) schedule(debounceMs);
        }
    };

    const schedule = (delay: number) => {
        if (disposed) return;
        const now = Date.now();
        firstPendingAt ||= now;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { void flush(); }, Math.max(0, Math.min(delay, firstPendingAt + maxWaitMs - now)));
    };

    const request = (reason: RefreshReason, event?: LiveEvent) => {
        if (disposed) return;
        reasons.add(reason);
        if (event && events.length < 50) events.push(event);
        schedule(debounceMs);
    };

    const syncPolling = () => {
        const wanted = !live && canRun();
        if (!wanted) {
            clearTimeout(pollTimer);
            pollTimer = undefined;
            return;
        }
        if (pollTimer !== undefined) return;
        pollTimer = setTimeout(() => {
            pollTimer = undefined;
            request('poll');
            syncPolling();
        }, pollMs);
    };

    const resume = (reason: 'visible' | 'online') => {
        syncPolling();
        if (!visible()) return;
        if (reason === 'visible' && reasons.size === 0 && Date.now() - lastRunAt < focusThrottleMs) return;
        request(reason);
    };
    const onVisibility = () => { if (visible()) resume('visible'); else syncPolling(); };
    const onFocus = () => resume('visible');
    const onOnline = () => resume('online');
    const onOffline = () => syncPolling();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    syncPolling();

    return {
        request,
        setLive(next: boolean) {
            live = next;
            syncPolling();
        },
        setPaused(next: boolean) {
            if (paused === next) return;
            paused = next;
            syncPolling();
            if (!paused && reasons.size > 0) schedule(debounceMs);
        },
        dispose() {
            disposed = true;
            clearTimeout(debounceTimer);
            clearTimeout(pollTimer);
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
        },
    };
}

export type LiveRefresher = ReturnType<typeof createLiveRefresher>;
