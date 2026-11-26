import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/logger';
import { todayInBrazil } from '../../lib/dateUtils';
import {
    EMPTY_ROW_DEFAULTS, batchFingerprint, copyJobs, createRow, emptyTemplate, hasBlockingIssue,
    lastWeekRange, lastWeekendRange, mergeDrafts, newId, resolveSeries, sortRows, templateFromJob,
    validateBatch, type RowDefaults, type ShiftDraftBatch, type ShiftDraftRow, type ShiftDraftSource,
    type SourceJob,
} from '../../lib/shiftDrafts';
import { batchFromParse, parseShiftText } from '../../lib/shiftTextParser';
import {
    batchDraftKey, clearShiftDraft, loadShiftDraft, saveShiftDraft, type SentBatch, type StoredShiftDraft,
} from '../../lib/shiftDraftStorage';
import {
    buildCallPlan, countPublishedBatch, dispatchCall, getModelJob, listJobsBetween, listPreviousWorkerIds,
    listRecentModels, publishBatch, type CallPlanItem, type CallResult,
} from '../../services/shiftBatchService';
import { listTags, type CompanyTag } from '../../services/shiftOperationService';
import type { PublishedBatch } from './BatchDone';
import type { EditorMode } from './BatchEditor';

export type BatchStep = 'start' | 'edit' | 'review' | 'done';

export interface ShiftBatchOptions {
    companyId: string;
    isGestor: boolean;
    tagsEnabled: boolean;
    /** `?repetir=<jobId>` */
    repeatJobId?: string | null;
    /** Entrada do copiloto: SÓ abre a revisão. Não existe caminho que publique sozinho. */
    initialDraft?: ShiftDraftBatch | null;
    onPublished?: (jobIds: string[]) => void;
    /** Abre direto a cópia do período (atalho "Copiar fim de semana"). Só leva à revisão. */
    startCopy?: 'weekend' | 'week' | null;
    /** Pendência de fora do rascunho (ex.: local da presença). Preenchida, não publica. */
    blockPublish?: string | null;
}

const DIRECT_SOURCES: ShiftDraftSource[] = ['form', 'template', 'repeat'];

const defaultsOf = (row: ShiftDraftRow | undefined): RowDefaults =>
    row ? { start_time: row.start_time, end_time: row.end_time, slots: row.slots, budget: row.budget } : EMPTY_ROW_DEFAULTS;

/** Rascunho vindo de fora (copiloto): id novo e chaves garantidas. */
function adopt(draft: ShiftDraftBatch): ShiftDraftBatch {
    return {
        ...draft,
        client_batch_id: newId(),
        template: { ...emptyTemplate(), ...draft.template },
        rows: (draft.rows ?? []).map((r) => ({ ...r, key: r.key || newId() })),
    };
}

