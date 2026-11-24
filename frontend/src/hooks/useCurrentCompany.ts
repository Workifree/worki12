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

/**
 * Igual a `useCurrentCompany`, mas diz quando a resolução TERMINOU (`resolved`): `company: null`
 * com `resolved: true` = a sessão não opera nenhuma empresa (ou a consulta falhou), e a tela deve
 * mostrar um estado útil em vez de carregar para sempre.
 */
export function useCurrentCompanyState(enabled = true): { company: MyCompany | null; resolved: boolean } {
    const [company, setCompany] = useState<MyCompany | null>(null);
    const [resolved, setResolved] = useState(false);
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
                if (active) setCompany(current);
            } catch (error) {
                logError('useCurrentCompany', error);
            } finally {
                if (active) setResolved(true);
            }
        })();
        return () => { active = false; };
    }, [enabled, version]);

    return { company, resolved };
}
