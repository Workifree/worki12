import { activeShiftLabel } from '../../lib/shiftProgress';
import { useEffect, useState, useRef } from 'react';
import { Dialog } from '../../components/ui/Dialog';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { WalletService } from '../../services/walletService';
import { PaymentRecordService } from '../../services/paymentRecordService';
import { useShiftCalls } from '../../hooks/useShiftInvites';
import { useCurrentCompany } from '../../hooks/useCurrentCompany';
import { ShiftCallModal } from '../../components/team/ShiftCallModal';
import { ShiftCallsPanel } from '../../components/team/ShiftCallsPanel';
import { SosCallButton } from '../../components/team/SosCallButton';
import { ShiftInviteService, normalizePhoneForWhatsApp, buildShiftInviteWhatsAppMessage, hasAttendedShift } from '../../services/shiftInviteService';
import { AttendanceConfirmationService } from '../../services/attendanceConfirmationService';
import { logError } from '../../lib/logger';
import { CHAT_DENIED_MESSAGE, isChatDeniedByRls } from '../../lib/shiftChat';
import { isNotVisibleError } from '../../lib/notVisible';
import SemAcesso from '../../components/SemAcesso';
import { getJobScope, canSeeJob } from '../../services/jobScopeService';
import { fillMissingWorkers } from '../../services/workerCardsService';
import { ArrowLeft, Star, MapPin, CheckCircle, XCircle, MessageSquare, MessageCircle, UserX, Play, Square, Receipt, Send, Users, X, CalendarClock, Wallet, Copy, Check, Megaphone, Bell, ThumbsUp, ThumbsDown } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useToast } from '../../contexts/ToastContext';
import JobLifecycleStepper from '../../components/JobLifecycleStepper';

import { getSessionUserOrThrow } from '../../lib/authSession';
import { Alert, Button, Card, DialogActions, DialogHeader, EmptyState, ErrorState, Field, FilterChip, IconButton, PageHeader, SkeletonList, StatusBadge } from '../../components/ui';
import { applicationStep, shiftWhen } from '../../lib/nextAction';
import { formatBRL } from '../../lib/currency';
import { todayLocalDate, formatDateOnly } from '../../lib/dateUtils';
import type {
    Application,
    PaymentSource,
    ShiftPayment,
    ShiftAttendanceConfirmation,
    AttendanceConfirmationOutcome,
} from '../../types';
import { getAuthenticatedCompanyId, isGestor } from '../../services/companyScopeService';
import { useCanUseCompanyChat } from '../../hooks/useCanUseCompanyChat';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { useLatestResponse } from '../../hooks/useLatestResponse';
import { useAnyDialogOpen } from '../../hooks/useModalDismiss';
import { jobSources } from '../../lib/realtime/liveSources';
import { roleLabel, statusLabel } from '../../lib/statusLabels';
import { isPresencaEnabled } from '../../lib/features';
import QrPresenceStep from '../../components/company/QrPresenceStep';
import { PresenceBadge } from '../../components/presence/PresenceBadge';
import { listPresenceChecks } from '../../services/presenceService';
import type { PresenceCheck, PresenceQrMode } from '../../lib/presence';

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
 * Traduz a recusa do guard de `applications` (migration 20261125000200,
 * `applications_update_guard`) em frase clara. Devolve `null` para qualquer outro erro.
 * O texto cru do banco nunca chega à tela.
 */
function attendanceGuardMessage(
    error: unknown,
    startDate: string | null | undefined,
    startTime: string | null | undefined,
): string | null {
    const raw = (error as { message?: unknown } | null)?.message;
    if (typeof raw !== 'string' || !raw.includes('applications_update_guard')) return null;
    if (raw.includes('este turno foi cancelado')) return 'Este turno foi cancelado.';
    if (raw.includes('horario de presenca no futuro')) return 'O horário não pode ser no futuro.';
    if (raw.includes('ainda nao e possivel registrar a chegada')) {
        const opens = checkinOpensAt(startDate, startTime);
        return opens
            ? `Só dá para registrar a chegada a partir de ${opens}.`
            : 'Ainda não dá para registrar a chegada neste turno.';
    }
    if (raw.includes('registro de presenca ja gravado')) {
        return 'Essa presença já foi registrada. Atualize a página.';
    }
    return 'Não foi possível fazer isso agora. Atualize a página e tente novamente.';
}

/**
 * Abertura da janela de chegada, igual ao banco: 12h antes da data do turno (em São Paulo) com
 * `work_start_time`; sem horário válido, 00:00. São Paulo é UTC-3 (sem horário de verão).
 */
