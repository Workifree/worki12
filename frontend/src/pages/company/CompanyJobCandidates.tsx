import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { WalletService } from '../../services/walletService';
import { PaymentRecordService } from '../../services/paymentRecordService';
import { SpendLimitService } from '../../services/spendLimitService';
import { TeamConnectionService } from '../../services/teamConnectionService';
import { useCompanyInvites } from '../../hooks/useShiftInvites';
import { logError } from '../../lib/logger';
import { ArrowLeft, Star, MapPin, Clock, ChevronRight, CheckCircle, XCircle, MessageSquare, Play, Square, Loader2, Receipt, Send, Users, X, CalendarClock, Wallet, Copy, Check } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useToast } from '../../contexts/ToastContext';
import JobLifecycleStepper from '../../components/JobLifecycleStepper';
import EscrowStatusBadge from '../../components/EscrowStatusBadge';
import type { Application, PaymentSource, ShiftPayment, TeamMember } from '../../types';

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

const PAYMENT_SOURCE_LABELS: Record<PaymentSource, string> = {
    external_pix: 'PIX',
    cash: 'Dinheiro',
    other: 'Outro',
};

/**
 * Formata uma data "date-only" (`scheduled_for`, YYYY-MM-DD) como data LOCAL, sem shift de
 * fuso. `new Date("YYYY-MM-DD")` é interpretado como meia-noite UTC; em BRT (UTC-3) isso
 * recua a data em 1 dia. Mesmo padrão de `ReceiptView.formatDateOnly` / `components/JobCard.tsx`.
 */
function formatDateOnly(dateOnly: string): string {
    const [y, m, d] = dateOnly.split('-').map(Number);
    return format(new Date(y, m - 1, d), 'dd/MM/yyyy', { locale: ptBR });
}

// Fase 2 (piloto push-only): fluxo PULL "Contratar" aposentado — feed público escondido, contratação
// é 100% via convite do Elenco (push). O pull-hire dispara reserve_escrow (HARD-requer saldo), o que
// contradiz o pagamento opcional (modo A, ADR-20260630). Religar na Fase 2 = flip para true.
const PULL_HIRE_ENABLED = false;

