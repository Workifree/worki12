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
    // Sem dica de papel, o menu é o restrito (Encarregado) e o Início já aponta para Hoje, como ele
    // apontará depois de resolvido: o destino não pisca entre Visão geral e Hoje.
    const roleHint = readNavRoleHint();
    return { isEncarregado: roleHint !== 'gestor', hasTeam: roleHint === null ? true : readTeamNavHint() };
}
