import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '../lib/supabase';
import { PaymentRecordService } from '../services/paymentRecordService';
import { logError } from '../lib/logger';
import { formatDateOnly } from '../lib/dateUtils';
import PageMeta from '../components/PageMeta';
import ServiceTermSection from '../components/ServiceTermSection';
import { ArrowLeft, Printer, Clock, MapPin, AlertTriangle, LogIn, LogOut } from 'lucide-react';
import type { ShiftPaymentReceipt } from '../services/paymentRecordService';
import type { PaymentSource } from '../types';

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
interface ShiftAttendance {
    checkin: string | null;
    checkinSource: AttendanceSource | null;
    checkout: string | null;
    checkoutSource: AttendanceSource | null;
}

/**
 * Total de horas trabalhadas entre chegada e saída REGISTRADAS (timestamps completos, com
 * data — não só hora-do-dia). Turno que cruza a meia-noite (ex.: 18h10 às 01h00) é resolvido
 * automaticamente pela subtração de datas absolutas: como cada timestamp já carrega sua
 * própria data, checkout "no dia seguinte" não precisa do hack "+24h" usado em `calculateHours`
 * (CompanyCreateJob.tsx), que só é necessário para strings de hora soltas sem data.
 *
 * Retorna `null` se checkin/checkout ausentes ou se checkout <= checkin (dado inconsistente —
 * melhor omitir a linha do recibo do que exibir um total errado/negativo).
 */
function calculateWorkedHours(
    checkinIso: string | null | undefined,
    checkoutIso: string | null | undefined,
): number | null {
    if (!checkinIso || !checkoutIso) return null;
    const checkin = new Date(checkinIso).getTime();
    const checkout = new Date(checkoutIso).getTime();
    if (!Number.isFinite(checkin) || !Number.isFinite(checkout) || checkout <= checkin) return null;
    return (checkout - checkin) / (1000 * 60 * 60);
}