function checkinOpensAt(startDate: string | null | undefined, startTime: string | null | undefined): string | null {
    if (!startDate) return null;
    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) return null;
    const zone = 'America/Sao_Paulo';
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(start).split('-').map(Number);
    const time = /^([01]\d|2[0-3]):[0-5]\d/.test(startTime ?? '') ? (startTime as string).slice(0, 5) : '00:00';
    const [h, min] = time.split(':').map(Number);
    const opens = new Date(Date.UTC(y, m - 1, d, h + 3 - 12, min));
    const day = new Intl.DateTimeFormat('pt-BR', { timeZone: zone, day: '2-digit', month: '2-digit' }).format(opens);
    const hour = new Intl.DateTimeFormat('pt-BR', { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(opens);
    return `${day} às ${hour}`;
}

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
    // `jobs.start_date` é timestamptz: só a parte da data importa (como `parseDateOnly`).
    const [y, m, d] = jobStartDate.split('T')[0].split('-').map(Number);
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

export default function CompanyJobCandidates() {
    const { id } = useParams();
    const podeUsarChat = useCanUseCompanyChat();
    const navigate = useNavigate();
    // Estornar e cancelar agendamento são só do Gestor (o banco recusa os demais).
    const podeEstornar = isGestor(useCurrentCompany());

    const [candidates, setCandidates] = useState<Application[]>([]);
    const [jobTitle, setJobTitle] = useState('');
    // F8 — advisory, nunca trava: repassado ao ShiftCallModal como banner de uma linha (R11).
    const [jobCertificationRequirement, setJobCertificationRequirement] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [ratingModalOpen, setRatingModalOpen] = useState(false);
    const [selectedApp, setSelectedApp] = useState<Application | null>(null);
    // Começa sem nota: estrelas preenchidas induziam 5.
    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState('');
    const [submittingReview, setSubmittingReview] = useState(false);
    const [confirmingCheckin, setConfirmingCheckin] = useState<string | null>(null);
    // Fallback manual de chegada/saída — só quando o freela NÃO marcou (worker_checkin_at/
    // worker_checkout_at ausente). Pede o horário real em vez de gravar o momento do clique.
    const [manualAttendance, setManualAttendance] = useState<{ app: Application; type: 'checkin' | 'checkout' } | null>(null);
    const [manualAttendanceTime, setManualAttendanceTime] = useState('');
    // O texto de ajuda só afirma "pré-preenchido" quando o campo veio mesmo preenchido.
    const [manualPrefilled, setManualPrefilled] = useState(false);
    const [confirmingManualAttendance, setConfirmingManualAttendance] = useState(false);
    const [confirmDeliveryApp, setConfirmDeliveryApp] = useState<Application | null>(null);
    const [releasing, setReleasing] = useState(false);
    // Modo A (pagamento externo declaratório) — ramifica por escrow.kind por application.
    // Sem entrada no map = turno sem escrow (modo A); 'prepaid'/'postpaid' = caminho de escrow existente.
    const [escrowKindMap, setEscrowKindMap] = useState<Record<string, 'prepaid' | 'postpaid'>>({});
    const [jobBudget, setJobBudget] = useState(0);
    const [erroCarga, setErroCarga] = useState(false);
    const [semAcesso, setSemAcesso] = useState(false);
    const [indisponivel, setIndisponivel] = useState(false);
    // Registro de pagamento externo (modo A) por freela (ADR-20260816 — o marcador é por
    // (job_id, worker_id), não mais por job_id sozinho: um turno com N freelas tem N
    // marcadores independentes). Cada card olha só a própria entrada deste mapa.
    const [paymentByWorker, setPaymentByWorker] = useState<Record<string, ShiftPayment>>({});
    // Só uma leitura confirmada libera ações de pagamento: com a leitura falha (ou ainda não
    // feita), um turno já pago pareceria "sem pagamento" e convidaria a pagar de novo.
    const [paymentsRead, setPaymentsRead] = useState<'pending' | 'ok' | 'error'>('pending');

    // Dados do turno + empresa usados só para montar a mensagem pronta do WhatsApp (onda 3).
    const [jobLocation, setJobLocation] = useState('');
    const [jobStartDate, setJobStartDate] = useState('');
    const [jobStartTime, setJobStartTime] = useState<string | null>(null);
    const [jobEndTime, setJobEndTime] = useState<string | null>(null);
    // Presença verificada: `qrMode` só existe em turno `qr_gps` com a função ligada.
    const [qrMode, setQrMode] = useState<PresenceQrMode | null>(null);
    const [presenceChecks, setPresenceChecks] = useState<PresenceCheck[] | null>(null);
    const [jobCompanyId, setJobCompanyId] = useState<string | null>(null);
    const [companyName, setCompanyName] = useState('');

    // Chamado de turno (F1): quantas vagas o turno tem e o modal de disparo múltiplo.
    const [jobSlots, setJobSlots] = useState(1);
    const [callModalOpen, setCallModalOpen] = useState(false);

    // `?chamar=1` — a ponte que faltava entre CRIAR e CHAMAR: o modal pos-criacao do turno agora
    // oferece "chamar varios de uma vez" e cai aqui com o chamado 1->N JA ABERTO, em vez de
    // largar a pessoa numa pagina onde ela precisa reencontrar o botao. Abre UMA vez (ref), para
    // um F5 nao reabrir o modal em cima de quem ja o fechou.
    const [chamarParams, setChamarParams] = useSearchParams();
    const chamarAoChegar = useRef(chamarParams.get('chamar') === '1');
    useEffect(() => {
        if (chamarAoChegar.current) {
            chamarAoChegar.current = false;
            setCallModalOpen(true);
            // Tira o `?chamar=1` da URL: recarregar não reabre o modal.
            setChamarParams((atual) => { atual.delete('chamar'); return atual; }, { replace: true });
        }
    }, []);

    // "Cancelar convite" — invited sem resposta, libera o slot (onda 3).
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

    // ── Saida de emergencia dos 7 modais inline desta pagina (heuristica #3) ────────────────
    // Contrato da casca única (ui/Dialog): ESC e toque no fundo fecham
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
    };

    const { addToast } = useToast();
    const beginCandidates = useLatestResponse();

    const {
        calls,
        loading: callsLoading,
        loadError: callsError,
        cancellingId: cancellingCallId,
        cancel: cancelCall,
        refresh: refreshCalls,
    } = useShiftCalls(id ?? '');

    // Ao vivo: espera enquanto há diálogo aberto ou gravação em andamento.
    const dialogOpen = useAnyDialogOpen();
    useLiveRefresh({
        sources: id ? jobSources(id) : [],
        onRefresh: () => Promise.all([fetchCandidates({ silent: true }), refreshCalls({ silent: true })]),
        paused: loading || dialogOpen || callModalOpen || !!voidingPayment || ratingModalOpen
            || !!scheduleModalApp || !!paymentModalApp || !!dismissApp || !!manualAttendance
            || !!confirmDeliveryApp || releasing || !!confirmingCheckin || !!requestingConfirmationId
            || !!cancelInviteId || !!effectivatingId,
    });

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

    // `silent` = recarga ao vivo: sem esqueleto, sem navegar e, se falhar, a tela fica como está.
    const fetchCandidates = async ({ silent = false }: { silent?: boolean } = {}) => {
        const claim = beginCandidates();
        // G3: guarda de id falsy — o useEffect já checa `if (id)` antes de chamar,
        // mas repetimos aqui pra nunca consultar `jobs?id=eq.null`/`applications?job_id=eq.null`
        // mesmo se essa função for chamada de outro lugar (ex.: `fetchCandidates()` após ações).
        if (!id) { navigate('/company/jobs'); return; }
        try {
            const user = await getSessionUserOrThrow(); // rede fora lança e cai no erro com retry
            if (!user) { if (!silent) navigate('/login'); return; }
            if (!silent) setErroCarga(false);

            // Fetch Job Title (only if owned by this company)
            const jobColumns = 'title, budget, location, start_date, work_start_time, work_end_time, slots, certification_requirement, company_id, responsible_id';
            const { data: job, error: jobError } = await supabase
                .from('jobs')
                // As colunas de presença só existem depois das migrations (flag).
                .select((isPresencaEnabled() ? `${jobColumns}, presence_mode, qr_mode` : jobColumns) as typeof jobColumns)
                .eq('id', id)
                .eq('company_id', await getAuthenticatedCompanyId())
                .single();
            // PGRST116 = nenhuma linha; outro erro é falha de carga, não "turno inexistente".
            if (jobError && isNotVisibleError(jobError)) { if (!silent && claim()) setIndisponivel(true); return; }
            if (jobError) throw jobError;
            if (!job) { if (!silent && claim()) setIndisponivel(true); return; }
            if (!canSeeJob(await getJobScope(), job)) { if (!silent) setSemAcesso(true); return; }
            if (!claim()) return;
            setJobTitle(job.title);
            setJobCertificationRequirement(job.certification_requirement ?? null);
            setJobBudget(job.budget ?? 0);
            setJobSlots(job.slots ?? 1);
            setJobLocation(job.location ?? '');
            setJobStartDate(job.start_date ?? '');
            setJobStartTime(job.work_start_time ?? null);
            setJobEndTime(job.work_end_time ?? null);
            const presence = job as { presence_mode?: string; qr_mode?: PresenceQrMode };
            const usesQr = isPresencaEnabled() && presence.presence_mode === 'qr_gps';
            setQrMode(usesQr ? presence.qr_mode ?? 'rotating' : null);
            const checks = usesQr ? await listPresenceChecks({ jobId: id }) : null;
            if (!claim()) return;
            // Leitura que falhou (`null`) numa recarga de fundo mantém os selos já lidos.
            setPresenceChecks((prev) => (silent && usesQr && checks === null ? prev : checks));
            setJobCompanyId((job as { company_id?: string | null }).company_id ?? null);

            // Nome da empresa OPERADA pela sessão (não `user.id`: gerente/encarregado não são a
            // linha de `companies`) — só para montar a mensagem do WhatsApp, best-effort.
            const empresaOperada = await getAuthenticatedCompanyId().catch(() => null);
            const { data: companyRow } = empresaOperada
                ? await supabase.from('companies').select('name').eq('id', empresaOperada).maybeSingle()
                : { data: null };
            if (!claim()) return;
            if (!silent || companyRow) setCompanyName(companyRow?.name ?? '');

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
            // Encarregado: o embed `workers` volta `null`; os cartões das RPCs preenchem.
            const filled = await fillMissingWorkers(data || [], id);
            if (!claim()) return;
            setCandidates(filled);
            setErroCarga(false);

            // Fetch escrow kind per application for this job (só o kind é usado para ramificar
            // Confirmar entrega vs Registrar pagamento — ver `renderCompletionAction`).
            const { data: escrowRows, error: escrowError } = await supabase
                .from('escrow_transactions')
                .select('application_id, kind')
                .eq('job_id', id);
            if (escrowError) throw escrowError;
            const kindMap: Record<string, 'prepaid' | 'postpaid'> = {};
            (escrowRows || []).forEach((row) => {
                if (row.application_id && (row.kind === 'prepaid' || row.kind === 'postpaid')) {
                    kindMap[row.application_id] = row.kind;
                }
            });
            if (!claim()) return;
            setEscrowKindMap(kindMap);

            // Modo A: registros de pagamento externo já feitos para este turno — um por
            // freela (ADR-20260816). `listActivePaymentsByJob` devolve 0..N linhas; hoje
            // (banco ainda sem a migration) no máximo 1, mas o mapa já fica pronto para N.
            // try isolado: a falha bloqueia só o pagamento, a presença continua funcionando.
            try {
                const payments = await PaymentRecordService.listActivePaymentsByJob(id);
                const byWorker: Record<string, ShiftPayment> = {};
                payments.forEach((p) => { byWorker[p.worker_id] = p; });
                if (!claim()) return;
                setPaymentByWorker(byWorker);
                setPaymentsRead('ok');
            } catch (paymentsError) {
                logError('CompanyJobCandidates.fetchPayments', paymentsError);
                if (!silent && claim()) setPaymentsRead('error');
            }

            // Confirmação de véspera (D-1) — try/catch isolado: uma falha aqui não pode derrubar
            // o carregamento dos candidatos (checagem/pagamento continuam funcionando sem isso).
            try {
                const confirmationRows = await AttendanceConfirmationService.getConfirmationsForJob(id, true);
                const byApp: Record<string, ShiftAttendanceConfirmation[]> = {};
                confirmationRows.forEach((row) => {
                    (byApp[row.application_id] ??= []).push(row);
                });
                if (!claim()) return;
                setConfirmationsByApp(byApp);
            } catch (confirmationError) {
                logError('CompanyJobCandidates.fetchConfirmations', confirmationError);
            }
        } catch (error) {
            logError('CompanyJobCandidates', error);
            if (silent || !claim()) return;
            setErroCarga(true);
            // A recarga parou antes de reler os pagamentos: o que está na memória não vale mais.
            setPaymentsRead('error');
        } finally {
            if (!silent) setLoading(false);
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
            addToast(
                attendanceGuardMessage(error, jobStartDate, jobStartTime)
                    ?? (error.message || 'Erro ao atualizar status do freela.'),
                'error',
            );
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
        addToast('Entrega confirmada. O pagamento é feito por fora do Worki.', 'success');
        fetchCandidates();
    };

    // "Cancelar convite" (onda 3) — invited sem resposta, libera o slot para convidar outro
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

    // O service valida o SINAL REAL de conclusão (chegada + saída confirmadas), não o
    // status='completed' — por isso registramos o pagamento PRIMEIRO e só marcamos o
    // turno como concluído DEPOIS que o INSERT tem sucesso. Se o registro falhar (rede/
    // RLS/timeout), a application permanece como estava e o botão "Registrar pagamento"
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
            setRating(0);
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
            if (isChatDeniedByRls(error)) {
                addToast(CHAT_DENIED_MESSAGE, 'error');
                return;
            }
            logError('CompanyJobCandidates', error);
            addToast('Erro ao iniciar conversa.', 'error');
        }
    };

    const handleAskPix = (app: Application) => {
        const phone = normalizePhoneForWhatsApp(app.worker?.phone ?? null);
        if (!phone) return;
        const message = `Olá! Para eu te pagar pelo turno "${jobTitle}", me envia sua chave PIX?`;
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
    };

    // R1.4: copiar a chave PIX do freela — mostrada nos modais "Registrar pagamento" e
    // "Agendar pagamento" (modo A: a empresa paga por fora e precisa da chave à mão).
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
            addToast(attendanceGuardMessage(error, jobStartDate, jobStartTime) ?? 'Erro ao confirmar check-in.', 'error');
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
            // Este gesto destrava "Registrar pagamento" — merece confirmação visível, não só
            // um refetch silencioso (a empresa precisa saber que já pode seguir o fluxo).
            addToast('Saída confirmada!', 'success');
            fetchCandidates();
        } catch (error) {
            logError('CompanyJobCandidates', error);
            addToast(attendanceGuardMessage(error, jobStartDate, jobStartTime) ?? 'Erro ao confirmar check-out.', 'error');
        } finally {
            setConfirmingCheckin(null);
        }
    };

    // Abre o modal de horário manual — usado quando o freela NÃO marcou a chegada/saída no
    // app (o botão vira "Confirmar presença"/"Registrar saída"). Pré-preenche com o horário
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
        const planned = plannedTime ? plannedTime.slice(0, 5) : '';
        // Horário previsto que ainda não chegou não vira padrão: o banco recusa futuro e a empresa
        // só confirmaria sem olhar.
        const plannedAt = planned
            ? buildManualAttendanceTimestamp(app, jobStartDate, jobStartTime, type, planned)
            : null;
        const isFuture = plannedAt !== null && new Date(plannedAt).getTime() > Date.now();
        setManualAttendance({ app, type });
        setManualAttendanceTime(isFuture ? '' : planned);
        setManualPrefilled(!isFuture && planned !== '');
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
            addToast(attendanceGuardMessage(error, jobStartDate, jobStartTime) ?? 'Erro ao confirmar horário.', 'error');
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

    const openVoid = (payment: ShiftPayment) => { setVoidingPayment(payment); setVoidReason(''); };
    const receiptPath = (jobId: string, workerId: string) => `/recibo/${jobId}?worker=${workerId}`;

    // Próximo passo de cada freela: é o único botão de largura total do cartão. Na tela inteira, só o
    // primeiro cartão que pede ação leva o preto; os outros ficam em secundário.
    const primaryAppId = candidates.find((app) => {
        if (app.status === 'completed' && escrowKindMap[app.id]) return false;
        const kind = applicationStep(app, paymentByWorker[app.worker_id]?.status ?? null).kind;
        return kind !== 'view' && (kind !== 'pay' || paymentsRead === 'ok');
    })?.id;
    const mainVariant = (app: Application) => (app.id === primaryAppId ? 'dark' as const : 'secondary' as const);

    // Ações de um pagamento já marcado. 'scheduled' é promessa: desfazer é "Cancelar agendamento".
    const renderPaymentMarker = (app: Application, payment: ShiftPayment) => (
        <div className="space-y-2">
            {payment.status === 'scheduled' ? (
                <>
                    <StatusBadge tone="info" icon={CalendarClock}>
                        {payment.scheduled_for ? `Agendado p/ ${formatDateOnly(payment.scheduled_for, 'dd/MM/yyyy')}` : 'Pagamento agendado'}
                    </StatusBadge>
                    <Button
                        variant={mainVariant(app)}
                        fullWidth
                        data-copilot="empresa.presenca.marcar-pago"
                        data-copilot-risk="D"
                        onClick={() => handleEffectivatePayment(payment.id)}
                        loading={effectivatingId === payment.id}
                    >
                        Marcar como pago
                    </Button>
                </>
            ) : (
                <StatusBadge tone="success" icon={CheckCircle}>Pagamento registrado</StatusBadge>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                    variant="secondary"
                    iconLeft={<Receipt size={16} />}
                    data-copilot="empresa.presenca.ver-recibo"
                    onClick={() => navigate(receiptPath(payment.job_id ?? app.job_id, payment.worker_id ?? app.worker_id))}
                >
                    {payment.status === 'scheduled' ? 'Ver Comprovante' : 'Ver recibo'}
                </Button>
                {podeEstornar && (
                    <Button
                        variant="dangerOutline"
                        data-copilot="empresa.presenca.estornar"
                        data-copilot-risk="D"
                        onClick={() => openVoid(payment)}
                    >
                        {payment.status === 'scheduled' ? 'Cancelar agendamento' : 'Estornar'}
                    </Button>
                )}
            </div>
        </div>
    );

    // "Registrar pagamento" (próximo passo) + "Agendar pagamento" (alternativa).
    const renderRegisterPaymentActions = (app: Application) => (
        <div className="space-y-2">
            <Button
                variant={mainVariant(app)}
                fullWidth
                data-copilot="empresa.presenca.registrar-pagamento"
                data-copilot-risk="D"
                onClick={() => openPaymentModal(app)}
            >
                Registrar pagamento
            </Button>
            <Button
                variant="ghost"
                fullWidth
                iconLeft={<CalendarClock size={16} />}
                data-copilot="empresa.presenca.agendar-pagamento"
                data-copilot-risk="D"
                onClick={() => openScheduleModal(app)}
            >
                Agendar pagamento
            </Button>
        </div>
    );

    // Ramificação modo A (pagamento externo, registrado OU agendado) vs C (postpago/cartão)
    // vs prepago legado. Sem entrada em escrowKindMap = nenhum escrow reservado para este
    // turno → modo A (default do piloto).
    const renderCompletionAction = (app: Application) => {
        const kind = escrowKindMap[app.id];
        if (kind === 'prepaid' || kind === 'postpaid') {
            return (
                <Button variant={mainVariant(app)} fullWidth data-copilot-risk="D" onClick={() => setConfirmDeliveryApp(app)}>
                    Confirmar entrega
                </Button>
            );
        }
        if (paymentsRead !== 'ok') {
            return paymentsRead === 'pending' ? null : (
                <Alert
                    tone="danger"
                    role="alert"
                    title="Não conseguimos conferir os pagamentos"
                    action={<Button variant="secondary" onClick={() => { void fetchCandidates(); }}>Tentar de novo</Button>}
                >
                    Para não pagar duas vezes, o pagamento fica bloqueado até a leitura funcionar.
                </Alert>
            );
        }
        const matchingPayment = paymentByWorker[app.worker_id] ?? null;
        return matchingPayment ? renderPaymentMarker(app, matchingPayment) : renderRegisterPaymentActions(app);
    };

    // Zona 2 do cartão: UM próximo passo de presença (ou o dinheiro, depois da saída).
    const renderPresenceStep = (app: Application) => {
        if (app.company_checkin_confirmed_at && app.company_checkout_confirmed_at) return renderCompletionAction(app);
        if (qrMode) {
            return (
                <QrPresenceStep
                    jobId={app.job_id}
                    applicationId={app.id}
                    workerName={app.worker?.full_name || 'Freela'}
                    kind={app.company_checkin_confirmed_at ? 'departure' : 'arrival'}
                    qrMode={qrMode}
                    checks={presenceChecks}
                    primary={app.id === primaryAppId}
                    onDecided={() => { void fetchCandidates(); }}
                />
            );
        }
        const type = app.company_checkin_confirmed_at ? 'checkout' as const : 'checkin' as const;
        const workerMarked = !!(type === 'checkin' ? app.worker_checkin_at : app.worker_checkout_at);
        const label = type === 'checkin'
            ? (workerMarked ? 'Confirmar Chegada' : 'Registrar chegada')
            : (workerMarked ? 'Confirmar saída' : 'Registrar saída');
        const opens = type === 'checkin' && !workerMarked ? checkinOpensAt(jobStartDate, jobStartTime) : null;
        const plannedStart = jobStartDate
            ? buildManualAttendanceTimestamp(app, jobStartDate, jobStartTime, 'checkin', jobStartTime?.slice(0, 5) || '00:00')
            : null;
        const notStarted = type === 'checkin' && !workerMarked && !!plannedStart && new Date(plannedStart).getTime() > Date.now();
        return (
            <div>
                <Button
                    variant={notStarted ? 'secondary' : mainVariant(app)}
                    size="lg"
                    fullWidth
                    iconLeft={type === 'checkin' ? <Play size={16} /> : <Square size={16} />}
                    data-copilot={type === 'checkin' ? 'empresa.presenca.registrar-chegada' : 'empresa.presenca.registrar-saida'}
                    data-copilot-risk="D"
                    onClick={() => {
                        if (!workerMarked) openManualAttendanceModal(app, type);
                        else if (type === 'checkin') void handleConfirmCheckin(app.id);
                        else void handleConfirmCheckout(app.id);
                    }}
                    loading={confirmingCheckin === app.id}
                >
                    {label}
                </Button>
                {notStarted && opens && (
                    <p className="mt-1 text-xs text-gray-600">O turno ainda não começou. Dá para registrar a chegada a partir de {opens}.</p>
                )}
            </div>
        );
    };

    const renderSourcePicker = (value: PaymentSource, onChange: (next: PaymentSource) => void) => (
        <fieldset>
            <legend className="mb-1.5 p-0 text-sm font-bold">Forma de pagamento</legend>
            <div className="grid grid-cols-3 gap-2">
                {(Object.keys(PAYMENT_SOURCE_LABELS) as PaymentSource[]).map((src) => (
                    <FilterChip key={src} pressed={value === src} onClick={() => onChange(src)}>
                        {PAYMENT_SOURCE_LABELS[src]}
                    </FilterChip>
                ))}
            </div>
        </fieldset>
    );

    // Chave PIX à mão na hora de pagar. Sem chave, o aviso diz isso e dá a saída.
    const renderPix = (app: Application) => {
        const pixKey = app.worker?.pix_key;
        if (!pixKey) {
            return (
                <Alert
                    data-copilot-private
                    tone="warning"
                    title="Freela sem chave PIX"
                    action={app.worker?.phone ? (
                        <Button variant="secondary" iconLeft={<MessageCircle size={16} />} onClick={() => handleAskPix(app)}>
                            Pedir no WhatsApp
                        </Button>
                    ) : undefined}
                >
                    Não há chave PIX disponível aqui. Peça a chave ao freela ou, se pagou de outro jeito, escolha Dinheiro ou Outro.
                </Alert>
            );
        }
        return (
            <div data-copilot-private className="flex items-center justify-between gap-2 rounded-xl border-2 border-black bg-primary-light py-1 pl-4 pr-1">
                <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-black">
                    <Wallet size={16} className="shrink-0" />
                    <span className="truncate">{pixKey}</span>
                </span>
                <IconButton onClick={() => handleCopyPix(pixKey)} aria-label="Copiar chave PIX do freela" title="Copiar chave PIX">
                    {pixCopied ? <Check size={16} /> : <Copy size={16} />}
                </IconButton>
            </div>
        );
    };

    if (indisponivel) {
        return <SemAcesso titulo="Turno indisponível" mensagem="Você não tem acesso a este turno ou ele foi removido." voltarPara="/company/jobs" rotulo="Voltar para Turnos" />;
    }
    if (semAcesso) {
        return <SemAcesso mensagem="Este turno é de outra pessoa da equipe." voltarPara="/company/jobs" rotulo="Voltar aos turnos" />;
    }

    // Só quando nada carregou: falha ao recarregar depois de uma ação mantém a tela.
    if (erroCarga && !jobTitle) {
        return (
            <div className="max-w-4xl mx-auto p-4 sm:p-8">
                <ErrorState title="Não conseguimos carregar este turno." onRetry={() => { setErroCarga(false); setLoading(true); void fetchCandidates(); }} />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-4xl lg:max-w-6xl">
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
                className="[&>div:first-child]:sm:min-w-[20rem] sm:flex-wrap"
                title={loading || !jobTitle ? 'Presença e pagamento' : jobTitle}
                subtitle={loading
                    ? 'Carregando o turno...'
                    : `${shiftWhen(jobStartDate, jobStartTime, jobEndTime)} · ${filledCount} de ${jobSlots} ${jobSlots === 1 ? 'vaga preenchida' : 'vagas preenchidas'}`}
                action={
                    /* O gesto de 8h30: um clique, vários freelas, quem aceitar primeiro leva.
                       Some quando o turno já está completo — não há vaga para disputar. */
                    !loading && filledCount < jobSlots ? (
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                                variant={primaryAppId ? 'secondary' : 'dark'}
                                iconLeft={<Megaphone size={16} />}
                                data-copilot="empresa.presenca.chamar-freelas"
                                onClick={() => setCallModalOpen(true)}
                            >
                                Chamar freelas
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

            {erroCarga && (
                <Alert
                    tone="warning"
                    role="alert"
                    className="mb-4"
                    action={<Button variant="secondary" onClick={() => { void fetchCandidates(); }}>Tentar de novo</Button>}
                >
                    Não conseguimos atualizar. O que está abaixo pode estar desatualizado.
                </Alert>
            )}

            {callsError && (
                <Alert
                    tone="warning"
                    role="alert"
                    className="mb-4"
                    action={<Button variant="secondary" onClick={() => refreshCalls()}>Tentar de novo</Button>}
                >
                    Não conseguimos carregar os chamados deste turno.
                </Alert>
            )}

            {/* Só o chamado vivo fica no topo; os encerrados vão para o histórico, depois dos freelas. */}
            <ShiftCallsPanel
                part="open"
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
                    <Card padding="sm" tone="nested" className="mb-4 flex flex-wrap items-center gap-2">
                        <span className="mr-1 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                            <CalendarClock size={14} /> Confirmação de véspera
                        </span>
                        <StatusBadge tone="success">
                            {summary.confirmed} confirmado{summary.confirmed !== 1 ? 's' : ''}
                        </StatusBadge>
                        {summary.noResponse > 0 && (
                            <StatusBadge tone="neutral">{summary.noResponse} sem resposta</StatusBadge>
                        )}
                        {summary.cannotAttend > 0 && (
                            <StatusBadge tone="danger">
                                {summary.cannotAttend} não {summary.cannotAttend === 1 ? 'vem' : 'vêm'}
                            </StatusBadge>
                        )}
                        {summary.notAsked > 0 && (
                            <StatusBadge tone="neutral">
                                {summary.notAsked} não perguntado{summary.notAsked !== 1 ? 's' : ''}
                            </StatusBadge>
                        )}
                    </Card>
                );
            })()}

            <div className="worki-side-grid">
            {/* Freelas do turno: vêm antes de qualquer histórico. */}
            <div className="mb-6 space-y-4" data-main>
                {loading ? (
                    <SkeletonList count={3} itemClassName="h-32" />
                ) : candidates.length === 0 ? (
                    <EmptyState
                        icon={Users}
                        title="Nenhum freela neste turno."
                        description={filledCount < jobSlots ? 'Use "Chamar freelas" para convidar quem está no seu Elenco.' : undefined}
                    />
                ) : (
                    candidates.map((app) => {
                        const expired = isInviteExpired(app);
                        const cancelledInvite = !expired && isInviteCancelledUnanswered(app);
                        const onShift = app.status === 'hired' || app.status === 'in_progress';
                        const reviewsCount = app.worker?.reviews_count ?? 0;
                        const { response, requestCount, lastRequestedAt } = summarizeConfirmation(confirmationsByApp[app.id]);
                        const cooldownMs = confirmationCooldownRemainingMs(lastRequestedAt);
                        const canRequest = response === null && requestCount < CONFIRMATION_REQUEST_CAP && cooldownMs === 0;
                        const beforeArrival = !app.worker_checkin_at && !app.company_checkin_confirmed_at && !app.company_checkout_confirmed_at;
                        const disabledReason = response !== null
                            ? null
                            : requestCount >= CONFIRMATION_REQUEST_CAP
                                ? 'Limite de 2 pedidos atingido'
                                : cooldownMs > 0
                                    ? `Aguarde ${formatCooldownRemaining(cooldownMs)}`
                                    : null;
                        const hasRiskSignal = response === 'cannot_attend' || (response === null && requestCount > 0);

                        return (
                        <Card key={app.id} padding="sm" data-testid="freela-card">
                            {/* Zona 1: quem é e em que estado está. Só avatar e nome levam ao perfil. */}
                            <div className="flex items-start gap-2">
                                <button
                                    type="button"
                                    // O perfil completo é do Gestor; o Encarregado já vê nome, função, nota e cidade aqui.
                                    onClick={podeEstornar ? () => navigate(`/company/worker/${app.worker_id}`) : undefined}
                                    disabled={!podeEstornar}
                                    aria-label={podeEstornar ? `Ver perfil de ${app.worker?.full_name || 'freela'}` : undefined}
                                    className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl text-left active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                                >
                                    <span className="block h-12 w-12 shrink-0 overflow-hidden rounded-full border-2 border-black bg-gray-200">
                                        {app.worker?.avatar_url ? (
                                            <img src={app.worker.avatar_url} alt="" className="h-full w-full object-cover" />
                                        ) : (
                                            <span className="flex h-full w-full items-center justify-center bg-black text-lg font-bold text-white">
                                                {app.worker?.full_name?.[0] || '?'}
                                            </span>
                                        )}
                                    </span>
                                    <span className="min-w-0">
                                        <span className="block break-words text-base font-bold leading-tight">{app.worker?.full_name || 'Freela'}</span>
                                        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-gray-600">
                                            {app.worker?.primary_role && <span>{roleLabel(app.worker.primary_role)}</span>}
                                            {app.worker?.city && <span className="flex items-center gap-1"><MapPin size={12} /> {app.worker.city}</span>}
                                            {/* Sem avaliação não há nota: nada de "5.0" inventado nem campo vazio. */}
                                            {app.worker?.rating_average && reviewsCount > 0 ? (
                                                <span className="flex items-center gap-1">
                                                    <Star size={12} className="fill-yellow-500 text-yellow-500" />
                                                    {Number(app.worker.rating_average).toFixed(1)} ({reviewsCount === 1 ? '1 avaliação' : `${reviewsCount} avaliações`})
                                                </span>
                                            ) : null}
                                        </span>
                                    </span>
                                </button>
                                {podeUsarChat && (
                                    <IconButton
                                        data-copilot="empresa.presenca.abrir-chat"
                                        onClick={() => handleChat(app)}
                                        aria-label="Abrir chat com freela"
                                    >
                                        <MessageSquare size={20} />
                                    </IconButton>
                                )}
                                {PULL_HIRE_ENABLED && app.status === 'pending' && (
                                    <>
                                        <IconButton onClick={() => handleUpdateStatus(app.id, 'rejected')} aria-label="Descartar freela">
                                            <XCircle size={20} />
                                        </IconButton>
                                        <IconButton onClick={() => handleUpdateStatus(app.id, 'interview')} aria-label="Aprovar freela para entrevista">
                                            <CheckCircle size={20} />
                                        </IconButton>
                                    </>
                                )}
                            </div>

                            {app.status !== 'pending' && (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    {expired ? (
                                        <StatusBadge tone="neutral">Não respondeu (expirado)</StatusBadge>
                                    ) : cancelledInvite ? (
                                        <StatusBadge tone="neutral">Convite cancelado</StatusBadge>
                                    ) : activeShiftLabel(app) ? (
                                        <StatusBadge tone={activeShiftLabel(app) === 'Contratado' ? 'success' : activeShiftLabel(app) === 'Saída confirmada' ? 'warning' : 'info'}>
                                            {activeShiftLabel(app)}
                                        </StatusBadge>
                                    ) : (
                                        <StatusBadge domain="application" status={app.status}>{statusLabel('application', app.status)}</StatusBadge>
                                    )}
                                    {onShift && app.company_checkin_confirmed_at && (
                                        <StatusBadge tone="success" icon={CheckCircle}>
                                            {app.worker_checkin_at ? 'Chegada OK' : 'Chegada registrada pela empresa'}
                                        </StatusBadge>
                                    )}
                                    {onShift && app.company_checkout_confirmed_at && (
                                        <StatusBadge tone="success" icon={CheckCircle}>
                                            {app.worker_checkout_at ? 'Saída OK' : 'Saída registrada pela empresa'}
                                        </StatusBadge>
                                    )}
                                    {onShift && response === 'confirmed' && <StatusBadge tone="success" icon={ThumbsUp}>Confirmou presença</StatusBadge>}
                                    {onShift && response === 'cannot_attend' && <StatusBadge tone="danger" icon={ThumbsDown}>Avisou que não vai</StatusBadge>}
                                    {onShift && response === null && requestCount > 0 && <StatusBadge tone="neutral" icon={Bell}>Sem resposta</StatusBadge>}
                                </div>
                            )}

                            {qrMode && presenceChecks && ['hired', 'in_progress', 'completed'].includes(app.status)
                                && presenceChecks.some((c) => c.application_id === app.id) && (
                                <PresenceBadge
                                    className="mt-2"
                                    checks={presenceChecks.filter((c) => c.application_id === app.id)}
                                    departureDone={!!(app.worker_checkout_at || app.company_checkout_confirmed_at)}
                                />
                            )}

                            {/* Etapas */}
                            {['hired', 'in_progress', 'completed'].includes(app.status) && (
                                <div className="mt-3">
                                    <JobLifecycleStepper steps={computeSteps(app)} />
                                </div>
                            )}

                            {/* Zona 2: o próximo passo. */}
                            {app.status !== 'pending' && (
                                <div className="mt-3 space-y-2">
                                    {(expired || cancelledInvite) && filledCount < jobSlots && (
                                        <Button
                                            variant="secondary"
                                            fullWidth
                                            iconLeft={<Send size={16} />}
                                            data-copilot="empresa.presenca.chamar-outro"
                                            onClick={() => setCallModalOpen(true)}
                                        >
                                            Chamar outro freela
                                        </Button>
                                    )}

                                    {!expired && !cancelledInvite && app.status === 'invited' && (
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            {app.worker?.phone ? (
                                                <Button
                                                    variant="secondary"
                                                    iconLeft={<MessageCircle size={16} />}
                                                    data-copilot="empresa.presenca.avisar-whatsapp"
                                                    onClick={() => handleWhatsAppNotify(app)}
                                                >
                                                    Avisar no WhatsApp
                                                </Button>
                                            ) : (
                                                <span className="text-xs text-gray-600" title="Freela sem telefone cadastrado">WhatsApp indisponível</span>
                                            )}
                                            <Button
                                                variant="dangerOutline"
                                                iconLeft={<X size={16} />}
                                                data-copilot="empresa.presenca.cancelar-convite"
                                                data-copilot-risk="D"
                                                onClick={() => { void handleCancelInvite(app); }}
                                                loading={cancelInviteId === app.id}
                                            >
                                                Cancelar convite
                                            </Button>
                                        </div>
                                    )}

                                    {app.status === 'interview' && PULL_HIRE_ENABLED && (
                                        <Button variant="dark" fullWidth onClick={() => handleUpdateStatus(app.id, 'hired')}>
                                            Contratar
                                        </Button>
                                    )}

                                    {/* Ordem chegada→saída EXIGIDA: a saída só aparece depois da chegada confirmada
                                        (sem ela o horário manual de saída perde a referência de virada do dia e o
                                        recibo fica sem horas para sempre). */}
                                    {onShift && renderPresenceStep(app)}

                                    {/* Concluído: o pagamento continua à mão (recibo e estorno inclusive). Turno
                                        concluído sem marcador cai em registrar/agendar (rede de segurança). */}
                                    {app.status === 'completed' && !escrowKindMap[app.id] && renderCompletionAction(app)}

                                    {app.status === 'completed' && (
                                        <Button
                                            variant="ghost"
                                            iconLeft={<Star size={16} />}
                                            data-copilot="empresa.presenca.avaliar"
                                            onClick={() => { setSelectedApp(app); setRating(0); setRatingModalOpen(true); }}
                                        >
                                            Avaliar
                                        </Button>
                                    )}

                                    {/* Confirmação de véspera: quem já chegou ou saiu não precisa dizer que vem. */}
                                    {onShift && response === null && beforeArrival && (
                                        <div>
                                            <Button
                                                variant="secondary"
                                                fullWidth
                                                iconLeft={<Bell size={16} />}
                                                data-copilot="empresa.presenca.perguntar-se-vem"
                                                onClick={() => { void handleRequestConfirmation(app.id); }}
                                                disabled={!canRequest}
                                                loading={requestingConfirmationId === app.id}
                                            >
                                                Perguntar se vem
                                            </Button>
                                            {/* `title` some no toque: o motivo fica visível. */}
                                            {disabledReason && <p className="mt-1 text-xs text-gray-600">{disabledReason}</p>}
                                        </div>
                                    )}
                                </div>
                            )}

                            {app.cover_letter && (
                                <p className="mt-3 line-clamp-2 break-words rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600">
                                    "{app.cover_letter}"
                                </p>
                            )}

                            {app.worker?.tags && app.worker.tags.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {app.worker.tags.map((tag: string) => (
                                        <StatusBadge key={tag} tone="neutral">{tag}</StatusBadge>
                                    ))}
                                </div>
                            )}

                            {/* Zona 3: gesto destrutivo, separado. "Dispensar" é para ANTES do turno acontecer
                                (`hasAttendedShift` é o mesmo predicado do service). Com sinal de risco na véspera,
                                encadeia o chamado do substituto DEPOIS de dispensar. */}
                            {onShift && !hasAttendedShift(app) && (
                                <div className="mt-3 flex justify-end border-t border-gray-200 pt-3">
                                    <Button
                                        variant="dangerOutline"
                                        iconLeft={hasRiskSignal ? <Megaphone size={16} /> : <UserX size={16} />}
                                        data-copilot="empresa.presenca.dispensar"
                                        data-copilot-risk="D"
                                        onClick={() => { setDismissApp(app); setDismissThenCall(hasRiskSignal); }}
                                    >
                                        {hasRiskSignal ? 'Dispensar e chamar substituto' : 'Dispensar'}
                                    </Button>
                                </div>
                            )}
                        </Card>
                        );
                    })
                )}
            </div>

            <div data-side>
                <ShiftCallsPanel
                    part="history"
                    calls={calls}
                    loading={callsLoading}
                    cancellingId={cancellingCallId}
                    onCancel={(callId) => void cancelCall(callId)}
                />
            </div>
            </div>

            {/* Modal de Confirmação de Entrega (escrow legado) */}
            {confirmDeliveryApp && (
                <Dialog labelledBy="entrega-titulo" onClose={fecharModalAberto}>
                    <DialogHeader titleId="entrega-titulo" title="Confirmar entrega" subtitle={confirmDeliveryApp.worker?.full_name} />
                    <p className="text-sm text-gray-600">
                        Confirmar que o turno foi cumprido? Ele será marcado como concluído. O pagamento pelo Workyn está pausado: a plataforma não envia dinheiro ao freela. Pague por fora (PIX ou dinheiro) e guarde o comprovante.
                    </p>
                    <DialogActions>
                        <Button variant="secondary" onClick={() => setConfirmDeliveryApp(null)} disabled={releasing}>
                            Voltar
                        </Button>
                        <Button variant="dark" data-copilot-risk="D" onClick={() => handleConfirmDelivery(confirmDeliveryApp)} loading={releasing}>
                            Confirmar
                        </Button>
                    </DialogActions>
                </Dialog>
            )}

            {/* Modal de horário manual — chegada/saída sem marcação do freela no app. O recibo é o
                único artefato de auditoria do modo A: não pode gravar o momento do clique. */}
            {manualAttendance && (
                <Dialog labelledBy="presenca-manual-titulo" onClose={fecharModalAberto}>
                    <DialogHeader
                        titleId="presenca-manual-titulo"
                        title={manualAttendance.type === 'checkin' ? 'Registrar chegada' : 'Registrar saída'}
                        subtitle={`${manualAttendance.app.worker?.full_name || 'Este freela'} não marcou ${manualAttendance.type === 'checkin' ? 'a chegada' : 'a saída'} no app`}
                    />

                    <Field
                        label={`Horário real de ${manualAttendance.type === 'checkin' ? 'chegada' : 'saída'}`}
                        hint={manualPrefilled
                            ? 'Pré-preenchido com o horário planejado do turno. Ajuste para o horário real, se foi diferente. Este dado vai para o recibo do freela.'
                            : 'Informe o horário real. O campo vem vazio quando o horário planejado ainda não chegou ou não foi definido. Este dado vai para o recibo do freela.'}
                    >
                        <input
                            id="manual-attendance-time"
                            type="time"
                            value={manualAttendanceTime}
                            onChange={(e) => setManualAttendanceTime(e.target.value)}
                        />
                    </Field>

                    <DialogActions>
                        <Button variant="secondary" onClick={closeManualAttendanceModal} disabled={confirmingManualAttendance}>
                            Voltar
                        </Button>
                        <Button
                            variant="dark"
                            data-copilot-risk="D"
                            onClick={handleConfirmManualAttendance}
                            disabled={!manualAttendanceTime}
                            loading={confirmingManualAttendance}
                        >
                            Confirmar
                        </Button>
                    </DialogActions>
                </Dialog>
            )}

            {/* "Dispensar deste turno" — gesto sério, exige confirmação explícita. */}
            {dismissApp && (
                <Dialog labelledBy="dispensar-titulo" onClose={fecharModalAberto} initialFocus="panel">
                    <DialogHeader
                        titleId="dispensar-titulo"
                        title={dismissThenCall ? 'Dispensar e Chamar Substituto' : 'Dispensar Freela'}
                    />
                    <div className="space-y-3 text-sm text-gray-600">
                        <p>
                            {dismissApp.worker?.full_name || 'Este freela'} já foi contratado para este turno e conta
                            com ele. Ao dispensar, o turno sai da agenda dessa pessoa imediatamente.
                        </p>
                        {dismissThenCall && (
                            <p>Em seguida, o chamado deste turno abre para você chamar um substituto do Elenco.</p>
                        )}
                        <Alert tone="warning">
                            O freela é avisado pelo Workyn assim que você confirmar. Se o turno for logo,
                            vale reforçar por telefone ou WhatsApp.
                        </Alert>
                    </div>
                    <DialogActions stacked>
                        <Button variant="secondary" onClick={() => { setDismissApp(null); setDismissThenCall(false); }} disabled={dismissing}>
                            Voltar
                        </Button>
                        <Button variant="danger" data-copilot-risk="D" onClick={handleDismissFromShift} loading={dismissing}>
                            {dismissThenCall ? 'Confirmar e chamar substituto' : 'Confirmar dispensa'}
                        </Button>
                    </DialogActions>
                </Dialog>
            )}

            {/* Estorno (recorded) ou cancelamento de agendamento (scheduled) */}
            {voidingPayment && (
                <Dialog labelledBy="estorno-titulo" onClose={fecharModalAberto}>
                    <DialogHeader
                        titleId="estorno-titulo"
                        title={voidingPayment.status === 'scheduled' ? 'Cancelar este agendamento?' : 'Estornar pagamento'}
                        subtitle={formatBRL(voidingPayment.amount)}
                    />
                    <p className="mb-4 text-sm text-gray-600">
                        {voidingPayment.status === 'scheduled'
                            ? 'O freela é avisado e o comprovante de agendamento deixa de valer.'
                            : 'Isto estorna o registro de pagamento. O freela é avisado. Use se registrou por engano ou o pagamento não aconteceu.'}
                    </p>
                    <Field label="Motivo (opcional)">
                        <textarea
                            value={voidReason}
                            onChange={(e) => setVoidReason(e.target.value)}
                            placeholder="Ex.: registrei no turno errado"
                            rows={2}
                        />
                    </Field>
                    <DialogActions>
                        <Button variant="secondary" onClick={() => { setVoidingPayment(null); setVoidReason(''); }} disabled={voidSubmitting}>
                            Voltar
                        </Button>
                        <Button variant="danger" data-copilot-risk="D" onClick={handleVoidPayment} loading={voidSubmitting}>
                            {voidingPayment.status === 'scheduled' ? 'Cancelar agendamento' : 'Confirmar estorno'}
                        </Button>
                    </DialogActions>
                </Dialog>
            )}

            {/* "Registrar pagamento" — modo A (pagamento externo declaratório) */}
            {paymentModalApp && (
                <Dialog labelledBy="pagamento-titulo" onClose={fecharModalAberto} focusKey={paymentRecorded ? 'ok' : 'form'}>
                    {!paymentRecorded ? (
                        <>
                            <DialogHeader
                                titleId="pagamento-titulo"
                                title="Registrar pagamento"
                                subtitle={
                                    <>
                                        <span className="block font-bold text-black">{paymentModalApp.worker?.full_name || 'Freela'} · {jobTitle}</span>
                                        {shiftWhen(jobStartDate, jobStartTime, jobEndTime)}. Você paga por fora do Workyn; aqui fica só o registro.
                                    </>
                                }
                            />

                            <div className="space-y-4">
                                {renderSourcePicker(paymentSource, setPaymentSource)}
                                {renderPix(paymentModalApp)}
                                {/* Informa; nunca bloqueia o pagamento. Falha de leitura = sem selo. */}
                                {qrMode && presenceChecks && (
                                    <PresenceBadge
                                        checks={presenceChecks.filter((c) => c.application_id === paymentModalApp.id)}
                                        departureDone={!!(paymentModalApp.worker_checkout_at || paymentModalApp.company_checkout_confirmed_at)}
                                    />
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
                                    />
                                </Field>

                                <p className="text-xs text-gray-600">
                                    O dinheiro não passa pelo Worki. Este registro é declaratório e não é documento fiscal.
                                </p>
                                <p className="text-sm font-bold">Ao confirmar, o turno é marcado como concluído.</p>
                            </div>

                            {!(paymentAmount > 0) && (
                                <p role="alert" className="mt-4 text-sm font-semibold text-red-700">
                                    Informe um valor maior que zero para confirmar o registro.
                                </p>
                            )}

                            <DialogActions>
                                <Button variant="secondary" onClick={closePaymentModal} disabled={recordingPayment}>
                                    Voltar
                                </Button>
                                <Button
                                    variant="dark"
                                    data-copilot-risk="D"
                                    onClick={handleRecordPayment}
                                    disabled={!(paymentAmount > 0)}
                                    loading={recordingPayment}
                                >
                                    Confirmar Registro
                                </Button>
                            </DialogActions>
                        </>
                    ) : (
                        <div className="text-center">
                            <CheckCircle size={40} aria-hidden="true" className="mx-auto mb-3 text-primary" />
                            <h2 id="pagamento-titulo" className="text-lg font-bold">Pagamento registrado!</h2>
                            <p className="mt-1 text-sm text-gray-600">O recibo já está disponível para você e para o profissional.</p>
                            <DialogActions>
                                <Button variant="secondary" onClick={closePaymentModal}>Fechar</Button>
                                <Button
                                    variant="dark"
                                    iconLeft={<Receipt size={16} />}
                                    onClick={() => navigate(receiptPath(paymentModalApp.job_id, paymentModalApp.worker_id))}
                                >
                                    Ver recibo
                                </Button>
                            </DialogActions>
                        </div>
                    )}
                </Dialog>
            )}

            {/* "Agendar pagamento" — modo A, promessa com data prevista (ADR-20260712) */}
            {scheduleModalApp && (
                <Dialog labelledBy="agendamento-titulo" onClose={fecharModalAberto} focusKey={paymentScheduled ? 'ok' : 'form'}>
                    {!paymentScheduled ? (
                        <>
                            <DialogHeader
                                titleId="agendamento-titulo"
                                title="Agendar pagamento"
                                subtitle={
                                    <>
                                        <span className="block font-bold text-black">{scheduleModalApp.worker?.full_name || 'Freela'} · {jobTitle}</span>
                                        {shiftWhen(jobStartDate, jobStartTime, jobEndTime)}
                                    </>
                                }
                            />

                            <div className="space-y-4">
                                {renderSourcePicker(scheduleSource, setScheduleSource)}
                                {renderPix(scheduleModalApp)}

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
                                    />
                                </Field>

                                <Alert tone="warning">
                                    Isto é uma promessa, ainda não um pagamento. O dinheiro não passa pelo Workyn; quando pagar, toque em "Marcar como pago".
                                </Alert>
                                <p className="text-sm font-bold">Ao confirmar, o turno é marcado como concluído.</p>
                            </div>

                            <DialogActions>
                                <Button variant="secondary" onClick={closeScheduleModal} disabled={scheduling}>
                                    Voltar
                                </Button>
                                <Button
                                    variant="dark"
                                    data-copilot-risk="D"
                                    onClick={handleSchedulePayment}
                                    disabled={!(scheduleAmount > 0) || !scheduledFor}
                                    loading={scheduling}
                                >
                                    Agendar
                                </Button>
                            </DialogActions>
                        </>
                    ) : (
                        <div className="text-center">
                            <CalendarClock size={40} aria-hidden="true" className="mx-auto mb-3 text-primary" />
                            <h2 id="agendamento-titulo" className="text-lg font-bold">Pagamento agendado!</h2>
                            <p className="mt-1 text-sm text-gray-600">O comprovante de agendamento já está disponível para você e para o profissional.</p>
                            <DialogActions>
                                <Button variant="secondary" onClick={closeScheduleModal}>Fechar</Button>
                                <Button
                                    variant="dark"
                                    iconLeft={<Receipt size={16} />}
                                    onClick={() => navigate(receiptPath(scheduleModalApp.job_id, scheduleModalApp.worker_id))}
                                >
                                    Ver Comprovante
                                </Button>
                            </DialogActions>
                        </div>
                    )}
                </Dialog>
            )}

            {/* Avaliação */}
            {ratingModalOpen && (
                <Dialog labelledBy="avaliar-titulo" onClose={fecharModalAberto} initialFocus="panel">
                    <DialogHeader
                        titleId="avaliar-titulo"
                        title="Avaliar Freela"
                        subtitle={`${selectedApp?.worker?.full_name ?? 'Freela'} · ${jobTitle}`}
                        onClose={() => setRatingModalOpen(false)}
                    />

                    <div className="mb-2 flex justify-center gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                            <IconButton
                                key={star}
                                onClick={() => setRating(star)}
                                aria-label={`Nota ${star} de 5`}
                                aria-pressed={star <= rating}
                            >
                                <Star
                                    size={32}
                                    fill={star <= rating ? "#fbbf24" : "none"}
                                    className={star <= rating ? "text-yellow-500" : "text-gray-400"}
                                    strokeWidth={2}
                                />
                            </IconButton>
                        ))}
                    </div>
                    {rating === 0 && <p className="mb-4 text-center text-xs text-gray-600">Escolha de 1 a 5 estrelas para enviar.</p>}

                    <Field label="Comentário (Opcional)">
                        <textarea
                            id="review-comment"
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            placeholder="Como foi a experiência?"
                        />
                    </Field>

                    <Button
                        variant="dark"
                        size="lg"
                        fullWidth
                        className="mt-6"
                        data-copilot="empresa.presenca.enviar-avaliacao"
                        onClick={handleSubmitReview}
                        disabled={rating === 0}
                        loading={submittingReview}
                    >
                        Enviar Avaliação
                    </Button>
                </Dialog>
            )}

            {/* Chamado de turno (F1) — disparo para 1..N do elenco, primeiro-aceite */}
            {callModalOpen && (
                <ShiftCallModal
                    job={{
                        id: id ?? '',
                        title: jobTitle,
                        start_date: jobStartDate,
                        work_start_time: jobStartTime ?? undefined,
                        work_end_time: jobEndTime ?? undefined,
                        company_id: jobCompanyId,
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
