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
 * Duração curta entre dois instantes ISO: "6 min", "1h 12min".
 *
 * Vive aqui, e não junto do componente que a usa, porque é a formatação do número que o produto
 * vende — o tempo entre o disparo do chamado e o primeiro aceite ("de 2 horas para 6 minutos").
 * Ele vai aparecer no painel do turno, no relatório de operação e no BI; formatar diferente em
 * cada lugar faria a mesma medida parecer três medidas.
 */
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
