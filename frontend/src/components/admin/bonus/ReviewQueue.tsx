import { useCallback, useEffect, useRef, useState } from 'react';
import { logError } from '../../../lib/logger';
import type { BonusAdminAdapter, ReviewDecision, ReviewItem } from './types';
import { flagLabel, formatCents, formatDate } from './format';
import { useLoad } from './useLoad';

interface Props {
    adapter: BonusAdminAdapter;
    /** Tempo para desfazer antes de gravar de verdade. */
    undoMs?: number;
    /** Chamado quando a gravação feita ao sair da tela falha (o componente já foi desmontado). */
    onFlushError?: (message: string) => void;
}

interface Pending {
    item: ReviewItem;
    decision: ReviewDecision;
    timer: ReturnType<typeof setTimeout>;
}

// Callback ref estável: foca o "Desfazer" assim que ele substitui os botões de decisão.
const focusOnMount = (el: HTMLButtonElement | null) => { el?.focus(); };

export default function ReviewQueue({ adapter, undoMs = 6000, onFlushError }: Props) {
    const fetcher = useCallback(() => adapter.getReviewQueue(), [adapter]);
    const { data, loading, error, reload } = useLoad(fetcher, 'bonus: fila de conferência');
    const [pending, setPending] = useState<Record<string, Pending>>({});
    const [message, setMessage] = useState('');
    const pendingRef = useRef<Record<string, Pending>>({});
    useEffect(() => { pendingRef.current = pending; }, [pending]);

    // Decisões já enviadas ao servidor: nunca gravar duas vezes (timer x desmontagem x pagehide).
    const sentRef = useRef<Set<string>>(new Set());

    const commit = useCallback(async (p: Pending) => {
        if (sentRef.current.has(p.item.ledgerId)) return;
        sentRef.current.add(p.item.ledgerId);
        clearTimeout(p.timer);
        try {
            await adapter.decideReview(p.item.ledgerId, p.decision);
            setMessage(p.decision === 'approve' ? 'Turno aprovado.' : 'Turno marcado como "não contar".');
        } catch (err) {
            logError('bonus: decidir turno', err);
            setMessage('Não foi possível registrar a decisão. O turno voltou para a fila.');
        }
        setPending((cur) => {
            const next = { ...cur };
            delete next[p.item.ledgerId];
            return next;
        });
        await reload();
        sentRef.current.delete(p.item.ledgerId);
    }, [adapter, reload]);

    // Ao sair da tela (desmontagem ou pagehide), decisões ainda na janela de desfazer são gravadas.
    // Se falhar na desmontagem, o componente já não existe: o erro sobe pelo callback do painel.
    const flush = useCallback(() => {
        Object.values(pendingRef.current).forEach((p) => {
            if (sentRef.current.has(p.item.ledgerId)) return;
            sentRef.current.add(p.item.ledgerId);
            clearTimeout(p.timer);
            adapter.decideReview(p.item.ledgerId, p.decision).catch((err) => {
                logError('bonus: decidir turno', err);
                const text = `Não foi possível gravar a decisão do turno "${p.item.jobTitle || 'sem título'}". Reabra a fila e decida de novo.`;
                setMessage(text);
                onFlushError?.(text);
            });
        });
    }, [adapter, onFlushError]);

    useEffect(() => () => flush(), [flush]);

    // Avisa antes de fechar/recarregar a aba enquanto houver decisão ainda não gravada.
    const hasPending = Object.keys(pending).length > 0;
    useEffect(() => {
        if (!hasPending) return;
        const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', handler);
        window.addEventListener('pagehide', flush);
        return () => {
            window.removeEventListener('beforeunload', handler);
            window.removeEventListener('pagehide', flush);
        };
    }, [hasPending, flush]);

    const decide = (item: ReviewItem, decision: ReviewDecision) => {
        const timer = setTimeout(() => {
            const p = pendingRef.current[item.ledgerId];
            if (p) void commit(p);
        }, undoMs);
        setMessage('');
        setPending((cur) => ({ ...cur, [item.ledgerId]: { item, decision, timer } }));
    };

    const undo = (ledgerId: string) => {
        const p = pending[ledgerId];
        if (!p || sentRef.current.has(ledgerId)) return;
        clearTimeout(p.timer);
        setPending((cur) => {
            const next = { ...cur };
            delete next[ledgerId];
            return next;
        });
    };

    if (loading) return <div className="space-y-4"><div className="h-28 bg-gray-200 rounded-xl animate-pulse" /><div className="h-28 bg-gray-200 rounded-xl animate-pulse" /></div>;
    if (error) return <p role="alert" className="font-bold text-red-700">{error}</p>;

    const items = data ?? [];

    return (
        <section aria-labelledby="bonus-fila" className="space-y-4">
            <h2 id="bonus-fila" className="text-xl font-black uppercase">Fila de conferência</h2>
            <p className="text-sm text-gray-700">Só os turnos que precisam do seu olhar. O operador não vê nada disso.</p>
            <p className="text-xs text-gray-600">Não escreva dado pessoal (CPF, telefone, endereço) em notas ou motivos.</p>
            {message && <p role="status" className="text-sm font-bold bg-gray-100 border-2 border-black rounded-xl px-4 py-2">{message}</p>}
            {items.length === 0 && (
                <div className="bg-white border-2 border-black rounded-2xl p-6 font-bold">Nenhum turno para conferir.</div>
            )}
            {items.map((item) => {
                const p = pending[item.ledgerId];
                return (
                    <article key={item.ledgerId} className="bg-white border-2 border-black rounded-2xl p-4 sm:p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                                <h3 className="text-lg font-black">{item.jobTitle || 'Turno'}</h3>
                                <p className="text-sm text-gray-700">
                                    Operador: <strong>{item.operatorName}</strong> · Empresa: {item.companyName} · Freela: {item.workerName}
                                </p>
                            </div>
                            <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-bold tabular-nums">
                                Bônus em jogo: {formatCents(item.valueAtStakeCents)}
                            </span>
                        </div>
                        <ul className="mt-3 space-y-1">
                            {item.flags.map((f) => (
                                <li key={f} className="text-sm font-bold">{flagLabel(f)}</li>
                            ))}
                        </ul>
                        <p className="mt-2 text-xs text-gray-600">Sinalizado em {formatDate(item.flaggedAt)}{item.reviewDueAt ? ` · prazo ${formatDate(item.reviewDueAt)}` : ''}</p>
                        {p ? (
                            <div className="mt-4 flex flex-wrap items-center gap-3" role="status">
                                <span className="font-bold">{p.decision === 'approve' ? 'Aprovando…' : 'Marcando como "não contar"…'}</span>
                                <button type="button" ref={focusOnMount} onClick={() => undo(item.ledgerId)}
                                    className="px-6 py-3 rounded-xl border-2 border-black font-black uppercase bg-white hover:bg-gray-100">
                                    Desfazer
                                </button>
                            </div>
                        ) : (
                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <button type="button" onClick={() => decide(item, 'approve')}
                                    className="px-6 py-4 rounded-xl font-black uppercase bg-black text-white hover:bg-primary transition-colors">
                                    Aprovar
                                </button>
                                <button type="button" onClick={() => decide(item, 'not_count')}
                                    className="px-6 py-4 rounded-xl font-black uppercase bg-white text-black border-2 border-black hover:bg-gray-100 transition-colors">
                                    Não contar
                                </button>
                            </div>
                        )}
                    </article>
                );
            })}
        </section>
    );
}
