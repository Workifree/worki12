import { useEffect, useRef, useState } from 'react';
import { Hourglass, RefreshCw, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { invalidateCompanyScope } from '../services/companyScopeService';
import PageMeta from './PageMeta';
import { Button, Card } from './ui';

/**
 * Tela única do Encarregado que já entrou pelo convite mas o Gestor ainda não liberou a entrada
 * (R22). Não há navegação, menu nem dado de empresa por trás: é só esta tela. Tom neutro — a
 * pessoa não fez nada de errado; a confirmação é um passo normal do convite. A barreira real é o
 * RLS/seam no banco; isto é UX.
 */
export default function AguardandoConfirmacao() {
    const [saindo, setSaindo] = useState(false);
    const tituloRef = useRef<HTMLHeadingElement>(null);

    // Leitor de tela anuncia o estado ao abrir; teclado começa no título.
    useEffect(() => {
        tituloRef.current?.focus();
    }, []);

    const verificarDeNovo = () => {
        // Derruba o cache do seam e recarrega: se o Gestor liberou, a sessão passa a operar.
        invalidateCompanyScope();
        window.location.reload();
    };

    const sair = async () => {
        setSaindo(true);
        try {
            await supabase.auth.signOut();
        } catch (error) {
            logError('AguardandoConfirmacao.sair', error);
        }
        window.location.assign('/');
    };

    return (
        <div className="min-h-screen bg-[#F4F4F0] flex items-center justify-center p-4">
            <PageMeta title="Acesso quase pronto" noindex />
            <div className="w-full max-w-md">
                <Card padding="lg" className="text-center shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                    <div role="status">
                        <div className="w-16 h-16 border-2 border-black rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-5">
                            <Hourglass size={30} className="text-blue-600" aria-hidden="true" />
                        </div>
                        <h1
                            ref={tituloRef}
                            tabIndex={-1}
                            className="text-2xl font-black tracking-tight mb-3 focus:outline-none"
                        >
                            Seu acesso está quase pronto
                        </h1>
                        <p className="text-base text-gray-700 mb-2">
                            O Gestor precisa liberar sua entrada. É um passo normal de segurança.
                        </p>
                        <p className="text-sm text-gray-600 mb-6">
                            Assim que ele liberar, toque em &ldquo;Atualizar&rdquo;. Se demorar, avise o Gestor
                            pelo WhatsApp.
                        </p>
                    </div>
                    <div className="space-y-3">
                        <Button
                            variant="dark"
                            size="lg"
                            fullWidth
                            onClick={verificarDeNovo}
                            iconLeft={<RefreshCw size={18} />}
                        >
                            Atualizar
                        </Button>
                        <Button
                            variant="secondary"
                            size="lg"
                            fullWidth
                            onClick={() => void sair()}
                            loading={saindo}
                            iconLeft={<LogOut size={18} />}
                        >
                            Sair
                        </Button>
                    </div>
                </Card>
            </div>
        </div>
    );
}
