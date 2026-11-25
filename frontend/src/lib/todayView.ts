/**
 * Regras puras da tela Hoje (E5/R25): agrupamento por dia, texto do responsável e o que cada papel
 * pode fazer em cada turno. Sem rede e sem React — a barreira real é o banco (RPCs + RLS); aqui é
 * só para não oferecer o que a pessoa não pode usar.
 */

import type { TodayJob } from '../services/shiftOperationService';

export interface DayGroup {
  date: string;
  label: string;
  jobs: TodayJob[];
}

/** Quantos dias a Hoje mostra a partir de hoje (hoje + 13 = duas semanas). */
export const TODAY_RANGE_DAYS = 14;

export function addDaysTo(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "Hoje", "Amanhã" ou "qua., 25/11" — sempre pela data civil, sem depender do fuso do aparelho. */
export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Hoje';
  if (date === addDaysTo(today, 1)) return 'Amanhã';
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
  return `${weekday}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

export function groupByDay(jobs: TodayJob[], today: string): DayGroup[] {
  const byDate = new Map<string, TodayJob[]>();
  [...jobs]
    .sort((a, b) => (a.date + (a.startTime ?? '99:99')).localeCompare(b.date + (b.startTime ?? '99:99')))
    .forEach((job) => {
      const list = byDate.get(job.date) ?? [];
      list.push(job);
      byDate.set(job.date, list);
    });
  return [...byDate.entries()].map(([date, list]) => ({ date, label: dayLabel(date, today), jobs: list }));
}

/** Linha "Responsável: nome · etiqueta" (R25). Turno sem responsável nem etiqueta não gera linha vazia. */
export function responsibleLine(job: TodayJob): string {
  const who =
    job.responsibleKind === 'gestor' && job.creatorLabel
      ? `Gestor (criado por ${job.creatorLabel})`
      : job.responsibleLabel;
  const parts = [job.responsibleKind === 'covering' ? 'Você cobre um colega' : `Responsável: ${who}`];
  if (job.tagName) parts.push(job.tagArchived ? `${job.tagName} (arquivada)` : job.tagName);
  return parts.join(' · ');
}

export interface TodayPermissions {
  isGestor: boolean;
  /** Já existe equipe (R23): sem isto, "Passar para" e "Cobrir" nem aparecem. */
  teamEnabled: boolean;
  /** Há para quem passar (alguém além de quem está passando). */
  hasDestinations: boolean;
}

/** Gestor passa qualquer turno; encarregado só os próprios (cobertura não dá direito de passar). */
export function canPassJob(job: TodayJob, perms: TodayPermissions): boolean {
  if (!perms.teamEnabled || !perms.hasDestinations) return false;
  return perms.isGestor || job.responsibleKind === 'self';
}

/** O turno já começou? (data local + horário de entrada em São Paulo; sem horário = 00:00.) */
export function jobHasStarted(date: string, startTime: string | null, now: Date = new Date()): boolean {
  const start = Date.parse(`${date}T${startTime ?? '00:00'}:00-03:00`);
  return Number.isFinite(start) && start < now.getTime();
}

/**
 * Gestor cancela qualquer turno; encarregado os próprios e os que cobre (`is_job_owner`), mas só
 * antes de o turno começar (depois disso o banco recusa com `job_in_the_past`).
 */
export function canCancelJob(job: TodayJob, perms: Pick<TodayPermissions, 'isGestor'>, now: Date = new Date()): boolean {
  if (perms.isGestor) return true;
  if (job.responsibleKind !== 'self' && job.responsibleKind !== 'covering') return false;
  return !jobHasStarted(job.date, job.startTime, now);
}
