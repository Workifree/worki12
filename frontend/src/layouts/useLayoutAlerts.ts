import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useLiveAlerts } from '../hooks/useLiveAlerts';

/**
 * Toast "Fulano aceitou o turno X" (as mesmas linhas do sino). Montar só nos layouts. Fica de fora o
 * que a pessoa já está vendo: a tela de notificações, mensagens abertas e o convite de turno, que
 * já aparece em tela cheia (`InviteTakeover`).
 */
export function useLayoutAlerts(): void {
    const { user } = useAuth();
    const { addToast } = useToast();
    const { pathname } = useLocation();
    useLiveAlerts(user?.id, addToast, (n) =>
        pathname.endsWith('/notifications')
        || (n.type === 'message' && pathname.endsWith('/messages'))
        || n.title === 'Novo convite de turno');
}
