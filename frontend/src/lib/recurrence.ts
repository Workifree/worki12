/**
 * Escala Recorrente (F3) — gerador PURO de datas de ocorrência.
 *
 * Spec: `.harness/spec/escala-recorrente/spec.md` (R4, R5, R6, R7).
 * Gate: `.harness/memory-bank/decisions/ADR-20260817-serie-eager-e-cancelamento-suave.md`
 * (decisão 6 — "a data local é a fonte da verdade; start_date é derivado").
 *
 * ============================================================================
 * POR QUE FUNÇÃO PURA COM `referenceDate` INJETADA
 * ============================================================================
 * Mesmo precedente de `groupJobsByDay(jobs, referenceDate)`: a única forma de testar
 * determinística a virada de fuso (A4 da spec) é poder fixar "agora" no teste em vez de deixar
 * a função ler `new Date()` por baixo. Aqui, `referenceDate` tem um papel causal real: a função
 * nunca gera ocorrência anterior a "hoje" (LOCAL, a partir de `referenceDate`) — é a defesa
 * redundante à validação de `range_start_date >= todayLocalDate()` que a página já faz. Se a
 * "hoje" interna fosse calculada por conversão UTC crua, entre 21h e 23h59 em BRT ela avançaria
 * um dia cedo demais e empurraria a primeira ocorrência elegível para depois do esperado — o
 * mesmo bug histórico documentado em `lib/dateUtils.ts`.
 *
 * ============================================================================
 * POR QUE NUNCA `getUTCDay()`/`toISOString().split('T')[0]`
 * ============================================================================
 * `toISOString()` serializa em UTC: perto da meia-noite em BRT (UTC-3) a data "anda" um dia.
 * `getUTCDay()` tem o mesmo problema para o dia-da-semana. Toda a aritmética aqui usa
 * componentes locais (`getFullYear`/`getMonth`/`getDate`/`getDay`/`setDate`) — mesma disciplina
 * de `dateUtils.todayLocalDate`/`parseDateOnly`.
 */

export type RecurrenceType = 'weekly' | 'daily';

/**
 * Limite de ocorrências por série (R7). Uma série que geraria mais que isso é bloqueada NO
 * CLIENT antes de qualquer INSERT — quem compara `generateOccurrenceDates(...).length` contra
 * esta constante é o chamador (página / `JobSeriesService.createSeries`), não esta função: ela
 * sempre devolve a lista COMPLETA e correta, para a UI poder mostrar "isso geraria N turnos".
 * Reforçado também no banco (trigger de statement em `jobs`, defesa em profundidade).
 */
export const MAX_SERIES_OCCURRENCES = 60;

export interface GenerateOccurrenceDatesParams {
  recurrenceType: RecurrenceType;
  /** 0=domingo..6=sábado. Obrigatório e não-vazio quando `recurrenceType === 'weekly'`. */
  weekdays?: number[];
  /** `YYYY-MM-DD`, inclusive. */
  rangeStartDate: string;
  /** `YYYY-MM-DD`, inclusive. */
  rangeEndDate: string;
  /** "Agora" injetado — default `new Date()`. Nunca lido implicitamente no meio da função. */
  referenceDate?: Date;
}

/** `YYYY-MM-DD` a partir dos componentes LOCAIS de um `Date` — nunca `toISOString()`. */
function toLocalDateOnlyString(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseYMD(dateStr: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { y, m, d };
}

/**
 * Gera as datas de ocorrência (`YYYY-MM-DD`, ordenadas, sem duplicatas) de uma série.
 *
 * - `recurrenceType === 'weekly'`: uma ocorrência por dia marcado em `weekdays`, para cada dia
 *   dentro de `[rangeStartDate, rangeEndDate]` (inclusive nas duas pontas) cujo dia-da-semana
 *   LOCAL bate com algum valor de `weekdays`.
 * - `recurrenceType === 'daily'`: uma ocorrência por dia corrido no intervalo, sem filtro de
 *   dia-da-semana (cobertura de bloco/férias).
 *
 * Não trunca em `MAX_SERIES_OCCURRENCES` — devolve a lista real para o chamador decidir bloquear.
 */
export function generateOccurrenceDates(params: GenerateOccurrenceDatesParams): string[] {
  const { recurrenceType, rangeStartDate, rangeEndDate } = params;
  const weekdaySet = new Set(params.weekdays ?? []);
  const referenceDate = params.referenceDate ?? new Date();
  const todayStr = toLocalDateOnlyString(referenceDate);

  // `YYYY-MM-DD` é ordenável como string (dígitos, largura fixa) — comparação lexicográfica
  // equivale à comparação cronológica, sem precisar construir Date para o clamp.
  const effectiveStart = rangeStartDate < todayStr ? todayStr : rangeStartDate;
  if (effectiveStart > rangeEndDate) return [];

  const start = parseYMD(effectiveStart);
  const end = parseYMD(rangeEndDate);

  const cursor = new Date(start.y, start.m - 1, start.d);
  const endDate = new Date(end.y, end.m - 1, end.d);

  const results: string[] = [];
  while (cursor.getTime() <= endDate.getTime()) {
    const matches =
      recurrenceType === 'daily' || (recurrenceType === 'weekly' && weekdaySet.has(cursor.getDay()));
    if (matches) results.push(toLocalDateOnlyString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return results;
}
