import { useEffect, useState } from 'react';
import LocalDoTurno from '../components/LocalDoTurno';
import ErroDeCarga from '../components/ErroDeCarga';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '../lib/supabase';
import { PaymentRecordService } from '../services/paymentRecordService';
import { logError } from '../lib/logger';
import { fillMissingWorkers } from '../services/workerCardsService';
import { formatDateOnly, calculateWorkedHours } from '../lib/dateUtils';
import PageMeta from '../components/PageMeta';
import ServiceTermSection from '../components/ServiceTermSection';
import HelpButton from '../layouts/HelpButton';
import { GuideRoleEmpresa, GuideRoleFreela } from '../components/guide/GuideRole';
import { ArrowLeft, Printer, Clock, AlertTriangle, LogIn, LogOut } from 'lucide-react';
import { Button, Card } from '../components/ui';
import type { ShiftPaymentReceipt } from '../services/paymentRecordService';
import type { PaymentSource } from '../types';
import { getSessionUserOrThrow } from '../lib/authSession';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { useLatestResponse } from '../hooks/useLatestResponse';
import { jobSources } from '../lib/realtime/liveSources';
import { formatBRL, formatWorkedTime } from '../lib/currency';
import { openShiftConversation, type MessagesLocationState } from '../lib/shiftChat';
import { useToast } from '../contexts/ToastContext';
import { isPresencaEnabled } from '../lib/features';
import { listPresenceChecks } from '../services/presenceService';
import { PresenceBadge } from '../components/presence/PresenceBadge';
import type { PresenceCheck } from '../lib/presence';

const PAYMENT_SOURCE_LABELS: Record<PaymentSource, string> = {
    external_pix: 'PIX',
    cash: 'Dinheiro',
    other: 'Outro',
};

/** Origem do horário exibido: marcação do próprio freela no app, ou confirmação manual da empresa. */
type AttendanceSource = 'worker' | 'company';

/**
 * Chegada/saída do turno. Prioriza a marcação do freela (`worker_checkin_at`/`worker_checkout_at`);
 * quando ausente, cai para a confirmação manual da empresa (`company_checkin_confirmed_at`/
 * `company_checkout_confirmed_at`) — caminho mais provável quando o freela não usa o app. O recibo
 * é documento de conferência: não pode omitir o horário, mas também não pode apresentar um dado
 * confirmado pela empresa como se fosse marcação do freela — por isso a origem é rastreada.
 */
interface VoidedPayment {
    amount: number | null;
    voided_at: string | null;
    void_reason: string | null;
    company: { name: string | null } | null;
}

/** `null` de valor nunca vira "R$ 0,00". */
function amountLabel(amount: number | null | undefined): string {
    return typeof amount === 'number' && amount > 0 ? formatBRL(amount) : 'Valor não informado';
}

/** Registro estornado do turno (o recibo ativo não o enxerga). Lança quando a consulta falha. */
async function fetchVoided(jobId: string, workerId: string | null): Promise<VoidedPayment | null> {
    let query = supabase
        .from('shift_payments')
        .select('amount, voided_at, void_reason, company:companies(name)')
        .eq('job_id', jobId)
        .eq('status', 'voided');
    if (workerId) query = query.eq('worker_id', workerId);
    const { data, error } = await query.order('voided_at', { ascending: false }).limit(1);
    if (error) throw error;
    return (data?.[0] as unknown as VoidedPayment | undefined) ?? null;
}

interface ShiftAttendance {
    checkin: string | null;
    checkinSource: AttendanceSource | null;
    checkout: string | null;
    checkoutSource: AttendanceSource | null;
}