export default function CompanyJobCandidates() {
    const { id } = useParams();
    const navigate = useNavigate();

    const [candidates, setCandidates] = useState<Application[]>([]);
    const [jobTitle, setJobTitle] = useState('');
    const [loading, setLoading] = useState(true);
    const [ratingModalOpen, setRatingModalOpen] = useState(false);
    const [selectedApp, setSelectedApp] = useState<Application | null>(null);
    const [rating, setRating] = useState(5);
    const [comment, setComment] = useState('');
    const [submittingReview, setSubmittingReview] = useState(false);
    const [confirmingCheckin, setConfirmingCheckin] = useState<string | null>(null);
    const [confirmDeliveryApp, setConfirmDeliveryApp] = useState<Application | null>(null);
    const [releasing, setReleasing] = useState(false);
    const [escrowStatusMap, setEscrowStatusMap] = useState<Record<string, 'reserved' | 'released'>>({});
    // Modo A (pagamento externo declaratório) — ramifica por escrow.kind por application.
    // Sem entrada no map = turno sem escrow (modo A); 'prepaid'/'postpaid' = caminho de escrow existente.
    const [escrowKindMap, setEscrowKindMap] = useState<Record<string, 'prepaid' | 'postpaid'>>({});
    const [jobBudget, setJobBudget] = useState(0);
    // Registro de pagamento externo (modo A) já feito para ESTE job (UNIQUE por job_id no schema).
    const [shiftPayment, setShiftPayment] = useState<ShiftPayment | null>(null);

    // Modal "Registrar pagamento" (modo A)
    const [paymentModalApp, setPaymentModalApp] = useState<Application | null>(null);
    const [paymentSource, setPaymentSource] = useState<PaymentSource>('external_pix');
    const [paymentAmount, setPaymentAmount] = useState(0);
    const [paymentPaidAt, setPaymentPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
    const [paymentNote, setPaymentNote] = useState('');
    const [recordingPayment, setRecordingPayment] = useState(false);
    const [paymentRecorded, setPaymentRecorded] = useState(false);
    // R1.4: copiar a chave PIX do freela direto dos modais de pagamento (modo A).
    const [pixCopied, setPixCopied] = useState(false);

    // Modal "Agendar pagamento" (modo A — ADR-20260712, promessa com data prevista)
    const [scheduleModalApp, setScheduleModalApp] = useState<Application | null>(null);
    const [scheduleSource, setScheduleSource] = useState<PaymentSource>('external_pix');
    const [scheduleAmount, setScheduleAmount] = useState(0);
    const [scheduledFor, setScheduledFor] = useState(() => new Date().toISOString().slice(0, 10));
    const [scheduleNote, setScheduleNote] = useState('');
    const [scheduling, setScheduling] = useState(false);
    const [paymentScheduled, setPaymentScheduled] = useState(false);
    // Efetivação de um pagamento já agendado ("Marcar como pago") — guarda o id em efetivação.
    const [effectivatingId, setEffectivatingId] = useState<string | null>(null);

    // "Convidar outro" — convite expirado sem resposta; o slot está livre para outro freela (R8).
    const [reopenApp, setReopenApp] = useState<Application | null>(null);
    const [reopenTeamMembers, setReopenTeamMembers] = useState<TeamMember[]>([]);
    const [reopenLoading, setReopenLoading] = useState(false);
    // "Convidar Freela" — vaga criada sem nenhum freela atrelado (mesmo picker, sem convite anterior).
    const [invitePickerOpen, setInvitePickerOpen] = useState(false);

    const { addToast } = useToast();
    // Reaproveita o hook do fluxo de convite (mesmo usado em CompanyCreateJob) para disparar
    // um novo convite a partir desta tela quando o anterior expirou sem resposta.
    const { invite: sendReopenInvite, invitingWorkerId: reopenInvitingWorkerId } = useCompanyInvites(id ?? '');

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
            const { data: job, error: jobError } = await supabase.from('jobs').select('title, budget').eq('id', id).eq('company_id', user.id).single();
            if (jobError || !job) { navigate('/company/jobs'); return; }
            setJobTitle(job.title);
            setJobBudget(job.budget ?? 0);

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

            // Fetch escrow status + kind per application for this job
            const { data: escrowRows } = await supabase
                .from('escrow_transactions')
                .select('application_id, status, kind')
                .eq('job_id', id);
            const statusMap: Record<string, 'reserved' | 'released'> = {};
            const kindMap: Record<string, 'prepaid' | 'postpaid'> = {};
            (escrowRows || []).forEach((row) => {
                if (row.application_id && (row.status === 'reserved' || row.status === 'released')) {
                    statusMap[row.application_id] = row.status;
                }
                if (row.application_id && (row.kind === 'prepaid' || row.kind === 'postpaid')) {
                    kindMap[row.application_id] = row.kind;
                }
            });
            setEscrowStatusMap(statusMap);
            setEscrowKindMap(kindMap);

            // Modo A: existe registro de pagamento externo já feito para este turno?
            const payment = await PaymentRecordService.getPaymentByJob(id);
            setShiftPayment(payment);
        } catch (error) {
            logError('CompanyJobCandidates', error);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateStatus = async (appId: string, newStatus: string) => {
        const { error } = await supabase.from('applications').update({ status: newStatus }).eq('id', appId);

        if (error) {
            logError('CompanyJobCandidates: handleUpdateStatus', error);
            // Fluxo pull legado: "hired" dispara o trigger auto_reserve_escrow_on_hire, que
            // reserva escrow atômico (RAISE EXCEPTION em Postgres se saldo insuficiente). A
            // mensagem do Postgres já é clara ("Saldo insuficiente...") — repassamos ela em vez
            // de um texto genérico. Nenhuma RPC/trigger foi alterada aqui, só o texto exibido.
            addToast(error.message || 'Erro ao atualizar status do freela.', 'error');
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
        const { error: updateError } = await supabase.from('applications').update({ status: 'completed' }).eq('id', app.id);
        if (updateError) {
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

    // Modo A (pagamento externo) — abre o modal "Registrar pagamento" pré-preenchido com o valor do turno.
    const openPaymentModal = (app: Application) => {
        setPaymentModalApp(app);
        setPaymentSource('external_pix');
        setPaymentAmount(jobBudget);
        setPaymentPaidAt(new Date().toISOString().slice(0, 10));
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
        setScheduledFor(new Date().toISOString().slice(0, 10));
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
                    addToast('Este turno já tem um pagamento registrado. Veja o recibo.', 'info');
                    closePaymentModal();
                    fetchCandidates();
                    return;
                }
                addToast(result.error || 'Não foi possível registrar o pagamento.', 'error');
                return;
            }

            // Registro OK — avaliar o alerta de teto de gasto (R12) com a MESMA fonte
            // unificada (escrow ∪ marcador externo) que o dashboard financeiro usa,
            // senão o alerta fica cego ao modo A (não há releaseEscrow para disparar isso).
            // Best-effort, fire-and-forget: nunca bloqueia nem falha o registro do pagamento
            // (espelha walletService.releaseOrCaptureEscrow.spendAlert).
            void (async () => {
                try {
                    const { data: { user: authUser } } = await supabase.auth.getUser();
                    if (authUser) {
                        await SpendLimitService.evaluateSpendAlert(authUser.id);
                    }
                } catch (alertErr) {
                    logError('CompanyJobCandidates: handleRecordPayment.spendAlert', alertErr);
                }
            })();

            // Registro OK — agora sim marcamos o turno como concluído. Falha aqui não
            // desfaz o registro (já é a fonte de verdade do pagamento); só avisamos.
            const { error: updateError } = await supabase
                .from('applications')
                .update({ status: 'completed' })
                .eq('id', paymentModalApp.id);
            if (updateError) {
                logError('CompanyJobCandidates: handleRecordPayment.updateStatus', updateError);
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
                    addToast('Este turno já tem um pagamento registrado ou agendado. Veja o comprovante.', 'info');
                    closeScheduleModal();
                    fetchCandidates();
                    return;
                }
                addToast(result.error || 'Não foi possível agendar o pagamento.', 'error');
                return;
            }

            const { error: updateError } = await supabase
                .from('applications')
                .update({ status: 'completed' })
                .eq('id', scheduleModalApp.id);
            if (updateError) {
                logError('CompanyJobCandidates: handleSchedulePayment.updateStatus', updateError);
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

    const handleSubmitReview = async () => {
        if (!selectedApp) return;
        setSubmittingReview(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            // Update Application Status to reviewed (best-effort, already completed)
            const { error: appError } = await supabase
                .from('applications')
                .update({ status: 'completed' })
                .eq('id', selectedApp.id);

            if (appError) {
                logError('CompanyJobCandidates: app status update failed', appError);
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

    const handleConfirmCheckin = async (appId: string) => {
        setConfirmingCheckin(appId);
        try {
            const { error } = await supabase
                .from('applications')
                .update({ 
                    company_checkin_confirmed_at: new Date().toISOString(),
                    status: 'in_progress'
                })
                .eq('id', appId);

            if (error) throw error;
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
        setConfirmingCheckin(appId);
        try {
            const { error } = await supabase
                .from('applications')
                .update({ company_checkout_confirmed_at: new Date().toISOString() })
                .eq('id', appId);

            if (error) throw error;
            fetchCandidates();
        } catch (error) {
            logError('CompanyJobCandidates', error);
            addToast('Erro ao confirmar check-out.', 'error');
        } finally {
            setConfirmingCheckin(null);
        }
    };

    const computeSteps = (app: Application) => {
        const checkinComplete = !!(app.worker_checkin_at && app.company_checkin_confirmed_at);
        const checkinActive = !!(app.worker_checkin_at && !app.company_checkin_confirmed_at);
        const checkoutComplete = !!(app.worker_checkout_at && app.company_checkout_confirmed_at);
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
    const renderScheduledPaymentBlock = (payment: ShiftPayment) => (
        <div className="flex items-center gap-2 flex-wrap">
            {payment.scheduled_for && (
                <span className="flex items-center gap-1 text-xs font-black uppercase px-3 py-1 rounded-lg border-2 bg-yellow-50 border-yellow-200 text-yellow-700">
                    <CalendarClock size={14} /> Agendado p/ {formatDateOnly(payment.scheduled_for)}
                </span>
            )}
            <button
                onClick={(e) => { e.stopPropagation(); handleEffectivatePayment(payment.id); }}
                disabled={effectivatingId === payment.id}
                className="py-2 px-3 bg-black text-white border-2 border-black rounded-lg text-xs font-bold uppercase hover:bg-primary transition-colors flex items-center gap-1 disabled:opacity-50"
            >
                {effectivatingId === payment.id && <Loader2 size={14} className="animate-spin" />}
                Marcar como pago
            </button>
            <button
                onClick={(e) => { e.stopPropagation(); navigate(`/recibo/${payment.job_id}`); }}
                className="py-2 px-3 bg-white text-black border-2 border-black rounded-lg text-xs font-bold uppercase hover:bg-gray-50 transition-colors flex items-center gap-1"
            >
                <Receipt size={14} /> Ver Comprovante
            </button>
        </div>
    );

    // Ramificação modo A (pagamento externo, registrado OU agendado) vs C (postpago/cartão)
    // vs prepago legado. Sem entrada em escrowKindMap = nenhum escrow reservado para este
    // turno → modo A (default do piloto).
    const renderCompletionAction = (app: Application) => {
        const kind = escrowKindMap[app.id];
        if (kind === 'prepaid' || kind === 'postpaid') {
            return (
                <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeliveryApp(app); }}
                    className="p-1 px-3 bg-black text-white border-2 border-black rounded-lg text-xs font-bold uppercase hover:bg-primary transition-colors flex items-center gap-1"
                >
                    Confirmar Entrega
                </button>
            );
        }
        const matchingPayment =
            shiftPayment && shiftPayment.job_id === app.job_id && shiftPayment.worker_id === app.worker_id
                ? shiftPayment
                : null;
        if (matchingPayment?.status === 'recorded') {
            return (
                <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/recibo/${app.job_id}`); }}
                    className="py-2 px-3 bg-white text-black border-2 border-black rounded-lg text-xs font-bold uppercase hover:bg-gray-50 transition-colors flex items-center gap-1"
                >
                    <Receipt size={14} /> Ver Recibo
                </button>
            );
        }
        if (matchingPayment?.status === 'scheduled') {
            return renderScheduledPaymentBlock(matchingPayment);
        }
        return (
            <div className="flex items-center gap-2 flex-wrap">
                <button
                    onClick={(e) => { e.stopPropagation(); openPaymentModal(app); }}
                    className="py-2 px-3 bg-black text-white border-2 border-black rounded-lg text-xs font-bold uppercase hover:bg-primary transition-colors flex items-center gap-1"
                >
                    Registrar Pagamento
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); openScheduleModal(app); }}
                    className="py-2 px-3 bg-white text-black border-2 border-black rounded-lg text-xs font-bold uppercase hover:bg-gray-50 transition-colors flex items-center gap-1"
                >
                    <CalendarClock size={14} /> Agendar Pagamento
                </button>
            </div>
        );
    };

    return (
        <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <button onClick={() => navigate('/company/jobs')} className="flex items-center gap-2 text-gray-400 font-bold hover:text-black transition-colors mb-2">
                        <ArrowLeft size={16} strokeWidth={3} /> Voltar para Turnos
                    </button>
                    <h1 className="text-3xl font-black uppercase tracking-tighter">Freelas do Turno</h1>
                    <p className="text-gray-500 font-bold">{jobTitle} • {candidates.length} freela{candidates.length !== 1 ? 's' : ''}</p>
                </div>
            </div>

            {/* Candidates List */}
            <div className="space-y-4">
                {loading ? (
                    <div className="space-y-4 animate-pulse">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="bg-gray-200 rounded-xl h-32" />
                        ))}
                    </div>
                ) : candidates.length === 0 ? (
                    <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-2xl">
                        <Users size={40} className="mx-auto mb-3 text-gray-300" />
                        <p className="text-gray-500 text-lg font-bold">Nenhum freela atrelado a este turno.</p>
                        <p className="text-gray-400 text-sm mt-2 mb-5">Convide um freela do seu elenco para começar.</p>
                        <button
                            onClick={() => void openInvitePicker()}
                            className="bg-black hover:bg-primary text-white px-6 py-3 rounded-xl font-black uppercase text-sm inline-flex items-center gap-2 transition-colors"
                        >
                            <Send size={16} /> Convidar Freela do Elenco
                        </button>
                    </div>
                ) : (
                    candidates.map((app) => (
                        <div key={app.id} role="button" tabIndex={0} className="bg-white border-2 border-gray-100 hover:border-black rounded-xl p-6 transition-all group hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] cursor-pointer" onClick={() => navigate(`/company/worker/${app.worker_id}`)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/company/worker/${app.worker_id}`); } }}>
                            <div className="flex flex-col md:flex-row gap-6">
                                {/* Avatar */}
                                <div className="flex-shrink-0">
                                    <div className="w-16 h-16 rounded-full bg-gray-200 border-2 border-black overflow-hidden relative">
                                        {app.worker?.avatar_url ? (
                                            <img src={app.worker.avatar_url} alt={app.worker.full_name} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center bg-black text-white font-black text-xl">
                                                {app.worker?.full_name?.[0] || '?'}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Info */}
                                <div className="flex-1">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h3 className="font-black text-xl flex items-center gap-2">
                                                {app.worker?.full_name || 'Usuário Worki'}
                                                <span className="bg-black text-white text-[10px] px-2 py-0.5 rounded-full uppercase">Lvl {app.worker?.level || 1}</span>
                                            </h3>
                                            <div className="flex items-center gap-4 text-xs font-bold text-gray-500 mt-1">
                                                <span className="flex items-center gap-1"><MapPin size={12} /> {app.worker?.city || 'Não informado'}</span>
                                                <span className="flex items-center gap-1">
                                                    <Star size={12} className="text-yellow-500 fill-yellow-500" />
                                                    {app.worker?.rating_average ? Number(app.worker.rating_average).toFixed(1) : '5.0'}
                                                    <span className="text-gray-400 font-medium ml-1">({app.worker?.reviews_count || 0} avaliações)</span>
                                                </span>
                                                <span className="flex items-center gap-1"><Clock size={12} /> Convidado {app.created_at ? formatDistanceToNow(new Date(app.created_at), { addSuffix: true, locale: ptBR }) : '—'}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 flex-wrap justify-end">
                                            {/* Escrow Status Badge — per-candidate status */}
                                            <EscrowStatusBadge escrowStatus={escrowStatusMap[app.id] ?? null} />

                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleChat(app); }}
                                                className="p-2 hover:bg-blue-50 text-gray-300 hover:text-blue-500 rounded-lg transition-colors"
                                                title="Chat"
                                                aria-label="Abrir chat com freela"
                                            >
                                                <MessageSquare size={24} />
                                            </button>
                                            {PULL_HIRE_ENABLED && app.status === 'pending' && (
                                                <>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleUpdateStatus(app.id, 'rejected'); }}
                                                        className="p-2 hover:bg-red-50 text-gray-300 hover:text-red-500 rounded-lg transition-colors"
                                                        title="Descartar"
                                                        aria-label="Descartar freela"
                                                    >
                                                        <XCircle size={24} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleUpdateStatus(app.id, 'interview'); }}
                                                        className="p-2 hover:bg-green-50 text-gray-300 hover:text-green-600 rounded-lg transition-colors"
                                                        title="Aprovar para Entrevista"
                                                        aria-label="Aprovar freela para entrevista"
                                                    >
                                                        <CheckCircle size={24} />
                                                    </button>
                                                </>
                                            )}
                                            {app.status !== 'pending' && (
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    {isInviteExpired(app) ? (
                                                            <>
                                                                <span className="text-xs font-black uppercase px-3 py-1 rounded-lg border-2 bg-gray-100 border-gray-300 text-gray-500">
                                                                    Não respondeu (expirado)
                                                                </span>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); void openReopenModal(app); }}
                                                                    className="p-1 px-3 bg-black text-white border-2 border-black rounded-lg text-xs font-bold uppercase hover:bg-primary transition-colors flex items-center gap-1"
                                                                >
                                                                    <Send size={14} /> Convidar outro
                                                                </button>
                                                            </>
                                                    ) : app.status === 'invited' ? (
                                                            <span className="text-xs font-black uppercase px-3 py-1 rounded-lg border-2 bg-blue-50 border-blue-100 text-blue-600">
                                                                Aguardando resposta
                                                            </span>
                                                    ) : (
                                                        <span className={`text-xs font-black uppercase px-3 py-1 rounded-lg border-2 ${app.status === 'hired' ? 'bg-green-100 border-green-200 text-green-700' :
                                                            app.status === 'in_progress' ? 'bg-orange-100 border-orange-200 text-orange-700' :
                                                            app.status === 'completed' ? 'bg-blue-100 border-blue-200 text-blue-700' :
                                                                app.status === 'rejected' ? 'bg-red-50 border-red-100 text-red-500' :
                                                                    'bg-blue-50 border-blue-100 text-blue-600'
                                                            }`}>
                                                            {app.status === 'interview' ? 'Em Entrevista' : app.status === 'hired' ? 'Contratado' : app.status === 'in_progress' ? 'Em Andamento' : app.status === 'completed' ? 'Finalizado' : 'Descartado'}
                                                        </span>
                                                    )}

                                                    {app.status === 'interview' && (
                                                        <>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleChat(app); }}
                                                                className="p-1 px-3 bg-blue-500 text-white rounded-lg text-xs font-bold uppercase hover:bg-blue-600 transition-colors flex items-center gap-1"
                                                            >
                                                                <MessageSquare size={14} /> Chat
                                                            </button>
                                                            {PULL_HIRE_ENABLED && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleUpdateStatus(app.id, 'hired'); }}
                                                                    className="p-1 px-3 bg-black text-white rounded-lg text-xs font-bold uppercase hover:bg-green-600 transition-colors"
                                                                >
                                                                    Contratar
                                                                </button>
                                                            )}
                                                        </>
                                                    )}

                                                    {(app.status === 'hired' || app.status === 'in_progress') && (
                                                        <>
                                                            {/* Show check-in status */}
                                                            {!app.company_checkin_confirmed_at ? (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleConfirmCheckin(app.id); }}
                                                                    disabled={confirmingCheckin === app.id}
                                                                    className="p-1.5 px-3 bg-green-600 text-white rounded-lg text-xs font-black uppercase hover:bg-green-700 transition-colors flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
                                                                >
                                                                    {confirmingCheckin === app.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                                                                    {app.worker_checkin_at ? 'Confirmar Chegada' : 'Confirmar Presença'}
                                                                </button>
                                                            ) : (
                                                                <span className="text-xs font-black text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-lg flex items-center gap-1">
                                                                    <CheckCircle size={13} /> Chegada OK
                                                                </span>
                                                            )}

                                                            {/* Show check-out status */}
                                                            {app.worker_checkout_at && !app.company_checkout_confirmed_at && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleConfirmCheckout(app.id); }}
                                                                    disabled={confirmingCheckin === app.id}
                                                                    className="p-1 px-3 bg-purple-500 text-white rounded-lg text-xs font-bold uppercase hover:bg-purple-600 transition-colors flex items-center gap-1 disabled:opacity-50"
                                                                >
                                                                    {confirmingCheckin === app.id ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
                                                                    Confirmar Saída
                                                                </button>
                                                            )}
                                                            {app.company_checkout_confirmed_at && (
                                                                <span className="text-xs font-bold text-purple-600 bg-purple-50 px-2 py-1 rounded flex items-center gap-1">
                                                                    <CheckCircle size={12} /> Saída OK
                                                                </span>
                                                            )}

                                                            {/* Confirmar Entrega (escrow) OU Registrar Pagamento (modo A) — ramificado por escrow.kind */}
                                                            {app.company_checkin_confirmed_at && app.company_checkout_confirmed_at && renderCompletionAction(app)}
                                                        </>
                                                    )}

                                                    {/* Turno finalizado via modo A (pagamento externo) — ramifica por status do marcador. */}
                                                    {app.status === 'completed' && !escrowKindMap[app.id] && (() => {
                                                        const matchingPayment =
                                                            shiftPayment && shiftPayment.job_id === app.job_id && shiftPayment.worker_id === app.worker_id
                                                                ? shiftPayment
                                                                : null;
                                                        if (matchingPayment?.status === 'recorded') {
                                                            return (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); navigate(`/recibo/${app.job_id}`); }}
                                                                    className="py-2 px-3 bg-white text-black border-2 border-black rounded-lg text-xs font-bold uppercase hover:bg-gray-50 transition-colors flex items-center gap-1"
                                                                >
                                                                    <Receipt size={14} /> Ver Recibo
                                                                </button>
                                                            );
                                                        }
                                                        if (matchingPayment?.status === 'scheduled') {
                                                            return renderScheduledPaymentBlock(matchingPayment);
                                                        }
                                                        // Rede de segurança (defense-in-depth): turno concluído em modo A (sem escrow)
                                                        // mas sem registro/agendamento de pagamento — caminho de recuperação caso o
                                                        // registro tenha falhado depois da conclusão em algum fluxo legado/edge case.
                                                        return (
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); openPaymentModal(app); }}
                                                                    className="py-2 px-3 bg-black text-white border-2 border-black rounded-lg text-xs font-bold uppercase hover:bg-primary transition-colors flex items-center gap-1"
                                                                >
                                                                    Registrar Pagamento
                                                                </button>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); openScheduleModal(app); }}
                                                                    className="py-2 px-3 bg-white text-black border-2 border-black rounded-lg text-xs font-bold uppercase hover:bg-gray-50 transition-colors flex items-center gap-1"
                                                                >
                                                                    <CalendarClock size={14} /> Agendar Pagamento
                                                                </button>
                                                            </div>
                                                        );
                                                    })()}

                                                    {/* Botão Avaliar — apenas para candidatos já finalizados */}
                                                    {app.status === 'completed' && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setSelectedApp(app); setRatingModalOpen(true); }}
                                                            className="p-1 px-3 bg-black text-white rounded-lg text-xs font-bold uppercase hover:bg-gray-800 transition-colors"
                                                        >
                                                            Avaliar
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Job Lifecycle Stepper */}
                                    {['hired', 'in_progress', 'completed'].includes(app.status) && (
                                        <div className="border-t border-gray-100 mt-4 pt-4">
                                            <JobLifecycleStepper steps={computeSteps(app)} />
                                        </div>
                                    )}

                                    {/* Cover Letter Snippet */}
                                    <div className="mt-4 bg-gray-50 p-3 rounded-xl border-l-4 border-gray-300">
                                        <p className="text-sm font-medium text-gray-600 italic line-clamp-2">
                                            "{app.cover_letter || 'Sem observações do freela.'}"
                                        </p>
                                    </div>

                                    {/* Tags */}
                                    {app.worker?.tags && (
                                        <div className="flex gap-2 mt-4 flex-wrap">
                                            {app.worker.tags.map((tag: string) => (
                                                <span key={tag} className="text-[10px] font-bold uppercase bg-gray-100 px-2 py-1 rounded text-gray-600">
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <ChevronRight size={24} className="text-gray-400" />
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Modal "Convidar Freela" — vaga sem freela (invitePickerOpen) ou convite expirado (reopenApp, R8) */}
            {(reopenApp || invitePickerOpen) && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6 border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-black uppercase tracking-tight">{reopenApp ? 'Convidar Outro Freela' : 'Convidar Freela'}</h2>
                            <button
                                onClick={closeReopenModal}
                                aria-label="Fechar"
                                className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <p className="text-sm font-bold text-gray-600 mb-5">
                            {reopenApp
                                ? 'O convite anterior expirou sem resposta. O slot deste turno está livre — escolha outro freela da sua equipe.'
                                : 'Escolha um freela do seu elenco para atrelar a este turno.'}
                        </p>

                        {reopenLoading && (
                            <div className="space-y-3 animate-pulse">
                                {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-gray-200 rounded-xl" />)}
                            </div>
                        )}

                        {!reopenLoading && reopenTeamMembers.length === 0 && (
                            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-2xl text-gray-400">
                                <Users size={32} className="mx-auto mb-2 opacity-30" />
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
                                        <div key={member.connection.id} className="flex items-center gap-3 p-3 rounded-xl border-2 border-gray-100 hover:border-black transition-all">
                                            <div className="w-10 h-10 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
                                                {avatarUrl ? (
                                                    <img src={avatarUrl} alt={member.worker.full_name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center bg-black text-white font-black">
                                                        {member.worker.full_name[0]?.toUpperCase()}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-black uppercase text-sm truncate">{member.worker.full_name}</p>
                                                {member.worker.primary_role && (
                                                    <p className="text-xs font-bold text-gray-400 uppercase truncate">{member.worker.primary_role}</p>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => void handlePickReopenWorker(member.worker.id)}
                                                disabled={isInviting}
                                                className="bg-black hover:bg-primary text-white px-4 py-2 rounded-xl font-black uppercase text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                                            >
                                                {isInviting ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                                                {isInviting ? '...' : 'Convidar'}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <button
                            onClick={closeReopenModal}
                            className="w-full mt-5 bg-gray-100 hover:bg-gray-200 text-gray-700 px-6 py-3 rounded-xl font-black uppercase text-sm transition-colors"
                        >
                            Fechar
                        </button>
                    </div>
                </div>
            )}

            {/* Modal de Confirmação de Entrega */}
            {confirmDeliveryApp && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6 border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                        <h2 className="text-xl font-black uppercase tracking-tight mb-4">Confirmar Entrega</h2>
                        <p className="text-gray-600 font-medium mb-6">
                            Tem certeza que deseja confirmar a entrega? O pagamento será liberado imediatamente ao profissional.
                        </p>
                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setConfirmDeliveryApp(null)}
                                disabled={releasing}
                                className="flex-1 py-3 border-2 border-black font-bold rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => handleConfirmDelivery(confirmDeliveryApp)}
                                disabled={releasing}
                                className="flex-1 py-3 bg-black text-white font-bold rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-primary hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {releasing ? <><Loader2 size={16} className="animate-spin" /> Processando...</> : 'Confirmar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal "Registrar Pagamento" — modo A (pagamento externo declaratório) */}
            {paymentModalApp && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6 border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                        {!paymentRecorded ? (
                            <>
                                <h2 className="text-xl font-black uppercase tracking-tight mb-1">Registrar Pagamento</h2>
                                <p className="text-xs font-bold text-gray-500 uppercase mb-5">
                                    Pagamento feito por fora do Worki — registro declaratório
                                </p>

                                <div className="mb-4">
                                    <span className="block text-sm font-bold uppercase mb-2">Forma de pagamento</span>
                                    <div className="grid grid-cols-3 gap-2">
                                        {(Object.keys(PAYMENT_SOURCE_LABELS) as PaymentSource[]).map((src) => (
                                            <button
                                                key={src}
                                                type="button"
                                                onClick={() => setPaymentSource(src)}
                                                aria-pressed={paymentSource === src}
                                                className={`py-3 min-h-[44px] rounded-xl border-2 border-black font-black text-xs uppercase transition-colors ${paymentSource === src ? 'bg-black text-white' : 'bg-white text-black hover:bg-gray-50'
                                                    }`}
                                            >
                                                {PAYMENT_SOURCE_LABELS[src]}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {paymentModalApp.worker?.pix_key && (
                                    <div className="mb-4 flex items-center justify-between gap-2 bg-primary/5 border-2 border-black rounded-xl px-4 py-3">
                                        <span className="flex items-center gap-2 text-sm font-bold text-black min-w-0">
                                            <Wallet size={16} className="flex-shrink-0" />
                                            <span className="truncate">{paymentModalApp.worker.pix_key}</span>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => handleCopyPix(paymentModalApp.worker!.pix_key as string)}
                                            aria-label="Copiar chave PIX do freela"
                                            title="Copiar chave PIX"
                                            className="p-2 rounded-lg text-black hover:bg-white transition-colors flex-shrink-0"
                                        >
                                            {pixCopied ? <Check size={16} /> : <Copy size={16} />}
                                        </button>
                                    </div>
                                )}

                                <div className="mb-4">
                                    <label htmlFor="payment-amount" className="block text-sm font-bold uppercase mb-2">
                                        Valor pago (R$)
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">R$</span>
                                        <input
                                            id="payment-amount"
                                            type="number"
                                            min="0.01"
                                            step="0.01"
                                            value={paymentAmount}
                                            onChange={(e) => setPaymentAmount(Number(e.target.value))}
                                            className="w-full border-2 border-black rounded-xl pl-12 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary font-bold tabular-nums"
                                        />
                                    </div>
                                </div>

                                <div className="mb-4">
                                    <label htmlFor="payment-paid-at" className="block text-sm font-bold uppercase mb-2">
                                        Data do pagamento
                                    </label>
                                    <input
                                        id="payment-paid-at"
                                        type="date"
                                        value={paymentPaidAt}
                                        onChange={(e) => setPaymentPaidAt(e.target.value)}
                                        className="w-full border-2 border-black rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary font-bold"
                                    />
                                </div>

                                <div className="mb-6">
                                    <label htmlFor="payment-note" className="block text-sm font-bold uppercase mb-2">
                                        Nota (opcional)
                                    </label>
                                    <textarea
                                        id="payment-note"
                                        value={paymentNote}
                                        onChange={(e) => setPaymentNote(e.target.value)}
                                        placeholder="Ex.: pago em 2x, referência do PIX..."
                                        className="w-full border-2 border-black rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary font-medium h-20 resize-none"
                                    />
                                </div>

                                <div className="mb-6 bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4">
                                    <p className="text-xs font-bold text-yellow-800">
                                        O dinheiro não passa pelo Worki. Este registro é declaratório, não é
                                        documento fiscal, e ao confirmar o turno será marcado como concluído.
                                    </p>
                                </div>

                                <div className="flex gap-3">
                                    <button
                                        onClick={closePaymentModal}
                                        disabled={recordingPayment}
                                        className="flex-1 py-3 border-2 border-black font-bold rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={handleRecordPayment}
                                        disabled={recordingPayment || !(paymentAmount > 0)}
                                        className="flex-1 py-3 bg-black text-white font-bold rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-primary hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {recordingPayment ? <><Loader2 size={16} className="animate-spin" /> Registrando...</> : 'Confirmar Registro'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col items-center text-center py-4">
                                <div className="w-16 h-16 rounded-full bg-primary-light border-2 border-black flex items-center justify-center mb-4">
                                    <CheckCircle size={32} className="text-primary" />
                                </div>
                                <h2 className="text-xl font-black uppercase tracking-tight mb-2">Pagamento registrado!</h2>
                                <p className="text-gray-600 font-medium mb-6">
                                    O recibo já está disponível para você e para o profissional.
                                </p>
                                <div className="flex gap-3 w-full">
                                    <button
                                        onClick={closePaymentModal}
                                        className="flex-1 py-3 border-2 border-black font-bold rounded-xl hover:bg-gray-50 transition-colors"
                                    >
                                        Fechar
                                    </button>
                                    <button
                                        onClick={() => navigate(`/recibo/${paymentModalApp.job_id}`)}
                                        className="flex-1 py-3 bg-black text-white font-bold rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-primary hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all flex items-center justify-center gap-2"
                                    >
                                        <Receipt size={16} /> Ver Recibo
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Modal "Agendar Pagamento" — modo A, promessa com data prevista (ADR-20260712) */}
            {scheduleModalApp && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6 border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                        {!paymentScheduled ? (
                            <>
                                <h2 className="text-xl font-black uppercase tracking-tight mb-1">Agendar Pagamento</h2>
                                <p className="text-xs font-bold text-gray-500 uppercase mb-5">
                                    Promessa de pagamento por fora do Worki — comprovante para o freela
                                </p>

                                <div className="mb-4">
                                    <span className="block text-sm font-bold uppercase mb-2">Forma de pagamento</span>
                                    <div className="grid grid-cols-3 gap-2">
                                        {(Object.keys(PAYMENT_SOURCE_LABELS) as PaymentSource[]).map((src) => (
                                            <button
                                                key={src}
                                                type="button"
                                                onClick={() => setScheduleSource(src)}
                                                aria-pressed={scheduleSource === src}
                                                className={`py-3 min-h-[44px] rounded-xl border-2 border-black font-black text-xs uppercase transition-colors ${scheduleSource === src ? 'bg-black text-white' : 'bg-white text-black hover:bg-gray-50'
                                                    }`}
                                            >
                                                {PAYMENT_SOURCE_LABELS[src]}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {scheduleModalApp.worker?.pix_key && (
                                    <div className="mb-4 flex items-center justify-between gap-2 bg-primary/5 border-2 border-black rounded-xl px-4 py-3">
                                        <span className="flex items-center gap-2 text-sm font-bold text-black min-w-0">
                                            <Wallet size={16} className="flex-shrink-0" />
                                            <span className="truncate">{scheduleModalApp.worker.pix_key}</span>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => handleCopyPix(scheduleModalApp.worker!.pix_key as string)}
                                            aria-label="Copiar chave PIX do freela"
                                            title="Copiar chave PIX"
                                            className="p-2 rounded-lg text-black hover:bg-white transition-colors flex-shrink-0"
                                        >
                                            {pixCopied ? <Check size={16} /> : <Copy size={16} />}
                                        </button>
                                    </div>
                                )}

                                <div className="mb-4">
                                    <label htmlFor="schedule-amount" className="block text-sm font-bold uppercase mb-2">
                                        Valor previsto (R$)
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">R$</span>
                                        <input
                                            id="schedule-amount"
                                            type="number"
                                            min="0.01"
                                            step="0.01"
                                            value={scheduleAmount}
                                            onChange={(e) => setScheduleAmount(Number(e.target.value))}
                                            className="w-full border-2 border-black rounded-xl pl-12 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary font-bold tabular-nums"
                                        />
                                    </div>
                                </div>

                                <div className="mb-4">
                                    <label htmlFor="schedule-for" className="block text-sm font-bold uppercase mb-2">
                                        Data prevista do pagamento
                                    </label>
                                    <input
                                        id="schedule-for"
                                        type="date"
                                        value={scheduledFor}
                                        onChange={(e) => setScheduledFor(e.target.value)}
                                        className="w-full border-2 border-black rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary font-bold"
                                    />
                                </div>

                                <div className="mb-6">
                                    <label htmlFor="schedule-note" className="block text-sm font-bold uppercase mb-2">
                                        Nota (opcional)
                                    </label>
                                    <textarea
                                        id="schedule-note"
                                        value={scheduleNote}
                                        onChange={(e) => setScheduleNote(e.target.value)}
                                        placeholder="Ex.: pagamento no fechamento do mês..."
                                        className="w-full border-2 border-black rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary font-medium h-20 resize-none"
                                    />
                                </div>

                                <div className="mb-6 bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4">
                                    <p className="text-xs font-bold text-yellow-800">
                                        Isto é uma PROMESSA, ainda não um pagamento — o dinheiro não passa pelo Worki.
                                        O comprovante de agendamento fica disponível para o freela; ao efetivar, marque
                                        "Marcar como pago". Ao confirmar, o turno será marcado como concluído.
                                    </p>
                                </div>

                                <div className="flex gap-3">
                                    <button
                                        onClick={closeScheduleModal}
                                        disabled={scheduling}
                                        className="flex-1 py-3 border-2 border-black font-bold rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={handleSchedulePayment}
                                        disabled={scheduling || !(scheduleAmount > 0) || !scheduledFor}
                                        className="flex-1 py-3 bg-black text-white font-bold rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-primary hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {scheduling ? <><Loader2 size={16} className="animate-spin" /> Agendando...</> : 'Confirmar Agendamento'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col items-center text-center py-4">
                                <div className="w-16 h-16 rounded-full bg-primary-light border-2 border-black flex items-center justify-center mb-4">
                                    <CalendarClock size={32} className="text-primary" />
                                </div>
                                <h2 className="text-xl font-black uppercase tracking-tight mb-2">Pagamento agendado!</h2>
                                <p className="text-gray-600 font-medium mb-6">
                                    O comprovante de agendamento já está disponível para você e para o profissional.
                                </p>
                                <div className="flex gap-3 w-full">
                                    <button
                                        onClick={closeScheduleModal}
                                        className="flex-1 py-3 border-2 border-black font-bold rounded-xl hover:bg-gray-50 transition-colors"
                                    >
                                        Fechar
                                    </button>
                                    <button
                                        onClick={() => navigate(`/recibo/${scheduleModalApp.job_id}`)}
                                        className="flex-1 py-3 bg-black text-white font-bold rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-primary hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all flex items-center justify-center gap-2"
                                    >
                                        <Receipt size={16} /> Ver Comprovante
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Rating Modal */}
            {ratingModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6 border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-2xl font-black uppercase tracking-tight">Avaliar Freela</h3>
                            <button onClick={() => setRatingModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                                <XCircle size={24} />
                            </button>
                        </div>

                        <div className="flex flex-col items-center mb-6">
                            <div className="w-20 h-20 rounded-full bg-gray-200 border-2 border-black overflow-hidden mb-3">
                                {selectedApp?.worker?.avatar_url ? (
                                    <img src={selectedApp.worker.avatar_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-black text-white font-black text-2xl">
                                        {selectedApp?.worker?.full_name?.[0]}
                                    </div>
                                )}
                            </div>
                            <h4 className="font-bold text-lg">{selectedApp?.worker?.full_name}</h4>
                            <p className="text-sm text-gray-500 font-bold uppercase">{selectedApp?.job?.title}</p>
                        </div>

                        <div className="flex justify-center gap-2 mb-6">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                    key={star}
                                    onClick={() => setRating(star)}
                                    className="transform hover:scale-110 transition-transform"
                                >
                                    <Star
                                        size={32}
                                        fill={star <= rating ? "#fbbf24" : "none"}
                                        className={star <= rating ? "text-yellow-500" : "text-gray-300"}
                                        strokeWidth={2}
                                    />
                                </button>
                            ))}
                        </div>

                        <div className="mb-6">
                            <label htmlFor="review-comment" className="block text-sm font-bold uppercase mb-2">Comentário (Opcional)</label>
                            <textarea
                                id="review-comment"
                                value={comment}
                                onChange={(e) => setComment(e.target.value)}
                                placeholder="Como foi a experiência?"
                                className="w-full border-2 border-gray-200 rounded-xl p-3 focus:outline-none focus:border-black transition-colors font-medium h-24 resize-none"
                            />
                        </div>

                        <button
                            onClick={handleSubmitReview}
                            disabled={submittingReview}
                            className="w-full bg-black text-white py-4 rounded-xl font-black uppercase tracking-wide hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {submittingReview ? 'Enviando...' : 'Enviar Avaliação'}
                        </button>
                    </div>
                </div>
            )}

        </div>
    );
}
