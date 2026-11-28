/**
 * ShiftOperationService — operação diária da empresa (Equipe e encarregados, E5).
 *
 * Contrato REAL das RPCs: `supabase/migrations/20261123000600_equipe_e5_operacao.sql`.
 * Specs: `.harness/spec/equipe-encarregados/spec.md` (R14, R18, R20, R25, R27).
 *
 * Princípios:
 *  - A autorização mora no banco (DEFINER + seam). Aqui só se traduz o desfecho (`outcome`) em dado
 *    tipado e em texto claro, neutro de gênero, sem culpa.
 *  - Aviso de conflito (`get_busy_workers`) NUNCA bloqueia: erro de qualquer natureza degrada para
 *    "sem aviso" + `logError` (mesma regra da guarda de vínculo, F5).
 *  - Nada aqui toca saldo (Article 8): `cancel_job` só recusa quando há pagamento/escrow vivo.
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { toBrazilDateOnly } from '../lib/dateUtils';

// ── Janela do turno (para get_busy_workers) ──────────────────────────────────────────────────

export interface ShiftWindow {
  /** ISO com offset -03:00 (America/Sao_Paulo não tem horário de verão desde 2019). */
  start: string;
  end: string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function normalizeTime(time: string | null | undefined): string | null {
  if (!time) return null;
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(time);
  if (!m) return null;
  return `${m[1]}:${m[2]}:${m[3] ?? '00'}`;
}

function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Espelha a janela que o banco calcula para cada turno: data local de `start_date` + horário de
 * entrada/saída (cruza a meia-noite quando a saída é <= à entrada); sem horário = o dia inteiro.
 * `null` quando o turno não tem data (nada a comparar).
 */
export function buildShiftWindow(
  startDate: string | null | undefined,
  startTime?: string | null,
  endTime?: string | null,
): ShiftWindow | null {
  if (!startDate) return null;
  const day = DATE_ONLY.test(startDate) ? startDate : toBrazilDateOnly(startDate);
  if (!DATE_ONLY.test(day)) return null;

  const t0 = normalizeTime(startTime);
  const t1 = normalizeTime(endTime);
  const start = `${day}T${t0 ?? '00:00:00'}-03:00`;
  let end: string;
  if (!t0 || !t1) {
    end = `${addDays(day, 1)}T00:00:00-03:00`;
  } else if (t1 > t0) {
    end = `${day}T${t1}-03:00`;
  } else {
    end = `${addDays(day, 1)}T${t1}-03:00`;
  }
  return { start, end };
}

// ── Tipos ────────────────────────────────────────────────────────────────────────────────────

export type ReassignOutcome = 'ok' | 'nothing_moved' | 'invalid_input' | 'unauthenticated' | 'error';
export interface ReassignResult {
  outcome: ReassignOutcome;
  moved: number;
  skipped: number;
}

export type CoverageOutcome =
  | 'created'
  | 'already_covered'
  | 'starts_in_the_past'
  | 'overlaps'
  | 'from_is_gestor'
  | 'invalid_input'
  | 'invalid_window'
  | 'window_too_long'
  | 'in_the_past'
  | 'too_far'
  | 'from_not_encarregado'
  | 'to_not_encarregado'
  | 'forbidden'
  | 'unauthenticated'
  | 'error';
export interface CoverageResult {
  outcome: CoverageOutcome;
  coverageId?: string;
  existingStartsOn?: string;
  existingEndsOn?: string;
}

export type EndCoverageOutcome =
  | 'ended'
  | 'already_ended'
  | 'not_found'
  | 'forbidden'
  | 'invalid_input'
  | 'unauthenticated'
  | 'error';

export type CancelJobOutcome =
  | 'cancelled'
  | 'already_cancelled'
  | 'active_payment'
  | 'active_escrow'
  | 'attendance_started'
  | 'job_in_the_past'
  | 'forbidden'
  | 'not_found'
  | 'invalid_input'
  | 'unauthenticated'
  | 'unavailable'
  | 'error';
export interface CancelJobResult {
  outcome: CancelJobOutcome;
  cancelledApplications: number;
  cancelledCalls: number;
  closedCandidates: number;
}

