import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/logger';
import { todayInBrazil } from '../../lib/dateUtils';
import {
    EMPTY_ROW_DEFAULTS, batchFingerprint, createRow, emptyTemplate, hasBlockingIssue,
    mergeDrafts, newId, resolveSeries, sortRows, templateFromJob,
    validateBatch, type RowDefaults, type SavedShiftTemplate, type ShiftDraftBatch, type ShiftDraftRow, type ShiftDraftSource,
    type SourceJob,
} from '../../lib/shiftDrafts';
import {
    batchDraftKey, clearShiftDraft, loadShiftDraft, saveShiftDraft, type SentBatch, type StoredShiftDraft,
} from '../../lib/shiftDraftStorage';
import {
    buildCallPlan, countPublishedBatch, dispatchCall, getModelJob, listRecentModels, publishBatch, type CallPlanItem, type CallResult,
} from '../../services/shiftBatchService';
import { listTags, type CompanyTag } from '../../services/shiftOperationService';
import { listShiftTemplates, saveShiftTemplate } from '../../services/shiftTemplateService';
import type { PublishedBatch } from './BatchDone';
import type { EditorMode } from './BatchEditor';

export type BatchStep = 'start' | 'edit' | 'review' | 'done';

/** Dentro do começo: o hub com as três ideias, a área de modelos ou o histórico. */
export type StartView = 'hub' | 'models' | 'history';

/** Quantos turnos do histórico a tela "Repetir um turno anterior" busca. */
const HISTORY_LIMIT = 30;

