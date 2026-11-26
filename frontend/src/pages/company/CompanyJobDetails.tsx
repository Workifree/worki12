import { useEffect, useState } from 'react';

import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, MapPin, Calendar, Users, Edit2, PauseCircle, PlayCircle, Trash2, XCircle, Megaphone } from 'lucide-react';
import { occupancy, shiftStep, shiftWhen, type ApplicationStepInput } from '../../lib/nextAction';
import PageMeta from '../../components/PageMeta';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useToast } from '../../contexts/ToastContext';
import { formatBRL } from '../../lib/currency';
import { logError } from '../../lib/logger';
import SemAcesso from '../../components/SemAcesso';
import { getJobScope, canSeeJob } from '../../services/jobScopeService';
import { deleteShift } from '../../services/deleteShiftService';
import { cancelJobMessage, deleteShiftToast } from '../../services/shiftOperationService';
import { toBrazilDateOnly } from '../../lib/dateUtils';
import { getAuthenticatedCompanyId, isGestor, hasTeamNav } from '../../services/companyScopeService';
import { jobHasStarted } from '../../lib/todayView';
import { useCurrentCompany } from '../../hooks/useCurrentCompany';
import CancelJobModal from '../../components/company/CancelJobModal';
import { useCancelJobAvailable } from '../../hooks/useCancelJobAvailable';
import { getSessionUserOrThrow } from '../../lib/authSession';
import { ActionBar, Button, ButtonLink, Card, DialogActions, DialogHeader, ErrorState, ListRow, Menu, SkeletonList, StatusBadge } from '../../components/ui';
import { Dialog } from '../../components/ui/Dialog';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { useLatestResponse } from '../../hooks/useLatestResponse';
import { useAnyDialogOpen } from '../../hooks/useModalDismiss';
import { jobSources } from '../../lib/realtime/liveSources';


