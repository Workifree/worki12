import { Search, Eye, Users, Edit2, Trash2, PauseCircle, PlayCircle, Megaphone, CalendarClock, ChevronDown, ChevronUp, Repeat, XCircle, Copy } from 'lucide-react';
import { useNavigate, useSearchParams, type NavigateFunction } from 'react-router-dom';
import { Fragment, useEffect, useState } from 'react';
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
import { Button, ButtonLink, DialogActions, DialogHeader, EmptyState, ErrorState, FilterChip, Menu, PageHeader, SkeletonList, StatusBadge, FIELD_CONTROL_CLASS } from '../../components/ui';
import CreateShiftLink from '../../components/company/CreateShiftLink';
import BatchList from '../../components/company/BatchList';
import BatchEntry from '../../components/company/BatchEntry';
import { batchLabels } from '../../components/company/batchGroups';
import { isLoteEnabled } from '../../lib/features';
import { isJobConcluded, isShiftInProgress } from '../../lib/shiftProgress';
import { Dialog } from '../../components/ui/Dialog';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { useLatestResponse } from '../../hooks/useLatestResponse';
import { useAnyDialogOpen } from '../../hooks/useModalDismiss';
import { companyShiftSources } from '../../lib/realtime/liveSources';

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
    /** Só vem (via `select('*')`) depois da migration do lote. */
    creation_batch_id?: string | null;
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

    const freelaState = job.freela
        ? job.freela.state === 'confirmed' ? (job.inProgress ? 'Em andamento' : 'Contratado') : job.freela.state === 'completed' ? 'Concluído' : 'Aguardando resposta'
        : null;

    return (
        <li className={`flex items-center gap-3 px-3 py-3 sm:px-4 ${ended ? 'opacity-80' : ''}`}>
            <div className="min-w-0 flex-1">
                <p className="line-clamp-2 break-words text-sm font-semibold">
                    {timeRange && <span className="tabular-nums">{timeRange} · </span>}
                    <span>{job.title}</span>
                </p>
                <p className="mt-0.5 truncate text-xs text-gray-600">
                    {[
                        job.start_date && !isNearTerm ? <span key="d" className="first-letter:uppercase">{formatDateOnly(job.start_date, "EEE, dd/MM")}</span> : null,
                        job.freela ? <span key="f" className="font-semibold text-gray-800">{job.freela.name}{job.freela.extraCount > 0 ? ` +${job.freela.extraCount}` : ''}</span> : null,
                        freelaState ? <span key="s">{freelaState}</span> : null,
                        job.location ? <span key="l">{job.location}</span> : null,
                    ].filter(Boolean).map((part, i) => (
                        <Fragment key={i}>{i > 0 && ' · '}{part}</Fragment>
                    ))}
                </p>
                {((job.status !== 'open' || job.concluded) || missingFreela || job.series_id) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
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
                )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
                {missingFreela ? (
                    <Button
                        variant={primary ? 'dark' : 'secondary'}
                        size="sm"
                        data-copilot="empresa.turnos.chamar-freelas"
                        iconLeft={<Megaphone size={16} />}
                        onClick={() => navigate(`${presenca}?chamar=1`)}
                    >
                        Chamar
                        <span className="sr-only"> freelas</span>
                    </Button>
                ) : job.freela?.state === 'confirmed' ? (
                    <ButtonLink variant="secondary" size="sm" to={presenca} data-copilot="empresa.turnos.marcar-presenca">
                        Presença
                    </ButtonLink>
                ) : (
                    <ButtonLink variant="ghost" size="sm" to={presenca} data-copilot="empresa.turnos.ver-turno">
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
        </li>
    );
}

// Cabeçalho recolhível ("Anteriores" e "Encerrados"): o mesmo desenho nos dois.
const COLLAPSE_HEAD =
    'flex min-h-11 w-full cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-1 text-sm font-semibold text-gray-600 ' +
    'hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black [&::-webkit-details-marker]:hidden';
const JOB_LIST = 'divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white';
const COUNT_PILL = 'rounded-pill bg-gray-200 px-2 py-0.5 text-xs font-semibold tabular-nums text-gray-700';

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
    const beginJobs = useLatestResponse();

    // Ações de série (F3, R11/R10) — cada uma abre seu próprio modal de confirmação.
    const [editSeriesJob, setEditSeriesJob] = useState<SeriesJobSnapshot | null>(null);
    const [cancelSeriesId, setCancelSeriesId] = useState<string | null>(null);
    const [inviteSeriesTarget, setInviteSeriesTarget] = useState<{ seriesId: string; targets: InviteSeriesTarget[] } | null>(null);


    useEffect(() => {
        fetchJobs();
    }, []);

    const dialogOpen = useAnyDialogOpen();
    useLiveRefresh({
        sources: currentCompany ? companyShiftSources(currentCompany.company_id) : [],
        onRefresh: () => fetchJobs({ silent: true }),
        paused: loading || dialogOpen || !!deleteJobId || !!editSeriesJob || !!cancelSeriesId || !!inviteSeriesTarget,
    });

    // Debounce search input
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        if (filter === 'closed') setPastExpanded(true);
    }, [filter]);

    // `silent` = recarga ao vivo: sem esqueleto e, se falhar, a lista fica como está.
    const fetchJobs = async ({ silent = false }: { silent?: boolean } = {}) => {
        const claim = beginJobs();
        try {
            const user = await getSessionUserOrThrow();
            if (!user) { if (!silent) navigate('/login'); return; }

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
            if (!silent) setErroCarga(false);
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
                    const { data: seriesRows, error: seriesError } = await supabase
                        .from('job_series')
                        .select('id, recurrence_type')
                        .in('id', seriesIds);
                    if (seriesError && silent) return;
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

                if (!claim()) return;
                setJobs(jobsWithFreela);
                setErroCarga(false);
            }
        } catch (error) {
            logError('Erro ao carregar vagas', error);
            if (!silent && claim()) setErroCarga(true);
        } finally {
            if (!silent) setLoading(false);
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
    const lotes = isLoteEnabled() ? batchLabels(jobs) : new Map<string, string>();

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
            <BatchEntry className="mb-4" />

            {/* Busca + filtros: uma linha de controles, o ativo em preto */}
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
                <div className="relative md:max-w-xs md:flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar turnos..."
                        aria-label="Buscar turnos"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className={`${FIELD_CONTROL_CLASS} !h-11 pl-10`}
                    />
                </div>
                <div className="worki-scroll-row -mx-4 flex gap-2 px-4 py-1 md:mx-0 md:px-0" role="group" aria-label="Filtrar turnos">
                    {FILTERS.map(({ key, label }) => (
                        <FilterChip key={key} pressed={filter === key} onClick={() => changeFilter(key)} >
                            {label}
                        </FilterChip>
                    ))}
                </div>
            </div>

            {/* Agenda por dia */}
            <div className="space-y-6">
                {loading ? (
                    <SkeletonList count={4} itemClassName="h-20" />
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
                                <Button
                                    variant="ghost"
                                    onClick={() => setPastExpanded(v => !v)}
                                    aria-expanded={pastExpanded}
                                    className={`${COLLAPSE_HEAD} mb-2 !px-1`}
                                >
                                    <span className="flex items-center gap-2">
                                        {bucket.label}
                                        <span className={COUNT_PILL}>{bucket.jobs.length}</span>
                                    </span>
                                    {pastExpanded ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
                                </Button>
                            ) : (
                                <div className="mb-2 flex items-center gap-2 px-1">
                                    <h2 className="text-base font-semibold">{bucket.label}</h2>
                                    <span className={COUNT_PILL}>{bucket.jobs.length}</span>
                                </div>
                            )}

                            {(bucket.key !== 'past' || pastExpanded) && (() => {
                                // "Anteriores" e o filtro de concluídos mostram tudo; nos outros dias os
                                // encerrados ficam recolhidos abaixo do que ainda pede atenção.
                                const showAll = bucket.key === 'past' || filter === 'closed';
                                const visible = showAll ? bucket.jobs : bucket.jobs.filter((j) => !isJobEnded(j)).sort((a, b) => dayRank(a) - dayRank(b));
                                const ended = showAll ? [] : bucket.jobs.filter(isJobEnded);
                                return (
                                    <div className="space-y-2">
                                        {visible.length > 0 && (
                                            <ul className={JOB_LIST}>
                                                <BatchList as="li" items={visible} batchOf={(job) => job.creation_batch_id} labels={lotes} render={(job) => renderRow(job, bucket.key)} />
                                            </ul>
                                        )}
                                        {ended.length > 0 && (
                                            <details className="group">
                                                <summary className={COLLAPSE_HEAD}>
                                                    <span className="flex items-center gap-2">
                                                        Encerrados
                                                        <span className={COUNT_PILL}>{ended.length}</span>
                                                    </span>
                                                    <ChevronDown size={18} aria-hidden="true" className="group-open:rotate-180" />
                                                </summary>
                                                <ul className={`${JOB_LIST} mt-2`}>{ended.map((job) => renderRow(job, bucket.key))}</ul>
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
