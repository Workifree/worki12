import { createContext, useContext, useEffect, useId, useState, useRef } from 'react';
import type { ReactNode } from 'react';
import { useModalDismiss } from '../../hooks/useModalDismiss';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { WalletService } from '../../services/walletService';
import { PaymentRecordService } from '../../services/paymentRecordService';
import { TeamConnectionService } from '../../services/teamConnectionService';
import { useCompanyInvites, useShiftCalls } from '../../hooks/useShiftInvites';
import { ShiftCallModal } from '../../components/team/ShiftCallModal';
import { ShiftCallsPanel } from '../../components/team/ShiftCallsPanel';
import { SosCallButton } from '../../components/team/SosCallButton';
import { ShiftInviteService, normalizePhoneForWhatsApp, buildShiftInviteWhatsAppMessage, hasAttendedShift } from '../../services/shiftInviteService';
import { AttendanceConfirmationService } from '../../services/attendanceConfirmationService';
import { logError } from '../../lib/logger';
import { ArrowLeft, Star, MapPin, Clock, CheckCircle, XCircle, MessageSquare, MessageCircle, UserX, Play, Square, Receipt, Send, Users, X, CalendarClock, Wallet, Copy, Check, Megaphone, Bell, ThumbsUp, ThumbsDown } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useToast } from '../../contexts/ToastContext';
import JobLifecycleStepper from '../../components/JobLifecycleStepper';
import { Button, Card, Field, PageHeader } from '../../components/ui';
import { todayLocalDate, formatDateOnly } from '../../lib/dateUtils';
import type {
    Application,
    PaymentSource,
    ShiftPayment,
    TeamMember,
    ShiftAttendanceConfirmation,
    AttendanceConfirmationOutcome,
} from '../../types';
import { getAuthenticatedCompanyId } from '../../services/companyScopeService';

// ---------------------------------------------------------------------------
// Confirmação de véspera (D-1) — helpers puros (module scope, sem estado de componente),
// mesmo padrão de `isInviteExpired`/`isInviteCancelledUnanswered` abaixo.
// ---------------------------------------------------------------------------

/** Janela de anti-spam da RPC `request_attendance_confirmation` (ver ddl-aprovado.md). */
const CONFIRMATION_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const CONFIRMATION_REQUEST_CAP = 2;

interface ConfirmationSummary {
    response: ShiftAttendanceConfirmation['response'];
    requestCount: number;
    lastRequestedAt: string | null;
}

/**
 * Reduz as N linhas de `shift_attendance_confirmations` de uma application (1 auto + até 1
 * manual, ou 2 manuais) num resumo único para a UI. A resposta (quando existe) é sempre a MESMA
 * em todas as linhas da application — a RPC `respond_attendance_confirmation` grava na primeira
 * `response IS NULL` e é idempotente por linha, mas o pedido em si pode ter sido feito 1x ou 2x.
 */
function summarizeConfirmation(rows: ShiftAttendanceConfirmation[] | undefined): ConfirmationSummary {
    if (!rows || rows.length === 0) return { response: null, requestCount: 0, lastRequestedAt: null };
    const responded = rows.find((r) => r.response !== null);
    const lastRequestedAt = rows.reduce<string | null>(
        (max, r) => (!max || r.requested_at > max ? r.requested_at : max),
        null,
    );
    return { response: responded?.response ?? null, requestCount: rows.length, lastRequestedAt };
}

/** ms restantes de cooldown (0 = já pode pedir de novo). Espelha a checagem da RPC, só para UX
 * (o servidor é a fonte de verdade final — ver `handleRequestConfirmation`). */
function confirmationCooldownRemainingMs(lastRequestedAt: string | null): number {
    if (!lastRequestedAt) return 0;
    const elapsed = Date.now() - new Date(lastRequestedAt).getTime();
    return Math.max(0, CONFIRMATION_COOLDOWN_MS - elapsed);
}

