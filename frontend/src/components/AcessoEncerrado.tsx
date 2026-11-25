import { clearJobDrafts } from '../lib/jobDraft';
import { useEffect, useRef, useState } from 'react';
import { DoorClosed, LogOut, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { invalidateCompanyScope } from '../services/companyScopeService';
import { clearAllTeamMemberHints } from '../lib/teamInviteToken';
import PageMeta from './PageMeta';
import { Button, Card } from './ui';

/**
 * Tela neutra para quem era da equipe de uma empresa e ficou sem nenhuma (acesso encerrado:
 * pessoa removida, convite revogado, "não é essa pessoa"). Sem culpa e SEM onboarding de CNPJ —
 * a pessoa nunca teve empresa própria. O caminho de saída é sair da conta (e, se for engano, pedir
 * um novo convite ao Gestor).
 */
export default function AcessoEncerrado() {
    const [saindo, setSaindo] = useState(false);
    const tituloRef = useRef<HTMLHeadingElement>(null);

    useEffect(() => {
        tituloRef.current?.focus();
    }, []);

    const verificarDeNovo = () => {
        invalidateCompanyScope();
        window.location.reload();
    };

    const sair = async () => {
        setSaindo(true);
        try {
            await supabase.auth.signOut();
        } catch (error) {
            logError('AcessoEncerrado.sair', error);
        }
        clearAllTeamMemberHints();
        clearJobDrafts();
        window.location.assign('/');
    };

    return (
        <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
            <PageMeta title="Acesso encerrado" noindex />
            <div className="w-full max-w-md">
                <Card padding="lg" className="text-center shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                    <div role="status">
                        <div className="w-16 h-16 border-2 border-black rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-5">
                            <DoorClosed size={30} aria-hidden="true" />
                        </div>
                        <h1
                            ref={tituloRef}
                            tabIndex={-1}
                            className="text-2xl font-black tracking-tight mb-3 focus:outline-none"
                        >
                            Seu acesso a essa empresa foi encerrado
                        </h1>
                        <p className="text-base text-gray-700 mb-2">
                            Isso acontece quando a equipe muda ou um convite é cancelado. Não é nada que você
                            tenha feito.
                        </p>
                        <p className="text-sm text-gray-600 mb-6">
                            Se precisar voltar, peça um novo convite ao Gestor da empresa.
                        </p>
                    </div>
                    <div className="space-y-3">
                        <Button
                            variant="dark"
                            size="lg"
                            fullWidth
                            onClick={() => void sair()}
                            loading={saindo}
                            iconLeft={<LogOut size={18} />}
                        >
                            Sair da conta
                        </Button>
                        <Button
                            variant="secondary"
                            size="lg"
                            fullWidth
                            onClick={verificarDeNovo}
                            iconLeft={<RefreshCw size={18} />}
                        >
                            Verificar de novo
                        </Button>
                    </div>
                </Card>
            </div>
        </div>
    );
}
