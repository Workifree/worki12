import { useCallback, useEffect, useRef, useState } from 'react';
import { listSites } from '../../services/presenceService';
import type { CompanySite, PresencePolicy } from '../../lib/presence';
import { DUAL_POLICY, loadPresenceDefault } from './presenceDefaults';

/**
 * Locais e política do formulário de turno. `companyId` nulo (função desligada ou empresa ainda
 * não resolvida) = não consulta nada. O padrão da empresa só entra em turno novo e nunca
 * sobrescreve o que a pessoa (ou o turno em edição) já definiu.
 */
export function usePresenceSetup(companyId: string | null, applyDefault: boolean) {
    const [sites, setSites] = useState<CompanySite[]>([]);
    const [policy, setPolicyState] = useState<PresencePolicy>(DUAL_POLICY);
    const touched = useRef(false);

    const setPolicy = useCallback((next: PresencePolicy) => {
        touched.current = true;
        setPolicyState(next);
    }, []);

    useEffect(() => {
        if (!companyId) return;
        let active = true;
        void listSites(companyId).then((list) => { if (active && list) setSites(list); });
        if (applyDefault) {
            void loadPresenceDefault(companyId).then((value) => {
                if (active && value && !touched.current) setPolicyState(value);
            });
        }
        return () => { active = false; };
    }, [companyId, applyDefault]);

    const siteError = policy.presence_mode === 'qr_gps' && !policy.site_id ? 'Escolha o local.' : undefined;
    return { sites, policy, setPolicy, siteError };
}
