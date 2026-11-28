// Pedido automático de avaliação da empresa (Meus Turnos).
// Regras: no máximo UM por sessão do navegador (sessionStorage); por turno, só até ser avaliado
// ou dispensado (a dispensa grava timestamp em localStorage e vale por 14 dias); só turno
// concluído nos últimos 3 dias.
export const RATE_PROMPTED_KEY = 'worki_rate_prompted_jobs';
export const RATE_SESSION_KEY = 'worki_rate_prompt_session';
export const RATE_PROMPT_WINDOW_DAYS = 3;
export const RATE_DISMISS_DAYS = 14;
const DAY_MS = 86_400_000;

type DismissMap = Record<string, number>;

export function readRateDismissals(): DismissMap {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(RATE_PROMPTED_KEY) ?? '{}');
        // Formato antigo (lista de ids, sem data): sem timestamp, conta como dispensa de agora.
        if (Array.isArray(parsed)) {
            const now = Date.now();
            return Object.fromEntries(parsed.filter((id): id is string => typeof id === 'string').map(id => [id, now]));
        }
        if (parsed && typeof parsed === 'object') {
            const out: DismissMap = {};
            for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
                if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
            }
            return out;
        }
    } catch {
        // storage ilegível: sem histórico
    }
    return {};
}

export function markRateDismissed(jobId: string, now = Date.now()): void {
    try {
        const entries = Object.entries({ ...readRateDismissals(), [jobId]: now })
            .sort((a, b) => a[1] - b[1])
            .slice(-100);
        localStorage.setItem(RATE_PROMPTED_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
        // sem storage vale só a trava de sessão
    }
}

export function isRateDismissed(jobId: string, now = Date.now()): boolean {
    const at = readRateDismissals()[jobId];
    return typeof at === 'number' && now - at < RATE_DISMISS_DAYS * DAY_MS;
}

export function ratePromptShownThisSession(): boolean {
    try {
        return sessionStorage.getItem(RATE_SESSION_KEY) === '1';
    } catch {
        return false;
    }
}

export function markRatePromptShownThisSession(): void {
    try {
        sessionStorage.setItem(RATE_SESSION_KEY, '1');
    } catch {
        // sem sessionStorage vale a trava por visita (ref) no componente
    }
}

export function isWithinRatePromptWindow(ref: string | null | undefined, now = Date.now()): boolean {
    if (!ref) return false;
    const t = new Date(ref.length === 10 ? `${ref}T12:00:00` : ref).getTime();
    return Number.isFinite(t) && now - t <= RATE_PROMPT_WINDOW_DAYS * DAY_MS;
}