export interface ShiftBatchOptions {
    companyId: string;
    isGestor: boolean;
    tagsEnabled: boolean;
    /** `?repetir=<jobId>` */
    repeatJobId?: string | null;
    /** Entrada do copiloto: SÓ abre a revisão. Não existe caminho que publique sozinho. */
    initialDraft?: ShiftDraftBatch | null;
    onPublished?: (jobIds: string[]) => void;
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

export function useShiftBatch({ companyId, isGestor, tagsEnabled, repeatJobId, initialDraft, onPublished, blockPublish }: ShiftBatchOptions) {
    const [external] = useState(() => (initialDraft ? adopt(initialDraft) : null));
    const [step, setStep] = useState<BatchStep>(external ? 'review' : 'start');
    const [draft, setDraft] = useState<ShiftDraftBatch | null>(external);
    const [mode, setMode] = useState<EditorMode>('single');
    const [defaults, setDefaults] = useState<RowDefaults>(() => defaultsOf(external?.rows[0]));
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [reviewFromEditor, setReviewFromEditor] = useState(false);
    const [notices, setNotices] = useState<string[]>([]);

    /** Modelos guardados pela empresa (null = carregando). */
    const [templates, setTemplates] = useState<SavedShiftTemplate[] | null>(null);
    const [templatesAttempt, setTemplatesAttempt] = useState(0);
    /** Rascunho descartado, para "Desfazer" por alguns segundos. */
    const [discarded, setDiscarded] = useState<StoredShiftDraft | null>(null);
    /** Nome do modelo a guardar ao publicar (null = não guardar). */
    const [saveModelName, setSaveModelName] = useState<string | null>(null);
    /** O rascunho nasceu de um modelo guardado: não faz sentido guardar de novo. */
    const [fromSavedId, setFromSavedId] = useState<string | null>(null);
    const [modelSaved, setModelSaved] = useState<'saved' | 'duplicate' | 'limit' | 'error' | null>(null);

    /** Histórico (turnos anteriores): só é buscado quando a tela de histórico abre. */
    const [startView, setStartView] = useState<StartView>('hub');
    const [models, setModels] = useState<SourceJob[] | null>(null);
    const [modelsError, setModelsError] = useState(false);
    const [modelsAttempt, setModelsAttempt] = useState(0);
    const [tags, setTags] = useState<CompanyTag[]>([]);
    const [defaultBriefing, setDefaultBriefing] = useState('');
    const [startError, setStartError] = useState<string | null>(null);

    const [storageKey, setStorageKey] = useState<string | null>(null);
    const [stored, setStored] = useState<StoredShiftDraft | null>(null);
    const sentRef = useRef<SentBatch | null>(null);
    /** Modelo do turno ao abrir o editor: sem data, sem mais linhas e sem mudança, não há o que guardar. */
    const baselineRef = useRef('');

    const [publishing, setPublishing] = useState(false);
    const publishLock = useRef(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
    const [done, setDone] = useState<PublishedBatch | null>(null);
    const [results, setResults] = useState<Record<string, CallResult>>({});
    const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
    const doneCall = useRef<ShiftDraftBatch['call']>(undefined);

    const today = todayInBrazil();

    /** Rascunho com conteúdo: alguma data, mais de uma linha ou o turno editado. Abrir e voltar não cria rascunho. */
    const isMeaningful = (batch: ShiftDraftBatch) =>
        batch.rows.some((r) => r.date) || batch.rows.length > 1 || JSON.stringify(batch.template) !== baselineRef.current;

    /** Qualquer mudança no rascunho apaga os erros do envio anterior. */
    const updateDraft = useCallback((next: ShiftDraftBatch) => {
        setDraft(next);
        setErrorMessage(null);
        setRowErrors({});
    }, []);

    const open = useCallback((next: ShiftDraftBatch, target: 'edit' | 'review', nextMode: EditorMode) => {
        sentRef.current = null;
        baselineRef.current = JSON.stringify(next.template);
        updateDraft(next);
        setDefaults(defaultsOf(next.rows[0]));
        setMode(nextMode);
        setEditingKey(null);
        setReviewFromEditor(false);
        setNotices([]);
        setStartError(null);
        setSaveModelName(null);
        setFromSavedId(null);
        setModelSaved(null);
        setStep(target);
    }, [updateDraft]);

    const openModel = useCallback((job: SourceJob, source: ShiftDraftSource = 'template') => {
        const { template, defaults: rowDefaults } = templateFromJob(job);
        open({ client_batch_id: newId(), source, template, rows: [createRow('', rowDefaults)] }, 'edit', 'single');
    }, [open]);

    const openSaved = useCallback((saved: SavedShiftTemplate) => {
        open({ client_batch_id: newId(), source: 'template', template: { ...saved.template }, rows: [createRow('', saved.defaults)] }, 'edit', 'single');
        setFromSavedId(saved.id);
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
        if (!isMeaningful(draft) && !sentRef.current) return;
        saveShiftDraft(storageKey, { batch: draft, sent: sentRef.current });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- isMeaningful só lê refs e o próprio rascunho
    }, [storageKey, draft, step]);

    const historyOpen = step === 'start' && startView === 'history';
    useEffect(() => {
        if (!historyOpen) return;
        let active = true;
        void (async () => {
            try {
                const list = await listRecentModels(HISTORY_LIMIT);
                if (active) { setModels(list); setModelsError(false); }
            } catch (err) {
                logError('shiftBatch.models', err);
                if (active) setModelsError(true);
            }
        })();
        return () => { active = false; };
    }, [historyOpen, modelsAttempt]);

    // Só o hub mostra a contagem de modelos; voltar a ele (a área de modelos pode ter criado, editado ou
    // excluído) reconsulta. Nas outras etapas não há por que buscar.
    const atHub = step === 'start' && startView === 'hub';
    useEffect(() => {
        if (!atHub) return;
        let active = true;
        void (async () => {
            try {
                const list = await listShiftTemplates(companyId);
                if (active) setTemplates(list);
            } catch (err) {
                logError('shiftBatch.templates', err);
                if (active) setTemplates((list) => list ?? []);
            }
        })();
        return () => { active = false; };
    }, [companyId, templatesAttempt, atHub]);

    // "Desfazer" some sozinho: depois disso o rascunho/modelo está de fato fora.
    useEffect(() => {
        if (!discarded) return;
        const id = window.setTimeout(() => setDiscarded(null), 15000);
        return () => window.clearTimeout(id);
    }, [discarded]);

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

    /** Descarta o rascunho guardado; "Desfazer" o devolve (a tela mostra por alguns segundos). */
    const discardDraft = () => {
        if (!stored) return;
        if (storageKey) clearShiftDraft(storageKey);
        setDiscarded(stored);
        setStored(null);
    };
    const undoDiscard = () => {
        if (!discarded) return;
        if (storageKey) saveShiftDraft(storageKey, discarded);
        setStored(discarded);
        setDiscarded(null);
    };

    const resume = () => {
        if (!stored) return;
        open(stored.batch, 'edit', stored.batch.rows.length > 1 ? 'multi' : 'single');
        sentRef.current = stored.sent;
    };

    const backToStart = () => {
        if (draft && (isMeaningful(draft) || sentRef.current)) setStored({ batch: draft, sent: sentRef.current });
        setStartView('hub');
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
            // Guardar como modelo: depois de publicar, e nunca impede nem desfaz a publicação.
            setModelSaved(null);
            if (saveModelName !== null && !fromSavedId) {
                const modelName = saveModelName.trim() || draft.template.title.trim() || 'Meu modelo';
                void saveShiftTemplate(companyId, modelName, draft.template, defaultsOf(rows[0]))
                    .then((r) => {
                        setModelSaved(r.ok ? 'saved' : r.reason);
                        if (r.ok) setTemplatesAttempt((a) => a + 1);
                    })
                    .catch((err) => {
                        logError('shiftBatch.saveTemplate', err);
                        setModelSaved('error');
                    });
            }
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
        setStartView('hub');
        setStep('start');
        setModelsAttempt((a) => a + 1);
    };

    return {
        today, step, draft, mode, setMode, defaults, setDefaults, editingKey, reviewFromEditor,
        notices, startView, setStartView, models, modelsError, retryModels: () => setModelsAttempt((a) => a + 1),
        templates, discarded, discardDraft, undoDiscard,
        saveModelName, setSaveModelName, fromSavedId, modelSaved, openSaved,
        tags, startError, stored, publishing, errorMessage, rowErrors, done, results, sending,
        directPublish: draft ? DIRECT_SOURCES.includes(draft.source) : false,
        updateDraft, openModel, startBlank, resume, backToStart, editRow,
        review, backToEditor: () => setStep('edit'), publish, retryCall: (item: CallPlanItem) => void send(item, true), reset,
    };
}
