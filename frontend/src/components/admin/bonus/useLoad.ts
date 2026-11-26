import { useCallback, useEffect, useState } from 'react';
import { logError } from '../../../lib/logger';

export interface LoadState<T> {
    data: T | null;
    loading: boolean;
    error: string;
    reload: () => Promise<void>;
}

export function useLoad<T>(fetcher: () => Promise<T>, context: string): LoadState<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const reload = useCallback(async () => {
        setError('');
        try {
            setData(await fetcher());
        } catch (err) {
            logError(context, err);
            setError('Não foi possível carregar. Tente atualizar.');
        }
        setLoading(false);
    }, [fetcher, context]);

    useEffect(() => {
        let active = true;
        fetcher()
            .then((d) => { if (active) { setData(d); setLoading(false); } })
            .catch((err) => {
                logError(context, err);
                if (active) { setError('Não foi possível carregar. Tente atualizar.'); setLoading(false); }
            });
        return () => { active = false; };
    }, [fetcher, context]);

    return { data, loading, error, reload };
}