export default function ReceiptView() {
    const { jobId } = useParams<{ jobId: string }>();
    const navigate = useNavigate();
    // ADR-20260816 — filtro de EXIBIÇÃO (qual freela, quando o turno tem mais de um), NUNCA
    // autorização: a RLS de `shift_payments` (sp_select_participants) decide o que a sessão
    // pode ver. Um `worker` alheio não vaza nada — `getReceipt` simplesmente não acha a linha.
    const [searchParams] = useSearchParams();
    const workerIdParam = searchParams.get('worker');

    const [loading, setLoading] = useState(true);
    const [receipt, setReceipt] = useState<ShiftPaymentReceipt | null>(null);
    const [erroCarga, setErroCarga] = useState(false);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    // Chegada/saída reais do turno — trazidas do recibo pra ser um documento de conferência,
    // não só de valor. Caminho legado sem application vinculada = sem attendance (não inventa).
    const [attendance, setAttendance] = useState<ShiftAttendance | null>(null);

    // Selo de presença (só turno `qr_gps`). `null` = não mostrar, inclusive em falha de leitura.
    const [presence, setPresence] = useState<PresenceCheck[] | null>(null);

    const [voided, setVoided] = useState<VoidedPayment | null>(null);
    const [disputing, setDisputing] = useState(false);
    const { addToast } = useToast();

    useEffect(() => {
        if (jobId) fetchReceipt();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- so precisa re-executar quando jobId/worker mudam
    }, [jobId, workerIdParam]);

    const beginReceipt = useLatestResponse();
    // O termo está sendo lido/aceito ou há confirmação em envio: nada muda sob a pessoa.
    const [termBusy, setTermBusy] = useState(false);
    const [liveVersion, setLiveVersion] = useState(0);

    // `silent` = recarga ao vivo: sem esqueleto e, se falhar, o recibo fica como está.
    const fetchReceipt = async ({ silent = false }: { silent?: boolean } = {}) => {
        const claim = beginReceipt();
        // G3: guarda de id falsy — evita `shift_payments?job_id=eq.null` mesmo se essa função
        // for chamada de outro lugar além do useEffect que já checa `if (jobId)`.
        if (!jobId) { setLoading(false); return; }
        if (!silent) setLoading(true);
        try {
            const user = await getSessionUserOrThrow(); // rede fora lança e cai no erro com retry
            if (!user) { if (!silent) navigate('/login'); return; }

            let data = await PaymentRecordService.getReceiptChecked(jobId, workerIdParam ?? undefined);
            // Encarregado: o embed `workers` volta `null`; o cartão do turno dá o nome.
            if (data && !data.worker) {
                const [filled] = await fillMissingWorkers(
                    [{ worker_id: data.payment.worker_id, worker: data.worker }], jobId,
                );
                data = { ...data, worker: filled.worker };
            }
            const nextVoided = data ? null : await fetchVoided(jobId, workerIdParam);
            // `undefined` = a leitura falhou numa recarga de fundo: mantém o que está na tela.
            let nextPresence: PresenceCheck[] | null | undefined = null;
            let nextAttendance: ShiftAttendance | null | undefined = null;

            // Chegada/saída vivem em `applications`, não em `shift_payments` — busca à parte
            // pelo application_id do marcador (RLS: mesmos participantes do recibo, worker ou
            // empresa dona, então a leitura é permitida para quem já pode ver o recibo).
            const applicationId = data?.payment.application_id;
            if (applicationId && isPresencaEnabled()) {
                const { data: jobData, error: jobErr } = await supabase
                    .from('jobs')
                    .select('presence_mode')
                    .eq('id', jobId)
                    .maybeSingle();
                if (jobErr) {
                    logError('ReceiptView: fetchPresenceMode', jobErr);
                    if (silent) nextPresence = undefined;
                } else if (jobData?.presence_mode === 'qr_gps') {
                    nextPresence = await listPresenceChecks({ applicationId });
                    if (silent && nextPresence === null) nextPresence = undefined;
                }
            }
            if (applicationId) {
                const { data: appData, error: appErr } = await supabase
                    .from('applications')
                    .select('worker_checkin_at, worker_checkout_at, company_checkin_confirmed_at, company_checkout_confirmed_at')
                    .eq('id', applicationId)
                    .maybeSingle();
                if (appErr) {
                    logError('ReceiptView: fetchAttendance', appErr);
                    if (silent) nextAttendance = undefined;
                } else {
                    const checkin = appData?.worker_checkin_at ?? appData?.company_checkin_confirmed_at ?? null;
                    const checkout = appData?.worker_checkout_at ?? appData?.company_checkout_confirmed_at ?? null;
                    nextAttendance = {
                        checkin,
                        checkinSource: appData?.worker_checkin_at ? 'worker' : (appData?.company_checkin_confirmed_at ? 'company' : null),
                        checkout,
                        checkoutSource: appData?.worker_checkout_at ? 'worker' : (appData?.company_checkout_confirmed_at ? 'company' : null),
                    };
                }
            }

            if (!claim()) return;
            setCurrentUserId(user.id);
            setReceipt(data);
            setVoided(nextVoided);
            if (nextPresence !== undefined) setPresence(nextPresence);
            if (nextAttendance !== undefined) setAttendance(nextAttendance);
            setErroCarga(false);
            if (silent) setLiveVersion((v) => v + 1);
        } catch (error) {
            logError('ReceiptView: fetchReceipt', error);
            if (silent || !claim()) return;
            // Falha de rede ≠ "recibo não existe / sem permissão" — colapsar os dois faria o
            // freela achar que o pagamento sumiu (dinheiro é o pior lugar para um falso negativo).
            setErroCarga(true);
        } finally {
            if (!silent) setLoading(false);
        }
    };

    useLiveRefresh({
        sources: jobId ? jobSources(jobId) : [],
        onRefresh: () => fetchReceipt({ silent: true }),
        paused: loading || termBusy || disputing,
    });

    const voltar = () => { if (window.history.length > 1) navigate(-1); else navigate('/recebimentos'); };

    if (loading) {
        return (
            <div className="max-w-2xl mx-auto p-4 md:p-8 animate-pulse space-y-4" role="status"><span className="sr-only">Carregando</span>
                <div className="h-8 w-40 bg-gray-200 rounded-xl" />
                <div className="h-96 bg-gray-200 rounded-2xl" />
            </div>
        );
    }

    if (erroCarga && !receipt) {
        return (
            <div className="max-w-2xl mx-auto p-4 md:p-8">
                <PageMeta title="Erro ao carregar recibo" />
                <ErroDeCarga onRetry={() => { setErroCarga(false); setLoading(true); fetchReceipt(); }} mensagem="O recibo não sumiu — a carga falhou. Tente de novo." />
            </div>
        );
    }

    if (!receipt && voided) {
        return (
            <div className="max-w-2xl mx-auto p-4 md:p-8">
                <PageMeta title="Registro estornado" />
                <Button variant="ghost" onClick={voltar} iconLeft={<ArrowLeft size={16} strokeWidth={3} />} className="mb-6">
                    Voltar
                </Button>
                <Card padding="lg" className="[overflow-wrap:anywhere]">
                    <AlertTriangle size={40} aria-hidden="true" className="mx-auto mb-4 text-yellow-700" />
                    <h1 className="text-lg font-bold mb-2 text-center">Este recibo foi estornado</h1>
                    <p className="text-sm text-gray-700 text-center">
                        {voided.company?.name || 'A empresa'} cancelou o registro de {amountLabel(voided.amount)}
                        {voided.voided_at ? ` em ${format(new Date(voided.voided_at), 'dd/MM/yyyy', { locale: ptBR })}` : ''}.
                        {' '}Se você não concorda, fale com a empresa.
                    </p>
                    {voided.void_reason && (
                        <p className="mt-3 text-sm text-gray-700 text-center">Motivo informado: {voided.void_reason}</p>
                    )}
                    <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-center">
                        <Button variant="secondary" onClick={() => navigate('/messages')}>Falar com a empresa</Button>
                        <Button onClick={() => navigate('/recebimentos')}>Ver recebimentos</Button>
                    </div>
                </Card>
            </div>
        );
    }

    if (!receipt) {
        return (
            <div className="max-w-2xl mx-auto p-4 md:p-8">
                <PageMeta title="Recibo não encontrado" />
                <Button variant="ghost" onClick={voltar} iconLeft={<ArrowLeft size={16} strokeWidth={3} />} className="mb-6">
                    Voltar
                </Button>
                <Card padding="lg" className="text-center">
                    <AlertTriangle size={40} className="mx-auto mb-4 text-gray-400" />
                    <h1 className="text-lg font-bold mb-2">Recibo não encontrado</h1>
                    <p className="text-sm text-gray-600">
                        Não há registro de pagamento visível para este turno, ou você não tem permissão para vê-lo.
                    </p>
                </Card>
            </div>
        );
    }

    const { payment, job, company, worker } = receipt;
    const isWorkerViewer = currentUserId === payment.worker_id;
    const isCompanyViewer = currentUserId === payment.company_id;
    const shortId = payment.id.slice(0, 8).toUpperCase();
    const isScheduled = payment.status === 'scheduled';

    const amountMissing = !(typeof payment.amount === 'number' && payment.amount > 0);
    const needsConfirmation = !isScheduled && isWorkerViewer && !payment.worker_confirmed_at;

    // Abre a conversa do turno com o texto pronto no campo. Quem envia é a pessoa.
    const handleDispute = async () => {
        setDisputing(true);
        try {
            let applicationId = payment.application_id;
            if (!applicationId) {
                const { data, error } = await supabase
                    .from('applications')
                    .select('id')
                    .eq('job_id', payment.job_id)
                    .eq('worker_id', payment.worker_id)
                    .maybeSingle();
                if (error) throw error;
                applicationId = data?.id ?? null;
            }
            if (!applicationId) {
                addToast('Não achamos a conversa deste turno. Procure a empresa em Mensagens.', 'error');
                return;
            }
            const conversationId = await openShiftConversation(applicationId);
            const when = job?.start_date ? ` de ${formatDateOnly(job.start_date, 'dd/MM')}` : '';
            const state: MessagesLocationState = {
                draft: `Olá! Sobre o turno "${job?.title || 'Turno'}"${when}: o recibo ${shortId} registra ${amountLabel(payment.amount)}. Não recebi ou o valor está errado. `,
            };
            navigate(`/messages?conversation=${conversationId}`, { state });
        } catch (error) {
            logError('ReceiptView: handleDispute', error);
            addToast('Não foi possível abrir a conversa. Tente novamente.', 'error');
        } finally {
            setDisputing(false);
        }
    };

    // Uma única instância: no topo quando o freela precisa agir, no corpo do recibo nos demais casos.
    const termSection = !isScheduled && (
        <ServiceTermSection
            shiftPaymentId={payment.id}
            isWorkerViewer={isWorkerViewer}
            isCompanyViewer={isCompanyViewer}
            workerConfirmedAt={payment.worker_confirmed_at ?? null}
            onConfirmed={() => { void fetchReceipt(); }}
            onBusyChange={setTermBusy}
            refreshKey={liveVersion}
            amountMissing={amountMissing}
            onDispute={isWorkerViewer ? () => void handleDispute() : undefined}
            disputing={disputing}
        />
    );

    return (
        <div className="max-w-2xl mx-auto p-4 md:p-8 pb-20 [overflow-wrap:anywhere]">
            <PageMeta title={isScheduled ? 'Comprovante de Agendamento' : 'Recibo de Pagamento'} />

            {/* Barra de ações — não imprime */}
            <div className="flex items-center justify-between gap-3 mb-6 print:hidden">
                <Button variant="ghost" onClick={voltar} iconLeft={<ArrowLeft size={16} strokeWidth={3} />}>
                    Voltar
                </Button>
                <div className="flex items-center gap-2">
                    {/* Aberto direto (link ou recarga), nenhum layout informou o papel. */}
                    {isWorkerViewer ? <GuideRoleFreela /> : <GuideRoleEmpresa />}
                    <HelpButton variante="icone" />
                    <Button
                        variant="secondary"
                        onClick={() => window.print()}
                        aria-label="Imprimir recibo"
                        iconLeft={<Printer size={16} />}
                    >
                        Imprimir
                    </Button>
                </div>
            </div>

            {needsConfirmation && (
                <Card as="section" tone="highlight" padding="md" aria-label="Confirmar recebimento" className="mb-6 print:border-0 print:p-0 print:shadow-none">
                    {/* Não é heading: o h1 da página é o título do recibo, logo abaixo. A seção já
                        tem nome acessível ("Confirmar recebimento"). */}
                    <p className="text-lg font-bold print:hidden">
                        {amountMissing
                            ? 'Pagamento sem valor informado'
                            : `Você recebeu ${amountLabel(payment.amount)} de ${company?.name || 'uma empresa'}?`}
                    </p>
                    <p className="mt-1 mb-4 text-sm text-gray-700 print:hidden">
                        A empresa registrou um pagamento por fora do app. Se recebeu, confirme aqui.
                        Quando há termo do turno, o aceite é feito no mesmo passo.
                    </p>
                    {termSection}
                </Card>
            )}

            {/* Recibo */}
            <Card
                data-copilot-private
                padding="lg"
                className="shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] print:shadow-none print:border-black"
            >
                <div className="text-center border-b-2 border-black pb-6 mb-6">
                    <p className="text-xs font-semibold uppercase tracking-widest text-gray-600 mb-1">Worki</p>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                        {isScheduled ? 'Comprovante de Agendamento' : 'Recibo de Pagamento'}
                    </h1>
                    {/* Nome do freela logo abaixo do título — turno com mais de um freela nunca
                        fica ambíguo sobre de quem é este recibo (ADR-20260816). */}
                    <p className="text-base font-semibold mt-1">{worker?.full_name || 'Freela não identificado'}</p>
                    <p className="text-xs text-gray-600 mt-1">Registro Worki (declaratório)</p>
                </div>

                {isScheduled && payment.scheduled_for && (
                    <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4 mb-6 flex items-center gap-3">
                        <Clock size={20} className="text-yellow-700 flex-shrink-0" />
                        <p className="text-sm font-semibold text-yellow-800">
                            Pagamento agendado para {formatDateOnly(payment.scheduled_for, "dd/MM/yyyy")}
                        </p>
                    </div>
                )}

                <div className="mb-6">
                    <span className="block text-xs font-semibold text-gray-600 mb-1">Empresa</span>
                    <p className="font-semibold text-lg">{company?.name || 'Não informado'}</p>
                </div>

                <div className="bg-gray-50 border-2 border-gray-100 rounded-xl p-4 mb-6">
                    <span className="block text-xs font-semibold text-gray-600 mb-2">Turno</span>
                    <p className="font-semibold">{job?.title || 'Turno'}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 mt-2">
                        {job?.start_date && (
                            <span className="flex items-center gap-1">
                                <Clock size={12} />
                                {formatDateOnly(job.start_date, "dd/MM/yyyy")}
                                {job.work_start_time && ` • ${job.work_start_time}`}
                                {job.work_end_time && ` – ${job.work_end_time}`}
                            </span>
                        )}
                        {job?.location && (
                            <span className="flex items-center gap-1">
                                <LocalDoTurno location={job.location} size={12} />
                            </span>
                        )}
                    </div>

                    {/* Chegada/saída reais — base do acerto no mundo real. Não inventa: turno
                        concluído pelo caminho legado (sem application vinculada) simplesmente
                        omite este bloco em vez de mostrar zero/hora errada. */}
                    {attendance && (attendance.checkin || attendance.checkout) && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 pt-3 border-t border-gray-200">
                            <div>
                                <span className="flex items-center gap-1 text-xs font-semibold text-gray-600 mb-1">
                                    <LogIn size={12} /> Chegada
                                </span>
                                <p className="font-semibold text-sm">
                                    {attendance.checkin
                                        ? format(new Date(attendance.checkin), 'HH:mm', { locale: ptBR })
                                        : 'Não registrado'}
                                </p>
                                {attendance.checkinSource === 'company' && (
                                    <p className="text-xs text-gray-600 mt-0.5">Confirmado pela empresa</p>
                                )}
                            </div>
                            <div>
                                <span className="flex items-center gap-1 text-xs font-semibold text-gray-600 mb-1">
                                    <LogOut size={12} /> Saída
                                </span>
                                <p className="font-semibold text-sm">
                                    {attendance.checkout
                                        ? format(new Date(attendance.checkout), 'HH:mm', { locale: ptBR })
                                        : 'Não registrado'}
                                </p>
                                {attendance.checkoutSource === 'company' && (
                                    <p className="text-xs text-gray-600 mt-0.5">Confirmado pela empresa</p>
                                )}
                            </div>
                            <div>
                                <span className="flex items-center gap-1 text-xs font-semibold text-gray-600 mb-1">
                                    <Clock size={12} /> Total de horas trabalhadas
                                </span>
                                <p className="font-semibold text-sm">
                                    {(() => {
                                        const hours = calculateWorkedHours(attendance.checkin, attendance.checkout);
                                        return hours !== null
                                            ? formatWorkedTime(hours, 'Horário não registrado corretamente')
                                            : 'Não registrado';
                                    })()}
                                </p>
                            </div>
                        </div>
                    )}
                    {presence && (
                        <PresenceBadge checks={presence} departureDone={!!attendance?.checkout} className="mt-3" />
                    )}
                </div>

                {/* Valor em destaque (moldura preta); forma e data são apoio (fundo cinza). */}
                <div className={`grid grid-cols-1 ${isScheduled ? 'md:grid-cols-2' : 'md:grid-cols-3'} gap-4 mb-6`}>
                    <div className="border-2 border-black rounded-xl p-4">
                        <span className="block text-xs font-semibold text-gray-600 mb-1">
                            {isScheduled ? 'Valor previsto' : 'Valor pago'}
                        </span>
                        <p className="font-bold text-2xl tabular-nums [overflow-wrap:anywhere]">{amountLabel(payment.amount)}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4">
                        <span className="block text-xs font-semibold text-gray-600 mb-1">Forma</span>
                        <p className="font-semibold text-lg">{PAYMENT_SOURCE_LABELS[payment.source]}</p>
                    </div>
                    {!isScheduled && payment.paid_at && (
                        <div className="bg-gray-50 rounded-xl p-4">
                            <span className="block text-xs font-semibold text-gray-600 mb-1">Data do pagamento</span>
                            <p className="font-semibold text-lg">{formatDateOnly(payment.paid_at, 'dd/MM/yyyy')}</p>
                        </div>
                    )}
                </div>

                {payment.note && (
                    <div className="mb-6">
                        <span className="block text-xs font-semibold text-gray-600 mb-1">Nota</span>
                        <p className="text-sm text-gray-700 italic">"{payment.note}"</p>
                    </div>
                )}

                {isScheduled && (
                    <div className="border-t-2 border-black pt-6 mb-6">
                        <p className="text-sm text-gray-600 bg-gray-100 px-4 py-3 rounded-xl">
                            Pagamento ainda não realizado — é uma promessa da empresa. A confirmação de
                            recebimento fica disponível quando o pagamento for efetivado.
                        </p>
                    </div>
                )}

                {/* Termo de prestação de serviço (F6) + confirmação de recebimento — mesmo
                    componente (R8/A2/A3: confirmar exige aceitar o termo antes, então os dois
                    fluxos precisam compartilhar estado). Só existe para pagamento efetivado
                    ('recorded'); o trigger de geração não dispara em 'scheduled' (A8), e a
                    confirmação de recebimento também não faz sentido para uma promessa ainda
                    não paga. */}
                {!needsConfirmation && termSection}

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600 border-t-2 border-black pt-4">
                    <span>Registro Nº {shortId}</span>
                    <span>Emitido em {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
                </div>

                <div className="mt-6 bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4">
                    <p className="text-xs text-yellow-800">
                        {isScheduled
                            ? 'Este comprovante é o respaldo de que a empresa se comprometeu a pagar na data prevista — não é garantia de pagamento nem documento fiscal.'
                            : 'O Worki registra a declaração de pagamento entre as partes; o dinheiro não passou pela plataforma. Não é documento fiscal.'}
                    </p>
                </div>
            </Card>
        </div>
    );
}
