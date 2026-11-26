import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    SERIES_BROKEN_MESSAGE, dayLabel, mergeDrafts, resolveSeries, separateRows, shortDate, sortRows,
    validateBatch, type ExistingShift, type ShiftDraftRow,
} from '../../lib/shiftDrafts';
import { listExistingShifts, resolveInvitees } from '../../services/shiftBatchService';
import { Alert, ButtonLink } from '../ui';
import { BatchStart } from './BatchStart';
import { HistoryScreen } from './HistoryScreen';
import { TemplatesScreen } from './TemplatesScreen';
import { BatchEditor } from './BatchEditor';
import { BatchReview } from './BatchReview';
import { BatchDone } from './BatchDone';
import { CallSection, PeopleDialog } from './CallSection';
import { useBatchLinkRisk, useCallData, useRowBusy } from './useCallData';
import { useShiftBatch, type ShiftBatchOptions, type StartView } from './useShiftBatch';
import type { SavedShiftTemplate, SourceJob } from '../../lib/shiftDrafts';

/** Marca no histórico do navegador: o botão Voltar do aparelho sai da subtela e cai no hub. */
interface ViewState { loteView?: StartView }

const NO_SUGGESTIONS: ReadonlySet<string> = new Set();

/** Começo → edição → revisão → publicado. */
export function ShiftBatchFlow({ extra, ...options }: ShiftBatchOptions & {
    /** Campos que valem para o lote inteiro, mostrados na edição e na revisão. */
    extra?: ReactNode;
}) {
    const flow = useShiftBatch(options);
    const { draft, step, today, setStartView } = flow;
    const location = useLocation();
    const navigate = useNavigate();
    const markedView = (location.state as ViewState | null)?.loteView ?? 'hub';
    useEffect(() => { setStartView(markedView); }, [markedView, setStartView]);
    const goView = useCallback((view: StartView) => {
        navigate({ pathname: location.pathname, search: location.search }, { state: { loteView: view } satisfies ViewState });
    }, [navigate, location.pathname, location.search]);
    /** "Voltar" da subtela: desfaz a entrada que criamos; sem ela (tela aberta direto), troca por um hub. */
    const backToHub = useCallback(() => {
        const idx = (window.history.state as { idx?: number } | null)?.idx;
        if (typeof idx === 'number' && idx > 0) navigate(-1);
        else navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
    }, [navigate, location.pathname, location.search]);
    /** Abrir o editor sai da subtela: ao voltar do editor o começo é o hub. */
    const leaveView = useCallback(() => {
        if (markedView !== 'hub') navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
    }, [markedView, navigate, location.pathname, location.search]);
    /**
     * Voltar do NAVEGADOR dentro do editor/revisão: ao entrar, criamos uma entrada no histórico com a marca
     * `loteStep`; se a marca some com o editor ainda aberto, foi o Voltar do navegador e voltamos ao começo.
     */
    const inEditor = step === 'edit' || step === 'review';
    const editorMarked = (location.state as { loteStep?: boolean } | null)?.loteStep === true;
    const hadMarker = useRef(false);
    useEffect(() => {
        if (!inEditor) { hadMarker.current = false; return; }
        if (editorMarked) { hadMarker.current = true; return; }
        if (hadMarker.current) { hadMarker.current = false; flow.backToStart(); return; }
        navigate({ pathname: location.pathname, search: location.search }, { state: { loteStep: true } });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reage só à entrada/saída do editor e à marca
    }, [inEditor, editorMarked]);
    /** "Voltar" da tela: com a entrada criada, deixa o histórico desfazê-la (o efeito acima leva ao começo). */
    const leaveEditor = () => { if (editorMarked) navigate(-1); else flow.backToStart(); };
    const pickSaved = (saved: SavedShiftTemplate) => { leaveView(); flow.openSaved(saved); };
    const repeatJob = (job: SourceJob) => { leaveView(); flow.openModel(job, 'repeat'); };
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
        // Começo: volta ao topo da página (título à vista). Outras etapas: topo da própria etapa.
        if (step === 'start') window.scrollTo?.({ top: 0 });
        else document.getElementById('lote-topo')?.scrollIntoView?.({ block: 'start' });
    }, [step, flow.startView]);

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
                    {flow.startView === 'hub' && (
                        <BatchStart
                            onBlank={flow.startBlank}
                            onModels={() => goView('models')}
                            onHistory={() => goView('history')}
                            templatesCount={flow.templates ? flow.templates.length : null}
                            resumeLabel={flow.stored
                                ? `${flow.stored.batch.template.title || 'Turno sem título'} · ${flow.stored.batch.rows.length} ${flow.stored.batch.rows.length === 1 ? 'turno' : 'turnos'}`
                                : null}
                            onResume={flow.resume}
                            onDiscard={flow.discardDraft}
                            discarded={flow.discarded !== null}
                            onUndoDiscard={flow.undoDiscard}
                        />
                    )}
                    {flow.startView === 'models' && (
                        <TemplatesScreen companyId={options.companyId} tagsEnabled={options.tagsEnabled} onUse={pickSaved} onBack={backToHub} />
                    )}
                    {flow.startView === 'history' && (
                        <HistoryScreen
                            models={flow.models}
                            error={flow.modelsError}
                            onRetry={flow.retryModels}
                            onPick={repeatJob}
                            onBack={backToHub}
                        />
                    )}
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
                        onBack={leaveEditor}
                        initialEditingKey={flow.editingKey}
                        saveModelName={flow.fromSavedId ? undefined : flow.saveModelName}
                        onSaveModelName={flow.setSaveModelName}
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
                    onBack={flow.reviewFromEditor ? flow.backToEditor : leaveEditor}
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
                            suggestedCount={0}
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
                    suggestedIds={NO_SUGGESTIONS}
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
                <BatchDone done={flow.done} modelSaved={flow.modelSaved} results={flow.results} sending={flow.sending} onRetry={flow.retryCall} onMore={flow.reset} />
            )}
        </div>
    );
}
