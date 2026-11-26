import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { createRow, emptyTemplate, isValidTime, MAX_SLOTS, type RowDefaults, type SavedShiftTemplate, type ShiftDraftRow, type ShiftDraftTemplate } from '../../lib/shiftDrafts';
import { logError } from '../../lib/logger';
import { listTags, type CompanyTag } from '../../services/shiftOperationService';
import { saveShiftTemplate, updateShiftTemplate } from '../../services/shiftTemplateService';
import { Alert, Button, DialogActions, DialogHeader, Field } from '../ui';
import { Dialog } from '../ui/Dialog';
import { RowFields } from './RowFields';
import { TemplateFields } from './TemplateFields';

const NAME_MAX = 60;
const TITLE_ID = 'template-editor-title';
const NO_DEFAULTS: RowDefaults = { start_time: '', end_time: '', slots: 1, budget: 0 };

type Errors = Partial<Record<'name' | 'category' | 'title' | 'description' | 'hours' | 'slots', string>>;

function validate(name: string, template: ShiftDraftTemplate, defaults: RowDefaults): Errors {
    const errors: Errors = {};
    if (!name.trim()) errors.name = 'Dê um nome ao modelo.';
    if (!template.category) errors.category = 'Escolha a função.';
    if (!template.title.trim()) errors.title = 'Informe o título do turno.';
    if (!template.description.trim()) errors.description = 'Informe a descrição.';
    const hasStart = Boolean(defaults.start_time);
    const hasEnd = Boolean(defaults.end_time);
    if (hasStart !== hasEnd || (hasStart && (!isValidTime(defaults.start_time) || !isValidTime(defaults.end_time)))) {
        errors.hours = 'Preencha a entrada e a saída, ou deixe as duas em branco.';
    }
    if (!Number.isInteger(defaults.slots) || defaults.slots < 1 || defaults.slots > MAX_SLOTS) {
        errors.slots = `Vagas: de 1 a ${MAX_SLOTS}.`;
    }
    return errors;
}

/**
 * Criar ou editar um modelo (`template` ausente = criar). Tela cheia no celular. Nada aqui publica
 * turno: o modelo só guarda o que se repete (função, local, horário, vagas, valor).
 */
export function TemplateEditorModal({
    companyId, template: editing, tagsEnabled = false, onSaved, onClose,
}: {
    companyId: string;
    template?: SavedShiftTemplate;
    tagsEnabled?: boolean;
    onSaved: (saved: SavedShiftTemplate) => void;
    onClose: () => void;
}) {
    const [name, setName] = useState(editing?.name ?? '');
    const [draft, setDraft] = useState<ShiftDraftTemplate>(editing?.template ?? emptyTemplate(''));
    const [defaults, setDefaults] = useState<RowDefaults>(editing?.defaults ?? NO_DEFAULTS);
    const [tags, setTags] = useState<CompanyTag[]>([]);
    const [errors, setErrors] = useState<Errors>({});
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!tagsEnabled) return;
        let active = true;
        listTags(companyId, true)
            .then((list) => { if (active) setTags(list); })
            .catch((err) => logError('templateEditor.tags', err));
        return () => { active = false; };
    }, [companyId, tagsEnabled]);

    const row: ShiftDraftRow = useMemo(() => createRow('', defaults), [defaults]);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (saving) return;
        const found = validate(name, draft, defaults);
        setErrors(found);
        setSubmitError(null);
        if (Object.keys(found).length > 0) return;
        setSaving(true);
        try {
            const result = editing
                ? await updateShiftTemplate(editing.id, name, draft, defaults)
                : await saveShiftTemplate(companyId, name, draft, defaults);
            if (result.ok) { onSaved(result.template); return; }
            if (result.reason === 'duplicate') setErrors({ name: 'Já existe um modelo com esse nome.' });
            else if (result.reason === 'limit') setSubmitError('Você chegou ao limite de modelos. Exclua algum para criar outro.');
            else setSubmitError('Não conseguimos salvar o modelo. Tente de novo.');
        } catch (err) {
            logError('templateEditor.save', err);
            setSubmitError('Não conseguimos salvar o modelo. Tente de novo.');
        } finally {
            setSaving(false);
        }
    };

    const detailErrors = [errors.category, errors.title, errors.description].filter(Boolean).join(' ');

    return (
        <Dialog
            labelledBy={TITLE_ID}
            onClose={onClose}
            locked={saving}
            overlayClassName="max-sm:!p-0"
            className="max-w-none max-sm:h-full max-sm:rounded-none max-sm:border-0 max-sm:pt-[max(1.25rem,env(safe-area-inset-top))] sm:max-w-2xl"
        >
            <DialogHeader
                title={editing ? 'Editar modelo' : 'Novo modelo'}
                titleId={TITLE_ID}
                subtitle="O modelo guarda o que se repete. A data você escolhe na hora de usar."
                onClose={onClose}
                closeDisabled={saving}
            />
            <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
                <Field label="Nome do modelo" required error={errors.name} hint="Só para você achar depois. Ex.: Garçom de sábado.">
                    <input type="text" maxLength={NAME_MAX} data-autofocus value={name} onChange={(e) => setName(e.target.value)} />
                </Field>

                <TemplateFields template={draft} tags={tagsEnabled ? tags : []} onChange={setDraft} startOpen />
                {detailErrors && <Alert tone="danger" role="alert">{detailErrors}</Alert>}

                <fieldset className="flex flex-col gap-2 rounded-xl border-2 border-black p-3">
                    <legend className="px-1 text-sm font-bold">Horário padrão, vagas e valor</legend>
                    <RowFields
                        row={row}
                        budgetType={draft.budget_type}
                        onChange={(patch) => setDefaults((d) => ({
                            start_time: patch.start_time ?? d.start_time,
                            end_time: patch.end_time ?? d.end_time,
                            slots: patch.slots ?? d.slots,
                            budget: patch.budget ?? d.budget,
                        }))}
                    />
                    {(errors.hours || errors.slots) && (
                        <p role="alert" className="text-xs font-bold text-red-600">{[errors.hours, errors.slots].filter(Boolean).join(' ')}</p>
                    )}
                </fieldset>

                {submitError && <Alert tone="danger" role="alert">{submitError}</Alert>}

                <DialogActions>
                    <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
                    <Button type="submit" variant="dark" loading={saving}>Salvar modelo</Button>
                </DialogActions>
            </form>
        </Dialog>
    );
}
