import { useCallback } from 'react';
import type { BonusAdminAdapter } from './types';
import { formatCents, formatDate, formatNumber } from './format';
import { useLoad } from './useLoad';

interface Props {
    adapter: BonusAdminAdapter;
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-white border-2 border-black rounded-2xl p-4">
            <p className="text-xs font-bold uppercase text-gray-600">{label}</p>
            <p className="text-2xl font-black tabular-nums">{value}</p>
        </div>
    );
}

export default function TrackingPanel({ adapter }: Props) {
    const fetcher = useCallback(() => adapter.getTracking(), [adapter]);
    const { data, loading, error } = useLoad(fetcher, 'bonus: acompanhamento');

    if (loading) return <div className="space-y-4"><div className="h-32 bg-gray-200 rounded-xl animate-pulse" role="status"><span className="sr-only">Carregando</span></div></div>;
    if (error || !data) return <p role="alert" className="font-bold text-red-700">{error || 'Sem dados.'}</p>;

    return (
        <section aria-labelledby="bonus-acomp" className="space-y-6">
            <h2 id="bonus-acomp" className="text-xl font-black uppercase">Acompanhamento</h2>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <Stat label="Operadores ativos" value={String(data.activeOperators)} />
                <Stat label="Exposição máxima" value={formatCents(data.maxExposureCents)} />
                <Stat label="Bônus conquistado" value={formatCents(data.earnedCents)} />
                <Stat label="Disponível para PIX" value={formatCents(data.availableCents)} />
                <Stat label="Já pago" value={formatCents(data.paidCents)} />
            </div>

            <div>
                <h3 className="text-lg font-black uppercase mb-2">Marcos concluídos por semana</h3>
                {data.milestonesByWeek.length === 0 ? <p className="text-sm font-bold">Nenhum marco ainda.</p> : (
                    <ul className="space-y-2">
                        {data.milestonesByWeek.map((w) => {
                            const max = Math.max(...data.milestonesByWeek.map((x) => x.count));
                            return (
                                <li key={w.weekStart} className="flex items-center gap-3 text-sm">
                                    <span className="w-24 shrink-0 font-bold tabular-nums">{formatDate(w.weekStart)}</span>
                                    <div className="flex-1 h-4 bg-gray-100 border-2 border-black rounded-full overflow-hidden">
                                        <div className="h-full bg-black" style={{ width: `${(w.count / max) * 100}%` }} />
                                    </div>
                                    <span className="w-8 text-right font-black tabular-nums">{w.count}</span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            <div>
                <h3 className="text-lg font-black uppercase">Hábito: turnos completos por semana</h3>
                <p className="text-sm text-gray-700 mb-2">Hipótese, não resultado. O que importa é a coluna das semanas 13 a 16, com o bônus já encerrado.</p>
                {!data.habitAvailable && <p role="status" className="text-sm font-bold mb-2">Leitura de hábito ainda indisponível.</p>}
                <div className="overflow-x-auto bg-white border-2 border-black rounded-2xl">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left uppercase text-xs border-b-2 border-black">
                                <th className="p-3">Operador</th>
                                <th className="p-3">Antes (4 sem.)</th>
                                <th className="p-3">Semanas 1-12</th>
                                <th className="p-3">Semanas 13-16</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.habit.length === 0 && <tr><td colSpan={4} className="p-3 font-bold">Sem operadores.</td></tr>}
                            {data.habit.map((h) => (
                                <tr key={h.operatorName} className="border-b border-gray-200">
                                    <td className="p-3 font-bold">{h.operatorName}</td>
                                    <td className="p-3 tabular-nums">{formatNumber(h.baselineWeeklyAvg, 'sem baseline')}</td>
                                    <td className="p-3 tabular-nums">{formatNumber(h.avgWeeks1to12)}</td>
                                    <td className="p-3 tabular-nums">{formatNumber(h.avgWeeks13to16)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    );
}