export interface CompanyTag {
  id: string;
  name: string;
  archivedAt: string | null;
}
export type TagOutcome =
  | 'created'
  | 'reactivated'
  | 'already_exists'
  | 'archived'
  | 'already_archived'
  | 'renamed'
  | 'default_of_members'
  | 'ok'
  | 'invalid_tag'
  | 'job_deleted'
  | 'not_found'
  | 'forbidden'
  | 'invalid_input'
  | 'unauthenticated'
  | 'error';

/** Quem responde pelo turno, já resolvido no banco (R19). */
export type ResponsibleKind = 'person' | 'gestor' | 'self' | 'covering';

export interface TodayJob {
  jobId: string;
  title: string;
  status: string;
  /** Data local do turno, `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM` ou null. */
  startTime: string | null;
  slots: number | null;
  filled: number | null;
  responsibleId: string | null;
  responsibleKind: ResponsibleKind;
  /** Texto pronto: nome da pessoa, "Gestor", "Você" ou "Cobertura". */
  responsibleLabel: string;
  /** "criado por {nome}" quando a pessoa responsável foi removida. */
  creatorLabel: string | null;
  tagId: string | null;
  tagName: string | null;
  tagArchived: boolean;
}

export type ListJobsOutcome = 'ok' | 'forbidden' | 'invalid_range' | 'invalid_input' | 'unauthenticated' | 'error';

export interface ActiveCoverage {
  id: string;
  fromUserId: string;
  toUserId: string;
  startsOn: string;
  endsOn: string;
}

interface RpcJson {
  outcome?: string;
  moved?: number;
  skipped?: number;
  coverage_id?: string;
  existing_starts_on?: string;
  existing_ends_on?: string;
  cancelled_applications?: number;
  cancelled_calls?: number;
  closed_candidates?: number;
  tag_id?: string;
  count?: number;
  truncated?: boolean;
  items?: RpcJobItem[];
}

interface RpcJobItem {
  job_id: string;
  title: string | null;
  status: string | null;
  date: string;
  start_time: string | null;
  slots: number | null;
  filled: number | null;
  responsible_id: string | null;
  responsible_kind: string;
  responsible_label: string | null;
  creator_label: string | null;
  tag_id: string | null;
  tag_name: string | null;
  tag_archived: boolean | null;
}

function outcomeOf<O extends string>(row: RpcJson | null | undefined): O {
  return (typeof row?.outcome === 'string' ? row.outcome : 'error') as O;
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

// ── Aviso de conflito (R14) ──────────────────────────────────────────────────────────────────

/** Limite de ids por chamada de `get_busy_workers` (acima disso a RPC recusa com invalid_input). */
const BUSY_BATCH_SIZE = 200;

/**
 * Freelas do Elenco que já estão ocupados na janela, em turno de QUALQUER responsável da empresa.
 * Devolve só ids (o banco não diz qual turno, nem de quem). NUNCA lança e nunca bloqueia: erro
 * (RPC ausente, sem permissão, rede) → conjunto vazio + log = "sem aviso".
 */
export async function getBusyWorkerIds(params: {
  companyId: string;
  window: ShiftWindow | null;
  workerIds: string[];
  excludeJobId?: string | null;
}): Promise<Set<string>> {
  const { companyId, window: win, workerIds, excludeJobId } = params;
  if (!win || workerIds.length === 0) return new Set();
  // A RPC aceita no máximo 200 ids por chamada (acima disso recusa tudo): divide em lotes. Lote que
  // falha vira "sem aviso" só para ele, e os demais seguem.
  const busy = new Set<string>();
  for (let i = 0; i < workerIds.length; i += BUSY_BATCH_SIZE) {
    try {
      const { data, error } = await supabase.rpc('get_busy_workers', {
        p_company_id: companyId,
        p_start: win.start,
        p_end: win.end,
        p_worker_ids: workerIds.slice(i, i + BUSY_BATCH_SIZE),
        p_exclude_job_id: excludeJobId ?? null,
      });
      if (error) throw error;
      ((data ?? []) as Array<{ worker_id: string }>).forEach((r) => busy.add(r.worker_id));
    } catch (err) {
      logError('shiftOperation.getBusyWorkerIds', err);
    }
  }
  return busy;
}

// ── Passar / Cobrir (R18) ────────────────────────────────────────────────────────────────────

export type OperatorRole = 'gestor' | 'encarregado';

export interface CompanyOperator {
  userId: string;
  label: string;
  /** Papel do operador (a RPC devolve a coluna `role`). */
  role: OperatorRole;
}

/**
 * Quem pode receber "Passar para..." / "Cobrir": Gestores e encarregados ATIVOS e CONFIRMADOS
 * (`list_company_operators`; só user_id + rótulo, sem e-mail). Autorizada a Gestor e a encarregado
 * confirmado; quem não passa recebe erro 42501 — por isso `ok: false` (nunca "lista vazia" falsa).
 * Nunca lança: a tela mostra a mensagem e segue funcionando.
 */
export async function listCompanyOperators(
  companyId: string,
): Promise<{ ok: boolean; items: CompanyOperator[] }> {
  try {
    const { data, error } = await supabase.rpc('list_company_operators', { p_company_id: companyId });
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : []) as Array<{ user_id: string; label: string | null; role?: string | null }>;
    return {
      ok: true,
      items: rows.map((r) => ({
        userId: r.user_id,
        label: r.label?.trim() || 'Sem nome',
        // Papel desconhecido nunca vira "encarregado": cobertura só aceita encarregado.
        role: r.role === 'encarregado' ? ('encarregado' as const) : ('gestor' as const),
      })),
    };
  } catch (err) {
    logError('shiftOperation.listCompanyOperators', err);
    return { ok: false, items: [] };
  }
}

