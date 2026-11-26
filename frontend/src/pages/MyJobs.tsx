
import { useEffect, useState, useCallback, useRef } from 'react';
import LocalDoTurno from '../components/LocalDoTurno';
import { supabase } from '../lib/supabase';
import { checkSession } from '../lib/authSession';
import type { ReactNode } from 'react';
import { CheckCircle2, Clock, XCircle, DollarSign, Star, AlertCircle, Bell, Building2, X, LogIn, LogOut, MessageCircle, Users, ThumbsUp, ThumbsDown, CalendarClock, Receipt, ChevronRight, History } from 'lucide-react';
import { Alert, Button, Card, DialogActions, EmptyState, IconButton, Menu, PageHeader, SkeletonList, StatusBadge, Tabs } from '../components/ui';
import PageMeta from '../components/PageMeta';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import RateModal from '../components/RateModal';
import { useToast } from '../contexts/ToastContext';
import { logError } from '../lib/logger';
import { formatBRL } from '../lib/currency';
import ErroDeCarga from '../components/ErroDeCarga';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { useLatestResponse } from '../hooks/useLatestResponse';
import { workerShiftSources } from '../lib/realtime/liveSources';
import { useWorkerInvites, EVENTO_CONVITES, type ConvitesMudaramDetail } from '../hooks/useShiftInvites';
import { AttendanceConfirmationService } from '../services/attendanceConfirmationService';
import { hasArrived, hasLeftShift } from '../lib/shiftPresence';
import TodayShiftCard, { type TodayShift } from '../components/TodayShiftCard';
import { isAvisosEnabled, isPresencaEnabled } from '../lib/features';
import PedidoDeAvisos from '../components/avisos/PedidoDeAvisos';
import { attendanceGuardMessage, checkinWindow, isTodayShift } from '../lib/checkinWindow';
import { openShiftConversation } from '../lib/shiftChat';
import type {
    ReviewDirection,
    ShiftAttendanceConfirmation,
    AttendanceConfirmationResponse,
    AttendanceConfirmationOutcome,
} from '../types';
import { Dialog } from '../components/ui/Dialog';

const RATE_PROMPTED_KEY = 'worki_rate_prompted';
function readRatePrompted(): boolean {
    try {
        return sessionStorage.getItem(RATE_PROMPTED_KEY) === '1';
    } catch {
        return false;
    }
}
function markRatePrompted(): void {
    try {
        sessionStorage.setItem(RATE_PROMPTED_KEY, '1');
    } catch {
        // sem storage vale só a trava por visita (ref)
    }
}

// Confirmação de véspera (D-1) — mensagens humanas por outcome da RPC `respond_attendance_confirmation`.
// 'confirmed'/'cannot_attend'/'already_responded'/'unauthenticated' têm tratamento dedicado no handler;
// aqui só os outcomes de negação/erro que viram texto de toast direto.
const CONFIRMATION_RESPONSE_MESSAGES: Partial<Record<AttendanceConfirmationOutcome, string>> = {
    not_target: 'Você não tem permissão para responder este pedido.',
    forbidden: 'Você não tem permissão para responder este pedido.',
    invalid_status: 'Este turno não está mais disponível para confirmação.',
    invalid_response: 'Resposta inválida. Tente novamente.',
    not_requested: 'Este pedido de confirmação não está mais disponível.',
    not_found: 'Não foi possível localizar este pedido.',
};

type Step = { label: string; status: 'complete' | 'active' | 'pending' }

// Exportado para teste direto da lógica pura (evita duplicar/driftar como aconteceu em
// CompanyJobCandidates → JobLifecycleStepper.test.tsx). A empresa pode registrar chegada/saída
// unilateralmente (freela não mexeu no app) — por isso "feito" considera os DOIS lados, nunca
// só `worker_*`, senão o freela vê um CTA ativo (e um stepper contraditório) para uma etapa que
// a empresa já fechou.
// eslint-disable-next-line react-refresh/only-export-components -- função pura reaproveitada pelo teste (evita novo arquivo fora do escopo desta mudança)
export function computeWorkerSteps(job: JobApplication): Step[] {
    const checkinDone = !!(job.worker_checkin_at || job.company_checkin_confirmed_at);
    const checkoutDone = !!(job.worker_checkout_at || job.company_checkout_confirmed_at);
    const companyConfirmed = !!job.company_checkout_confirmed_at;

    return [
        {
            label: checkinDone ? 'Chegada registrada' : 'Registrar chegada',
            status: checkinDone ? 'complete' : 'active'
        },
        {
            label: checkoutDone ? 'Saída registrada' : 'Registrar saída',
            status: checkoutDone
                ? 'complete'
                : checkinDone && !checkoutDone
                    ? 'active'
                    : 'pending'
        },
        {
            label: companyConfirmed
                ? 'Empresa confirmou'
                : checkoutDone ? 'Aguardando empresa' : 'Confirmação da empresa',
            status: companyConfirmed
                ? 'complete'
                : checkoutDone && !companyConfirmed
                    ? 'active'
                    : 'pending'
        }
    ];
}

export interface JobApplication {
    id: string;
    job_id: string;
    status: string;
    title: string;
    company_id: string;
    company_name: string;
    company_logo: string | null;
    /** null = valor não informado (nunca vira R$ 0,00). */
    pay: number | null;
    date: string;
    raw_date: string | null;
    time: string;
    end_time: string | null;
    location: string;
    month: string;
    day: number | string;
    worker_checkin_at: string | null;
    worker_checkout_at: string | null;
    company_checkin_confirmed_at: string | null;
    company_checkout_confirmed_at: string | null;
    created_at?: string;
    presence_mode?: string | null;
}

type ActiveTab = 'invites' | 'in_progress' | 'scheduled' | 'history';

/** Selo do Histórico para turno com saída registrada que a empresa ainda não fechou. */
function awaitingLabel(job: JobApplication): string | null {
    if (job.status !== 'hired' && job.status !== 'in_progress') return null;
    return job.company_checkout_confirmed_at ? 'Saída confirmada' : 'Aguardando confirmação';
}


