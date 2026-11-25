import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

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

/**
 * Versão para os gates: lê a sessão salva (`getSession`). Com o token expirado e sem rede, o
 * auth-js devolve `session: null` JUNTO com o erro do refresh (a sessão continua salva).
 */
export async function checkStoredSession(): Promise<SessionCheck> {
    try {
        const { data, error } = await supabase.auth.getSession();
        if (data.session?.user) return { status: 'ok', user: data.session.user };
        if (!error || isSessionGone(error)) return { status: 'signed_out' };
        return { status: 'unavailable', error };
    } catch (error) {
        return { status: 'unavailable', error };
    }
}

export async function checkSession(): Promise<SessionCheck> {
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
