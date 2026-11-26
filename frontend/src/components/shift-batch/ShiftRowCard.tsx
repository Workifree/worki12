import { Copy, Pencil, Trash2 } from 'lucide-react';
import {
    crossesMidnight, dayLabel, effectiveShift, isValidDate, isValidTime, quickDateOptions,
    type ShiftBudgetType, type ShiftDraftRow, type ShiftDraftTemplate,
} from '../../lib/shiftDrafts';
import { Card, Field, FilterChip, IconButton, StatusBadge } from '../ui';
import { NumberInput } from './NumberInput';

const BUDGET_LABEL: Record<ShiftBudgetType, string> = {
    daily: 'Valor por pessoa (dia)',
    hourly: 'Valor por pessoa (hora)',
    project: 'Valor por pessoa (total)',
};

/**
 * Um turno = um cartão esticado, com o que muda de turno para turno à mão: data, entrada, saída,
 * vagas e valor. O lápis abre o turno inteiro. Dois "problemas" só ficam marcados (borda e
 * aria-invalid): o texto do que falta vive no aviso "Antes de continuar", uma vez só.
 */
export function ShiftRowCard({
    row, template, today, showProblems, canRemove, dateRef, onChange, onEditDetails, onDuplicate, onRemove,
}: {
    row: ShiftDraftRow;
    template: ShiftDraftTemplate;
    today: string;
    /** A pessoa já tentou continuar: campos vazios ficam marcados. */
    showProblems: boolean;
    canRemove: boolean;
    /** Registra o campo Data para o foco depois de "Adicionar outro turno". */
    dateRef: (element: HTMLInputElement | null) => void;
    onChange: (patch: Partial<ShiftDraftRow>) => void;
    onEditDetails: () => void;
    onDuplicate: () => void;
    onRemove: () => void;
}) {
    const shift = effectiveShift(template, row);
    const day = isValidDate(row.date) ? dayLabel(row.date) : 'sem data';
    const own = Boolean(row.overrides && Object.keys(row.overrides).length);
    const bad = (invalid: boolean) => (showProblems && invalid ? true : undefined);
    const quick = quickDateOptions(today).slice(0, 2);

    return (
        <Card as="li" padding="sm" className="shadow-brutal-sm" data-row-key={row.key}>
            <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
                <p className="min-w-0 truncate text-sm font-bold">{shift.title.trim() || 'Turno sem título'}</p>
                {own && <StatusBadge tone="info">Dados próprios</StatusBadge>}
            </div>
            <div role="group" aria-label="Datas rápidas" className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-gray-600">Atalho</span>
                {quick.map((o) => (
                    <FilterChip key={o.date} pressed={row.date === o.date} onClick={() => onChange({ date: o.date })}>{o.label}</FilterChip>
                ))}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(12rem,1.5fr)_repeat(4,minmax(0,1fr))_auto] md:items-start">
                <div className="col-span-2 md:col-span-1">
                    <Field label="Data">
                        <input
                            ref={dateRef}
                            type="date"
                            min={today}
                            value={row.date}
                            aria-invalid={bad(!isValidDate(row.date))}
                            onChange={(e) => onChange({ date: e.target.value })}
                        />
                    </Field>
                </div>
                <Field label="Entrada">
                    <input type="time" value={row.start_time} aria-invalid={bad(!isValidTime(row.start_time))} onChange={(e) => onChange({ start_time: e.target.value })} />
                </Field>
                <Field label="Saída">
                    <input type="time" value={row.end_time} aria-invalid={bad(!isValidTime(row.end_time))} onChange={(e) => onChange({ end_time: e.target.value })} />
                </Field>
                <Field label="Vagas">
                    <NumberInput inputMode="numeric" step={1} value={row.slots} aria-invalid={bad(!(row.slots >= 1))} onValue={(slots) => onChange({ slots })} />
                </Field>
                <Field label={BUDGET_LABEL[shift.budget_type]}>
                    <NumberInput inputMode="decimal" step="any" placeholder="0,00" value={row.budget} aria-invalid={bad(!(row.budget > 0))} onValue={(budget) => onChange({ budget })} />
                </Field>
                <div className="col-span-2 flex items-center justify-end gap-2 md:col-span-1 md:mt-7">
                    <IconButton variant="secondary" aria-label={`Editar detalhes do turno de ${day}`} onClick={onEditDetails}>
                        <Pencil size={18} />
                    </IconButton>
                    <IconButton variant="secondary" aria-label="Duplicar turno" onClick={onDuplicate}>
                        <Copy size={18} />
                    </IconButton>
                    {canRemove && (
                        <IconButton variant="danger" aria-label="Remover turno" onClick={onRemove}>
                            <Trash2 size={18} />
                        </IconButton>
                    )}
                </div>
            </div>
            {crossesMidnight(row.start_time, row.end_time) && (
                <p className="mt-2 text-xs font-bold text-gray-600">Termina {row.end_time} do dia seguinte.</p>
            )}
        </Card>
    );
}
