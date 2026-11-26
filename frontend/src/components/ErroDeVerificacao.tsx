import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import ErroDeCarga from './ErroDeCarga';
import PageMeta from './PageMeta';
import { Button } from './ui';

/** Não deu para verificar o acesso (rede/servidor): só tentar de novo ou sair. */
export default function ErroDeVerificacao({ onRetry }: { onRetry: () => void }) {
    const sair = async () => {
        try {
            await supabase.auth.signOut();
        } catch (error) {
            logError('ErroDeVerificacao.sair', error);
        }
        window.location.assign('/');
    };

    return (
        <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
            <PageMeta title="Sem conexão" noindex />
            <div className="w-full max-w-md space-y-3">
                <ErroDeCarga
                    onRetry={onRetry}
                    mensagem="Sem conexão ou não foi possível verificar seu acesso agora. Nada foi alterado. Verifique sua internet e tente de novo."
                />
                <Button variant="ghost" fullWidth onClick={() => { void sair(); }}>Sair</Button>
            </div>
        </div>
    );
}
