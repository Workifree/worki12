import { useEffect, useState } from 'react';
import { X, Loader2, Repeat, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { logError } from '../../lib/logger';
import { todayLocalDate } from '../../lib/dateUtils';
import { JobSeriesService } from '../../services/jobSeriesService';
import { SHIFT_CATEGORIES } from './shiftCategories';
import { describeSeriesPreview } from './seriesPreviewText';

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
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
                        <Repeat size={20} /> Editar os futuros
                    </h2>
                    <button onClick={onClose} aria-label="Fechar" className="p-2 hover:bg-gray-100 rounded-xl transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
                        <X size={20} />
                    </button>
                </div>

                {phase === 'form' && (
                    <div className="space-y-4">
                        <p className="text-xs font-bold text-gray-500">
                            Essa alteração vale para as próximas ocorrências desta série que ainda estão em aberto, sem freela
                            confirmado e sem chamado ativo. O valor do turno não muda (é travado após a criação).
                        </p>

                        <div className="space-y-2">
                            <label htmlFor="es-title" className="text-xs font-bold uppercase tracking-wide">Título</label>
                            <input
                                id="es-title"
                                type="text"
                                className="w-full bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-bold transition-all"
                                value={form.title}
                                onChange={(e) => setForm({ ...form, title: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="es-category" className="text-xs font-bold uppercase tracking-wide">Função</label>
                            <select
                                id="es-category"
                                className="w-full bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-bold appearance-none"
                                value={form.category}
                                onChange={(e) => setForm({ ...form, category: e.target.value })}
                            >
                                {SHIFT_CATEGORIES.map(cat => (
                                    <option key={cat.slug} value={cat.slug}>{cat.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="es-description" className="text-xs font-bold uppercase tracking-wide">Descrição</label>
                            <textarea
                                id="es-description"
                                className="w-full h-20 bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-medium text-sm transition-all resize-none"
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="es-requirements" className="text-xs font-bold uppercase tracking-wide">Requisitos</label>
                            <textarea
                                id="es-requirements"
                                className="w-full h-16 bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-medium text-sm transition-all resize-none"
                                value={form.requirements}
                                onChange={(e) => setForm({ ...form, requirements: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="es-briefing" className="text-xs font-bold uppercase tracking-wide">Briefing</label>
                            <textarea
                                id="es-briefing"
                                className="w-full h-16 bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-medium text-sm transition-all resize-none"
                                value={form.briefing}
                                onChange={(e) => setForm({ ...form, briefing: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="es-location" className="text-xs font-bold uppercase tracking-wide">Localização</label>
                            <input
                                id="es-location"
                                type="text"
                                className="w-full bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-bold transition-all"
                                value={form.location}
                                onChange={(e) => setForm({ ...form, location: e.target.value })}
                            />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label htmlFor="es-start" className="text-xs font-bold uppercase tracking-wide">Entrada</label>
                                <input
                                    id="es-start"
                                    type="time"
                                    className="w-full bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-bold transition-all"
                                    value={form.work_start_time}
                                    onChange={(e) => setForm({ ...form, work_start_time: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="es-end" className="text-xs font-bold uppercase tracking-wide">Saída</label>
                                <input
                                    id="es-end"
                                    type="time"
                                    className="w-full bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-bold transition-all"
                                    value={form.work_end_time}
                                    onChange={(e) => setForm({ ...form, work_end_time: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="es-slots" className="text-xs font-bold uppercase tracking-wide">Quantas pessoas</label>
                            <input
                                id="es-slots"
                                type="number"
                                min={1}
                                step={1}
                                className="w-full sm:w-40 bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-bold transition-all"
                                value={form.slots}
                                onChange={(e) => setForm({ ...form, slots: e.target.value })}
                            />
                        </div>

                        <button
                            onClick={() => setPhase('confirm')}
                            disabled={!canContinue}
                            className="w-full min-h-[44px] bg-black hover:bg-primary text-white px-6 py-3 rounded-xl font-black uppercase text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Continuar
                        </button>
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
                            <button
                                onClick={() => setPhase('form')}
                                disabled={saving}
                                className="flex-1 min-h-[44px] px-4 py-3 rounded-xl border-2 border-black font-black uppercase text-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
                            >
                                Voltar
                            </button>
                            <button
                                onClick={handleApply}
                                disabled={confirmDisabled}
                                className="flex-1 min-h-[44px] px-4 py-3 rounded-xl bg-black hover:bg-primary text-white font-black uppercase text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {saving ? <Loader2 className="animate-spin" size={16} /> : null}
                                {saving ? 'Aplicando...' : 'Confirmar e aplicar'}
                            </button>
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
                        <button
                            onClick={onClose}
                            className="w-full min-h-[44px] bg-black hover:bg-primary text-white px-6 py-3 rounded-xl font-black uppercase text-sm transition-colors"
                        >
                            Fechar
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
