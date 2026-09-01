
import { useState, useEffect } from 'react';
import { useModalDismiss } from '../hooks/useModalDismiss';
import { Star, XCircle, Loader2 } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { logError } from '../lib/logger'

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
    // Hooks primeiro, SEMPRE — ha early-returns abaixo (rules-of-hooks).
    const fecharPeloFundo = useModalDismiss(onClose);
    const [rating, setRating] = useState(5);
    const [comment, setComment] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const trapRef = useFocusTrap(isOpen);

    useEffect(() => {
        if (isOpen) {
            const firstStar = trapRef.current?.querySelector<HTMLButtonElement>('.star-btn');
            firstStar?.focus();
        }
    }, [isOpen, trapRef]);

    if (!isOpen) return null;

    const handleSubmit = async () => {
        setSubmitting(true);
        try {
            await onSubmit(rating, comment);
            setRating(5);
            setComment('');
            onClose();
        } catch (error) {
            logError('Erro inesperado', error);
        } finally {
            setSubmitting(false);
        }
    };


    return (
        <div
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={fecharPeloFundo}
        >
            <div
                ref={trapRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="rate-modal-title"
                className="bg-white rounded-2xl w-full max-w-md p-6 border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
            >
                <div className="flex justify-between items-center mb-6">
                    <h3 id="rate-modal-title" className="text-2xl font-black uppercase tracking-tight">{title}</h3>
                    <button onClick={onClose} aria-label="Fechar" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <XCircle size={24} />
                    </button>
                </div>

                <div className="flex flex-col items-center mb-6">
                    <div className="w-20 h-20 rounded-full bg-gray-200 border-2 border-black overflow-hidden mb-3">
                        {targetPhotoUrl ? (
                            <img src={targetPhotoUrl} alt={targetName} className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center bg-black text-white font-black text-2xl">
                                {targetName?.[0]}
                            </div>
                        )}
                    </div>
                    <h4 className="font-bold text-lg">{targetName}</h4>
                    {subtitle && <p className="text-sm text-gray-500 font-bold uppercase">{subtitle}</p>}
                </div>

                <div className="flex justify-center gap-2 mb-6">
                    {[1, 2, 3, 4, 5].map((star) => (
                        <button
                            key={star}
                            onClick={() => setRating(star)}
                            aria-label={`${star} estrela${star > 1 ? 's' : ''}`}
                            className="star-btn transform hover:scale-110 transition-transform"
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

                <div className="mb-6">
                    <label className="block text-sm font-bold uppercase mb-2">Comentário (Opcional)</label>
                    <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        aria-label="Comentário"
                        placeholder="Como foi a experiência?"
                        className="w-full border-2 border-gray-200 rounded-xl p-3 focus:outline-none focus:border-black transition-colors font-medium h-24 resize-none"
                    />
                </div>

                <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="w-full bg-black text-white py-4 rounded-xl font-black uppercase tracking-wide hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
                >
                    {submitting ? <Loader2 className="animate-spin" /> : null}
                    {submitting ? 'Enviando...' : 'Enviar Avaliação'}
                </button>
            </div>
        </div>
    );
}
