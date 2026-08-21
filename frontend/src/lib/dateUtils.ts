import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ---------------------------------------------------------------------------
// Helpers de data em horário LOCAL (nunca `toISOString()`/UTC) — várias telas
// de empresa precisavam da data de "hoje" como string `YYYY-MM-DD` para
// comparar com inputs de data (`<input type="date">`) e para filtrar turnos
// futuros/passados. Também reúne `parseDateOnly`/`formatDateOnly`: eram
// duplicados (mesmo corpo, mesmo comentário) em `ReceiptView`,
// `CompanyJobCandidates` e `lib/jobScheduling.ts` — unificados aqui por serem
// utilitário de data GENÉRICO (datas de pagamento/turno), não lógica de
// agenda; `jobScheduling.ts` reexporta para não quebrar quem já importa de lá.
// ---------------------------------------------------------------------------

/**
 * Data de hoje em horário LOCAL, no formato `YYYY-MM-DD`.
 *
 * Evita off-by-one de fuso: `new Date().toISOString()` usa UTC, o que faz a
 * data "andar" perto da meia-noite em BRT (UTC-3). Entre ~21h e 23:59 local,
 * o UTC já virou o dia seguinte — isso fazia o turno de hoje sumir do picker
 * de data mínima e a data de pagamento defaultar para amanhã. Usar os
 * componentes locais (`getFullYear`/`getMonth`/`getDate`) evita o bug.
 */
export function todayLocalDate(): string {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Interpreta uma string "date-only" (`YYYY-MM-DD`, ou um ISO timestamp do qual
 * só a data importa) como data LOCAL — nunca UTC.
 *
 * `new Date("YYYY-MM-DD")` é interpretado pelo JS como meia-noite UTC; em BRT
 * (UTC-3) isso recua a data em 1 dia (ex.: 01/07 vira 30/06). Construir a data
 * a partir dos componentes (`y`/`m`/`d`) evita o bug — mesmo raciocínio de
 * `todayLocalDate`.
 */
export function parseDateOnly(isoOrDateOnly: string): Date {
    const dateStr = isoOrDateOnly.split('T')[0];
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

/**
 * Formata uma data "date-only" (ver `parseDateOnly`) no fuso LOCAL, sem o
 * off-by-one de UTC. Usado para datas de turno (`job.start_date`) e de
 * pagamento (`payment.paid_at`/`payment.scheduled_for`) — ex.: recibo
 * (`ReceiptView`), registro/agendamento de pagamento (`CompanyJobCandidates`)
 * e agenda de turnos (`lib/jobScheduling.ts`).
 */
export function formatDateOnly(isoOrDateOnly: string, pattern: string): string {
    return format(parseDateOnly(isoOrDateOnly), pattern, { locale: ptBR });
}

/**
 * Converte uma data "date-only" (`YYYY-MM-DD`) para um timestamp ISO usando a âncora de
 * MEIO-DIA local — o mesmo truque que `CompanyCreateJob.handleSubmit` já usava inline
 * (`new Date(d + 'T12:00:00').toISOString()`), extraído aqui por decisão do
 * ADR-20260817-serie-eager-e-cancelamento-suave (decisão 6, "Escala Recorrente").
 *
 * Meio-dia dá ±3h de folga: qualquer fuso brasileiro (UTC-2 a UTC-5) cai no mesmo dia civil ao
 * ser reconvertido com `parseDateOnly`. Existir em UM lugar só evita a segunda cópia do truque —
 * é exatamente assim que o off-by-one de fuso documentado no cabeçalho deste arquivo nasceria de
 * novo (a recorrência é o lugar mais fácil do mundo para escrever essa cópia divergente).
 */
export function localDateToTimestamp(dateStr: string): string {
    return new Date(`${dateStr}T12:00:00`).toISOString();
}

/**
 * Duração curta entre dois instantes ISO: "6 min", "1h 12min".
 *
 * Vive aqui, e não junto do componente que a usa, porque é a formatação do número que o produto
 * vende — o tempo entre o disparo do chamado e o primeiro aceite ("de 2 horas para 6 minutos").
 * Ele vai aparecer no painel do turno, no relatório de operação e no BI; formatar diferente em
 * cada lugar faria a mesma medida parecer três medidas.
 */
/**
 * Índice do dia da semana (0=domingo .. 6=sábado) de uma data "date-only" (`YYYY-MM-DD`),
 * calculado em horário LOCAL — nunca `getUTCDay()`.
 *
 * Extraído de `ShiftCallModal` (F7 — Disponibilidade declarada, BLOCKER da revisão de frontend):
 * o cálculo já vivia inline como `parseDateOnly(job.start_date).getDay()`. Centralizar aqui evita
 * uma segunda convenção de "dia da semana" concorrente com `job_series.weekdays` — mesma
 * convenção 0=domingo usada por `isWorkerAvailableFor` (`lib/availability.ts`) e pela recorrência
 * (`lib/recurrence.ts`).
 *
 * Reusa `parseDateOnly` (não reimplementa o parse) — mesma proteção contra o off-by-one de fuso
 * documentado no cabeçalho deste arquivo: `new Date("YYYY-MM-DD")` cru seria interpretado como
 * meia-noite UTC e recuaria o dia em 1 no fuso brasileiro.
 */
export function getWeekdayIndex(dateOnly: string): number {
    return parseDateOnly(dateOnly).getDay();
}

/**
 * Predicado ÚNICO de "certificação vencida" (F8 — migration 20260817001300).
 *
 * Espelha, no client, o MESMO predicado usado no SQL (`ddl-aprovado.md` §D2):
 *   expires_at IS NOT NULL AND expires_at < (now() AT TIME ZONE 'America/Sao_Paulo')::date
 *
 * `expiresAt` chega como `YYYY-MM-DD` (ou timestamp — `parseDateOnly` corta a parte da
 * hora). Compara com `todayLocalDate()`, NUNCA com `new Date().toISOString().slice(0,10)`
 * — isso usaria UTC e erraria o dia entre ~21h e 00h no Brasil (o mesmo bug documentado no
 * cabeçalho deste arquivo). `vitest.config.ts` fixa `TZ=America/Sao_Paulo` de propósito:
 * não mockar o fuso nos testes desta função.
 *
 * Nunca materializar isto em coluna/estado cacheado — é sempre recalculado, porque
 * vencimento é função do relógio, não um fato gravável (D2 do gate).
 */
export function isCertificationExpired(expiresAt: string | null | undefined): boolean {
    if (!expiresAt) return false;
    const expiryDateOnly = expiresAt.split('T')[0];
    return expiryDateOnly < todayLocalDate();
}

export function formatDurationShort(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';

  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 1) return 'menos de 1 min';
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}min`;
}
