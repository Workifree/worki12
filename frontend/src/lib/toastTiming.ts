export type ToastType = 'success' | 'error' | 'info';

/** Máximo de avisos empilhados: erro não some sozinho, então a pilha precisa de teto. */
export const MAX_TOASTS = 4;

const BASE_MS: Record<Exclude<ToastType, 'error'>, number> = { success: 6000, info: 7000 };
const MAX_MS = 15000;

/**
 * Quanto o aviso fica na tela. `null` = até a pessoa fechar (erro). Mensagem longa ganha tempo de
 * leitura.
 */
export function toastDuration(type: ToastType, message: string): number | null {
    if (type === 'error') return null;
    return Math.min(MAX_MS, BASE_MS[type] + Math.max(0, message.length - 60) * 60);
}

interface ToastLike {
    message: string;
    type: ToastType;
}

/** Acrescenta o aviso, trocando o repetido (mesmo texto e tipo) e respeitando o teto. */
export function pushToast<T extends ToastLike>(list: readonly T[], toast: T): T[] {
    const others = list.filter((t) => t.type !== toast.type || t.message !== toast.message);
    return [...others, toast].slice(-MAX_TOASTS);
}
