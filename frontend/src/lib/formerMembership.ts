/**
 * Memória local (por usuário) das empresas de TERCEIROS em que a pessoa estava na equipe, para
 * avisar quando uma delas some de `get_my_companies`. Só aparência: quem autoriza é o RLS.
 */
import type { MyCompany } from '../types';

export interface RememberedMembership {
    id: string;
    name: string | null;
}

const key = (userId: string) => `worki_memberships:${userId}`;

function read(userId: string): RememberedMembership[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(key(userId)) ?? '[]');
        return Array.isArray(parsed) ? (parsed as RememberedMembership[]) : [];
    } catch {
        return [];
    }
}

function write(userId: string, list: RememberedMembership[]): void {
    try {
        localStorage.setItem(key(userId), JSON.stringify(list));
    } catch {
        // sem storage não há aviso
    }
}

/** Grava os vínculos atuais e devolve os lembrados que não existem mais. */
export function syncMemberships(userId: string, companies: MyCompany[]): RememberedMembership[] {
    const present = new Set(companies.map((c) => c.company_id));
    const ended = read(userId).filter((m) => !present.has(m.id));
    const current = companies
        .filter((c) => c.role === 'encarregado' || c.role === 'manager')
        .map((c) => ({ id: c.company_id, name: c.company_name?.trim() || null }));
    write(userId, [...ended, ...current]);
    return ended;
}

export function forgetMemberships(userId: string, ids: string[]): void {
    write(userId, read(userId).filter((m) => !ids.includes(m.id)));
}
