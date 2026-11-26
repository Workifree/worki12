import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Pencil, Plus, Search, Trash2, Undo2 } from 'lucide-react';
import { categoryName, type SavedShiftTemplate } from '../../lib/shiftDrafts';
import { formatBRL } from '../../lib/currency';
import { logError } from '../../lib/logger';
import { listShiftTemplates, setShiftTemplateArchived } from '../../services/shiftTemplateService';
import { Alert, Button, Card, IconButton, Menu, SkeletonList } from '../ui';
import { TemplateEditorModal } from './TemplateEditorModal';

/** "18:00–23:00 · 3 vagas · R$ 150,00": o que a pessoa confere antes de usar. */
function summaryLine(defaults: SavedShiftTemplate['defaults']): string {
    const parts = [
        defaults.start_time && defaults.end_time ? `${defaults.start_time}–${defaults.end_time}` : 'Sem horário definido',
        `${defaults.slots} ${defaults.slots === 1 ? 'vaga' : 'vagas'}`,
        defaults.budget > 0 ? formatBRL(defaults.budget) : 'Sem valor definido',
    ];
    return parts.join(' · ');
}

const norm = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Mais de 5 modelos: vale a pena procurar. */
const SEARCH_FROM = 5;
/** Quantos aparecem de início; o resto fica em "Ver todos". */
const LIST_LIMIT = 6;
const UNDO_MS = 12000;

type Editor = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; template: SavedShiftTemplate };

/**
 * Área de modelos: criar, editar, usar e excluir (com desfazer). Carrega sozinha e não sabe nada do
 * fluxo de lote: quem a monta decide o que fazer com o modelo escolhido em `onUse`.
 */
