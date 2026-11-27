/**
 * Repetição com espera crescente para carregamentos de gate/tela.
 *
 * RCA do falso "Sem conexão": o gate de acesso desistia na primeira falha (qualquer erro, inclusive
 * 401 de token em renovação ou 5xx passageiro) e ainda por um prazo fixo de 20s somando várias
 * chamadas em série, curto para rede lenta (um fetch levou 12s). O erro aparecia com a internet
 * funcionando e "Tentar de novo" resolvia de primeira. Aqui: repete antes de mostrar erro e só
 * chama de "sem conexão" a falha que é de rede de verdade.
 */

export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];

interface ErrorLike {
    name?: unknown;
    message?: unknown;
    status?: unknown;
    code?: unknown;
}

function asErrorLike(error: unknown): ErrorLike {
    return error && typeof error === 'object' ? (error as ErrorLike) : {};
}

function statusOf(error: unknown): number | null {
    const { status } = asErrorLike(error);
    return typeof status === 'number' ? status : null;
}

/** 401 / JWT vencido: o token estava em renovação; um refresh e uma repetição resolvem. */
export function isUnauthorizedError(error: unknown): boolean {
    const { message, code } = asErrorLike(error);
    if (statusOf(error) === 401) return true;
    if (code === 'PGRST301' || code === 'PGRST303') return true;
    return typeof message === 'string' && /jwt expired|invalid jwt/i.test(message);
}

/**
 * Falha de transporte (fetch não completou). Permissão/RLS, 4xx e 5xx NÃO são rede: o servidor
 * respondeu. `navigator.onLine === false` confirma, mas `true` não basta para descartar.
 */
export function isRealNetworkError(error: unknown): boolean {
    if (statusOf(error) !== null && statusOf(error) !== 0) return false;
    const { name, message } = asErrorLike(error);
    const text = typeof message === 'string' ? message : '';
    if (name === 'TypeError' || /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(text)) {
        return true;
    }
    return typeof navigator !== 'undefined' && navigator.onLine === false && name === 'AuthRetryableFetchError';
}

/** Vale repetir: rede, 401, 408, 429, 5xx, timeout e erro sem status (função/RPC instável). */
export function isRetryableError(error: unknown): boolean {
    if (isRealNetworkError(error) || isUnauthorizedError(error)) return true;
    const status = statusOf(error);
    if (status === null) {
        const { code } = asErrorLike(error);
        // Postgres/PostgREST: permissão e violação de regra não melhoram repetindo.
        return !(typeof code === 'string' && /^(42501|PGRST1\d\d|PGRST2\d\d|23\d{3})$/.test(code));
    }
    return status === 0 || status === 408 || status === 429 || status >= 500;
}

export interface RetryOptions {
    delays?: readonly number[];
    shouldRetry?: (error: unknown) => boolean;
    /** Roda antes de cada repetição (ex.: refresh de sessão quando o erro foi 401). */
    beforeRetry?: (error: unknown, attempt: number) => Promise<void> | void;
    sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Executa `fn`; em falha repetível espera 1s/2s/4s (padrão) e tenta de novo. Lança o último erro. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const { delays = RETRY_DELAYS_MS, shouldRetry = isRetryableError, beforeRetry, sleep = defaultSleep } = options;
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt >= delays.length || !shouldRetry(error)) throw error;
            await sleep(delays[attempt]);
            if (beforeRetry) {
                try {
                    await beforeRetry(error, attempt);
                } catch {
                    // o refresh falhar não impede a repetição
                }
            }
        }
    }
}

/** Mensagem honesta: "sem conexão" só quando a falha foi de rede de fato. */
export function loadFailureMessage(error: unknown): string {
    if (isRealNetworkError(error) || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
        return 'Sem conexão. Verifique sua internet e tente de novo.';
    }
    return 'Não foi possível carregar agora. Nada foi alterado. Tente de novo.';
}
