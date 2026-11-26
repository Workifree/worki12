import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
    SERIES_BROKEN_MESSAGE, dayLabel, mergeDrafts, resolveSeries, separateRows, shortDate, sortRows,
    validateBatch, type ExistingShift, type ShiftDraftRow,
} from '../../lib/shiftDrafts';
import { listExistingShifts, resolveInvitees } from '../../services/shiftBatchService';
import { Alert, ButtonLink } from '../ui';
import { BatchStart } from './BatchStart';
import { BatchEditor } from './BatchEditor';
import { BatchReview } from './BatchReview';
import { BatchDone } from './BatchDone';
import { CallSection, PeopleDialog } from './CallSection';
import { useBatchLinkRisk, useCallData, useRowBusy } from './useCallData';
import { useShiftBatch, type ShiftBatchOptions } from './useShiftBatch';

/** Começo → edição → revisão → publicado. */
export function ShiftBatchFlow({ extra, ...options }: ShiftBatchOptions & {
    /** Campos que valem para o lote inteiro, mostrados na edição e na revisão. */
    extra?: ReactNode;
}) {
    const flow = useShiftBatch(options);
    const { draft, step, today } = flow;
    /** 'all' = escolha geral; senão a chave da linha. */
    const [picking, setPicking] = useState<string | null>(null);

    const { rows, merges } = useMemo(() => {
        if (!draft) return { rows: [] as ShiftDraftRow[], merges: [] };
        const merged = mergeDrafts(draft.template, draft.rows);
        return { rows: sortRows(merged.rows), merges: merged.merges };
    }, [draft]);

    const callData = useCallData(step === 'review');
    const call = draft?.call ?? { mode: 'none' as const };
    const eligible = new Set(callData.members.map((m) => m.worker.id));
    const invitees = (row: ShiftDraftRow) =>
        resolveInvitees(row, draft?.call, (id) => callData.lists.find((l) => l.id === id)?.memberIds ?? [], eligible);
    const pairs = step === 'review' ? rows.map((row) => ({ row, workerIds: invitees(row) })) : [];
    const nameOf = (id: string) => callData.members.find((m) => m.worker.id === id)?.worker.full_name || 'Freela';
    const busy = useRowBusy(options.companyId, pairs);
    const risks = useBatchLinkRisk(options.companyId, pairs);

    // Duplicata provável: reconsulta só quando o conjunto de datas muda.
    const datesKey = [...new Set(rows.map((r) => r.date).filter(Boolean))].sort().join(',');
    const [existing, setExisting] = useState<ExistingShift[]>([]);
    const needsExisting = step === 'review' || step === 'edit';
    useEffect(() => {
        if (!needsExisting || !datesKey) return;
        let active = true;
        void listExistingShifts(datesKey.split(',')).then((list) => { if (active) setExisting(list); });
        return () => { active = false; };
    }, [datesKey, needsExisting]);

    // Mudou de etapa: o topo da nova etapa precisa estar à vista no celular.
    useEffect(() => {
        document.getElementById('lote-topo')?.scrollIntoView?.({ block: 'start' });
    }, [step]);

    const issues = draft
        ? validateBatch({ ...draft, rows }, {
            today,
            existingShifts: existing,
            busy: busy.map((b) => ({ row_key: b.row_key, worker_name: nameOf(b.worker_id) })),
        })
        : [];
    const series = draft && options.isGestor ? resolveSeries(draft.template, rows, draft.series, today) : null;
    const waitingTeam = callData.loading && (call.mode !== 'none' || rows.some((r) => r.invite_worker_ids?.length));
    const duplicates = issues.filter((i) => i.kind === 'probable_duplicate');
    const pickingRow = picking && picking !== 'all' ? rows.find((r) => r.key === picking) : undefined;

    return (
        <div id="lote-topo">
            {extra && (step === 'edit' || step === 'review') && <div className="mb-4">{extra}</div>}
            {step === 'start' && (
                <>
                    {flow.startError && <Alert tone="warning" role="alert" className="mb-4">{flow.startError}</Alert>}
                    <BatchStart
                        models={flow.models}
                        modelsError={flow.modelsError}
                        onRetryModels={flow.retryModels}
                        onModel={(job) => flow.openModel(job)}
                        onCopy={(range) => { void flow.startCopy(range); }}
                        copying={flow.copying}
                        onText={flow.startFromText}
                        textIssues={flow.textIssues}
                        onBlank={flow.startBlank}
                        resumeLabel={flow.stored
                            ? `${flow.stored.batch.template.title || 'Turno sem título'} · ${flow.stored.batch.rows.length} linha(s)`
                            : null}
                        onResume={flow.resume}
                    />
                </>
            )}

            {step === 'edit' && draft && (
                <>
                    {duplicates.length > 0 && flow.mode === 'single' && (
                        <Alert
                            tone="warning"
                            className="mb-4"
                            action={duplicates[0].job_id
                                ? <ButtonLink variant="secondary" to={`/company/jobs/${duplicates[0].job_id}`} target="_blank" rel="noopener">Ver turno parecido</ButtonLink>
                                : undefined}
                        >
                            {duplicates[0].detail}
                        </Alert>
                    )}
                    <BatchEditor
                        key={draft.client_batch_id}
                        draft={draft}
                        onDraft={flow.updateDraft}
                        mode={flow.mode}
                        onMode={flow.setMode}
                        defaults={flow.defaults}
                        onDefaults={flow.setDefaults}
                        today={today}
                        tags={options.tagsEnabled ? flow.tags : []}
                        canRepeat={options.isGestor}
                        directPublish={flow.directPublish}
                        publishing={flow.publishing}
                        errorMessage={flow.errorMessage ?? Object.values(flow.rowErrors)[0] ?? null}
                        onPublish={() => { void flow.publish(() => []); }}
                        onReview={flow.review}
                        onBack={flow.backToStart}
                        initialEditingKey={flow.editingKey}
                    />
                </>
            )}

            {step === 'review' && draft && (
                <BatchReview
                    batch={{ ...draft, rows }}
                    merges={merges}
                    issues={issues}
                    notices={flow.notices}
                    onSeparate={(keys) => flow.updateDraft({ ...draft, rows: separateRows(draft.rows, keys) })}
                    onEditRow={flow.editRow}
                    onBack={flow.reviewFromEditor ? flow.backToEditor : flow.backToStart}
                    onPublish={() => { void flow.publish(invitees); }}
                    publishing={flow.publishing || waitingTeam}
                    errorMessage={flow.errorMessage}
                    rowErrors={flow.rowErrors}
                    seriesNote={draft.series
                        ? series ? `Série: repete toda semana até ${shortDate(series.range_end)}.` : SERIES_BROKEN_MESSAGE
                        : null}
                    canCall={callData.members.length > 0}
                    inviteCount={(row) => invitees(row).length}
                    onRowPeople={setPicking}
                    callSection={
                        <CallSection
                            call={call}
                            onChange={(next) => flow.updateDraft({ ...draft, call: next })}
                            data={callData}
                            onPickPeople={() => setPicking('all')}
                            suggestedCount={flow.suggestedIds.filter((id) => eligible.has(id)).length}
                        />
                    }
                    riskWarnings={risks.map((r) => `${nameOf(r.worker_id)}: ${r.count} turnos na semana de ${dayLabel(r.week)}, contando este lote.`)}
                />
            )}

            {picking && draft && step === 'review' && (
                <PeopleDialog
                    title={pickingRow ? `Freelas de ${dayLabel(pickingRow.date)} ${pickingRow.start_time}` : 'Chamar para todos os turnos'}
                    members={callData.members}
                    rows={pickingRow ? [pickingRow] : rows}
                    selected={pickingRow ? pickingRow.invite_worker_ids ?? [] : call.worker_ids ?? []}
                    suggestedIds={new Set(flow.suggestedIds)}
                    busyIds={new Set(busy.filter((b) => !pickingRow || b.row_key === pickingRow.key).map((b) => b.worker_id))}
                    onClose={() => setPicking(null)}
                    onSave={(ids) => {
                        if (!pickingRow) {
                            flow.updateDraft({ ...draft, call: { ...call, mode: ids.length ? 'workers' : 'none', worker_ids: ids } });
                        } else {
                            // A linha pode ser a junção de várias: a escolha vale para todas as origens.
                            const sources = merges.find((m) => m.key === pickingRow.key)?.sourceKeys ?? [pickingRow.key];
                            flow.updateDraft({
                                ...draft,
                                rows: draft.rows.map((r) => (sources.includes(r.key) ? { ...r, invite_worker_ids: ids } : r)),
                            });
                        }
                        setPicking(null);
                    }}
                />
            )}

            {step === 'done' && flow.done && (
                <BatchDone done={flow.done} results={flow.results} sending={flow.sending} onRetry={flow.retryCall} onMore={flow.reset} />
            )}
        </div>
    );
}
