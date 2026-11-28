import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { useToast } from '../contexts/ToastContext';
import { Button } from './ui';
import { Dialog } from './ui/Dialog';
import { MODAL_LAYER } from '../hooks/useModalDismiss';
import { getAuthenticatedCompanyId } from '../services/companyScopeService';
import { checkSession } from '../lib/authSession';

interface TosGateModalProps {
    userRole: 'worker' | 'company';
    onAccepted: () => void;
}

export default function TosGateModal({ userRole, onAccepted }: TosGateModalProps) {
    const [checked, setChecked] = useState(false);
    const [loading, setLoading] = useState(false);
    const { addToast } = useToast();

    // Quem não concorda não pode ficar preso no gate.
    const sair = async () => {
        try {
            await supabase.auth.signOut();
        } catch (err) {
            logError('TosGateModal.sair', err);
        }
        window.location.assign('/');
    };

    const handleAccept = async () => {
        if (!checked || loading) return;

        setLoading(true);

        const session = await checkSession();
        if (session.status !== 'ok') {
            addToast(
                session.status === 'signed_out'
                    ? 'Sessão expirada. Faça login novamente.'
                    : 'Sem conexão. Verifique sua internet e tente de novo.',
                'error',
            );
            setLoading(false);
            return;
        }
        const user = session.user;

        // Empresa: o aceite grava na linha da empresa OPERADA pela sessão (seam), não em `user.id`
        // — gerente não é a linha de `companies`. (Encarregado aceita os Termos no convite,
        // por pessoa, em `company_members.accepted_tos_at`; o gate nem o alcança.)
        let alvoId = user.id;
        if (userRole === 'company') {
            try {
                alvoId = await getAuthenticatedCompanyId();
            } catch {
                addToast('Não foi possível identificar a empresa. Tente novamente.', 'error');
                setLoading(false);
                return;
            }
        }

        const table = userRole === 'worker' ? 'workers' : 'companies';
        const { data, error } = await supabase
            .from(table)
            .update({
                accepted_tos: true,
                tos_version: 'v1',
                tos_accepted_at: new Date().toISOString()
            })
            .eq('id', alvoId)
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
        // Gate: sem Esc nem toque no fundo; o <dialog> modal deixa a página atrás inerte.
        <Dialog
            labelledBy="tos-gate-title"
            onClose={() => {}}
            dismissable={false}
            layer={MODAL_LAYER.gate}
            initialFocus="panel"
            overlayClassName="!bg-black/80"
            className="max-w-lg sm:!p-8"
        >
                <h2 id="tos-gate-title" className="text-2xl font-bold tracking-tight mb-3">Termos de Uso Atualizados</h2>

                <p className="text-sm sm:text-base text-gray-700 mb-3 leading-relaxed">
                    Para continuar usando a Workyn, você precisa aceitar nossos Termos de Uso. Eles definem suas responsabilidades e direitos na plataforma.
                </p>

                <a
                    href="/termos"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 items-center text-primary underline font-bold"
                >
                    Ler os Termos de Uso
                </a>
                <a
                    href="/privacidade"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 items-center text-primary underline font-bold"
                >
                    Ler a Política de Privacidade
                </a>

                <div className="flex items-center gap-3 mt-4 mb-6">
                    <input
                        type="checkbox"
                        id="tos-checkbox"
                        className="w-5 h-5 border-2 border-black rounded accent-primary flex-shrink-0"
                        checked={checked}
                        onChange={(e) => setChecked(e.target.checked)}
                    />
                    <label htmlFor="tos-checkbox" className="flex min-h-11 items-center text-sm text-gray-800 cursor-pointer">
                        Li e aceito os Termos de Uso e a Política de Privacidade
                    </label>
                </div>

                <Button
                    size="lg"
                    fullWidth
                    onClick={handleAccept}
                    disabled={!checked}
                    loading={loading}
                    data-copilot="publico.termos.aceitar"
                >
                    {loading ? 'Salvando...' : 'Aceitar e Continuar'}
                </Button>
                <Button variant="ghost" fullWidth className="mt-2" onClick={() => void sair()}>
                    Agora não, sair da conta
                </Button>
        </Dialog>
    );
}
