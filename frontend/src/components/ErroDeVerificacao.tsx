import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { isRealNetworkError } from '../lib/retry';
import ErroDeCarga from './ErroDeCarga';
import PageMeta from './PageMeta';
import { Button } from './ui';

/**
 * Não deu para verificar o acesso depois de repetir: só tentar de novo ou sair. "Sem conexão" só
 * aparece quando a falha foi de rede de verdade (ou o aparelho está offline); o resto é "não deu
 * para carregar agora".
 */
export default function ErroDeVerificacao({ onRetry, error }: { onRetry: () => void; error?: unknown }) {
    const rede = isRealNetworkError(error) || (typeof navigator !== 'undefined' && navigator.onLine === false);

    const sair = async () => {
        try {
            await supabase.auth.signOut();
        } catch (err) {
            logError('ErroDeVerificacao.sair', err);
        }
        window.location.assign('/');
    };

    return (
        <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
            <PageMeta title={rede ? 'Sem conexão' : 'Não foi possível carregar'} noindex />
            <div className="w-full max-w-md space-y-3">
                <ErroDeCarga
                    onRetry={onRetry}
                    title={rede ? 'Sem conexão' : 'Não foi possível carregar agora'}
                    mensagem={rede
                        ? 'Sem conexão com a internet. Nada foi alterado. Verifique sua rede e tente de novo.'
                        : 'Tentamos algumas vezes e não deu para verificar seu acesso agora. Nada foi alterado. Tente de novo.'}
                />
                <Button variant="ghost" fullWidth onClick={() => { void sair(); }}>Sair</Button>
            </div>
        </div>
    );
}