/** Formata horas decimais como "7h30", "8h" ou "45min" (pt-BR, sem casas decimais soltas). */
function formatWorkedHours(hours: number): string {
    const totalMinutes = Math.round(hours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h === 0) return `${m}min`;
    if (m === 0) return `${h}h`;
    return `${h}h${String(m).padStart(2, '0')}`;
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
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    // Chegada/saída reais do turno — trazidas do recibo pra ser um documento de conferência,
    // não só de valor. Caminho legado sem application vinculada = sem attendance (não inventa).
    const [attendance, setAttendance] = useState<ShiftAttendance | null>(null);

    useEffect(() => {
        if (jobId) fetchReceipt();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- so precisa re-executar quando jobId/worker mudam
    }, [jobId, workerIdParam]);

    const fetchReceipt = async () => {
        // G3: guarda de id falsy — evita `shift_payments?job_id=eq.null` mesmo se essa função
        // for chamada de outro lugar além do useEffect que já checa `if (jobId)`.
        if (!jobId) { setLoading(false); return; }
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { navigate('/login'); return; }
            setCurrentUserId(user.id);

            const data = await PaymentRecordService.getReceipt(jobId, workerIdParam ?? undefined);
            setReceipt(data);

            // Chegada/saída vivem em `applications`, não em `shift_payments` — busca à parte
            // pelo application_id do marcador (RLS: mesmos participantes do recibo, worker ou
            // empresa dona, então a leitura é permitida para quem já pode ver o recibo).
            const applicationId = data?.payment.application_id;
            if (applicationId) {
                const { data: appData, error: appErr } = await supabase
                    .from('applications')
                    .select('worker_checkin_at, worker_checkout_at, company_checkin_confirmed_at, company_checkout_confirmed_at')
                    .eq('id', applicationId)
                    .maybeSingle();
                if (appErr) {
                    logError('ReceiptView: fetchAttendance', appErr);
                    setAttendance(null);
                } else {
                    const checkin = appData?.worker_checkin_at ?? appData?.company_checkin_confirmed_at ?? null;
                    const checkout = appData?.worker_checkout_at ?? appData?.company_checkout_confirmed_at ?? null;
                    setAttendance({
                        checkin,
                        checkinSource: appData?.worker_checkin_at ? 'worker' : (appData?.company_checkin_confirmed_at ? 'company' : null),
                        checkout,
                        checkoutSource: appData?.worker_checkout_at ? 'worker' : (appData?.company_checkout_confirmed_at ? 'company' : null),
                    });
                }
            } else {
                setAttendance(null);
            }
        } catch (error) {
            logError('ReceiptView: fetchReceipt', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="max-w-2xl mx-auto p-4 md:p-8 animate-pulse space-y-4">
                <div className="h-8 w-40 bg-gray-200 rounded-xl" />
                <div className="h-96 bg-gray-200 rounded-2xl" />
            </div>
        );
    }

    if (!receipt) {
        return (
            <div className="max-w-2xl mx-auto p-4 md:p-8">
                <PageMeta title="Recibo não encontrado" />
                <button
                    onClick={() => navigate(-1)}
                    className="flex items-center gap-2 text-gray-400 font-bold hover:text-black transition-colors mb-6"
                >
                    <ArrowLeft size={16} strokeWidth={3} /> Voltar
                </button>
                <div className="bg-white border-2 border-black rounded-2xl p-8 text-center">
                    <AlertTriangle size={40} className="mx-auto mb-4 text-gray-400" />
                    <h1 className="text-xl font-black uppercase mb-2">Recibo não encontrado</h1>
                    <p className="text-gray-500 font-medium">
                        Não há registro de pagamento visível para este turno, ou você não tem permissão para vê-lo.
                    </p>
                </div>
            </div>
        );
    }

    const { payment, job, company, worker } = receipt;
    const isWorkerViewer = currentUserId === payment.worker_id;
    const isCompanyViewer = currentUserId === payment.company_id;
    const shortId = payment.id.slice(0, 8).toUpperCase();
    const isScheduled = payment.status === 'scheduled';

    return (
        <div className="max-w-2xl mx-auto p-4 md:p-8 pb-20">
            <PageMeta title={isScheduled ? 'Comprovante de Agendamento' : 'Recibo de Pagamento'} />

            {/* Barra de ações — não imprime */}
            <div className="flex items-center justify-between mb-6 print:hidden">
                <button
                    onClick={() => navigate(-1)}
                    className="flex items-center gap-2 text-gray-400 font-bold hover:text-black transition-colors"
                >
                    <ArrowLeft size={16} strokeWidth={3} /> Voltar
                </button>
                <button
                    onClick={() => window.print()}
                    aria-label="Imprimir recibo"
                    className="flex items-center gap-2 px-4 py-2 bg-black hover:bg-primary text-white rounded-xl font-black uppercase text-sm transition-colors"
                >
                    <Printer size={16} /> Imprimir
                </button>
            </div>

            {/* Recibo */}
            <div className="bg-white border-2 border-black rounded-2xl p-6 md:p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] print:shadow-none print:border-black">
                <div className="text-center border-b-2 border-black pb-6 mb-6">
                    <p className="text-xs font-black uppercase tracking-widest text-gray-500 mb-1">Worki</p>
                    <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tight">
                        {isScheduled ? 'Comprovante de Agendamento' : 'Recibo de Pagamento'}
                    </h1>
                    {/* Nome do freela logo abaixo do título — turno com mais de um freela nunca
                        fica ambíguo sobre de quem é este recibo (ADR-20260816). */}
                    <p className="text-sm font-black mt-1">{worker?.full_name || 'Freela não identificado'}</p>
                    <p className="text-xs font-bold text-gray-400 uppercase mt-1">Registro Worki (declaratório)</p>
                </div>

                {isScheduled && payment.scheduled_for && (
                    <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4 mb-6 flex items-center gap-3">
                        <Clock size={20} className="text-yellow-700 flex-shrink-0" />
                        <p className="font-bold text-yellow-800">
                            Pagamento agendado para {formatDateOnly(payment.scheduled_for, "dd/MM/yyyy")}
                        </p>
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <div>
                        <span className="block text-xs font-black uppercase text-gray-400 mb-1">Empresa</span>
                        <p className="font-bold text-lg">{company?.name || 'Não informado'}</p>
                    </div>
                    <div>
                        <span className="block text-xs font-black uppercase text-gray-400 mb-1">Freela</span>
                        <p className="font-bold text-lg">{worker?.full_name || 'Não informado'}</p>
                    </div>
                </div>

                <div className="bg-gray-50 border-2 border-gray-100 rounded-xl p-4 mb-6">
                    <span className="block text-xs font-black uppercase text-gray-400 mb-2">Turno</span>
                    <p className="font-bold">{job?.title || 'Turno'}</p>
                    <div className="flex flex-wrap items-center gap-4 text-xs font-bold text-gray-500 mt-2">
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
                                <MapPin size={12} /> {job.location}
                            </span>
                        )}
                    </div>

                    {/* Chegada/saída reais — base do acerto no mundo real. Não inventa: turno
                        concluído pelo caminho legado (sem application vinculada) simplesmente
                        omite este bloco em vez de mostrar zero/hora errada. */}
                    {attendance && (attendance.checkin || attendance.checkout) && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 pt-3 border-t border-gray-200">
                            <div>
                                <span className="flex items-center gap-1 text-[10px] font-black uppercase text-gray-400 mb-1">
                                    <LogIn size={12} /> Chegada
                                </span>
                                <p className="font-bold text-sm">
                                    {attendance.checkin
                                        ? format(new Date(attendance.checkin), 'HH:mm', { locale: ptBR })
                                        : 'Não registrado'}
                                </p>
                                {attendance.checkinSource === 'company' && (
                                    <p className="text-[10px] font-bold text-gray-400 mt-0.5">Confirmado pela empresa</p>
                                )}
                            </div>
                            <div>
                                <span className="flex items-center gap-1 text-[10px] font-black uppercase text-gray-400 mb-1">
                                    <LogOut size={12} /> Saída
                                </span>
                                <p className="font-bold text-sm">
                                    {attendance.checkout
                                        ? format(new Date(attendance.checkout), 'HH:mm', { locale: ptBR })
                                        : 'Não registrado'}
                                </p>
                                {attendance.checkoutSource === 'company' && (
                                    <p className="text-[10px] font-bold text-gray-400 mt-0.5">Confirmado pela empresa</p>
                                )}
                            </div>
                            <div>
                                <span className="flex items-center gap-1 text-[10px] font-black uppercase text-gray-400 mb-1">
                                    <Clock size={12} /> Total de horas trabalhadas
                                </span>
                                <p className="font-bold text-sm">
                                    {(() => {
                                        const hours = calculateWorkedHours(attendance.checkin, attendance.checkout);
                                        return hours !== null ? formatWorkedHours(hours) : 'Não registrado';
                                    })()}
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                <div className={`grid grid-cols-1 ${isScheduled ? 'md:grid-cols-2' : 'md:grid-cols-3'} gap-4 mb-6`}>
                    <div className="border-2 border-black rounded-xl p-4">
                        <span className="block text-xs font-black uppercase text-gray-400 mb-1">
                            {isScheduled ? 'Valor previsto' : 'Valor pago'}
                        </span>
                        <p className="font-black text-2xl tabular-nums">R$ {payment.amount.toFixed(2).replace('.', ',')}</p>
                    </div>
                    <div className="border-2 border-black rounded-xl p-4">
                        <span className="block text-xs font-black uppercase text-gray-400 mb-1">Forma</span>
                        <p className="font-bold text-lg">{PAYMENT_SOURCE_LABELS[payment.source]}</p>
                    </div>
                    {!isScheduled && payment.paid_at && (
                        <div className="border-2 border-black rounded-xl p-4">
                            <span className="block text-xs font-black uppercase text-gray-400 mb-1">Data do pagamento</span>
                            <p className="font-bold text-lg">{formatDateOnly(payment.paid_at, 'dd/MM/yyyy')}</p>
                        </div>
                    )}
                </div>

                {payment.note && (
                    <div className="mb-6">
                        <span className="block text-xs font-black uppercase text-gray-400 mb-1">Nota</span>
                        <p className="font-medium text-gray-600 italic">"{payment.note}"</p>
                    </div>
                )}

                {isScheduled && (
                    <div className="border-t-2 border-black pt-6 mb-6">
                        <p className="text-sm font-bold text-gray-500 bg-gray-100 px-4 py-3 rounded-xl w-fit">
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
                {!isScheduled && (
                    <ServiceTermSection
                        shiftPaymentId={payment.id}
                        isWorkerViewer={isWorkerViewer}
                        isCompanyViewer={isCompanyViewer}
                        workerConfirmedAt={payment.worker_confirmed_at ?? null}
                        onConfirmed={fetchReceipt}
                    />
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-gray-400 border-t-2 border-black pt-4">
                    <span>Registro Nº {shortId}</span>
                    <span>Emitido em {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
                </div>

                <div className="mt-6 bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4">
                    <p className="text-xs font-bold text-yellow-800">
                        {isScheduled
                            ? 'Este comprovante é o respaldo de que a empresa se comprometeu a pagar na data prevista — não é garantia de pagamento nem documento fiscal.'
                            : 'O Worki registra a declaração de pagamento entre as partes; o dinheiro não passou pela plataforma. Não é documento fiscal.'}
                    </p>
                </div>
            </div>
        </div>
    );
}