export default function CompanyJobDetails() {
    const { id } = useParams();
    const navigate = useNavigate();
    interface JobDetails {
        id: string;
        title: string;
        description: string;
        requirements: string;
        category: string;
        type: string;
        location?: string;
        budget: number;
        budget_type: string;
        scope: string;
        status: string;
        created_at: string;
        start_date?: string | null;
        views?: number;
        work_start_time?: string;
        work_end_time?: string;
        has_lunch?: boolean;
        slots?: number;
    }

    const [job, setJob] = useState<JobDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showCancelJob, setShowCancelJob] = useState(false);
    const currentCompany = useCurrentCompany();
    // Dono único não ganha a ação (R23); sem a RPC no ambiente, o item também não aparece.
    const cancelamentoDisponivel = useCancelJobAvailable(hasTeamNav(currentCompany));
    // null = ainda não lido; falha vira aviso com "Tentar de novo", nunca "0 freelas".
    const [apps, setApps] = useState<ApplicationStepInput[] | null>(null);
    const [erroFreelas, setErroFreelas] = useState(false);
    const [erroCarga, setErroCarga] = useState(false);
    const [semAcesso, setSemAcesso] = useState(false);
    const { addToast } = useToast();

    const beginDetails = useLatestResponse();
    const beginApplications = useLatestResponse();
    const dialogOpen = useAnyDialogOpen();
    useLiveRefresh({
        sources: id ? jobSources(id) : [],
        onRefresh: () => Promise.all([fetchJobDetails({ silent: true }), fetchApplications({ silent: true })]),
        paused: loading || dialogOpen || showDeleteConfirm || showCancelJob,
    });

    // Esc fecha o menu de ações (o clique fora é a camada transparente z-10 abaixo do menu).

    useEffect(() => {
        if (id) fetchJobDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchJobDetails usa state setters estaveis, so precisa re-executar quando id muda
    }, [id]);

    useEffect(() => {
        if (id) void fetchApplications();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só re-executa quando id muda
    }, [id]);

    const fetchApplications = async ({ silent = false }: { silent?: boolean } = {}) => {
        if (!id) return;
        const claim = beginApplications();
        if (!silent) setErroFreelas(false);
        const { data, error } = await supabase
            .from('applications')
            .select('status, company_checkin_confirmed_at, company_checkout_confirmed_at')
            .eq('job_id', id);
        if (error) {
            logError('CompanyJobDetails.fetchApplications', error);
            if (!silent && claim()) setErroFreelas(true);
            return;
        }
        if (!claim()) return;
        setErroFreelas(false);
        setApps((data ?? []) as ApplicationStepInput[]);
    };

    const fetchJobDetails = async ({ silent = false }: { silent?: boolean } = {}) => {
        const claim = beginDetails();
        // G3: guarda de id falsy — evita `jobs?id=eq.null`/`applications?job_id=eq.null`
        // mesmo se essa função for chamada de outro lugar além do useEffect que já checa `if (id)`.
        if (!id) { navigate('/company/jobs'); return; }
        try {
            const user = await getSessionUserOrThrow(); // rede fora lança e cai no erro com retry
            if (!user) { if (!silent) navigate('/login'); return; }

            const { data, error } = await supabase
                .from('jobs')
                .select('*')
                .eq('id', id)
                .eq('company_id', await getAuthenticatedCompanyId())
                .single();

            if (error) throw error;
            if (!canSeeJob(await getJobScope(), data)) { if (!silent) setSemAcesso(true); return; }

            if (!claim()) return;
            setJob(data);
        } catch (error) {
            // Falha de rede/RLS nao pode se disfarcar de "turno nao existe" mandando pra lista
            // em silencio — a pessoa perde o contexto sem saber por que (Nielsen #1).
            logError('Error fetching job:', error);
            if (!silent && claim()) setErroCarga(true);
        } finally {
            if (!silent) setLoading(false);
        }
    };

    const handleStatusChange = async (newStatus: string) => {
        // .select('id') obrigatório (patterns.md — DELETE/UPDATE sob RLS negado em silêncio):
        // sem isso, um UPDATE negado pela RLS de `jobs` (ligada nesta revisão) devolve 204 sem
        // erro e a UI ficaria presa mostrando o status antigo, sem avisar a empresa do motivo.
        const { data, error } = await supabase.from('jobs').update({ status: newStatus }).eq('id', id).select('id');
        if (error) {
            logError('CompanyJobDetails.handleStatusChange', error);
            addToast('Não foi possível atualizar o turno. Tente novamente.', 'error');
        } else if (!data || data.length === 0) {
            addToast('Não foi possível atualizar o turno: verifique se você ainda tem permissão sobre ele.', 'error');
        } else {
            fetchJobDetails();
        }
    };

    const handleDelete = async () => {
        if (!id) return;

        // `cancel_job` encerra convites, candidaturas e chamados junto com o turno.
        const result = await deleteShift(id);
        if (result.outcome === 'cancelled' || result.outcome === 'already_cancelled') {
            addToast(deleteShiftToast(result), 'success');
            navigate('/company/jobs');
        } else {
            addToast(cancelJobMessage(result, isGestor(currentCompany) ? 'gestor' : 'encarregado'), 'error');
        }
        setShowDeleteConfirm(false);
    };

    // "Cancelar turno" (RPC cancel_job) é ação de quem opera em equipe (R23): dono único não ganha
    // ação nova. Encarregado só cancela antes de o turno começar (depois, o banco recusa).
    const souGestor = isGestor(currentCompany);
    const turnoIniciado = job?.start_date
        ? jobHasStarted(toBrazilDateOnly(job.start_date), job.work_start_time?.slice(0, 5) ?? null)
        : false;
    const podeCancelarTurno = cancelamentoDisponivel && hasTeamNav(currentCompany) && (souGestor || !turnoIniciado);

    if (loading) return (
        <div className="p-8 max-w-4xl mx-auto animate-pulse space-y-6" role="status"><span className="sr-only">Carregando</span>
            <div className="h-10 bg-gray-200 rounded w-1/2" />
            <div className="h-4 bg-gray-200 rounded w-1/3" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
            </div>
            <div className="h-40 bg-gray-200 rounded-xl" />
        </div>
    );
    if (semAcesso) return (
        <SemAcesso mensagem="Este turno é de outra pessoa da equipe." voltarPara="/company/jobs" rotulo="Voltar aos turnos" />
    );
    if (erroCarga && !job) return (
        <div className="max-w-4xl mx-auto p-4 sm:p-8">
            <Button
                variant="ghost"
                onClick={() => navigate('/company/jobs')}
                iconLeft={<ArrowLeft size={16} strokeWidth={3} />}
                className="-ml-3 mb-4"
            >
                Voltar aos turnos
            </Button>
            <ErrorState onRetry={() => { setErroCarga(false); setLoading(true); fetchJobDetails(); }} />
        </div>
    );

    if (!job) return null;

    const unidadePreco = job.budget_type === 'hourly' ? '/ hora' : job.budget_type === 'daily' ? '/ dia' : 'total';

    const slots = job.slots ?? 1;
    const filled = apps === null ? null : apps.filter((a) => ['hired', 'in_progress', 'completed'].includes(a.status)).length;
    const state = occupancy(slots, filled);
    const nextStep = apps === null ? null : shiftStep(slots, apps);
    // Antes de o turno começar não há presença para marcar: com vaga aberta, o principal é chamar.
    const step = nextStep?.kind === 'checkin' && state.needsPeople && !turnoIniciado
        ? { kind: 'call' as const, label: 'Chamar freelas' }
        : nextStep;
    const presenca = `/company/jobs/${id}/candidates`;
    const temGente = (filled ?? 0) > 0 || (apps ?? []).some((a) => a.status === 'invited');
    // Um só gesto de encerrar: turno com gente em equipe usa "Cancelar turno"; o resto, "Excluir".
    const usaCancelar = podeCancelarTurno && temGente;
    const encerrado = (job.status !== 'open' && job.status !== 'paused') || (filled !== null && filled >= slots && (apps ?? []).filter((a) => a.status === 'completed').length >= slots);

    return (
        <>
        <PageMeta
          title={job ? job.title : 'Detalhes do Turno'}
          description={job ? (job.description?.slice(0, 160) ?? undefined) : undefined}
        />
        {showCancelJob && id && (
            <CancelJobModal
                job={{ id, title: job.title }}
                role={isGestor(currentCompany) || currentCompany === null ? 'gestor' : 'encarregado'}
                onClose={() => setShowCancelJob(false)}
                onCancelled={(result) => {
                    setShowCancelJob(false);
                    if (result.outcome === 'cancelled' || result.outcome === 'already_cancelled') {
                        addToast('Turno cancelado.', 'success');
                        navigate('/company/jobs');
                    }
                }}
            />
        )}
        {showDeleteConfirm && (
            <Dialog
                labelledBy="excluir-turno-titulo"
                onClose={() => setShowDeleteConfirm(false)}
                className="max-w-sm"
            >
                    <DialogHeader titleId="excluir-turno-titulo" title={temGente ? 'Cancelar este turno?' : 'Excluir turno?'} subtitle={job.title} />
                    <p className="text-sm text-gray-600">
                        O turno sai da agenda. Convites e contratações dele são encerrados e quem já foi contratado é avisado. Não dá para desfazer.
                    </p>
                    <DialogActions>
                        <Button variant="secondary" data-autofocus onClick={() => setShowDeleteConfirm(false)}>Voltar</Button>
                        <Button variant="danger" data-copilot="empresa.turno.excluir-confirmar" data-copilot-risk="D" onClick={handleDelete}>{temGente ? 'Cancelar turno' : 'Excluir'}</Button>
                    </DialogActions>
            </Dialog>
        )}
        <div className="mx-auto max-w-4xl lg:max-w-5xl">
            {/* Barra superior: voltar + menu de ações do turno */}
            <div className="mb-4 flex items-center justify-between">
                <Button
                    variant="ghost"
                    onClick={() => navigate('/company/jobs')}
                    iconLeft={<ArrowLeft size={18} />}
                    className="-ml-3"
                >
                    Voltar
                </Button>

                <Menu
                    label="Mais opções do turno"
                    menuLabel="Ações do turno"
                    items={[
                        !encerrado && { label: 'Editar', icon: Edit2, onSelect: () => navigate(`/company/jobs/${id}/edit`) },
                        !encerrado && {
                            label: job.status === 'open' ? 'Pausar' : 'Reativar',
                            icon: job.status === 'open' ? PauseCircle : PlayCircle,
                            onSelect: () => handleStatusChange(job.status === 'open' ? 'paused' : 'open'),
                        },
                        usaCancelar
                            ? { label: 'Cancelar turno', icon: XCircle, danger: true, onSelect: () => setShowCancelJob(true) }
                            : { label: temGente ? 'Cancelar turno' : 'Excluir', icon: Trash2, danger: true, onSelect: () => setShowDeleteConfirm(true) },
                    ]}
                />
            </div>

            <Card padding="lg">
                {/* Cabeçalho do turno: o que decide (quando e onde) vem antes do resto. */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                        <div className="mb-3 flex flex-wrap gap-2">
                            <StatusBadge domain="job" status={job.status} />
                            {filled !== null && !encerrado && <StatusBadge tone={state.tone}>{state.label}</StatusBadge>}
                        </div>
                        <h1 className="mb-2 break-words text-2xl font-bold tracking-tight sm:text-3xl">{job.title}</h1>
                        <p className="flex items-center gap-1.5 text-base font-bold">
                            <Calendar size={16} aria-hidden="true" /> {shiftWhen(job.start_date, job.work_start_time, job.work_end_time)}
                            {job.has_lunch && <span className="text-sm font-normal text-gray-600">(1h de intervalo)</span>}
                        </p>
                        <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-600">
                            <MapPin size={16} aria-hidden="true" /> {job.location || 'Local a combinar'}
                        </p>
                    </div>
                    <div className="shrink-0 sm:text-right">
                        <span className="text-2xl font-bold tabular-nums">{formatBRL(job.budget)}</span>
                        <span className="ml-1 text-xs text-gray-600">{unidadePreco}</span>
                    </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-6 border-t-2 border-gray-100 pt-6 lg:grid-cols-3">
                    <aside className="h-fit rounded-xl border border-gray-200 bg-gray-50 p-2 lg:order-2">
                        {erroFreelas ? (
                            <ErrorState title="Não conseguimos conferir os freelas deste turno." onRetry={() => { void fetchApplications(); }} />
                        ) : filled === null ? (
                            <SkeletonList count={1} itemClassName="h-16" />
                        ) : (
                            <ListRow
                                leading={<Users size={20} aria-hidden="true" />}
                                title={`Freelas · ${filled} de ${slots} ${slots === 1 ? 'vaga' : 'vagas'}`}
                                meta={filled === 0 ? 'Ninguém neste turno ainda.' : 'Presença, pagamento e recibos'}
                                to={presenca}
                            />
                        )}
                    </aside>
                    <div className="space-y-6 lg:order-1 lg:col-span-2">
                        {job.description && (
                            <section>
                                <h2 className="mb-2 text-lg font-bold">Descrição</h2>
                                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700">{job.description}</p>
                            </section>
                        )}

                        {job.requirements && (
                            <section>
                                <h2 className="mb-2 text-lg font-bold">Requisitos</h2>
                                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700">{job.requirements}</p>
                            </section>
                        )}
                        <p className="text-xs text-gray-600">Criado {formatDistanceToNow(new Date(job.created_at), { addSuffix: true, locale: ptBR })}</p>
                    </div>
                </div>
            </Card>

            {/* A ação principal do turno segue o estado; chamar mantém o contexto DESTE turno. */}
            {step && (
                <ActionBar
                    primary={
                        step.kind === 'call' && !encerrado ? (
                            <Button
                                variant="dark"
                                size="lg"
                                iconLeft={<Megaphone size={18} />}
                                data-copilot="empresa.turno.chamar-freelas"
                                onClick={() => navigate(`${presenca}?chamar=1`)}
                            >
                                Chamar freelas
                            </Button>
                        ) : (
                            <ButtonLink variant="dark" size="lg" to={presenca} data-copilot="empresa.turno.abrir-presenca">
                                {step.kind === 'view' || step.kind === 'call' ? 'Presença e pagamento' : step.label}
                            </ButtonLink>
                        )
                    }
                />
            )}
        </div>
        </>
    );
}
