import { invalidateCompanyScope } from '../services/companyScopeService';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import ErroDeCarga from './ErroDeCarga';
import PageMeta from './PageMeta';
import { Button } from './ui';

/**
 * A consulta da empresa falhou (rede/servidor). Não sabemos se a conta tem empresa, então NÃO
 * mandamos para o onboarding (que gravaria por cima de uma empresa existente): só tentar de novo
 * ou sair.
 */
export default function ErroDeEmpresa() {
    const tentarDeNovo = () => {
        invalidateCompanyScope();
        window.location.reload();
    };

    const sair = async () => {
        try {
            await supabase.auth.signOut();
        } catch (error) {
            logError('ErroDeEmpresa.sair', error);
        }
        window.location.assign('/');
    };

    return (
        <div className="min-h-screen bg-[#F4F4F0] flex items-center justify-center p-4">
            <PageMeta title="Sem conexão" noindex />
            <div className="w-full max-w-md space-y-3">
                <ErroDeCarga
                    onRetry={tentarDeNovo}
                    mensagem="Não conseguimos confirmar os dados da sua empresa agora. Nada foi alterado. Verifique sua conexão e tente de novo."
                />
                <Button variant="ghost" fullWidth onClick={() => { void sair(); }}>Sair</Button>
            </div>
        </div>
    );
}
