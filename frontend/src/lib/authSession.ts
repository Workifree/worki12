import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { clearAuthLockReload, isAuthLockAbort, sleep } from './authLock';
import { withRetry } from './retry';

/**
 * `getUser()` vai à rede. Sem conexão ele devolve `user: null` JUNTO com um erro de rede, e quem
 * olha só o `user` manda para o /login alguém com a sessão salva. Aqui os três casos são separados:
 * só `signed_out` autoriza redirecionar.
 */
export type SessionCheck =
    | { status: 'ok'; user: User }
    | { status: 'signed_out' }
    | { status: 'unavailable'; error: unknown };

/** O servidor de auth (ou o próprio client) afirmou que não há sessão válida. */
function isSessionGone(error: { name?: string; status?: number }): boolean {
    if (error.name === 'AuthSessionMissingError') return true;
    return error.status === 400 || error.status === 401 || error.status === 403 || error.status === 404;
}

const SESSION_RETRY_DELAYS_MS = [300, 1200];

async function readStoredSession(): Promise<SessionCheck> {
    try {
        const { data, error } = await supabase.auth.getSession();
        if (data.session?.user) return { status: 'ok', user: data.session.user };
        if (!error || isSessionGone(error)) return { status: 'signed_out' };
        return { status: 'unavailable', error };
    } catch (error) {
        return { status: 'unavailable', error };
    }
}

/**
 * Versão para os gates: lê a sessão salva (`getSession`). Com o token expirado e sem rede, o
 * auth-js devolve `session: null` JUNTO com o erro do refresh (a sessão continua salva).
 * `AbortError` do lock de auth é repetido com espera; o resultado continua `unavailable` enquanto
 * a sessão não for lida de verdade (o gate nunca abre na dúvida).
 */
export async function checkStoredSession(delays: readonly number[] = SESSION_RETRY_DELAYS_MS): Promise<SessionCheck> {
    let result = await readStoredSession();
    for (const delay of delays) {
        if (result.status !== 'unavailable' || !isAuthLockAbort(result.error)) break;
        await sleep(delay);
        result = await readStoredSession();
    }
    if (result.status !== 'unavailable') clearAuthLockReload();
    return result;
}

/** `getUser()` com repetição (1s/2s/4s): rede lenta/token em renovação não vira erro de primeira. */
export async function checkSession(): Promise<SessionCheck> {
    let last = await checkSessionOnce();
    let first = true;
    try {
        await withRetry(async () => {
            if (!first) last = await checkSessionOnce();
            first = false;
            if (last.status === 'unavailable') throw last.error;
        });
    } catch {
        // `last` segue `unavailable`
    }
    return last;
}

async function checkSessionOnce(): Promise<SessionCheck> {
    try {
        const { data, error } = await supabase.auth.getUser();
        if (data.user) return { status: 'ok', user: data.user };
        if (!error || isSessionGone(error)) return { status: 'signed_out' };
        // Rede, 5xx, 429, timeout: não sabemos. Na dúvida, não derruba o usuário.
        return { status: 'unavailable', error };
    } catch (error) {
        return { status: 'unavailable', error };
    }
}

/**
 * Para consultas que sinalizam falha por exceção (react-query, `...Checked`): `null` = sem sessão;
 * não deu para saber = lança, e a tela mostra erro com "Tentar de novo".
 */
export async function getSessionUserOrThrow(): Promise<User | null> {
    const session = await checkSession();
    if (session.status === 'unavailable') throw session.error;
    return session.status === 'ok' ? session.user : null;
}
