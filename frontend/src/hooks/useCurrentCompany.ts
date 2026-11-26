import { useEffect, useState } from 'react';
import { getMyCompanies, pickCurrentCompany, subscribeCompanyScope } from '../services/companyScopeService';
import { logError } from '../lib/logger';
import type { MyCompany } from '../types';

/**
 * Empresa corrente da sessão (via seam `get_my_companies`) que se atualiza sozinha quando o escopo
 * é invalidado (convite, confirmação, remoção) — sem recarregar a página. `enabled=false` não
 * consulta nada (ex.: navegação de freela).
 */
export function useCurrentCompany(enabled = true): MyCompany | null {
    return useCurrentCompanyState(enabled).company;
}

/** Só o que decide telas/menus: se nada disso mudou, a referência anterior é mantida (sem re-render em cascata). */
function sameCompany(a: MyCompany | null, b: MyCompany | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.company_id === b.company_id
        && a.role === b.role
        && a.confirmed === b.confirmed
        && a.team_enabled === b.team_enabled
        && a.company_name === b.company_name
        && a.onboarding_completed === b.onboarding_completed
        && a.accepted_tos === b.accepted_tos;
}

/**
 * Igual a `useCurrentCompany`, mas diz quando a resolução TERMINOU (`resolved`) e se ela FALHOU
 * (`error`): `company: null` com `resolved: true` = a sessão não opera nenhuma empresa (ou a
 * consulta falhou — então `error: true`). Na falha a empresa anterior NÃO é mantida: um acesso
 * revogado não pode continuar parecendo ativo.
 */
export function useCurrentCompanyState(enabled = true): { company: MyCompany | null; resolved: boolean; error: boolean } {
    const [company, setCompany] = useState<MyCompany | null>(null);
    const [resolved, setResolved] = useState(false);
    const [error, setError] = useState(false);
    const [version, setVersion] = useState(0);

    useEffect(() => {
        if (!enabled) return;
        return subscribeCompanyScope(() => setVersion((v) => v + 1));
    }, [enabled]);

    useEffect(() => {
        if (!enabled) return;
        let active = true;
        void (async () => {
            try {
                const current = pickCurrentCompany(await getMyCompanies());
                if (!active) return;
                setCompany((prev) => (sameCompany(prev, current) ? prev : current));
                setError(false);
            } catch (err) {
                logError('useCurrentCompany', err);
                if (active) {
                    setCompany(null);
                    setError(true);
                }
            } finally {
                if (active) setResolved(true);
            }
        })();
        return () => { active = false; };
    }, [enabled, version]);

    return { company, resolved, error };
}
