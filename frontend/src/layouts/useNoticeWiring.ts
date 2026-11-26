import { useEffect } from 'react';
import { isAvisosEnabled } from '../lib/features';
import { syncPushSubscription, watchNoticeOpens } from '../services/pushService';

/** Renova a inscrição de push já autorizada e registra avisos abertos. Não pede permissão. */
export function useNoticeWiring(): void {
    useEffect(() => {
        if (!isAvisosEnabled()) return;
        void syncPushSubscription();
        return watchNoticeOpens();
    }, []);
}
