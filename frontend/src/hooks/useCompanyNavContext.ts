import { useEffect } from 'react';
import { hasTeamNav, readNavRoleHint, readTeamNavHint, writeNavRoleHint, writeTeamNavHint } from '../services/companyScopeService';
import type { CompanyNavContext } from '../lib/navigation';
import type { MyCompany } from '../types';

/**
 * Contexto de navegação da empresa. Enquanto o seam carrega, vale a dica da última resolução;
 * sem dica, assume o menu restrito (itens aparecem depois, nunca somem).
 */
export function useCompanyNavContext(company: MyCompany | null): CompanyNavContext {
    useEffect(() => {
        if (!company) return;
        writeTeamNavHint(hasTeamNav(company));
        writeNavRoleHint(company.role === 'encarregado' ? 'encarregado' : 'gestor');
    }, [company]);

    if (company) {
        return { isEncarregado: company.role === 'encarregado', hasTeam: hasTeamNav(company) };
    }
    return { isEncarregado: readNavRoleHint() !== 'gestor', hasTeam: readTeamNavHint() };
}
