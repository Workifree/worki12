/** Carimbos de presença de uma `applications` (o freela marca, ou a empresa registra por ele). */
export interface PresenceStamps {
    worker_checkin_at: string | null;
    worker_checkout_at: string | null;
    company_checkin_confirmed_at: string | null;
    company_checkout_confirmed_at: string | null;
}

export function hasArrived(stamps: PresenceStamps): boolean {
    return !!(stamps.worker_checkin_at || stamps.company_checkin_confirmed_at);
}

export function hasLeftShift(stamps: PresenceStamps): boolean {
    return !!(stamps.worker_checkout_at || stamps.company_checkout_confirmed_at);
}

/** "No turno agora" é afirmação sobre carimbos, nunca sobre `status`: chegou e não saiu. */
export function isOnShift(stamps: PresenceStamps): boolean {
    return hasArrived(stamps) && !hasLeftShift(stamps);
}