export function TemplatesScreen({
    companyId, tagsEnabled = false, onUse, onBack,
}: {
    companyId: string;
    tagsEnabled?: boolean;
    onUse: (template: SavedShiftTemplate) => void;
    onBack: () => void;
}) {
    const [templates, setTemplates] = useState<SavedShiftTemplate[] | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [editor, setEditor] = useState<Editor>({ mode: 'closed' });
    const [removed, setRemoved] = useState<SavedShiftTemplate | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [showAll, setShowAll] = useState(false);

    const load = useCallback(async () => {
        try {
            const list = await listShiftTemplates(companyId);
            setTemplates(list);
            setLoadError(false);
        } catch (err) {
            logError('templatesScreen.list', err);
            setTemplates((current) => current ?? []);
            setLoadError(true);
        }
    }, [companyId]);

    useEffect(() => {
        let active = true;
        void (async () => {
            try {
                const list = await listShiftTemplates(companyId);
                if (active) { setTemplates(list); setLoadError(false); }
            } catch (err) {
                logError('templatesScreen.list', err);
                if (active) { setTemplates((current) => current ?? []); setLoadError(true); }
            }
        })();
        return () => { active = false; };
    }, [companyId, attempt]);

    // "Desfazer" some sozinho: depois disso o modelo está de fato fora.
    useEffect(() => {
        if (!removed) return;
        const id = window.setTimeout(() => setRemoved(null), UNDO_MS);
        return () => window.clearTimeout(id);
    }, [removed]);

    const remove = async (template: SavedShiftTemplate) => {
        setActionError(null);
        const ok = await setShiftTemplateArchived(template.id, true).catch(() => false);
        if (!ok) { setActionError('Não conseguimos excluir o modelo. Tente de novo.'); return; }
        setTemplates((list) => (list ?? []).filter((t) => t.id !== template.id));
        setRemoved(template);
    };

    const undo = async () => {
        if (!removed) return;
        const target = removed;
        setActionError(null);
        const ok = await setShiftTemplateArchived(target.id, false).catch(() => false);
        setRemoved(null);
        if (!ok) { setActionError('Não conseguimos desfazer: já existe outro modelo com esse nome, ou a conexão falhou.'); return; }
        await load();
    };

    const saved = (template: SavedShiftTemplate) => {
        setEditor({ mode: 'closed' });
        setTemplates((list) => {
            const current = list ?? [];
            return current.some((t) => t.id === template.id)
                ? current.map((t) => (t.id === template.id ? template : t))
                : [template, ...current];
        });
    };

    const searchable = (templates?.length ?? 0) > SEARCH_FROM;
    const activeQuery = searchable ? query : '';
    const filtered = templates && activeQuery.trim()
        ? templates.filter((t) => norm(`${t.name} ${t.template.title} ${categoryName(t.template.category)} ${t.template.location ?? ''}`).includes(norm(activeQuery)))
        : templates;
    const expanded = showAll || Boolean(activeQuery.trim());
    const visible = filtered && !expanded ? filtered.slice(0, LIST_LIMIT) : filtered;
    const hiddenCount = filtered && visible ? filtered.length - visible.length : 0;

    const emptyList = templates?.length === 0 && !loadError;

    const newButton = (
        <Button variant="dark" iconLeft={<Plus size={18} />} onClick={() => setEditor({ mode: 'create' })} data-copilot="empresa.modelos.novo">
            Novo modelo
        </Button>
    );

    return (
        <div className="flex flex-col gap-4">
            <div>
                <Button variant="ghost" iconLeft={<ArrowLeft size={18} />} onClick={onBack} className="-ml-3">Voltar</Button>
            </div>

            <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <h2 className="text-xl font-bold text-black">Meus modelos</h2>
                    <p className="mt-1 text-sm text-gray-600">
                        Um modelo guarda função, local, horário, vagas e valor. Use para criar turnos em um toque.
                    </p>
                </div>
                {!emptyList && <div className="shrink-0 [&>button]:w-full sm:[&>button]:w-auto">{newButton}</div>}
            </header>

            {loadError && (
                <Alert tone="warning" action={<Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>Tentar de novo</Button>}>
                    Não conseguimos carregar seus modelos.
                </Alert>
            )}
            {actionError && <Alert tone="danger" role="alert">{actionError}</Alert>}

            <div role="status" aria-live="polite">
                {removed && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
                        <span className="min-w-0 truncate">Modelo “{removed.name}” excluído.</span>
                        <Button variant="ghost" autoFocus aria-label={`Desfazer exclusão do modelo ${removed.name}`} iconLeft={<Undo2 size={16} />} onClick={() => void undo()}>Desfazer</Button>
                    </div>
                )}
            </div>

            {!loadError && templates === null && <SkeletonList count={3} itemClassName="h-20" label="Carregando modelos" />}

            {emptyList && (
                <div className="rounded-2xl border-2 border-dashed border-gray-300 px-4 py-8 text-center">
                    <h3 className="text-base font-bold text-black">Você ainda não tem modelos</h3>
                    <p className="mx-auto mt-1 max-w-prose text-sm text-gray-600">
                        Crie um modelo com a função, o horário e o valor que você mais usa. Da próxima vez, o turno sai em um toque.
                    </p>
                    <div className="mt-4 flex justify-center">{newButton}</div>
                </div>
            )}

            {searchable && (
                <div className="relative">
                    <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                        type="search"
                        aria-label="Buscar nos meus modelos"
                        placeholder="Buscar modelo"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="min-h-11 w-full rounded-xl border-2 border-black bg-white pl-9 pr-3 text-base"
                    />
                </div>
            )}

            {visible && visible.length > 0 && (
                <ul className="flex flex-col gap-3">
                    {visible.map((t) => {
                        const role = categoryName(t.template.category);
                        return (
                            <li key={t.id}>
                                <Card padding="sm" className="flex flex-wrap items-center gap-3 shadow-brutal-sm">
                                    <div className="min-w-[10rem] flex-1">
                                        <p className="break-words text-base font-bold text-black">{t.name}</p>
                                        <p className="mt-0.5 text-sm text-black">{summaryLine(t.defaults)}</p>
                                        {(role || t.template.location) && (
                                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600">
                                                {role && <span className="rounded-pill border border-black bg-[#D7F5E4] px-2 py-0.5 font-bold text-black">{role}</span>}
                                                {t.template.location && <span className="break-words">{t.template.location}</span>}
                                            </p>
                                        )}
                                    </div>
                                    <div className="ml-auto flex items-center gap-1">
                                        <Button variant="dark" onClick={() => onUse(t)} aria-label={`Usar modelo ${t.name}`} data-copilot="empresa.modelos.usar">Usar</Button>
                                        <IconButton variant="secondary" aria-label={`Editar modelo ${t.name}`} onClick={() => setEditor({ mode: 'edit', template: t })}>
                                            <Pencil size={18} />
                                        </IconButton>
                                        <Menu
                                            label={`Mais opções do modelo ${t.name}`}
                                            items={[{ label: 'Excluir modelo', icon: Trash2, danger: true, onSelect: () => void remove(t), 'data-copilot': 'empresa.modelos.excluir' }]}
                                        />
                                    </div>
                                </Card>
                            </li>
                        );
                    })}
                </ul>
            )}

            {hiddenCount > 0 && (
                <Button variant="secondary" onClick={() => setShowAll(true)}>Ver todos ({filtered?.length})</Button>
            )}
            {filtered && filtered.length === 0 && templates && templates.length > 0 && (
                <p className="text-sm text-gray-600">Nenhum modelo com “{activeQuery}”.</p>
            )}

            {editor.mode !== 'closed' && (
                <TemplateEditorModal
                    companyId={companyId}
                    template={editor.mode === 'edit' ? editor.template : undefined}
                    tagsEnabled={tagsEnabled}
                    onSaved={saved}
                    onClose={() => setEditor({ mode: 'closed' })}
                />
            )}
        </div>
    );
}
