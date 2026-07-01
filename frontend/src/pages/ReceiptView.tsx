import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '../lib/supabase';
import { PaymentRecordService } from '../services/paymentRecordService';
import { logError } from '../lib/logger';
import { useToast } from '../contexts/ToastContext';
import PageMeta from '../components/PageMeta';
import { ArrowLeft, Printer, CheckCircle, Clock, MapPin, AlertTriangle, Loader2 } from 'lucide-react';
import type { ShiftPaymentReceipt } from '../services/paymentRecordService';
import type { PaymentSource } from '../types';

const PAYMENT_SOURCE_LABELS: Record<PaymentSource, string> = {
    external_pix: 'PIX',
    cash: 'Dinheiro',
    other: 'Outro',
};

export default function ReceiptView() {
    const { jobId } = useParams<{ jobId: string }>();
    const navigate = useNavigate();
    const { addToast } = useToast();

    const [loading, setLoading] = useState(true);
    const [receipt, setReceipt] = useState<ShiftPaymentReceipt | null>(null);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);

    useEffect(() => {
        if (jobId) fetchReceipt();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- so precisa re-executar quando jobId muda
    }, [jobId]);

    const fetchReceipt = async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { navigate('/login'); return; }
            setCurrentUserId(user.id);

            const data = await PaymentRecordService.getReceipt(jobId as string);
            setReceipt(data);
        } catch (error) {
            logError('ReceiptView: fetchReceipt', error);
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmReceipt = async () => {
        if (!receipt) return;
        setConfirming(true);
        try {
            const result = await PaymentRecordService.confirmReceiptByWorker(receipt.payment.id);
            if (!result.success) {
                addToast(result.error || 'Não foi possível confirmar o recebimento.', 'error');
                return;
            }
            addToast('Recebimento confirmado!', 'success');
            fetchReceipt();
        } catch (error) {
            logError('ReceiptView: handleConfirmReceipt', error);
            addToast('Erro ao confirmar recebimento.', 'error');
        } finally {
            setConfirming(false);
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

    return (
        <div className="max-w-2xl mx-auto p-4 md:p-8 pb-20">
            <PageMeta title="Recibo de Pagamento" />

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
                    <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tight">Recibo de Pagamento</h1>
                    <p className="text-xs font-bold text-gray-400 uppercase mt-1">Registro Worki (declaratório)</p>
                </div>

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
                                {format(new Date(job.start_date), "dd/MM/yyyy", { locale: ptBR })}
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
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="border-2 border-black rounded-xl p-4">
                        <span className="block text-xs font-black uppercase text-gray-400 mb-1">Valor pago</span>
                        <p className="font-black text-2xl tabular-nums">R$ {payment.amount.toFixed(2).replace('.', ',')}</p>
                    </div>
                    <div className="border-2 border-black rounded-xl p-4">
                        <span className="block text-xs font-black uppercase text-gray-400 mb-1">Forma</span>
                        <p className="font-bold text-lg">{PAYMENT_SOURCE_LABELS[payment.source]}</p>
                    </div>
                    <div className="border-2 border-black rounded-xl p-4">
                        <span className="block text-xs font-black uppercase text-gray-400 mb-1">Data do pagamento</span>
                        <p className="font-bold text-lg">{format(new Date(payment.paid_at), 'dd/MM/yyyy', { locale: ptBR })}</p>
                    </div>
                </div>

                {payment.note && (
                    <div className="mb-6">
                        <span className="block text-xs font-black uppercase text-gray-400 mb-1">Nota</span>
                        <p className="font-medium text-gray-600 italic">"{payment.note}"</p>
                    </div>
                )}

                {/* Confirmação bilateral do freela — não bloqueia ciclo/avaliação */}
                <div className="border-t-2 border-black pt-6 mb-6">
                    <span className="block text-xs font-black uppercase text-gray-400 mb-3">Confirmação de recebimento</span>
                    {payment.worker_confirmed_at ? (
                        <div className="flex items-center gap-2 bg-primary-light text-primary font-bold px-4 py-3 rounded-xl border-2 border-black w-fit">
                            <CheckCircle size={18} />
                            Recebimento confirmado em {format(new Date(payment.worker_confirmed_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                        </div>
                    ) : isWorkerViewer ? (
                        <button
                            onClick={handleConfirmReceipt}
                            disabled={confirming}
                            className="print:hidden bg-primary hover:bg-black text-white px-6 py-3 rounded-xl font-black uppercase transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                            {confirming ? <><Loader2 size={16} className="animate-spin" /> Confirmando...</> : 'Confirmar Recebimento'}
                        </button>
                    ) : isCompanyViewer ? (
                        <p className="text-sm font-bold text-gray-500 bg-gray-100 px-4 py-3 rounded-xl w-fit">
                            Aguardando confirmação do freela
                        </p>
                    ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-gray-400 border-t-2 border-black pt-4">
                    <span>Registro Nº {shortId}</span>
                    <span>Emitido em {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
                </div>

                <div className="mt-6 bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4">
                    <p className="text-xs font-bold text-yellow-800">
                        O Worki registra a declaração de pagamento entre as partes; o dinheiro não passou pela
                        plataforma. Não é documento fiscal.
                    </p>
                </div>
            </div>
        </div>
    );
}
