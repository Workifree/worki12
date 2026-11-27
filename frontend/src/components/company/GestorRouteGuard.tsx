import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useCurrentCompanyState } from '../../hooks/useCurrentCompany';
import { invalidateCompanyScope } from '../../services/companyScopeService';
import { isGestorOnlyPath } from '../../lib/navigation';
import ErroDeCarga from '../ErroDeCarga';
import SemAcesso from '../SemAcesso';

function Guard({ children }: { pathname: string; children: ReactNode }) {
    const { company, resolved, error } = useCurrentCompanyState();

    // Nada da tela monta antes de saber o papel: sem consulta e sem conteúdo piscando.
    if (!resolved) {
        return <div className="h-40 animate-pulse rounded-2xl bg-gray-200" role="status" aria-label="Verificando seu acesso" />;
    }
    if (error) return <ErroDeCarga onRetry={invalidateCompanyScope} />;
    if (company?.role === 'encarregado') return <SemAcesso />;
    return <>{children}</>;
}

/** Guarda ÚNICA das rotas só do Gestor; a lista vem de `lib/navigation`. */
export default function GestorRouteGuard({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const path = pathname.replace(/\/+$/, '') || '/';
    return isGestorOnlyPath(path) ? <Guard key={path} pathname={path}>{children}</Guard> : <>{children}</>;
}
