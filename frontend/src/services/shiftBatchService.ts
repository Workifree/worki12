/**
 * ShiftBatchService — leitura de modelos, publicação em lote (RPC `create_jobs_batch`) e chamado
 * de freelas DEPOIS da publicação.
 * Spec: `.harness/spec/criacao-rapida-de-turnos/spec.md` (R4.3, R4.4, Regra 5).
 *
 * A publicação é tudo-ou-nada e idempotente no banco. O chamado não: o turno é o contrato, o
 * chamado é tentativa. Falha de chamado nunca desfaz turno.
 */
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { toBrazilDateOnly } from '../lib/dateUtils';
import {
  addDays, distinctModels, toPublishPayload,
  type ExistingShift, type ShiftDraftBatch, type ShiftDraftCall, type ShiftDraftRow,
  type ShiftDraftSeries, type SourceJob,
} from '../lib/shiftDrafts';
import { canSeeJob, getJobScope, scopeResponsibleIds, type JobScope } from './jobScopeService';
import { ShiftCallService } from './shiftCallService';

const JOB_COLUMNS =
  'id, title, category, description, requirements, briefing, certification_requirement, location, ' +
  'budget, budget_type, has_lunch, slots, tag_id, start_date, work_start_time, work_end_time, ' +
  'responsible_id, created_at';

// ---------------------------------------------------------------------------
// Leitura: modelos, cópia de semana, duplicatas
// ---------------------------------------------------------------------------

function scopedJobs(scope: JobScope) {
  let query = supabase.from('jobs').select(JOB_COLUMNS).eq('company_id', scope.companyId).neq('status', 'deleted');
  if (scope.restricted) query = query.in('responsible_id', scopeResponsibleIds(scope));
  return query;
}

/** Intervalo de datas civis brasileiras como filtro de timestamptz (fim inclusivo). */
function dayBounds(from: string, to: string) {
  return { gte: `${from}T00:00:00-03:00`, lt: `${addDays(to, 1)}T00:00:00-03:00` };
}

/** Últimos turnos distintos do escopo da pessoa. Lança em falha de leitura. */
export async function listRecentModels(limit = 6): Promise<SourceJob[]> {
  const scope = await getJobScope();
  const { data, error } = await scopedJobs(scope).order('created_at', { ascending: false }).limit(40);
  if (error) throw error;
  return distinctModels(((data ?? []) as unknown as SourceJob[]).filter((j) => canSeeJob(scope, j)), limit);
}

/** Um turno como modelo (`?repetir=`). `null` = não existe ou a pessoa não pode ver. */
export async function getModelJob(jobId: string): Promise<SourceJob | null> {
  const scope = await getJobScope();
  const { data, error } = await supabase
    .from('jobs').select(JOB_COLUMNS).eq('id', jobId).eq('company_id', scope.companyId).maybeSingle();
  if (error) throw error;
  const job = data as unknown as SourceJob | null;
  return job && canSeeJob(scope, job) ? job : null;
}

/** Turnos não excluídos do escopo no intervalo (copiar semana / fim de semana). */
export async function listJobsBetween(from: string, to: string): Promise<SourceJob[]> {
  const scope = await getJobScope();
  const bounds = dayBounds(from, to);
  const { data, error } = await scopedJobs(scope)
    .gte('start_date', bounds.gte).lt('start_date', bounds.lt)
    .order('start_date', { ascending: true })
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as unknown as SourceJob[]).filter((j) => canSeeJob(scope, j));
}

/** Quem foi chamado ou trabalhou nos turnos copiados: sugestão, sempre desmarcada. */
export async function listPreviousWorkerIds(jobIds: string[]): Promise<string[]> {
  if (jobIds.length === 0) return [];
  const { data, error } = await supabase
    .from('applications').select('worker_id').in('job_id', jobIds)
    .in('status', ['invited', 'hired', 'in_progress', 'completed']);
  if (error) {
    logError('shiftBatch.listPreviousWorkerIds', error);
    return [];
  }
  return [...new Set(((data ?? []) as { worker_id: string }[]).map((r) => r.worker_id))];
}