function formatCooldownRemaining(ms: number): string {
    const totalMinutes = Math.ceil(ms / (60 * 1000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}min` : ''}`;
    return `${Math.max(1, minutes)}min`;
}

/** Mensagens humanas para os outcomes de NEGAÇÃO/erro de `request_attendance_confirmation`.
 * 'requested' e 'cooldown' têm tratamento dedicado no handler (o segundo precisa do `retryAfter`). */
const CONFIRMATION_REQUEST_MESSAGES: Partial<Record<AttendanceConfirmationOutcome, string>> = {
    forbidden: 'Você não tem permissão para pedir confirmação neste turno.',
    invalid_status: 'Este freela não está mais contratado para este turno.',
    job_inactive: 'Este turno não está mais ativo.',
    job_past: 'Este turno já passou.',
    already_responded: 'Este freela já respondeu — não é necessário pedir de novo.',
    limit_reached: 'Limite de 2 pedidos de confirmação atingido para este freela.',
    unauthenticated: 'Sessão expirada. Faça login novamente.',
    not_found: 'Não foi possível localizar este pedido.',
};

/**
 * Convite expirado sem resposta do freela (R8 — expiração deriva na leitura, sem escrever no
 * banco). Não depende de migration. Cobre os DOIS estados de forma consistente:
 *  - antes do cron: ainda `status='invited'` com `invitation_expires_at` no passado;
 *  - depois do cron `expire-invites`: `status='declined'` com `invitation_response` NULL
 *    (expiração automática ≠ recusa ativa do worker, que tem `invitation_response='declined'`).
 */
function isInviteExpired(app: Application): boolean {
  const pastDeadline =
    !!app.invitation_expires_at && new Date(app.invitation_expires_at) < new Date();
  return (
    (app.status === 'invited' && pastDeadline) ||
    (app.status === 'declined' && !app.invitation_response && pastDeadline)
  );
}

/**
 * Convite cancelado pela EMPRESA antes de qualquer resposta do freela (onda 3 — "Cancelar
 * Convite"). Distingue de forma confiável de "freela cancelou o turno que aceitou"
 * (também `status='cancelled'`, mas nesse caso `invitation_response='accepted'` — o freela
 * só cancela DEPOIS de ter aceitado). Sem coluna nova: usa a combinação
 * `invited_by_company_at` preenchido (veio de convite push) + `invitation_response` nulo
 * (nunca respondeu) para identificar exatamente esse caminho.
 */
function isInviteCancelledUnanswered(app: Application): boolean {
  return app.status === 'cancelled' && !!app.invited_by_company_at && !app.invitation_response;
}

const PAYMENT_SOURCE_LABELS: Record<PaymentSource, string> = {
    external_pix: 'PIX',
    cash: 'Dinheiro',
    other: 'Outro',
};

/**
 * Monta o timestamp ISO absoluto do fallback manual de chegada/saída — quando a EMPRESA
 * confirma um horário que o freela não marcou no app (bar fecha às 02h, gerente só registra
 * às 09h da manhã seguinte: gravar `now()` faria o recibo mentir "Saída 09:00" e ~13h
 * trabalhadas, para sempre — `shift_payments`/o registro de presença não são editáveis depois).
 *
 * Base: data do turno (`jobStartDate`, YYYY-MM-DD) + horário HH:MM informado no modal (nunca
 * `now()`). Turno que vira a noite (ex.: entra 18h, sai 02h) tem a SAÍDA no dia seguinte ao
 * `start_date` — se o horário informado for "menor" que a referência de entrada, soma 1 dia.
 * Sem isso, `ReceiptView` (que calcula horas por subtração de timestamps absolutos) sairia
 * com "menos 16 horas" em vez de 8.
 *
 * Referência de entrada para decidir o rollover da SAÍDA, em ordem de confiança: a chegada já
 * registrada de fato (do freela, ou já confirmada pela empresa nesta mesma tela) quando
 * existir; senão o horário PLANEJADO do turno (`work_start_time`). Chegada nunca rola de dia
 * (é sempre a data do turno).
 */
function buildManualAttendanceTimestamp(
    app: Application,
    jobStartDate: string,
    jobStartTime: string | null,
    type: 'checkin' | 'checkout',
    timeHHmm: string,
): string | null {
    if (!jobStartDate || !timeHHmm) return null;
    const [y, m, d] = jobStartDate.split('-').map(Number);
    const [h, min] = timeHHmm.split(':').map(Number);
    if (![y, m, d, h, min].every(Number.isFinite)) return null;

    let dayOffset = 0;
    if (type === 'checkout') {
        const checkinIso = app.worker_checkin_at ?? app.company_checkin_confirmed_at ?? null;
        let refMinutes: number | null = null;
        if (checkinIso) {
            const ref = new Date(checkinIso);
            refMinutes = ref.getHours() * 60 + ref.getMinutes();
        } else if (jobStartTime) {
            const [startH, startM] = jobStartTime.slice(0, 5).split(':').map(Number);
            if (Number.isFinite(startH) && Number.isFinite(startM)) refMinutes = startH * 60 + startM;
        }
        if (refMinutes !== null && (h * 60 + min) < refMinutes) dayOffset = 1;
    }

    const date = new Date(y, m - 1, d + dayOffset, h, min, 0, 0);
    return date.toISOString();
}

// Fase 2 (piloto push-only): fluxo PULL "Contratar" aposentado — feed público escondido, contratação
// é 100% via convite do Elenco (push). O pull-hire dispara reserve_escrow (HARD-requer saldo), o que
// contradiz o pagamento opcional (modo A, ADR-20260630). Religar na Fase 2 = flip para true.
const PULL_HIRE_ENABLED = false;

// ── Primitivos locais de apresentação ───────────────────────────────────────────────────────
/** Botão só-ícone (alvo de toque 44px) sobre o `Button` ghost. */
const ICON_BUTTON_CLASS = '!px-0 w-11 shrink-0';
/** Ação destrutiva de baixa ênfase (Estornar, Dispensar, Cancelar Convite): ghost em vermelho. */
const DESTRUCTIVE_GHOST_CLASS = '!text-red-600 enabled:hover:!bg-red-50';

type ChipTone = 'neutral' | 'muted' | 'info' | 'success' | 'warning' | 'danger';
const CHIP_TONES: Record<ChipTone, string> = {
    neutral: 'border-gray-300 bg-gray-100 text-gray-700',
    muted: 'border-gray-200 bg-gray-50 text-gray-600',
    info: 'border-blue-200 bg-blue-50 text-blue-700',
    success: 'border-green-200 bg-green-50 text-green-700',
    warning: 'border-yellow-200 bg-yellow-50 text-yellow-800',
    danger: 'border-red-200 bg-red-50 text-red-600',
};

/** Pílula de estado (não clicável) — distinta de botão: sem sombra, sem borda preta. */
function StatusChip({ tone, icon, children }: { tone: ChipTone; icon?: ReactNode; children: ReactNode }) {
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${CHIP_TONES[tone]}`}>
            {icon}
            {children}
        </span>
    );
}

/** Id do título do modal corrente — liga `aria-labelledby` da casca ao `ModalTitle` filho. */
const ModalTitleIdContext = createContext<string | undefined>(undefined);

/**
 * Casca padrão dos modais desta tela (overlay + caixa neo-brutalista). Overlay em z-[70] para
 * ficar ACIMA da BottomNav (z-50). Semântica de diálogo (role/aria-modal/aria-labelledby) vive
 * aqui, uma vez; cada modal só precisa renderizar o título com `ModalTitle`.
 */
function ModalShell({ onBackdropClick, children }: { onBackdropClick: (e: React.MouseEvent<HTMLElement>) => void; children: ReactNode }) {
    const titleId = useId();
    return (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200" onClick={onBackdropClick}>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="bg-white rounded-2xl w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 sm:p-6 border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
            >
                <ModalTitleIdContext.Provider value={titleId}>{children}</ModalTitleIdContext.Provider>
            </div>
        </div>
    );
}

/** Título do modal — recebe o id que a `ModalShell` referencia em `aria-labelledby`. */
function ModalTitle({ as: Tag = 'h2', className, children }: { as?: 'h2' | 'h3'; className?: string; children: ReactNode }) {
    const id = useContext(ModalTitleIdContext);
    return <Tag id={id} className={className}>{children}</Tag>;
}

export default function CompanyJobCandidates() {
    const { id } = useParams();
    const navigate = useNavigate();

    const [candidates, setCandidates] = useState<Application[]>([]);
    const [jobTitle, setJobTitle] = useState('');
    // F8 — advisory, nunca trava: repassado ao ShiftCallModal como banner de uma linha (R11).
    const [jobCertificationRequirement, setJobCertificationRequirement] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [ratingModalOpen, setRatingModalOpen] = useState(false);
    const [selectedApp, setSelectedApp] = useState<Application | null>(null);
    const [rating, setRating] = useState(5);
    const [comment, setComment] = useState('');
    const [submittingReview, setSubmittingReview] = useState(false);
    const [confirmingCheckin, setConfirmingCheckin] = useState<string | null>(null);
    // Fallback manual de chegada/saída — só quando o freela NÃO marcou (worker_checkin_at/
    // worker_checkout_at ausente). Pede o horário real em vez de gravar o momento do clique.
    const [manualAttendance, setManualAttendance] = useState<{ app: Application; type: 'checkin' | 'checkout' } | null>(null);
    const [manualAttendanceTime, setManualAttendanceTime] = useState('');
    const [confirmingManualAttendance, setConfirmingManualAttendance] = useState(false);
    const [confirmDeliveryApp, setConfirmDeliveryApp] = useState<Application | null>(null);
    const [releasing, setReleasing] = useState(false);
    // Modo A (pagamento externo declaratório) — ramifica por escrow.kind por application.
    // Sem entrada no map = turno sem escrow (modo A); 'prepaid'/'postpaid' = caminho de escrow existente.
    const [escrowKindMap, setEscrowKindMap] = useState<Record<string, 'prepaid' | 'postpaid'>>({});
    const [jobBudget, setJobBudget] = useState(0);
    // Registro de pagamento externo (modo A) por freela (ADR-20260816 — o marcador é por
    // (job_id, worker_id), não mais por job_id sozinho: um turno com N freelas tem N
    // marcadores independentes). Cada card olha só a própria entrada deste mapa.
    const [paymentByWorker, setPaymentByWorker] = useState<Record<string, ShiftPayment>>({});

    // Dados do turno + empresa usados só para montar a mensagem pronta do WhatsApp (onda 3).
    const [jobLocation, setJobLocation] = useState('');
    const [jobStartDate, setJobStartDate] = useState('');
    const [jobStartTime, setJobStartTime] = useState<string | null>(null);
    const [jobEndTime, setJobEndTime] = useState<string | null>(null);
    const [companyName, setCompanyName] = useState('');

    // Chamado de turno (F1): quantas vagas o turno tem e o modal de disparo múltiplo.
    const [jobSlots, setJobSlots] = useState(1);
    const [callModalOpen, setCallModalOpen] = useState(false);

    // `?chamar=1` — a ponte que faltava entre CRIAR e CHAMAR: o modal pos-criacao do turno agora
    // oferece "chamar varios de uma vez" e cai aqui com o chamado 1->N JA ABERTO, em vez de
    // largar a pessoa numa pagina onde ela precisa reencontrar o botao. Abre UMA vez (ref), para
    // um F5 nao reabrir o modal em cima de quem ja o fechou.
    const [chamarParams] = useSearchParams();
    const chamarAoChegar = useRef(chamarParams.get('chamar') === '1');
    useEffect(() => {
        if (chamarAoChegar.current) {
            chamarAoChegar.current = false;
            setCallModalOpen(true);
        }
    }, []);

    // "Cancelar Convite" — invited sem resposta, libera o slot (onda 3).
    const [cancelInviteId, setCancelInviteId] = useState<string | null>(null);

    // "Dispensar deste turno" — hired/in_progress, exige confirmação explícita (onda 3).
    const [dismissApp, setDismissApp] = useState<Application | null>(null);
    const [dismissing, setDismissing] = useState(false);
    // Confirmação de véspera (F4, blocker 3 do ddl-aprovado.md): quando true, o modal de
    // dispensa encadeia a abertura do Chamado de Turno (F1) LOGO DEPOIS do dispensar ter sucesso
    // — nunca antes (senão o turno continua cheio e o chamado fecha sozinho como 'filled').
    const [dismissThenCall, setDismissThenCall] = useState(false);

    // Confirmação de véspera (D-1) — linhas de `shift_attendance_confirmations` deste turno,
    // agrupadas por application_id (1 auto + até 1 manual por freela).
    const [confirmationsByApp, setConfirmationsByApp] = useState<Record<string, ShiftAttendanceConfirmation[]>>({});
    const [requestingConfirmationId, setRequestingConfirmationId] = useState<string | null>(null);

    // Modal "Registrar pagamento" (modo A)
    const [paymentModalApp, setPaymentModalApp] = useState<Application | null>(null);
    const [paymentSource, setPaymentSource] = useState<PaymentSource>('external_pix');
    const [paymentAmount, setPaymentAmount] = useState(0);
    const [paymentPaidAt, setPaymentPaidAt] = useState(() => todayLocalDate());
    const [paymentNote, setPaymentNote] = useState('');
    const [recordingPayment, setRecordingPayment] = useState(false);
    const [paymentRecorded, setPaymentRecorded] = useState(false);
    // R1.4: copiar a chave PIX do freela direto dos modais de pagamento (modo A).
    const [pixCopied, setPixCopied] = useState(false);

    // Modal "Agendar pagamento" (modo A — ADR-20260712, promessa com data prevista)
    const [scheduleModalApp, setScheduleModalApp] = useState<Application | null>(null);
    const [scheduleSource, setScheduleSource] = useState<PaymentSource>('external_pix');
    const [scheduleAmount, setScheduleAmount] = useState(0);
    const [scheduledFor, setScheduledFor] = useState(() => todayLocalDate());
    const [scheduleNote, setScheduleNote] = useState('');
    const [scheduling, setScheduling] = useState(false);
    const [paymentScheduled, setPaymentScheduled] = useState(false);
    // Efetivação de um pagamento já agendado ("Marcar como pago") — guarda o id em efetivação.
    const [effectivatingId, setEffectivatingId] = useState<string | null>(null);
    // Estorno de marcador de pagamento (scheduled|recorded → voided). Nao havia UI: voidPayment
    // existia no service mas nenhum botao o chamava, entao a empresa nao conseguia desfazer um
    // pagamento nem re-dispensar um freela com marcador ativo (a guarda de dismiss exige void antes).
    const [voidingPayment, setVoidingPayment] = useState<ShiftPayment | null>(null);
    const [voidReason, setVoidReason] = useState('');
    const [voidSubmitting, setVoidSubmitting] = useState(false);

    // "Convidar outro" — convite expirado sem resposta; o slot está livre para outro freela (R8).
    const [reopenApp, setReopenApp] = useState<Application | null>(null);
    const [reopenTeamMembers, setReopenTeamMembers] = useState<TeamMember[]>([]);
    const [reopenLoading, setReopenLoading] = useState(false);
    // "Convidar Freela" — vaga criada sem nenhum freela atrelado (mesmo picker, sem convite anterior).
    const [invitePickerOpen, setInvitePickerOpen] = useState(false);

    // ── Saida de emergencia dos 7 modais inline desta pagina (heuristica #3) ────────────────
    // Mesmo contrato dos modais componentizados (useModalDismiss): ESC e toque no fundo fecham
    // o modal ABERTO — e NUNCA no meio de uma gravacao (guarda pelas flags de em-andamento).
    // O ShiftCallModal fica fora da cadeia: ele ja tem o proprio ESC/fundo no componente.
    // So um modal abre por vez; a cadeia fecha o primeiro que encontrar aberto.
    const fecharModalAberto = () => {
        if (submittingReview || confirmingManualAttendance || dismissing || scheduling || releasing || voidSubmitting) return;
        if (voidingPayment) { setVoidingPayment(null); setVoidReason(''); }
        else if (ratingModalOpen) setRatingModalOpen(false);
        else if (scheduleModalApp) setScheduleModalApp(null);
        else if (paymentModalApp) setPaymentModalApp(null);
        else if (dismissApp) { setDismissApp(null); setDismissThenCall(false); }
        else if (manualAttendance) setManualAttendance(null);
        else if (confirmDeliveryApp) setConfirmDeliveryApp(null);
        else if (invitePickerOpen) setInvitePickerOpen(false);
        else if (reopenApp) setReopenApp(null);
    };
    useModalDismiss(fecharModalAberto);
    const aoTocarFundo = (e: React.MouseEvent<HTMLElement>) => {
        if (e.target === e.currentTarget) fecharModalAberto();
    };

    const { addToast } = useToast();
    // Reaproveita o hook do fluxo de convite (mesmo usado em CompanyCreateJob) para disparar
    // um novo convite a partir desta tela quando o anterior expirou sem resposta.
    const { invite: sendReopenInvite, invitingWorkerId: reopenInvitingWorkerId } = useCompanyInvites(id ?? '');
    const {
        calls,
        loading: callsLoading,
        cancellingId: cancellingCallId,
        cancel: cancelCall,
        refresh: refreshCalls,
    } = useShiftCalls(id ?? '');

    // Posições já ocupadas do turno. Usa os MESMOS status que a RPC `claim_shift_slot` conta —
    // se os dois divergirem, a tela mostra vaga aberta que o banco recusa (ou o contrário).
    const filledCount = candidates.filter((app) =>
        ['hired', 'in_progress', 'completed'].includes(app.status),
    ).length;

    // Quem não deve aparecer no modal de chamado: já está no turno em qualquer estado vivo, ou
    // já foi chamado num chamado ainda aberto (chamar de novo só geraria ruído no celular dele).
    const workerIdsInShift = candidates
        .filter((app) => app.status !== 'cancelled' && app.status !== 'declined')
        .map((app) => app.worker_id);
    const workerIdsPendingCall = calls
        .filter((call) => call.status === 'open')
        .flatMap((call) => (call.targets ?? []).filter((t) => !t.response).map((t) => t.worker_id));

    useEffect(() => {
        if (id) fetchCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchCandidates usa state setters estaveis, so precisa re-executar quando id muda
    }, [id]);

    const fetchCandidates = async () => {
        // G3: guarda de id falsy — o useEffect já checa `if (id)` antes de chamar,
        // mas repetimos aqui pra nunca consultar `jobs?id=eq.null`/`applications?job_id=eq.null`
        // mesmo se essa função for chamada de outro lugar (ex.: `fetchCandidates()` após ações).
        if (!id) { navigate('/company/jobs'); return; }
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { navigate('/login'); return; }

            // Fetch Job Title (only if owned by this company)
            const { data: job, error: jobError } = await supabase
                .from('jobs')
                .select('title, budget, location, start_date, work_start_time, work_end_time, slots, certification_requirement')
                .eq('id', id)
                .eq('company_id', await getAuthenticatedCompanyId())
                .single();
            if (jobError || !job) { navigate('/company/jobs'); return; }
            setJobTitle(job.title);
            setJobCertificationRequirement(job.certification_requirement ?? null);
            setJobBudget(job.budget ?? 0);
            setJobSlots(job.slots ?? 1);
            setJobLocation(job.location ?? '');
            setJobStartDate(job.start_date ?? '');
            setJobStartTime(job.work_start_time ?? null);
            setJobEndTime(job.work_end_time ?? null);

            // Nome da empresa (companies.id === owner_id === auth.uid(), 1:1) — só para
            // montar a mensagem do WhatsApp (onda 3), best-effort.
            const { data: companyRow } = await supabase.from('companies').select('name').eq('id', user.id).maybeSingle();
            setCompanyName(companyRow?.name ?? '');

            // Fetch Applications with Worker Profile (using 'workers' table now)
            // Minimização de dado (LGPD, harness-security-reviewer): traz só as colunas que esta
            // tela de fato consome — NÃO `worker:workers(*)`, que trazia cpf/birth_date sem uso.
            const { data, error } = await supabase
                .from('applications')
                .select(`
                    *,
                    worker:workers(id, full_name, avatar_url, primary_role, rating_average, reviews_count, city, tags, level, phone, pix_key),
                    worker_checkin_at,
                    worker_checkout_at,
                    company_checkin_confirmed_at,
                    company_checkout_confirmed_at
                `)
                .eq('job_id', id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setCandidates(data || []);

            // Fetch escrow kind per application for this job (só o kind é usado para ramificar
            // Confirmar Entrega vs Registrar Pagamento — ver `renderCompletionAction`).
            const { data: escrowRows } = await supabase
                .from('escrow_transactions')
                .select('application_id, kind')
                .eq('job_id', id);
            const kindMap: Record<string, 'prepaid' | 'postpaid'> = {};
            (escrowRows || []).forEach((row) => {
                if (row.application_id && (row.kind === 'prepaid' || row.kind === 'postpaid')) {
                    kindMap[row.application_id] = row.kind;
                }
            });
            setEscrowKindMap(kindMap);

            // Modo A: registros de pagamento externo já feitos para este turno — um por
            // freela (ADR-20260816). `listActivePaymentsByJob` devolve 0..N linhas; hoje
            // (banco ainda sem a migration) no máximo 1, mas o mapa já fica pronto para N.
            const payments = await PaymentRecordService.listActivePaymentsByJob(id);
            const byWorker: Record<string, ShiftPayment> = {};
            payments.forEach((p) => { byWorker[p.worker_id] = p; });
            setPaymentByWorker(byWorker);

            // Confirmação de véspera (D-1) — try/catch isolado: uma falha aqui não pode derrubar
            // o carregamento dos candidatos (checagem/pagamento continuam funcionando sem isso).
            try {
                const confirmationRows = await AttendanceConfirmationService.getConfirmationsForJob(id);
                const byApp: Record<string, ShiftAttendanceConfirmation[]> = {};
                confirmationRows.forEach((row) => {
                    (byApp[row.application_id] ??= []).push(row);
                });
                setConfirmationsByApp(byApp);
            } catch (confirmationError) {
                logError('CompanyJobCandidates.fetchConfirmations', confirmationError);
            }
        } catch (error) {
            logError('CompanyJobCandidates', error);
        } finally {
            setLoading(false);
        }
    };

    // `.select('id')` obrigatório (padrão `removeFromTeam`/patterns.md — DELETE/UPDATE sob
    // RLS negado silenciosamente): sem checar `data`, um UPDATE negado pela policy USING (0
    // linhas, sem erro) reportaria "status atualizado" com o banco intocado.
    const handleUpdateStatus = async (appId: string, newStatus: string) => {
        const { data, error } = await supabase.from('applications').update({ status: newStatus }).eq('id', appId).select('id');

        if (error) {
            logError('CompanyJobCandidates: handleUpdateStatus', error);
            // Fluxo pull legado: "hired" dispara o trigger auto_reserve_escrow_on_hire, que
            // reserva escrow atômico (RAISE EXCEPTION em Postgres se saldo insuficiente). A
            // mensagem do Postgres já é clara ("Saldo insuficiente...") — repassamos ela em vez
            // de um texto genérico. Nenhuma RPC/trigger foi alterada aqui, só o texto exibido.
            addToast(error.message || 'Erro ao atualizar status do freela.', 'error');
            return;
        }
        if (!data || data.length === 0) {
            addToast('Não foi possível atualizar o status deste freela. Atualize a página e tente novamente.', 'error');
            return;
        }

        if (newStatus === 'hired') {
            addToast('Freela contratado! O turno agora está em andamento.', 'success');
        }
        fetchCandidates();
    };

    const handleConfirmDelivery = async (app: Application) => {
        setReleasing(true);
        // Slice 2: ramifica por escrow.kind — postpaid captura o hold no cartao; prepaid libera escrow legado.
        const result = await WalletService.releaseOrCaptureEscrow(app.job_id, app.worker_id);
        if (!result.success) {
            addToast('Erro ao liberar pagamento. Tente novamente.', 'error');
            setReleasing(false);
            return;
        }
        // `.select('id')` obrigatório (padrão `removeFromTeam`/patterns.md) — ver
        // `handleUpdateStatus` acima para o raciocínio completo.
        const { data: updatedApp, error: updateError } = await supabase.from('applications').update({ status: 'completed' }).eq('id', app.id).select('id');
        if (updateError || !updatedApp || updatedApp.length === 0) {
            logError('CompanyJobCandidates: handleConfirmDelivery.updateStatus', updateError ?? new Error('0 linhas afetadas'));
            addToast('Pagamento liberado, mas houve erro ao atualizar status. Contate o suporte.', 'error');
            setReleasing(false);
            setConfirmDeliveryApp(null);
            fetchCandidates();
            return;
        }
        setConfirmDeliveryApp(null);
        setReleasing(false);
        addToast('Entrega confirmada! Pagamento liberado ao profissional.', 'success');
        fetchCandidates();
    };

    // "Cancelar Convite" (onda 3) — invited sem resposta, libera o slot para convidar outro
    // membro da equipe. Sem notificação simétrica ao freela (ver comentário do service).
    const handleCancelInvite = async (app: Application) => {
        setCancelInviteId(app.id);
        try {
            const result = await ShiftInviteService.cancelInvite(app.id);
            if (!result.success) {
                addToast(result.error || 'Não foi possível cancelar o convite.', 'error');
                return;
            }
            addToast('Convite cancelado. Você pode convidar outro freela.', 'success');
            fetchCandidates();
        } finally {
            setCancelInviteId(null);
        }
    };

    // "Dispensar deste turno" (onda 3) — hired/in_progress, gesto sério: exige confirmação
    // explícita no modal (dismissApp) antes de chamar o service.
    //
    // F4 (blocker 3 do ddl-aprovado.md): quando `dismissThenCall` está marcado, o CTA que trouxe
    // até aqui foi "Dispensar e chamar substituto" — SÓ DEPOIS do dispensar ter sucesso é que o
    // Chamado de Turno (F1) abre. Nunca na ordem inversa: `claim_shift_slot` conta ocupação como
    // hired/in_progress/completed, então abrir o chamado com o freela ainda 'hired' faria o
    // próprio chamado se fechar sozinho como 'filled' e notificar "vaga preenchida" para gente
    // que nunca teve chance. `await fetchCandidates()` (não fire-and-forget) garante que
    // `excludeWorkerIds` já reflete o status 'cancelled' antes do modal do F1 montar.
    const handleDismissFromShift = async () => {
        if (!dismissApp) return;
        setDismissing(true);
        try {
            const result = await ShiftInviteService.dismissFromShift(dismissApp.id);
            if (!result.success) {
                addToast(result.error || 'Não foi possível dispensar o freela.', 'error');
                return;
            }
            addToast('Freela dispensado deste turno.', 'success');
            const shouldOpenCallModal = dismissThenCall;
            setDismissApp(null);
            setDismissThenCall(false);
            await fetchCandidates();
            if (shouldOpenCallModal) {
                setCallModalOpen(true);
            }
        } finally {
            setDismissing(false);
        }
    };

    // "Pedir confirmação" (F4) — disparo manual, fallback/lembrete ao lote automático D-1
    // (`request_attendance_confirmations_due`, fora do frontend). A RPC valida tudo de novo no
    // servidor (teto de 2 pedidos + cooldown de 6h) — os cálculos locais (`confirmationCooldownRemainingMs`)
    // só desabilitam o botão preventivamente; o outcome do servidor é sempre a última palavra.
    const handleRequestConfirmation = async (applicationId: string) => {
        setRequestingConfirmationId(applicationId);
        try {
            const result = await AttendanceConfirmationService.requestConfirmation(applicationId);
            if (result.outcome === 'requested') {
                addToast('Pedido de confirmação enviado ao freela.', 'success');
                fetchCandidates();
                return;
            }
            if (result.outcome === 'cooldown') {
                const retryLabel = result.retryAfter
                    ? ` Disponível ${formatDistanceToNow(new Date(result.retryAfter), { addSuffix: true, locale: ptBR })}.`
                    : '';
                addToast(`Aguarde o intervalo de 6h entre pedidos.${retryLabel}`, 'info');
                return;
            }
            addToast(
                CONFIRMATION_REQUEST_MESSAGES[result.outcome] ?? result.error ?? 'Não foi possível pedir confirmação.',
                'error',
            );
        } catch (err) {
            logError('CompanyJobCandidates.handleRequestConfirmation', err);
            addToast('Erro ao pedir confirmação.', 'error');
        } finally {
            setRequestingConfirmationId(null);
        }
    };

    // "Avisar no WhatsApp" (onda 3) — zero backend: monta a mensagem com os dados reais do
    // turno já carregados na tela e abre o `wa.me` numa aba nova. Sem telefone válido, não faz nada
    // (o botão já vem desabilitado/oculto nesse caso — ver render).
    const handleWhatsAppNotify = (app: Application) => {
        const phone = normalizePhoneForWhatsApp(app.worker?.phone ?? null);
        if (!phone) return;
        // PostgREST devolve `HH:MM:SS` (`work_start_time`/`work_end_time` são `time`) — fatiar
        // pros primeiros 5 chars, senão a mensagem sai "(08:00:00 às 17:00:00)". Mesmo padrão
        // defensivo de `CompanyJobs.tsx`.
        const startLabel = jobStartTime?.slice(0, 5) ?? null;
        const endLabel = jobEndTime?.slice(0, 5) ?? null;
        const timeLabel = startLabel ? `${startLabel}${endLabel ? ` às ${endLabel}` : ''}` : null;
        const message = buildShiftInviteWhatsAppMessage({
            companyName,
            jobTitle,
            dateLabel: jobStartDate ? formatDateOnly(jobStartDate, 'dd/MM/yyyy') : null,
            timeLabel,
            location: jobLocation,
            amount: jobBudget,
            appUrl: `${window.location.origin}/my-jobs`,
        });
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
    };

    // Modo A (pagamento externo) — abre o modal "Registrar pagamento" pré-preenchido com o valor do turno.
    const openPaymentModal = (app: Application) => {
        setPaymentModalApp(app);
        setPaymentSource('external_pix');
        setPaymentAmount(jobBudget);
        setPaymentPaidAt(todayLocalDate());
        setPaymentNote('');
        setPaymentRecorded(false);
    };

    const closePaymentModal = () => {
        setPaymentModalApp(null);
        setPaymentRecorded(false);
    };

    // Modo A (pagamento agendado) — abre o modal "Agendar pagamento" pré-preenchido com o valor do turno.
    const openScheduleModal = (app: Application) => {
        setScheduleModalApp(app);
        setScheduleSource('external_pix');
        setScheduleAmount(jobBudget);
        setScheduledFor(todayLocalDate());
        setScheduleNote('');
        setPaymentScheduled(false);
    };

    const closeScheduleModal = () => {
        setScheduleModalApp(null);
        setPaymentScheduled(false);
    };

    // Abre o picker "Convidar outro" para um convite expirado (status='invited' + prazo vencido).
    // O slot está livre: qualquer outro membro da equipe (que ainda não tenha application para
    // este job) pode ser convidado. Não escreve nada no convite antigo — é só leitura + novo convite.
    const loadReopenMembers = async () => {
        setReopenLoading(true);
        try {
            const members = await TeamConnectionService.listTeamMembers();
            const alreadyOnJob = new Set(candidates.map((c) => c.worker_id));
            setReopenTeamMembers(members.filter((m) => !alreadyOnJob.has(m.worker.id)));
        } catch (error) {
            logError('CompanyJobCandidates: loadReopenMembers', error);
            addToast('Erro ao carregar sua equipe.', 'error');
        } finally {
            setReopenLoading(false);
        }
    };

    const openReopenModal = async (app: Application) => {
        setReopenApp(app);
        await loadReopenMembers();
    };

    // Abre o mesmo picker para uma vaga ainda sem freela atrelado (sem convite anterior).
    const openInvitePicker = async () => {
        setInvitePickerOpen(true);
        await loadReopenMembers();
    };

    const closeReopenModal = () => {
        setReopenApp(null);
        setInvitePickerOpen(false);
        setReopenTeamMembers([]);
    };

    const handlePickReopenWorker = async (workerId: string) => {
        const ok = await sendReopenInvite(workerId);
        if (ok) {
            closeReopenModal();
            fetchCandidates();
        }
    };

    // O service valida o SINAL REAL de conclusão (chegada + saída confirmadas), não o
    // status='completed' — por isso registramos o pagamento PRIMEIRO e só marcamos o
    // turno como concluído DEPOIS que o INSERT tem sucesso. Se o registro falhar (rede/
    // RLS/timeout), a application permanece como estava e o botão "Registrar Pagamento"
    // continua disponível — nunca fica em dead-end (status='completed' sem recibo).
    const handleRecordPayment = async () => {
        if (!paymentModalApp) return;
        if (!(paymentAmount > 0)) {
            addToast('Informe um valor pago maior que zero.', 'error');
            return;
        }
        setRecordingPayment(true);
        try {
            const result = await PaymentRecordService.recordExternalPayment({
                jobId: paymentModalApp.job_id,
                workerId: paymentModalApp.worker_id,
                applicationId: paymentModalApp.id,
                source: paymentSource,
                amount: paymentAmount,
                paidAt: paymentPaidAt,
                note: paymentNote.trim() || undefined,
            });

            if (!result.success) {
                if (result.alreadyRecorded) {
                    addToast('Este freela já tem um pagamento registrado neste turno. Veja o recibo.', 'info');
                    closePaymentModal();
                    fetchCandidates();
                    return;
                }
                addToast(result.error || 'Não foi possível registrar o pagamento.', 'error');
                return;
            }

            // Registro OK — agora sim marcamos o turno como concluído. Falha aqui não
            // desfaz o registro (já é a fonte de verdade do pagamento); só avisamos.
            // `.select('id')` obrigatório (padrão `removeFromTeam`/patterns.md — DELETE/UPDATE
            // sob RLS negado silenciosamente): sem checar `data`, um UPDATE negado pela policy
            // USING reportaria "concluído" com o turno ainda preso em 'hired'/'in_progress' —
            // pago, mas sem saída (dead-end).
            const { data: updatedApp, error: updateError } = await supabase
                .from('applications')
                .update({ status: 'completed' })
                .eq('id', paymentModalApp.id)
                .select('id');
            if (updateError || !updatedApp || updatedApp.length === 0) {
                logError('CompanyJobCandidates: handleRecordPayment.updateStatus', updateError ?? new Error('0 linhas afetadas'));
                addToast('Pagamento registrado, mas houve erro ao concluir o turno. Contate o suporte.', 'error');
            } else {
                addToast('Pagamento registrado com sucesso!', 'success');
            }
            setPaymentRecorded(true);
            fetchCandidates();
        } catch (error) {
            logError('CompanyJobCandidates: handleRecordPayment', error);
            addToast('Erro ao registrar pagamento.', 'error');
        } finally {
            setRecordingPayment(false);
        }
    };

    // ADR-20260712 — agenda a PROMESSA de pagamento (status='scheduled', data prevista).
    // Mesma lógica de "marcar o turno como concluído só após sucesso" do registro imediato:
    // a entrega (chegada+saída confirmadas) já aconteceu, só o pagamento fica pendente.
    const handleSchedulePayment = async () => {
        if (!scheduleModalApp) return;
        if (!(scheduleAmount > 0)) {
            addToast('Informe um valor previsto maior que zero.', 'error');
            return;
        }
        if (!scheduledFor) {
            addToast('Informe a data prevista do pagamento.', 'error');
            return;
        }
        setScheduling(true);
        try {
            const result = await PaymentRecordService.scheduleExternalPayment({
                jobId: scheduleModalApp.job_id,
                workerId: scheduleModalApp.worker_id,
                applicationId: scheduleModalApp.id,
                source: scheduleSource,
                amount: scheduleAmount,
                scheduledFor,
                note: scheduleNote.trim() || undefined,
            });

            if (!result.success) {
                if (result.alreadyActive) {
                    addToast('Este freela já tem um pagamento registrado ou agendado neste turno. Veja o comprovante.', 'info');
                    closeScheduleModal();
                    fetchCandidates();
                    return;
                }
                addToast(result.error || 'Não foi possível agendar o pagamento.', 'error');
                return;
            }

            // `.select('id')` obrigatório (padrão `removeFromTeam`/patterns.md — ver
            // `handleRecordPayment` acima para o raciocínio completo).
            const { data: updatedApp, error: updateError } = await supabase
                .from('applications')
                .update({ status: 'completed' })
                .eq('id', scheduleModalApp.id)
                .select('id');
            if (updateError || !updatedApp || updatedApp.length === 0) {
                logError('CompanyJobCandidates: handleSchedulePayment.updateStatus', updateError ?? new Error('0 linhas afetadas'));
                addToast('Pagamento agendado, mas houve erro ao concluir o turno. Contate o suporte.', 'error');
            } else {
                addToast('Pagamento agendado com sucesso!', 'success');
            }
            setPaymentScheduled(true);
            fetchCandidates();
        } catch (error) {
            logError('CompanyJobCandidates: handleSchedulePayment', error);
            addToast('Erro ao agendar pagamento.', 'error');
        } finally {
            setScheduling(false);
        }
    };

    // Efetiva um pagamento agendado ("Marcar como pago") — scheduled → recorded, grava paid_at real.
    const handleEffectivatePayment = async (paymentId: string) => {
        setEffectivatingId(paymentId);
        try {
            const result = await PaymentRecordService.effectivateScheduledPayment(paymentId);
            if (!result.success) {
                addToast(result.error || 'Não foi possível marcar como pago.', 'error');
                return;
            }
            addToast('Pagamento marcado como pago!', 'success');
            fetchCandidates();
        } catch (error) {
            logError('CompanyJobCandidates: handleEffectivatePayment', error);
            addToast('Erro ao marcar pagamento como pago.', 'error');
        } finally {
            setEffectivatingId(null);
        }
    };

    const handleVoidPayment = async () => {
        if (!voidingPayment) return;
        setVoidSubmitting(true);
        try {
            const result = await PaymentRecordService.voidPayment(voidingPayment.id, voidReason.trim());
            if (!result.success) {
                addToast(result.error || 'Não foi possível estornar o pagamento.', 'error');
                return;
            }
            addToast('Pagamento estornado.', 'success');
            setVoidingPayment(null);
            setVoidReason('');
            fetchCandidates();
        } catch (error) {
            logError('CompanyJobCandidates: handleVoidPayment', error);
            addToast('Erro ao estornar o pagamento.', 'error');
        } finally {
            setVoidSubmitting(false);
        }
    };

    const handleSubmitReview = async () => {
        if (!selectedApp) return;
        setSubmittingReview(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            // Update Application Status to reviewed (best-effort, already completed — o
            // botão "Avaliar" só existe para app.status === 'completed', então este UPDATE é
            // um no-op idempotente na maioria dos casos; `.select('id')` só para observar via
            // log se algum dia deixar de ser no-op sem depender de reclamação de usuário).
            const { data: appData, error: appError } = await supabase
                .from('applications')
                .update({ status: 'completed' })
                .eq('id', selectedApp.id)
                .select('id');

            if (appError) {
                logError('CompanyJobCandidates: app status update failed', appError);
            } else if (!appData || appData.length === 0) {
                logError('CompanyJobCandidates: app status update afetou 0 linhas (RLS negou em silêncio)', { applicationId: selectedApp.id });
            }

            // Create Review (non-critical, best-effort)
            const { error: reviewError } = await supabase.from('reviews').insert({
                job_id: selectedApp.job_id,
                reviewer_id: user.id,
                reviewed_id: selectedApp.worker_id,
                rating: rating,
                comment: comment,
                created_at: new Date().toISOString()
            });

            if (reviewError) {
                logError('CompanyJobCandidates: review error', reviewError);
                if (reviewError.code === '23505') {
                    addToast('Você já avaliou este freela para este turno.', 'error');
                } else {
                    addToast('Erro ao salvar avaliação. Tente novamente.', 'error');
                }
                setSubmittingReview(false);
                setRatingModalOpen(false);
                fetchCandidates();
                return;
            }

            addToast('Avaliação enviada com sucesso!', 'success');

            setRatingModalOpen(false);
            setRating(5);
            setComment('');
            fetchCandidates();

        } catch (error) {
            logError('CompanyJobCandidates', error);
            addToast('Erro ao enviar avaliação.', 'error');
        } finally {
            setSubmittingReview(false);
        }
    };

    const handleChat = async (app: Application) => {
        try {
            // Check if conversation exists
            const { data: existingConvs } = await supabase
                .from('Conversation')
                .select('id')
                .eq('application_uuid', app.id)
                .limit(1);

            if (existingConvs && existingConvs.length > 0) {
                navigate(`/company/messages?conversation=${existingConvs[0].id}`);
            } else {
                // Create new conversation
                const newConvId = crypto.randomUUID();
                const { error } = await supabase
                    .from('Conversation')
                    .insert({
                        id: newConvId,
                        application_uuid: app.id,
                        islocked: false
                    });

                if (error) throw error;
                navigate(`/company/messages?conversation=${newConvId}`);
            }
        } catch (error) {
            logError('CompanyJobCandidates', error);
            addToast('Erro ao iniciar conversa.', 'error');
        }
    };

    // R1.4: copiar a chave PIX do freela — mostrada nos modais "Registrar Pagamento" e
    // "Agendar Pagamento" (modo A: a empresa paga por fora e precisa da chave à mão).
    const handleCopyPix = async (pixKey: string) => {
        try {
            await navigator.clipboard.writeText(pixKey);
            setPixCopied(true);
            addToast('Chave PIX copiada!', 'success');
            setTimeout(() => setPixCopied(false), 2500);
        } catch {
            addToast('Não foi possível copiar a chave PIX.', 'error');
        }
    };

    // `.select('id')` obrigatório (padrão `removeFromTeam`/patterns.md — ver `cancelInvite`/
    // `dismissFromShift` em shiftInviteService.ts): sob RLS, um UPDATE cuja linha não casa mais
    // com a policy USING não gera erro — retorna 0 linhas (PostgREST 204). Sem checar `data`, a
    // tela reportaria "confirmada" mesmo quando o banco não mudou nada.
    const handleConfirmCheckin = async (appId: string) => {
        setConfirmingCheckin(appId);
        try {
            const { data, error } = await supabase
                .from('applications')
                .update({
                    company_checkin_confirmed_at: new Date().toISOString(),
                    status: 'in_progress'
                })
                .eq('id', appId)
                .select('id');

            if (error) throw error;
            if (!data || data.length === 0) {
                addToast('Não foi possível confirmar a chegada deste freela.', 'error');
                return;
            }
            addToast('Chegada confirmada!', 'success');
            fetchCandidates();
        } catch (error) {
            logError('CompanyJobCandidates', error);
            addToast('Erro ao confirmar check-in.', 'error');
        } finally {
            setConfirmingCheckin(null);
        }
    };

    const handleConfirmCheckout = async (appId: string) => {
        // Defesa em profundidade (a UI já esconde este gesto sem chegada confirmada — ver
        // render acima): sem `company_checkin_confirmed_at`, `buildManualAttendanceTimestamp`
        // não tem referência de rollover e as horas do recibo se perdem para sempre.
        const target = candidates.find((c) => c.id === appId);
        if (!target?.company_checkin_confirmed_at) {
            addToast('Confirme a chegada deste freela antes de registrar a saída.', 'error');
            return;
        }
        setConfirmingCheckin(appId);
        try {
            const { data, error } = await supabase
                .from('applications')
                .update({ company_checkout_confirmed_at: new Date().toISOString() })
                .eq('id', appId)
                .select('id');

            if (error) throw error;
            if (!data || data.length === 0) {
                addToast('Não foi possível confirmar a saída deste freela.', 'error');
                return;
            }
            // Este gesto destrava "Registrar Pagamento" — merece confirmação visível, não só
            // um refetch silencioso (a empresa precisa saber que já pode seguir o fluxo).
            addToast('Saída confirmada!', 'success');
            fetchCandidates();
        } catch (error) {
            logError('CompanyJobCandidates', error);
            addToast('Erro ao confirmar check-out.', 'error');
        } finally {
            setConfirmingCheckin(null);
        }
    };

    // Abre o modal de horário manual — usado quando o freela NÃO marcou a chegada/saída no
    // app (o botão vira "Confirmar Presença"/"Registrar Saída"). Pré-preenche com o horário
    // PLANEJADO do turno (`work_start_time`/`work_end_time`), nunca com `now()`: é o melhor
    // palpite (é o que quase sempre aconteceu) e o gerente confirma ou ajusta.
    const openManualAttendanceModal = (app: Application, type: 'checkin' | 'checkout') => {
        // Defesa em profundidade (a UI já esconde este gesto sem chegada confirmada — ver
        // render acima): mesmo motivo de `handleConfirmCheckout`.
        if (type === 'checkout' && !app.company_checkin_confirmed_at) {
            addToast('Confirme a chegada deste freela antes de registrar a saída.', 'error');
            return;
        }
        const plannedTime = type === 'checkin' ? jobStartTime : jobEndTime;
        setManualAttendance({ app, type });
        setManualAttendanceTime(plannedTime ? plannedTime.slice(0, 5) : '');
    };

    const closeManualAttendanceModal = () => {
        setManualAttendance(null);
        setManualAttendanceTime('');
    };

    // Grava o horário REAL informado pela empresa (não `now()`) em `company_checkin_confirmed_at`
    // ou `company_checkout_confirmed_at` — nunca nos campos do freela (`worker_*`), que o
    // trigger `validate_application_update` rejeita a empresa alterar.
    const handleConfirmManualAttendance = async () => {
        if (!manualAttendance || !manualAttendanceTime) return;
        const { app, type } = manualAttendance;
        const timestamp = buildManualAttendanceTimestamp(app, jobStartDate, jobStartTime, type, manualAttendanceTime);
        if (!timestamp) {
            addToast('Informe um horário válido.', 'error');
            return;
        }
        setConfirmingManualAttendance(true);
        try {
            const updatePayload = type === 'checkin'
                ? { company_checkin_confirmed_at: timestamp, status: 'in_progress' }
                : { company_checkout_confirmed_at: timestamp };
            const { data, error } = await supabase
                .from('applications')
                .update(updatePayload)
                .eq('id', app.id)
                .select('id');

            if (error) throw error;
            if (!data || data.length === 0) {
                addToast(
                    type === 'checkin' ? 'Não foi possível confirmar a chegada deste freela.' : 'Não foi possível confirmar a saída deste freela.',
                    'error'
                );
                return;
            }
            addToast(type === 'checkin' ? 'Chegada confirmada!' : 'Saída confirmada!', 'success');
            closeManualAttendanceModal();
            fetchCandidates();
        } catch (error) {
            logError('CompanyJobCandidates: handleConfirmManualAttendance', error);
            addToast('Erro ao confirmar horário.', 'error');
        } finally {
            setConfirmingManualAttendance(false);
        }
    };

    const computeSteps = (app: Application) => {
        const checkinComplete = !!(app.worker_checkin_at && app.company_checkin_confirmed_at);
        const checkinActive = !!(app.worker_checkin_at && !app.company_checkin_confirmed_at);
        // "Saída" fica completa assim que a EMPRESA confirma — inclusive pelo caminho manual
        // (freela foi embora sem apertar "saída" no app; ver `handleConfirmCheckout`). Não
        // exigir `worker_checkout_at` aqui, senão o estágio nunca sai de "pendente" nesse caso.
        const checkoutComplete = !!app.company_checkout_confirmed_at;
        const checkoutActive = !!(app.worker_checkout_at && !app.company_checkout_confirmed_at);

        return [
            { label: 'Contratado', status: 'complete' as const },
            {
                label: 'Chegada',
                status: checkinComplete ? 'complete' as const : checkinActive ? 'active' as const : 'pending' as const
            },
            {
                label: 'Saída',
                status: checkoutComplete ? 'complete' as const : checkoutActive ? 'active' as const : 'pending' as const
            },
            {
                label: 'Entrega',
                status: app.status === 'completed' ? 'complete' as const : 'pending' as const
            }
        ];
    };

    // Bloco de ações para um marcador 'scheduled' (promessa) — reaproveitado no gatilho de
    // conclusão e na seção pós-conclusão (mesma lógica, dois pontos de renderização).
    // Fragmento: os itens entram direto na linha de ações do card (flex-wrap do pai).
    const renderScheduledPaymentBlock = (payment: ShiftPayment) => (
        <>
            {payment.scheduled_for && (
                <StatusChip tone="warning" icon={<CalendarClock size={14} />}>
                    Agendado p/ {formatDateOnly(payment.scheduled_for, 'dd/MM/yyyy')}
                </StatusChip>
            )}
            <Button
                variant="dark"
                onClick={(e) => { e.stopPropagation(); handleEffectivatePayment(payment.id); }}
                loading={effectivatingId === payment.id}
            >
                Marcar como pago
            </Button>
            <Button
                variant="secondary"
                iconLeft={<Receipt size={16} />}
                onClick={(e) => { e.stopPropagation(); navigate(`/recibo/${payment.job_id}?worker=${payment.worker_id}`); }}
            >
                Ver Comprovante
            </Button>
            <Button
                variant="ghost"
                className={DESTRUCTIVE_GHOST_CLASS}
                onClick={(e) => { e.stopPropagation(); setVoidingPayment(payment); setVoidReason(''); }}
            >
                Estornar
            </Button>
        </>
    );

    // Par "Registrar Pagamento" (primário) + "Agendar Pagamento" (secundário) — usado no gatilho
    // de conclusão e na rede de segurança do turno já concluído sem marcador.
    const renderRegisterPaymentActions = (app: Application) => (
        <>
            <Button
                variant="dark"
                onClick={(e) => { e.stopPropagation(); openPaymentModal(app); }}
            >
                Registrar Pagamento
            </Button>
            <Button
                variant="secondary"
                iconLeft={<CalendarClock size={16} />}
                onClick={(e) => { e.stopPropagation(); openScheduleModal(app); }}
            >
                Agendar Pagamento
            </Button>
        </>
    );

    // Ramificação modo A (pagamento externo, registrado OU agendado) vs C (postpago/cartão)
    // vs prepago legado. Sem entrada em escrowKindMap = nenhum escrow reservado para este
    // turno → modo A (default do piloto).
    const renderCompletionAction = (app: Application) => {
        const kind = escrowKindMap[app.id];
        if (kind === 'prepaid' || kind === 'postpaid') {
            return (
                <Button
                    variant="dark"
                    onClick={(e) => { e.stopPropagation(); setConfirmDeliveryApp(app); }}
                >
                    Confirmar Entrega
                </Button>
            );
        }
        const matchingPayment = paymentByWorker[app.worker_id] ?? null;
        if (matchingPayment?.status === 'recorded') {
            return (
                <>
                    <Button
                        variant="secondary"
                        iconLeft={<Receipt size={16} />}
                        onClick={(e) => { e.stopPropagation(); navigate(`/recibo/${app.job_id}?worker=${app.worker_id}`); }}
                    >
                        Ver Recibo
                    </Button>
                    <Button
                        variant="ghost"
                        className={DESTRUCTIVE_GHOST_CLASS}
                        onClick={(e) => { e.stopPropagation(); setVoidingPayment(matchingPayment); setVoidReason(''); }}
                    >
                        Estornar
                    </Button>
                </>
            );
        }
        if (matchingPayment?.status === 'scheduled') {
            return renderScheduledPaymentBlock(matchingPayment);
        }
        return renderRegisterPaymentActions(app);
    };

    return (
        <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
            {/* Header */}
            <Button
                variant="ghost"
                onClick={() => navigate('/company/jobs')}
                iconLeft={<ArrowLeft size={16} />}
                className="-ml-4 mb-1"
            >
                Voltar para Turnos
            </Button>
            <PageHeader
                title="Presença e Pagamento"
                subtitle={`${jobTitle} • ${filledCount} de ${jobSlots} vaga${jobSlots !== 1 ? 's' : ''} preenchida${filledCount !== 1 ? 's' : ''}`}
                action={
                    /* O gesto de 8h30: um clique, vários freelas, quem aceitar primeiro leva.
                       Some quando o turno já está completo — não há vaga para disputar. */
                    filledCount < jobSlots ? (
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                                variant="dark"
                                iconLeft={<Megaphone size={16} />}
                                onClick={() => setCallModalOpen(true)}
                            >
                                Chamar Freelas
                            </Button>
                            {/* F11 — SOS: fallback do chamado ao Elenco. Só habilita quando o Elenco
                                já esgotou e o turno começa em menos de 4h (RPC reverifica tudo). */}
                            {id && (
                                <SosCallButton
                                    jobId={id}
                                    refreshKey={`${calls.length}-${filledCount}`}
                                    onDispatched={() => {
                                        refreshCalls();
                                        void fetchCandidates();
                                    }}
                                />
                            )}
                        </div>
                    ) : undefined
                }
            />

            <ShiftCallsPanel
                calls={calls}
                loading={callsLoading}
                cancellingId={cancellingCallId}
                onCancel={(callId) => void cancelCall(callId)}
            />

            {/* Confirmação de véspera (F4) — resumo agregado do turno (A7). Só conta quem está
                de fato no turno (hired/in_progress); convites pendentes/cancelados/históricos
                não entram na conta. Some quando ninguém nesse grupo foi sequer perguntado ainda
                (revisão pós-evaluator): um turno daqui a três semanas, sem nenhum pedido de
                confirmação disparado, NÃO deve ler "0 confirmados · N sem resposta" — isso
                sugeriria freelas ignorando um pedido que nunca existiu. `noResponse` (perguntado,
                silêncio) e `notAsked` (nunca perguntado) são buckets DISTINTOS, espelhando o
                mesmo gate (`requestCount > 0`) já usado no badge por linha (nunca replicado
                condição a condição — ver `summarizeConfirmation`). */}
            {(() => {
                const activeCandidates = candidates.filter(
                    (app) => app.status === 'hired' || app.status === 'in_progress',
                );
                const summary = activeCandidates.reduce(
                    (acc, app) => {
                        const { response, requestCount } = summarizeConfirmation(confirmationsByApp[app.id]);
                        if (response === 'confirmed') acc.confirmed += 1;
                        else if (response === 'cannot_attend') acc.cannotAttend += 1;
                        else if (requestCount > 0) acc.noResponse += 1;
                        else acc.notAsked += 1;
                        return acc;
                    },
                    { confirmed: 0, cannotAttend: 0, noResponse: 0, notAsked: 0 },
                );
                // Nenhuma confirmação foi pedida para NINGUÉM deste turno ainda — o painel não
                // tem nada verdadeiro a reportar (todo mundo cairia em "notAsked"), então some
                // por inteiro em vez de mostrar um resumo tecnicamente correto mas enganoso.
                const hasAnyConfirmationActivity = summary.confirmed + summary.cannotAttend + summary.noResponse > 0;
                if (activeCandidates.length === 0 || !hasAnyConfirmationActivity) return null;
                return (
                    <Card padding="sm" className="mb-6 flex flex-wrap items-center gap-2">
                        <span className="mr-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                            <CalendarClock size={14} /> Confirmação de véspera
                        </span>
                        <StatusChip tone="success">
                            {summary.confirmed} confirmado{summary.confirmed !== 1 ? 's' : ''}
                        </StatusChip>
                        {summary.noResponse > 0 && (
                            <StatusChip tone="neutral">{summary.noResponse} sem resposta</StatusChip>
                        )}
                        {summary.cannotAttend > 0 && (
                            <StatusChip tone="danger">
                                {summary.cannotAttend} não {summary.cannotAttend === 1 ? 'vem' : 'vêm'}
                            </StatusChip>
                        )}
                        {summary.notAsked > 0 && (
                            <StatusChip tone="muted">
                                {summary.notAsked} não perguntado{summary.notAsked !== 1 ? 's' : ''}
                            </StatusChip>
                        )}
                    </Card>
                );
            })()}

            {/* Candidates List */}
            <div className="space-y-4">
                {loading ? (
                    <div className="space-y-4 animate-pulse">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="bg-gray-200 rounded-2xl h-32" />
                        ))}
                    </div>
                ) : candidates.length === 0 ? (
                    <div className="text-center py-16 px-4 border-2 border-dashed border-gray-300 rounded-2xl">
                        <Users size={40} className="mx-auto mb-3 text-gray-400" />
                        <p className="text-base font-bold text-gray-900">Nenhum freela atrelado a este turno.</p>
                        <p className="text-sm text-gray-600 mt-1 mb-6">Convide um freela do seu elenco para começar.</p>
                        <Button
                            variant="dark"
                            iconLeft={<Send size={16} />}
                            onClick={() => void openInvitePicker()}
                        >
                            Convidar Freela do Elenco
                        </Button>
                    </div>
                ) : (
                    candidates.map((app) => (
                        <Card
                            key={app.id}
                            role="button"
                            tabIndex={0}
                            interactive
                            className="cursor-pointer"
                            onClick={() => navigate(`/company/worker/${app.worker_id}`)}
                            onKeyDown={(e) => {
                                // Só reage ao teclado do próprio card — Enter/Espaço em um botão
                                // interno (ações) não pode navegar nem engolir o clique dele.
                                if (e.target !== e.currentTarget) return;
                                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/company/worker/${app.worker_id}`); }
                            }}
                        >
                            <div className="flex items-start gap-4">
                                {/* Avatar */}
                                <div className="w-14 h-14 shrink-0 rounded-full bg-gray-200 border-2 border-black overflow-hidden">
                                    {app.worker?.avatar_url ? (
                                        <img src={app.worker.avatar_url} alt={app.worker.full_name} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-black text-white font-bold text-lg">
                                            {app.worker?.full_name?.[0] || '?'}
                                        </div>
                                    )}
                                </div>

                                {/* Info */}
                                <div className="min-w-0 flex-1">
                                    <h3 className="flex flex-wrap items-center gap-2 text-lg font-bold leading-tight">
                                        {app.worker?.full_name || 'Usuário Worki'}
                                        <span className="rounded-full bg-black px-2 py-0.5 text-xs font-semibold text-white">Lvl {app.worker?.level || 1}</span>
                                    </h3>
                                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                                        <span className="flex items-center gap-1"><MapPin size={12} /> {app.worker?.city || 'Não informado'}</span>
                                        {/* Sem avaliação, isto mostrava "5.0 (0 avaliações)" -- nota
                                            maxima inventada para quem nunca foi avaliado, no lugar exato
                                            onde a empresa decide quem chamar. "Novo" diz a verdade. */}
                                        {app.worker?.rating_average && (app.worker?.reviews_count ?? 0) > 0 ? (
                                            <span className="flex items-center gap-1">
                                                <Star size={12} className="text-yellow-500 fill-yellow-500" />
                                                {Number(app.worker.rating_average).toFixed(1)}
                                                <span className="text-gray-600">({app.worker.reviews_count === 1 ? '1 avaliação' : `${app.worker.reviews_count} avaliações`})</span>
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1">
                                                <Star size={12} /> Sem avaliações ainda
                                            </span>
                                        )}
                                        <span className="flex items-center gap-1"><Clock size={12} /> Convidado {app.created_at ? formatDistanceToNow(new Date(app.created_at), { addSuffix: true, locale: ptBR }) : '—'}</span>
                                    </div>
                                </div>

                                <div className="-mr-2 -mt-1 flex shrink-0 items-center">
                                    <Button
                                        variant="ghost"
                                        className={ICON_BUTTON_CLASS}
                                        onClick={(e) => { e.stopPropagation(); handleChat(app); }}
                                        title="Chat"
                                        aria-label="Abrir chat com freela"
                                    >
                                        <MessageSquare size={20} />
                                    </Button>
                                    {PULL_HIRE_ENABLED && app.status === 'pending' && (
                                        <>
                                            <Button
                                                variant="ghost"
                                                className={`${ICON_BUTTON_CLASS} !text-red-600 hover:!bg-red-50`}
                                                onClick={(e) => { e.stopPropagation(); handleUpdateStatus(app.id, 'rejected'); }}
                                                title="Descartar"
                                                aria-label="Descartar freela"
                                            >
                                                <XCircle size={20} />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                className={`${ICON_BUTTON_CLASS} !text-primary hover:!bg-primary-light`}
                                                onClick={(e) => { e.stopPropagation(); handleUpdateStatus(app.id, 'interview'); }}
                                                title="Aprovar para Entrevista"
                                                aria-label="Aprovar freela para entrevista"
                                            >
                                                <CheckCircle size={20} />
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Estado + ações: linha própria, largura total (no mobile não espreme o nome). */}
                            {app.status !== 'pending' && (
                                <div className="mt-4 flex flex-wrap items-center gap-2">
                                    {isInviteExpired(app) ? (
                                        <>
                                            <StatusChip tone="neutral">Não respondeu (expirado)</StatusChip>
                                            <Button
                                                variant="dark"
                                                iconLeft={<Send size={16} />}
                                                onClick={(e) => { e.stopPropagation(); void openReopenModal(app); }}
                                            >
                                                Convidar outro
                                            </Button>
                                        </>
                                    ) : isInviteCancelledUnanswered(app) ? (
                                        <>
                                            <StatusChip tone="neutral">Convite cancelado</StatusChip>
                                            <Button
                                                variant="dark"
                                                iconLeft={<Send size={16} />}
                                                onClick={(e) => { e.stopPropagation(); void openReopenModal(app); }}
                                            >
                                                Convidar outro
                                            </Button>
                                        </>
                                    ) : app.status === 'invited' ? (
                                        <>
                                            <StatusChip tone="info">Aguardando resposta</StatusChip>
                                            {app.worker?.phone ? (
                                                <Button
                                                    variant="secondary"
                                                    iconLeft={<MessageCircle size={16} className="text-green-600" />}
                                                    onClick={(e) => { e.stopPropagation(); handleWhatsAppNotify(app); }}
                                                >
                                                    Avisar no WhatsApp
                                                </Button>
                                            ) : (
                                                <span title="Freela sem telefone cadastrado">
                                                    <StatusChip tone="muted">WhatsApp indisponível</StatusChip>
                                                </span>
                                            )}
                                            <Button
                                                variant="ghost"
                                                className={DESTRUCTIVE_GHOST_CLASS}
                                                iconLeft={<X size={16} />}
                                                onClick={(e) => { e.stopPropagation(); void handleCancelInvite(app); }}
                                                loading={cancelInviteId === app.id}
                                            >
                                                Cancelar Convite
                                            </Button>
                                        </>
                                    ) : (
                                        <StatusChip
                                            tone={
                                                app.status === 'hired' ? 'success' :
                                                    app.status === 'in_progress' ? 'warning' :
                                                        app.status === 'completed' ? 'info' :
                                                            app.status === 'rejected' ? 'danger' :
                                                                'info'
                                            }
                                        >
                                            {app.status === 'interview' ? 'Em Entrevista' : app.status === 'hired' ? 'Contratado' : app.status === 'in_progress' ? 'Em Andamento' : app.status === 'completed' ? 'Finalizado' : app.status === 'cancelled' ? 'Dispensado' : app.status === 'declined' ? 'Recusou' : app.status === 'expired' ? 'Expirou' : 'Descartado'}
                                        </StatusChip>
                                    )}

                                    {/* Em entrevista, o chat já está no ícone do topo do card — aqui só o próximo passo. */}
                                    {app.status === 'interview' && PULL_HIRE_ENABLED && (
                                        <Button
                                            variant="dark"
                                            onClick={(e) => { e.stopPropagation(); handleUpdateStatus(app.id, 'hired'); }}
                                        >
                                            Contratar
                                        </Button>
                                    )}

                                    {(app.status === 'hired' || app.status === 'in_progress') && (
                                        <>
                                            {/* Show check-in status */}
                                            {!app.company_checkin_confirmed_at ? (
                                                <Button
                                                    variant="dark"
                                                    iconLeft={<Play size={16} />}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (app.worker_checkin_at) {
                                                            handleConfirmCheckin(app.id);
                                                        } else {
                                                            openManualAttendanceModal(app, 'checkin');
                                                        }
                                                    }}
                                                    loading={confirmingCheckin === app.id}
                                                >
                                                    {app.worker_checkin_at ? 'Confirmar Chegada' : 'Confirmar Presença'}
                                                </Button>
                                            ) : (
                                                <StatusChip tone="success" icon={<CheckCircle size={13} />}>
                                                    {app.worker_checkin_at ? 'Chegada OK' : 'Chegada registrada pela empresa'}
                                                </StatusChip>
                                            )}

                                            {/* Show check-out status — mesmo fallback do check-in: a empresa pode
                                                confirmar a saída mesmo se o freela não apertou "saída" no celular
                                                (turno acabou tarde da noite, sem sinal do app). Sem isso, o turno
                                                fica impagável para sempre. O rótulo distingue os dois casos para
                                                não sugerir que o freela marcou algo que não marcou.

                                                Ordem chegada→saída EXIGIDA (revisão pré-piloto): registrar/confirmar
                                                a saída antes da chegada estar confirmada quebra
                                                `buildManualAttendanceTimestamp` (sem `company_checkin_confirmed_at`
                                                nem `worker_checkin_at` como referência, `refMinutes` fica null,
                                                `dayOffset` sempre 0 — em turno sem `work_start_time`, a saída pode
                                                gravar ANTES da chegada que só será registrada depois).
                                                `calculateWorkedHours` então devolve null e o recibo perde as horas
                                                para sempre (`shift_payments` é imutável). Falha segura, não mente —
                                                mas o único artefato de auditoria do modo A fica sem o dado. A
                                                cronologia real (ninguém sai antes de entrar) resolve na origem: só
                                                oferece "Registrar/Confirmar Saída" depois que a chegada estiver
                                                confirmada; antes disso, mostra um estado neutro explicando o motivo. */}
                                            {!app.company_checkin_confirmed_at ? (
                                                <StatusChip tone="muted" icon={<Square size={12} />}>
                                                    Confirme a chegada primeiro
                                                </StatusChip>
                                            ) : !app.company_checkout_confirmed_at ? (
                                                <Button
                                                    variant="dark"
                                                    iconLeft={<Square size={16} />}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (app.worker_checkout_at) {
                                                            handleConfirmCheckout(app.id);
                                                        } else {
                                                            openManualAttendanceModal(app, 'checkout');
                                                        }
                                                    }}
                                                    loading={confirmingCheckin === app.id}
                                                >
                                                    {app.worker_checkout_at ? 'Confirmar Saída' : 'Registrar Saída'}
                                                </Button>
                                            ) : (
                                                <StatusChip tone="success" icon={<CheckCircle size={13} />}>
                                                    {app.worker_checkout_at ? 'Saída OK' : 'Saída registrada pela empresa'}
                                                </StatusChip>
                                            )}

                                            {/* Confirmar Entrega (escrow) OU Registrar Pagamento (modo A) — ramificado por escrow.kind */}
                                            {app.company_checkin_confirmed_at && app.company_checkout_confirmed_at && renderCompletionAction(app)}

                                            {/* Confirmação de véspera (F4) — badge de status + "Pedir confirmação" (A7/A9/A10). */}
                                            {(() => {
                                                const { response, requestCount, lastRequestedAt } = summarizeConfirmation(
                                                    confirmationsByApp[app.id],
                                                );
                                                const cooldownMs = confirmationCooldownRemainingMs(lastRequestedAt);
                                                const canRequest =
                                                    response === null && requestCount < CONFIRMATION_REQUEST_CAP && cooldownMs === 0;
                                                const isRequesting = requestingConfirmationId === app.id;
                                                const disabledReason =
                                                    response !== null
                                                        ? null
                                                        : requestCount >= CONFIRMATION_REQUEST_CAP
                                                            ? 'Limite de 2 pedidos atingido'
                                                            : cooldownMs > 0
                                                                ? `Aguarde ${formatCooldownRemaining(cooldownMs)}`
                                                                : null;

                                                return (
                                                    <>
                                                        {response === 'confirmed' && (
                                                            <StatusChip tone="success" icon={<ThumbsUp size={13} />}>
                                                                Confirmou presença
                                                            </StatusChip>
                                                        )}
                                                        {response === 'cannot_attend' && (
                                                            <StatusChip tone="danger" icon={<ThumbsDown size={13} />}>
                                                                Avisou que não vai
                                                            </StatusChip>
                                                        )}
                                                        {response === null && requestCount > 0 && (
                                                            <StatusChip tone="neutral" icon={<Bell size={12} />}>
                                                                Sem resposta
                                                            </StatusChip>
                                                        )}
                                                        {response === null && (
                                                            <Button
                                                                variant="secondary"
                                                                iconLeft={<Bell size={16} />}
                                                                onClick={(e) => { e.stopPropagation(); void handleRequestConfirmation(app.id); }}
                                                                disabled={!canRequest}
                                                                loading={isRequesting}
                                                                title={disabledReason ?? 'Envia um lembrete de confirmação para o freela'}
                                                            >
                                                                Pedir confirmação
                                                            </Button>
                                                        )}
                                                        {/* `title` (tooltip nativo) some em touch — o contexto real do
                                                            gerente no chão de loja. A10 pede o motivo VISÍVEL, não só
                                                            hover-only. Linha própria (`w-full`) dentro do flex-wrap para
                                                            não brigar de espaço com os botões/badges vizinhos. */}
                                                        {disabledReason && (
                                                            <span className="w-full text-xs text-gray-600">
                                                                {disabledReason}
                                                            </span>
                                                        )}
                                                    </>
                                                );
                                            })()}

                                            {/* "Dispensar deste turno" (onda 3) — gesto sério, exige confirmação no modal.
                                                "Dispensar" é para ANTES do turno acontecer. `hasAttendedShift` (mesmo
                                                predicado usado por shiftInviteService.dismissFromShift — nunca replicado
                                                condição a condição) cobre os TRÊS sinais de comparecimento, incluindo
                                                "empresa confirmou a chegada" mesmo sem o freela ter batido check-in no
                                                app (o caminho canônico do modo A). Sem qualquer um dos três, dispensar
                                                deixaria um turno trabalhado sem pagamento e sem recibo, e a application
                                                'cancelled' torna o slot irrecuperável (UNIQUE(job_id, worker_id)). Nesse
                                                ponto o gesto correto é registrar o pagamento (ou, se necessário, estornar).

                                                F4 (blocker 3 do ddl-aprovado.md): com sinal de risco vindo da confirmação
                                                de véspera ("não vai poder" OU pedido sem resposta), o botão vira
                                                "Dispensar e chamar substituto" — dispara o MESMO modal de confirmação,
                                                mas marcado (`dismissThenCall`) para encadear o Chamado de Turno (F1) só
                                                DEPOIS do dispensar ter sucesso. Sem sinal de risco, continua o
                                                "Dispensar" simples de sempre — não muda o comportamento de turnos que
                                                nunca usaram a confirmação de véspera. */}
                                            {!hasAttendedShift(app) && (() => {
                                                const { response, requestCount } = summarizeConfirmation(confirmationsByApp[app.id]);
                                                const hasRiskSignal = response === 'cannot_attend' || (response === null && requestCount > 0);
                                                return hasRiskSignal ? (
                                                    <Button
                                                        variant="secondary"
                                                        iconLeft={<Megaphone size={16} />}
                                                        onClick={(e) => { e.stopPropagation(); setDismissApp(app); setDismissThenCall(true); }}
                                                    >
                                                        Dispensar e chamar substituto
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        variant="ghost"
                                                        className={DESTRUCTIVE_GHOST_CLASS}
                                                        iconLeft={<UserX size={16} />}
                                                        onClick={(e) => { e.stopPropagation(); setDismissApp(app); setDismissThenCall(false); }}
                                                    >
                                                        Dispensar
                                                    </Button>
                                                );
                                            })()}
                                        </>
                                    )}

                                    {/* Turno finalizado via modo A (pagamento externo) — ramifica por status do marcador. */}
                                    {app.status === 'completed' && !escrowKindMap[app.id] && (() => {
                                        const matchingPayment = paymentByWorker[app.worker_id] ?? null;
                                        if (matchingPayment?.status === 'recorded') {
                                            return (
                                                <Button
                                                    variant="secondary"
                                                    iconLeft={<Receipt size={16} />}
                                                    onClick={(e) => { e.stopPropagation(); navigate(`/recibo/${app.job_id}?worker=${app.worker_id}`); }}
                                                >
                                                    Ver Recibo
                                                </Button>
                                            );
                                        }
                                        if (matchingPayment?.status === 'scheduled') {
                                            return renderScheduledPaymentBlock(matchingPayment);
                                        }
                                        // Rede de segurança (defense-in-depth): turno concluído em modo A (sem escrow)
                                        // mas sem registro/agendamento de pagamento — caminho de recuperação caso o
                                        // registro tenha falhado depois da conclusão em algum fluxo legado/edge case.
                                        return renderRegisterPaymentActions(app);
                                    })()}

                                    {/* Botão Avaliar — apenas para candidatos já finalizados */}
                                    {app.status === 'completed' && (
                                        <Button
                                            variant="secondary"
                                            onClick={(e) => { e.stopPropagation(); setSelectedApp(app); setRatingModalOpen(true); }}
                                        >
                                            Avaliar
                                        </Button>
                                    )}
                                </div>
                            )}

                            {/* Job Lifecycle Stepper */}
                            {['hired', 'in_progress', 'completed'].includes(app.status) && (
                                <div className="border-t border-gray-200 mt-4 pt-4">
                                    <JobLifecycleStepper steps={computeSteps(app)} />
                                </div>
                            )}

                            {/* Cover Letter Snippet */}
                            <p className="mt-4 rounded-xl bg-gray-50 px-3 py-2 text-sm italic text-gray-600 line-clamp-2">
                                "{app.cover_letter || 'Sem observações do freela.'}"
                            </p>

                            {/* Tags */}
                            {app.worker?.tags && (
                                <div className="flex gap-2 mt-3 flex-wrap">
                                    {app.worker.tags.map((tag: string) => (
                                        <span key={tag} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </Card>
                    ))
                )}
            </div>

            {/* Modal "Convidar Freela" — vaga sem freela (invitePickerOpen) ou convite expirado (reopenApp, R8) */}
            {(reopenApp || invitePickerOpen) && (
                <ModalShell onBackdropClick={aoTocarFundo}>
                    <div className="flex items-start justify-between gap-3 mb-2">
                        <ModalTitle className="text-lg font-bold tracking-tight">{reopenApp ? 'Convidar Outro Freela' : 'Convidar Freela'}</ModalTitle>
                        <Button
                            variant="ghost"
                            className={`${ICON_BUTTON_CLASS} -mr-2 -mt-2`}
                            onClick={closeReopenModal}
                            aria-label="Fechar"
                        >
                            <X size={20} />
                        </Button>
                    </div>
                    <p className="text-sm text-gray-600 mb-5">
                        {reopenApp
                            ? 'O convite anterior expirou sem resposta. O slot deste turno está livre — escolha outro freela da sua equipe.'
                            : 'Escolha um freela do seu elenco para atrelar a este turno.'}
                    </p>

                    {reopenLoading && (
                        <div className="space-y-3 animate-pulse">
                            {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-200 rounded-xl" />)}
                        </div>
                    )}

                    {!reopenLoading && reopenTeamMembers.length === 0 && (
                        <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-2xl text-gray-600">
                            <Users size={32} className="mx-auto mb-2 text-gray-400" />
                            <p className="font-bold text-sm">Nenhum freela disponível para convidar.</p>
                            <p className="text-xs mt-1">Todos da equipe já foram convidados para este turno, ou seu elenco está vazio.</p>
                        </div>
                    )}

                    {!reopenLoading && reopenTeamMembers.length > 0 && (
                        <div className="space-y-3 max-h-72 overflow-y-auto">
                            {reopenTeamMembers.map((member) => {
                                const avatarUrl = member.worker.avatar_url ?? member.worker.photo_url ?? null;
                                const isInviting = reopenInvitingWorkerId === member.worker.id;
                                return (
                                    <div key={member.connection.id} className="flex items-center gap-3 p-3 rounded-xl border-2 border-gray-200 hover:border-black transition-colors">
                                        <div className="w-10 h-10 rounded-xl border-2 border-black overflow-hidden bg-gray-100 shrink-0">
                                            {avatarUrl ? (
                                                <img src={avatarUrl} alt={member.worker.full_name} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center bg-black text-white font-bold">
                                                    {member.worker.full_name[0]?.toUpperCase()}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-sm truncate">{member.worker.full_name}</p>
                                            {member.worker.primary_role && (
                                                <p className="text-xs text-gray-600 truncate">{member.worker.primary_role}</p>
                                            )}
                                        </div>
                                        <Button
                                            variant="dark"
                                            iconLeft={<Send size={16} />}
                                            onClick={() => void handlePickReopenWorker(member.worker.id)}
                                            loading={isInviting}
                                            className="shrink-0"
                                        >
                                            {isInviting ? '...' : 'Convidar'}
                                        </Button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </ModalShell>
            )}

            {/* Modal de Confirmação de Entrega */}
            {confirmDeliveryApp && (
                <ModalShell onBackdropClick={aoTocarFundo}>
                    <ModalTitle className="text-lg font-bold tracking-tight mb-3">Confirmar Entrega</ModalTitle>
                    <p className="text-sm text-gray-600">
                        Tem certeza que deseja confirmar a entrega? O pagamento será liberado imediatamente ao profissional.
                    </p>
                    <div className="flex gap-3 mt-6">
                        <Button
                            variant="secondary"
                            className="flex-1"
                            onClick={() => setConfirmDeliveryApp(null)}
                            disabled={releasing}
                        >
                            Cancelar
                        </Button>
                        <Button
                            variant="dark"
                            className="flex-1"
                            onClick={() => handleConfirmDelivery(confirmDeliveryApp)}
                            loading={releasing}
                        >
                            {releasing ? 'Processando...' : 'Confirmar'}
                        </Button>
                    </div>
                </ModalShell>
            )}

            {/* Modal de horário manual — chegada/saída sem marcação do freela no app. O recibo é o
                único artefato de auditoria do modo A: não pode gravar o momento do clique da
                empresa (ex.: gerente registrando às 09h da manhã seguinte um turno que fechou
                às 02h) como se fosse o horário real. Pré-preenchido com o horário PLANEJADO do
                turno; o gerente confirma ou ajusta. */}
            {manualAttendance && (
                <ModalShell onBackdropClick={aoTocarFundo}>
                    <ModalTitle className="text-lg font-bold tracking-tight">
                        {manualAttendance.type === 'checkin' ? 'Confirmar Presença' : 'Registrar Saída'}
                    </ModalTitle>
                    <p className="text-sm text-gray-600 mt-1 mb-5">
                        {manualAttendance.app.worker?.full_name || 'Este freela'} não marcou {manualAttendance.type === 'checkin' ? 'a chegada' : 'a saída'} no app
                    </p>

                    <Field
                        label={`Horário real de ${manualAttendance.type === 'checkin' ? 'chegada' : 'saída'}`}
                        hint="Pré-preenchido com o horário planejado do turno. Ajuste para o horário real, se foi diferente — este dado vai para o recibo do freela."
                    >
                        <input
                            id="manual-attendance-time"
                            type="time"
                            value={manualAttendanceTime}
                            onChange={(e) => setManualAttendanceTime(e.target.value)}
                        />
                    </Field>

                    <div className="flex gap-3 mt-6">
                        <Button
                            variant="secondary"
                            className="flex-1"
                            onClick={closeManualAttendanceModal}
                            disabled={confirmingManualAttendance}
                        >
                            Cancelar
                        </Button>
                        <Button
                            variant="dark"
                            className="flex-1"
                            onClick={handleConfirmManualAttendance}
                            disabled={!manualAttendanceTime}
                            loading={confirmingManualAttendance}
                        >
                            {confirmingManualAttendance ? 'Confirmando...' : 'Confirmar'}
                        </Button>
                    </div>
                </ModalShell>
            )}

            {/* Modal "Dispensar deste turno" (onda 3) — gesto sério, exige confirmação explícita.
                F4: quando aberto via "Dispensar e chamar substituto" (`dismissThenCall`), o texto
                avisa o passo seguinte automático (abrir o F1), mas o gesto em si continua sendo
                UMA confirmação só — dispensar e chamar substituto é uma decisão manual explícita
                da empresa, só dividida em dois passos técnicos (blocker 3 do ddl-aprovado.md). */}
            {dismissApp && (
                <ModalShell onBackdropClick={aoTocarFundo}>
                    <ModalTitle className="text-lg font-bold tracking-tight mb-3">
                        {dismissThenCall ? 'Dispensar e Chamar Substituto' : 'Dispensar Freela'}
                    </ModalTitle>
                    <div className="space-y-3 text-sm text-gray-600">
                        <p>
                            {dismissApp.worker?.full_name || 'Este freela'} já foi contratado para este turno e está
                            contando com ele. Ao dispensar, o turno sai da agenda dele imediatamente.
                        </p>
                        {dismissThenCall && (
                            <p>
                                Em seguida, a tela de Chamado de Turno abre automaticamente para você chamar um
                                substituto do elenco.
                            </p>
                        )}
                    </div>
                    <p className="mt-4 rounded-xl border-2 border-yellow-200 bg-yellow-50 p-3 text-xs font-medium text-yellow-800">
                        O freela é avisado pelo Worki assim que você confirmar. Se o turno for logo,
                        vale reforçar por telefone/WhatsApp também.
                    </p>
                    <div className="flex gap-3 mt-6">
                        <Button
                            variant="secondary"
                            className="flex-1"
                            onClick={() => { setDismissApp(null); setDismissThenCall(false); }}
                            disabled={dismissing}
                        >
                            Cancelar
                        </Button>
                        <Button
                            variant="danger"
                            className="flex-1"
                            onClick={handleDismissFromShift}
                            loading={dismissing}
                        >
                            {dismissing
                                ? 'Dispensando...'
                                : dismissThenCall ? 'Confirmar e Chamar Substituto' : 'Confirmar Dispensa'}
                        </Button>
                    </div>
                </ModalShell>
            )}

            {/* Modal de estorno de pagamento (scheduled|recorded -> voided) */}
            {voidingPayment && (
                <ModalShell onBackdropClick={aoTocarFundo}>
                    <ModalTitle className="text-lg font-bold tracking-tight mb-3">Estornar pagamento</ModalTitle>
                    <p className="text-sm text-gray-600 mb-5">
                        {voidingPayment.status === 'scheduled'
                            ? 'Isto cancela o agendamento. O freela é avisado e o comprovante deixa de valer.'
                            : 'Isto estorna o registro de pagamento. O freela é avisado. Use se registrou por engano ou o pagamento não aconteceu.'}
                    </p>
                    <Field label="Motivo (opcional)">
                        <textarea
                            value={voidReason}
                            onChange={(e) => setVoidReason(e.target.value)}
                            placeholder="Ex.: registrei no turno errado"
                            className="!h-20 resize-none py-3"
                            rows={2}
                        />
                    </Field>
                    <div className="flex gap-3 mt-6">
                        <Button
                            variant="secondary"
                            className="flex-1"
                            onClick={() => { setVoidingPayment(null); setVoidReason(''); }}
                            disabled={voidSubmitting}
                        >
                            Voltar
                        </Button>
                        <Button
                            variant="danger"
                            className="flex-1"
                            onClick={handleVoidPayment}
                            loading={voidSubmitting}
                        >
                            {voidSubmitting ? 'Estornando...' : 'Confirmar Estorno'}
                        </Button>
                    </div>
                </ModalShell>
            )}

            {/* Modal "Registrar Pagamento" — modo A (pagamento externo declaratório) */}
            {paymentModalApp && (
                <ModalShell onBackdropClick={aoTocarFundo}>
                    {!paymentRecorded ? (
                        <>
                            <ModalTitle className="text-lg font-bold tracking-tight">Registrar Pagamento</ModalTitle>
                            <p className="text-sm text-gray-600 mt-1 mb-5">
                                Pagamento feito por fora do Worki — registro declaratório
                            </p>

                            <div className="space-y-4">
                                <fieldset>
                                    <legend className="mb-1.5 p-0 text-sm font-bold">Forma de pagamento</legend>
                                    <div className="grid grid-cols-3 gap-2">
                                        {(Object.keys(PAYMENT_SOURCE_LABELS) as PaymentSource[]).map((src) => (
                                            <Button
                                                key={src}
                                                variant={paymentSource === src ? 'dark' : 'secondary'}
                                                onClick={() => setPaymentSource(src)}
                                                aria-pressed={paymentSource === src}
                                                className="!px-2"
                                            >
                                                {PAYMENT_SOURCE_LABELS[src]}
                                            </Button>
                                        ))}
                                    </div>
                                </fieldset>

                                {paymentModalApp.worker?.pix_key && (
                                    <div className="flex items-center justify-between gap-2 rounded-xl border-2 border-black bg-primary/5 py-1 pl-4 pr-1">
                                        <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-black">
                                            <Wallet size={16} className="shrink-0" />
                                            <span className="truncate">{paymentModalApp.worker.pix_key}</span>
                                        </span>
                                        <Button
                                            variant="ghost"
                                            className={ICON_BUTTON_CLASS}
                                            onClick={() => handleCopyPix(paymentModalApp.worker!.pix_key as string)}
                                            aria-label="Copiar chave PIX do freela"
                                            title="Copiar chave PIX"
                                        >
                                            {pixCopied ? <Check size={16} /> : <Copy size={16} />}
                                        </Button>
                                    </div>
                                )}

                                <Field label="Valor pago (R$)">
                                    <input
                                        id="payment-amount"
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        inputMode="decimal"
                                        value={paymentAmount}
                                        onChange={(e) => setPaymentAmount(Number(e.target.value))}
                                        className="font-bold tabular-nums"
                                    />
                                </Field>

                                <Field label="Data do pagamento">
                                    <input
                                        id="payment-paid-at"
                                        type="date"
                                        value={paymentPaidAt}
                                        onChange={(e) => setPaymentPaidAt(e.target.value)}
                                    />
                                </Field>

                                <Field label="Nota (opcional)">
                                    <textarea
                                        id="payment-note"
                                        value={paymentNote}
                                        onChange={(e) => setPaymentNote(e.target.value)}
                                        placeholder="Ex.: pago em 2x, referência do PIX..."
                                        className="!h-20 resize-none py-3"
                                    />
                                </Field>

                                <p className="rounded-xl border-2 border-yellow-200 bg-yellow-50 p-3 text-xs font-medium text-yellow-800">
                                    O dinheiro não passa pelo Worki. Este registro é declaratório, não é
                                    documento fiscal, e ao confirmar o turno será marcado como concluído.
                                </p>
                            </div>

                            <div className="flex gap-3 mt-6">
                                <Button
                                    variant="secondary"
                                    className="flex-1"
                                    onClick={closePaymentModal}
                                    disabled={recordingPayment}
                                >
                                    Cancelar
                                </Button>
                                <Button
                                    variant="dark"
                                    className="flex-1"
                                    onClick={handleRecordPayment}
                                    disabled={!(paymentAmount > 0)}
                                    loading={recordingPayment}
                                >
                                    {recordingPayment ? 'Registrando...' : 'Confirmar Registro'}
                                </Button>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center text-center py-2">
                            <div className="w-14 h-14 rounded-full bg-primary-light border-2 border-black flex items-center justify-center mb-4">
                                <CheckCircle size={28} className="text-primary" />
                            </div>
                            <ModalTitle className="text-lg font-bold tracking-tight mb-1">Pagamento registrado!</ModalTitle>
                            <p className="text-sm text-gray-600 mb-6">
                                O recibo já está disponível para você e para o profissional.
                            </p>
                            <div className="flex gap-3 w-full">
                                <Button variant="secondary" className="flex-1" onClick={closePaymentModal}>
                                    Fechar
                                </Button>
                                <Button
                                    variant="dark"
                                    className="flex-1"
                                    iconLeft={<Receipt size={16} />}
                                    onClick={() => navigate(`/recibo/${paymentModalApp.job_id}?worker=${paymentModalApp.worker_id}`)}
                                >
                                    Ver Recibo
                                </Button>
                            </div>
                        </div>
                    )}
                </ModalShell>
            )}

            {/* Modal "Agendar Pagamento" — modo A, promessa com data prevista (ADR-20260712) */}
            {scheduleModalApp && (
                <ModalShell onBackdropClick={aoTocarFundo}>
                    {!paymentScheduled ? (
                        <>
                            <ModalTitle className="text-lg font-bold tracking-tight">Agendar Pagamento</ModalTitle>
                            <p className="text-sm text-gray-600 mt-1 mb-5">
                                Promessa de pagamento por fora do Worki — comprovante para o freela
                            </p>

                            <div className="space-y-4">
                                <fieldset>
                                    <legend className="mb-1.5 p-0 text-sm font-bold">Forma de pagamento</legend>
                                    <div className="grid grid-cols-3 gap-2">
                                        {(Object.keys(PAYMENT_SOURCE_LABELS) as PaymentSource[]).map((src) => (
                                            <Button
                                                key={src}
                                                variant={scheduleSource === src ? 'dark' : 'secondary'}
                                                onClick={() => setScheduleSource(src)}
                                                aria-pressed={scheduleSource === src}
                                                className="!px-2"
                                            >
                                                {PAYMENT_SOURCE_LABELS[src]}
                                            </Button>
                                        ))}
                                    </div>
                                </fieldset>

                                {scheduleModalApp.worker?.pix_key && (
                                    <div className="flex items-center justify-between gap-2 rounded-xl border-2 border-black bg-primary/5 py-1 pl-4 pr-1">
                                        <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-black">
                                            <Wallet size={16} className="shrink-0" />
                                            <span className="truncate">{scheduleModalApp.worker.pix_key}</span>
                                        </span>
                                        <Button
                                            variant="ghost"
                                            className={ICON_BUTTON_CLASS}
                                            onClick={() => handleCopyPix(scheduleModalApp.worker!.pix_key as string)}
                                            aria-label="Copiar chave PIX do freela"
                                            title="Copiar chave PIX"
                                        >
                                            {pixCopied ? <Check size={16} /> : <Copy size={16} />}
                                        </Button>
                                    </div>
                                )}

                                <Field label="Valor previsto (R$)">
                                    <input
                                        id="schedule-amount"
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        inputMode="decimal"
                                        value={scheduleAmount}
                                        onChange={(e) => setScheduleAmount(Number(e.target.value))}
                                        className="font-bold tabular-nums"
                                    />
                                </Field>

                                <Field label="Data prevista do pagamento">
                                    <input
                                        id="schedule-for"
                                        type="date"
                                        value={scheduledFor}
                                        onChange={(e) => setScheduledFor(e.target.value)}
                                    />
                                </Field>

                                <Field label="Nota (opcional)">
                                    <textarea
                                        id="schedule-note"
                                        value={scheduleNote}
                                        onChange={(e) => setScheduleNote(e.target.value)}
                                        placeholder="Ex.: pagamento no fechamento do mês..."
                                        className="!h-20 resize-none py-3"
                                    />
                                </Field>

                                <p className="rounded-xl border-2 border-yellow-200 bg-yellow-50 p-3 text-xs font-medium text-yellow-800">
                                    Isto é uma PROMESSA, ainda não um pagamento — o dinheiro não passa pelo Worki.
                                    O comprovante de agendamento fica disponível para o freela; ao efetivar, marque
                                    "Marcar como pago". Ao confirmar, o turno será marcado como concluído.
                                </p>
                            </div>

                            <div className="flex gap-3 mt-6">
                                <Button
                                    variant="secondary"
                                    className="flex-1"
                                    onClick={closeScheduleModal}
                                    disabled={scheduling}
                                >
                                    Cancelar
                                </Button>
                                <Button
                                    variant="dark"
                                    className="flex-1"
                                    onClick={handleSchedulePayment}
                                    disabled={!(scheduleAmount > 0) || !scheduledFor}
                                    loading={scheduling}
                                >
                                    {scheduling ? 'Agendando...' : 'Confirmar Agendamento'}
                                </Button>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center text-center py-2">
                            <div className="w-14 h-14 rounded-full bg-primary-light border-2 border-black flex items-center justify-center mb-4">
                                <CalendarClock size={28} className="text-primary" />
                            </div>
                            <ModalTitle className="text-lg font-bold tracking-tight mb-1">Pagamento agendado!</ModalTitle>
                            <p className="text-sm text-gray-600 mb-6">
                                O comprovante de agendamento já está disponível para você e para o profissional.
                            </p>
                            <div className="flex gap-3 w-full">
                                <Button variant="secondary" className="flex-1" onClick={closeScheduleModal}>
                                    Fechar
                                </Button>
                                <Button
                                    variant="dark"
                                    className="flex-1"
                                    iconLeft={<Receipt size={16} />}
                                    onClick={() => navigate(`/recibo/${scheduleModalApp.job_id}?worker=${scheduleModalApp.worker_id}`)}
                                >
                                    Ver Comprovante
                                </Button>
                            </div>
                        </div>
                    )}
                </ModalShell>
            )}

            {/* Rating Modal */}
            {ratingModalOpen && (
                <ModalShell onBackdropClick={aoTocarFundo}>
                    <div className="flex items-start justify-between gap-3 mb-5">
                        <ModalTitle as="h3" className="text-lg font-bold tracking-tight">Avaliar Freela</ModalTitle>
                        <Button
                            variant="ghost"
                            className={`${ICON_BUTTON_CLASS} -mr-2 -mt-2`}
                            onClick={() => setRatingModalOpen(false)}
                            aria-label="Fechar"
                        >
                            <X size={20} />
                        </Button>
                    </div>

                    <div className="flex flex-col items-center mb-5 text-center">
                        <div className="w-16 h-16 rounded-full bg-gray-200 border-2 border-black overflow-hidden mb-3">
                            {selectedApp?.worker?.avatar_url ? (
                                <img src={selectedApp.worker.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center bg-black text-white font-bold text-xl">
                                    {selectedApp?.worker?.full_name?.[0]}
                                </div>
                            )}
                        </div>
                        <h4 className="font-bold text-base">{selectedApp?.worker?.full_name}</h4>
                        <p className="text-sm text-gray-600">{selectedApp?.job?.title}</p>
                    </div>

                    <div className="flex justify-center gap-1 mb-5">
                        {[1, 2, 3, 4, 5].map((star) => (
                            <Button
                                key={star}
                                variant="ghost"
                                className={ICON_BUTTON_CLASS}
                                onClick={() => setRating(star)}
                                aria-label={`Nota ${star} de 5`}
                                aria-pressed={star <= rating}
                            >
                                <Star
                                    size={32}
                                    fill={star <= rating ? "#fbbf24" : "none"}
                                    className={star <= rating ? "text-yellow-500" : "text-gray-300"}
                                    strokeWidth={2}
                                />
                            </Button>
                        ))}
                    </div>

                    <Field label="Comentário (Opcional)">
                        <textarea
                            id="review-comment"
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            placeholder="Como foi a experiência?"
                            className="!h-24 resize-none py-3"
                        />
                    </Field>

                    <Button
                        variant="dark"
                        size="lg"
                        fullWidth
                        className="mt-6"
                        onClick={handleSubmitReview}
                        loading={submittingReview}
                    >
                        {submittingReview ? 'Enviando...' : 'Enviar Avaliação'}
                    </Button>
                </ModalShell>
            )}

            {/* Chamado de turno (F1) — disparo para 1..N do elenco, primeiro-aceite */}
            {callModalOpen && (
                <ShiftCallModal
                    job={{
                        id: id ?? '',
                        title: jobTitle,
                        start_date: jobStartDate,
                        work_start_time: jobStartTime ?? undefined,
                        certification_requirement: jobCertificationRequirement,
                        slots: jobSlots,
                    }}
                    excludeWorkerIds={[...workerIdsInShift, ...workerIdsPendingCall]}
                    onClose={() => setCallModalOpen(false)}
                    onDispatched={() => {
                        refreshCalls();
                        void fetchCandidates();
                    }}
                />
            )}

        </div>
    );
}
