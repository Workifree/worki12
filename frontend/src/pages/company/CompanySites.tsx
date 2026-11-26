/** Locais da empresa (presença verificada) e o padrão de presença para turnos novos. */
import BackToGestao from '../../components/company/BackToGestao';
import PresenceDefaultCard from '../../components/company/PresenceDefaultCard';
import { SiteManager } from '../../components/presence/SiteManager';
import { useCurrentCompanyState } from '../../hooks/useCurrentCompany';
import { invalidateCompanyScope, isGestor } from '../../services/companyScopeService';
import { Alert, ErrorState, PageHeader, SkeletonList } from '../../components/ui';

export default function CompanySites() {
    const { company, resolved, error } = useCurrentCompanyState();
    const gestor = isGestor(company);

    return (
        <div className="mx-auto max-w-3xl pb-6" data-copilot-private>
            <BackToGestao />
            <PageHeader title="Locais" subtitle="Onde os turnos acontecem, para confirmar presença com QR e localização." />
            {!resolved && <SkeletonList count={3} />}
            {resolved && error && <ErrorState onRetry={invalidateCompanyScope} />}
            {resolved && !error && !company && <Alert tone="warning">Perfil de empresa não encontrado.</Alert>}
            {company && (
                <div className="space-y-6">
                    <SiteManager
                        companyId={company.company_id}
                        canManage={gestor}
                        printPath={(id) => `/company/locais/${id}/qr`}
                    />
                    {gestor && <PresenceDefaultCard companyId={company.company_id} />}
                </div>
            )}
        </div>
    );
}
