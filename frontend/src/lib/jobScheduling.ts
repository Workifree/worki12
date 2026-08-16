import { parseDateOnly, formatDateOnly } from './dateUtils';

// ---------------------------------------------------------------------------
// Agenda por dia (CompanyJobs) — a pergunta nº1 da operação é "quem trabalha
// amanhã?". Lógica pura de agrupamento/ordenação de turnos por dia, extraída
// da página para viver em `lib/` (testável sem montar componente, e sem
// precisar exportar de um arquivo de página com eslint-disable).
//
// `parseDateOnly`/`formatDateOnly` vivem em `lib/dateUtils.ts` (utilitário de
// data genérico — usado também por datas de pagamento em `ReceiptView`/
// `CompanyJobCandidates`, não só agenda de turnos); reexportados aqui para não
// quebrar quem já importa deste módulo (ex.: `CompanyJobs.tsx`).
// ---------------------------------------------------------------------------

export { parseDateOnly, formatDateOnly };

export type DayBucketKey = 'today' | 'tomorrow' | 'week' | 'later' | 'no_date' | 'past';

export interface DayBucket<T> {
    key: DayBucketKey;
    label: string;
    jobs: T[];
}

export const BUCKET_LABELS: Record<DayBucketKey, string> = {
    today: 'Hoje',
    tomorrow: 'Amanhã',
    week: 'Esta Semana',
    later: 'Depois',
    no_date: 'Sem Data',
    past: 'Anteriores',
};

export const BUCKET_ORDER: DayBucketKey[] = ['today', 'tomorrow', 'week', 'later', 'no_date', 'past'];

function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function bucketKeyForDate(startDate: string | null | undefined, today: Date): DayBucketKey {
    if (!startDate) return 'no_date';
    const diffDays = Math.round((parseDateOnly(startDate).getTime() - today.getTime()) / 86_400_000);
    if (diffDays < 0) return 'past';
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'tomorrow';
    if (diffDays <= 6) return 'week';
    return 'later';
}

// Agrupa turnos por dia. `referenceDate` é injetável (nunca `new Date()` direto no cálculo)
// para permitir teste determinístico do caso de virada (turno de hoje vs. amanhã).
export function groupJobsByDay<T extends { start_date?: string | null; work_start_time?: string | null }>(
    jobs: T[],
    referenceDate: Date = new Date()
): DayBucket<T>[] {
    const today = startOfDay(referenceDate);
    const buckets: Record<DayBucketKey, T[]> = { today: [], tomorrow: [], week: [], later: [], no_date: [], past: [] };

    jobs.forEach((job) => {
        buckets[bucketKeyForDate(job.start_date, today)].push(job);
    });

    const sortByDateAsc = (a: T, b: T) => {
        if (!a.start_date) return 1;
        if (!b.start_date) return -1;
        return a.start_date.localeCompare(b.start_date);
    };
    // "Hoje"/"Amanhã" têm todos o mesmo dia — a pergunta da operação é "em que horário",
    // não "quando foi criado". Turno sem horário definido cai por último (não some, só
    // perde prioridade — sem horário pra ordenar, não há como saber onde ele entra no dia).
    const sortByTimeAsc = (a: T, b: T) => {
        if (!a.work_start_time) return 1;
        if (!b.work_start_time) return -1;
        return a.work_start_time.localeCompare(b.work_start_time);
    };
    buckets.today.sort(sortByTimeAsc);
    buckets.tomorrow.sort(sortByTimeAsc);
    buckets.week.sort(sortByDateAsc);
    buckets.later.sort(sortByDateAsc);
    buckets.past.sort((a, b) => sortByDateAsc(b, a)); // mais recente primeiro — relevância decrescente

    return BUCKET_ORDER
        .map((key) => ({ key, label: BUCKET_LABELS[key], jobs: buckets[key] }))
        .filter((bucket) => bucket.jobs.length > 0);
}
