import { Search, Eye, Users, Edit2, Trash2, PauseCircle, PlayCircle, Megaphone, Clock, Calendar, CalendarClock, ChevronDown, ChevronUp, Repeat, XCircle, Copy } from 'lucide-react';
import { useNavigate, useSearchParams, type NavigateFunction } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import PageMeta from '../../components/PageMeta';
import { useToast } from '../../contexts/ToastContext';

import { logError } from '../../lib/logger'

import { useCurrentCompany } from '../../hooks/useCurrentCompany';
import { isGestor } from '../../services/companyScopeService';
import { getSessionUserOrThrow } from '../../lib/authSession';
import { getJobScope, canSeeJob, scopeResponsibleIds } from '../../services/jobScopeService';
import { fillMissingWorkers } from '../../services/workerCardsService';
import { deleteShift } from '../../services/deleteShiftService';
import { cancelJobMessage, deleteShiftToast } from '../../services/shiftOperationService';
import { groupJobsByDay, formatDateOnly, parseDateOnly, type DayBucketKey } from '../../lib/jobScheduling';
import { todayLocalDate } from '../../lib/dateUtils';
import EditSeriesModal, { type SeriesJobSnapshot } from '../../components/company/EditSeriesModal';
import CancelSeriesModal from '../../components/company/CancelSeriesModal';
import InviteSeriesModal, { type InviteSeriesTarget } from '../../components/company/InviteSeriesModal';
import type { RecurrenceType } from '../../types';
import { rotuloDeUmDia } from '../../lib/weekdayLabels';
import { Button, ButtonLink, Card, DialogActions, DialogHeader, EmptyState, ErrorState, FilterChip, Menu, PageHeader, SkeletonList, StatusBadge, FIELD_CONTROL_CLASS } from '../../components/ui';
import CreateShiftLink from '../../components/company/CreateShiftLink';
import { isJobConcluded, isShiftInProgress } from '../../lib/shiftProgress';
import { Dialog } from '../../components/ui/Dialog';

type JobFilter = 'all' | 'open' | 'closed' | 'andamento';
const FILTERS: Array<{ key: JobFilter; label: string }> = [
    { key: 'all', label: 'Todos' },
    { key: 'open', label: 'Abertos' },
    { key: 'andamento', label: 'Em andamento' },
    { key: 'closed', label: 'Concluídos' },
];


// Dom(0)..Sáb(6) — mesma convenção de `job_series.weekdays` (spec R1). Selo discreto na agenda
// ("Série · toda quinta") deriva o dia da própria `series_occurrence_date` da ocorrência — uma
// série pode marcar mais de um dia da semana, mas cada linha da agenda é sempre UM dia fixo.

// ---------------------------------------------------------------------------
// Modelo push (pivô "Meu Elenco"): a vaga não recebe candidatos/visitas — a
// empresa convida um freela do elenco. Derivamos o estado do freela por vaga a
// partir de `applications` (mesma lógica de expiração de CompanyJobCandidates).
// ---------------------------------------------------------------------------

type FreelaState = 'awaiting' | 'confirmed' | 'completed';

interface FreelaSummary {
    name: string;
    avatarUrl: string | null;
    state: FreelaState;
    extraCount: number;
}

interface AppRow {
    status: string;
    worker_checkin_at?: string | null;
    company_checkin_confirmed_at?: string | null;
    company_checkout_confirmed_at?: string | null;
    invitation_expires_at?: string | null;
    invitation_response?: string | null;
    worker?: { full_name?: string | null; avatar_url?: string | null } | null;
}

// Convite sem resposta cujo prazo venceu — o slot volta a ficar livre (deriva na leitura).
function isExpiredInvite(app: AppRow): boolean {
    const pastDeadline = !!app.invitation_expires_at && new Date(app.invitation_expires_at) < new Date();
    return (
        (app.status === 'invited' && pastDeadline) ||
        (app.status === 'declined' && !app.invitation_response && pastDeadline)
    );
}

const INACTIVE_STATUSES = new Set(['declined', 'rejected', 'cancelled']);
const STATUS_RANK: Record<string, number> = { invited: 1, pending: 1, interview: 1, hired: 2, in_progress: 3, completed: 4 };

