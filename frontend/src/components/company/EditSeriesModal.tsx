import { useEffect, useState } from 'react';
import { X, Loader2, Repeat, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { logError } from '../../lib/logger';
import { todayLocalDate } from '../../lib/dateUtils';
import { JobSeriesService } from '../../services/jobSeriesService';
import { SHIFT_CATEGORIES } from './shiftCategories';
import { describeSeriesPreview } from './seriesPreviewText';
import { Button, Field } from '../ui';

/**
 * Snapshot mínimo de um `jobs` que pertence a uma série — o suficiente para pré-preencher o
 * formulário de "Este e os futuros" (R11). `budget` fica de fora de propósito: é imutável
 * pós-criação (regra já existente do produto) e a spec proíbe edição em massa de valor.
 */
export interface SeriesJobSnapshot {
    id: string;
    series_id: string;
    title: string;
    category: string;
    description: string;
    requirements: string;
    briefing: string | null;
    location: string | null;
    work_start_time: string | null;
    work_end_time: string | null;
    slots: number;
}

interface EditSeriesModalProps {
    job: SeriesJobSnapshot;
    onClose: () => void;
    /** Chamado depois de aplicar com sucesso, para o pai recarregar a lista. */
    onApplied: () => void;
}

type Phase = 'form' | 'confirm' | 'result';

interface ResultState {
    updated: number;
    skippedFilled: number;
    skippedCalled: number;
}

interface PreviewState {
    wouldUpdate: number;
    skippedFilled: number;
    skippedCalled: number;
}

interface EditSeriesFormState {
    title: string;
    category: string;
    description: string;
    requirements: string;
    briefing: string;
    location: string;
    work_start_time: string;
    work_end_time: string;
    slots: string;
}

/** Mesmo `patch` para a prévia (dry-run) e para a aplicação real — um formato só. */
function buildPatch(form: EditSeriesFormState): Record<string, unknown> {
    return {
        title: form.title,
        category: form.category,
        description: form.description,
        requirements: form.requirements,
        briefing: form.briefing,
        location: form.location,
        work_start_time: form.work_start_time,
        work_end_time: form.work_end_time,
        slots: Math.max(1, Number.parseInt(form.slots, 10) || 1),
    };
}

export default function EditSeriesModal({ job, onClose, onApplied }: EditSeriesModalProps) {
    const { addToast } = useToast();
    const [phase, setPhase] = useState<Phase>('form');
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState<ResultState | null>(null);
    const [preview, setPreview] = useState<PreviewState | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [form, setForm] = useState<EditSeriesFormState>({
        title: job.title,
        category: job.category,
        description: job.description,
        requirements: job.requirements,
        briefing: job.briefing ?? '',
        location: job.location ?? '',
        work_start_time: job.work_start_time ?? '',
        work_end_time: job.work_end_time ?? '',
        slots: String(job.slots ?? 1),
    });

    // Mesma validação de `CompanyCreateJob.canProceed()` (Step 3): sem isso, um horário vazio
    // segue como string vazia no `patch` até a RPC, que faz cast para `time` — erro genérico
    // sem apontar o campo, ou pior, horário zerado em silêncio nas ocorrências futuras.
    const canContinue = !!(form.title.trim() && form.category && form.description.trim() && form.work_start_time && form.work_end_time);

    // Prévia (dry-run) — dispara ao ENTRAR na tela de confirmação, não a cada tecla: os campos
    // do formulário ficam travados durante a fase 'confirm' (sem inputs editáveis nela), então
    // recalcular a cada keystroke seria trabalho jogado fora. Se o preview falhar, isso NÃO
    // bloqueia a ação — é informação, não guarda; a RPC real refaz todas as checagens de qualquer
    // forma (mesmo raciocínio do dry-run inteiro).
    useEffect(() => {
        if (phase !== 'confirm') return;
        let active = true;
        setPreview(null);
        setPreviewError(null);
        setPreviewLoading(true);
        JobSeriesService.previewUpdateFutureOccurrences(job.series_id, todayLocalDate(), buildPatch(form))
            .then((res) => {
                if (!active) return;
                if (res.error) {
                    setPreviewError(res.error);
                } else {
                    setPreview({ wouldUpdate: res.wouldUpdate, skippedFilled: res.skippedFilled, skippedCalled: res.skippedCalled });
                }
            })
            .catch((err) => {
                if (!active) return;
                logError('EditSeriesModal.preview', err);
                setPreviewError('Não foi possível calcular a prévia.');
            })
            .finally(() => {
                if (active) setPreviewLoading(false);
            });
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- só recalcula ao ENTRAR em 'confirm' (form imutável nesta fase)
    }, [phase]);

    // Confirmar sem o número é exatamente o problema que este preview corrige: trava enquanto
    // carrega e quando a prévia já sabe que zero ocorrências seriam afetadas. Se o preview
    // FALHOU (previewError), não bloqueia — cai no texto qualitativo e deixa a empresa prosseguir.
    const confirmDisabled = saving || previewLoading || (preview !== null && preview.wouldUpdate === 0);

    const handleApply = async () => {
        setSaving(true);
        try {
            const result_ = await JobSeriesService.updateFutureOccurrences(job.series_id, todayLocalDate(), buildPatch(form));

            if (result_.error) {
                logError('EditSeriesModal.handleApply', result_.error);
                addToast(result_.error, 'error');
                setSaving(false);
                return;
            }

            setResult({ updated: result_.updated, skippedFilled: result_.skippedFilled, skippedCalled: result_.skippedCalled });
            setPhase('result');
            onApplied();
        } catch (error) {
            logError('EditSeriesModal.handleApply', error);
            addToast('Não foi possível atualizar a série. Tente novamente.', 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="edit-series-title"
                className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-lg p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
            >
                <div className="flex items-center justify-between mb-4">
                    <h2 id="edit-series-title" className="text-lg font-bold tracking-tight flex items-center gap-2">
                        <Repeat size={20} /> Editar os futuros
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Fechar"
                        className="h-11 w-11 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
                    >
                        <X size={20} />
                    </button>
                </div>

                {phase === 'form' && (
                    <div className="space-y-4">
                        <p className="text-xs text-gray-600">
                            Essa alteração vale para as próximas ocorrências desta série que ainda estão em aberto, sem freela
                            confirmado e sem chamado ativo. O valor do turno não muda (é travado após a criação).
                        </p>

                        <Field label="Título">
                            <input
                                id="es-title"
                                type="text"
                                value={form.title}
                                onChange={(e) => setForm({ ...form, title: e.target.value })}
                            />
                        </Field>

                        <Field label="Função">
                            <select
                                id="es-category"
                                value={form.category}
                                onChange={(e) => setForm({ ...form, category: e.target.value })}
                            >
                                {SHIFT_CATEGORIES.map(cat => (
                                    <option key={cat.slug} value={cat.slug}>{cat.name}</option>
                                ))}
                            </select>
                        </Field>

                        <Field label="Descrição">
                            <textarea
                                id="es-description"
                                className="!h-auto min-h-20 resize-y py-3"
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                            />
                        </Field>

                        <Field label="Requisitos">
                            <textarea
                                id="es-requirements"
                                className="!h-auto min-h-16 resize-y py-3"
                                value={form.requirements}
                                onChange={(e) => setForm({ ...form, requirements: e.target.value })}
                            />
                        </Field>

                        <Field label="Briefing">
                            <textarea
                                id="es-briefing"
                                className="!h-auto min-h-16 resize-y py-3"
                                value={form.briefing}
                                onChange={(e) => setForm({ ...form, briefing: e.target.value })}
                            />
                        </Field>

                        <Field label="Localização">
                            <input
                                id="es-location"
                                type="text"
                                value={form.location}
                                onChange={(e) => setForm({ ...form, location: e.target.value })}
                            />
                        </Field>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Field label="Entrada">
                                <input
                                    id="es-start"
                                    type="time"
                                    value={form.work_start_time}
                                    onChange={(e) => setForm({ ...form, work_start_time: e.target.value })}
                                />
                            </Field>
                            <Field label="Saída">
                                <input
                                    id="es-end"
                                    type="time"
                                    value={form.work_end_time}
                                    onChange={(e) => setForm({ ...form, work_end_time: e.target.value })}
                                />
                            </Field>
                        </div>

                        <Field label="Quantas pessoas">
                            <input
                                id="es-slots"
                                type="number"
                                min={1}
                                step={1}
                                className="sm:w-40"
                                value={form.slots}
                                onChange={(e) => setForm({ ...form, slots: e.target.value })}
                            />
                        </Field>

                        <Button variant="dark" size="lg" fullWidth onClick={() => setPhase('confirm')} disabled={!canContinue}>
                            Continuar
                        </Button>
                    </div>
                )}

                {phase === 'confirm' && (
                    <div className="space-y-4">
                        <div className="flex items-start gap-3 p-4 rounded-xl border-2 border-amber-300 bg-amber-50">
                            <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
                            <div className="text-sm font-bold text-amber-800">
                                <p>Essa alteração vai ser aplicada a partir de hoje em todas as ocorrências futuras desta série
                                    que ainda estão <strong>sem freela confirmado</strong> e <strong>sem chamado aberto</strong>.</p>
                                <p className="mt-2">Ocorrências já preenchidas ou com convite em andamento ficam como estão —
                                    você pode ajustá-las individualmente ("Somente este turno").</p>

                                {/* Prévia (dry-run): a conta real, antes de confirmar — não mais só a regra em prosa. */}
                                {previewLoading && (
                                    <p className="mt-3 flex items-center gap-2 text-amber-700">
                                        <Loader2 className="animate-spin" size={14} /> Calculando quantos turnos serão afetados...
                                    </p>
                                )}
                                {!previewLoading && preview && preview.wouldUpdate === 0 && (
                                    <p className="mt-3 text-red-700">Nenhuma ocorrência será afetada — todas já têm freela confirmado ou chamado aberto.</p>
                                )}
                                {!previewLoading && preview && preview.wouldUpdate > 0 && (
                                    <p className="mt-3">{describeSeriesPreview(preview.wouldUpdate, 'serão atualizados', 'será atualizado', preview)}</p>
                                )}
                                {!previewLoading && previewError && (
                                    <p className="mt-3 text-amber-700">Não foi possível calcular a prévia exata agora — a confirmação abaixo ainda respeita as mesmas regras.</p>
                                )}
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <Button variant="secondary" onClick={() => setPhase('form')} disabled={saving} className="flex-1">
                                Voltar
                            </Button>
                            <Button variant="dark" onClick={handleApply} disabled={confirmDisabled} loading={saving} className="flex-1">
                                {saving ? 'Aplicando...' : 'Confirmar e aplicar'}
                            </Button>
                        </div>
                    </div>
                )}

                {phase === 'result' && result && (
                    <div className="space-y-4">
                        <div className="flex items-start gap-3 p-4 rounded-xl border-2 border-primary bg-primary-light">
                            <CheckCircle2 size={20} className="text-primary flex-shrink-0 mt-0.5" />
                            <p className="text-sm font-bold text-primary-dark">
                                {result.updated} turno{result.updated !== 1 ? 's' : ''} atualizado{result.updated !== 1 ? 's' : ''}.
                            </p>
                        </div>
                        {(result.skippedFilled > 0 || result.skippedCalled > 0) && (
                            <div className="p-4 rounded-xl border-2 border-gray-200 bg-gray-50 space-y-1 text-sm font-bold text-gray-600">
                                {result.skippedFilled > 0 && (
                                    <p>{result.skippedFilled} turno{result.skippedFilled !== 1 ? 's não foram alterados' : ' não foi alterado'} porque já tem{result.skippedFilled !== 1 ? 'm' : ''} freela confirmado.</p>
                                )}
                                {result.skippedCalled > 0 && (
                                    <p>{result.skippedCalled} turno{result.skippedCalled !== 1 ? 's não foram alterados' : ' não foi alterado'} porque {result.skippedCalled !== 1 ? 'têm' : 'tem'} um chamado aberto — aguarde a resposta ou cancele o chamado antes.</p>
                                )}
                            </div>
                        )}
                        <Button variant="dark" size="lg" fullWidth onClick={onClose}>
                            Fechar
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
