/**
 * RCA do "Sem conexão" preso com a rede normal (auth-js 2.91.0):
 *  1. `initialize()` guarda `initializePromise` e `getSession()`/`getUser()` esperam por ela;
 *  2. ela é obtida sob `navigator.locks` com prazo de 10s. Se outra aba/quadro segura o lock
 *     (renovando token vencido, aba em segundo plano), o `navigatorLock` rejeita com o
 *     `AbortError` cru ("signal is aborted without reason");
 *  3. a promise REJEITADA fica guardada: toda chamada seguinte falha em ~1ms com o mesmo erro, e
 *     "Tentar de novo" não adianta — só uma carga nova da página.
 *
 * Correção na origem: enquanto o lock não for obtido, pede de novo (cada pedido cria um
 * AbortController novo) com espera crescente, para o timeout transitório não envenenar o client.
 */

export type AuthLock = <R>(name: string, acquireTimeout: number, fn: () => Promise<R>) => Promise<R>;

export function isAuthLockAbort(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const { name, isAcquireTimeout } = error as { name?: unknown; isAcquireTimeout?: unknown };
    return name === 'AbortError' || isAcquireTimeout === true;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const LOCK_RETRY_DELAYS_MS = [500, 1500, 4000];

export function createResilientLock(base: AuthLock, delays: readonly number[] = LOCK_RETRY_DELAYS_MS): AuthLock {
    return async <R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R> => {
        for (let attempt = 0; ; attempt++) {
            let started = false;
            try {
                return await base(name, acquireTimeout, () => {
                    started = true;
                    return fn();
                });
            } catch (error) {
                // Só repete se a operação NEM COMEÇOU. `acquireTimeout <= 0` é o tick de
                // renovação ("pego se estiver livre") ou espera sem prazo: não se repete.
                if (started || acquireTimeout <= 0 || !isAuthLockAbort(error) || attempt >= delays.length) throw error;
                await sleep(delays[attempt]);
            }
        }
    };
}

const RELOAD_FLAG = 'worki:auth-lock-reload';

/**
 * Último recurso: recarregar cria um client novo. Uma vez só por episódio (a marca só sai quando
 * uma verificação dá certo); sem sessionStorage não recarrega, para nunca entrar em ciclo.
 */
export function reloadOnceForAuthLock(reload: () => void = () => window.location.reload()): boolean {
    try {
        if (window.sessionStorage.getItem(RELOAD_FLAG)) return false;
        window.sessionStorage.setItem(RELOAD_FLAG, '1');
    } catch {
        return false;
    }
    reload();
    return true;
}

export function clearAuthLockReload(): void {
    try {
        window.sessionStorage.removeItem(RELOAD_FLAG);
    } catch {
        // sem armazenamento não há marca a limpar
    }
}
