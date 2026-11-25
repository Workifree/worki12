/**
 * Criação rápida de turnos (`.harness/spec/criacao-rapida-de-turnos`).
 * AINDA SEM ROTA: ver `integracao.md` na pasta da spec (a migration 20261128000100 vem antes).
 */
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useCurrentCompanyState } from '../../hooks/useCurrentCompany';
import { invalidateCompanyScope, isGestor, isUnconfirmedEncarregado } from '../../services/companyScopeService';
import { ShiftBatchFlow } from '../../components/shift-batch/ShiftBatchFlow';
import type { ShiftDraftBatch } from '../../lib/shiftDrafts';
import { Alert, Button, ErrorState, PageHeader, SkeletonList } from '../../components/ui';

export default function CompanyCreateBatch() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    // Copiloto: `navigate(rota, { state: { shiftDraftBatch } })` abre a revisão preenchida.
    const initialDraft = (useLocation().state as { shiftDraftBatch?: ShiftDraftBatch } | null)?.shiftDraftBatch ?? null;
    const queryClient = useQueryClient();
    const { company, resolved, error } = useCurrentCompanyState();

    return (
        <div className="mx-auto max-w-3xl">
            <Button variant="ghost" onClick={() => navigate(-1)} iconLeft={<ArrowLeft size={16} />} className="-ml-3 mb-2">
                Sair
            </Button>
            <PageHeader title="Criar turnos" subtitle="Um ou vários de uma vez. Nada é publicado sem o seu toque." />

            {!resolved && <SkeletonList count={3} itemClassName="h-16" />}
            {resolved && error && <ErrorState onRetry={invalidateCompanyScope} />}
            {resolved && !error && !company && <Alert tone="warning">Perfil de empresa não encontrado.</Alert>}
            {company && isUnconfirmedEncarregado(company) && (
                <Alert tone="info" title="Aguardando confirmação">
                    O Gestor precisa confirmar o seu acesso antes de você criar turnos.
                </Alert>
            )}
            {company && !isUnconfirmedEncarregado(company) && (
                <ShiftBatchFlow
                    key={company.company_id}
                    companyId={company.company_id}
                    isGestor={isGestor(company)}
                    tagsEnabled={company.team_enabled === true || company.role === 'encarregado'}
                    repeatJobId={searchParams.get('repetir')}
                    initialDraft={initialDraft}
                    onPublished={() => { void queryClient.invalidateQueries({ queryKey: ['companyJobs'] }); }}
                />
            )}
        </div>
    );
}