export function useShiftBatch({ companyId, isGestor, tagsEnabled, repeatJobId, initialDraft, onPublished, startCopy: startCopyRange, blockPublish }: ShiftBatchOptions) {
    const [external] = useState(() => (initialDraft ? adopt(initialDraft) : null));
    const [step, setStep] = useState<BatchStep>(external ? 'review' : 'start');
    const [draft, setDraft] = useState<ShiftDraftBatch | null>(external);
    const [mode, setMode] = useState<EditorMode>('single');
    const [defaults, setDefaults] = useState<RowDefaults>(() => defaultsOf(external?.rows[0]));
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [reviewFromEditor, setReviewFromEditor] = useState(false);
    const [notices, setNotices] = useState<string[]>([]);
    const [textIssues, setTextIssues] = useState<string[]>([]);
    const [suggestedIds, setSuggestedIds] = useState<string[]>([]);

    const [models, setModels] = useState<SourceJob[] | null>(null);
    const [modelsError, setModelsError] = useState(false);
    const [modelsAttempt, setModelsAttempt] = useState(0);
    const [tags, setTags] = useState<CompanyTag[]>([]);
    const [defaultBriefing, setDefaultBriefing] = useState('');
    const [startError, setStartError] = useState<string | null>(null);
    const [copying, setCopying] = useState<'weekend' | 'week' | null>(null);

    const [storageKey, setStorageKey] = useState<string | null>(null);
    const [stored, setStored] = useState<StoredShiftDraft | null>(null);
    const sentRef = useRef<SentBatch | null>(null);

    const [publishing, setPublishing] = useState(false);
    const publishLock = useRef(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
    const [done, setDone] = useState<PublishedBatch | null>(null);
    const [results, setResults] = useState<Record<string, CallResult>>({});
    const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
    const doneCall = useRef<ShiftDraftBatch['call']>(undefined);

    const today = todayInBrazil();

    /** Qualquer mudança no rascunho apaga os erros do envio anterior. */
    const updateDraft = useCallback((next: ShiftDraftBatch) => {
        setDraft(next);
        setErrorMessage(null);
        setRowErrors({});
    }, []);

    const open = useCallback((next: ShiftDraftBatch, target: 'edit' | 'review', nextMode: EditorMode) => {
        sentRef.current = null;
        updateDraft(next);
        setDefaults(defaultsOf(next.rows[0]));
        setMode(nextMode);
        setEditingKey(null);
        setReviewFromEditor(false);
        setNotices([]);
        setTextIssues([]);
        setSuggestedIds([]);
        setStartError(null);
        setStep(target);
    }, [updateDraft]);

    const openModel = useCallback((job: SourceJob, source: ShiftDraftSource = 'template') => {
        const { template, defaults: rowDefaults } = templateFromJob(job);
        open({ client_batch_id: newId(), source, template, rows: [createRow('', rowDefaults)] }, 'edit', 'single');
    }, [open]);

    useEffect(() => {
        let active = true;
        void (async () => {
            try {
                const { data } = await supabase.auth.getSession();
                const userId = data.session?.user.id;
                if (!active || !userId) return;
                const key = batchDraftKey(userId, companyId);
                setStored(loadShiftDraft(key));
                setStorageKey(key);
            } catch (err) {
                logError('shiftBatch.draftKey', err);
            }
        })();
        return () => { active = false; };
    }, [companyId]);

    useEffect(() => {
        if (!storageKey || !draft || step === 'done' || step === 'start') return;
        saveShiftDraft(storageKey, { batch: draft, sent: sentRef.current });
    }, [storageKey, draft, step]);

    useEffect(() => {
        let active = true;
        void (async () => {
            try {
                const list = await listRecentModels();
                if (active) { setModels(list); setModelsError(false); }
            } catch (err) {
                logError('shiftBatch.models', err);
                if (active) setModelsError(true);
            }
        })();
        return () => { active = false; };
    }, [modelsAttempt]);

    useEffect(() => {
        if (!tagsEnabled) return;
        let active = true;
        void listTags(companyId, true).then((list) => { if (active) setTags(list); });
        return () => { active = false; };
    }, [companyId, tagsEnabled]);

    useEffect(() => {
        let active = true;
        void (async () => {
            const { data, error } = await supabase.from('companies').select('default_briefing').eq('id', companyId).maybeSingle();
            if (error) logError('shiftBatch.briefing', error);
            else if (active) setDefaultBriefing((data?.default_briefing as string | null) ?? '');
        })();
        return () => { active = false; };
    }, [companyId]);

    // 2b — Repetir: modelo já escolhido; a data fica em branco de propósito.
    useEffect(() => {
        if (!repeatJobId) return;
        let active = true;
        void (async () => {
            try {
                const job = await getModelJob(repeatJobId);
                if (!active) return;
                if (job) openModel(job, 'repeat');
                else setStartError('Não encontramos o turno para repetir. Escolha um modelo.');
            } catch (err) {
                logError('shiftBatch.repeat', err);
                if (active) setStartError('Não conseguimos carregar o turno para repetir. Escolha um modelo.');
            }
        })();
        return () => { active = false; };
    }, [repeatJobId, openModel]);

    const withBriefing = (batch: ShiftDraftBatch): ShiftDraftBatch =>
        batch.template.briefing ? batch : { ...batch, template: { ...batch.template, briefing: defaultBriefing } };

    const startBlank = () => open(
        withBriefing({ client_batch_id: newId(), source: 'form', template: emptyTemplate(), rows: [createRow('')] }),
        'edit', 'single',
    );

    const startFromText = (text: string) => {
        const parsed = parseShiftText(text, { today });
        const batch = batchFromParse(parsed);
        if (!batch) {
            setTextIssues(parsed.unknown.length ? parsed.unknown : ['Não entendi o texto.']);
            return;
        }
        open(withBriefing(batch), 'review', 'multi');
        setNotices([...parsed.unknown, ...parsed.notes]);
    };

    const startCopy = async (range: 'weekend' | 'week') => {
        setCopying(range);
        setStartError(null);
        try {
            const { from, to } = range === 'weekend' ? lastWeekendRange(today) : lastWeekRange(today);
            const jobs = await listJobsBetween(from, to);
            const allTags = tagsEnabled ? await listTags(companyId, true) : [];
            const copy = copyJobs(jobs, 7, new Set(allTags.filter((t) => t.archivedAt).map((t) => t.id)));
            if (!copy) {
                setStartError(range === 'weekend'
                    ? 'Não há turnos no fim de semana passado para repetir.'
                    : 'Não há turnos na semana passada para repetir.');
                return;
            }
            open({ client_batch_id: newId(), source: 'copy_week', template: copy.template, rows: copy.rows }, 'review', 'multi');
            setSuggestedIds(await listPreviousWorkerIds(jobs.map((j) => j.id)));
        } catch (err) {
            logError('shiftBatch.copy', err);
            setStartError('Não conseguimos carregar os turnos para copiar. Tente de novo.');
        } finally {
            setCopying(null);
        }
    };

    const autoCopied = useRef(false);
    useEffect(() => {
        if (!startCopyRange || external || autoCopied.current) return;
        autoCopied.current = true;
        void startCopy(startCopyRange);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- uma vez, na entrada pelo atalho
    }, [startCopyRange]);

    const resume = () => {
        if (!stored) return;
        open(stored.batch, 'edit', stored.batch.rows.length > 1 ? 'multi' : 'single');
        sentRef.current = stored.sent;
    };

    const backToStart = () => {
        if (draft) setStored({ batch: draft, sent: sentRef.current });
        setStep('start');
    };

    const editRow = (key: string) => {
        setMode(draft && draft.rows.length > 1 ? 'multi' : 'single');
        setEditingKey(key);
        setStep('edit');
    };

    const review = () => {
        setReviewFromEditor(true);
        setStep('review');
    };

    const send = async (item: CallPlanItem, retry: boolean) => {
        setSending((prev) => new Set(prev).add(item.job_id));
        const result = await dispatchCall(item, doneCall.current, { retry });
        setResults((prev) => ({ ...prev, [item.job_id]: result }));
        setSending((prev) => {
            const next = new Set(prev);
            next.delete(item.job_id);
            return next;
        });
    };

    /** Só é chamada por um toque em "Publicar". */
    const publish = async (invitees: (row: ShiftDraftRow) => string[]) => {
        if (!draft || publishLock.current) return;
        if (blockPublish) {
            setErrorMessage(blockPublish);
            return;
        }
        publishLock.current = true;
        setPublishing(true);
        setErrorMessage(null);
        setRowErrors({});
        try {
            const rows = sortRows(mergeDrafts(draft.template, draft.rows).rows);
            const now = todayInBrazil();
            if (hasBlockingIssue(validateBatch({ ...draft, rows }, { today: now }))) {
                setErrorMessage('Há pendências no rascunho. Corrija antes de publicar.');
                setStep('review');
                return;
            }
            const series = isGestor ? resolveSeries(draft.template, rows, draft.series, now) : null;
            const fingerprint = batchFingerprint(draft.template, rows, series);
            const previous = sentRef.current;
            let id = draft.client_batch_id;
            if (previous) {
                if (previous.fingerprint === fingerprint) {
                    id = previous.id;
                } else {
                    if (previous.uncertain) {
                        // O envio anterior pode ter gravado: conferir antes de criar OUTRO lote.
                        const count = await countPublishedBatch(companyId, previous.id);
                        if (count > 0) {
                            sentRef.current = null;
                            setDraft({ ...draft, client_batch_id: newId() });
                            setErrorMessage(`Atenção: o envio anterior criou ${count} turno(s). Confira em Meus turnos e tire daqui o que já existe. Tocar em Publicar de novo cria um lote novo.`);
                            return;
                        }
                    }
                    id = newId();
                }
            }
            sentRef.current = { id, fingerprint, uncertain: true };
            const sendingDraft = { ...draft, client_batch_id: id };
            if (storageKey) saveShiftDraft(storageKey, { batch: sendingDraft, sent: sentRef.current });

            const result = await publishBatch(companyId, { ...sendingDraft, rows }, series);
            if (!result.ok) {
                sentRef.current = { id, fingerprint, uncertain: result.uncertain };
                if (storageKey) saveShiftDraft(storageKey, { batch: sendingDraft, sent: sentRef.current });
                setErrorMessage(result.message);
                setRowErrors(Object.fromEntries(
                    result.errors.filter((e) => rows[e.row - 1]).map((e) => [rows[e.row - 1].key, e.message]),
                ));
                return;
            }

            sentRef.current = null;
            if (storageKey) clearShiftDraft(storageKey);
            setStored(null);
            const plan = buildCallPlan(rows, result.jobIds, invitees);
            doneCall.current = draft.call;
            setResults({});
            setDone({ template: draft.template, rows, jobIds: result.jobIds, alreadyCreated: result.alreadyCreated, publishedOn: now, plan });
            setDraft(null);
            setStep('done');
            onPublished?.(result.jobIds);
            // Em sequência; lote que já existia usa o modo "retry" para não chamar duas vezes.
            void (async () => {
                for (const item of plan) await send(item, result.alreadyCreated);
            })();
        } catch (err) {
            logError('shiftBatch.publishFlow', err);
            setErrorMessage('Não conseguimos conferir o envio anterior. Verifique a conexão e tente de novo.');
        } finally {
            publishLock.current = false;
            setPublishing(false);
        }
    };

    const reset = () => {
        setDone(null);
        setDraft(null);
        setStep('start');
        setModelsAttempt((a) => a + 1);
    };

    return {
        today, step, draft, mode, setMode, defaults, setDefaults, editingKey, reviewFromEditor,
        notices, textIssues, suggestedIds, models, modelsError,
        retryModels: () => setModelsAttempt((a) => a + 1),
        tags, startError, copying, stored, publishing, errorMessage, rowErrors, done, results, sending,
        directPublish: draft ? DIRECT_SOURCES.includes(draft.source) : false,
        updateDraft, openModel, startBlank, startFromText, startCopy, resume, backToStart, editRow,
        review, backToEditor: () => setStep('edit'), publish, retryCall: (item: CallPlanItem) => void send(item, true), reset,
    };
}
