import { parseDateOnly, formatDateOnly } from '../../lib/dateUtils';

/**
 * Limite (número de turnos na MESMA semana corrida dom-sáb) a partir do qual o aviso não-
 * bloqueante de R10/A7 aparece no `InviteSeriesModal`. Constante NOMEADA e ÚNICA — nunca `2`
 * literal espalhado pelo JSX. F5 (guarda de vínculo, `.harness/spec/guarda-vinculo/spec.md`)
 * troca este valor fixo por configuração por empresa (`companies.link_risk_alert_threshold`);
 * até lá, este é o único ponto a editar.
 */
export const DEFAULT_LINK_RISK_THRESHOLD = 2;

export interface InviteSeriesTarget {
    jobId: string;
    /** `series_occurrence_date` (YYYY-MM-DD) — usada para agrupar por semana corrida local. */
    occurrenceDate: string;
}

export interface WeekRisk {
    weekStart: string;
    count: number;
}

/**
 * Vive em módulo PRÓPRIO (não dentro de `InviteSeriesModal.tsx`) por dois motivos: exportar
 * função/constante de um arquivo de componente dispara `react-refresh/only-export-components`
 * do ESLint (mesmo caso de `shiftCategories.ts`), e isolar a aritmética de semana permite
 * testá-la sem montar o componente — é a única lógica de data NOVA desta feature, e é
 * exatamente a classe de bug (semana corrida em UTC em vez de local) que o resto da feature
 * (`lib/recurrence.ts`, `lib/dateUtils.ts`) toma cuidado de evitar.
 */

/** Chave da semana corrida (domingo-sábado) em data LOCAL — nunca `getUTCDay()`. */
export function localWeekStartKey(dateStr: string): string {
    const d = parseDateOnly(dateStr);
    const sunday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
    const yyyy = sunday.getFullYear();
    const mm = String(sunday.getMonth() + 1).padStart(2, '0');
    const dd = String(sunday.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * R10/A7 — sinalização (não-bloqueante) de "mais de N turnos na mesma semana para o mesmo
 * freela": agrupa as ocorrências-alvo por semana corrida local e devolve as semanas que
 * ultrapassam o limite. Independe de QUAL freela é escolhido na lista — o disparo em lote vai
 * para o mesmo conjunto de turnos não importa quem receba o convite, então o aviso é calculado
 * uma vez, antes de qualquer seleção.
 */
export function weeksOverThreshold(targets: InviteSeriesTarget[], threshold: number): WeekRisk[] {
    const counts = new Map<string, number>();
    targets.forEach((t) => {
        const key = localWeekStartKey(t.occurrenceDate);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from(counts.entries())
        .filter(([, count]) => count > threshold)
        .map(([weekStart, count]) => ({ weekStart, count }))
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export function weekRangeLabel(weekStart: string): string {
    const start = parseDateOnly(weekStart);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    return `${formatDateOnly(weekStart, 'dd/MM')} a ${formatDateOnly(endStr, 'dd/MM')}`;
}
