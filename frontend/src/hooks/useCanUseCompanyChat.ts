import { useCurrentCompany } from './useCurrentCompany';

/**
 * O chat da empresa é só do Gestor na v1: o Encarregado não tem (spec equipe-encarregados).
 * Enquanto o papel é desconhecido o atalho não aparece (só APARECE depois, nunca some).
 */
export function useCanUseCompanyChat(): boolean {
    const company = useCurrentCompany();
    return !!company && company.role !== 'encarregado';
}
