import { useCallback, useState } from 'react';
import { logError } from '../../../lib/logger';
import type { BonusAdminAdapter } from './types';
import { formatCents, formatDate, isPayable, payoutHoldMessage } from './format';
import { downloadCsv, payoutsToCsv } from './csv';
import { useLoad } from './useLoad';

interface Props {
    adapter: BonusAdminAdapter;
}

export default function PayoutList({ adapter }: Props) {
    const fetcher = useCallback(() => adapter.getPayouts(), [adapter]);
    const { data, loading, error, reload } = useLoad(fetcher, 'bonus: lista de PIX');
    const [confirming, setConfirming] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [message, setMessage] = useState('');
    const [note, setNote] = useState('');

    const copy = async (pix: string) => {
        try {
            await navigator.clipboard.writeText(pix);
            setMessage('Chave PIX copiada.');
        } catch (err) {
            logError('bonus: copiar PIX', err);
            setMessage('Não foi possível copiar. Selecione a chave manualmente.');
        }
    };

    const markPaid = async (payoutId: string) => {
        setBusy(payoutId);
        try {
            await adapter.markPayoutPaid(payoutId, note.trim() || undefined);
            setNote('');
            setMessage('Pagamento registrado.');
            setConfirming(null);
            await reload();
        } catch (err) {
            logError('bonus: marcar como pago', err);
            // Mostra a frase do servidor (ex.: not_payable_yet, blocked_review) e relê o estado real.
            setMessage(err instanceof Error && err.message ? err.message : 'Não foi possível registrar o pagamento.');
            setConfirming(null);
            setNote('');
            await reload();
        }
        setBusy(null);
    };

    if (loading) return <div className="space-y-4"><div className="h-32 bg-gray-200 rounded-xl animate-pulse" /></div>;
    if (error) return <p role="alert" className="font-bold text-red-700">{error}</p>;

    const items = data ?? [];
    const payableItems = items.filter(isPayable);
    const total = payableItems.reduce((s, i) => s + i.amountCents, 0);

    return (
        <section aria-labelledby="bonus-pix" className="space-y-4">
            <h2 id="bonus-pix" className="text-xl font-black uppercase">PIX da segunda</h2>
            <p className="text-sm text-gray-700">
                {payableItems.length > 0 ? 'Faça o PIX no seu banco, só dos pedidos liberados, e depois marque aqui. ' : 'Nenhum pedido liberado para pagar agora. '}
                Total a pagar: <strong className="tabular-nums">{formatCents(total)}</strong>
            </p>
            {payableItems.length > 0 && (
                <button type="button" onClick={() => downloadCsv('bonus-pix.csv', payoutsToCsv(items))}
                    className="min-h-[44px] px-6 py-3 rounded-xl border-2 border-black bg-white font-black uppercase hover:bg-gray-100">
                    Exportar CSV
                </button>
            )}
            {message && <p role="status" className="text-sm font-bold bg-gray-100 border-2 border-black rounded-xl px-4 py-2">{message}</p>}
            {items.length === 0 && <div className="bg-white border-2 border-black rounded-2xl p-6 font-bold">Nenhum pedido de bônus para pagar.</div>}
            {items.map((p) => (
                <article key={p.payoutId} className="bg-white border-2 border-black rounded-2xl p-4 sm:p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                            <h3 className="text-lg font-black">{p.operatorName}</h3>
                            <p className="text-sm text-gray-700">{p.companyName} · segunda {formatDate(p.scheduledFor)}</p>
                        </div>
                        <p className="text-2xl font-black tabular-nums">{formatCents(p.amountCents)}</p>
                    </div>
                    {!isPayable(p) && (
                        <p role="note" className={`mt-3 rounded-xl border-2 border-black px-4 py-3 font-black ${p.blocked ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                            {payoutHoldMessage(p)}
                        </p>
                    )}
                    {isPayable(p) && <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold">Chave PIX:</span>
                        <code className="px-3 py-1 rounded-xl bg-gray-100 text-sm break-all">{p.pixKey || 'sem chave cadastrada'}</code>
                        {p.pixKey && (
                            <button type="button" onClick={() => copy(p.pixKey)} aria-label={`Copiar chave PIX de ${p.operatorName}`}
                                className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl border-2 border-black text-sm font-black uppercase hover:bg-gray-100">
                                Copiar
                            </button>
                        )}
                    </div>}
                    <ul className="mt-3 text-sm space-y-1">
                        {p.milestones.map((m, i) => (
                            <li key={`${m.title}-${i}`} className="flex justify-between gap-2 border-b border-gray-200 py-1">
                                <span>{m.title}</span><span className="font-bold tabular-nums">{formatCents(m.amountCents)}</span>
                            </li>
                        ))}
                    </ul>
                    {isPayable(p) && <div className="mt-4">
                        {confirming === p.payoutId ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="sm:col-span-2">
                                    <label htmlFor={`note-${p.payoutId}`} className="block text-sm font-bold mb-1">Nota do pagamento (opcional)</label>
                                    <input id={`note-${p.payoutId}`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)}
                                        className="w-full border-2 border-black rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary" />
                                    <p className="text-xs text-gray-600 mt-1">Não escreva dado pessoal (CPF, telefone, endereço) na nota.</p>
                                </div>
                                <button type="button" disabled={busy === p.payoutId} onClick={() => markPaid(p.payoutId)}
                                    className="px-6 py-4 rounded-xl font-black uppercase bg-black text-white hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed">
                                    Confirmar: já paguei {formatCents(p.amountCents)}
                                </button>
                                <button type="button" onClick={() => { setConfirming(null); setNote(''); }}
                                    className="px-6 py-4 rounded-xl font-black uppercase border-2 border-black bg-white hover:bg-gray-100">
                                    Voltar
                                </button>
                            </div>
                        ) : (
                            <button type="button" onClick={() => { setNote(''); setConfirming(p.payoutId); }}
                                className="w-full sm:w-auto px-6 py-4 rounded-xl font-black uppercase bg-black text-white hover:bg-primary transition-colors">
                                Marcar como pago
                            </button>
                        )}
                    </div>}
                </article>
            ))}
        </section>
    );
}
