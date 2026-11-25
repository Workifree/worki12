
import { useState } from 'react';
import { Star, X } from 'lucide-react';
import { logError } from '../lib/logger'
import { Button, Field } from './ui'
import { Dialog } from './ui/Dialog'

interface RateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (rating: number, comment: string) => Promise<void>;
    targetName: string;
    targetPhotoUrl?: string;
    title: string; // e.g. "Avaliar Empresa"
    subtitle?: string; // e.g. Job Title
}

export default function RateModal({ isOpen, onClose, onSubmit, targetName, targetPhotoUrl, title, subtitle }: RateModalProps) {
    // Nota nasce VAZIA, nao 5: com default pre-marcado dava para "avaliar" sem tocar em
    // estrela — 5 gravado por inercia. Avaliacao e input de julgamento: default opinativo
    // infla a nota e corroi a prova social que o produto vende (reputation inflation;
    // NN/g sobre o poder dos defaults). Enviar so habilita depois de uma escolha explicita.
    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState('');
    const [submitting, setSubmitting] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async () => {
        setSubmitting(true);
        try {
            await onSubmit(rating, comment);
            setRating(0);
            setComment('');
            onClose();
        } catch (error) {
            logError('Erro inesperado', error);
        } finally {
            setSubmitting(false);
        }
    };


    return (
        <Dialog
            labelledBy="rate-modal-title"
            onClose={onClose}
            locked={submitting}
            initialFocus="panel"
        >
                <div className="flex justify-between items-center gap-3 mb-6">
                    <h3 id="rate-modal-title" className="text-xl font-bold tracking-tight">{title}</h3>
                    <Button
                        variant="ghost"
                        onClick={onClose}
                        aria-label="Fechar"
                        className="w-11 !px-0 shrink-0"
                    >
                        <X size={20} />
                    </Button>
                </div>

                <div className="flex flex-col items-center text-center mb-6">
                    <div className="w-20 h-20 rounded-full bg-gray-200 border-2 border-black overflow-hidden mb-3">
                        {targetPhotoUrl ? (
                            <img src={targetPhotoUrl} alt={targetName} className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center bg-black text-white font-bold text-2xl">
                                {targetName?.[0]}
                            </div>
                        )}
                    </div>
                    <h4 className="font-bold text-lg">{targetName}</h4>
                    {subtitle && <p className="text-sm text-gray-600">{subtitle}</p>}
                </div>

                <div className="flex justify-center gap-1 mb-6">
                    {[1, 2, 3, 4, 5].map((star) => (
                        <button
                            key={star}
                            type="button"
                            onClick={() => setRating(star)}
                            aria-pressed={rating === star}
                            aria-label={`${star} estrela${star > 1 ? 's' : ''}`}
                            data-autofocus={star === 1 || undefined}
                            className="flex h-11 w-11 items-center justify-center rounded-xl transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                        >
                            <Star
                                size={32}
                                fill={star <= rating ? "#fbbf24" : "none"}
                                className={star <= rating ? "text-yellow-500" : "text-gray-300"}
                                strokeWidth={2}
                            />
                        </button>
                    ))}
                </div>

                <Field label="Comentário (opcional)" className="mb-6">
                    <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Como foi a experiência?"
                        className="!h-24 py-3 resize-none"
                    />
                </Field>

                <div className="worki-dialog-actions">
                <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    onClick={handleSubmit}
                    loading={submitting}
                    disabled={rating === 0}
                >
                    {submitting ? 'Enviando...' : rating === 0 ? 'Toque nas estrelas para avaliar' : 'Enviar avaliação'}
                </Button>
                </div>
        </Dialog>
    );
}
