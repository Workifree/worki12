/** Agrupamento por lote nas listas de turnos (R1.5). Puro; sem lote, a lista sai como entrou. */
import { formatDateOnly } from '../../lib/jobScheduling';
import { toBrazilDateOnly } from '../../lib/dateUtils';

export interface BatchInfo {
    creation_batch_id?: string | null;
    created_at?: string | null;
    slots?: number | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Rótulo por lote com 2 turnos ou mais; N e M contam todos os turnos carregados do lote. */
export function batchLabels(jobs: BatchInfo[]): Map<string, string> {
    const totals = new Map<string, { count: number; slots: number; createdAt: string | null }>();
    for (const job of jobs) {
        const id = job.creation_batch_id;
        if (!id) continue;
        const current = totals.get(id) ?? { count: 0, slots: 0, createdAt: null };
        const createdAt = job.created_at ?? null;
        totals.set(id, {
            count: current.count + 1,
            slots: current.slots + (job.slots ?? 1),
            createdAt: current.createdAt ?? createdAt,
        });
    }
    const labels = new Map<string, string>();
    totals.forEach(({ count, slots, createdAt }, id) => {
        if (count < 2) return;
        const when = createdAt ? ` de ${formatDateOnly(toBrazilDateOnly(createdAt), 'dd/MM')}` : '';
        labels.set(id, `Lote${when} · ${count} turnos · ${plural(slots, 'vaga', 'vagas')}`);
    });
    return labels;
}

export interface BatchCluster<T> {
    key: string;
    label: string | null;
    items: T[];
}

/** Junta os itens do mesmo lote na posição do primeiro; os demais seguem na ordem original. */
export function clusterByBatch<T>(
    items: T[], batchOf: (item: T) => string | null | undefined, labels: Map<string, string>,
): BatchCluster<T>[] {
    const clusters: BatchCluster<T>[] = [];
    const byBatch = new Map<string, BatchCluster<T>>();
    items.forEach((item, index) => {
        const id = batchOf(item);
        const label = id ? labels.get(id) : undefined;
        if (id && label) {
            const existing = byBatch.get(id);
            if (existing) { existing.items.push(item); return; }
            const created = { key: id, label, items: [item] };
            byBatch.set(id, created);
            clusters.push(created);
            return;
        }
        const last = clusters[clusters.length - 1];
        if (last && last.label === null) last.items.push(item);
        else clusters.push({ key: `solto-${index}`, label: null, items: [item] });
    });
    return clusters;
}
