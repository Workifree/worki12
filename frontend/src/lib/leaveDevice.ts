/**
 * Antes de sair da conta: para de mandar avisos a este aparelho. Best-effort: nunca lança e nunca
 * segura o logout por mais que `LEAVE_TIMEOUT_MS`.
 */
import { isAvisosEnabled } from './features';
import { logError } from './logger';
import { disablePushOnThisDevice } from '../services/pushService';

export const LEAVE_TIMEOUT_MS = 2000;

export async function leaveDevice(): Promise<void> {
    if (!isAvisosEnabled()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            disablePushOnThisDevice(),
            new Promise<void>((resolve) => { timer = setTimeout(resolve, LEAVE_TIMEOUT_MS); }),
        ]);
    } catch (error) {
        logError('leaveDevice', error);
    } finally {
        clearTimeout(timer);
    }
}
