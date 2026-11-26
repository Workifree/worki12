import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/logger';
import { isLoteEnabled } from '../../lib/features';
import { batchLabels, type BatchInfo } from './batchGroups';

type Row = BatchInfo & { id: string };

const NONE = new Map<string, string>();

/**
 * Lote de cada turno, para listas que vêm de RPC (sem `creation_batch_id`). Desligado, não
 * consulta nada. Falha de leitura = sem agrupamento. O rótulo conta os turnos da lista.
 */
export function useBatchLabels(jobIds: string[]) {
    const key = isLoteEnabled() ? [...jobIds].sort().join(',') : '';
    const [loaded, setLoaded] = useState<{ key: string; rows: Row[] } | null>(null);

    useEffect(() => {
        if (!key) return;
        let active = true;
        void (async () => {
            const { data, error } = await supabase
                .from('jobs').select('id, creation_batch_id, created_at, slots').in('id', key.split(','));
            if (error) logError('useBatchLabels', error);
            else if (active) setLoaded({ key, rows: (data ?? []) as Row[] });
        })();
        return () => { active = false; };
    }, [key]);

    const rows = loaded && loaded.key === key ? loaded.rows : [];
    const byId = new Map(rows.map((r) => [r.id, r.creation_batch_id ?? null]));
    return {
        labels: rows.length ? batchLabels(rows) : NONE,
        batchOf: (jobId: string) => byId.get(jobId) ?? null,
    };
}
