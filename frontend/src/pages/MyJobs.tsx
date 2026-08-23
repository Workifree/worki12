
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { MapPin, CheckCircle2, Clock, XCircle, Loader2, DollarSign, Star, Play, Square, AlertCircle, Bell, Building2, X, LogIn, LogOut, MessageCircle, Users, ThumbsUp, ThumbsDown, CalendarClock } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, isToday, parseISO, isWithinInterval, setHours, setMinutes } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import RateModal from '../components/RateModal';
import JobLifecycleStepper from '../components/JobLifecycleStepper';
import { useToast } from '../contexts/ToastContext';
import { logError } from '../lib/logger';
import { useWorkerInvites } from '../hooks/useShiftInvites';
import { AttendanceConfirmationService } from '../services/attendanceConfirmationService';
import type {
    ReviewDirection,
    ShiftAttendanceConfirmation,
    AttendanceConfirmationResponse,
    AttendanceConfirmationOutcome,
} from '../types';

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
            label: 'Chegada registrada',
            status: checkinDone ? 'complete' : 'active'
        },
        {
            label: 'Check-out',
            status: checkoutDone
                ? 'complete'
                : checkinDone && !checkoutDone
                    ? 'active'
                    : 'pending'
        },
        {
            label: 'Aguardando empresa',
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
    pay: number;
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
}

type ActiveTab = 'invites' | 'in_progress' | 'scheduled' | 'history';

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

