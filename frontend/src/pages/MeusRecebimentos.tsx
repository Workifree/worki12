import { useEffect, useState } from 'react';
import LocalDoTurno from '../components/LocalDoTurno';
import { useNavigate } from 'react-router-dom';
import {
    Receipt,
    Clock,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    Building2,
} from 'lucide-react';
import { checkSession } from '../lib/authSession';
import { PaymentRecordService } from '../services/paymentRecordService';
import type { WorkerShiftPaymentListItem } from '../services/paymentRecordService';
import { logError } from '../lib/logger';
import { formatBRL } from '../lib/currency';
import ErroDeCarga from '../components/ErroDeCarga';
import PageMeta from '../components/PageMeta';
import type { PaymentSource } from '../types';
import { formatDateOnly } from '../lib/dateUtils';
import { Button, Card, PageHeader } from '../components/ui';

const PAYMENT_SOURCE_LABELS: Record<PaymentSource, string> = {
    external_pix: 'PIX',
    cash: 'Dinheiro',
    other: 'Outro',
};

/** Valor ausente nunca vira "R$ 0,00". */
function formatCurrency(amount: number | null): string {
    return typeof amount === 'number' && amount > 0 ? formatBRL(amount) : 'Valor não informado';
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
    const amountMissing = !(Number(payment.amount) > 0);

    // Cartão cancelado ('voided') não navega: o recibo (`/recibo/:jobId`) resolve pelo
    // marcador ATIVO do turno (scheduled|recorded), não pelo id deste registro estornado.
    // Se a empresa reestornou e registrou de novo, clicar aqui abriria o recibo do OUTRO
    // marcador (valor diferente do card clicado) — ou "não encontrado" se não houver
    // marcador ativo. Card cancelado é só histórico: mostra o que aconteceu, sem link.
    const handleOpen = () => {
        if (isVoided) return;
        if (job?.id) onOpen(job.id);
    };

    return (
        <Card
            padding="sm"
            tone={isVoided ? 'nested' : needsConfirmation ? 'highlight' : 'default'}
            onActivate={isVoided ? undefined : handleOpen}
            className={`flex items-start gap-3 ${isVoided ? 'opacity-70' : ''}`}
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
                <div className="flex flex-wrap items-start justify-between gap-x-3">
                    <div className="min-w-0">
                        <p className="font-bold text-sm sm:text-base line-clamp-2 [overflow-wrap:anywhere]">{jobTitle}</p>
                        <p className="text-xs text-gray-600 [overflow-wrap:anywhere]">
                            {companyName}
                            {job?.start_date ? ` · turno de ${formatDateOnly(job.start_date, 'dd/MM')}` : ''}
                        </p>
                    </div>
                    <p className={`font-bold text-lg tabular-nums ${isVoided ? 'text-gray-600 line-through' : 'text-black'}`}>
                        {formatCurrency(payment.amount)}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-3">
                    {isScheduled && (
                        <span className="flex items-center gap-1 text-xs font-semibold bg-yellow-50 text-yellow-700 px-2.5 py-1 rounded-pill border border-yellow-200">
                            <Clock size={12} />
                            Previsto (promessa) · {payment.scheduled_for ? formatDateOnly(payment.scheduled_for, 'dd/MM/yyyy') : '—'}
                        </span>
                    )}
                    {needsConfirmation && (
                        <span className="flex items-center gap-1 text-xs font-semibold bg-primary-light text-primary-dark px-2.5 py-1 rounded-pill border border-green-200">
                            <AlertTriangle size={12} />
                            {amountMissing ? 'Valor não informado' : 'Confirme o recebimento'}
                        </span>
                    )}
                    {payment.status === 'recorded' && payment.worker_confirmed_at && (
                        <span className="flex items-center gap-1 text-xs font-semibold bg-primary-light text-primary-dark px-2.5 py-1 rounded-pill border border-green-200">
                            <CheckCircle2 size={12} />
                            Recebido{payment.paid_at ? ` · ${formatDateOnly(payment.paid_at, 'dd/MM/yyyy')}` : ''}
                        </span>
                    )}
                    {isVoided && (
                        <span className="flex items-center gap-1 text-xs font-semibold bg-gray-100 text-gray-600 px-2.5 py-1 rounded-pill">
                            <XCircle size={12} />
                            Cancelado
                        </span>
                    )}
                    {isVoided && payment.void_reason && (
                        <span className="text-xs text-gray-500 italic">
                            Motivo: {payment.void_reason}
                        </span>
                    )}
                    <span className="text-xs text-gray-600">
                        {PAYMENT_SOURCE_LABELS[payment.source]}
                    </span>
                    {job?.location && (
                        <span className="flex items-center gap-1 text-xs text-gray-600">
                            <LocalDoTurno location={job.location} size={11} />
                        </span>
                    )}
                </div>
                {needsConfirmation && (
                    <Button
                        variant="secondary"
                        fullWidth
                        className="mt-3"
                        data-copilot="freela.recebimentos.confirmar"
                        onClick={handleOpen}
                    >
                        {amountMissing ? 'Ver recibo' : 'Confirmar recebimento'}
                    </Button>
                )}
            </div>
        </Card>
    );
}