export async function reassignJobs(jobIds: string[], toUserId: string): Promise<ReassignResult> {
  try {
    const { data, error } = await supabase.rpc('reassign_job_responsible', {
      p_job_ids: jobIds,
      p_to: toUserId,
    });
    if (error) throw error;
    const row = (data ?? null) as RpcJson | null;
    return { outcome: outcomeOf<ReassignOutcome>(row), moved: num(row?.moved), skipped: num(row?.skipped) };
  } catch (err) {
    logError('shiftOperation.reassignJobs', err);
    return { outcome: 'error', moved: 0, skipped: 0 };
  }
}

export const MAX_COVERAGE_DAYS = 60;

export async function createCoverage(params: {
  companyId: string;
  fromUserId: string;
  toUserId: string;
  startsOn: string;
  endsOn: string;
}): Promise<CoverageResult> {
  try {
    const { data, error } = await supabase.rpc('create_responsibility_coverage', {
      p_company_id: params.companyId,
      p_from: params.fromUserId,
      p_to: params.toUserId,
      p_starts_on: params.startsOn,
      p_ends_on: params.endsOn,
    });
    if (error) throw error;
    const row = (data ?? null) as RpcJson | null;
    return {
      outcome: outcomeOf<CoverageOutcome>(row),
      coverageId: row?.coverage_id,
      existingStartsOn: row?.existing_starts_on,
      existingEndsOn: row?.existing_ends_on,
    };
  } catch (err) {
    logError('shiftOperation.createCoverage', err);
    return { outcome: 'error' };
  }
}

export async function endCoverage(coverageId: string): Promise<{ outcome: EndCoverageOutcome }> {
  try {
    const { data, error } = await supabase.rpc('end_responsibility_coverage', { p_coverage_id: coverageId });
    if (error) throw error;
    return { outcome: outcomeOf<EndCoverageOutcome>((data ?? null) as RpcJson | null) };
  } catch (err) {
    logError('shiftOperation.endCoverage', err);
    return { outcome: 'error' };
  }
}

/** Coberturas vigentes (não encerradas, ainda por terminar) que a sessão pode ler (partes ou Gestor). */
export async function listActiveCoverages(companyId: string, today: string): Promise<ActiveCoverage[]> {
  return (await listActiveCoveragesChecked(companyId, today)).items;
}