export default function MyJobs() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<ActiveTab>('invites');
    const [jobs, setJobs] = useState<{
        in_progress: JobApplication[],
        scheduled: JobApplication[],
        history: JobApplication[]
    }>({ in_progress: [], scheduled: [], history: [] });

    // Rating State
    const [rateModalOpen, setRateModalOpen] = useState(false);
    const [selectedJobToRate, setSelectedJobToRate] = useState<JobApplication | null>(null);
    const [reviewedJobIds, setReviewedJobIds] = useState<Set<string>>(new Set());
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    // Detalhe do turno no histórico (chegada/saída, valor, avaliação, foto).
    const [detailJob, setDetailJob] = useState<JobApplication | null>(null);
    // Confirmação de cancelamento de turno agendado (aba "Agendados").
    const [cancelJob, setCancelJob] = useState<JobApplication | null>(null);
    const [cancelLoading, setCancelLoading] = useState(false);
    // "Falar com a empresa" — o gesto simétrico do freela (empresa já tinha o ícone de chat
    // na tela de presença). id da application sendo processada (loading do botão).
    const [chattingId, setChattingId] = useState<string | null>(null);
    // Avaliação obrigatória: abre automática 1x por visita para o 1º turno pago sem avaliação.
    const autoRatePrompted = useRef(false);
    const { addToast } = useToast();

    // Hook de convites push
    const { pendingInvites, loading: invitesLoading, respondingId, respond } = useWorkerInvites();

    // Confirmação de véspera (D-1) — pedidos pendentes (`response IS NULL`) endereçados a este
    // freela. Fetch independente do `fetchJobs` (mesmo padrão de `useWorkerInvites`): a tela não
    // precisa esperar o histórico completo carregar para mostrar o card de confirmação.
    const [pendingConfirmations, setPendingConfirmations] = useState<ShiftAttendanceConfirmation[]>([]);
    const [confirmationsLoading, setConfirmationsLoading] = useState(true);
    const [respondingConfirmationId, setRespondingConfirmationId] = useState<string | null>(null);
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

    const fetchJobs = useCallback(async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return navigate('/login');

        // Fetch my reviews to know what I've rated
        const { data: myReviews } = await supabase
            .from('reviews')
            .select('job_id')
            .eq('reviewer_id', user.id);

        const reviewedSet = new Set(myReviews?.map(r => r.job_id) || []);
        setReviewedJobIds(reviewedSet);

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
        } else {
            const in_progress: JobApplication[] = [];
            const scheduled: JobApplication[] = [];
            const history: JobApplication[] = [];

            const now = new Date();

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
                    company_name: app.job.company?.name || 'Empresa Confidencial',
                    company_logo: app.job.company?.logo_url ?? null,
                    pay: app.job.budget || 0,
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
                    created_at: app.created_at
                };

                const isJobToday = application.raw_date && isToday(parseISO(application.raw_date));
                let isWithinWorkHours = false;

                if (isJobToday && application.time && application.end_time) {
                    try {
                        const [startH, startM] = application.time.split(':').map(Number);
                        const [endH, endM] = application.end_time.split(':').map(Number);

                        const todayDate = new Date();
                        const startTime = setMinutes(setHours(todayDate, startH), startM);
                        let endTime = setMinutes(setHours(todayDate, endH), endM);

                        if (endTime.getTime() <= startTime.getTime()) {
                            endTime = new Date(endTime.getTime() + 24 * 60 * 60 * 1000);
                        }

                        const startBuffer = new Date(startTime.getTime() - 30 * 60 * 1000);
                        const endBuffer = new Date(endTime.getTime() + 60 * 60 * 1000);

                        isWithinWorkHours = isWithinInterval(now, { start: startBuffer, end: endBuffer });
                    } catch (e) {
                        logError('Error parsing work hours:', e);
                    }
                }

                const isInProgress = (app.status === 'hired' && isJobToday && isWithinWorkHours) || app.status === 'in_progress';

                if (isInProgress) {
                    in_progress.push(application);
                } else if (app.status === 'hired') {
                    scheduled.push(application);
                } else if (['completed', 'rejected', 'cancelled', 'declined'].includes(app.status)) {
                    history.push(application);
                }
            });

            setJobs({ in_progress, scheduled, history });
        }
        setLoading(false);
    }, [navigate]);

    useEffect(() => {
        fetchJobs();
    }, [fetchJobs]);

    const fetchConfirmations = useCallback(async () => {
        try {
            const rows = await AttendanceConfirmationService.getMyPendingConfirmations();
            setPendingConfirmations(rows);
        } catch (err) {
            logError('MyJobs.fetchConfirmations', err);
        } finally {
            setConfirmationsLoading(false);
        }
    }, []);

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
                setRespondedConfirmations((prev) => ({ ...prev, [confirmation.id]: confirmedOutcome }));
                return;
            }
            // already_responded não é erro — é informação: duplo toque/retry não deve assustar
            // o freela com um toast vermelho. Não sabemos qual foi a resposta REAL já gravada
            // (a RPC não devolve isso em já_respondido) — badge neutro, não um confirmed/cannot_attend
            // de palpite.
            if (result.outcome === 'already_responded') {
                addToast('Você já respondeu a este pedido.', 'info');
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

    // Avaliação obrigatória pós-pagamento: assim que o turno é concluído/pago pela
    // empresa, ele cai no histórico. Se houver um turno pago ainda sem avaliação,
    // abrimos o modal automaticamente (1x por visita) para o freela avaliar a empresa.
    useEffect(() => {
        if (autoRatePrompted.current || loading) return;
        const pending = jobs.history.find(j => j.status === 'completed' && !reviewedJobIds.has(j.job_id));
        if (pending) {
            autoRatePrompted.current = true;
            setSelectedJobToRate(pending);
            setRateModalOpen(true);
        }
    }, [jobs.history, reviewedJobIds, loading]);

    // `.select('id')` obrigatório (padrão `removeFromTeam`/patterns.md — DELETE/UPDATE sob
    // RLS negado silenciosamente): sob RLS um UPDATE cuja linha não casa mais com a policy
    // USING retorna 0 linhas sem erro (PostgREST 204). Sem checar `data`, a UI diria "check-in
    // realizado" com o banco intocado.
    const handleCheckin = async (appId: string) => {
        setActionLoading(appId);
        try {
            const { data, error } = await supabase
                .from('applications')
                .update({
                    worker_checkin_at: new Date().toISOString(),
                    status: 'in_progress'
                })
                .eq('id', appId)
                .select('id');

            if (error) throw error;
            if (!data || data.length === 0) {
                addToast('Não foi possível fazer check-in. Atualize a página e tente novamente.', 'error');
                return;
            }
            addToast('Check-in realizado com sucesso!', 'success');
            await fetchJobs();
        } catch (err) {
            logError('Error checking in:', err);
            addToast('Erro ao fazer check-in. Tente novamente.', 'error');
        } finally {
            setActionLoading(null);
        }
    };

    const handleCheckout = async (appId: string) => {
        setActionLoading(appId);
        try {
            const { data, error } = await supabase
                .from('applications')
                .update({ worker_checkout_at: new Date().toISOString() })
                .eq('id', appId)
                .select('id');

            if (error) throw error;
            if (!data || data.length === 0) {
                addToast('Não foi possível fazer check-out. Atualize a página e tente novamente.', 'error');
                return;
            }
            await fetchJobs();
        } catch (err) {
            logError('Error checking out:', err);
            addToast('Erro ao fazer check-out. Tente novamente.', 'error');
        } finally {
            setActionLoading(null);
        }
    };

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
            addToast('Erro ao cancelar turno. Tente novamente.', 'error');
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
            const { data: existingConvs } = await supabase
                .from('Conversation')
                .select('id')
                .eq('application_uuid', job.id)
                .limit(1);

            if (existingConvs && existingConvs.length > 0) {
                navigate(`/messages?conversation=${existingConvs[0].id}`);
            } else {
                const newConvId = crypto.randomUUID();
                const { error } = await supabase
                    .from('Conversation')
                    .insert({ id: newConvId, application_uuid: job.id, islocked: false });

                if (error) throw error;
                navigate(`/messages?conversation=${newConvId}`);
            }
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

    if (loading) return (
        <div className="flex flex-col gap-6 pb-24 max-w-4xl mx-auto animate-pulse">
            <div className="h-10 bg-gray-200 rounded w-1/3" />
            <div className="flex gap-2">
                {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-gray-200 rounded-xl w-24" />)}
            </div>
            <div className="space-y-4">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-28 bg-gray-200 rounded-2xl" />
                ))}
            </div>
        </div>
    );

    return (
        <div className="flex flex-col gap-6 pb-24 font-sans text-accent max-w-4xl mx-auto">
            <PageMeta title="Meus Turnos" description="Acompanhe seus convites, turnos agendados e histórico na Worki." />

            <header>
                <h2 className="text-4xl font-black uppercase tracking-tighter">Meus Turnos</h2>
            </header>

            {/* Confirmação de véspera (D-1) — card destacado, resposta em UM toque, sempre visível
                no topo (fora das abas): o turno é amanhã, não pode depender do freela estar na aba certa.
                Cruza `pendingConfirmations` (application_id) com os turnos já carregados (`in_progress`/
                `scheduled`) para exibir empresa/data/horário/local sem uma query extra. */}
            {!confirmationsLoading && pendingConfirmations.length > 0 && (
                <div className="flex flex-col gap-4">
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
                                className="bg-white border-2 border-black rounded-2xl p-6 shadow-[6px_6px_0px_0px_rgba(0,166,81,1)]"
                            >
                                <div className="flex items-center gap-2 mb-3">
                                    <CalendarClock size={18} className="text-primary" />
                                    <span className="text-xs font-black uppercase text-primary">
                                        Confirma seu turno {rotuloDeQuando(job.raw_date)}?
                                    </span>
                                </div>
                                <h3 className="font-black text-xl uppercase mb-1">{job.title}</h3>
                                <p className="text-sm font-bold text-gray-500 mb-3">{job.company_name}</p>
                                <div className="flex flex-wrap gap-2 mb-5">
                                    <span className="flex items-center gap-1.5 text-xs font-bold bg-gray-100 text-gray-600 px-3 py-1.5 rounded-xl">
                                        <Clock size={14} /> {job.date}{job.time ? ` · ${job.time}${job.end_time ? `–${job.end_time}` : ''}` : ''}
                                    </span>
                                    <span className="flex items-center gap-1.5 text-xs font-bold bg-blue-50 text-blue-700 px-3 py-1.5 rounded-xl">
                                        <MapPin size={14} /> {job.location}
                                    </span>
                                </div>
                                {localResponse === 'confirmed' ? (
                                    <span className="flex items-center justify-center gap-2 w-full bg-primary-light text-primary px-6 py-3 rounded-xl font-black uppercase min-h-[44px]">
                                        <ThumbsUp size={18} /> Confirmado
                                    </span>
                                ) : localResponse === 'cannot_attend' ? (
                                    <span className="flex items-center justify-center gap-2 w-full bg-red-50 text-red-600 border-2 border-red-200 px-6 py-3 rounded-xl font-black uppercase min-h-[44px]">
                                        <ThumbsDown size={18} /> Avisou que não vai
                                    </span>
                                ) : localResponse === 'already_responded' ? (
                                    <span className="flex items-center justify-center gap-2 w-full bg-gray-100 text-gray-600 px-6 py-3 rounded-xl font-black uppercase min-h-[44px]">
                                        Você já respondeu
                                    </span>
                                ) : (
                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => void handleRespondConfirmation(confirmation, 'confirmed')}
                                            disabled={isResponding}
                                            className="flex-1 bg-primary hover:bg-black text-white px-6 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
                                        >
                                            {isResponding ? <Loader2 className="animate-spin" size={18} /> : <ThumbsUp size={18} />}
                                            Sim, vou
                                        </button>
                                        <button
                                            onClick={() => void handleRespondConfirmation(confirmation, 'cannot_attend')}
                                            disabled={isResponding}
                                            className="flex-1 bg-white hover:bg-red-50 text-red-600 border-2 border-red-200 hover:border-red-400 px-6 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
                                        >
                                            {isResponding ? <Loader2 className="animate-spin" size={18} /> : <ThumbsDown size={18} />}
                                            Não vou poder
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Tabs — Convites PRIMEIRO */}
            <div className="flex gap-2 border-b-2 border-gray-200 pb-1 overflow-x-auto scrollbar-hide">
                {[
                    { id: 'invites' as ActiveTab, label: 'Convites', count: pendingInvites.length, urgent: true },
                    { id: 'in_progress' as ActiveTab, label: 'Em Andamento', count: jobs.in_progress.length },
                    { id: 'scheduled' as ActiveTab, label: 'Agendados', count: jobs.scheduled.length },
                    { id: 'history' as ActiveTab, label: 'Histórico', count: jobs.history.length }
                ].map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`
                            px-6 py-2 rounded-t-xl font-bold uppercase transition-all whitespace-nowrap flex items-center gap-2
                            ${activeTab === tab.id
                                ? 'bg-black text-white translate-y-[2px]'
                                : 'text-gray-400 hover:text-black hover:bg-gray-100'}
                        `}
                    >
                        {tab.label}
                        {tab.count > 0 && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-black ${
                                tab.urgent
                                    ? 'bg-primary text-white animate-pulse'
                                    : tab.id === 'in_progress'
                                        ? 'bg-red-500 text-white animate-pulse'
                                        : 'bg-gray-200 text-gray-700'
                            }`}>
                                {tab.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="grid gap-4">

                {/* ── ABA CONVITES ── */}
                {activeTab === 'invites' && (
                    <>
                        {invitesLoading && (
                            <div className="space-y-4 animate-pulse">
                                {[...Array(2)].map((_, i) => (
                                    <div key={i} className="h-32 bg-gray-200 rounded-2xl" />
                                ))}
                            </div>
                        )}

                        {!invitesLoading && pendingInvites.length === 0 && (
                            <div className="text-center py-16 text-gray-400 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                                <Bell size={48} className="mx-auto mb-4 opacity-30" />
                                <p className="font-bold text-lg">Nenhum convite pendente.</p>
                                <p className="text-sm mt-2">Quando uma empresa te convidar para um turno, aparecerá aqui.</p>
                            </div>
                        )}

                        {!invitesLoading && pendingInvites.map((invite) => {
                            const job = invite.job;
                            const companyInfo = job?.company;
                            const companyName = companyInfo?.name ?? 'Empresa';
                            const companyLogo = companyInfo?.logo_url ?? null;
                            const companyId = companyInfo?.id;
                            const jobTitle = job?.title ?? 'Turno';
                            const budget = job?.budget ?? 0;
                            const startDate = job?.start_date
                                ? new Date(job.start_date).toLocaleDateString('pt-BR')
                                : 'Data a definir';
                            const startTime = job?.work_start_time ?? '';
                            const endTime = job?.work_end_time ?? '';
                            const location = job?.location ?? 'Local a definir';
                            const isResponding = respondingId === invite.id;

                            return (
                                <div key={invite.id} className="bg-white border-2 border-black rounded-2xl p-6 shadow-[4px_4px_0px_0px_rgba(0,166,81,1)]">
                                    {/* Empresa */}
                                    <div className="flex items-center gap-3 mb-4">
                                        <div
                                            role={companyId ? 'button' : undefined}
                                            tabIndex={companyId ? 0 : undefined}
                                            onClick={companyId ? () => navigate(`/empresa/${companyId}`) : undefined}
                                            onKeyDown={companyId ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/empresa/${companyId}`); } } : undefined}
                                            className={`flex items-center gap-3 flex-1 min-w-0 ${companyId ? 'cursor-pointer' : ''}`}
                                        >
                                            <div className="w-10 h-10 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
                                                {companyLogo ? (
                                                    <img src={companyLogo} alt={companyName} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center">
                                                        <Building2 size={20} className="text-gray-400" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-xs font-bold uppercase text-gray-400">Convite de</p>
                                                <p className={`font-black uppercase truncate ${companyId ? 'hover:text-primary transition-colors' : ''}`}>{companyName}</p>
                                            </div>
                                        </div>
                                        {/* Corrida explícita: o freela precisa saber que a vaga é disputada ANTES
                                            de decidir. Esconder isso seria deixá-lo achar que tem o tempo todo do
                                            mundo e perder a vaga sem entender por quê. */}
                                        {invite.disputed ? (
                                            <span className="ml-auto bg-yellow-100 text-yellow-800 text-xs font-black uppercase px-2 py-1 rounded-xl border border-yellow-300 flex-shrink-0">
                                                Quem aceitar primeiro
                                            </span>
                                        ) : (
                                            <span className="ml-auto bg-primary-light text-primary text-xs font-black uppercase px-2 py-1 rounded-xl border border-green-200 flex-shrink-0">
                                                Novo convite
                                            </span>
                                        )}
                                    </div>

                                    {/* Detalhes do turno */}
                                    <h3 className="font-black text-xl uppercase mb-3">{jobTitle}</h3>
                                    <div className="flex flex-wrap gap-2 mb-4">
                                        <span className="flex items-center gap-1.5 text-xs font-bold bg-gray-100 text-gray-600 px-3 py-1.5 rounded-xl">
                                            <Clock size={14} /> {startDate}{startTime ? ` · ${startTime}${endTime ? `–${endTime}` : ''}` : ''}
                                        </span>
                                        <span className="flex items-center gap-1.5 text-xs font-bold bg-primary-light text-primary px-3 py-1.5 rounded-xl">
                                            <DollarSign size={14} /> R$ {budget.toFixed(2).replace('.', ',')}
                                        </span>
                                        {location && (
                                            <span className="flex items-center gap-1.5 text-xs font-bold bg-blue-50 text-blue-700 px-3 py-1.5 rounded-xl">
                                                <MapPin size={14} /> {location}
                                            </span>
                                        )}
                                    </div>

                                    {/* Briefing */}
                                    {(job?.briefing || job?.description) && (
                                        <div className="bg-gray-50 border-l-4 border-black rounded-r-xl p-3 mb-4">
                                            <p className="text-xs font-bold uppercase text-gray-400 mb-1">Briefing</p>
                                            <p className="text-sm font-medium text-gray-700 line-clamp-3">{job.briefing || job.description}</p>
                                        </div>
                                    )}

                                    {/* Disputa + expiração */}
                                    {invite.disputed && (
                                        <p className="text-xs font-bold text-yellow-700 mb-2 flex items-center gap-1">
                                            <Users size={12} />
                                            {invite.targetsCount} freelas receberam este turno
                                            {invite.slots > 1 ? ` · ${invite.slots} vagas` : ' · 1 vaga'}
                                        </p>
                                    )}
                                    {invite.expiresAt && (
                                        <p className="text-xs font-bold text-yellow-600 mb-4 flex items-center gap-1">
                                            <Clock size={12} />
                                            Expira {formatDistanceToNow(new Date(invite.expiresAt), { addSuffix: true, locale: ptBR })}
                                        </p>
                                    )}

                                    {/* Ações */}
                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => respond(invite.id, 'accepted')}
                                            disabled={isResponding}
                                            className="flex-1 bg-primary hover:bg-black text-white px-6 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isResponding ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                                            Aceitar
                                        </button>
                                        <button
                                            onClick={() => respond(invite.id, 'declined')}
                                            disabled={isResponding}
                                            className="flex-1 bg-white hover:bg-gray-50 text-gray-700 px-6 py-3 rounded-xl font-black uppercase border-2 border-gray-300 flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isResponding ? <Loader2 className="animate-spin" size={18} /> : <XCircle size={18} />}
                                            Recusar
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-400 text-center mt-2 font-bold">
                                        Recusar não afeta sua reputação.
                                    </p>
                                </div>
                            );
                        })}
                    </>
                )}

                {/* ── ABA EM ANDAMENTO ── */}
                {activeTab === 'in_progress' && jobs.in_progress.length === 0 && (
                    <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                        <AlertCircle size={48} className="mx-auto mb-4 opacity-30" />
                        <p className="font-bold">Nenhum trabalho em andamento.</p>
                        <p className="text-sm mt-2">Trabalhos agendados para hoje aparecerão aqui durante o horário de trabalho.</p>
                    </div>
                )}
                {activeTab === 'in_progress' && jobs.in_progress.map((job) => (
                    <div key={job.id} className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-500 p-6 rounded-2xl shadow-[6px_6px_0px_0px_rgba(0,166,81,1)]">
                        <div className="flex flex-col md:flex-row justify-between gap-4">
                            <div className="flex gap-4 items-start">
                                <div className="bg-green-600 text-white p-3 rounded-xl min-w-[70px] text-center animate-pulse">
                                    <Play size={24} className="mx-auto" />
                                    <span className="block text-xs font-bold uppercase mt-1">AO VIVO</span>
                                </div>
                                <div>
                                    <h3 className="font-black text-xl uppercase mb-1">{job.title}</h3>
                                    <p className="text-sm font-bold text-gray-600">{job.company_name}</p>
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        <span className="flex items-center gap-1.5 text-xs font-bold bg-white text-gray-600 px-3 py-1.5 rounded-lg border">
                                            <Clock size={14} /> {job.time} - {job.end_time}
                                        </span>
                                        <span className="flex items-center gap-1.5 text-xs font-bold bg-white text-green-700 px-3 py-1.5 rounded-lg border">
                                            <DollarSign size={14} /> R$ {job.pay}
                                        </span>
                                        <span className="flex items-center gap-1.5 text-xs font-bold bg-white text-gray-600 px-3 py-1.5 rounded-lg border">
                                            <MapPin size={14} /> {job.location}
                                        </span>
                                    </div>
                                    {/* Dizia "Pagamento em garantia até confirmação da empresa" para TODO turno
                                        em andamento — promessa de escrow que o produto não cumpre. O piloto é
                                        100% modo A: o dinheiro nunca passa pelo Worki, não há nada em garantia.
                                        Este turno, conferido no banco, tem zero linhas em escrow_transactions.
                                        Prometer custódia de dinheiro que ninguém segura é a pior classe de copy
                                        errado: o freela decide confiar com base nela. */}
                                    {job.status === 'in_progress' && (
                                        <p className="text-xs text-gray-500 font-bold flex items-center gap-1 mt-1">
                                            Pagamento combinado direto com a empresa — o Worki registra o recibo
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="border-t border-gray-100 mt-3 pt-3">
                            <JobLifecycleStepper steps={computeWorkerSteps(job)} />
                        </div>
                        <div className="flex flex-col gap-3 mt-3">
                            <div className="flex flex-col gap-3 min-w-[200px]">
                                {/* A empresa pode registrar chegada/saída sem o freela tocar no app
                                    (turno sem sinal, freela não usa o celular na hora). `checkedIn`/
                                    `checkedOut` consideram os DOIS lados — senão o freela vê um CTA
                                    ativo para uma etapa que a empresa já fechou e, se tocar, sobrescreve
                                    o timestamp confirmado (o recibo prioriza `worker_checkin/checkout_at`
                                    quando presente, mesmo em turno já pago). */}
                                {!job.worker_checkin_at && !job.company_checkin_confirmed_at ? (
                                    <button
                                        onClick={() => handleCheckin(job.id)}
                                        disabled={actionLoading === job.id}
                                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50 text-sm shadow-sm"
                                    >
                                        {actionLoading === job.id ? (
                                            <Loader2 className="animate-spin" size={18} />
                                        ) : (
                                            <><Play size={18} /> Check-in</>
                                        )}
                                    </button>
                                ) : job.worker_checkin_at ? (
                                    <div className="bg-green-100 text-green-700 px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2">
                                        <CheckCircle2 size={16} />
                                        Check-in: {formatDistanceToNow(new Date(job.worker_checkin_at), { addSuffix: true, locale: ptBR })}
                                    </div>
                                ) : (
                                    <div className="bg-blue-100 text-blue-700 px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2">
                                        <CheckCircle2 size={16} />
                                        Empresa registrou sua chegada
                                    </div>
                                )}

                                {job.worker_checkin_at && (
                                    <div className={`px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 ${job.company_checkin_confirmed_at ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                        {job.company_checkin_confirmed_at ? (
                                            <><CheckCircle2 size={16} /> Empresa confirmou chegada</>
                                        ) : (
                                            <><Clock size={16} /> Aguardando confirmação da empresa</>
                                        )}
                                    </div>
                                )}

                                {(job.worker_checkin_at || job.company_checkin_confirmed_at) && !job.worker_checkout_at && !job.company_checkout_confirmed_at && (
                                    <button
                                        onClick={() => handleCheckout(job.id)}
                                        disabled={actionLoading === job.id}
                                        className="bg-red-500 hover:bg-red-600 text-white px-4 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                                    >
                                        {actionLoading === job.id ? (
                                            <Loader2 className="animate-spin" size={20} />
                                        ) : (
                                            <><Square size={20} /> Check-out</>
                                        )}
                                    </button>
                                )}

                                {job.worker_checkout_at && (
                                    <div className="bg-gray-100 text-gray-700 px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2">
                                        <CheckCircle2 size={16} />
                                        Check-out: {formatDistanceToNow(new Date(job.worker_checkout_at), { addSuffix: true, locale: ptBR })}
                                    </div>
                                )}

                                {!job.worker_checkout_at && job.company_checkout_confirmed_at && (
                                    <div className="bg-blue-100 text-blue-700 px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2">
                                        <CheckCircle2 size={16} />
                                        Empresa registrou sua saída
                                    </div>
                                )}

                                {/* "Vou atrasar 20 minutos" — sem isso não há canal se a empresa nunca abriu o chat. */}
                                <button
                                    onClick={() => handleChat(job)}
                                    disabled={chattingId === job.id}
                                    className="bg-white hover:bg-black text-black hover:text-white border-2 border-black px-4 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50 text-sm"
                                >
                                    {chattingId === job.id ? <Loader2 className="animate-spin" size={18} /> : <MessageCircle size={18} />}
                                    Falar com a empresa
                                </button>
                            </div>
                        </div>
                    </div>
                ))}

                {/* ── ABA AGENDADOS ── */}
                {activeTab === 'scheduled' && jobs.scheduled.length === 0 && (
                    <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                        <p className="font-bold">Nenhum turno agendado no momento.</p>
                    </div>
                )}
                {activeTab === 'scheduled' && jobs.scheduled.map((job) => (
                    <div key={job.id} className="bg-white border-2 border-black p-6 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,166,81,1)] flex flex-col md:flex-row justify-between md:items-center gap-4 group hover:-translate-y-1 transition-transform">
                        <div className="flex gap-4 items-center">
                            <div className="bg-black text-white p-3 rounded-xl border-2 border-black min-w-[70px] text-center group-hover:bg-primary group-hover:border-primary transition-colors">
                                <span className="block text-xs font-bold uppercase">{job.month}</span>
                                <span className="block text-2xl font-black">{job.day}</span>
                            </div>
                            <div>
                                <h3 className="font-black text-xl uppercase mb-1">{job.title}</h3>
                                <span className="flex items-center gap-1.5 text-xs font-bold bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg uppercase">
                                    <Clock size={14} /> {job.date} • {job.time}
                                </span>
                                <span className="flex items-center gap-1.5 text-xs font-bold bg-green-100 text-green-700 px-3 py-1.5 rounded-lg uppercase ml-2">
                                    <DollarSign size={14} /> R$ {job.pay}
                                </span>
                                <p className="text-sm font-bold text-gray-500 flex items-center gap-1 mt-1">
                                    <MapPin size={14} /> {job.location}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center justify-between md:justify-end gap-4 border-t md:border-t-0 md:border-l border-gray-100 pt-4 md:pt-0 md:pl-6 w-full md:w-auto">
                            <div>
                                <span className="block text-sm font-bold text-gray-400 uppercase">Receber</span>
                                <span className="block text-2xl font-black text-primary">R$ {job.pay}</span>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                                <span className="bg-green-100 text-green-700 text-xs font-black uppercase px-3 py-1 rounded-full border border-green-200">Contratado</span>
                                <button
                                    onClick={() => handleChat(job)}
                                    disabled={chattingId === job.id}
                                    className="text-xs font-black text-black hover:text-white hover:bg-black uppercase px-3 py-2 rounded-xl border-2 border-black transition-colors flex items-center gap-1 min-h-[44px] disabled:opacity-50"
                                >
                                    {chattingId === job.id ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
                                    Falar com a empresa
                                </button>
                                <button
                                    onClick={() => setCancelJob(job)}
                                    className="text-xs font-black text-red-600 hover:text-white hover:bg-red-500 uppercase px-3 py-2 rounded-xl border-2 border-red-200 hover:border-red-500 transition-colors flex items-center gap-1 min-h-[44px]"
                                >
                                    <XCircle size={14} /> Cancelar turno
                                </button>
                            </div>
                        </div>
                    </div>
                ))}

                {/* ── ABA HISTÓRICO ── */}
                {activeTab === 'history' && jobs.history.length === 0 && (
                    <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                        <p className="font-bold">Seu histórico está vazio.</p>
                    </div>
                )}
                {activeTab === 'history' && jobs.history.map((job) => (
                    <div
                        key={job.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setDetailJob(job)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailJob(job); } }}
                        className="bg-gray-50 border-2 border-transparent hover:border-black p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center transition-all cursor-pointer gap-2"
                    >
                        <div>
                            <h3 className="font-black text-lg uppercase mb-1 text-gray-700">{job.title}</h3>
                            <p className="text-sm font-bold text-gray-400">{job.date} • {job.company_name}</p>
                        </div>
                        <div className="flex items-center justify-between w-full md:w-auto gap-4">
                            <span className="block font-black text-gray-600">R$ {job.pay}</span>
                            {job.status === 'completed' ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-black text-green-600 flex items-center gap-1 uppercase bg-green-100 px-2 py-1 rounded-xl">
                                        <CheckCircle2 size={12} /> Pago
                                    </span>
                                    {!reviewedJobIds.has(job.job_id) ? (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleOpenRateModal(job); }}
                                            className="text-xs font-black text-white bg-black hover:bg-yellow-500 hover:text-black flex items-center gap-1 uppercase px-3 py-1.5 rounded-xl transition-colors"
                                        >
                                            <Star size={12} /> Avaliar
                                        </button>
                                    ) : (
                                        <span className="text-xs font-bold text-gray-400 flex items-center gap-1 uppercase">
                                            <Star size={12} fill="currentColor" /> Avaliado
                                        </span>
                                    )}
                                </div>
                            ) : (
                                <span className="text-xs font-black text-red-500 flex items-center gap-1 uppercase bg-red-100 px-2 py-1 rounded-xl">
                                    <XCircle size={12} /> {job.status === 'declined' ? 'Recusado' : 'Cancelado'}
                                </span>
                            )}
                        </div>
                    </div>
                ))}
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
                <div
                    className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
                    onClick={(e) => { if (e.target === e.currentTarget) setDetailJob(null); }}
                >
                    <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-start justify-between gap-3 mb-5">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-12 h-12 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
                                    {detailJob.company_logo ? (
                                        <img src={detailJob.company_logo} alt={detailJob.company_name} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-black text-white"><Building2 size={22} /></div>
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-xl font-black uppercase tracking-tight truncate">{detailJob.title}</h3>
                                    <p className="text-sm font-bold text-gray-500 truncate">{detailJob.company_name}</p>
                                </div>
                            </div>
                            <button onClick={() => setDetailJob(null)} aria-label="Fechar" className="p-2 hover:bg-gray-100 rounded-xl transition-colors flex-shrink-0">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Status */}
                        <div className="mb-5">
                            {detailJob.status === 'completed' ? (
                                <span className="inline-flex items-center gap-1 text-xs font-black text-green-700 bg-green-100 border-2 border-green-200 px-3 py-1.5 rounded-xl uppercase">
                                    <CheckCircle2 size={14} /> Concluído e pago
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1 text-xs font-black text-red-600 bg-red-100 border-2 border-red-200 px-3 py-1.5 rounded-xl uppercase">
                                    <XCircle size={14} /> {detailJob.status === 'declined' ? 'Recusado' : 'Cancelado'}
                                </span>
                            )}
                        </div>

                        {/* Grid de infos */}
                        <div className="grid grid-cols-2 gap-3 mb-5">
                            <div className="bg-gray-50 border-2 border-gray-100 rounded-xl p-3">
                                <p className="text-[10px] font-black uppercase text-gray-400 mb-1">Data</p>
                                <p className="font-bold text-sm">{detailJob.date}</p>
                            </div>
                            <div className="bg-gray-50 border-2 border-gray-100 rounded-xl p-3">
                                <p className="text-[10px] font-black uppercase text-gray-400 mb-1">Valor</p>
                                <p className="font-black text-sm text-primary">R$ {detailJob.pay}</p>
                            </div>
                            <div className="bg-gray-50 border-2 border-gray-100 rounded-xl p-3">
                                <p className="text-[10px] font-black uppercase text-gray-400 mb-1 flex items-center gap-1"><LogIn size={12} /> Chegada</p>
                                <p className="font-bold text-sm">{fmtTime(detailJob.worker_checkin_at)}</p>
                            </div>
                            <div className="bg-gray-50 border-2 border-gray-100 rounded-xl p-3">
                                <p className="text-[10px] font-black uppercase text-gray-400 mb-1 flex items-center gap-1"><LogOut size={12} /> Saída</p>
                                <p className="font-bold text-sm">{fmtTime(detailJob.worker_checkout_at)}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 text-sm font-bold text-gray-500 mb-5">
                            <MapPin size={16} /> {detailJob.location}
                            <span className="text-gray-300">•</span>
                            <Clock size={16} /> {detailJob.time}{detailJob.end_time ? ` - ${detailJob.end_time}` : ''}
                        </div>

                        {/* Avaliação */}
                        {detailJob.status === 'completed' && (
                            reviewedJobIds.has(detailJob.job_id) ? (
                                <div className="flex items-center gap-2 text-sm font-bold text-gray-500 border-t-2 border-gray-100 pt-4">
                                    <Star size={16} className="text-yellow-500 fill-yellow-500" /> Você já avaliou esta empresa.
                                </div>
                            ) : (
                                <button
                                    onClick={() => { const j = detailJob; setDetailJob(null); handleOpenRateModal(j); }}
                                    className="w-full bg-black hover:bg-primary text-white px-6 py-3 rounded-xl font-black uppercase text-sm flex items-center justify-center gap-2 transition-colors border-t-2 border-gray-100"
                                >
                                    <Star size={16} /> Avaliar esta empresa
                                </button>
                            )
                        )}
                    </div>
                </div>
            )}

            {/* Confirmação de cancelamento de turno agendado */}
            {cancelJob && (
                <div
                    className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
                    onClick={(e) => { if (e.target === e.currentTarget && !cancelLoading) setCancelJob(null); }}
                >
                    <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-sm p-6">
                        <div className="flex items-start gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl border-2 border-black bg-red-100 flex items-center justify-center flex-shrink-0">
                                <XCircle size={20} className="text-red-600" />
                            </div>
                            <div>
                                <h3 className="text-lg font-black uppercase tracking-tight">Cancelar este turno?</h3>
                                <p className="text-sm font-bold text-gray-500 mt-1">
                                    A empresa será avisada e o turno volta a ficar disponível.
                                </p>
                            </div>
                        </div>

                        <div className="bg-gray-50 border-2 border-gray-100 rounded-xl p-3 mb-5">
                            <p className="font-black text-sm uppercase">{cancelJob.title}</p>
                            <p className="text-xs font-bold text-gray-500">{cancelJob.date} • {cancelJob.time}</p>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setCancelJob(null)}
                                disabled={cancelLoading}
                                className="flex-1 bg-white hover:bg-gray-50 text-gray-700 px-4 py-3 rounded-xl font-black uppercase border-2 border-gray-300 transition-colors disabled:opacity-50 min-h-[44px]"
                            >
                                Voltar
                            </button>
                            <button
                                onClick={handleCancelShift}
                                disabled={cancelLoading}
                                className="flex-1 bg-red-500 hover:bg-black text-white px-4 py-3 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors disabled:opacity-50 min-h-[44px]"
                            >
                                {cancelLoading ? <Loader2 className="animate-spin" size={18} /> : <XCircle size={18} />}
                                Cancelar turno
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
