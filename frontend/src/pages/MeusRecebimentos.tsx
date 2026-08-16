import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
    Receipt,
    Clock,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    Building2,
    MapPin,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PaymentRecordService } from '../services/paymentRecordService';
import type { WorkerShiftPaymentListItem } from '../services/paymentRecordService';
import { logError } from '../lib/logger';
import PageMeta from '../components/PageMeta';
import type { PaymentSource } from '../types';

const PAYMENT_SOURCE_LABELS: Record<PaymentSource, string> = {
    external_pix: 'PIX',
    cash: 'Dinheiro',
    other: 'Outro',
};

/**
 * Formata uma data "date-only" (`scheduled_for`, ou `paid_at`/`created_at` quando
 * gravado a partir de um valor date-only) como data LOCAL, sem shift de fuso.
 *
 * `new Date("YYYY-MM-DD")` é interpretado pelo JS como meia-noite UTC; formatar direto
 * em fuso local (BRT, UTC-3) recua a data em 1 dia. Mesmo padrão de `ReceiptView.tsx`.
 * Aqui o valor pode vir como timestamp completo (`paid_at`) OU date-only
 * (`scheduled_for`) — em ambos os casos só a parte `YYYY-MM-DD` importa para exibição.
 */
function formatDateOnly(isoOrDateOnly: string, pattern: string): string {
    const dateStr = isoOrDateOnly.split('T')[0];
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return format(date, pattern, { locale: ptBR });
}

function formatCurrency(amount: number): string {
    return `R$ ${amount.toFixed(2).replace('.', ',')}`;
}

// ---------------------------------------------------------------------------
// Subcomponent: card de um recebimento
// ---------------------------------------------------------------------------

interface PaymentCardProps {
    item: WorkerShiftPaymentListItem;
    onOpen: (jobId: string) => void;
}

