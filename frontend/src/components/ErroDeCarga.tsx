import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from './ui';

/**
 * Estado de ERRO de carga — distinto do estado VAZIO.
 *
 * Por que existe (P1 recorrente da avaliação heurística do fluxo do freela):
 * quase toda tela fazia `catch { logError(...) }` e caía no empty state — "Nenhum turno",
 * "Nenhuma conversa" — quando na verdade o fetch falhou. Empty state que mente viola
 * Nielsen #1 (visibilidade do estado do sistema) e #9 (ajudar a reconhecer e se recuperar
 * de erros): o usuário conclui que não tem nada, não que a rede caiu, e não tem como
 * tentar de novo sem saber que precisa.
 */
export default function ErroDeCarga({ onRetry, mensagem }: { onRetry: () => void; mensagem?: string }) {
    return (
        <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-5 sm:p-6 text-center" role="alert">
            <AlertTriangle size={32} className="mx-auto text-red-500 mb-3" />
            <p className="text-base font-bold text-red-700 mb-1">Não conseguimos carregar</p>
            <p className="text-sm text-red-600 mb-4">
                {mensagem ?? 'Verifique sua conexão e tente de novo.'}
            </p>
            <Button variant="dark" onClick={onRetry} iconLeft={<RotateCw size={16} />}>
                Tentar de novo
            </Button>
        </div>
    );
}