/** Turnos já publicados da EMPRESA nas datas do rascunho (aviso de duplicata). Falha = sem aviso. */
export async function listExistingShifts(dates: string[]): Promise<ExistingShift[]> {
  const sorted = dates.filter(Boolean).sort();
  if (sorted.length === 0) return [];
  try {
    const scope = await getJobScope();
    const bounds = dayBounds(sorted[0], sorted[sorted.length - 1]);
    const { data, error } = await supabase
      .from('jobs').select('id, category, start_date, work_start_time, responsible_id')
      .eq('company_id', scope.companyId).neq('status', 'deleted')
      .gte('start_date', bounds.gte).lt('start_date', bounds.lt)
      .limit(1000);
    if (error) throw error;
    return ((data ?? []) as unknown as SourceJob[])
      .filter((j) => j.start_date)
      .map((j) => ({
        id: j.id,
        date: toBrazilDateOnly(j.start_date as string),
        start_time: j.work_start_time ?? '',
        category: j.category ?? '',
        visible: canSeeJob(scope, j),
      }));
  } catch (err) {
    logError('shiftBatch.listExistingShifts', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Publicação
// ---------------------------------------------------------------------------

export interface PublishRowError {
  /** 1-based, na ordem enviada; 0 = lote inteiro. */
  row: number;
  code: string;
  message: string;
}

export type PublishResult =
  | { ok: true; alreadyCreated: boolean; jobIds: string[] }
  | {
      ok: false;
      message: string;
      errors: PublishRowError[];
      /** true = a resposta não chegou: o lote PODE ter sido gravado. Repetir com o mesmo id é seguro. */
      uncertain: boolean;
    };

const UNCERTAIN_MESSAGE =
  'Não recebemos a resposta. Toque em Publicar de novo: se os turnos já foram criados, nada será duplicado.';

interface BatchRpcResponse {
  outcome?: string;
  job_ids?: string[];
  errors?: PublishRowError[];
}

const OUTCOME_MESSAGE: Record<string, string> = {
  unauthenticated: 'Sua sessão expirou. Entre de novo; o rascunho continua salvo neste aparelho.',
  forbidden: 'Você não tem permissão para publicar estes turnos nesta empresa.',
  batch_conflict: 'Este rascunho pertence a outra empresa. Volte e revise o lote de novo.',
  invalid_input: 'O rascunho está incompleto. Volte e confira as linhas.',
};

const failure = (message: string, errors: PublishRowError[] = [], uncertain = false): PublishResult =>
  ({ ok: false, message, errors, uncertain });

/** `batch.rows` deve vir já agrupado (`mergeDrafts`): a ordem define o retorno `jobIds`. */
export async function publishBatch(
  companyId: string,
  batch: ShiftDraftBatch,
  series: ShiftDraftSeries | null = null,
): Promise<PublishResult> {
  const payload = toPublishPayload(batch.template, batch.rows);
  try {
    const { data, error } = await supabase.rpc('create_jobs_batch', {
      p_client_batch_id: batch.client_batch_id,
      p_company_id: companyId,
      p_template: payload.template,
      p_rows: payload.rows,
      p_series: series,
    });
    if (error) {
      logError('shiftBatch.publish', error);
      const code = (error as { code?: string }).code ?? '';
      if (code === 'PGRST202' || code === '42883') {
        return failure('A publicação em lote ainda não está disponível. Use "Criar turno" por enquanto.');
      }
      // Com código do banco a transação foi desfeita; sem código foi a rede.
      return code
        ? failure('Não foi possível publicar. Nenhum turno foi criado.')
        : failure(UNCERTAIN_MESSAGE, [], true);
    }
    const result = (data ?? {}) as BatchRpcResponse;
    if ((result.outcome === 'created' || result.outcome === 'already_created') && result.job_ids?.length) {
      return { ok: true, alreadyCreated: result.outcome === 'already_created', jobIds: result.job_ids };
    }
    const errors = result.errors ?? [];
    return failure(
      errors[0]?.message ?? OUTCOME_MESSAGE[result.outcome ?? ''] ?? 'Não foi possível publicar. Nenhum turno foi criado.',
      errors,
    );
  } catch (err) {
    logError('shiftBatch.publish', err);
    return failure(UNCERTAIN_MESSAGE, [], true);
  }
}

/**
 * Quantos turnos um lote já tem. Usado quando a resposta se perdeu E a pessoa editou o rascunho:
 * trocar o id sem conferir publicaria um segundo lote. Lança em falha de leitura.
 */
export async function countPublishedBatch(companyId: string, clientBatchId: string): Promise<number> {
  const { count, error } = await supabase
    .from('jobs').select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).eq('creation_batch_id', clientBatchId);
  if (error) throw error;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Chamar freelas depois de publicar (Regra 5)
// ---------------------------------------------------------------------------

export interface CallPlanItem {
  job_id: string;
  row_key: string;
  worker_ids: string[];
}

/**
 * Quem chamar em cada turno. A escolha da linha vence a geral. `listMemberIds` são os membros da
 * lista escolhida; `eligible` é o elenco aceito (quem saiu do elenco derrubaria o chamado).
 */
export function resolveInvitees(
  row: ShiftDraftRow,
  call: ShiftDraftCall | undefined,
  listMemberIds: (listId: string) => string[],
  eligible: ReadonlySet<string>,
): string[] {
  let ids: string[] = [];
  if (row.invite_worker_ids?.length) ids = row.invite_worker_ids;
  else if (call?.mode === 'workers') ids = call.worker_ids ?? [];
  else if (call?.mode === 'list' && call.list_id) ids = listMemberIds(call.list_id);
  return [...new Set(ids)].filter((id) => eligible.has(id));
}

export function buildCallPlan(
  rows: ShiftDraftRow[],
  jobIds: string[],
  invitees: (row: ShiftDraftRow) => string[],
): CallPlanItem[] {
  return rows.flatMap((row, i) => {
    const worker_ids = invitees(row);
    return jobIds[i] && worker_ids.length ? [{ job_id: jobIds[i], row_key: row.key, worker_ids }] : [];
  });
}

export interface CallResult {
  item: CallPlanItem;
  status: 'sent' | 'failed';
  error?: string;
}

/** Chamado aberto, com alvos, já existente: a tentativa anterior chegou e só a resposta se perdeu. */
async function hasOpenCall(jobId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('shift_calls').select('id, targets:shift_call_targets(worker_id)')
    .eq('job_id', jobId).eq('status', 'open');
  if (error) throw error;
  return ((data ?? []) as { targets: unknown[] | null }[]).some((c) => (c.targets?.length ?? 0) > 0);
}

export async function dispatchCall(
  item: CallPlanItem,
  call: ShiftDraftCall | undefined,
  options: { retry?: boolean } = {},
): Promise<CallResult> {
  try {
    if (options.retry && (await hasOpenCall(item.job_id))) return { item, status: 'sent' };
    const result = await ShiftCallService.createShiftCall(item.job_id, item.worker_ids, {
      reason: call?.reason ?? 'outro',
      ...(call?.expires_minutes ? { expiresInHours: call.expires_minutes / 60 } : {}),
    });
    return result.call
      ? { item, status: 'sent' }
      : { item, status: 'failed', error: result.error ?? 'Não foi possível enviar o chamado.' };
  } catch (err) {
    logError('shiftBatch.dispatchCall', err);
    return { item, status: 'failed', error: 'Não foi possível enviar o chamado.' };
  }
}

/** Em sequência, de propósito (Regra 5). Uma falha não interrompe as demais. */
export async function dispatchCalls(
  plan: CallPlanItem[],
  call: ShiftDraftCall | undefined,
  options: { retry?: boolean; onResult?: (result: CallResult) => void } = {},
): Promise<CallResult[]> {
  const results: CallResult[] = [];
  for (const item of plan) {
    const result = await dispatchCall(item, call, { retry: options.retry });
    results.push(result);
    options.onResult?.(result);
  }
  return results;
}
