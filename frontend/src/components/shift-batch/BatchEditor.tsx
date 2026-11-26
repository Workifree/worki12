import { useState } from 'react';
import { CalendarPlus, Plus } from 'lucide-react';
import {
    addDays, applyToAll, batchSummary, createRow, duplicateRow, effectiveShift, mergeDrafts, plural,
    resolveSeries, sortRows, validateBatch, workedMinutes, MAX_BATCH_ROWS, BATCH_LIMIT_MESSAGE,
    type RowDefaults, type ShiftDraftBatch, type ShiftDraftRow,
} from '../../lib/shiftDrafts';
import { formatBRL } from '../../lib/currency';
import { formatShiftDuration } from '../../lib/dateUtils';
import type { CompanyTag } from '../../services/shiftOperationService';
import { ActionBar, Alert, Button, Card } from '../ui';
import { TemplateFields } from './TemplateFields';
import { DateChips, MultiDateCalendar } from './DatePickers';
import { RowFields } from './RowFields';
import { RowList } from './RowList';
import { ApplyAll, RepeatWeekly } from './BulkTools';

export type EditorMode = 'single' | 'multi';

/** Edição do rascunho: um turno (caminho rápido) ou várias linhas de um mesmo comum. */
export function BatchEditor({
    draft, onDraft, mode, onMode, defaults, onDefaults, today, tags, canRepeat, directPublish,
    publishing, errorMessage, onPublish, onReview, onBack, initialEditingKey,
}: {
    draft: ShiftDraftBatch;
    onDraft: (draft: ShiftDraftBatch) => void;
    mode: EditorMode;
    onMode: (mode: EditorMode) => void;
    /** Horário, vagas e valor das próximas linhas. */
    defaults: RowDefaults;
    onDefaults: (defaults: RowDefaults) => void;
    today: string;
    tags: CompanyTag[];
    /** Série é do Gestor. */
    canRepeat: boolean;
    /** Turno único vindo do formulário/modelo publica direto da barra (R4.2). */
    directPublish: boolean;
    publishing: boolean;
    errorMessage: string | null;
    onPublish: () => void;
    onReview: () => void;
    onBack: () => void;
    initialEditingKey: string | null;
}) {
    const [editingKey, setEditingKey] = useState<string | null>(initialEditingKey);
    const [tried, setTried] = useState(false);
    const rows = draft.rows;
    const setRows = (next: ShiftDraftRow[]) => onDraft({ ...draft, rows: next });
    const patchRow = (key: string, patch: Partial<ShiftDraftRow>) =>
        setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

    const merged = mergeDrafts(draft.template, rows).rows;
    const summary = batchSummary(draft.template, merged);
    const blocking = validateBatch({ ...draft, rows: merged }, { today }).filter((i) => i.blocking);
    const selected = new Set(rows.map((r) => r.date).filter(Boolean));

    const toggleDate = (date: string) => {
        if (selected.has(date)) {
            setRows(rows.filter((r) => r.date !== date));
            return;
        }
        // A linha sem data (vinda do caminho rápido) recebe a primeira data tocada.
        const empty = rows.find((r) => !r.date);
        if (empty) patchRow(empty.key, { date });
        else if (rows.length < MAX_BATCH_ROWS) setRows(sortRows([...rows, createRow(date, defaults)]));
    };

    const addRow = () => {
        const last = rows[rows.length - 1];
        const date = last?.date ? addDays(last.date, 1) : today;
        const row = createRow(date, defaults);
        setRows([...rows, row]);
        setEditingKey(row.key);
    };

    // Enviar incompleto nunca é um botão morto: mostra o que falta.
    const guard = (next: () => void) => () => {
        if (blocking.length) setTried(true);
        else next();
    };

    const single = rows[0] ?? createRow('', defaults);
    const singleShift = effectiveShift(draft.template, single);
    const minutes = workedMinutes(single.start_time, single.end_time, singleShift.has_lunch);
    const publishes = mode === 'single' && directPublish && merged.length === 1;
    const problems = [...new Set(blocking.map((i) => i.detail))];

    return (
        <div className="flex flex-col gap-5">
            <Button variant="ghost" className="-ml-3 self-start" onClick={onBack}>Voltar</Button>

            <Card as="section" padding="sm" aria-label="O turno">
                <TemplateFields template={draft.template} tags={tags} startOpen={!draft.template.source_job_id && !draft.template.category} onChange={(template) => onDraft({ ...draft, template })} />
                {rows.some((r) => r.overrides?.title || r.overrides?.category) && (
                    <p className="mt-2 text-xs text-gray-600">Algumas linhas têm função ou título próprios; os campos acima valem para as demais.</p>
                )}
            </Card>

            {mode === 'single' ? (
                <section aria-label="Quando e quanto" className="flex flex-col gap-4">
                    <h2 className="text-lg font-bold">Quando</h2>
                    <DateChips value={single.date} today={today} onChange={(date) => setRows([{ ...single, date }])} />
                    <RowFields
                        row={single}
                        budgetType={singleShift.budget_type}
                        onChange={(patch) => {
                            const next = { ...single, ...patch };
                            setRows([next]);
                            onDefaults({ start_time: next.start_time, end_time: next.end_time, slots: next.slots, budget: next.budget });
                        }}
                    />
                    {single.start_time && single.end_time && single.end_time < single.start_time && (
                        <p role="status" className="text-sm font-bold">Termina {single.end_time} do dia seguinte.</p>
                    )}
                    <Button variant="secondary" iconLeft={<CalendarPlus size={16} />} onClick={() => onMode('multi')} data-copilot="empresa.turno-lote.varias-datas">
                        Várias datas
                    </Button>
                </section>
            ) : (
                <section aria-label="Datas e horários" className="flex flex-col gap-4">
                    <h2 className="text-lg font-bold">Datas</h2>
                    <MultiDateCalendar selected={selected} today={today} onToggle={toggleDate} />
                    {rows.some((r) => r.date) ? (
                        <RowList
                            template={draft.template}
                            rows={rows.filter((r) => r.date)}
                            today={today}
                            editingKey={editingKey}
                            onEdit={setEditingKey}
                            onChange={patchRow}
                            onDuplicate={(key) => {
                                const index = rows.findIndex((r) => r.key === key);
                                const copy = duplicateRow(rows[index]);
                                setRows([...rows.slice(0, index + 1), copy, ...rows.slice(index + 1)]);
                                setEditingKey(copy.key);
                            }}
                            onRemove={(key) => setRows(rows.filter((r) => r.key !== key))}
                        />
                    ) : (
                        <p className="text-sm text-gray-600">Toque nas datas do calendário. Cada data vira uma linha.</p>
                    )}
                    <Button variant="secondary" iconLeft={<Plus size={16} />} disabled={rows.length >= MAX_BATCH_ROWS} onClick={addRow}>Adicionar linha</Button>
                    {rows.length >= MAX_BATCH_ROWS && <Alert tone="warning">{BATCH_LIMIT_MESSAGE}</Alert>}
                    <details open={!defaults.start_time && rows.every((r) => !r.date)}>
                        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold underline">Horário das próximas datas</summary>
                        <div className="mt-2">
                            <RowFields
                                row={{ key: 'padrao', date: '', ...defaults }}
                                budgetType={draft.template.budget_type}
                                onChange={(patch) => {
                                    const next = { ...defaults, ...patch };
                                    onDefaults({ start_time: next.start_time, end_time: next.end_time, slots: next.slots, budget: next.budget });
                                    // Linhas ainda sem data acompanham o padrão.
                                    if (rows.some((r) => !r.date)) setRows(rows.map((r) => (r.date ? r : { ...r, ...patch })));
                                }}
                            />
                        </div>
                    </details>
                    <ApplyAll onApply={(patch) => { onDefaults({ ...defaults, ...patch }); setRows(applyToAll(rows, patch)); }} />
                    {canRepeat && (
                        <RepeatWeekly
                            dates={[...selected]}
                            today={today}
                            series={draft.series}
                            stillSeries={resolveSeries(draft.template, rows, draft.series, today) !== null}
                            onGenerate={(series, dates) => {
                                const base = rows.find((r) => r.date) ?? createRow('', defaults);
                                onDraft({
                                    ...draft,
                                    series,
                                    rows: dates.map((date) => createRow(date, { start_time: base.start_time, end_time: base.end_time, slots: base.slots, budget: base.budget })),
                                });
                            }}
                        />
                    )}
                </section>
            )}

            {errorMessage && <Alert tone="danger" role="alert">{errorMessage}</Alert>}
            {tried && problems.length > 0 && (
                <Alert tone="danger" role="alert" title="Antes de continuar">
                    <ul>{problems.slice(0, 4).map((p) => <li key={p}>{p}</li>)}</ul>
                </Alert>
            )}

            <ActionBar
                summary={
                    <p role="status">
                        {mode === 'single'
                            ? [minutes ? formatShiftDuration(minutes) : null, single.budget > 0 ? formatBRL(single.budget) : null].filter(Boolean).join(' · ') || 'Escolha data, horário e valor.'
                            : `${plural(summary.shifts, 'turno', 'turnos')} · ${plural(summary.slots, 'vaga', 'vagas')} · ${formatBRL(summary.cost)} previstos`}
                    </p>
                }
                primary={publishes ? (
                    <Button variant="dark" size="lg" loading={publishing} onClick={guard(onPublish)} data-copilot="empresa.turno-lote.publicar-um">
                        Publicar
                    </Button>
                ) : (
                    <Button variant="dark" size="lg" onClick={guard(onReview)} data-copilot="empresa.turno-lote.revisar">
                        Revisar{merged.length > 1 ? ` (${merged.length})` : ''}
                    </Button>
                )}
            />
        </div>
    );
}
