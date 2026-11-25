import { useEffect } from 'react';
import { useGuide } from '../../hooks/useGuide';
import { useCurrentCompany } from '../../hooks/useCurrentCompany';
import type { PapelGuia } from '../../lib/guide/tipos';

function useInformarPapel(papel: PapelGuia | null) {
    const definir = useGuide()?.definirPapel;
    // Sem limpeza de propósito: o papel vale também no recibo, que fica fora dos layouts.
    useEffect(() => { definir?.(papel); }, [definir, papel]);
}

/** Montar no `MainLayout`. */
export function GuideRoleFreela() {
    useInformarPapel('freela');
    return null;
}

/** Montar no `CompanyLayout`. Encarregado não confirmado (ou sem empresa) fica sem guia. */
export function GuideRoleEmpresa() {
    const empresa = useCurrentCompany();
    const papel: PapelGuia | null = !empresa
        ? null
        : empresa.role !== 'encarregado' ? 'gestor' : empresa.confirmed ? 'encarregado' : null;
    useInformarPapel(papel);
    return null;
}
