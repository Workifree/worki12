import { useCurrentCompany } from './useCurrentCompany';

/**
 * Chat da empresa (ADR-20261127): o Gestor e o Encarregado CONFIRMADO usam Mensagens; o banco
 * escopa as conversas pelo turno (`is_job_owner`). Encarregado ainda não confirmado opera zero.
 * Enquanto o papel é desconhecido o atalho não aparece (só APARECE depois, nunca some).
 */
export function useCanUseCompanyChat(): boolean {
    const company = useCurrentCompany();
    return !!company && company.confirmed !== false;
}
