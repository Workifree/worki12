/**
 * Regras únicas do "estado do turno" para as telas da empresa (Dashboard, Meus Turnos, Presença e
 * Organização). Puro, sem rede.
 *
 * - CONTRATADO ≠ EM ANDAMENTO: em andamento = chegada registrada (pelo freela ou confirmada pela
 *   empresa) e saída ainda NÃO confirmada.
 * - `jobs.status` continua `open` depois que o turno é concluído (quem muda é a candidatura), então
 *   "ativo" exige também que ainda reste vaga não concluída.
 */

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

/** Turno ativo de verdade: aberto e ainda não concluído. */
export function isJobActive(
  job: { status: string; slots?: number | null },
  apps: Array<{ status: string }> | null | undefined,
): boolean {
  return job.status === 'open' && !isJobConcluded(job.slots, apps);
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
