/** Cartaz do QR fixo de um local. Só Gestor (o banco também recusa). */
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { SiteQrPrint } from '../../components/presence/SiteQrPrint';
import SemAcesso from '../../components/SemAcesso';
import { useCurrentCompanyState } from '../../hooks/useCurrentCompany';
import { isGestor } from '../../services/companyScopeService';
import { PageHeader, SkeletonList } from '../../components/ui';

export default function CompanySiteQr() {
    const { id } = useParams();
    const { company, resolved } = useCurrentCompanyState();

    if (!resolved) return <SkeletonList count={2} />;
    if (!id || !isGestor(company)) {
        return <SemAcesso mensagem="Só o Gestor imprime o cartaz do local." voltarPara="/company/locais" rotulo="Voltar aos locais" />;
    }
    return (
        <div className="mx-auto max-w-2xl pb-6" data-copilot-private>
            <Link to="/company/locais" className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-bold print:hidden">
                <ChevronLeft size={18} aria-hidden="true" /> Locais
            </Link>
            <PageHeader title="Cartaz do QR" />
            <SiteQrPrint siteId={id} />
        </div>
    );
}
