/**
 * Cartões de freela sem depender do embed `workers`. Para o Encarregado o embed volta `null` (RLS
 * de propósito: PII). As fontes são as RPCs projetadas: `list_team_connection_cards` (Elenco, sem
 * PII) e, nos turnos que a sessão opera, `get_shift_worker_payment_card` (nome, foto, telefone e PIX
 * de quem está no turno). Nada aqui inventa nível ou nota: o que a fonte não traz fica ausente.
 */
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import type { WorkerProfile } from '../types';

export type WorkerCard = Partial<WorkerProfile> & { id: string; full_name: string };

interface CardRow {
  worker_id?: string;
  worker?: (Partial<WorkerProfile> & { id?: string }) | null;
}

export async function getElencoCards(): Promise<Map<string, WorkerCard>> {
  const cards = new Map<string, WorkerCard>();
  try {
    const { data, error } = await supabase.rpc('list_team_connection_cards');
    if (error) throw error;
    const result = data as { outcome?: string; items?: CardRow[] } | null;
    (result?.items ?? []).forEach((item) => {
      const id = item.worker_id ?? item.worker?.id;
      if (id && item.worker?.full_name) cards.set(id, { ...item.worker, id } as WorkerCard);
    });
  } catch (error) {
    logError('workerCards.elenco', error);
  }
  return cards;
}

export async function getShiftWorkerCards(jobId: string): Promise<Map<string, WorkerCard>> {
  const cards = new Map<string, WorkerCard>();
  try {
    const { data, error } = await supabase.rpc('get_shift_worker_payment_card', { p_job_id: jobId });
    if (error) throw error;
    const result = data as { items?: Array<Partial<WorkerProfile> & { worker_id: string }> } | null;
    (result?.items ?? []).forEach(({ worker_id, full_name, avatar_url, phone, pix_key }) => {
      if (full_name) cards.set(worker_id, { id: worker_id, full_name, avatar_url, phone, pix_key });
    });
  } catch (error) {
    logError('workerCards.shift', error);
  }
  return cards;
}

/** O PostgREST pode devolver o embed como objeto, array ou `null`. */
function hasWorker(worker: unknown): boolean {
  return Array.isArray(worker) ? worker.length > 0 : !!worker;
}

/**
 * Preenche as linhas cujo embed `worker` voltou vazio. Sem linha faltando, nenhuma chamada extra.
 * Quem não está em nenhuma fonte continua `null` (a tela usa o rótulo neutro).
 */
export async function fillMissingWorkers<T extends { worker_id?: string | null; worker?: unknown }>(
  rows: T[],
  jobId?: string,
): Promise<T[]> {
  if (!rows.some((r) => r.worker_id && !hasWorker(r.worker))) return rows;
  const [elenco, shift] = await Promise.all([
    getElencoCards(),
    jobId ? getShiftWorkerCards(jobId) : Promise.resolve(new Map<string, WorkerCard>()),
  ]);
  return rows.map((row) => {
    if (!row.worker_id || hasWorker(row.worker)) return row;
    const base = elenco.get(row.worker_id);
    const own = shift.get(row.worker_id);
    return base || own ? { ...row, worker: { ...base, ...own } } : row;
  });
}
