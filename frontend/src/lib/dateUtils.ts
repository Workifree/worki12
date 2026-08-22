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

/**
 * Núcleo de "duração em ms → texto curto" (`"6 min"`, `"1h 12min"`), extraído de
 * `formatDurationShort` (F9 — Analytics de operação, PRD Step 1/R9). `formatDurationShort`
 * segue sendo o ponto de entrada para quem já tem dois ISO strings (chamado de turno na UI);
 * `operationAnalyticsService` (tempo médio de preenchimento, R9) chama esta função direto porque
 * já calculou a média em ms — reimplementar "Xh Ymin" ali duplicaria a mesma formatação que o
 * produto vende ("de 2 horas para 6 minutos") em dois lugares que podem divergir.
 *
 * `ms < 0` (ou não finito) devolve `'—'` — mesma guarda de `formatDurationShort`, nunca duração
 * negativa/NaN renderizada.
 */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';

  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 1) return 'menos de 1 min';
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}min`;
}

export function formatDurationShort(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return formatDurationMs(ms);
}

/**
 * Total de horas trabalhadas entre chegada e saída REGISTRADAS (timestamps completos, com
 * data — não só hora-do-dia). Turno que cruza a meia-noite (ex.: 18h10 às 01h00) é resolvido
 * automaticamente pela subtração de datas absolutas: como cada timestamp já carrega sua
 * própria data, checkout "no dia seguinte" não precisa do hack "+24h" usado em `calculateHours`
 * (`CompanyCreateJob.tsx`), que só é necessário para strings de hora soltas sem data.
 *
 * Extraída de `ReceiptView.tsx` (F9 — Analytics de operação, PRD D2/Step 1) — MESMA assinatura,
 * MESMO comportamento, para ser o ponto único de "quantas horas este turno durou de fato",
 * reaproveitado pelo recibo E pelo painel de operação. Zero reimplementação: uma mudança de
 * regra (ex.: tolerância de arredondamento) muda em um lugar só.
 *
 * Retorna `null` se checkin/checkout ausentes ou se checkout <= checkin (dado inconsistente —
 * melhor tratar como "sem horas" do que exibir um total errado/negativo).
 */
export function calculateWorkedHours(
    checkinIso: string | null | undefined,
    checkoutIso: string | null | undefined,
): number | null {
    if (!checkinIso || !checkoutIso) return null;
    const checkin = new Date(checkinIso).getTime();
    const checkout = new Date(checkoutIso).getTime();
    if (!Number.isFinite(checkin) || !Number.isFinite(checkout) || checkout <= checkin) return null;
    return (checkout - checkin) / (1000 * 60 * 60);
}

// ---------------------------------------------------------------------------
// Fuso EXPLÍCITO `America/Sao_Paulo` (F9 — Analytics de operação, PRD D3).
//
// Diferença deliberada de `todayLocalDate()`/`parseDateOnly()` (acima): aquelas funções usam o
// fuso do DISPOSITIVO (`new Date().getFullYear()` etc.), o que é certo para "hoje" no aparelho
// de quem está na tela. Mas `todayInBrazil`/`toBrazilDateOnly` existem para o caso em que o fuso
// do dispositivo NÃO pode ser a fonte — bucketização de mês/semana no painel de operação precisa
// ser a mesma data civil BRASILEIRA para todo mundo, mesmo que o gerente esteja viajando ou com
// o relógio do celular errado. Por isso `Intl.DateTimeFormat('en-CA', { timeZone:
// 'America/Sao_Paulo' })` — NUNCA um offset literal (`-03:00`) hardcoded: o Brasil não tem
// horário de verão hoje, mas gravar o offset como constante é exatamente o tipo de premissa que
// vira cicatriz (ver `isCertificationExpired`, acima, para o precedente do predicado de fuso
// explícito em SQL — `job_local_date`, F4). `en-CA` é só um truque de locale que já formata
// `YYYY-MM-DD` nativamente, sem parsing manual de string.
// ---------------------------------------------------------------------------

const BRAZIL_TZ = 'America/Sao_Paulo';

function formatDateOnlyInBrazil(date: Date): string {
  // en-CA (Canadá) formata datas como YYYY-MM-DD nativamente — evita montar a string à mão.
  return new Intl.DateTimeFormat('en-CA', { timeZone: BRAZIL_TZ }).format(date);
}

/**
 * Data de HOJE em `America/Sao_Paulo`, como `YYYY-MM-DD` — independente do fuso do dispositivo.
 * Ver nota de cabeçalho acima (por que isto NÃO é o mesmo que `todayLocalDate()`).
 */
export function todayInBrazil(): string {
  return formatDateOnlyInBrazil(new Date());
}

/**
 * Converte um timestamp ISO (`timestamptz`, ex.: `paid_at`, `shift_calls.created_at`,
 * `worker_checkin_at`) para a data civil `YYYY-MM-DD` em `America/Sao_Paulo` — SEMPRE, mesmo que
 * o dispositivo de quem chama esteja em outro fuso. Ver nota de cabeçalho acima.
 */
export function toBrazilDateOnly(iso: string): string {
  return formatDateOnlyInBrazil(new Date(iso));
}
