import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, dayLabel, quickDateOptions, weekdayOf } from '../../lib/shiftDrafts';
import { WEEKDAY_FULL_LABELS } from '../../lib/weekdayLabels';
import { FilterChip, IconButton } from '../ui';

const MONTHS = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** "Hoje / Amanhã / Sáb / Dom" + qualquer outra data. */
export function DateChips({ value, today, onChange }: { value: string; today: string; onChange: (date: string) => void }) {
    return (
        <div className="flex flex-col gap-2">
            <div role="group" aria-label="Datas rápidas" className="flex flex-wrap gap-2">
                {quickDateOptions(today).map((o) => (
                    <FilterChip key={o.date} pressed={value === o.date} onClick={() => onChange(o.date)}>{o.label}</FilterChip>
                ))}
            </div>
            <label className="flex flex-col gap-1.5 text-sm font-bold">
                Outra data
                <input
                    type="date"
                    min={today}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="h-11 w-full rounded-xl border-ink border-black bg-white px-4 text-base font-normal sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
            </label>
            {value && <p className="text-sm text-gray-600" role="status">Selecionado: {dayLabel(value)}</p>}
        </div>
    );
}

function shiftMonth(month: string, delta: number): string {
    const [y, m] = month.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** Seleção múltipla. Datas passadas ficam desligadas. Sem card em volta: a 320px cada dia precisa da largura. */
export function MultiDateCalendar({
    selected, today, onToggle,
}: { selected: ReadonlySet<string>; today: string; onToggle: (date: string) => void }) {
    const [month, setMonth] = useState(() => ([...selected].sort()[0] ?? today).slice(0, 7));
    const first = `${month}-01`;
    const days: string[] = [];
    for (let d = first; d.startsWith(month); d = addDays(d, 1)) days.push(d);
    const title = `${MONTHS[Number(month.slice(5)) - 1]} de ${month.slice(0, 4)}`;

    return (
        <div data-copilot="empresa.turno-lote.calendario">
            <div className="flex items-center justify-between gap-2">
                <IconButton aria-label="Mês anterior" disabled={month <= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, -1))}>
                    <ChevronLeft size={20} />
                </IconButton>
                <p className="text-sm font-bold first-letter:uppercase" aria-live="polite">{title}</p>
                <IconButton aria-label="Próximo mês" onClick={() => setMonth(shiftMonth(month, 1))}>
                    <ChevronRight size={20} />
                </IconButton>
            </div>
            <div className="-mx-1 grid grid-cols-7 gap-0.5" role="group" aria-label={`Datas de ${title}`}>
                {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((label, i) => (
                    <span key={i} aria-hidden="true" className="py-1 text-center text-xs font-bold text-gray-600">{label}</span>
                ))}
                {Array.from({ length: weekdayOf(first) }, (_, i) => <span key={`blank-${i}`} />)}
                {days.map((date) => {
                    const pressed = selected.has(date);
                    return (
                        <button
                            key={date}
                            type="button"
                            disabled={date < today}
                            aria-pressed={pressed}
                            aria-label={`${WEEKDAY_FULL_LABELS[weekdayOf(date)]}, ${date.slice(8)}/${date.slice(5, 7)}`}
                            onClick={() => onToggle(date)}
                            className={`h-11 min-w-0 rounded-xl border-ink text-sm font-bold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black disabled:cursor-not-allowed disabled:border-transparent disabled:text-gray-400 ${pressed ? 'border-black bg-black text-white' : 'border-gray-200 bg-white text-black hover:border-black'} ${date === today && !pressed ? 'underline' : ''}`}
                        >
                            {Number(date.slice(8))}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
