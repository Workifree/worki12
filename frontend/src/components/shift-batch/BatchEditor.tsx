import { useEffect, useRef, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import {
    addDays, applyToAll, batchSummary, categoryName, changeCategory, createRow, duplicateRow, isValidDate,
    mergeDrafts, newId, plural, resolveSeries, validateBatch, MAX_BATCH_ROWS, BATCH_LIMIT_MESSAGE,
    type RowDefaults, type ShiftDraftBatch, type ShiftDraftRow,
} from '../../lib/shiftDrafts';
import { SHIFT_CATEGORIES } from '../company/shiftCategories';
import { formatBRL } from '../../lib/currency';
import type { CompanyTag } from '../../services/shiftOperationService';
import { ActionBar, Alert, Button, Card, Field, IconButton } from '../ui';
import { ShiftRowCard } from './ShiftRowCard';
import { ShiftDetailsModal } from './ShiftDetailsModal';
import { ApplyAll, RepeatWeekly } from './BulkTools';

/** Mantido por compatibilidade: o editor agora é sempre a lista (1 cartão = turno único). */
export type EditorMode = 'single' | 'multi';

const rowDefaults = (row: ShiftDraftRow): RowDefaults => ({
    start_time: row.start_time, end_time: row.end_time, slots: row.slots, budget: row.budget,
});

type Details = { scope: 'template' } | { scope: 'row'; key: string };

/**
 * Editor em lista: cada turno é um cartão esticado com os campos rápidos; o lápis abre o turno
 * inteiro em tela cheia; "Adicionar outro turno" copia o último cartão para o dia seguinte.
 */
export function BatchEditor({
    draft, onDraft, onMode, defaults, onDefaults, today, tags, canRepeat, directPublish,
    publishing, errorMessage, onPublish, onReview, onBack, initialEditingKey, saveModelName, onSaveModelName,
}: {
    draft: ShiftDraftBatch;
    onDraft: (draft: ShiftDraftBatch) => void;
    /** Ignorados: o editor é sempre a lista. */
    mode?: EditorMode;
    onMode?: (mode: EditorMode) => void;
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
    /** Turno a trazer à vista (volta da revisão): o foco vai para a data dele. */
    initialEditingKey: string | null;
    /** undefined = o turno já nasceu de um modelo guardado (sem opção). null = não guardar; texto = nome do modelo. */
    saveModelName?: string | null;
    onSaveModelName: (name: string | null) => void;
}) {
    void onMode;
    const [details, setDetails] = useState<Details | null>(null);
    const [tried, setTried] = useState(false);
    const focusKey = useRef<string | null>(initialEditingKey);
    const dateInputs = useRef(new Map<string, HTMLInputElement>());
    // Marcou "Guardar como modelo": o foco vai para o nome, acima da barra fixa (scroll-mb).
    const modelNameRef = useRef<HTMLInputElement>(null);
    const savingModel = saveModelName !== undefined && saveModelName !== null;
    useEffect(() => {
        if (savingModel) modelNameRef.current?.focus({ preventScroll: false });
    }, [savingModel]);

    const rows = draft.rows;
    const setRows = (next: ShiftDraftRow[]) => onDraft({ ...draft, rows: next });
    const patchRow = (key: string, patch: Partial<ShiftDraftRow>) =>
        setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

    // Sempre há pelo menos um cartão: a lista nunca fica vazia.
    useEffect(() => {
        if (rows.length === 0) onDraft({ ...draft, rows: [createRow('', defaults)] });
    }, [rows.length, draft, defaults, onDraft]);

    // Leva o foco ao campo Data do cartão pedido (novo turno, cópia, volta da revisão).
    useEffect(() => {
        if (!focusKey.current) return;
        const input = dateInputs.current.get(focusKey.current);
        if (!input) return;
        input.focus();
        input.scrollIntoView?.({ block: 'center' });
        focusKey.current = null;
    }, [rows]);

    const merged = mergeDrafts(draft.template, rows).rows;
    const summary = batchSummary(draft.template, merged);
    const blocking = validateBatch({ ...draft, rows: merged }, { today }).filter((i) => i.blocking);
    const problems = [...new Set(blocking.map((i) => i.detail))];
    const full = rows.length >= MAX_BATCH_ROWS;
    const publishes = directPublish && rows.length === 1;

    const addRow = () => {
        if (full) return;
        const last = rows[rows.length - 1];
        const next: ShiftDraftRow = last
            ? { ...last, key: newId(), date: isValidDate(last.date) ? addDays(last.date, 1) : '', invite_worker_ids: undefined, keep_separate: undefined }
            : createRow(today, defaults);
        focusKey.current = next.key;
        setRows([...rows, next]);
    };

    const duplicate = (key: string) => {
        if (full) return;
        const index = rows.findIndex((r) => r.key === key);
        const copy = duplicateRow(rows[index]);
        focusKey.current = copy.key;
        setRows([...rows.slice(0, index + 1), copy, ...rows.slice(index + 1)]);
    };

    // Enviar incompleto nunca é um botão morto: mostra o que falta.
    const guard = (next: () => void) => () => {
        if (blocking.length) setTried(true);
        else next();
    };

    const base = draft.template;
    const editingRow = details?.scope === 'row' ? rows.find((r) => r.key === details.key) : undefined;

    return (
        <div className="flex flex-col gap-5">
            <Button variant="ghost" className="-ml-3 self-start" onClick={onBack}>Voltar</Button>

            <Card as="section" padding="sm" aria-label="O turno" className="shadow-brutal-sm">
                <div className="flex items-center gap-3">
                    <p className="min-w-0 flex-1 text-sm">
                        <span className="font-bold">Turno de: </span>
                        {base.title.trim() || 'sem título'}
                        {base.category && base.title.trim() !== categoryName(base.category) && ` · ${categoryName(base.category)}`}
                    </p>
                    <IconButton
                        variant="secondary"
                        aria-label="Editar dados do turno"
                        onClick={() => setDetails({ scope: 'template' })}
                        data-copilot="empresa.turno-lote.editar-turno"
                    >
                        <Pencil size={18} />
                    </IconButton>
                </div>
                {!base.category && (
                    <div className="mt-3">
                        <Field label="Função" required>
                            <select value={base.category} onChange={(e) => onDraft({ ...draft, template: changeCategory(base, e.target.value) })}>
                                <option value="">Selecione a função</option>
                                {SHIFT_CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                            </select>
                        </Field>
                    </div>
                )}
                <p className="mt-2 text-xs text-gray-600">Os dados do turno valem para todos os cartões abaixo. O lápis de cada cartão muda só aquele turno.</p>
            </Card>

            <section aria-label="Turnos" className="flex flex-col gap-3">
                <h2 className="text-lg font-bold">Quando e quanto</h2>
                <ol aria-label="Turnos a criar" className="flex flex-col gap-3">
                    {rows.map((row) => (
                        <ShiftRowCard
                            key={row.key}
                            row={row}
                            template={base}
                            today={today}
                            showProblems={tried}
                            canRemove={rows.length > 1}
                            dateRef={(el) => { if (el) dateInputs.current.set(row.key, el); else dateInputs.current.delete(row.key); }}
                            onChange={(patch) => {
                                patchRow(row.key, patch);
                                onDefaults(rowDefaults({ ...row, ...patch }));
                            }}
                            onEditDetails={() => setDetails({ scope: 'row', key: row.key })}
                            onDuplicate={() => duplicate(row.key)}
                            onRemove={() => setRows(rows.filter((r) => r.key !== row.key))}
                        />
                    ))}
                </ol>
                <Button
                    variant="secondary"
                    size="lg"
                    fullWidth
                    iconLeft={<Plus size={18} />}
                    disabled={full}
                    onClick={addRow}
                    aria-describedby="lote-add-ajuda"
                    data-copilot="empresa.turno-lote.adicionar-turno"
                >
                    Adicionar outro turno
                </Button>
                <p id="lote-add-ajuda" className="text-center text-xs text-gray-600">Cria outro turno igual a este, com outra data.</p>
                {full && <Alert tone="warning">{BATCH_LIMIT_MESSAGE}</Alert>}
                {rows.length > 1 && (
                    <ApplyAll onApply={(patch) => { onDefaults({ ...defaults, ...patch }); setRows(applyToAll(rows, patch)); }} />
                )}
                {canRepeat && (
                    <RepeatWeekly
                        dates={[...new Set(rows.map((r) => r.date).filter(Boolean))]}
                        today={today}
                        series={draft.series}
                        stillSeries={resolveSeries(base, rows, draft.series, today) !== null}
                        onGenerate={(series, dates) => {
                            const first = rows.find((r) => r.date) ?? rows[0] ?? createRow('', defaults);
                            onDraft({ ...draft, series, rows: dates.map((date) => createRow(date, rowDefaults(first))) });
                        }}
                    />
                )}
            </section>

            {saveModelName !== undefined && (
                <section aria-label="Guardar como modelo" className="rounded-xl border border-gray-200 bg-white p-3">
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold">
                        <input
                            type="checkbox"
                            className="h-5 w-5 shrink-0"
                            checked={saveModelName !== null}
                            onChange={(e) => onSaveModelName(e.target.checked ? base.title.trim() || 'Meu modelo' : null)}
                            data-copilot="empresa.turno-lote.guardar-modelo"
                        />
                        Guardar como modelo para usar de novo
                    </label>
                    {saveModelName !== null && (
                        <div className="mt-2 scroll-mb-40 pl-8">
                            <label htmlFor="lote-nome-modelo" className="mb-1 block text-xs font-bold text-gray-600">Nome do modelo</label>
                            <input
                                id="lote-nome-modelo"
                                ref={modelNameRef}
                                type="text"
                                maxLength={60}
                                value={saveModelName}
                                onChange={(e) => onSaveModelName(e.target.value)}
                                className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-base"
                            />
                        </div>
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
                stickyOnDesktop
                summary={<p>{`${plural(summary.shifts, 'turno', 'turnos')} · ${plural(summary.slots, 'vaga', 'vagas')} · ${formatBRL(summary.cost)} previstos`}</p>}
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

            {details?.scope === 'template' && (
                <ShiftDetailsModal
                    scope="template"
                    template={base}
                    tags={tags}
                    onClose={() => setDetails(null)}
                    onSaveTemplate={(template) => { onDraft({ ...draft, template }); setDetails(null); }}
                />
            )}
            {editingRow && (
                <ShiftDetailsModal
                    scope="row"
                    template={base}
                    tags={tags}
                    row={editingRow}
                    today={today}
                    onClose={() => setDetails(null)}
                    onSaveRow={(row) => {
                        patchRow(row.key, row);
                        onDefaults(rowDefaults(row));
                        setDetails(null);
                    }}
                />
            )}
        </div>
    );
}
