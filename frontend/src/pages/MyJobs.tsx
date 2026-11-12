
import { useEffect, useState, useCallback, useRef } from 'react';
import LocalDoTurno from '../components/LocalDoTurno';
import { useModalDismiss } from '../hooks/useModalDismiss';
import { supabase } from '../lib/supabase';
import type { ReactNode } from 'react';
import { CheckCircle2, Clock, XCircle, DollarSign, Star, Play, Square, AlertCircle, Bell, Building2, X, LogIn, LogOut, MessageCircle, Users, ThumbsUp, ThumbsDown, CalendarClock, Receipt } from 'lucide-react';
import { Button, Card, PageHeader } from '../components/ui';
import PageMeta from '../components/PageMeta';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, isToday, parseISO, isWithinInterval, setHours, setMinutes } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import RateModal from '../components/RateModal';
import JobLifecycleStepper from '../components/JobLifecycleStepper';
import { useToast } from '../contexts/ToastContext';
import { logError } from '../lib/logger';
import { formatBRL } from '../lib/currency';
import ErroDeCarga from '../components/ErroDeCarga';
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

// ---------------------------------------------------------------------------
// Peças visuais locais (só desta tela): chip de meta, linha de status, estado vazio.
// ---------------------------------------------------------------------------

type ChipTone = 'neutral' | 'brand' | 'info';

const CHIP_TONES: Record<ChipTone, string> = {
    neutral: 'bg-gray-100 text-gray-700',
    brand: 'bg-primary-light text-primary',
    info: 'bg-blue-50 text-blue-700',
};

function Chip({ tone = 'neutral', children }: { tone?: ChipTone; children: ReactNode }) {
    return (
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl ${CHIP_TONES[tone]}`}>
            {children}
        </span>
    );
}

type StatusTone = 'success' | 'info' | 'waiting' | 'neutral';

const STATUS_TONES: Record<StatusTone, string> = {
    success: 'bg-green-50 text-green-800',
    info: 'bg-blue-50 text-blue-700',
    waiting: 'bg-yellow-50 text-yellow-800',
    neutral: 'bg-gray-100 text-gray-700',
};

function StatusLine({ tone, icon, children }: { tone: StatusTone; icon: ReactNode; children: ReactNode }) {
    return (
        <div className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium ${STATUS_TONES[tone]}`}>
            {icon}
            {children}
        </div>
    );
}