function PaymentCard({ item, onOpen }: PaymentCardProps) {
    const { payment, job, company } = item;
    const companyName = company?.name ?? 'Empresa';
    const jobTitle = job?.title ?? 'Turno';

    const needsConfirmation = payment.status === 'recorded' && !payment.worker_confirmed_at;
    const isVoided = payment.status === 'voided';
    const isScheduled = payment.status === 'scheduled';

    // Cartão cancelado ('voided') não navega: o recibo (`/recibo/:jobId`) resolve pelo
    // marcador ATIVO do turno (scheduled|recorded), não pelo id deste registro estornado.
    // Se a empresa reestornou e registrou de novo, clicar aqui abriria o recibo do OUTRO
    // marcador (valor diferente do card clicado) — ou "não encontrado" se não houver
    // marcador ativo. Card cancelado é só histórico: mostra o que aconteceu, sem link.
    const handleOpen = () => {
        if (isVoided) return;
        if (job?.id) onOpen(job.id);
    };

    let borderShadowClass = 'hover:shadow-[6px_6px_0px_0px_rgba(0,166,81,1)]';
    if (needsConfirmation) borderShadowClass = 'shadow-[4px_4px_0px_0px_rgba(0,166,81,1)]';
    if (isVoided) borderShadowClass = '';

    return (
        <div
            role={isVoided ? undefined : 'button'}
            tabIndex={isVoided ? undefined : 0}
            onClick={isVoided ? undefined : handleOpen}
            onKeyDown={isVoided ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen(); } }}
            className={`bg-white border-2 rounded-2xl p-5 flex items-start gap-4 transition-all ${isVoided ? 'border-gray-200 opacity-70 cursor-default' : 'border-black cursor-pointer hover:-translate-y-1'} ${borderShadowClass}`}
        >
            <div className="w-12 h-12 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
                {company?.logo_url ? (
                    <img src={company.logo_url} alt={companyName} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-black text-white">
                        <Building2 size={20} />
                    </div>
                )}
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="font-black uppercase text-sm truncate">{jobTitle}</p>
                        <p className="text-xs font-bold text-gray-500 truncate">{companyName}</p>
                    </div>
                    <p className={`font-black text-lg tabular-nums flex-shrink-0 ${isVoided ? 'text-gray-400 line-through' : 'text-accent'}`}>
                        {formatCurrency(payment.amount)}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-2">
                    {isScheduled && (
                        <span className="flex items-center gap-1 text-xs font-black uppercase bg-yellow-50 text-yellow-700 px-2 py-1 rounded-xl border border-yellow-200">
                            <Clock size={12} />
                            Promessa · {payment.scheduled_for ? formatDateOnly(payment.scheduled_for, 'dd/MM/yyyy') : '—'}
                        </span>
                    )}
                    {needsConfirmation && (
                        <span className="flex items-center gap-1 text-xs font-black uppercase bg-primary-light text-primary px-2 py-1 rounded-xl border border-green-200">
                            <AlertTriangle size={12} />
                            Confirme o recebimento
                        </span>
                    )}
                    {payment.status === 'recorded' && payment.worker_confirmed_at && (
                        <span className="flex items-center gap-1 text-xs font-black uppercase bg-primary-light text-primary px-2 py-1 rounded-xl border border-green-200">
                            <CheckCircle2 size={12} />
                            Recebido{payment.paid_at ? ` · ${formatDateOnly(payment.paid_at, 'dd/MM/yyyy')}` : ''}
                        </span>
                    )}
                    {isVoided && (
                        <span className="flex items-center gap-1 text-xs font-black uppercase bg-gray-100 text-gray-500 px-2 py-1 rounded-xl">
                            <XCircle size={12} />
                            Cancelado
                        </span>
                    )}
                    {isVoided && payment.void_reason && (
                        <span className="text-xs font-bold text-gray-400 italic">
                            Motivo: {payment.void_reason}
                        </span>
                    )}
                    <span className="text-xs font-bold text-gray-400 uppercase">
                        {PAYMENT_SOURCE_LABELS[payment.source]}
                    </span>
                    {job?.location && (
                        <span className="flex items-center gap-1 text-xs font-bold text-gray-400">
                            <MapPin size={11} /> {job.location}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Página principal: MeusRecebimentos
// ---------------------------------------------------------------------------

export default function MeusRecebimentos() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState<WorkerShiftPaymentListItem[]>([]);

    useEffect(() => {
        let active = true;

        const fetchPayments = async () => {
            setLoading(true);
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) { navigate('/login'); return; }

                const data = await PaymentRecordService.listForWorker(user.id);
                if (active) setItems(data);
            } catch (error) {
                logError('MeusRecebimentos: fetchPayments', error);
            } finally {
                if (active) setLoading(false);
            }
        };

        fetchPayments();
        return () => { active = false; };
    }, [navigate]);

    const handleOpen = (jobId: string) => navigate(`/recibo/${jobId}`);

    const scheduled = items.filter((i) => i.payment.status === 'scheduled');
    const pendingConfirmation = items.filter((i) => i.payment.status === 'recorded' && !i.payment.worker_confirmed_at);
    const confirmed = items.filter((i) => i.payment.status === 'recorded' && !!i.payment.worker_confirmed_at);
    const voided = items.filter((i) => i.payment.status === 'voided');

    const totalRecorded = items
        .filter((i) => i.payment.status === 'recorded')
        .reduce((sum, i) => sum + i.payment.amount, 0);
    const totalScheduled = scheduled.reduce((sum, i) => sum + i.payment.amount, 0);

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto pb-24 space-y-6 animate-pulse">
                <div className="h-10 bg-gray-200 rounded-xl w-64" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[...Array(3)].map((_, i) => (
                        <div key={i} className="h-24 bg-gray-200 rounded-2xl" />
                    ))}
                </div>
                <div className="space-y-4">
                    {[...Array(3)].map((_, i) => (
                        <div key={i} className="h-24 bg-gray-200 rounded-2xl" />
                    ))}
                </div>
            </div>
        );
    }

    const isEmpty = items.length === 0;

    return (
        <div className="max-w-4xl mx-auto pb-24 font-sans text-accent animate-in fade-in slide-in-from-bottom-4 duration-400">
            <PageMeta
                title="Meus Recebimentos"
                description="Acompanhe os pagamentos registrados pelas empresas: recebidos, agendados e aguardando sua confirmação."
            />

            {/* Header */}
            <header className="mb-8">
                <h1 className="text-4xl font-black uppercase tracking-tighter">Meus Recebimentos</h1>
                <p className="text-gray-500 font-bold mt-1">
                    Histórico dos pagamentos que as empresas registraram por fora do app.
                </p>
            </header>

            {/* Resumo — NÃO é saldo: é histórico declarado pelas empresas */}
            {!isEmpty && (
                <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                    <div className="bg-white border-2 border-black rounded-2xl p-5">
                        <span className="block text-xs font-black uppercase text-gray-400 mb-1">Total recebido</span>
                        <p className="font-black text-2xl tabular-nums text-primary">{formatCurrency(totalRecorded)}</p>
                    </div>
                    <div className="bg-white border-2 border-black rounded-2xl p-5">
                        <span className="block text-xs font-black uppercase text-gray-400 mb-1">Agendado (promessa)</span>
                        <p className="font-black text-2xl tabular-nums">{formatCurrency(totalScheduled)}</p>
                    </div>
                    <div className={`bg-white border-2 rounded-2xl p-5 ${pendingConfirmation.length > 0 ? 'border-black shadow-[4px_4px_0px_0px_rgba(0,166,81,1)]' : 'border-black'}`}>
                        <span className="block text-xs font-black uppercase text-gray-400 mb-1">Aguardam confirmação</span>
                        <p className="font-black text-2xl tabular-nums">{pendingConfirmation.length}</p>
                    </div>
                </section>
            )}

            {/* Aguardando confirmação — destaque, exige ação do freela */}
            {pendingConfirmation.length > 0 && (
                <section className="mb-8">
                    <h2 className="text-xl font-black uppercase mb-4 flex items-center gap-2 text-primary">
                        <AlertTriangle size={20} /> Confirme o recebimento
                    </h2>
                    <div className="grid grid-cols-1 gap-4">
                        {pendingConfirmation.map((item) => (
                            <PaymentCard key={item.payment.id} item={item} onOpen={handleOpen} />
                        ))}
                    </div>
                </section>
            )}

            {/* Agendados — promessa de pagamento, ainda não é dinheiro recebido */}
            {scheduled.length > 0 && (
                <section className="mb-8">
                    <h2 className="text-xl font-black uppercase mb-4 flex items-center gap-2 text-yellow-700">
                        <Clock size={20} /> Agendados
                    </h2>
                    <div className="grid grid-cols-1 gap-4">
                        {scheduled.map((item) => (
                            <PaymentCard key={item.payment.id} item={item} onOpen={handleOpen} />
                        ))}
                    </div>
                </section>
            )}

            {/* Recebidos e confirmados */}
            {confirmed.length > 0 && (
                <section className="mb-8">
                    <h2 className="text-xl font-black uppercase mb-4 flex items-center gap-2">
                        <CheckCircle2 size={20} /> Recebidos
                    </h2>
                    <div className="grid grid-cols-1 gap-4">
                        {confirmed.map((item) => (
                            <PaymentCard key={item.payment.id} item={item} onOpen={handleOpen} />
                        ))}
                    </div>
                </section>
            )}

            {/* Cancelados — discreto, no rodapé */}
            {voided.length > 0 && (
                <section className="mb-8">
                    <h2 className="text-sm font-black uppercase mb-4 flex items-center gap-2 text-gray-400">
                        <XCircle size={16} /> Cancelados
                    </h2>
                    <div className="grid grid-cols-1 gap-3">
                        {voided.map((item) => (
                            <PaymentCard key={item.payment.id} item={item} onOpen={handleOpen} />
                        ))}
                    </div>
                </section>
            )}

            {/* Empty state */}
            {isEmpty && (
                <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50">
                    <Receipt size={48} className="mx-auto mb-4 text-gray-300" />
                    <h3 className="text-xl font-black uppercase mb-2">Nenhum recebimento ainda</h3>
                    <p className="text-gray-500 font-bold max-w-sm mx-auto">
                        Quando uma empresa registrar um pagamento pelo seu turno, ele aparece aqui —
                        com o comprovante e a confirmação de recebimento.
                    </p>
                </div>
            )}
        </div>
    );
}
