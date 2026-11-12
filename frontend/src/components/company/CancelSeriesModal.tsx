import { useEffect, useState } from 'react';
import { X, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { logError } from '../../lib/logger';
import { todayLocalDate } from '../../lib/dateUtils';
import { JobSeriesService } from '../../services/jobSeriesService';
import { describeSeriesPreview } from './seriesPreviewText';
import { Button } from '../ui';

interface CancelSeriesModalProps {
    seriesId: string;
    onClose: () => void;
    /** Chamado depois de cancelar com sucesso, para o pai recarregar a lista. */
    onCancelled: () => void;
}

type Phase = 'confirm' | 'result';

interface ResultState {
    cancelled: number;
    skippedFilled: number;
    skippedCalled: number;
}

interface PreviewState {
    wouldCancel: number;
    skippedFilled: number;
    skippedCalled: number;
}

export default function CancelSeriesModal({ seriesId, onClose, onCancelled }: CancelSeriesModalProps) {
    const { addToast } = useToast();
    const [phase, setPhase] = useState<Phase>('confirm');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<ResultState | null>(null);
    const [preview, setPreview] = useState<PreviewState | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);

    // Prévia (dry-run) — o modal já ABRE na fase 'confirm' (não há um passo de formulário antes
    // dela), então isto dispara uma vez, ao montar. Falha do preview NÃO bloqueia a ação (é
    // informação, não guarda); a RPC real refaz as mesmas checagens de qualquer forma.
    useEffect(() => {
        if (phase !== 'confirm') return;
        let active = true;
        setPreview(null);
        setPreviewError(null);
        setPreviewLoading(true);
        JobSeriesService.previewStopSeries(seriesId, todayLocalDate())
            .then((res) => {
                if (!active) return;
                if (res.error) {
                    setPreviewError(res.error);
                } else {
                    setPreview({ wouldCancel: res.wouldCancel, skippedFilled: res.skippedFilled, skippedCalled: res.skippedCalled });
                }
            })
            .catch((err) => {
                if (!active) return;
                logError('CancelSeriesModal.preview', err);
                setPreviewError('Não foi possível calcular a prévia.');
            })
            .finally(() => {
                if (active) setPreviewLoading(false);
            });
        return () => { active = false; };
    }, [phase, seriesId]);

    // Confirmar sem o número é o problema que este preview corrige: trava enquanto carrega.
    // NÃO trava quando `wouldCancel === 0` — diferente da edição em massa, cancelar a série
    // sempre tem efeito válido (marca `job_series.status='stopped'`, impedindo novas
    // ocorrências) mesmo quando não sobra nenhum turno futuro tocável para excluir.
    const confirmDisabled = loading || previewLoading;

    const handleConfirm = async () => {
        setLoading(true);
        try {
            const result_ = await JobSeriesService.stopSeries(seriesId, todayLocalDate());
            if (result_.error) {
                logError('CancelSeriesModal.handleConfirm', result_.error);
                addToast(result_.error, 'error');
                setLoading(false);
                return;
            }
            setResult({ cancelled: result_.cancelled, skippedFilled: result_.skippedFilled, skippedCalled: result_.skippedCalled });
            setPhase('result');
            onCancelled();
        } catch (error) {
            logError('CancelSeriesModal.handleConfirm', error);
            addToast('Não foi possível cancelar a série. Tente novamente.', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="cancel-series-title"
                className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-md p-5 sm:p-6"
            >
                <div className="flex items-center justify-between mb-4">
                    <h2 id="cancel-series-title" className="text-lg font-bold tracking-tight">Cancelar a série</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Fechar"
                        className="h-11 w-11 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
                    >
                        <X size={20} />
                    </button>
                </div>

                {phase === 'confirm' && (
                    <div className="space-y-4">
                        <div className="flex items-start gap-3 p-4 rounded-xl border-2 border-red-300 bg-red-50">
                            <AlertTriangle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
                            <div className="text-sm font-bold text-red-800">
                                <p>A série para de gerar novos turnos e, a partir de hoje, as ocorrências futuras <strong>sem
                                    freela confirmado e sem chamado aberto</strong> são excluídas.</p>
                                <p className="mt-2">Ocorrências com freela confirmado continuam na agenda — dispense o freela
                                    manualmente se também quiser cancelar aquelas.</p>

                                {/* Prévia (dry-run): a conta real, antes de confirmar — não mais só a regra em prosa. */}
                                {previewLoading && (
                                    <p className="mt-3 flex items-center gap-2">
                                        <Loader2 className="animate-spin" size={14} /> Calculando quantos turnos serão afetados...
                                    </p>
                                )}
                                {!previewLoading && preview && preview.wouldCancel === 0 && (
                                    <p className="mt-3">
                                        {(preview.skippedFilled > 0 || preview.skippedCalled > 0)
                                            ? 'Nenhum turno será cancelado (todos já têm freela ou chamado aberto), mas a série será encerrada e não gerará novas ocorrências.'
                                            : 'Não há ocorrências futuras para cancelar, mas a série será encerrada e não gerará novas ocorrências.'}
                                    </p>
                                )}
                                {!previewLoading && preview && preview.wouldCancel > 0 && (
                                    <p className="mt-3">{describeSeriesPreview(preview.wouldCancel, 'serão cancelados', 'será cancelado', preview)}</p>
                                )}
                                {!previewLoading && previewError && (
                                    <p className="mt-3">Não foi possível calcular a prévia exata agora — a confirmação abaixo ainda respeita as mesmas regras.</p>
                                )}
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <Button variant="secondary" onClick={onClose} disabled={loading} className="flex-1">
                                Voltar
                            </Button>
                            <Button
                                variant="danger"
                                onClick={handleConfirm}
                                disabled={confirmDisabled}
                                loading={loading}
                                className="flex-1"
                            >
                                {loading ? 'Cancelando...' : 'Cancelar a série'}
                            </Button>
                        </div>
                    </div>
                )}

                {phase === 'result' && result && (
                    <div className="space-y-4">
                        <div className="flex items-start gap-3 p-4 rounded-xl border-2 border-primary bg-primary-light">
                            <CheckCircle2 size={20} className="text-primary flex-shrink-0 mt-0.5" />
                            <p className="text-sm font-bold text-primary-dark">
                                {result.cancelled} turno{result.cancelled !== 1 ? 's' : ''} cancelado{result.cancelled !== 1 ? 's' : ''}.
                                A série não vai gerar mais turnos novos.
                            </p>
                        </div>
                        {(result.skippedFilled > 0 || result.skippedCalled > 0) && (
                            <div className="p-4 rounded-xl border-2 border-gray-200 bg-gray-50 space-y-1 text-sm font-bold text-gray-600">
                                {result.skippedFilled > 0 && (
                                    <p>{result.skippedFilled} turno{result.skippedFilled !== 1 ? 's' : ''} com freela confirmado {result.skippedFilled !== 1 ? 'não foram cancelados' : 'não foi cancelado'} — dispense manualmente se necessário.</p>
                                )}
                                {result.skippedCalled > 0 && (
                                    <p>{result.skippedCalled} turno{result.skippedCalled !== 1 ? 's' : ''} com chamado aberto {result.skippedCalled !== 1 ? 'não foram cancelados' : 'não foi cancelado'} — cancele o chamado primeiro.</p>
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