function EmptyState({ icon, title, description }: { icon?: ReactNode; title: string; description?: string }) {
    return (
        <div className="text-center py-12 px-4 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
            {icon && <div className="mb-3 flex justify-center text-gray-300">{icon}</div>}
            <p className="font-semibold text-gray-700">{title}</p>
            {description && <p className="text-sm text-gray-600 mt-1">{description}</p>}
        </div>
    );
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
    const [activeTab, setActiveTab] = useState<ActiveTab>('invites');
    const [jobs, setJobs] = useState<{
        in_progress: JobApplication[],
        scheduled: JobApplication[],
        history: JobApplication[]
    }>({ in_progress: [], scheduled: [], history: [] });

    // Rating State
    const [rateModalOpen, setRateModalOpen] = useState(false);
    // ESC do modal de detalhe do historico (heuristica #3). O RateModal ja tem o proprio ESC via
    // useModalDismiss interno; a guarda !rateModalOpen garante que, com os dois abertos, um ESC
    // fecha UM por vez (avaliacao primeiro, detalhe no proximo) — nunca os dois de uma tacada.
    useModalDismiss(() => { if (!rateModalOpen) setDetailJob(null); });
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
            setErroCarga(true);
        } else {
            setErroCarga(false);
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
                    company_name: app.job.company?.name || 'Empresa',
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
            addToast('Check-out registrado! A empresa confirma a saída.', 'success');
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

    if (erroCarga && !loading) return (
        <div className="pb-24 max-w-4xl mx-auto pt-6">
            <ErroDeCarga onRetry={() => { setLoading(true); fetchJobs(); }} />
        </div>
    );

    if (loading) return (
        <div className="flex flex-col gap-6 pb-24 max-w-4xl mx-auto animate-pulse">
            <div className="h-9 bg-gray-200 rounded-xl w-1/3" />
            <div className="flex gap-2">
                {[...Array(4)].map((_, i) => <div key={i} className="h-11 bg-gray-200 rounded-xl w-24" />)}
            </div>
            <div className="space-y-4">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-28 bg-gray-200 rounded-2xl" />
                ))}
            </div>
        </div>
    );

    const tabs: { id: ActiveTab; label: string; count: number; tone: 'brand' | 'dark' | 'neutral' }[] = [
        { id: 'invites', label: 'Convites', count: pendingInvites.length, tone: 'brand' },
        { id: 'in_progress', label: 'Em Andamento', count: jobs.in_progress.length, tone: 'dark' },
        { id: 'scheduled', label: 'Agendados', count: jobs.scheduled.length, tone: 'neutral' },
        { id: 'history', label: 'Histórico', count: jobs.history.length, tone: 'neutral' },
    ];
    const TAB_COUNT_TONES = {
        brand: 'bg-primary text-white',
        dark: 'bg-black text-white',
        neutral: 'bg-gray-200 text-gray-700',
    } as const;

    return (
        <div className="flex flex-col gap-6 pb-24 font-sans text-accent max-w-4xl mx-auto">
            <PageMeta title="Meus Turnos" description="Acompanhe seus convites, turnos agendados e histórico na Worki." />

            <PageHeader title="Meus Turnos" className="!mb-0" />

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
                            <Card
                                key={confirmation.id}
                                className="shadow-[4px_4px_0px_0px_rgba(0,166,81,1)]"
                            >
                                <div className="flex items-center gap-2 mb-3">
                                    <CalendarClock size={18} className="text-primary" />
                                    <span className="text-sm font-semibold text-primary">
                                        Confirma seu turno {rotuloDeQuando(job.raw_date)}?
                                    </span>
                                </div>
                                <h3 className="font-bold text-lg mb-0.5">{job.title}</h3>
                                <p className="text-sm text-gray-600 mb-3">{job.company_name}</p>
                                <div className="flex flex-wrap gap-2 mb-5">
                                    <Chip>
                                        <Clock size={14} /> {job.date}{job.time ? ` · ${job.time}${job.end_time ? `–${job.end_time}` : ''}` : ''}
                                    </Chip>
                                    <Chip tone="info">
                                        <LocalDoTurno location={job.location} />
                                    </Chip>
                                </div>
                                {localResponse === 'confirmed' ? (
                                    <span className="flex items-center justify-center gap-2 w-full h-11 bg-primary-light text-primary rounded-xl font-bold text-sm">
                                        <ThumbsUp size={18} /> Confirmado
                                    </span>
                                ) : localResponse === 'cannot_attend' ? (
                                    <span className="flex items-center justify-center gap-2 w-full h-11 bg-red-50 text-red-600 border-2 border-red-200 rounded-xl font-bold text-sm">
                                        <ThumbsDown size={18} /> Avisou que não vai
                                    </span>
                                ) : localResponse === 'already_responded' ? (
                                    <span className="flex items-center justify-center gap-2 w-full h-11 bg-gray-100 text-gray-600 rounded-xl font-bold text-sm">
                                        Você já respondeu
                                    </span>
                                ) : (
                                    <div className="flex gap-3">
                                        <Button
                                            variant="primary"
                                            className="flex-1"
                                            onClick={() => void handleRespondConfirmation(confirmation, 'confirmed')}
                                            disabled={isResponding}
                                            loading={isResponding}
                                            iconLeft={<ThumbsUp size={18} />}
                                        >
                                            Sim, vou
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            className="flex-1"
                                            onClick={() => void handleRespondConfirmation(confirmation, 'cannot_attend')}
                                            disabled={isResponding}
                                            loading={isResponding}
                                            iconLeft={<ThumbsDown size={18} />}
                                        >
                                            Não vou poder
                                        </Button>
                                    </div>
                                )}
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Tabs — Convites PRIMEIRO */}
            <div
                role="tablist"
                aria-label="Seções dos seus turnos"
                className="flex gap-1 border-b-2 border-gray-200 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        id={`meus-turnos-tab-${tab.id}`}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === tab.id}
                        aria-controls="meus-turnos-painel"
                        onClick={() => setActiveTab(tab.id)}
                        className={`
                            min-h-11 px-4 -mb-0.5 border-b-2 text-sm font-semibold transition-colors whitespace-nowrap flex items-center gap-2
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black rounded-t-xl
                            ${activeTab === tab.id
                                ? 'border-black text-black'
                                : 'border-transparent text-gray-500 hover:text-black hover:bg-gray-100'}
                        `}
                    >
                        {tab.label}
                        {tab.count > 0 && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${TAB_COUNT_TONES[tab.tone]}`}>
                                {tab.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div
                id="meus-turnos-painel"
                role="tabpanel"
                aria-labelledby={`meus-turnos-tab-${activeTab}`}
                className="grid gap-4"
            >

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
                            <EmptyState
                                icon={<Bell size={40} />}
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
                            const budget = job?.budget ?? 0;
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
                                    <span className="block w-10 h-10 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
                                        {companyLogo ? (
                                            <img src={companyLogo} alt={companyName} className="w-full h-full object-cover" />
                                        ) : (
                                            <span className="w-full h-full flex items-center justify-center">
                                                <Building2 size={20} className="text-gray-400" />
                                            </span>
                                        )}
                                    </span>
                                    <span className="block min-w-0">
                                        <span className="block text-xs text-gray-600">Convite de</span>
                                        <span className={`block font-bold truncate ${companyId ? 'group-hover:text-primary transition-colors' : ''}`}>{companyName}</span>
                                    </span>
                                </>
                            );

                            return (
                                <Card key={invite.id} className="shadow-[4px_4px_0px_0px_rgba(0,166,81,1)]">
                                    {/* Empresa */}
                                    <div className="flex items-center gap-3 mb-4">
                                        {companyId ? (
                                            <button
                                                type="button"
                                                onClick={() => navigate(`/empresa/${companyId}`)}
                                                className="group flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
                                            >
                                                {cabecalhoEmpresa}
                                            </button>
                                        ) : (
                                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                                {cabecalhoEmpresa}
                                            </div>
                                        )}
                                        {/* Corrida explícita: o freela precisa saber que a vaga é disputada ANTES
                                            de decidir. Esconder isso seria deixá-lo achar que tem o tempo todo do
                                            mundo e perder a vaga sem entender por quê. */}
                                        {invite.disputed ? (
                                            <span className="ml-auto bg-yellow-100 text-yellow-800 text-xs font-semibold px-2.5 py-1 rounded-pill border border-yellow-300 flex-shrink-0">
                                                Quem aceitar primeiro
                                            </span>
                                        ) : (
                                            <span className="ml-auto bg-primary-light text-primary text-xs font-semibold px-2.5 py-1 rounded-pill border border-green-200 flex-shrink-0">
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
                                            <DollarSign size={14} /> {formatBRL(budget)}
                                        </Chip>
                                        {location && (
                                            <Chip tone="info">
                                                <LocalDoTurno location={location} />
                                            </Chip>
                                        )}
                                    </div>

                                    {/* Briefing */}
                                    {(job?.briefing || job?.description) && (
                                        <div className="bg-gray-50 border-l-4 border-black rounded-r-xl p-3 mb-4">
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
                                    <div className="flex gap-3">
                                        <Button
                                            variant="primary"
                                            size="lg"
                                            className="flex-1"
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
                                            className="flex-1"
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
                {activeTab === 'in_progress' && jobs.in_progress.length === 0 && (
                    <EmptyState
                        icon={<AlertCircle size={40} />}
                        title="Nenhum trabalho em andamento."
                        description="Trabalhos agendados para hoje aparecerão aqui durante o horário de trabalho."
                    />
                )}
                {activeTab === 'in_progress' && jobs.in_progress.map((job) => (
                    <Card key={job.id} className="flex flex-col gap-4 shadow-[4px_4px_0px_0px_rgba(0,166,81,1)]">
                        <div>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h3 className="font-bold text-lg">{job.title}</h3>
                                    <p className="text-sm text-gray-600">{job.company_name}</p>
                                </div>
                                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary-light border border-green-200 px-2.5 py-1 rounded-pill flex-shrink-0">
                                    <span className="h-2 w-2 rounded-full bg-primary animate-pulse" aria-hidden="true" /> Ao vivo
                                </span>
                            </div>
                            <div className="flex flex-wrap gap-2 mt-3">
                                <Chip>
                                    <Clock size={14} /> {job.time}{job.end_time ? ` - ${job.end_time}` : ''}
                                </Chip>
                                <Chip tone="brand">
                                    <DollarSign size={14} /> {formatBRL(job.pay)}
                                </Chip>
                                <Chip tone="info">
                                    <LocalDoTurno location={job.location} />
                                </Chip>
                            </div>
                            {/* Dizia "Pagamento em garantia até confirmação da empresa" para TODO turno
                                em andamento — promessa de escrow que o produto não cumpre. O piloto é
                                100% modo A: o dinheiro nunca passa pelo Worki, não há nada em garantia.
                                Este turno, conferido no banco, tem zero linhas em escrow_transactions.
                                Prometer custódia de dinheiro que ninguém segura é a pior classe de copy
                                errado: o freela decide confiar com base nela. */}
                            {job.status === 'in_progress' && (
                                <p className="text-xs text-gray-600 mt-3">
                                    Pagamento combinado direto com a empresa — o Worki registra o recibo
                                </p>
                            )}
                        </div>

                        <div className="border-t-2 border-gray-100 pt-4">
                            <JobLifecycleStepper steps={computeWorkerSteps(job)} />
                        </div>

                        {/* A empresa pode registrar chegada/saída sem o freela tocar no app
                            (turno sem sinal, freela não usa o celular na hora). `checkedIn`/
                            `checkedOut` consideram os DOIS lados — senão o freela vê um CTA
                            ativo para uma etapa que a empresa já fechou e, se tocar, sobrescreve
                            o timestamp confirmado (o recibo prioriza `worker_checkin/checkout_at`
                            quando presente, mesmo em turno já pago). */}
                        <div className="flex flex-col gap-3">
                            {!job.worker_checkin_at && !job.company_checkin_confirmed_at ? (
                                <Button
                                    variant="primary"
                                    size="lg"
                                    fullWidth
                                    onClick={() => handleCheckin(job.id)}
                                    loading={actionLoading === job.id}
                                    iconLeft={<Play size={18} />}
                                >
                                    Check-in
                                </Button>
                            ) : job.worker_checkin_at ? (
                                <StatusLine tone="success" icon={<CheckCircle2 size={16} />}>
                                    Check-in: {formatDistanceToNow(new Date(job.worker_checkin_at), { addSuffix: true, locale: ptBR })}
                                </StatusLine>
                            ) : (
                                <StatusLine tone="info" icon={<CheckCircle2 size={16} />}>
                                    Empresa registrou sua chegada
                                </StatusLine>
                            )}

                            {job.worker_checkin_at && (
                                job.company_checkin_confirmed_at ? (
                                    <StatusLine tone="info" icon={<CheckCircle2 size={16} />}>
                                        Empresa confirmou chegada
                                    </StatusLine>
                                ) : (
                                    <StatusLine tone="waiting" icon={<Clock size={16} />}>
                                        Aguardando confirmação da empresa
                                    </StatusLine>
                                )
                            )}

                            {(job.worker_checkin_at || job.company_checkin_confirmed_at) && !job.worker_checkout_at && !job.company_checkout_confirmed_at && (
                                <Button
                                    variant="primary"
                                    size="lg"
                                    fullWidth
                                    onClick={() => handleCheckout(job.id)}
                                    loading={actionLoading === job.id}
                                    iconLeft={<Square size={18} />}
                                >
                                    Check-out
                                </Button>
                            )}

                            {job.worker_checkout_at && (
                                <StatusLine tone="neutral" icon={<CheckCircle2 size={16} />}>
                                    Check-out: {formatDistanceToNow(new Date(job.worker_checkout_at), { addSuffix: true, locale: ptBR })}
                                </StatusLine>
                            )}

                            {!job.worker_checkout_at && job.company_checkout_confirmed_at && (
                                <StatusLine tone="info" icon={<CheckCircle2 size={16} />}>
                                    Empresa registrou sua saída
                                </StatusLine>
                            )}

                            {/* "Vou atrasar 20 minutos" — sem isso não há canal se a empresa nunca abriu o chat. */}
                            <Button
                                variant="secondary"
                                fullWidth
                                onClick={() => handleChat(job)}
                                loading={chattingId === job.id}
                                iconLeft={<MessageCircle size={18} />}
                            >
                                Falar com a empresa
                            </Button>
                        </div>
                    </Card>
                ))}

                {/* ── ABA AGENDADOS ── */}
                {activeTab === 'scheduled' && jobs.scheduled.length === 0 && (
                    <EmptyState title="Nenhum turno agendado no momento." />
                )}
                {activeTab === 'scheduled' && jobs.scheduled.map((job) => (
                    <Card
                        key={job.id}
                        className="flex flex-col md:flex-row justify-between md:items-center gap-4 shadow-[3px_3px_0px_0px_rgba(0,166,81,1)]"
                    >
                        <div className="flex gap-4 items-center min-w-0">
                            <div className="bg-black text-white px-3 py-2 rounded-xl min-w-[64px] text-center flex-shrink-0">
                                <span className="block text-xs font-semibold uppercase">{job.month}</span>
                                <span className="block text-2xl font-bold">{job.day}</span>
                            </div>
                            <div className="min-w-0">
                                <h3 className="font-bold text-lg mb-1.5">{job.title}</h3>
                                <Chip>
                                    <Clock size={14} /> {job.date} • {job.time}
                                </Chip>
                                <p className="text-sm text-gray-600 flex items-center gap-1 mt-2">
                                    <LocalDoTurno location={job.location} />
                                </p>
                            </div>
                        </div>
                        <div className="flex flex-col gap-4 border-t-2 border-gray-100 md:border-t-0 md:border-l-2 pt-4 md:pt-0 md:pl-6 w-full md:w-56 flex-shrink-0">
                            <div className="flex items-end justify-between gap-3">
                                <div>
                                    <span className="block text-xs text-gray-600">Receber</span>
                                    <span className="block text-2xl font-bold tabular-nums text-primary">{formatBRL(job.pay)}</span>
                                </div>
                                <span className="bg-primary-light text-primary text-xs font-semibold px-2.5 py-1 rounded-pill border border-green-200">Contratado</span>
                            </div>
                            <div className="flex flex-col gap-2">
                                <Button
                                    variant="secondary"
                                    fullWidth
                                    onClick={() => handleChat(job)}
                                    loading={chattingId === job.id}
                                    iconLeft={<MessageCircle size={16} />}
                                >
                                    Falar com a empresa
                                </Button>
                                <Button
                                    variant="ghost"
                                    fullWidth
                                    className="!text-red-600 enabled:hover:bg-red-50"
                                    onClick={() => setCancelJob(job)}
                                    iconLeft={<XCircle size={16} />}
                                >
                                    Cancelar turno
                                </Button>
                            </div>
                        </div>
                    </Card>
                ))}

                {/* ── ABA HISTÓRICO ── */}
                {activeTab === 'history' && jobs.history.length === 0 && (
                    <EmptyState title="Seu histórico está vazio." />
                )}
                {activeTab === 'history' && jobs.history.map((job) => (
                    <Card
                        key={job.id}
                        padding="sm"
                        interactive
                        role="button"
                        tabIndex={0}
                        onClick={() => setDetailJob(job)}
                        onKeyDown={(e) => {
                            // Só o próprio card abre o detalhe: Enter/Espaço em "Recibo"/"Avaliar" seguem a ação do botão.
                            if (e.target !== e.currentTarget) return;
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailJob(job); }
                        }}
                        className="cursor-pointer !bg-gray-50 !border-gray-200 hover:!border-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <h3 className="font-semibold text-gray-800 truncate">{job.title}</h3>
                                <p className="text-sm text-gray-600">{job.date} • {job.company_name}</p>
                            </div>
                            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                                <span className="font-bold tabular-nums text-gray-800">{formatBRL(job.pay)}</span>
                                {job.status === 'completed' ? (
                                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2.5 py-1 rounded-pill">
                                        <CheckCircle2 size={12} /> Concluído
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-100 px-2.5 py-1 rounded-pill">
                                        <XCircle size={12} /> {job.status === 'declined' ? 'Recusado' : 'Cancelado'}
                                    </span>
                                )}
                            </div>
                        </div>
                        {job.status === 'completed' && (
                            <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-gray-200">
                                <Button
                                    variant="secondary"
                                    onClick={(e) => { e.stopPropagation(); navigate(`/recibo/${job.job_id}`); }}
                                    iconLeft={<Receipt size={14} />}
                                >
                                    Recibo
                                </Button>
                                {!reviewedJobIds.has(job.job_id) ? (
                                    <Button
                                        variant="primary"
                                        onClick={(e) => { e.stopPropagation(); handleOpenRateModal(job); }}
                                        iconLeft={<Star size={14} />}
                                    >
                                        Avaliar
                                    </Button>
                                ) : (
                                    <span className="text-xs text-gray-600 flex items-center gap-1">
                                        <Star size={12} fill="currentColor" /> Avaliado
                                    </span>
                                )}
                            </div>
                        )}
                    </Card>
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
                    className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
                    onClick={(e) => { if (e.target === e.currentTarget) setDetailJob(null); }}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="detalhe-turno-titulo"
                        className="bg-white rounded-2xl border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] w-full max-w-md p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
                    >
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
                                    <h3 id="detalhe-turno-titulo" className="text-lg font-bold tracking-tight truncate">{detailJob.title}</h3>
                                    <p className="text-sm text-gray-600 truncate">{detailJob.company_name}</p>
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                onClick={() => setDetailJob(null)}
                                aria-label="Fechar"
                                className="w-11 !px-0 flex-shrink-0"
                            >
                                <X size={20} />
                            </Button>
                        </div>

                        {/* Status */}
                        <div className="mb-5">
                            {detailJob.status === 'completed' ? (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-3 py-1.5 rounded-pill">
                                    <CheckCircle2 size={14} /> Concluído
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-100 px-3 py-1.5 rounded-pill">
                                    <XCircle size={14} /> {detailJob.status === 'declined' ? 'Recusado' : 'Cancelado'}
                                </span>
                            )}
                        </div>

                        {/* Grid de infos */}
                        <div className="grid grid-cols-2 gap-3 mb-5">
                            <div className="bg-gray-50 rounded-xl p-3">
                                <p className="text-xs text-gray-600 mb-1">Data</p>
                                <p className="font-semibold text-sm">{detailJob.date}</p>
                            </div>
                            <div className="bg-gray-50 rounded-xl p-3">
                                <p className="text-xs text-gray-600 mb-1">Valor</p>
                                <p className="font-bold text-sm tabular-nums text-primary">{formatBRL(detailJob.pay)}</p>
                            </div>
                            <div className="bg-gray-50 rounded-xl p-3">
                                <p className="text-xs text-gray-600 mb-1 flex items-center gap-1"><LogIn size={12} /> Chegada</p>
                                <p className="font-semibold text-sm tabular-nums">{fmtTime(detailJob.worker_checkin_at)}</p>
                            </div>
                            <div className="bg-gray-50 rounded-xl p-3">
                                <p className="text-xs text-gray-600 mb-1 flex items-center gap-1"><LogOut size={12} /> Saída</p>
                                <p className="font-semibold text-sm tabular-nums">{fmtTime(detailJob.worker_checkout_at)}</p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600 mb-5">
                            <LocalDoTurno location={detailJob.location} size={16} />
                            <span className="text-gray-300">•</span>
                            <Clock size={16} /> {detailJob.time}{detailJob.end_time ? ` - ${detailJob.end_time}` : ''}
                        </div>

                        {/* Avaliação */}
                        {detailJob.status === 'completed' && (
                            reviewedJobIds.has(detailJob.job_id) ? (
                                <div className="flex items-center gap-2 text-sm text-gray-600 border-t-2 border-gray-100 pt-4">
                                    <Star size={16} className="text-yellow-500 fill-yellow-500" /> Você já avaliou esta empresa.
                                </div>
                            ) : (
                                <Button
                                    variant="primary"
                                    size="lg"
                                    fullWidth
                                    onClick={() => { const j = detailJob; setDetailJob(null); handleOpenRateModal(j); }}
                                    iconLeft={<Star size={16} />}
                                >
                                    Avaliar esta empresa
                                </Button>
                            )
                        )}
                    </div>
                </div>
            )}

            {/* Confirmação de cancelamento de turno agendado */}
            {cancelJob && (
                <div
                    className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
                    onClick={(e) => { if (e.target === e.currentTarget && !cancelLoading) setCancelJob(null); }}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="cancelar-turno-titulo"
                        className="bg-white rounded-2xl border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] w-full max-w-sm p-5 sm:p-6"
                    >
                        <div className="flex items-start gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl border-2 border-black bg-red-100 flex items-center justify-center flex-shrink-0">
                                <XCircle size={20} className="text-red-600" />
                            </div>
                            <div>
                                <h3 id="cancelar-turno-titulo" className="text-lg font-bold tracking-tight">Cancelar este turno?</h3>
                                <p className="text-sm text-gray-600 mt-1">
                                    A empresa será avisada e o turno volta a ficar disponível.
                                </p>
                            </div>
                        </div>

                        <div className="bg-gray-50 rounded-xl p-3 mb-5">
                            <p className="font-semibold text-sm">{cancelJob.title}</p>
                            <p className="text-xs text-gray-600">{cancelJob.date} • {cancelJob.time}</p>
                        </div>

                        <div className="flex gap-3">
                            <Button
                                variant="secondary"
                                className="flex-1"
                                onClick={() => setCancelJob(null)}
                                disabled={cancelLoading}
                            >
                                Voltar
                            </Button>
                            <Button
                                variant="danger"
                                className="flex-1"
                                onClick={handleCancelShift}
                                loading={cancelLoading}
                                iconLeft={<XCircle size={18} />}
                            >
                                Cancelar turno
                            </Button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
