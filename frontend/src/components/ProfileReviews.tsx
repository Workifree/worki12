import { useEffect, useState } from 'react';
import { Star, MessageSquareQuote } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { logError } from '../lib/logger';

interface ReviewRow {
    id: string;
    rating: number;
    comment: string | null;
    created_at: string;
    reviewer_id: string;
    reviewer_name: string;
}

/**
 * Lista as avaliações RECEBIDAS por um perfil (com estrelas + comentário).
 * `reviewerRole` = quem ESCREVEU a avaliação (define de qual tabela buscar o nome
 * e qual `direction` filtrar):
 *   - reviewerRole='company' → avaliações de EMPRESAS sobre um FREELA (direction='worker')
 *   - reviewerRole='worker'  → avaliações de FREELAS sobre uma EMPRESA (direction='company')
 */
export default function ProfileReviews({
    reviewedId,
    reviewerRole,
}: {
    reviewedId: string;
    reviewerRole: 'company' | 'worker';
}) {
    const [reviews, setReviews] = useState<ReviewRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        const direction = reviewerRole === 'company' ? 'worker' : 'company';
        const table = reviewerRole === 'company' ? 'companies' : 'workers';
        const nameField = reviewerRole === 'company' ? 'name' : 'full_name';

        void (async () => {
            if (!reviewedId) { setLoading(false); return; }
            setLoading(true);
            try {
                const { data, error } = await supabase
                    .from('reviews')
                    .select('id, rating, comment, created_at, reviewer_id')
                    .eq('reviewed_id', reviewedId)
                    .eq('direction', direction)
                    .order('created_at', { ascending: false });
                if (error) throw error;

                const rows = (data ?? []) as Omit<ReviewRow, 'reviewer_name'>[];
                const reviewerIds = [...new Set(rows.map(r => r.reviewer_id).filter(Boolean))];
                const nameMap = new Map<string, string>();
                if (reviewerIds.length > 0) {
                    const { data: names } = await supabase
                        .from(table)
                        .select(`id, ${nameField}`)
                        .in('id', reviewerIds);
                    (names ?? []).forEach((n: Record<string, unknown>) => {
                        nameMap.set(n.id as string, (n[nameField] as string) || '');
                    });
                }

                if (!active) return;
                setReviews(rows.map(r => ({
                    ...r,
                    reviewer_name: nameMap.get(r.reviewer_id) || (reviewerRole === 'company' ? 'Empresa' : 'Freela'),
                })));
            } catch (error) {
                logError('ProfileReviews', error);
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, [reviewedId, reviewerRole]);

    return (
        <div className="mt-8 bg-white border-2 border-black rounded-2xl p-6 sm:p-8 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
            <h3 className="text-xl font-black uppercase mb-4 flex items-center gap-2">
                <MessageSquareQuote size={20} /> Avaliações sobre {reviewerRole === 'company' ? 'você' : 'sua empresa'}
            </h3>

            {loading ? (
                <div className="space-y-3 animate-pulse">
                    {[...Array(2)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
                </div>
            ) : reviews.length === 0 ? (
                <p className="text-sm font-bold text-gray-400 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-4 text-center">
                    Ainda sem avaliações. Elas aparecem aqui após turnos concluídos.
                </p>
            ) : (
                <div className="space-y-3">
                    {reviews.map((r) => (
                        <div key={r.id} className="border-2 border-gray-100 rounded-xl p-4">
                            <div className="flex items-center justify-between gap-3 mb-1">
                                <span className="font-black uppercase text-sm truncate">{r.reviewer_name}</span>
                                <div className="flex items-center gap-0.5 flex-shrink-0">
                                    {[1, 2, 3, 4, 5].map((s) => (
                                        <Star
                                            key={s}
                                            size={14}
                                            className={s <= r.rating ? 'text-yellow-500 fill-yellow-500' : 'text-gray-300'}
                                        />
                                    ))}
                                </div>
                            </div>
                            {r.comment ? (
                                <p className="text-sm text-gray-600 font-medium italic">"{r.comment}"</p>
                            ) : (
                                <p className="text-xs text-gray-400 font-bold">Sem comentário.</p>
                            )}
                            <p className="text-[10px] text-gray-400 font-bold uppercase mt-2">
                                {formatDistanceToNow(new Date(r.created_at), { addSuffix: true, locale: ptBR })}
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