/** Igual a `listActiveCoverages`, mas distingue "nenhuma" de "falhou ao carregar". */
export async function listActiveCoveragesChecked(
  companyId: string,
  today: string,
): Promise<{ ok: boolean; items: ActiveCoverage[] }> {
  try {
    const { data, error } = await supabase
      .from('responsibility_coverages')
      .select('id, from_user_id, to_user_id, starts_on, ends_on')
      .eq('company_id', companyId)
      .is('revoked_at', null)
      .gte('ends_on', today)
      .order('starts_on', { ascending: true });
    if (error) throw error;
    const items = ((data ?? []) as Array<{
      id: string;
      from_user_id: string;
      to_user_id: string;
      starts_on: string;
      ends_on: string;
    }>).map((c) => ({
      id: c.id,
      fromUserId: c.from_user_id,
      toUserId: c.to_user_id,
      startsOn: c.starts_on,
      endsOn: c.ends_on,
    }));
    return { ok: true, items };
  } catch (err) {
    logError('shiftOperation.listActiveCoverages', err);
    return { ok: false, items: [] };
  }
}

/** Último dia da cobertura, no formato `YYYY-MM-DD` (para mostrar o fim automático). */
export function coverageEndDate(startsOn: string, days: number): string {
  return addDays(startsOn, Math.max(1, days) - 1);
}

