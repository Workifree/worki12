/**
 * Regras únicas do "estado do turno" para as telas da empresa (Dashboard, Meus Turnos, Presença e
 * Organização). Puro, sem rede.
 *
 * - CONTRATADO ≠ EM ANDAMENTO: em andamento = chegada registrada (pelo freela ou confirmada pela
 *   empresa) e saída ainda NÃO confirmada.
 * - `jobs.status` continua `open` depois que o turno é concluído (quem muda é a candidatura), então
 *   "ativo" exige também que ainda reste vaga não concluída.
 */

import { saoPauloDay } from './checkinWindow';

export interface ShiftAttendanceLike {
  status: string;
  worker_checkin_at?: string | null;
  company_checkin_confirmed_at?: string | null;
  company_checkout_confirmed_at?: string | null;
}

export function isShiftInProgress(app: ShiftAttendanceLike): boolean {
  if (app.status !== 'hired' && app.status !== 'in_progress') return false;
  if (app.company_checkout_confirmed_at) return false;
  return Boolean(app.worker_checkin_at || app.company_checkin_confirmed_at);
}

/** Todas as vagas do turno já foram concluídas. */
export function isJobConcluded(slots: number | null | undefined, apps: Array<{ status: string }> | null | undefined): boolean {
  return (apps ?? []).filter((a) => a.status === 'completed').length >= (slots ?? 1);
}

export type ShiftTimeState = 'upcoming' | 'ongoing' | 'past';

export interface ShiftTimeLike {
  start_date?: string | null;
  work_start_time?: string | null;
  work_end_time?: string | null;
}

const HOUR = 3_600_000;
const TOLERANCE_HOURS = 2;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)/;

/** Instante de um horário de parede de São Paulo (UTC-3, sem horário de verão). */
function atSaoPaulo(day: string, hour: number, minute: number): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hour + 3, minute);
}

/**
 * Onde o turno está no tempo. Fim = dia local (São Paulo) de `start_date` + `work_end_time`
 * (+1 dia se fim <= início) + 2h de tolerância. Sem `work_end_time`, vale o fim do dia local
 * (nunca "past" antes da hora). Sem data válida, não dá para afirmar que passou: 'ongoing'.
 */
export function shiftTimeState(job: ShiftTimeLike, now: Date = new Date()): ShiftTimeState {
  if (!job.start_date) return 'ongoing';
  let day: string;
  if (/^\d{4}-\d{2}-\d{2}$/.test(job.start_date)) day = job.start_date;
  else {
    const parsed = new Date(job.start_date);
    if (Number.isNaN(parsed.getTime())) return 'ongoing';
    day = saoPauloDay(parsed);
  }
  const st = TIME_RE.exec(job.work_start_time ?? '');
  const start = atSaoPaulo(day, st ? Number(st[1]) : 0, st ? Number(st[2]) : 0);
  const en = TIME_RE.exec(job.work_end_time ?? '');
  let end: number;
  if (en) {
    end = atSaoPaulo(day, Number(en[1]), Number(en[2]));
    if (end <= start) end += 24 * HOUR;
    end += TOLERANCE_HOURS * HOUR;
  } else {
    end = atSaoPaulo(day, 24, 0);
  }
  const t = now.getTime();
  if (t < start) return 'upcoming';
  return t > end ? 'past' : 'ongoing';
}

/** Turno ativo de verdade: aberto, ainda não concluído e que ainda não passou. */
export function isJobActive(
  job: { status: string; slots?: number | null } & ShiftTimeLike,
  apps: Array<{ status: string }> | null | undefined,
  now: Date = new Date(),
): boolean {
  return job.status === 'open' && !isJobConcluded(job.slots, apps) && shiftTimeState(job, now) !== 'past';
}

/** Rótulo de presença da candidatura no painel da empresa. */
export function attendanceLabel(
  app: ShiftAttendanceLike & { worker_checkout_at?: string | null },
  job: ShiftTimeLike,
  now: Date = new Date(),
): { rotulo: string; tone: 'warning' | 'neutral' | 'success' | 'danger' } {
  if (app.company_checkout_confirmed_at) return { rotulo: 'Saída confirmada', tone: 'neutral' };
  if (app.company_checkin_confirmed_at && app.worker_checkout_at) return { rotulo: 'Saiu — confirme', tone: 'warning' };
  if (app.worker_checkin_at && !app.company_checkin_confirmed_at) return { rotulo: 'Chegou — confirme', tone: 'warning' };
  if (app.company_checkin_confirmed_at) return { rotulo: 'Presença OK', tone: 'success' };
  if (shiftTimeState(job, now) === 'past') return { rotulo: 'Não compareceu / sem registro', tone: 'danger' };
  return { rotulo: 'Aguardando chegada', tone: 'warning' };
}

/**
 * Rótulo de uma candidatura ligada a turno em curso (selo do chat). `null` = o status não é de
 * turno em curso e quem chama usa o próprio rótulo.
 */
export function activeShiftLabel(app: ShiftAttendanceLike): 'Saída confirmada' | 'Em andamento' | 'Contratado' | null {
  if (app.status !== 'hired' && app.status !== 'in_progress') return null;
  if (app.company_checkout_confirmed_at) return 'Saída confirmada';
  return isShiftInProgress(app) ? 'Em andamento' : 'Contratado';
}