function stateForStatus(status: string): FreelaState {
    if (status === 'completed') return 'completed';
    if (status === 'hired' || status === 'in_progress') return 'confirmed';
    return 'awaiting';
}

// Resume o freela "principal" de uma vaga: ignora recusas/expirados e escolhe o de
// status mais avançado. `null` = vaga sem freela ativo (pode convidar).
function summarizeFreela(apps: AppRow[]): FreelaSummary | null {
    const active = apps.filter((a) => !INACTIVE_STATUSES.has(a.status) && !isExpiredInvite(a));
    if (active.length === 0) return null;
    const best = active.reduce((b, a) => ((STATUS_RANK[a.status] ?? 0) > (STATUS_RANK[b.status] ?? 0) ? a : b));
    return {
        name: best.worker?.full_name || 'Freela',
        avatarUrl: best.worker?.avatar_url ?? null,
        state: stateForStatus(best.status),
        extraCount: active.length - 1,
    };
}

interface PendingCallRow {
    jobId: string;
    workerId: string;
    row: AppRow;
}

type CallWorker = AppRow['worker'];

// Alvos sem resposta de chamados abertos e no prazo, na forma de um convite pendente. Falha de
// leitura LANÇA: sem ela, um turno com convite pendente apareceria como "Sem freela".
async function fetchPendingCallRows(jobIds: string[]): Promise<PendingCallRow[]> {
    if (jobIds.length === 0) return [];
    const { data, error } = await supabase
        .from('shift_calls')
        .select('job_id, expires_at, targets:shift_call_targets(worker_id, response, worker:workers(full_name, avatar_url))')
        .in('job_id', jobIds)
        .eq('status', 'open');
    if (error) throw error;
    const calls = (data ?? []) as unknown as {
        job_id: string;
        expires_at: string;
        targets: { worker_id: string; response: string | null; worker: CallWorker | CallWorker[] }[] | null;
    }[];
    const now = Date.now();
    return calls
        .filter((call) => !(new Date(call.expires_at).getTime() <= now))
        .flatMap((call) => (call.targets ?? [])
            .filter((target) => !target.response)
            .map((target) => ({
                jobId: call.job_id,
                workerId: target.worker_id,
                row: {
                    status: 'invited',
                    invitation_expires_at: call.expires_at,
                    worker: (Array.isArray(target.worker) ? target.worker[0] : target.worker) ?? null,
                },
            })));
}

// ---------------------------------------------------------------------------
// Agenda por dia — a pergunta nº1 da operação é "quem trabalha amanhã?". A lista
// deixa de ser ordenada por data de criação (organização de banco) e passa a ser
// agrupada por `start_date` (organização de operação): Hoje / Amanhã / Esta Semana
// / Depois / Sem Data, com "Anteriores" ao fim (nunca escondido, só recolhido).
// Lógica de agrupamento (`groupJobsByDay`) e formatação fuso-safe (`formatDateOnly`)
// vivem em `lib/jobScheduling.ts` — puras, testáveis sem montar a página.
// ---------------------------------------------------------------------------

interface Job {
    id: string;
    title: string;
    type: string;
    status: string;
    location?: string;
    created_at: string;
    start_date?: string | null;
    work_start_time?: string | null;
    work_end_time?: string | null;
    freela?: FreelaSummary | null;
    /** Alguém já chegou e a saída ainda não foi confirmada. */
    inProgress?: boolean;
    /** Há convite ou contratação: o gesto é "Cancelar turno", como em Hoje. */
    hasPeople?: boolean;
    /** `status` ainda 'open', mas todas as vagas já foram concluídas. */
    concluded?: boolean;
    // Escala Recorrente (F3) — presentes quando o turno é uma ocorrência de série.
    series_id?: string | null;
    series_occurrence_date?: string | null;
    seriesRecurrenceType?: RecurrenceType | null;
    category?: string;
    description?: string;
    requirements?: string;
    briefing?: string | null;
    slots?: number;
}

