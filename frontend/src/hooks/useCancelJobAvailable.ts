import { useEffect, useState } from 'react';
import { isCancelJobAvailable } from '../services/shiftOperationService';

/** `true` só depois de confirmar que a RPC existe: sem "flash" de um botão que sempre falharia. */
export function useCancelJobAvailable(enabled: boolean): boolean {
    const [available, setAvailable] = useState(false);

    useEffect(() => {
        if (!enabled) return;
        let active = true;
        void isCancelJobAvailable().then((ok) => {
            if (active) setAvailable(ok);
        });
        return () => { active = false; };
    }, [enabled]);

    return enabled && available;
}
