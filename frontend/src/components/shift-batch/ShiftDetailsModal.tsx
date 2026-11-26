import { useId, useState } from 'react';
import {
    dayLabel, effectiveShift, isValidDate,
    type ShiftDraftOverrides, type ShiftDraftRow, type ShiftDraftTemplate,
} from '../../lib/shiftDrafts';
import type { CompanyTag } from '../../services/shiftOperationService';
import { Button, DialogActions, DialogHeader } from '../ui';
import { Dialog } from '../ui/Dialog';
import { RowFields } from './RowFields';
import { TemplateFields } from './TemplateFields';

const OVERRIDE_KEYS: (keyof ShiftDraftOverrides)[] = [
    'title', 'category', 'location', 'tag_id', 'description', 'requirements', 'briefing',
    'certification_requirement', 'budget_type', 'has_lunch',
];

/** Só o que difere do comum vira override: o resto continua acompanhando o turno-base. */
function diffOverrides(template: ShiftDraftTemplate, working: ShiftDraftTemplate): ShiftDraftOverrides | undefined {
    const out: Record<string, unknown> = {};
    for (const key of OVERRIDE_KEYS) {
        if ((working[key] ?? null) !== (template[key] ?? null)) out[key] = working[key];
    }
    return Object.keys(out).length ? (out as ShiftDraftOverrides) : undefined;
}

type Props = {
    template: ShiftDraftTemplate;
    tags: CompanyTag[];
    onClose: () => void;
} & (
    | { scope: 'template'; onSaveTemplate: (template: ShiftDraftTemplate) => void }
    | { scope: 'row'; row: ShiftDraftRow; today: string; onSaveRow: (row: ShiftDraftRow) => void }
);

/**
 * O turno inteiro em tela cheia. `scope="template"` edita o que vale para todos os cartões;
 * `scope="row"` edita só aquele cartão (o que diferir do comum vira dado próprio da linha).
 * Nada muda no rascunho até tocar em "Salvar".
 */
export function ShiftDetailsModal(props: Props) {
    const { template, tags, onClose } = props;
    const titleId = useId();
    const [working, setWorking] = useState<ShiftDraftTemplate>(() =>
        props.scope === 'row' ? effectiveShift(template, props.row) : template);
    const [rowDraft, setRowDraft] = useState<ShiftDraftRow | null>(() => (props.scope === 'row' ? props.row : null));

    const save = () => {
        if (props.scope === 'template') props.onSaveTemplate(working);
        else if (rowDraft) props.onSaveRow({ ...rowDraft, overrides: diffOverrides(template, working) });
    };

    return (
        <Dialog
            onClose={onClose}
            labelledBy={titleId}
            className="h-full max-w-none rounded-none border-0 shadow-none sm:max-w-none sm:rounded-none"
        >
            <div className="mx-auto flex w-full max-w-2xl flex-col">
                <DialogHeader
                    title={props.scope === 'template' ? 'Dados do turno' : `Turno de ${rowDraft && isValidDate(rowDraft.date) ? dayLabel(rowDraft.date) : 'sem data'}`}
                    titleId={titleId}
                    subtitle={props.scope === 'template' ? 'Vale para todos os turnos desta lista.' : 'Vale só para este turno. O que você não mudar segue o turno-base.'}
                    onClose={onClose}
                />
                <div className="flex flex-col gap-4">
                    {rowDraft && props.scope === 'row' && (
                        <section aria-label="Data, horário e valor" className="flex flex-col gap-3">
                            <h3 className="text-sm font-bold">Data, horário e valor</h3>
                            <RowFields
                                row={rowDraft}
                                budgetType={working.budget_type}
                                withDate
                                minDate={props.today}
                                onChange={(patch) => setRowDraft({ ...rowDraft, ...patch })}
                            />
                        </section>
                    )}
                    <section aria-label="Sobre o turno" className="flex flex-col gap-3">
                        <h3 className="text-sm font-bold">Sobre o turno</h3>
                        <TemplateFields template={working} tags={tags} startOpen onChange={setWorking} />
                    </section>
                </div>
                <DialogActions>
                    <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                    <Button variant="dark" onClick={save}>Salvar</Button>
                </DialogActions>
            </div>
        </Dialog>
    );
}