/** Dias corridos (inclusive) entre duas datas `YYYY-MM-DD`; NaN se inválidas. */
export function coverageSpanDays(startsOn: string, endsOn: string): number {
  if (!DATE_ONLY.test(startsOn) || !DATE_ONLY.test(endsOn)) return Number.NaN;
  const a = Date.parse(`${startsOn}T00:00:00Z`);
  const b = Date.parse(`${endsOn}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

// ── Cancelar turno inteiro (R27) ─────────────────────────────────────────────────────────────

export async function cancelJob(jobId: string, reason?: string): Promise<CancelJobResult> {
  try {
    const { data, error } = await supabase.rpc('cancel_job', {
      p_job_id: jobId,
      p_reason: reason?.trim() ? reason.trim() : null,
    });
    if (error) throw error;
    const row = (data ?? null) as RpcJson | null;
    return {
      outcome: outcomeOf<CancelJobOutcome>(row),
      cancelledApplications: num(row?.cancelled_applications),
      cancelledCalls: num(row?.cancelled_calls),
      closedCandidates: num(row?.closed_candidates),
    };
  } catch (err) {
    logError('shiftOperation.cancelJob', err);
    const missing = isMissingFunction(err);
    if (missing) cancelJobAvailability = Promise.resolve(false);
    return { outcome: missing ? 'unavailable' : 'error', cancelledApplications: 0, cancelledCalls: 0, closedCandidates: 0 };
  }
}

function isMissingFunction(err: unknown): boolean {
  const e = (err ?? {}) as { code?: string; message?: string };
  return e.code === 'PGRST202' || /Could not find the function/i.test(e.message ?? '');
}

let cancelJobAvailability: Promise<boolean> | null = null;

/** Só para testes: esquece a sondagem. */
export function resetCancelJobAvailability(): void {
  cancelJobAvailability = null;
}

/**
 * A RPC `cancel_job` existe neste ambiente? (o front pode subir antes da migration E5). Sonda
 * INÓCUA: com `p_job_id` nulo a função devolve `invalid_input` antes de ler ou gravar qualquer coisa.
 * Só "função inexistente" (PGRST202) esconde o botão; falha de rede não é cacheada.
 */
export function isCancelJobAvailable(): Promise<boolean> {
  if (cancelJobAvailability) return cancelJobAvailability;
  const probe = (async () => {
    try {
      const { error } = await supabase.rpc('cancel_job', { p_job_id: null, p_reason: null });
      if (error && isMissingFunction(error)) return false;
      if (error) cancelJobAvailability = null;
      return true;
    } catch {
      cancelJobAvailability = null;
      return true;
    }
  })();
  cancelJobAvailability = probe;
  return probe;
}

/** Texto em português claro, neutro de gênero, para cada desfecho do cancelamento. */
export type ViewerRole = 'gestor' | 'encarregado';

export function cancelJobMessage(result: CancelJobResult, role: ViewerRole = 'gestor'): string {
  switch (result.outcome) {
    case 'cancelled': {
      const total = result.cancelledApplications + result.closedCandidates;
      if (total === 0) return 'Turno cancelado. Não havia ninguém no turno.';
      return total === 1
        ? 'Turno cancelado. 1 pessoa foi avisada.'
        : `Turno cancelado. ${total} pessoas foram avisadas.`;
    }
    case 'already_cancelled':
      return 'Esse turno já estava cancelado.';
    case 'active_payment':
      return role === 'gestor'
        ? 'Esse turno tem pagamento agendado ou registrado. Estorne o pagamento registrado antes de cancelar o turno.'
        : 'Esse turno tem pagamento agendado ou registrado. Peça ao Gestor para estornar o pagamento antes de cancelar.';
    case 'active_escrow':
      return 'Este turno tem uma reserva de saldo ativa; fale com o suporte do Workyn.';
    case 'attendance_started':
      return 'Esse turno já teve presença registrada. Não dá para cancelar um turno que já começou.';
    case 'job_in_the_past':
      return 'Esse turno já começou ou já passou. Só o Gestor consegue cancelar nesse caso.';
    case 'forbidden':
      return 'Você não tem permissão para cancelar esse turno.';
    case 'not_found':
      return 'Não encontramos esse turno. A lista foi atualizada.';
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre de novo.';
    case 'unavailable':
      return 'O cancelamento por aqui ainda não está disponível. Nada foi alterado.';
    default:
      return 'Não foi possível cancelar o turno agora. Tente de novo em instantes.';
  }
}

/** O desfecho recusou sem alterar nada (turno intacto)? */
/** Aviso do gesto "Excluir turno". */
export function deleteShiftToast(result: CancelJobResult): string {
  const total = result.cancelledApplications + result.closedCandidates;
  if (total === 0) return 'Turno excluído.';
  return `Turno cancelado. ${total} freela${total > 1 ? 's' : ''} avisado${total > 1 ? 's' : ''}.`;
}

export function cancelJobWasRefused(outcome: CancelJobOutcome): boolean {
  return ['active_payment', 'active_escrow', 'attendance_started', 'job_in_the_past', 'forbidden'].includes(outcome);
}

export function reassignMessage(result: ReassignResult): string {
  if (result.outcome === 'ok') {
    const base = result.moved === 1 ? '1 turno foi passado.' : `${result.moved} turnos foram passados.`;
    return result.skipped > 0
      ? `${base} ${result.skipped === 1 ? '1 turno não pôde ser passado.' : `${result.skipped} turnos não puderam ser passados.`}`
      : base;
  }
  if (result.outcome === 'nothing_moved') {
    return 'Nenhum turno foi passado. Eles já podem estar com essa pessoa, ou você não pode passá-los.';
  }
  if (result.outcome === 'unauthenticated') return 'Sua sessão expirou. Entre de novo.';
  return 'Não foi possível passar o turno agora. Tente de novo em instantes.';
}

export function coverageMessage(result: CoverageResult): string {
  switch (result.outcome) {
    case 'starts_in_the_past':
      return 'A cobertura precisa começar hoje (ou ontem).';
    case 'created':
      return 'Cobertura criada. As duas pessoas foram avisadas.';
    case 'already_covered':
      return 'Esse período já está coberto por essa pessoa.';
    case 'overlaps':
      return result.existingStartsOn && result.existingEndsOn
        ? `Já existe uma cobertura entre essas pessoas de ${formatShortDate(result.existingStartsOn)} a ${formatShortDate(result.existingEndsOn)}. Encerre essa cobertura ou escolha outro período.`
        : 'Já existe uma cobertura entre essas pessoas nesse período. Encerre essa cobertura ou escolha outro período.';
    case 'from_is_gestor':
      return 'Gestor não precisa de cobertura: ele já opera todos os turnos.';
    case 'from_not_encarregado':
    case 'to_not_encarregado':
      return 'A cobertura é entre duas pessoas encarregadas, ativas e confirmadas.';
    case 'invalid_window':
      return 'A data final precisa ser igual ou depois da data inicial.';
    case 'window_too_long':
      return `A cobertura pode durar no máximo ${MAX_COVERAGE_DAYS} dias.`;
    case 'in_the_past':
      return 'Esse período já terminou. Escolha datas a partir de hoje.';
    case 'too_far':
      return 'O início da cobertura está longe demais. Escolha uma data dentro do próximo ano.';
    case 'forbidden':
      return 'Você não tem permissão para criar essa cobertura.';
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre de novo.';
    case 'invalid_input':
      return 'Escolha duas pessoas diferentes e o período.';
    default:
      return 'Não foi possível criar a cobertura agora. Tente de novo em instantes.';
  }
}

function formatShortDate(dateOnly: string): string {
  const [, m, d] = dateOnly.split('-');
  return m && d ? `${d}/${m}` : dateOnly;
}

// ── Tags (R20) ───────────────────────────────────────────────────────────────────────────────

export async function listTags(companyId: string, includeArchived = false): Promise<CompanyTag[]> {
  return (await listTagsChecked(companyId, includeArchived)).items;
}

/** Igual a `listTags`, mas distingue "nenhuma etiqueta" de "falhou ao carregar". */
export async function listTagsChecked(
  companyId: string,
  includeArchived = false,
): Promise<{ ok: boolean; items: CompanyTag[] }> {
  try {
    let query = supabase
      .from('company_tags')
      .select('id, name, archived_at')
      .eq('company_id', companyId)
      .order('name', { ascending: true });
    if (!includeArchived) query = query.is('archived_at', null);
    const { data, error } = await query;
    if (error) throw error;
    const items = ((data ?? []) as Array<{ id: string; name: string; archived_at: string | null }>).map((t) => ({
      id: t.id,
      name: t.name,
      archivedAt: t.archived_at,
    }));
    return { ok: true, items };
  } catch (err) {
    logError('shiftOperation.listTags', err);
    return { ok: false, items: [] };
  }
}

export async function createTag(companyId: string, name: string): Promise<{ outcome: TagOutcome; tagId?: string }> {
  try {
    const { data, error } = await supabase.rpc('create_company_tag', { p_company_id: companyId, p_name: name });
    if (error) throw error;
    const row = (data ?? null) as RpcJson | null;
    return { outcome: outcomeOf<TagOutcome>(row), tagId: row?.tag_id };
  } catch (err) {
    logError('shiftOperation.createTag', err);
    return { outcome: 'error' };
  }
}

/** `count` só vem em `default_of_members`: quantas pessoas (convidadas ou ativas) têm a loja como padrão. */
export async function archiveTag(tagId: string): Promise<{ outcome: TagOutcome; count?: number }> {
  try {
    const { data, error } = await supabase.rpc('archive_company_tag', { p_tag_id: tagId });
    if (error) throw error;
    const row = (data ?? null) as RpcJson | null;
    const outcome = outcomeOf<TagOutcome>(row);
    return outcome === 'default_of_members' ? { outcome, count: num(row?.count) } : { outcome };
  } catch (err) {
    logError('shiftOperation.archiveTag', err);
    return { outcome: 'error' };
  }
}

/** Renomeia a loja (só Gestor). O id é a chave fiscal: relatórios passados passam a mostrar o nome novo. */
export async function renameTag(tagId: string, name: string): Promise<{ outcome: TagOutcome }> {
  try {
    const { data, error } = await supabase.rpc('rename_company_tag', { p_tag_id: tagId, p_name: name });
    if (error) throw error;
    return { outcome: outcomeOf<TagOutcome>((data ?? null) as RpcJson | null) };
  } catch (err) {
    logError('shiftOperation.renameTag', err);
    return { outcome: 'error' };
  }
}

/** `tagId = null` limpa a etiqueta do turno. */
export async function setJobTag(jobId: string, tagId: string | null): Promise<{ outcome: TagOutcome }> {
  try {
    const { data, error } = await supabase.rpc('set_job_tag', { p_job_id: jobId, p_tag_id: tagId });
    if (error) throw error;
    return { outcome: outcomeOf<TagOutcome>((data ?? null) as RpcJson | null) };
  } catch (err) {
    logError('shiftOperation.setJobTag', err);
    return { outcome: 'error' };
  }
}

/** `assign` = atribuir etiqueta a um turno (quem opera o turno); `manage` = criar/arquivar (só o Gestor). */
export function tagMessage(outcome: TagOutcome, context: 'manage' | 'assign' = 'manage'): string {
  switch (outcome) {
    case 'created':
      return 'Loja criada.';
    case 'reactivated':
      return 'Essa loja já existia arquivada. Ela voltou a ficar disponível.';
    case 'already_exists':
      return 'Já existe uma loja com esse nome.';
    case 'archived':
      return 'Loja arquivada. Os turnos antigos continuam com ela.';
    case 'already_archived':
      return 'Essa loja já estava arquivada.';
    case 'renamed':
      return 'Nome atualizado. Os relatórios passados passam a mostrar o nome novo.';
    case 'default_of_members':
      return 'Essa loja é o padrão de alguém da equipe. Troque a loja dessa pessoa antes de arquivar.';
    case 'invalid_input':
      return 'Use um nome de 1 a 40 caracteres.';
    case 'invalid_tag':
      return 'Essa loja não está mais disponível. Escolha outra.';
    case 'job_deleted':
      return 'Esse turno foi cancelado.';
    case 'forbidden':
      return context === 'assign'
        ? 'Você não pode alterar a loja deste turno.'
        : 'Só o Gestor pode criar ou arquivar lojas.';
    case 'not_found':
      return 'Não encontramos o item. A lista foi atualizada.';
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre de novo.';
    default:
      return 'Não foi possível concluir agora. Tente de novo em instantes.';
  }
}

// ── Hoje (R25) ───────────────────────────────────────────────────────────────────────────────

function hhmm(time: string | null | undefined): string | null {
  return time && time.length >= 5 ? time.slice(0, 5) : null;
}

/**
 * Gestor: todos os turnos da empresa na janela, com responsável efetivo resolvido no banco (R19) e
 * filtro por pessoa e etiqueta. Só o Gestor pode chamar (a RPC recusa o resto).
 */
export async function listJobsByResponsible(params: {
  companyId: string;
  from: string;
  to: string;
  responsibleId?: string | null;
  tagId?: string | null;
}): Promise<{ outcome: ListJobsOutcome; truncated: boolean; items: TodayJob[] }> {
  try {
    const { data, error } = await supabase.rpc('list_jobs_by_responsible', {
      p_company_id: params.companyId,
      p_from: params.from,
      p_to: params.to,
      p_responsible_id: params.responsibleId ?? null,
      p_tag_id: params.tagId ?? null,
    });
    if (error) throw error;
    const row = (data ?? null) as RpcJson | null;
    const outcome = outcomeOf<ListJobsOutcome>(row);
    if (outcome !== 'ok') return { outcome, truncated: false, items: [] };
    const items = (row?.items ?? []).map((i): TodayJob => ({
      jobId: i.job_id,
      title: i.title ?? 'Turno sem título',
      status: i.status ?? '',
      date: i.date,
      startTime: hhmm(i.start_time),
      slots: i.slots,
      filled: i.filled,
      responsibleId: i.responsible_id,
      responsibleKind: i.responsible_kind === 'person' ? 'person' : 'gestor',
      responsibleLabel: i.responsible_label?.trim() || 'Gestor',
      creatorLabel: i.creator_label?.trim() || null,
      tagId: i.tag_id,
      tagName: i.tag_name,
      tagArchived: i.tag_archived === true,
    }));
    return { outcome: 'ok', truncated: row?.truncated === true, items };
  } catch (err) {
    logError('shiftOperation.listJobsByResponsible', err);
    return { outcome: 'error', truncated: false, items: [] };
  }
}

interface JobRow {
  id: string;
  title: string | null;
  status: string | null;
  slots: number | null;
  tag_id: string | null;
  responsible_id: string | null;
  start_date: string | null;
  work_start_time: string | null;
}

/** Janela [from, to] (datas locais) como limites de timestamptz em America/Sao_Paulo. */
function dayBounds(from: string, to: string): { gte: string; lt: string } {
  return { gte: `${from}T00:00:00-03:00`, lt: `${addDays(to, 1)}T00:00:00-03:00` };
}

/**
 * Encarregado: só os turnos DELE (responsável) e os que ele cobre na janela da cobertura. A UI do
 * encarregado nunca consulta nem mostra turno alheio (R9); a barreira real é o RLS.
 */
export async function listOwnJobs(params: {
  companyId: string;
  userId: string;
  from: string;
  to: string;
  tagId?: string | null;
}): Promise<{ outcome: ListJobsOutcome; items: TodayJob[] }> {
  try {
    const { companyId, userId, from, to, tagId } = params;
    const coverages = (await listActiveCoverages(companyId, from)).filter(
      (c) => c.toUserId === userId && c.startsOn <= to,
    );

    const tagRows = await listTags(companyId, true);
    const tagNames = new Map(tagRows.map((t) => [t.id, t]));

    const select = 'id, title, status, slots, tag_id, responsible_id, start_date, work_start_time';
    const fetchRange = async (responsibleId: string, a: string, b: string): Promise<JobRow[]> => {
      const bounds = dayBounds(a, b);
      let q = supabase
        .from('jobs')
        .select(select)
        .eq('company_id', companyId)
        .eq('responsible_id', responsibleId)
        .neq('status', 'deleted')
        .gte('start_date', bounds.gte)
        .lt('start_date', bounds.lt);
      if (tagId) q = q.eq('tag_id', tagId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as JobRow[];
    };

    const own = await fetchRange(userId, from, to);
    const filledByJob = new Map<string, number>();
    const covered = await Promise.all(
      coverages.map(async (c) => {
        const a = c.startsOn > from ? c.startsOn : from;
        const b = c.endsOn < to ? c.endsOn : to;
        return b < a ? [] : fetchRange(c.fromUserId, a, b);
      }),
    );

    // Vagas preenchidas de verdade (best-effort): se a leitura falhar, `filled` fica null e a tela
    // mostra só o total de vagas, sem inventar número.
    let filledKnown = false;
    try {
      const ids = [...new Set([...own, ...covered.flat()].map((r) => r.id))];
      if (ids.length > 0) {
        const { data, error } = await supabase
          .from('applications')
          .select('job_id')
          .in('job_id', ids)
          .in('status', ['hired', 'in_progress', 'completed']);
        if (error) throw error;
        ((data ?? []) as Array<{ job_id: string }>).forEach((a) => filledByJob.set(a.job_id, (filledByJob.get(a.job_id) ?? 0) + 1));
        filledKnown = true;
      }
    } catch (err) {
      logError('shiftOperation.listOwnJobs.filled', err);
    }

    const toItem = (row: JobRow, kind: ResponsibleKind): TodayJob | null => {
      if (!row.start_date) return null;
      const tag = row.tag_id ? tagNames.get(row.tag_id) : undefined;
      return {
        jobId: row.id,
        title: row.title ?? 'Turno sem título',
        status: row.status ?? '',
        date: toBrazilDateOnly(row.start_date),
        startTime: hhmm(row.work_start_time),
        slots: row.slots,
        filled: filledKnown ? (filledByJob.get(row.id) ?? 0) : null,
        responsibleId: row.responsible_id,
        responsibleKind: kind,
        responsibleLabel: kind === 'self' ? 'Você' : 'Você cobre um colega',
        creatorLabel: null,
        tagId: row.tag_id,
        tagName: tag?.name ?? null,
        tagArchived: tag?.archivedAt != null,
      };
    };

    const items = [
      ...own.map((r) => toItem(r, 'self')),
      ...covered.flat().map((r) => toItem(r, 'covering')),
    ].filter((i): i is TodayJob => i !== null);

    const seen = new Set<string>();
    const unique = items.filter((i) => (seen.has(i.jobId) ? false : (seen.add(i.jobId), true)));
    unique.sort((a, b) => (a.date + (a.startTime ?? '99:99')).localeCompare(b.date + (b.startTime ?? '99:99')));
    return { outcome: 'ok', items: unique };
  } catch (err) {
    logError('shiftOperation.listOwnJobs', err);
    return { outcome: 'error', items: [] };
  }
}
