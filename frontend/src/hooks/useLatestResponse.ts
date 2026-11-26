import { useCallback, useRef } from 'react';

/**
 * Respostas fora de ordem: cada carga pega uma senha ao começar e a usa na hora de aplicar.
 * `claim()` devolve `false` quando uma carga MAIS NOVA já aplicou o resultado dela. Carga mais nova
 * que falha (e por isso não chama `claim`) não descarta a anterior que deu certo.
 */
export function useLatestResponse(): () => () => boolean {
    const order = useRef({ started: 0, applied: 0 });
    return useCallback(() => {
        const ticket = ++order.current.started;
        return () => {
            if (ticket < order.current.applied) return false;
            order.current.applied = ticket;
            return true;
        };
    }, []);
}
