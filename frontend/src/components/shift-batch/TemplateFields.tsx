import { SHIFT_CATEGORIES } from '../company/shiftCategories';
import { changeCategory, type ShiftBudgetType, type ShiftDraftTemplate } from '../../lib/shiftDrafts';
import type { CompanyTag } from '../../services/shiftOperationService';
import { Field } from '../ui';

/**
 * O que é comum a todas as linhas. Função primeiro; o resto fica recolhido e nunca some.
 * A linha "Presença" (`attendance_mode`) entra aqui quando a presença verificada existir.
 */
export function TemplateFields({
    template, tags, onChange, startOpen,
}: {
    template: ShiftDraftTemplate;
    tags: CompanyTag[];
    onChange: (template: ShiftDraftTemplate) => void;
    startOpen: boolean;
}) {
    const set = (patch: Partial<ShiftDraftTemplate>) => onChange({ ...template, ...patch });
    return (
        <div className="flex flex-col gap-3">
            <Field label="Função" required>
                <select value={template.category} onChange={(e) => onChange(changeCategory(template, e.target.value))}>
                    <option value="">Selecione a função</option>
                    {SHIFT_CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                </select>
            </Field>
            <details open={startOpen}>
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold underline">
                    Mais detalhes (título, local, descrição)
                </summary>
                <div className="mt-2 flex flex-col gap-3">
                    <Field label="Título do turno" required>
                        <input type="text" value={template.title} onChange={(e) => set({ title: e.target.value })} />
                    </Field>
                    <Field label="Local">
                        <input type="text" value={template.location ?? ''} onChange={(e) => set({ location: e.target.value })} />
                    </Field>
                    <Field label="Descrição" required>
                        <textarea className="resize-y" value={template.description} onChange={(e) => set({ description: e.target.value })} />
                    </Field>
                    <Field label="Tipo de pagamento">
                        <select value={template.budget_type} onChange={(e) => set({ budget_type: e.target.value as ShiftBudgetType })}>
                            <option value="daily">Por dia</option>
                            <option value="hourly">Por hora</option>
                            <option value="project">Valor fixo</option>
                        </select>
                    </Field>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-bold">
                        <input type="checkbox" className="h-5 w-5 rounded accent-black" checked={template.has_lunch} onChange={(e) => set({ has_lunch: e.target.checked })} />
                        Intervalo (1h)
                    </label>
                    {(tags.length > 0 || template.tag_id) && (
                        <Field label="Etiqueta (opcional)">
                            <select value={template.tag_id ?? ''} onChange={(e) => set({ tag_id: e.target.value || null })}>
                                <option value="">Sem etiqueta</option>
                                {tags.filter((t) => !t.archivedAt).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                        </Field>
                    )}
                    <Field label="Requisitos (opcional)">
                        <textarea className="resize-y" value={template.requirements ?? ''} onChange={(e) => set({ requirements: e.target.value })} />
                    </Field>
                    <Field label="Briefing do turno (opcional)" hint="O freela vê isso no convite.">
                        <textarea className="resize-y" value={template.briefing ?? ''} onChange={(e) => set({ briefing: e.target.value })} />
                    </Field>
                    <Field label="Certificação exigida (opcional)" hint="É só um aviso: não bloqueia freelas.">
                        <input type="text" maxLength={200} value={template.certification_requirement ?? ''} onChange={(e) => set({ certification_requirement: e.target.value || null })} />
                    </Field>
                </div>
            </details>
        </div>
    );
}
