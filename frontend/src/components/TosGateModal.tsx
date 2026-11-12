import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { Button } from './ui';

interface TosGateModalProps {
    userRole: 'worker' | 'company';
    onAccepted: () => void;
}

export default function TosGateModal({ userRole, onAccepted }: TosGateModalProps) {
    const [checked, setChecked] = useState(false);
    const [loading, setLoading] = useState(false);
    const { addToast } = useToast();

    const handleAccept = async () => {
        if (!checked || loading) return;

        setLoading(true);

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            addToast('Sessão expirada. Faça login novamente.', 'error');
            setLoading(false);
            return;
        }

        const table = userRole === 'worker' ? 'workers' : 'companies';
        const { data, error } = await supabase
            .from(table)
            .update({
                accepted_tos: true,
                tos_version: 'v1',
                tos_accepted_at: new Date().toISOString()
            })
            .eq('id', user.id)
            .select('id');

        if (error) {
            addToast('Erro ao salvar aceite dos termos. Tente novamente.', 'error');
            setLoading(false);
            return;
        }

        // 0 linhas sem erro = RLS negou em silêncio (PostgREST 204). Aceite de termos é
        // contratual — não pode ficar em loop silencioso (aceita, gate reaparece, aceita de novo).
        if (!data || data.length === 0) {
            addToast('Não foi possível confirmar o aceite dos termos. Tente novamente ou contate o suporte.', 'error');
            setLoading(false);
            return;
        }

        addToast('Termos aceitos com sucesso. Bem-vindo!', 'success');
        onAccepted();
    };

    return (
        <div className="fixed inset-0 bg-black/80 z-[70] flex items-center justify-center p-4">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="tos-gate-title"
                className="bg-white rounded-2xl w-full max-w-lg p-6 sm:p-8 border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
            >
                <h2 id="tos-gate-title" className="text-2xl font-bold tracking-tight mb-3">Termos de Uso Atualizados</h2>

                <p className="text-sm sm:text-base text-gray-700 mb-3 leading-relaxed">
                    Para continuar usando a Worki, você precisa aceitar nossos Termos de Uso. Eles definem suas responsabilidades e direitos na plataforma.
                </p>

                <a
                    href="/termos"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline font-bold"
                >
                    Ler os Termos de Uso
                </a>

                <div className="flex items-start gap-3 mt-5 mb-6">
                    <input
                        type="checkbox"
                        id="tos-checkbox"
                        className="w-5 h-5 border-2 border-black rounded accent-primary mt-0.5 flex-shrink-0"
                        checked={checked}
                        onChange={(e) => setChecked(e.target.checked)}
                    />
                    <label htmlFor="tos-checkbox" className="text-sm text-gray-800 cursor-pointer">
                        Li e aceito os Termos de Uso e a Política de Privacidade
                    </label>
                </div>

                <Button
                    size="lg"
                    fullWidth
                    onClick={handleAccept}
                    disabled={!checked}
                    loading={loading}
                >
                    {loading ? 'Salvando...' : 'Aceitar e Continuar'}
                </Button>
            </div>
        </div>
    );
}