function formatTimeRange(job: Job): string | null {
    if (!job.work_start_time && !job.work_end_time) return null;
    const start = job.work_start_time?.slice(0, 5) || '--:--';
    const end = job.work_end_time?.slice(0, 5) || '--:--';
    return `${start}–${end}`;
}

// Selo discreto da agenda: "toda quinta" (semanal) ou "bloco de dias" (cobertura/férias).
function seriesBadgeLabel(job: Job): string {
    if (job.seriesRecurrenceType === 'daily') return 'bloco de dias';
    if (job.series_occurrence_date) {
        return rotuloDeUmDia(parseDateOnly(job.series_occurrence_date).getDay());
    }
    return 'recorrente';
}

// Ocorrências desta série ainda "livres" para o atalho "Convidar para a série" (R10): abertas,
// sem freela ativo, hoje ou no futuro. A checagem forte (sem chamado aberto/freela ativo) é
// feita pela RPC/policy no disparo por-ocorrência — este filtro é só a lista de candidatos.
// `occurrenceDate` viaja junto (não só o id) porque o InviteSeriesModal agrupa por semana
// corrida local para o aviso de risco de R10/A7.
function futureOpenSeriesTargets(jobs: Job[], seriesId: string): InviteSeriesTarget[] {
    const today = parseDateOnly(todayLocalDate());
    return jobs
        .filter((j) => j.series_id === seriesId && j.status === 'open' && !j.freela && j.start_date && parseDateOnly(j.start_date) >= today)
        .map((j) => ({ jobId: j.id, occurrenceDate: j.series_occurrence_date ?? j.start_date!.slice(0, 10) }));
}

interface JobRowProps {
    job: Job;
    bucketKey: DayBucketKey;
    navigate: NavigateFunction;
    /** Só uma linha da tela leva o botão primário. */
    primary: boolean;
    handleStatusChange: (id: string, status: string) => void;
    setDeleteJobId: (id: string | null) => void;
    onEditSeries: (job: Job) => void;
    onCancelSeries: (seriesId: string) => void;
    onInviteSeries: (seriesId: string) => void;
}

function isJobEnded(job: Job): boolean {
    return job.concluded === true || (job.status !== 'open' && job.status !== 'paused');
}

function needsPeople(job: Job): boolean {
    return !job.freela && !isJobEnded(job) && (job.status === 'open' || job.status === 'paused');
}

/** Ordem do dia: o que precisa de ação, depois os próximos (os encerrados vão à parte). */
function dayRank(job: Job): number {
    return needsPeople(job) || job.inProgress ? 0 : 1;
}

