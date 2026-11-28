import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useCurrentCompanyState } from '../../hooks/useCurrentCompany';
import { invalidateCompanyScope } from '../../services/companyScopeService';
import { isGestorOnlyPath } from '../../lib/navigation';
import ErroDeCarga from '../ErroDeCarga';
import SemAcesso from '../SemAcesso';

function Guard({ children }: { children: ReactNode }) {
    const { company, resolved, error } = useCurrentCompanyState();

    // Nada da tela monta antes de saber o papel: sem consulta e sem conteúdo piscando.
    if (!resolved) {
        return <div className="h-40 animate-pulse rounded-2xl bg-gray-200" role="status" aria-label="Verificando seu acesso" />;
    }
    if (error) return <ErroDeCarga onRetry={invalidateCompanyScope} />;
    if (company?.role === 'encarregado') return <SemAcesso />;
    return <>{children}</>;
}

const isCompanyProfilePath = (path: string) => path === '/company/profile' || path.startsWith('/company/profile/');

/** Guarda ÚNICA das rotas só do Gestor; a lista vem de `lib/navigation`. */
export default function GestorRouteGuard({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const path = pathname.replace(/\/+$/, '') || '/';
    // Dados da empresa (/company/profile) também é do Gestor; antes o Encarregado era redirecionado em silêncio.
    return isGestorOnlyPath(path) || isCompanyProfilePath(path) ? <Guard key={path}>{children}</Guard> : <>{children}</>;
}
