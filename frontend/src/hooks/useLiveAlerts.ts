import { useCallback, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { createAlertTracker } from '../lib/realtime/liveAlerts';
import type { AlertRow } from '../lib/realtime/liveAlerts';
import { notificationSources } from '../lib/realtime/liveSources';
import { useLiveRefresh } from './useLiveRefresh';

/**
 * Toast "Fulano aceitou o turno X" na hora, também quando o websocket cai (polling). Montar UMA vez
 * por sessão (nos layouts). Não marca nada como lido e não mexe no sino.
 */
export function useLiveAlerts(
    userId: string | null | undefined,
    addToast: (message: string, type?: 'success' | 'info') => void,
    skip?: (row: AlertRow) => boolean,
) {
    const tracker = useMemo(() => ({ userId, ...createAlertTracker() }), [userId]);
    const latest = useRef({ addToast, skip });
    useEffect(() => {
        latest.current = { addToast, skip };
    });

    const check = useCallback(async (isCurrent: () => boolean) => {
        if (!tracker.userId) return;
        const { data, error } = await supabase
            .from('notifications')
            .select('id, type, title, message, link, read_at, created_at')
            .eq('user_id', tracker.userId)
            .order('created_at', { ascending: false })
            .limit(20);
        if (error) {
            logError('useLiveAlerts', error);
            return;
        }
        if (!isCurrent()) return;
        for (const toast of tracker.collect((data ?? []) as AlertRow[], latest.current.skip)) {
            latest.current.addToast(toast.message, toast.type);
        }
    }, [tracker]);

    useEffect(() => {
        let active = true;
        void check(() => active); // linha de base
        return () => { active = false; };
    }, [check]);

    return useLiveRefresh({
        sources: userId ? notificationSources(userId) : [],
        onRefresh: (ctx) => check(ctx.isCurrent),
        debounceMs: 300,
    });
}
