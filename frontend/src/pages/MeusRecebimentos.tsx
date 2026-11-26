import { useCallback, useEffect, useState } from 'react';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { useLatestResponse } from '../hooks/useLatestResponse';
import LocalDoTurno from '../components/LocalDoTurno';
import { useNavigate } from 'react-router-dom';
import {
    Receipt,
    Clock,
    CheckCircle2,
    ChevronRight,
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
import { Button, Card, EmptyState, PageHeader } from '../components/ui';

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

function CompanyLogo({ url, name }: { url: string | null | undefined; name: string }) {
    return (
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-100 text-gray-500">
            {url ? <img src={url} alt={name} className="h-full w-full object-cover" /> : <Building2 size={18} aria-hidden="true" />}
        </span>
    );
}

/** Situação do recebimento numa linha curta (nunca "saldo"). */
function PaymentMeta({ item }: { item: WorkerShiftPaymentListItem }) {
    const { payment, job } = item;
    const isVoided = payment.status === 'voided';
    return (
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-600">
            {payment.status === 'scheduled' && (
                <span className="inline-flex items-center gap-1 font-semibold text-status-warning-fg">
                    <Clock size={12} aria-hidden="true" />
                    Previsto (promessa) · {payment.scheduled_for ? formatDateOnly(payment.scheduled_for, 'dd/MM/yyyy') : '—'}
                </span>
            )}
            {payment.status === 'recorded' && payment.worker_confirmed_at && (
                <span className="inline-flex items-center gap-1 font-semibold text-primary-ink">
                    <CheckCircle2 size={12} aria-hidden="true" />
                    Recebido{payment.paid_at ? ` · ${formatDateOnly(payment.paid_at, 'dd/MM/yyyy')}` : ''}
                </span>
            )}
            {isVoided && (
                <span className="inline-flex items-center gap-1 font-semibold">
                    <XCircle size={12} aria-hidden="true" />
                    Cancelado
                </span>
            )}
            <span>{PAYMENT_SOURCE_LABELS[payment.source]}</span>
            {isVoided && payment.void_reason && <span className="italic">Motivo: {payment.void_reason}</span>}
            {!isVoided && job?.location && (
                <span className="inline-flex min-w-0 items-center gap-1">
                    <LocalDoTurno location={job.location} size={11} />
                </span>
            )}
        </span>
    );
}

/** Pede ação agora: cartão em foco, com o botão de confirmar. */
function PaymentCard({ item, onOpen }: PaymentCardProps) {
    const { payment, job, company } = item;
    const companyName = company?.name ?? 'Empresa';
    const jobTitle = job?.title ?? 'Turno';
    const amountMissing = !(Number(payment.amount) > 0);
    const handleOpen = () => { if (job?.id) onOpen(job.id); };

    return (
        <Card padding="sm" onActivate={handleOpen} className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
                <CompanyLogo url={company?.logo_url} name={companyName} />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold line-clamp-2 [overflow-wrap:anywhere]">{jobTitle}</p>
                    <p className="text-xs text-gray-600 truncate">
                        {companyName}
                        {job?.start_date ? ` · turno de ${formatDateOnly(job.start_date, 'dd/MM')}` : ''}
                    </p>
                    <PaymentMeta item={item} />
                </div>
                <p className="shrink-0 text-lg font-bold tabular-nums">{formatCurrency(payment.amount)}</p>
            </div>
            <Button
                variant="primary"
                fullWidth
                data-copilot="freela.recebimentos.confirmar"
                onClick={handleOpen}
            >
                {amountMissing ? 'Ver recibo' : 'Confirmar recebimento'}
            </Button>
        </Card>
    );
}

/** Histórico: linha de lista. Cancelado ('voided') não navega: o recibo (`/recibo/:jobId`) resolve
 *  pelo marcador ATIVO do turno, e abriria o de OUTRO registro (ou "não encontrado"). */
function PaymentRow({ item, onOpen }: PaymentCardProps) {
    const { payment, job, company } = item;
    const companyName = company?.name ?? 'Empresa';
    const jobTitle = job?.title ?? 'Turno';
    const isVoided = payment.status === 'voided';
    const body = (
        <>
            <CompanyLogo url={company?.logo_url} name={companyName} />
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-gray-900 truncate">{jobTitle}</span>
                <span className="block text-xs text-gray-600 truncate">
                    {companyName}
                    {job?.start_date ? ` · turno de ${formatDateOnly(job.start_date, 'dd/MM')}` : ''}
                </span>
                <PaymentMeta item={item} />
            </span>
            <span className={`shrink-0 text-sm font-bold tabular-nums ${isVoided ? 'text-gray-600 line-through' : 'text-gray-900'}`}>
                {formatCurrency(payment.amount)}
            </span>
        </>
    );
    return (
        <li>
            {isVoided ? (
                <div className="flex items-center gap-3 px-4 py-3 opacity-80">{body}</div>
            ) : (
                <button
                    type="button"
                    onClick={() => { if (job?.id) onOpen(job.id); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black"
                >
                    {body}
                    <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-gray-400" />
                </button>
            )}
        </li>
    );
}

function PaymentGroup({ title, items, onOpen, muted = false }: { title: string; items: WorkerShiftPaymentListItem[]; onOpen: (jobId: string) => void; muted?: boolean }) {
    return (
        <section className="flex flex-col gap-2">
            <h2 className={muted ? 'text-sm font-semibold text-gray-600' : 'text-base font-semibold'}>{title}</h2>
            <ul className="divide-y divide-gray-200 overflow-hidden rounded-2xl border border-gray-200 bg-white">
                {items.map((item) => <PaymentRow key={item.payment.id} item={item} onOpen={onOpen} />)}
            </ul>
        </section>
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

    const [userId, setUserId] = useState<string | null>(null);
    const beginPayments = useLatestResponse();

    // `silent` = recarga ao vivo: sem esqueleto e, se falhar, a lista fica como está.
    const fetchPayments = useCallback(async (isActive: () => boolean, silent = false) => {
        const claim = beginPayments();
        if (!silent) setLoading(true);
        try {
            const session = await checkSession();
            if (!isActive()) return;
            if (session.status === 'signed_out') { if (!silent) navigate('/login'); return; }
            if (session.status === 'unavailable') throw session.error;
            setUserId(session.user.id);

            const data = await PaymentRecordService.listForWorkerChecked(session.user.id);
            if (isActive() && claim()) { setItems(data); setErroCarga(false); }
        } catch (error) {
            logError('MeusRecebimentos: fetchPayments', error);
            if (!silent && isActive() && claim()) setErroCarga(true);
        } finally {
            if (!silent && isActive()) setLoading(false);
        }
    }, [navigate, beginPayments]);

    useEffect(() => {
        let active = true;
        void fetchPayments(() => active);
        return () => { active = false; };
    }, [fetchPayments, reloadKey]);

    useLiveRefresh({
        sources: userId ? [{ table: 'shift_payments', filter: `worker_id=eq.${userId}` }] : [],
        onRefresh: (ctx) => fetchPayments(ctx.isCurrent, true),
        paused: loading,
    });

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
        <div className="max-w-4xl mx-auto pb-24 font-sans text-accent flex flex-col gap-6">
            <PageMeta
                title="Recebimentos"
                description="Acompanhe os pagamentos registrados pelas empresas: recebidos, agendados e aguardando sua confirmação."
            />

            <PageHeader
                className="mb-0"
                title="Recebimentos"
                subtitle="Histórico dos pagamentos que as empresas registraram por fora do app."
            />

            {/* Aguardando confirmação — a ação vem antes de tudo */}
            {pendingConfirmation.length > 0 && (
                <section className="flex flex-col gap-3">
                    <h2 className="text-base font-semibold text-primary-ink">Confirme o recebimento</h2>
                    {pendingConfirmation.map((item) => (
                        <PaymentCard key={item.payment.id} item={item} onOpen={handleOpen} />
                    ))}
                </section>
            )}

            {/* Resumo em uma faixa — NÃO é saldo: é histórico declarado pelas empresas */}
            {!isEmpty && (
                <dl className="grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] divide-x divide-gray-200 rounded-2xl border border-gray-200 bg-white">
                    <div className="min-w-0 px-3 py-3">
                        <dt className="text-xs text-gray-600">Total recebido</dt>
                        <dd className="text-lg font-bold tabular-nums text-primary-ink truncate">{formatBRL(totalRecorded)}</dd>
                    </div>
                    {scheduled.length > 0 && (
                        <div className="min-w-0 px-3 py-3">
                            <dt className="text-xs text-gray-600">Total previsto</dt>
                            <dd className="text-lg font-bold tabular-nums truncate">{formatBRL(totalScheduled)}</dd>
                        </div>
                    )}
                    <div className="min-w-0 px-3 py-3">
                        <dt className="text-xs text-gray-600">Aguardam confirmação</dt>
                        <dd className="text-lg font-bold tabular-nums">{pendingConfirmation.length}</dd>
                    </div>
                </dl>
            )}

            {/* Agendados — promessa de pagamento, ainda não é dinheiro recebido */}
            {scheduled.length > 0 && <PaymentGroup title="Agendados" items={scheduled} onOpen={handleOpen} />}

            {/* Recebidos e confirmados */}
            {confirmed.length > 0 && <PaymentGroup title="Recebidos" items={confirmed} onOpen={handleOpen} />}

            {/* Cancelados — discreto, no rodapé */}
            {voided.length > 0 && <PaymentGroup title="Cancelados" items={voided} onOpen={handleOpen} muted />}

            {erroCarga && !loading && (
                <ErroDeCarga onRetry={() => { setLoading(true); setReloadKey(k => k + 1); }} />
            )}

            {isEmpty && !erroCarga && (
                <EmptyState
                    size="page"
                    icon={Receipt}
                    title="Nenhum recebimento ainda"
                    description="Quando uma empresa registrar um pagamento pelo seu turno, ele aparece aqui — com o comprovante e a confirmação de recebimento."
                />
            )}
        </div>
    );
}
