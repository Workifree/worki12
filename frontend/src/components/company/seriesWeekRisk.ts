import { parseDateOnly, formatDateOnly } from '../../lib/dateUtils';

/**
 * FALLBACK (não mais "o limite") do aviso não-bloqueante de R10/A7 no `InviteSeriesModal` e do
 * selo de F5 (guarda de vínculo, `.harness/spec/guarda-vinculo/ddl-aprovado.md`) no
 * `ShiftCallModal`. Desde F5, o limite REAL é configurável por empresa
 * (`companies.link_risk_alert_threshold`, lido via `LinkRiskService.getConfig()` /
 * `my_link_risk_config()`); esta constante só entra em jogo quando aquela config ainda não
 * respondeu (RPC não resolvida) ou a coluna ainda não existe no banco (deploy adiantado — ver
 * LM-5 em `ddl-aprovado.md`). Seu valor tem de continuar igual ao `DEFAULT` da coluna no banco —
 * a coluna já carrega esse acoplamento no `COMMENT` da migration
 * `20260817000900_link_risk_guard.sql`. Nunca `2` literal espalhado pelo JSX — sempre esta
 * constante.
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
 * ultrapassam o limite.
 *
 * Refactor F5 (unificação com a guarda de vínculo, `ddl-aprovado.md` §3): esta função contava SÓ
 * as ocorrências da própria série, worker-independente — metade do número que a empresa
 * precisa ver, porque ignorava a carga preexistente do freela (turnos avulsos, outras séries,
 * chamados já aceitos). Agora recebe `existingByWeek` — a contagem preexistente DAQUELE freela
 * por semana (chave = `localWeekStartKey`), tipicamente vinda de
 * `LinkRiskService.countForRange()` — e soma às ocorrências-alvo antes de comparar com o
 * limite. Por isso passou a ser calculada POR FREELA (depois da seleção), não mais uma vez antes
 * de qualquer seleção: cada freela do elenco tem sua própria carga preexistente.
 */
export function weeksOverThreshold(
    targets: InviteSeriesTarget[],
    threshold: number,
    existingByWeek: Map<string, number>,
): WeekRisk[] {
    const counts = new Map<string, number>();
    targets.forEach((t) => {
        const key = localWeekStartKey(t.occurrenceDate);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from(counts.entries())
        .map(([weekStart, count]) => ({ weekStart, count: count + (existingByWeek.get(weekStart) ?? 0) }))
        .filter(({ count }) => count > threshold)
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export function weekRangeLabel(weekStart: string): string {
    const start = parseDateOnly(weekStart);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    return `${formatDateOnly(weekStart, 'dd/MM')} a ${formatDateOnly(endStr, 'dd/MM')}`;
}