// Uma linha da agenda: horário + função + freela (nome/avatar/estado) visíveis sem clicar.
// Turno sem freela atrelado "grita" — buraco de escala é o problema nº1 da operação diária.
function JobRow({ job, bucketKey, navigate, primary, handleStatusChange, setDeleteJobId, onEditSeries, onCancelSeries, onInviteSeries }: JobRowProps) {
    const timeRange = formatTimeRange(job);
    const isNearTerm = bucketKey === 'today' || bucketKey === 'tomorrow';
    const ended = isJobEnded(job);
    const missingFreela = needsPeople(job);
    const urgentGap = missingFreela && isNearTerm;
    const gapLabel = urgentGap ? `Sem freela · ${bucketKey === 'today' ? 'hoje' : 'amanhã'}` : 'Sem freela';
    const presenca = `/company/jobs/${job.id}/candidates`;

    return (
        <Card padding="sm" className={ended ? 'opacity-80' : ''}>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] lg:items-center">

                <div className="min-w-0">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <h3 className="break-words text-base font-bold">{job.title}</h3>
                        {/* Turno aberto e o normal — so o desvio ganha selo. */}
                        {(job.status !== 'open' || job.concluded) && (
                            <StatusBadge domain="job" status={job.concluded ? 'completed' : job.status} />
                        )}
                        {missingFreela && <StatusBadge tone={urgentGap ? 'warning' : 'neutral'}>{gapLabel}</StatusBadge>}
                        {job.series_id && (
                            <StatusBadge tone="neutral" icon={Repeat} title="Este turno faz parte de uma série recorrente">
                                Série · {seriesBadgeLabel(job)}
                            </StatusBadge>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
                        {timeRange && (
                            <span className="flex items-center gap-1 font-bold tabular-nums text-black">
                                <Clock size={14} aria-hidden="true" /> {timeRange}
                            </span>
                        )}
                        {job.start_date && !isNearTerm && (
                            <span className="flex items-center gap-1 first-letter:uppercase">
                                <Calendar size={14} aria-hidden="true" /> {formatDateOnly(job.start_date, "EEE, dd/MM")}
                            </span>
                        )}
                        {job.location && <span className="min-w-0 truncate">{job.location}</span>}
                    </div>
                </div>

                {job.freela ? (
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-black bg-gray-100">
                            {job.freela.avatarUrl ? (
                                <img src={job.freela.avatarUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                                <div className="flex h-full w-full items-center justify-center bg-black text-sm font-bold text-white">
                                    {job.freela.name[0]?.toUpperCase()}
                                </div>
                            )}
                        </div>
                        <div className="flex min-w-0 flex-col">
                            <span className="truncate text-sm font-bold">
                                {job.freela.name}{job.freela.extraCount > 0 ? ` +${job.freela.extraCount}` : ''}
                            </span>
                            <span className="text-xs text-gray-600">
                                {job.freela.state === 'confirmed' ? (job.inProgress ? 'Em andamento' : 'Contratado') : job.freela.state === 'completed' ? 'Concluído' : 'Aguardando resposta'}
                            </span>
                        </div>
                    </div>
                ) : (
                    <span className="hidden lg:block" />
                )}

                <div className="flex items-center gap-2 lg:justify-end">
                    {missingFreela ? (
                        <Button
                            variant={primary ? 'dark' : 'secondary'}
                            className="flex-1 lg:flex-none"
                            data-copilot="empresa.turnos.chamar-freelas"
                            iconLeft={<Megaphone size={16} />}
                            onClick={() => navigate(`${presenca}?chamar=1`)}
                        >
                            Chamar freelas
                        </Button>
                    ) : job.freela?.state === 'confirmed' ? (
                        <ButtonLink variant="secondary" className="flex-1 lg:flex-none" to={presenca} data-copilot="empresa.turnos.marcar-presenca">
                            Marcar presença
                        </ButtonLink>
                    ) : (
                        <ButtonLink variant="secondary" className="flex-1 lg:flex-none" to={presenca} data-copilot="empresa.turnos.ver-turno">
                            Ver turno
                        </ButtonLink>
                    )}

                    <Menu
                        label="Mais opções do turno"
                        menuLabel="Ações do turno"
                        items={[
                            { label: 'Presença e pagamento', icon: Users, onSelect: () => navigate(presenca) },
                            { label: 'Ver detalhes', icon: Eye, onSelect: () => navigate(`/company/jobs/${job.id}`) },
                            // Repetir reaproveita o turno inteiro; a empresa só escolhe a data nova.
                            { label: 'Repetir turno', icon: Copy, onSelect: () => navigate(`/company/create?repetir=${job.id}`) },
                            !ended && { label: 'Editar', icon: Edit2, onSelect: () => navigate(`/company/jobs/${job.id}/edit`) },
                            !!job.series_id && { label: 'Convidar para a série', icon: Repeat, onSelect: () => onInviteSeries(job.series_id!) },
                            !!job.series_id && { label: 'Editar os futuros', icon: Edit2, onSelect: () => onEditSeries(job) },
                            !ended && {
                                label: job.status === 'open' ? 'Pausar' : 'Reativar',
                                icon: job.status === 'open' ? PauseCircle : PlayCircle,
                                onSelect: () => handleStatusChange(job.id, job.status === 'open' ? 'paused' : 'open'),
                            },
                            !!job.series_id && { label: 'Encerrar a série', icon: XCircle, danger: true, onSelect: () => onCancelSeries(job.series_id!) },
                            { label: job.hasPeople ? 'Cancelar turno' : 'Excluir', icon: Trash2, danger: true, onSelect: () => setDeleteJobId(job.id) },
                        ]}
                    />
                </div>

            </div>
        </Card>
    );
}

export default function CompanyJobs() {
    const navigate = useNavigate();

    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(true);
    const [erroCarga, setErroCarga] = useState(false);
    const currentCompany = useCurrentCompany();
    const [searchParams, setSearchParams] = useSearchParams();
    // Filtro inicial vem do deep-link (?filter=andamento vindo do dashboard, etc.).
    const initialFilter = (['all', 'open', 'closed', 'andamento'] as const).find(f => f === searchParams.get('filter')) ?? 'all';
    const [filter, setFilter] = useState<'all' | 'open' | 'closed' | 'andamento'>(initialFilter);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [deleteJobId, setDeleteJobId] = useState<string | null>(null);

    // "Anteriores" fica recolhido por padrão — passado não deve atrapalhar a leitura do dia
    // de operação. Abre automaticamente quando a empresa escolhe o filtro "Concluídos"
    // (é exatamente o que ela pediu pra ver) e continua alternável manualmente.
    const [pastExpanded, setPastExpanded] = useState(initialFilter === 'closed');
    const { addToast } = useToast();

    // Ações de série (F3, R11/R10) — cada uma abre seu próprio modal de confirmação.
    const [editSeriesJob, setEditSeriesJob] = useState<SeriesJobSnapshot | null>(null);
    const [cancelSeriesId, setCancelSeriesId] = useState<string | null>(null);
    const [inviteSeriesTarget, setInviteSeriesTarget] = useState<{ seriesId: string; targets: InviteSeriesTarget[] } | null>(null);


    useEffect(() => {
        fetchJobs();
    }, []);

    // Debounce search input
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        if (filter === 'closed') setPastExpanded(true);
    }, [filter]);

    const fetchJobs = async () => {
        try {
            const user = await getSessionUserOrThrow();
            if (!user) { navigate('/login'); return; }

            // Encarregado: só os turnos dele e os que cobre (R9).
            const scope = await getJobScope();
            let query = supabase
                .from('jobs')
                .select('*')
                .eq('company_id', scope.companyId)
                .neq('status', 'deleted'); // Filter out deleted jobs
            if (scope.restricted) query = query.in('responsible_id', scopeResponsibleIds(scope));
            const { data: allJobs, error: jobsError } = await query.order('created_at', { ascending: false });
            if (jobsError) throw jobsError;
            setErroCarga(false);
            const jobsData = allJobs ? allJobs.filter((job) => canSeeJob(scope, job)) : allJobs;

            if (jobsData) {
                // Batch fetch das candidaturas/convites (1 query) para derivar o estado do freela por vaga.
                const jobIds = jobsData.map(j => j.id);
                const { data: apps, error: appsError } = await supabase
                    .from('applications')
                    .select('job_id, worker_id, status, worker_checkin_at, company_checkin_confirmed_at, company_checkout_confirmed_at, invitation_expires_at, invitation_response, worker:workers(full_name, avatar_url)')
                    .in('job_id', jobIds);
                if (appsError) throw appsError;

                const byJob: Record<string, AppRow[]> = {};
                (await fillMissingWorkers(apps || [])).forEach((a) => {
                    // PostgREST tipa o embed `worker` como array (relação); normalizamos p/ objeto.
                    const w = Array.isArray(a.worker) ? a.worker[0] : a.worker;
                    (byJob[a.job_id] ||= []).push({
                        status: a.status,
                        worker_checkin_at: a.worker_checkin_at,
                        company_checkin_confirmed_at: a.company_checkin_confirmed_at,
                        company_checkout_confirmed_at: a.company_checkout_confirmed_at,
                        invitation_expires_at: a.invitation_expires_at,
                        invitation_response: a.invitation_response,
                        worker: w ?? null,
                    });
                });

                // Convite de hoje é um chamado (`shift_calls`): não existe `applications` até o aceite.
                // Sem esta leitura o turno com convite pendente aparecia como "Sem freela".
                const pendingRows = await fetchPendingCallRows(jobIds);
                const pendingCalls = (await fillMissingWorkers(
                    pendingRows.map((c) => ({ ...c, worker_id: c.workerId, worker: c.row.worker })),
                )).map((c) => ({ jobId: c.jobId, workerId: c.workerId, row: { ...c.row, worker: c.worker } }));
                const inApplications = new Set((apps || []).map(a => `${a.job_id}:${a.worker_id}`));
                pendingCalls.forEach(({ jobId, workerId, row }) => {
                    const key = `${jobId}:${workerId}`;
                    if (inApplications.has(key)) return;
                    inApplications.add(key);
                    (byJob[jobId] ||= []).push(row);
                });

                // Selo de série (F3): 1 query em lote para o tipo de recorrência das séries
                // presentes nesta página — não em N queries por linha.
                const seriesIds = Array.from(new Set(jobsData.map(j => j.series_id).filter((id): id is string => !!id)));
                let seriesTypeById: Record<string, RecurrenceType> = {};
                if (seriesIds.length > 0) {
                    const { data: seriesRows } = await supabase
                        .from('job_series')
                        .select('id, recurrence_type')
                        .in('id', seriesIds);
                    seriesTypeById = Object.fromEntries((seriesRows || []).map(s => [s.id, s.recurrence_type as RecurrenceType]));
                }

                const jobsWithFreela = jobsData.map(job => ({
                    ...job,
                    freela: summarizeFreela(byJob[job.id] || []),
                    inProgress: (byJob[job.id] || []).some(isShiftInProgress),
                    hasPeople: (byJob[job.id] || []).some((a) => ['invited', 'hired', 'in_progress', 'completed'].includes(a.status)),
                    concluded: job.status === 'open' && isJobConcluded(job.slots, byJob[job.id]),
                    seriesRecurrenceType: job.series_id ? (seriesTypeById[job.series_id] ?? null) : null,
                }));

                setJobs(jobsWithFreela);
            }
        } catch (error) {
            logError('Erro ao carregar vagas', error);
            setErroCarga(true);
        } finally {
            setLoading(false);
        }
    };

    const handleStatusChange = async (id: string, newStatus: string) => {
        // .select('id') obrigatório (patterns.md — DELETE/UPDATE sob RLS negado em silêncio):
        // RLS de `jobs` foi ligada nesta revisão — um UPDATE negado devolve 204 sem erro.
        const { data, error } = await supabase.from('jobs').update({ status: newStatus }).eq('id', id).select('id');
        if (error) {
            logError('CompanyJobs.handleStatusChange', error);
            addToast('Não foi possível atualizar o turno. Tente novamente.', 'error');
            return;
        }
        if (!data || data.length === 0) {
            addToast('Não foi possível atualizar o turno: verifique se você ainda tem permissão sobre ele.', 'error');
            return;
        }
        fetchJobs();
    };

    const handleDelete = async (jobId: string) => {
        // `cancel_job` encerra convites, candidaturas e chamados junto com o turno.
        const result = await deleteShift(jobId);
        if (result.outcome === 'cancelled' || result.outcome === 'already_cancelled') {
            addToast(deleteShiftToast(result), 'success');
            fetchJobs();
        } else {
            addToast(cancelJobMessage(result, isGestor(currentCompany) ? 'gestor' : 'encarregado'), 'error');
        }
        setDeleteJobId(null);
    };


    // Ações de série (F3) — cada uma abre o modal correspondente; a lista completa dos
    // campos vem do próprio job já carregado (a query já usa `select('*')`, sem round-trip extra).
    const openEditSeries = (job: Job) => {
        if (!job.series_id) return;
        setEditSeriesJob({
            id: job.id,
            series_id: job.series_id,
            title: job.title,
            category: job.category ?? '',
            description: job.description ?? '',
            requirements: job.requirements ?? '',
            briefing: job.briefing ?? null,
            location: job.location ?? null,
            work_start_time: job.work_start_time ?? null,
            work_end_time: job.work_end_time ?? null,
            slots: job.slots ?? 1,
        });
    };

    const openInviteSeries = (seriesId: string) => {
        const targets = futureOpenSeriesTargets(jobs, seriesId);
        if (targets.length === 0) {
            addToast('Todas as ocorrências futuras desta série já têm freela.', 'info');
            return;
        }
        setInviteSeriesTarget({ seriesId, targets });
    };

    // Muda o filtro e reflete no URL (mantém deep-link/back consistentes).
    const changeFilter = (next: 'all' | 'open' | 'closed' | 'andamento') => {
        setFilter(next);
        setSearchParams(next === 'all' ? {} : { filter: next }, { replace: true });
    };

    const filteredJobs = jobs.filter(job => {
        const matchesSearch = job.title.toLowerCase().includes(debouncedSearch.toLowerCase());
        const matchesFilter =
            filter === 'all' ? true
                : filter === 'open' ? job.status === 'open' && !job.concluded
                    : filter === 'andamento' ? job.inProgress === true // contratado sozinho não é "em andamento"
                        : job.status !== 'open' || job.concluded === true;
        return matchesSearch && matchesFilter;
    });

    // Agrupamento por dia — reordenação/reagrupamento sobre os mesmos dados já carregados,
    // aplicado depois de busca/filtro (as seções nunca ficam fora de sincronia com eles).
    const dayBuckets = groupJobsByDay(filteredJobs);

    // Uma ação primária na tela: o primeiro turno (fora de "Anteriores") que precisa de gente.
    const primaryJobId = dayBuckets.filter((b) => b.key !== 'past').flatMap((b) => b.jobs).find(needsPeople)?.id;
    const deleteTarget = jobs.find((j) => j.id === deleteJobId);

    const renderRow = (job: Job, bucketKey: DayBucketKey) => (
        <JobRow
            key={job.id}
            job={job}
            bucketKey={bucketKey}
            navigate={navigate}
            primary={job.id === primaryJobId}
            handleStatusChange={handleStatusChange}
            setDeleteJobId={setDeleteJobId}
            onEditSeries={openEditSeries}
            onCancelSeries={setCancelSeriesId}
            onInviteSeries={openInviteSeries}
        />
    );

    return (
        <>
        <PageMeta title="Turnos" />
        {deleteJobId && (
            <Dialog
                labelledBy="excluir-turno-titulo"
                onClose={() => setDeleteJobId(null)}
                className="max-w-sm"
            >
                    <DialogHeader titleId="excluir-turno-titulo" title={deleteTarget?.hasPeople ? 'Cancelar este turno?' : 'Excluir turno?'} subtitle={deleteTarget?.title} />
                    <p className="text-sm text-gray-600">
                        O turno sai da agenda. Convites e contratações dele são encerrados e quem já foi contratado é avisado. Não dá para desfazer.
                    </p>
                    <DialogActions>
                        <Button variant="secondary" data-autofocus onClick={() => setDeleteJobId(null)}>Voltar</Button>
                        <Button variant="danger" data-copilot="empresa.turnos.excluir-confirmar" data-copilot-risk="D" onClick={() => handleDelete(deleteJobId)}>{deleteTarget?.hasPeople ? 'Cancelar turno' : 'Excluir'}</Button>
                    </DialogActions>
            </Dialog>
        )}
        <div className="pb-4">
            <PageHeader
                title="Turnos"
                subtitle="Sua agenda, dia a dia."
                action={<CreateShiftLink />}
                inlineAction
            />

            {/* Busca + filtros: uma linha de controles, o ativo em preto */}
            <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center">
                <div className="relative md:max-w-xs md:flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar turnos..."
                        aria-label="Buscar turnos"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className={`${FIELD_CONTROL_CLASS} pl-10`}
                    />
                </div>
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1" role="group" aria-label="Filtrar turnos">
                    {FILTERS.map(({ key, label }) => (
                        <FilterChip key={key} pressed={filter === key} onClick={() => changeFilter(key)} className="!px-3">
                            {label}
                        </FilterChip>
                    ))}
                </div>
            </div>

            {/* Agenda por dia */}
            <div className="space-y-8">
                {loading ? (
                    <SkeletonList count={4} itemClassName="h-28" />
                ) : erroCarga && jobs.length === 0 ? (
                    <ErrorState title="Não conseguimos carregar seus turnos." onRetry={() => { setErroCarga(false); setLoading(true); void fetchJobs(); }} />
                ) : filteredJobs.length === 0 ? (
                    jobs.length === 0 ? (
                        <EmptyState
                            size="page"
                            icon={CalendarClock}
                            title="Você ainda não tem turnos."
                            description="Crie o primeiro turno e chame quem está no seu elenco."
                            action={<Button variant="dark" data-copilot="empresa.turnos.criar-turno" onClick={() => navigate('/company/create')}>Criar turno</Button>}
                        />
                    ) : (
                        <EmptyState
                            icon={CalendarClock}
                            title={search ? 'Nenhum turno com essa busca.' : filter === 'andamento' ? 'Nenhum turno em andamento agora.' : filter === 'open' ? 'Nenhum turno aberto agora.' : 'Nenhum turno concluído ainda.'}
                            action={
                                <>
                                    <Button variant="secondary" onClick={() => { setSearch(''); changeFilter('all'); }}>Ver todos</Button>
                                    <Button variant="dark" onClick={() => navigate('/company/create')}>Criar turno</Button>
                                </>
                            }
                        />
                    )
                ) : (
                    dayBuckets.map((bucket) => (
                        <div key={bucket.key}>
                            {bucket.key === 'past' ? (
                                <button
                                    onClick={() => setPastExpanded(v => !v)}
                                    aria-expanded={pastExpanded}
                                    className="-mx-4 mb-3 flex min-h-11 w-full items-center justify-between gap-2 border-b-2 border-black/10 bg-canvas/95 px-4 py-2 backdrop-blur-sm md:mx-0 md:px-0"
                                >
                                    <span className="flex items-center gap-2 text-sm font-bold text-gray-600">
                                        {bucket.label}
                                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700">{bucket.jobs.length}</span>
                                    </span>
                                    {pastExpanded ? <ChevronUp size={18} className="text-gray-600" /> : <ChevronDown size={18} className="text-gray-600" />}
                                </button>
                            ) : (
                                <div className="-mx-4 mb-3 flex items-center gap-2 border-b-2 border-black/10 bg-canvas/95 px-4 py-2 backdrop-blur-sm md:mx-0 md:px-0">
                                    <h2 className="text-sm font-bold text-gray-600">{bucket.label}</h2>
                                    <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700">{bucket.jobs.length}</span>
                                </div>
                            )}

                            {(bucket.key !== 'past' || pastExpanded) && (() => {
                                // "Anteriores" e o filtro de concluídos mostram tudo; nos outros dias os
                                // encerrados ficam recolhidos abaixo do que ainda pede atenção.
                                const showAll = bucket.key === 'past' || filter === 'closed';
                                const visible = showAll ? bucket.jobs : bucket.jobs.filter((j) => !isJobEnded(j)).sort((a, b) => dayRank(a) - dayRank(b));
                                const ended = showAll ? [] : bucket.jobs.filter(isJobEnded);
                                return (
                                    <div className="space-y-3">
                                        {visible.map((job) => renderRow(job, bucket.key))}
                                        {ended.length > 0 && (
                                            <details className="group">
                                                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold text-gray-600">
                                                    Encerrados ({ended.length})
                                                </summary>
                                                <div className="mt-2 space-y-3">{ended.map((job) => renderRow(job, bucket.key))}</div>
                                            </details>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                    ))
                )}
            </div>
        </div>


        {/* Escala Recorrente (F3) — ações de série (R10/R11) */}
        {editSeriesJob && (
            <EditSeriesModal
                job={editSeriesJob}
                onClose={() => setEditSeriesJob(null)}
                onApplied={fetchJobs}
            />
        )}
        {cancelSeriesId && (
            <CancelSeriesModal
                seriesId={cancelSeriesId}
                onClose={() => setCancelSeriesId(null)}
                onCancelled={fetchJobs}
            />
        )}
        {inviteSeriesTarget && (
            <InviteSeriesModal
                targets={inviteSeriesTarget.targets}
                onClose={() => setInviteSeriesTarget(null)}
                onDone={fetchJobs}
            />
        )}
        </>
    );
}
