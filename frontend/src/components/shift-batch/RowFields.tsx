import type { ShiftBudgetType, ShiftDraftRow } from '../../lib/shiftDrafts';
import { Field } from '../ui';
import { NumberInput } from './NumberInput';

const BUDGET_LABEL: Record<ShiftBudgetType, string> = {
    daily: 'Valor por pessoa (dia)',
    hourly: 'Valor por pessoa (hora)',
    project: 'Valor por pessoa (total)',
};

/** Entrada, saída, vagas e valor: o que varia por turno. 2 colunas cabem a 320px. */
export function RowFields({
    row, budgetType, onChange, withDate = false, minDate,
}: {
    row: ShiftDraftRow;
    budgetType: ShiftBudgetType;
    onChange: (patch: Partial<ShiftDraftRow>) => void;
    withDate?: boolean;
    minDate?: string;
}) {
    return (
        <div className="grid grid-cols-2 gap-3">
            {withDate && (
                <Field label="Data" className="col-span-2">
                    <input type="date" min={minDate} value={row.date} onChange={(e) => onChange({ date: e.target.value })} />
                </Field>
            )}
            <Field label="Entrada">
                <input type="time" value={row.start_time} onChange={(e) => onChange({ start_time: e.target.value })} />
            </Field>
            <Field label="Saída">
                <input type="time" value={row.end_time} onChange={(e) => onChange({ end_time: e.target.value })} />
            </Field>
            <Field label="Vagas">
                <NumberInput inputMode="numeric" step={1} value={row.slots} onValue={(slots) => onChange({ slots })} />
            </Field>
            <Field label={BUDGET_LABEL[budgetType]}>
                <NumberInput inputMode="decimal" step="any" placeholder="0,00" value={row.budget} onValue={(budget) => onChange({ budget })} />
            </Field>
        </div>
    );
}