// ---------------------------------------------------------------------------
// Página principal: MeusRecebimentos
// ---------------------------------------------------------------------------

export default function MeusRecebimentos() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState<WorkerShiftPaymentListItem[]>([]);
    const [erroCarga, setErroCarga] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let active = true;

        const fetchPayments = async () => {
            setLoading(true);
            try {
                const session = await checkSession();
                if (!active) return;
                if (session.status === 'signed_out') { navigate('/login'); return; }
                if (session.status === 'unavailable') throw session.error;

                const data = await PaymentRecordService.listForWorkerChecked(session.user.id);
                if (active) { setItems(data); setErroCarga(false); }
            } catch (error) {
                logError('MeusRecebimentos: fetchPayments', error);
                if (active) setErroCarga(true);
            } finally {
                if (active) setLoading(false);
            }
        };

        fetchPayments();
        return () => { active = false; };
    }, [navigate, reloadKey]);

    const handleOpen = (jobId: string) => navigate(`/recibo/${jobId}`);

    const scheduled = items.filter((i) => i.payment.status === 'scheduled');
    const pendingConfirmation = items.filter((i) => i.payment.status === 'recorded' && !i.payment.worker_confirmed_at);
    const confirmed = items.filter((i) => i.payment.status === 'recorded' && !!i.payment.worker_confirmed_at);
    const voided = items.filter((i) => i.payment.status === 'voided');

    const totalRecorded = items
        .filter((i) => i.payment.status === 'recorded')
        .reduce((sum, i) => sum + (i.payment.amount || 0), 0);
    const totalScheduled = scheduled.reduce((sum, i) => sum + (i.payment.amount || 0), 0);

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto pb-24 space-y-6 animate-pulse" role="status"><span className="sr-only">Carregando</span>
                <div className="h-9 bg-gray-200 rounded-xl w-64" />
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
        <div className="max-w-4xl mx-auto pb-24 font-sans text-accent">
            <PageMeta
                title="Recebimentos"
                description="Acompanhe os pagamentos registrados pelas empresas: recebidos, agendados e aguardando sua confirmação."
            />

            <PageHeader
                title="Recebimentos"
                subtitle="Histórico dos pagamentos que as empresas registraram por fora do app."
            />

            {/* Resumo em uma faixa — NÃO é saldo: é histórico declarado pelas empresas */}
            {!isEmpty && (
                <dl className="mb-6 flex flex-wrap gap-x-6 gap-y-3 rounded-2xl border-2 border-gray-200 bg-white p-4">
                    <div>
                        <dt className="text-xs text-gray-600">Total recebido</dt>
                        <dd className="text-2xl font-bold tabular-nums text-primary">{formatBRL(totalRecorded)}</dd>
                    </div>
                    {scheduled.length > 0 && (
                        <div>
                            <dt className="text-xs text-gray-600">Total previsto</dt>
                            <dd className="text-2xl font-bold tabular-nums">{formatBRL(totalScheduled)}</dd>
                        </div>
                    )}
                    <div>
                        <dt className="text-xs text-gray-600">Aguardam confirmação</dt>
                        <dd className="text-2xl font-bold tabular-nums">{pendingConfirmation.length}</dd>
                    </div>
                </dl>
            )}

            {/* Aguardando confirmação — destaque, exige ação do freela */}
            {pendingConfirmation.length > 0 && (
                <section className="mb-8">
                    <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-primary">
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
                    <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-yellow-700">
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
                    <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
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
                    <h2 className="text-sm font-semibold mb-3 flex items-center gap-2 text-gray-500">
                        <XCircle size={16} /> Cancelados
                    </h2>
                    <div className="grid grid-cols-1 gap-3">
                        {voided.map((item) => (
                            <PaymentCard key={item.payment.id} item={item} onOpen={handleOpen} />
                        ))}
                    </div>
                </section>
            )}

            {erroCarga && !loading && (
                <ErroDeCarga onRetry={() => { setLoading(true); setReloadKey(k => k + 1); }} />
            )}

            {/* Empty state */}
            {isEmpty && !erroCarga && (
                <div className="text-center py-16 px-4 border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50">
                    <Receipt size={40} className="mx-auto mb-4 text-gray-300" />
                    <h2 className="text-lg font-bold mb-2">Nenhum recebimento ainda</h2>
                    <p className="text-sm text-gray-600 max-w-sm mx-auto">
                        Quando uma empresa registrar um pagamento pelo seu turno, ele aparece aqui —
                        com o comprovante e a confirmação de recebimento.
                    </p>
                </div>
            )}
        </div>
    );
}
