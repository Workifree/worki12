import { Copy, Pencil, Trash2 } from 'lucide-react';
import { dayLabel, effectiveShift, plural, type ShiftDraftRow, type ShiftDraftTemplate } from '../../lib/shiftDrafts';
import { formatBRL } from '../../lib/currency';
import { Button, Card, Menu } from '../ui';
import { RowFields } from './RowFields';

/** Uma linha por turno: resumo compacto, edição no lugar, duplicar e remover no menu. */
export function RowList({
    template, rows, today, editingKey, onEdit, onChange, onDuplicate, onRemove,
}: {
    template: ShiftDraftTemplate;
    rows: ShiftDraftRow[];
    today: string;
    editingKey: string | null;
    onEdit: (key: string | null) => void;
    onChange: (key: string, patch: Partial<ShiftDraftRow>) => void;
    onDuplicate: (key: string) => void;
    onRemove: (key: string) => void;
}) {
    return (
        <ul className="flex flex-col gap-2">
            {rows.map((row) => {
                const shift = effectiveShift(template, row);
                const when = `${dayLabel(row.date)} ${row.start_time || '--:--'}–${row.end_time || '--:--'}`;
                return (
                    <Card as="li" key={row.key} padding="sm" tone="nested">
                        <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold tabular-nums">{when}</p>
                                <p className="truncate text-xs text-gray-600">
                                    {plural(row.slots || 0, 'vaga', 'vagas')} · {row.budget > 0 ? formatBRL(row.budget) : 'sem valor'}
                                    {row.overrides?.title ? ` · ${shift.title}` : ''}
                                </p>
                            </div>
                            <Menu
                                label={`Opções do turno ${when}`}
                                items={[
                                    { label: 'Editar', icon: Pencil, onSelect: () => onEdit(row.key) },
                                    { label: 'Duplicar (outro horário)', icon: Copy, onSelect: () => onDuplicate(row.key) },
                                    { label: 'Remover', icon: Trash2, onSelect: () => onRemove(row.key), danger: true },
                                ]}
                            />
                        </div>
                        {editingKey === row.key && (
                            <div className="mt-3 flex flex-col gap-3 border-t-2 border-gray-200 pt-3">
                                <RowFields row={row} budgetType={shift.budget_type} onChange={(patch) => onChange(row.key, patch)} withDate minDate={today} />
                                <Button variant="secondary" onClick={() => onEdit(null)}>Fechar edição</Button>
                            </div>
                        )}
                    </Card>
                );
            })}
        </ul>
    );
}