// Rotulo de "quando" para o card de confirmacao de vespera.
// O texto era chumbado em "amanha", mas `request_attendance_confirmation` aceita turno de ate
// 7 dias — e um pedido feito com 5 dias de antecedencia dizia ao freela que o turno era amanha.
// Devolve o mesmo vocabulario da notificacao ("Confirma seu turno de 28/08?"), para os dois
// canais nao se contradizerem.
function rotuloDeQuando(rawDate: string | null): string {
    if (!rawDate) return 'do próximo turno';
    const d = new Date(rawDate);
    if (Number.isNaN(d.getTime())) return 'do próximo turno';
    const soData = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dias = Math.round((soData(d) - soData(new Date())) / 86400000);
    if (dias === 0) return 'de hoje';
    if (dias === 1) return 'de amanhã';
    return `de ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
}

// Formata timestamp ISO para HH:mm (pt-BR); '—' quando ausente.
function fmtTime(iso: string | null): string {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '—';
    }
}

// ---------------------------------------------------------------------------
// Peças visuais e ordenação locais (só desta tela).
// ---------------------------------------------------------------------------

type ChipTone = 'neutral' | 'brand' | 'info';

const CHIP_TONES: Record<ChipTone, string> = {
    neutral: 'bg-gray-100 text-gray-700',
    brand: 'bg-primary-light text-primary-dark',
    info: 'bg-blue-50 text-blue-700',
};

function Chip({ tone = 'neutral', children }: { tone?: ChipTone; children: ReactNode }) {
    return (
        <span className={`inline-flex max-w-full items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl [overflow-wrap:anywhere] ${CHIP_TONES[tone]}`}>
            {children}
        </span>
    );
}

function payLabel(pay: number | null): string {
    return pay ? formatBRL(pay) : 'Valor não informado';
}

/** Data e hora do turno, comparáveis como texto. Sem data vai para o fim. */
function shiftKey(job: JobApplication, missing: string): string {
    return `${job.raw_date?.slice(0, 10) ?? missing} ${job.time}`;
}

const byShiftDate = (a: JobApplication, b: JobApplication) => shiftKey(a, '9999').localeCompare(shiftKey(b, '9999'));
const byShiftDateDesc = (a: JobApplication, b: JobApplication) => shiftKey(b, '0000').localeCompare(shiftKey(a, '0000'));

function weekdayDate(job: JobApplication): string {
    if (!job.raw_date) return job.date;
    const parsed = new Date(job.raw_date.length === 10 ? `${job.raw_date}T12:00:00` : job.raw_date);
    const weekday = parsed.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    return `${weekday} ${job.date.slice(0, 5)}`;
}

function scheduleOf(job: JobApplication) {
    return { startDate: job.raw_date, startTime: job.time, endTime: job.end_time };
}

function toTodayShift(job: JobApplication): TodayShift {
    return {
        applicationId: job.id,
        status: job.status,
        title: job.title,
        companyName: job.company_name,
        startDate: job.raw_date,
        startTime: /^\d/.test(job.time) ? job.time : null,
        endTime: job.end_time,
        location: job.location,
        pay: job.pay,
        worker_checkin_at: job.worker_checkin_at,
        worker_checkout_at: job.worker_checkout_at,
        company_checkin_confirmed_at: job.company_checkin_confirmed_at,
        company_checkout_confirmed_at: job.company_checkout_confirmed_at,
        presenceMode: job.presence_mode,
    };
}

function isTodayJob(job: JobApplication): boolean {
    return isTodayShift({ ...job, ...scheduleOf(job) });
}

function HistoryStatus({ job }: { job: JobApplication }) {
    const waiting = awaitingLabel(job);
    return waiting
        ? <StatusBadge tone="warning" icon={Clock}>{waiting}</StatusBadge>
        : <StatusBadge domain="application" status={job.status} />;
}

export default function MyJobs() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    // Erro de carga ≠ lista vazia: fetch falho caia no "Nenhum turno" (empty state que mente).
    const [erroCarga, setErroCarga] = useState(false);
    // Recusa e irreversivel ('declined') e o botao fica colado no Aceitar num layout touch —
    // primeiro toque ARMA, segundo confirma; desarma em 4s (N5, prevencao sem modal).
    const [recusaArmada, setRecusaArmada] = useState<string | null>(null);
    const recusaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const armarOuRecusar = (inviteId: string, executar: () => void) => {
        if (recusaArmada === inviteId) {
            if (recusaTimerRef.current) clearTimeout(recusaTimerRef.current);
            setRecusaArmada(null);
            executar();
            return;
        }
        setRecusaArmada(inviteId);
        if (recusaTimerRef.current) clearTimeout(recusaTimerRef.current);
        recusaTimerRef.current = setTimeout(() => setRecusaArmada(null), 4000);
    };
    // Sem escolha da pessoa, abre a primeira aba que tem o que fazer (ver `activeTab`).
    const [chosenTab, setActiveTab] = useState<ActiveTab | null>(null);
    const [jobs, setJobs] = useState<{
        in_progress: JobApplication[],
        scheduled: JobApplication[],
        history: JobApplication[]
    }>({ in_progress: [], scheduled: [], history: [] });

    // Rating State
    const [rateModalOpen, setRateModalOpen] = useState(false);
    const [selectedJobToRate, setSelectedJobToRate] = useState<JobApplication | null>(null);
    const [reviewedJobIds, setReviewedJobIds] = useState<Set<string>>(new Set());
    // Detalhe do turno no histórico (chegada/saída, valor, avaliação, foto).
    const [detailJob, setDetailJob] = useState<JobApplication | null>(null);
    // Confirmação de cancelamento de turno agendado (aba "Agendados").
    const [cancelJob, setCancelJob] = useState<JobApplication | null>(null);
    const [cancelLoading, setCancelLoading] = useState(false);
    // "Falar com a empresa" — o gesto simétrico do freela (empresa já tinha o ícone de chat
    // na tela de presença). id da application sendo processada (loading do botão).
    const [chattingId, setChattingId] = useState<string | null>(null);
    // Pedido de avaliação: abre sozinho 1x por sessão para o 1º turno pago sem avaliação.
    const autoRatePrompted = useRef(false);
    const { addToast } = useToast();

    // Hook de convites push
    const {
        pendingInvites,
        loading: invitesLoading,
        error: invitesError,
        refresh: refreshInvites,
        respondingId,
        respond,
    } = useWorkerInvites();

    // Confirmação de véspera (D-1) — pedidos pendentes (`response IS NULL`) endereçados a este
    // freela. Fetch independente do `fetchJobs` (mesmo padrão de `useWorkerInvites`): a tela não
    // precisa esperar o histórico completo carregar para mostrar o card de confirmação.
    const [pendingConfirmations, setPendingConfirmations] = useState<ShiftAttendanceConfirmation[]>([]);
    const [confirmationsLoading, setConfirmationsLoading] = useState(true);
    const [erroConfirmacoes, setErroConfirmacoes] = useState(false);
    const [respondingConfirmationId, setRespondingConfirmationId] = useState<string | null>(null);
    const answeredRef = useRef(new Set<string>());
    const [busyCards, setBusyCards] = useState(0);
    const trackBusyCard = useCallback((busy: boolean) => setBusyCards((n) => n + (busy ? 1 : -1)), []);
    // R7/A3/A4 (requisito duro, não superado pelo ddl-aprovado.md): depois de responder, o card
    // NÃO some — troca os botões por um badge ("Confirmado"/"Avisou que não vai"), pra o freela
    // conseguir conferir "será que eu respondi?" sem precisar lembrar. `getMyPendingConfirmations`
    // só devolve `response IS NULL` (não existe leitor de "já respondidos" neste território — o
    // service é território de outro agente), então este mapa é a fonte da verdade da UI depois do
    // clique: mantemos a linha original em `pendingConfirmations` (nunca removida) e sobrepomos
    // aqui o resultado real. Efeito colateral aceito conscientemente: o badge é POR SESSÃO —
    // sobrevive a troca de aba/navegação dentro do mesmo carregamento da página, mas um F5 real
    // (remonta o componente, refaz `getMyPendingConfirmations`) não traz de volta uma confirmação
    // já respondida, porque ela deixou de ser "pendente" no servidor. R7 pede a transição visível
    // pós-clique (que isto cobre); não pede histórico permanente entre recarregamentos.
    const [respondedConfirmations, setRespondedConfirmations] = useState<
        Record<string, AttendanceConfirmationResponse | 'already_responded'>
    >({});

    const [userId, setUserId] = useState<string | null>(null);
    const beginJobs = useLatestResponse();
    const beginConfirmations = useLatestResponse();

    // `silent` = recarga ao vivo: sem esqueleto e, se falhar, a tela fica como está.
    const fetchJobs = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
        const claim = beginJobs();
        const session = await checkSession();
        if (session.status === 'signed_out') return silent ? undefined : navigate('/login');
        if (session.status === 'unavailable') {
            logError('MyJobs.fetchJobs.session', session.error);
            if (silent) return;
            setErroCarga(true);
            setLoading(false);
            return;
        }
        const user = session.user;
        setUserId(user.id);

        // Fetch my reviews to know what I've rated
        const { data: myReviews, error: reviewsError } = await supabase
            .from('reviews')
            .select('job_id')
            .eq('reviewer_id', user.id);
        // Sem saber o que já foi avaliado, a tela ofereceria (e abriria sozinha) avaliação repetida.
        if (reviewsError) {
            logError('MyJobs.fetchJobs.reviews', reviewsError);
            if (silent) return;
            setErroCarga(true);
            setLoading(false);
            return;
        }

        const reviewedSet = new Set(myReviews?.map(r => r.job_id) || []);

        const { data, error } = await supabase
            .from('applications')
            .select(`
                id,
                status,
                created_at,
                worker_checkin_at,
                worker_checkout_at,
                company_checkin_confirmed_at,
                company_checkout_confirmed_at,
                job:jobs (
                    ${isPresencaEnabled() ? 'presence_mode,' : ''}
                    id,
                    title,
                    budget,
                    start_date,
                    work_start_time,
                    work_end_time,
                    location,
                    company:companies (
                        id,
                        name,
                        logo_url
                    )
                )
            `)
            .eq('worker_id', user.id)
            // Excluir convites pending — eles ficam na aba Convites via hook
            .not('status', 'eq', 'invited')
            .order('created_at', { ascending: false });

        if (error) {
            logError('Error fetching applications:', error);
            if (silent) return;
            setErroCarga(true);
        } else {
            if (!claim()) return;
            setReviewedJobIds(reviewedSet);
            setErroCarga(false);
            const in_progress: JobApplication[] = [];
            const scheduled: JobApplication[] = [];
            const history: JobApplication[] = [];
            const awaiting: JobApplication[] = [];

            interface ApplicationRow {
                id: string;
                status: string;
                created_at: string;
                worker_checkin_at: string | null;
                worker_checkout_at: string | null;
                company_checkin_confirmed_at: string | null;
                company_checkout_confirmed_at: string | null;
                job: {
                    id: string;
                    title: string;
                    budget: number;
                    start_date: string | null;
                    work_start_time: string | null;
                    work_end_time: string | null;
                    location: string | null;
                    presence_mode?: string | null;
                    company: {
                        id: string;
                        name: string;
                        logo_url: string | null;
                    } | null;
                } | null;
            }

            (data as unknown as ApplicationRow[] || []).forEach((app) => {
                if (!app.job) return;

                const application: JobApplication = {
                    id: app.id,
                    job_id: app.job.id,
                    status: app.status,
                    title: app.job.title,
                    company_id: app.job.company?.id || '',
                    company_name: app.job.company?.name || 'Empresa',
                    company_logo: app.job.company?.logo_url ?? null,
                    pay: app.job.budget > 0 ? app.job.budget : null,
                    date: app.job.start_date ? new Date(app.job.start_date).toLocaleDateString('pt-BR') : 'Data a definir',
                    raw_date: app.job.start_date ?? null,
                    time: app.job.work_start_time || 'Horário a definir',
                    end_time: app.job.work_end_time || null,
                    location: app.job.location || 'Local a definir',
                    month: app.job.start_date ? new Date(app.job.start_date).toLocaleString('pt-BR', { month: 'short' }).toUpperCase().replace('.', '') : 'MES',
                    day: app.job.start_date ? new Date(app.job.start_date).getDate() : '00',
                    worker_checkin_at: app.worker_checkin_at,
                    worker_checkout_at: app.worker_checkout_at,
                    company_checkin_confirmed_at: app.company_checkin_confirmed_at,
                    company_checkout_confirmed_at: app.company_checkout_confirmed_at,
                    created_at: app.created_at,
                    presence_mode: app.job.presence_mode
                };

                // "Em andamento" = em curso, ou contratado com a chegada liberada agora.
                const isInProgress = app.status === 'in_progress'
                    || (app.status === 'hired'
                        && (hasArrived(application) || checkinWindow(scheduleOf(application)).state === 'open'));

                // Saída já registrada: o turno acabou para o freela, mesmo antes de a empresa
                // fechar. Vai para o Histórico como "aguardando", nunca para "Em Andamento".
                if ((app.status === 'hired' || app.status === 'in_progress') && hasLeftShift(application)) {
                    awaiting.push(application);
                } else if (isInProgress) {
                    in_progress.push(application);
                } else if (app.status === 'hired') {
                    scheduled.push(application);
                } else if (['completed', 'rejected', 'cancelled', 'declined'].includes(app.status)) {
                    history.push(application);
                }
            });

            // Quem ainda espera a empresa vem primeiro.
            in_progress.sort(byShiftDate);
            scheduled.sort(byShiftDate);
            history.sort(byShiftDateDesc);
            awaiting.sort(byShiftDateDesc);
            setJobs({ in_progress, scheduled, history: [...awaiting, ...history] });
            setLoading(false);
            return { in_progress, scheduled };
        }
        setLoading(false);
    }, [navigate, beginJobs]);

    useEffect(() => {
        fetchJobs();
    }, [fetchJobs]);

    // Convite respondido (pelo aviso em tela cheia ou pela aba): os turnos mudaram. Sem reler, o
    // turno aceito não aparecia em aba nenhuma até recarregar a página.
    useEffect(() => {
        const aoMudarConvites = (e: Event) => {
            const jobAceito = (e as CustomEvent<ConvitesMudaramDetail>).detail?.jobAceito;
            void (async () => {
                const listas = await fetchJobs();
                if (!jobAceito || !listas) return;
                if (listas.in_progress.some((j) => j.job_id === jobAceito)) setActiveTab('in_progress');
                else if (listas.scheduled.some((j) => j.job_id === jobAceito)) setActiveTab('scheduled');
            })();
        };
        window.addEventListener(EVENTO_CONVITES, aoMudarConvites);
        return () => window.removeEventListener(EVENTO_CONVITES, aoMudarConvites);
    }, [fetchJobs]);

    const fetchConfirmations = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
        const claim = beginConfirmations();
        try {
            const rows = await AttendanceConfirmationService.getMyPendingConfirmationsChecked();
            if (!claim()) return;
            // O cartão já respondido nesta sessão continua na tela (some do servidor como pendente).
            setPendingConfirmations((prev) => [
                ...rows,
                ...prev.filter((p) => answeredRef.current.has(p.id) && !rows.some((r) => r.id === p.id)),
            ]);
            setErroConfirmacoes(false);
        } catch (err) {
            logError('MyJobs.fetchConfirmations', err);
            if (!silent && claim()) setErroConfirmacoes(true);
        } finally {
            setConfirmationsLoading(false);
        }
    }, [beginConfirmations]);

    useEffect(() => {
        fetchConfirmations();
    }, [fetchConfirmations]);

    // Resposta em UM toque, direto no clique — sem modal, sem navegação (R7/A3/A4). O card
    // continua na tela: `respondedConfirmations` sobrepõe o botão por um badge (ver comentário
    // do state acima) — troca de VISUAL, não desaparecimento.
    const handleRespondConfirmation = async (
        confirmation: ShiftAttendanceConfirmation,
        response: AttendanceConfirmationResponse,
    ) => {
        setRespondingConfirmationId(confirmation.id);
        try {
            const result = await AttendanceConfirmationService.respondConfirmation(confirmation.application_id, response);

            if (result.outcome === 'confirmed' || result.outcome === 'cannot_attend') {
                // Captura o valor JÁ NARROWED antes da closure do setState: `result.outcome`
                // dentro de `(prev) => ({...})` perde a narrowing do `if` (TS não propaga
                // narrowing de propriedade para dentro de funções aninhadas) e volta a ser o
                // union inteiro de AttendanceConfirmationOutcome — variável local resolve.
                const confirmedOutcome = result.outcome;
                addToast(
                    response === 'confirmed'
                        ? 'Presença confirmada! Bom turno.'
                        : 'Empresa avisada que você não vai poder ir.',
                    'success',
                );
                answeredRef.current.add(confirmation.id);
                setRespondedConfirmations((prev) => ({ ...prev, [confirmation.id]: confirmedOutcome }));
                return;
            }
            // already_responded não é erro — é informação: duplo toque/retry não deve assustar
            // o freela com um toast vermelho. Não sabemos qual foi a resposta REAL já gravada
            // (a RPC não devolve isso em já_respondido) — badge neutro, não um confirmed/cannot_attend
            // de palpite.
            if (result.outcome === 'already_responded') {
                addToast('Você já respondeu a este pedido.', 'info');
                answeredRef.current.add(confirmation.id);
                setRespondedConfirmations((prev) => ({ ...prev, [confirmation.id]: 'already_responded' }));
                return;
            }
            if (result.outcome === 'unauthenticated') {
                navigate('/login');
                return;
            }
            addToast(
                CONFIRMATION_RESPONSE_MESSAGES[result.outcome] ?? result.error ?? 'Não foi possível registrar sua resposta.',
                'error',
            );
        } catch (err) {
            logError('MyJobs.handleRespondConfirmation', err);
            addToast('Erro ao registrar resposta. Tente novamente.', 'error');
        } finally {
            setRespondingConfirmationId(null);
        }
    };

    // Pedido de avaliação pós-pagamento: assim que o turno é concluído/pago pela
    // empresa, ele cai no histórico. Se houver um turno pago ainda sem avaliação,
    // abrimos o modal (1x por sessão, dispensável). Convite pendente tem prazo: vem antes.
    useEffect(() => {
        if (autoRatePrompted.current || loading || invitesLoading || pendingInvites.length > 0) return;
        if (readRatePrompted()) return;
        const pending = jobs.history.find(j => j.status === 'completed' && !reviewedJobIds.has(j.job_id));
        if (pending) {
            autoRatePrompted.current = true;
            markRatePrompted();
            setSelectedJobToRate(pending);
            setRateModalOpen(true);
        }
    }, [jobs.history, reviewedJobIds, loading, invitesLoading, pendingInvites.length]);

    // Cancelamento de turno agendado ('hired') pelo freela. A empresa é avisada
    // automaticamente via trigger no banco (trg_notify_company_on_worker_cancel), mas o
    // trigger só dispara se a linha realmente mudou. Sob RLS um UPDATE que não casa com o
    // USING retorna 0 linhas sem erro (PostgREST 204) — sem `.select()` a UI mentiria "a
    // empresa foi avisada" quando ninguém foi avisado (padrão obrigatório, patterns.md).
    const handleCancelShift = async () => {
        if (!cancelJob) return;
        setCancelLoading(true);
        try {
            const { data, error } = await supabase
                .from('applications')
                .update({ status: 'cancelled' })
                .eq('id', cancelJob.id)
                .select('id');

            if (error) throw error;

            if (!data || data.length === 0) {
                addToast('Não foi possível cancelar este turno. Atualize a página e tente novamente.', 'error');
                return;
            }

            setCancelJob(null);
            addToast('Turno cancelado. A empresa foi avisada.', 'success');
            await fetchJobs();
        } catch (err) {
            logError('Error cancelling shift:', err);
            addToast(attendanceGuardMessage(err) ?? 'Erro ao cancelar turno. Tente novamente.', 'error');
        } finally {
            setCancelLoading(false);
        }
    };

    // Gesto simétrico ao handleChat da empresa (CompanyJobCandidates): procura Conversation
    // por application_uuid (job.id AQUI é o id da application, não da vaga), cria se não existir.
    // Sem isso o freela não tem como puxar conversa se a empresa nunca abriu o chat do turno.
    const handleChat = async (job: JobApplication) => {
        setChattingId(job.id);
        try {
            navigate(`/messages?conversation=${await openShiftConversation(job.id)}`);
        } catch (err) {
            logError('MyJobs: handleChat', err);
            addToast('Erro ao iniciar conversa.', 'error');
        } finally {
            setChattingId(null);
        }
    };

    const handleOpenRateModal = (job: JobApplication) => {
        setSelectedJobToRate(job);
        setRateModalOpen(true);
    };

    // Fix R10: direction explícito ('company' quando worker avalia empresa)
    const handleSubmitRate = async (rating: number, comment: string) => {
        if (!selectedJobToRate) return;

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            // Sem company_id não há quem avaliar (evita review órfã apontando p/ '').
            if (!selectedJobToRate.company_id) {
                addToast('Não foi possível identificar a empresa deste turno.', 'error');
                return;
            }

            const direction: ReviewDirection = 'company';

            // created_at é obrigatório na tabela reviews (sem default) — o insert da empresa
            // (CompanyJobCandidates) já enviava; o do freela não, e por isso falhava silenciosamente.
            const { error } = await supabase.from('reviews').insert({
                job_id: selectedJobToRate.job_id,
                reviewer_id: user.id,
                reviewed_id: selectedJobToRate.company_id, // empresa sendo avaliada
                direction,
                rating,
                comment,
                created_at: new Date().toISOString()
            });

            if (error) throw error;

            setReviewedJobIds(prev => new Set(prev).add(selectedJobToRate.job_id));
            addToast('Avaliação enviada com sucesso!', 'success');
        } catch (error) {
            logError('Error submitting review:', error);
            addToast('Erro ao enviar avaliação.', 'error');
            throw error;
        }
    };

    // Turnos de hoje ficam no topo, com as ações; não se repetem nas abas.
    const todayJobs = [...jobs.in_progress, ...jobs.scheduled].filter(isTodayJob).sort(byShiftDate);
    const todayIds = new Set(todayJobs.map((j) => j.id));
    const inProgressList = jobs.in_progress.filter((j) => !todayIds.has(j.id));
    const scheduledList = jobs.scheduled.filter((j) => !todayIds.has(j.id));

    const activeTab: ActiveTab = chosenTab ?? (
        inProgressList.length > 0 ? 'in_progress'
            : invitesLoading || invitesError || pendingInvites.length > 0 ? 'invites'
                : scheduledList.length > 0 ? 'scheduled'
                    : jobs.history.length > 0 ? 'history'
                        : 'invites'
    );

    useLiveRefresh({
        sources: userId ? workerShiftSources(userId) : [],
        onRefresh: () => {
            // A aba que a pessoa está vendo não muda sozinha porque chegou dado novo.
            setActiveTab((prev) => prev ?? activeTab);
            return Promise.all([
                fetchJobs({ silent: true }),
                fetchConfirmations({ silent: true }),
                refreshInvites?.({ silent: true }),
            ]);
        },
        paused: loading || invitesLoading || rateModalOpen || !!cancelJob || cancelLoading || !!detailJob
            || !!respondingConfirmationId || !!respondingId || !!chattingId || busyCards > 0,
    });

    if (erroCarga && !loading) return (
        <div className="pb-24 max-w-4xl mx-auto pt-6">
            <ErroDeCarga onRetry={() => { setLoading(true); fetchJobs(); void refreshInvites?.(); fetchConfirmations(); }} />
        </div>
    );

    if (loading) return (
        <div className="flex flex-col gap-6 max-w-4xl mx-auto">
            <SkeletonList count={4} itemClassName="h-28" />
        </div>
    );

    const abrirConvites = () => {
        setActiveTab('invites');
        document.getElementById('meus-turnos-painel')?.scrollIntoView?.({ block: 'start' });
    };

    const tabs: { id: ActiveTab; label: string; count: number }[] = [
        { id: 'invites', label: 'Convites', count: pendingInvites.length },
        { id: 'in_progress', label: 'Em andamento', count: inProgressList.length },
        { id: 'scheduled', label: 'Agendados', count: scheduledList.length },
        { id: 'history', label: 'Histórico', count: jobs.history.length },
    ];

    return (
        <div className="flex flex-col gap-6 pb-12 font-sans text-accent max-w-4xl mx-auto">
            <PageMeta title="Meus Turnos" description="Acompanhe seus convites, turnos agendados e histórico na Worki." />

            <PageHeader title="Meus Turnos" className="mb-0" />

            {/* Permissão de aviso só é oferecida quando há o que avisar. */}
            {isAvisosEnabled() && pendingInvites.length > 0 && <PedidoDeAvisos />}

            {/* Convite disputado tem prazo: com cartões acima das abas, ele ficaria fora da dobra. */}
            {pendingInvites.some((i) => i.disputed) && (todayJobs.length > 0 || pendingConfirmations.length > 0) && (
                <div className="flex items-center gap-3 rounded-2xl border border-status-warning-line bg-status-warning-bg px-4 py-2">
                    <p className="min-w-0 flex-1 text-sm text-status-warning-fg">
                        <span className="font-semibold">Convite esperando resposta.</span>{' '}
                        Quem aceitar primeiro fica com a vaga.
                    </p>
                    <Button variant="secondary" size="sm" className="shrink-0" onClick={abrirConvites}>Ver convite</Button>
                </div>
            )}

            {todayJobs.length > 0 && (
                <section aria-label="Hoje" className="grid grid-cols-1 gap-3">
                    {todayJobs.map((job) => (
                        <TodayShiftCard
                            key={job.id}
                            heading="Hoje"
                            onBusyChange={trackBusyCard}
                            shift={toTodayShift(job)}
                            steps={hasArrived(job) ? computeWorkerSteps(job) : undefined}
                            onChanged={fetchJobs}
                            onCheckedOut={() => setActiveTab('history')}
                            onCancel={() => setCancelJob(job)}
                        />
                    ))}
                </section>
            )}

            {/* Confirmação de véspera (D-1) — card destacado, resposta em UM toque, sempre visível
                no topo (fora das abas): o turno é amanhã, não pode depender do freela estar na aba certa.
                Cruza `pendingConfirmations` (application_id) com os turnos já carregados (`in_progress`/
                `scheduled`) para exibir empresa/data/horário/local sem uma query extra. */}
            {!confirmationsLoading && pendingConfirmations.length > 0 && (
                <div className="flex flex-col gap-3">
                    {pendingConfirmations.map((confirmation) => {
                        const job = [...jobs.in_progress, ...jobs.scheduled].find(
                            (j) => j.id === confirmation.application_id,
                        );
                        if (!job) return null;
                        const isResponding = respondingConfirmationId === confirmation.id;
                        // R7/A3/A4: depois de responder, os botões viram um badge — o card não some
                        // (ver comentário de `respondedConfirmations` acima).
                        const localResponse = respondedConfirmations[confirmation.id];

                        return (
                            <div
                                key={confirmation.id}
                                className="flex flex-col gap-2 rounded-2xl border border-primary/40 bg-primary-light p-3"
                            >
                                <div className="min-w-0">
                                    <p className="flex items-center gap-1.5 text-sm font-semibold text-primary-ink">
                                        <CalendarClock size={16} aria-hidden="true" className="shrink-0" />
                                        Confirma seu turno {rotuloDeQuando(job.raw_date)}?
                                    </p>
                                    <h3 className="text-sm font-bold truncate">{job.title}</h3>
                                    <p className="text-xs text-gray-700 truncate">
                                        {job.company_name} · {job.date}{job.time ? ` · ${job.time}${job.end_time ? `–${job.end_time}` : ''}` : ''}
                                    </p>
                                </div>
                                {localResponse === 'confirmed' ? (
                                    <span className="flex items-center justify-center gap-2 w-full min-h-11 bg-white text-primary-ink rounded-xl font-semibold text-sm">
                                        <ThumbsUp size={16} aria-hidden="true" /> Confirmado
                                    </span>
                                ) : localResponse === 'cannot_attend' ? (
                                    <span className="flex items-center justify-center gap-2 w-full min-h-11 bg-red-50 text-red-700 border border-red-200 rounded-xl font-semibold text-sm">
                                        <ThumbsDown size={16} aria-hidden="true" /> Avisou que não vai
                                    </span>
                                ) : localResponse === 'already_responded' ? (
                                    <span className="flex items-center justify-center gap-2 w-full min-h-11 bg-white text-gray-600 rounded-xl font-semibold text-sm">
                                        Você já respondeu
                                    </span>
                                ) : (
                                    // Lado a lado até 320px, sem ícone: os dois rótulos cabem em uma linha.
                                    <div className="grid grid-cols-2 gap-2">
                                        <Button
                                            // Um primário por dobra: com turno hoje, o botão cheio é o de presença.
                                            variant={todayJobs.length > 0 ? 'secondary' : 'primary'}
                                            size="sm"
                                            className="!px-2 whitespace-nowrap"
                                            onClick={() => void handleRespondConfirmation(confirmation, 'confirmed')}
                                            disabled={isResponding}
                                            loading={isResponding}
                                        >
                                            Sim, vou
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            className="!px-2 whitespace-nowrap"
                                            onClick={() => void handleRespondConfirmation(confirmation, 'cannot_attend')}
                                            disabled={isResponding}
                                            loading={isResponding}
                                        >
                                            Não vou poder
                                        </Button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {erroConfirmacoes && (
                <ErroDeCarga onRetry={() => { void fetchConfirmations(); }} mensagem="Não foi possível verificar pedidos de confirmação de presença." />
            )}

            <Tabs
                label="Seções dos seus turnos"
                tabs={tabs}
                value={activeTab}
                onChange={(id) => {
                    setActiveTab(id);
                    // Com os cartões do topo, o conteúdo da aba pode estar abaixo da dobra.
                    requestAnimationFrame(() => document.getElementById('meus-turnos-painel')?.scrollIntoView?.({ block: 'nearest' }));
                }}
                panelId="meus-turnos-painel"
            />

            {/* Content */}
            <div
                id="meus-turnos-painel"
                role="tabpanel"
                aria-label={tabs.find((t) => t.id === activeTab)?.label}
                // `grid-cols-1` = minmax(0,1fr): sem isso a coluna cresce até o maior título (`truncate`
                // não quebra linha) e o card do Histórico sai da tela a 320px.
                className="grid grid-cols-1 gap-4"
            >

                {/* ── ABA CONVITES ── */}
                {activeTab === 'invites' && (
                    <>
                        {invitesLoading && (
                            <div className="space-y-4 animate-pulse" role="status"><span className="sr-only">Carregando</span>
                                {[...Array(2)].map((_, i) => (
                                    <div key={i} className="h-32 bg-gray-200 rounded-2xl" />
                                ))}
                            </div>
                        )}

                        {!invitesLoading && invitesError && <ErroDeCarga onRetry={refreshInvites} />}

                        {!invitesLoading && !invitesError && pendingInvites.length === 0 && (
                            <EmptyState
                                icon={Bell}
                                title="Nenhum convite pendente."
                                description="Quando uma empresa te convidar para um turno, aparecerá aqui."
                            />
                        )}

                        {!invitesLoading && pendingInvites.map((invite) => {
                            const job = invite.job;
                            const companyInfo = job?.company;
                            const companyName = companyInfo?.name ?? 'Empresa';
                            const companyLogo = companyInfo?.logo_url ?? null;
                            const companyId = companyInfo?.id;
                            const jobTitle = job?.title ?? 'Turno';
                            const budget = job?.budget && job.budget > 0 ? job.budget : null;
                            const isSos = invite.origin === 'sos';
                            const startDate = job?.start_date
                                ? new Date(job.start_date).toLocaleDateString('pt-BR')
                                : 'Data a definir';
                            const startTime = job?.work_start_time ?? '';
                            const endTime = job?.work_end_time ?? '';
                            const location = job?.location ?? 'Local a definir';
                            const isResponding = respondingId === invite.id;
                            // Spans (não divs): o mesmo conteúdo vai dentro de <button> quando a empresa tem perfil.
                            const cabecalhoEmpresa = (
                                <>
                                    <span className="block w-10 h-10 rounded-xl border border-gray-200 overflow-hidden bg-gray-100 flex-shrink-0">
                                        {companyLogo ? (
                                            <img src={companyLogo} alt={companyName} className="w-full h-full object-cover" />
                                        ) : (
                                            <span className="w-full h-full flex items-center justify-center">
                                                <Building2 size={20} className="text-gray-400" />
                                            </span>
                                        )}
                                    </span>
                                    <span className="block min-w-0 flex-1">
                                        <span className="block text-xs text-gray-600">Convite de</span>
                                        {/* sem `block`: ele anularia o display do line-clamp */}
                                        <span className={`font-bold line-clamp-2 [overflow-wrap:anywhere] ${companyId ? 'group-hover:text-primary transition-colors' : ''}`}>{companyName}</span>
                                    </span>
                                </>
                            );

                            return (
                                <Card key={invite.id} className={isSos ? 'border-status-warning-line' : undefined}>
                                    {isSos && (
                                        <Alert tone="warning" title="Urgência (SOS)" className="mb-4">
                                            Você não está no elenco desta empresa. Recebeu porque ativou os chamados de urgência.
                                        </Alert>
                                    )}
                                    {/* Empresa */}
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-4">
                                        {companyId ? (
                                            <button
                                                type="button"
                                                onClick={() => navigate(`/empresa/${companyId}`)}
                                                className="group flex items-center gap-3 flex-1 basis-48 min-w-0 min-h-11 text-left cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
                                            >
                                                {cabecalhoEmpresa}
                                            </button>
                                        ) : (
                                            <div className="flex items-center gap-3 flex-1 basis-48 min-w-0">
                                                {cabecalhoEmpresa}
                                            </div>
                                        )}
                                        {/* Corrida explícita: o freela precisa saber que a vaga é disputada ANTES
                                            de decidir. Esconder isso seria deixá-lo achar que tem o tempo todo do
                                            mundo e perder a vaga sem entender por quê. */}
                                        {invite.disputed ? (
                                            <span className="bg-yellow-100 text-yellow-800 text-xs font-semibold px-2.5 py-1 rounded-pill border border-yellow-300 flex-shrink-0">
                                                Quem aceitar primeiro
                                            </span>
                                        ) : (
                                            <span className="bg-primary-light text-primary-dark text-xs font-semibold px-2.5 py-1 rounded-pill border border-green-200 flex-shrink-0">
                                                Novo convite
                                            </span>
                                        )}
                                    </div>

                                    {/* Detalhes do turno */}
                                    <h3 className="font-bold text-lg mb-3">{jobTitle}</h3>
                                    <div className="flex flex-wrap gap-2 mb-4">
                                        <Chip>
                                            <Clock size={14} /> {startDate}{startTime ? ` · ${startTime}${endTime ? `–${endTime}` : ''}` : ''}
                                        </Chip>
                                        <Chip tone="brand">
                                            <DollarSign size={14} /> {payLabel(budget)}
                                        </Chip>
                                        {location && (
                                            <Chip tone="info">
                                                <LocalDoTurno location={location} />
                                            </Chip>
                                        )}
                                    </div>

                                    {/* Briefing */}
                                    {(job?.briefing || job?.description) && (
                                        <div className="bg-gray-50 rounded-xl p-3 mb-4">
                                            <p className="text-xs font-semibold text-gray-600 mb-1">Briefing</p>
                                            <p className="text-sm text-gray-700 line-clamp-3">{job.briefing || job.description}</p>
                                        </div>
                                    )}

                                    {/* Disputa + expiração */}
                                    {invite.disputed && (
                                        <p className="text-xs font-semibold text-yellow-700 mb-2 flex items-center gap-1">
                                            <Users size={12} />
                                            {invite.targetsCount === 1 ? 'Você foi o único chamado' : `${invite.targetsCount} freelas receberam este turno`}
                                            {invite.slots > 1 ? ` · ${invite.slots} vagas` : ' · 1 vaga'}
                                        </p>
                                    )}
                                    {invite.expiresAt && (
                                        <p className="text-xs font-semibold text-yellow-700 mb-4 flex items-center gap-1">
                                            <Clock size={12} />
                                            Expira {formatDistanceToNow(new Date(invite.expiresAt), { addSuffix: true, locale: ptBR })}
                                        </p>
                                    )}

                                    {/* Ações — Aceitar é a ação primária; Recusar é secundária (e arma antes de confirmar) */}
                                    <div className="flex flex-col gap-3 min-[360px]:flex-row">
                                        <Button
                                            variant="primary"
                                            size="lg"
                                            className="flex-1 min-w-0 !px-2 sm:!px-6"
                                            data-copilot="freela.convite.aceitar"
                                            data-copilot-risk="D"
                                            onClick={() => respond(invite.id, 'accepted')}
                                            disabled={isResponding}
                                            loading={isResponding}
                                            iconLeft={<CheckCircle2 size={18} />}
                                        >
                                            Aceitar
                                        </Button>
                                        <Button
                                            variant={recusaArmada === invite.id ? 'danger' : 'secondary'}
                                            size="lg"
                                            className="flex-1 min-w-0 !px-2 sm:!px-6"
                                            data-copilot="freela.convite.recusar"
                                            data-copilot-risk="D"
                                            onClick={() => armarOuRecusar(invite.id, () => respond(invite.id, 'declined'))}
                                            disabled={isResponding}
                                            iconLeft={<XCircle size={18} />}
                                        >
                                            {recusaArmada === invite.id ? 'Confirmar recusa' : 'Recusar'}
                                        </Button>
                                    </div>
                                    <p className="text-xs text-gray-600 text-center mt-3">
                                        Recusar não afeta sua reputação.
                                    </p>
                                </Card>
                            );
                        })}
                    </>
                )}

                {/* ── ABA EM ANDAMENTO ── */}
                {activeTab === 'in_progress' && inProgressList.length === 0 && (
                    <EmptyState
                        icon={AlertCircle}
                        title="Nenhum trabalho em andamento."
                        description={todayJobs.length > 0
                            ? 'O turno de hoje está no cartão no topo da tela.'
                            : 'A chegada é liberada 2h antes do início do turno.'}
                        action={scheduledList.length > 0
                            ? <Button variant="secondary" onClick={() => setActiveTab('scheduled')}>Ver agendados</Button>
                            : undefined}
                    />
                )}
                {activeTab === 'in_progress' && inProgressList.map((job) => (
                    <TodayShiftCard
                        key={job.id}
                        heading={job.date}
                        shift={toTodayShift(job)}
                        onChanged={fetchJobs}
                        onCheckedOut={() => setActiveTab('history')}
                    />
                ))}

                {/* ── ABA AGENDADOS ── */}
                {activeTab === 'scheduled' && scheduledList.length === 0 && (
                    <EmptyState
                        icon={CalendarClock}
                        title="Nenhum turno agendado no momento."
                        description={todayJobs.length > 0 ? 'O turno de hoje está no cartão no topo da tela.' : undefined}
                    />
                )}
                {activeTab === 'scheduled' && scheduledList.length > 0 && (
                    <ul className="divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white">
                        {scheduledList.map((job) => (
                            <li key={job.id} className="flex items-center gap-2 py-3 pl-4 pr-2">
                                <div className="min-w-0 flex-1">
                                    <p className="flex min-w-0 items-baseline gap-2">
                                        <span className="shrink-0 text-sm font-bold tabular-nums">
                                            {weekdayDate(job)} · {job.time}{job.end_time ? `–${job.end_time}` : ''}
                                        </span>
                                    </p>
                                    <h3 className="text-sm font-semibold truncate" title={job.title}>{job.title}</h3>
                                    <p className="text-xs text-gray-600 truncate">
                                        <span className="font-semibold text-primary-ink tabular-nums">{payLabel(job.pay)}</span>
                                        {' · '}<span>{job.company_name}</span>{job.location ? ` · ${job.location}` : ''}
                                    </p>
                                </div>
                                <IconButton
                                    aria-label="Falar com a empresa"
                                    data-copilot="freela.turno.falar-empresa"
                                    onClick={() => handleChat(job)}
                                    disabled={chattingId === job.id}
                                >
                                    <MessageCircle size={20} />
                                </IconButton>
                                <Menu
                                    label={`Mais opções do turno ${job.title}`}
                                    items={[{
                                        label: 'Cancelar turno',
                                        icon: XCircle,
                                        danger: true,
                                        onSelect: () => setCancelJob(job),
                                        'data-copilot': 'freela.turnos.cancelar',
                                        'data-copilot-risk': 'D',
                                    }]}
                                />
                            </li>
                        ))}
                    </ul>
                )}

                {/* ── ABA HISTÓRICO ── */}
                {activeTab === 'history' && jobs.history.length === 0 && (
                    <EmptyState icon={History} title="Seu histórico está vazio." />
                )}
                {activeTab === 'history' && jobs.history.length > 0 && (
                    <ul className="divide-y divide-gray-200 overflow-hidden rounded-2xl border border-gray-200 bg-white">
                        {jobs.history.map((job) => {
                            const waiting = awaitingLabel(job);
                            const dropped = !waiting && job.status !== 'completed';
                            const avaliar = job.status === 'completed' && !reviewedJobIds.has(job.job_id);
                            return (
                                <li key={job.id}>
                                    <button
                                        type="button"
                                        onClick={() => setDetailJob(job)}
                                        className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black"
                                    >
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-semibold text-gray-900 truncate" title={job.title}>{job.title}</span>
                                            <span className="block text-xs text-gray-600 truncate">{job.date} · {job.company_name}</span>
                                            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                                                <HistoryStatus job={job} />
                                                <span className={`text-sm font-bold tabular-nums ${dropped ? 'text-gray-600 line-through' : 'text-gray-900'}`}>
                                                    {payLabel(job.pay)}
                                                </span>
                                            </span>
                                        </span>
                                        <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-gray-400" />
                                    </button>
                                    {/* Uma ação visível por linha; as demais estão no detalhe. */}
                                    {waiting ? (
                                        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3">
                                            <p className="text-xs text-gray-600">Falta a empresa fechar o turno.</p>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => void handleChat(job)}
                                                loading={chattingId === job.id}
                                                iconLeft={<MessageCircle size={14} />}
                                            >
                                                Falar com a empresa
                                            </Button>
                                        </div>
                                    ) : job.status === 'completed' && (
                                        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                                            {avaliar ? (
                                                <Button variant="secondary" size="sm" onClick={() => handleOpenRateModal(job)} iconLeft={<Star size={14} />}>
                                                    Avaliar
                                                </Button>
                                            ) : (
                                                <>
                                                    <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(`/recibo/${job.job_id}`)} iconLeft={<Receipt size={14} />}>
                                                        Recibo
                                                    </Button>
                                                    <span className="text-xs text-gray-600 flex items-center gap-1">
                                                        <Star size={12} fill="currentColor" aria-hidden="true" /> Avaliado
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>


            <RateModal
                isOpen={rateModalOpen}
                onClose={() => setRateModalOpen(false)}
                onSubmit={handleSubmitRate}
                targetName={selectedJobToRate?.company_name || 'Empresa'}
                targetPhotoUrl={selectedJobToRate?.company_logo ?? undefined}
                title="Avaliar Empresa"
                subtitle={selectedJobToRate?.title}
            />

            {/* Detalhe do turno no histórico */}
            {detailJob && (
                <Dialog
                    labelledBy="detalhe-turno-titulo"
                    onClose={() => setDetailJob(null)}
                    initialFocus="panel"
                >
                        <div className="flex items-start justify-between gap-3 mb-5">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-12 h-12 rounded-xl border border-gray-200 overflow-hidden bg-gray-100 flex-shrink-0">
                                    {detailJob.company_logo ? (
                                        <img src={detailJob.company_logo} alt={detailJob.company_name} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-black text-white"><Building2 size={22} /></div>
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <h3 id="detalhe-turno-titulo" className="text-lg font-bold tracking-tight truncate">{detailJob.title}</h3>
                                    <p className="text-sm text-gray-600 truncate">{detailJob.company_name}</p>
                                </div>
                            </div>
                            <IconButton aria-label="Fechar" onClick={() => setDetailJob(null)} className="flex-shrink-0">
                                <X size={20} />
                            </IconButton>
                        </div>

                        {/* Status */}
                        <div className="mb-5">
                            <HistoryStatus job={detailJob} />
                        </div>

                        {/* Grid de infos */}
                        <div className="grid grid-cols-2 gap-3 mb-5">
                            <div className="bg-gray-50 rounded-xl p-3">
                                <p className="text-xs text-gray-600 mb-1">Data</p>
                                <p className="font-semibold text-sm">{detailJob.date}</p>
                            </div>
                            <div className="bg-gray-50 rounded-xl p-3">
                                <p className="text-xs text-gray-600 mb-1">Valor</p>
                                <p className="font-bold text-sm tabular-nums text-primary-dark">{payLabel(detailJob.pay)}</p>
                            </div>
                            <div className="bg-gray-50 rounded-xl p-3">
                                <p className="text-xs text-gray-600 mb-1 flex items-center gap-1"><LogIn size={12} /> Chegada</p>
                                <p className="font-semibold text-sm tabular-nums">{fmtTime(detailJob.worker_checkin_at ?? detailJob.company_checkin_confirmed_at)}</p>
                            </div>
                            <div className="bg-gray-50 rounded-xl p-3">
                                <p className="text-xs text-gray-600 mb-1 flex items-center gap-1"><LogOut size={12} /> Saída</p>
                                <p className="font-semibold text-sm tabular-nums">{fmtTime(detailJob.worker_checkout_at ?? detailJob.company_checkout_confirmed_at)}</p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600 mb-5">
                            <LocalDoTurno location={detailJob.location} size={16} />
                            <span className="text-gray-300">•</span>
                            <Clock size={16} /> {detailJob.time}{detailJob.end_time ? ` - ${detailJob.end_time}` : ''}
                        </div>

                        {detailJob.status === 'completed' && reviewedJobIds.has(detailJob.job_id) && (
                            <div className="flex items-center gap-2 text-sm text-gray-600 border-t border-gray-200 pt-4">
                                <Star size={16} className="text-yellow-500 fill-yellow-500" /> Você já avaliou esta empresa.
                            </div>
                        )}

                        <DialogActions stacked>
                            <Button
                                variant="secondary"
                                onClick={() => handleChat(detailJob)}
                                loading={chattingId === detailJob.id}
                                iconLeft={<MessageCircle size={16} />}
                            >
                                Falar com a empresa
                            </Button>
                            {detailJob.status === 'completed' && !reviewedJobIds.has(detailJob.job_id) && (
                                <Button
                                    variant="secondary"
                                    onClick={() => { const j = detailJob; setDetailJob(null); handleOpenRateModal(j); }}
                                    iconLeft={<Star size={16} />}
                                >
                                    Avaliar esta empresa
                                </Button>
                            )}
                            {detailJob.status === 'completed' && (
                                <Button onClick={() => navigate(`/recibo/${detailJob.job_id}`)} iconLeft={<Receipt size={16} />}>
                                    Ver recibo
                                </Button>
                            )}
                        </DialogActions>
                </Dialog>
            )}

            {/* Confirmação de cancelamento de turno agendado */}
            {cancelJob && (
                <Dialog
                    labelledBy="cancelar-turno-titulo"
                    onClose={() => setCancelJob(null)}
                    locked={cancelLoading}
                    className="max-w-sm"
                >
                        <div className="flex items-start gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
                                <XCircle size={20} className="text-red-600" />
                            </div>
                            <div>
                                <h3 id="cancelar-turno-titulo" className="text-lg font-bold tracking-tight">Cancelar este turno?</h3>
                                <p className="text-sm text-gray-600 mt-1">
                                    A empresa será avisada e poderá chamar outra pessoa. Você não volta a este turno.
                                </p>
                            </div>
                        </div>

                        <div className="bg-gray-50 rounded-xl p-3 mb-5">
                            <p className="font-semibold text-sm">{cancelJob.title}</p>
                            <p className="text-xs text-gray-600">{cancelJob.date} • {cancelJob.time}</p>
                        </div>

                        <DialogActions>
                            <Button
                                variant="secondary"
                                onClick={() => setCancelJob(null)}
                                disabled={cancelLoading}
                            >
                                Voltar
                            </Button>
                            <Button
                                variant="danger"
                                onClick={handleCancelShift}
                                loading={cancelLoading}
                                iconLeft={<XCircle size={18} />}
                            >
                                Cancelar turno
                            </Button>
                        </DialogActions>
                </Dialog>
            )}

        </div>
    );
}
