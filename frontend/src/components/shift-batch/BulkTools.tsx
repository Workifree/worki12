import { useState } from 'react';
import { SERIES_BROKEN_MESSAGE, plural, seriesDates, weeklySeriesFrom, MAX_BATCH_ROWS, BATCH_LIMIT_MESSAGE, type RowDefaults, type ShiftDraftSeries } from '../../lib/shiftDrafts';
import { Alert, Button, Field } from '../ui';
import { NumberInput } from './NumberInput';

/** "Aplicar a todas": só os campos preenchidos são aplicados. */
export function ApplyAll({ onApply }: { onApply: (patch: Partial<RowDefaults>) => void }) {
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');
    const [slots, setSlots] = useState(0);
    const [budget, setBudget] = useState(0);
    const patch: Partial<RowDefaults> = {
        ...(start ? { start_time: start } : {}),
        ...(end ? { end_time: end } : {}),
        ...(slots > 0 ? { slots } : {}),
        ...(budget > 0 ? { budget } : {}),
    };
    return (
        <details>
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold underline">Aplicar a todas</summary>
            <div className="mt-2 grid grid-cols-2 gap-3">
                <Field label="Entrada de todas"><input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
                <Field label="Saída de todas"><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
                <Field label="Vagas de todas"><NumberInput inputMode="numeric" value={slots} onValue={setSlots} /></Field>
                <Field label="Valor de todas"><NumberInput inputMode="decimal" step="any" value={budget} onValue={setBudget} /></Field>
                <Button variant="secondary" className="col-span-2" disabled={Object.keys(patch).length === 0} onClick={() => onApply(patch)} data-copilot="empresa.turno-lote.aplicar-todas">
                    Aplicar a todas as linhas
                </Button>
            </div>
        </details>
    );
}

/** "Repetir toda semana até…" (só Gestor): acrescenta as datas como linhas editáveis. */
export function RepeatWeekly({
    dates, today, series, stillSeries, onGenerate,
}: {
    dates: string[];
    today: string;
    series: ShiftDraftSeries | null | undefined;
    /** false depois de qualquer edição que desfaz a série. */
    stillSeries: boolean;
    onGenerate: (series: ShiftDraftSeries, dates: string[]) => void;
}) {
    const [until, setUntil] = useState(series?.range_end ?? '');
    const candidate = dates.length && until ? weeklySeriesFrom(dates, until) : null;
    const generated = candidate ? seriesDates(candidate, today) : [];
    const tooMany = generated.length > MAX_BATCH_ROWS;
    return (
        <details open={Boolean(series)}>
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold underline">Repetir toda semana até…</summary>
            <div className="mt-2 flex flex-col gap-3">
                <Field label="Repetir até" hint={dates.length ? 'Usa os dias da semana das datas escolhidas.' : 'Escolha as datas primeiro.'}>
                    <input type="date" min={today} value={until} onChange={(e) => setUntil(e.target.value)} />
                </Field>
                {tooMany && <Alert tone="danger">{BATCH_LIMIT_MESSAGE}</Alert>}
                <Button variant="secondary" disabled={!candidate || tooMany || generated.length === 0} onClick={() => candidate && onGenerate(candidate, generated)}>
                    {generated.length ? `Gerar ${plural(generated.length, 'data', 'datas')}` : 'Gerar datas'}
                </Button>
                {series && (
                    <p role="status" className="text-sm text-gray-600">
                        {stillSeries
                            ? 'Sem ajustes, estes turnos formam uma série: dá para parar ou editar os futuros de uma vez.'
                            : SERIES_BROKEN_MESSAGE}
                    </p>
                )}
            </div>
        </details>
    );
}
