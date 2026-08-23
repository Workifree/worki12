/**
 * OperationAnalyticsService — Analytics de operação da empresa (F9, painel `/company/operacao`).
 *
 * Ver `.harness/spec/analytics-operacao/prd.md` (fonte normativa — vence a spec quando divergir)
 * e `.harness/spec/analytics-operacao/spec.md` (R1–R19, A1–A19).
 *
 * SOMENTE LEITURA (Article 8 intacto). Nenhuma escrita, nenhuma RPC de saldo, nenhum import de
 * `walletService`. O gasto é lido de `shift_payments` (modo A) e `escrow_transactions` (modos
 * B/C) — sempre leitura.
 *
 * ARQUITETURA (D1 do PRD): agregação CLIENT-SIDE, não RPC/view. Duas funções separadas:
 *   - `collectRawData` (Step 3): busca as linhas brutas do Supabase, paginado, escopo duplo.
 *   - `aggregate` (Step 4/5, D5.4): função PURA sobre as linhas brutas — testável sem Supabase,
 *     reutilizável por unidade quando F13 (multi-unidade) chegar.
 *
 * GUARDA 1 (D1) — ancoragem dupla: `resolveCompanyScope()` é o ÚNICO ponto do frontend que muda
 * quando `is_job_owner`/`is_company_owner` forem unificadas (F13). TODA query usa `.in('company_id',
 * scopeIds)` — nunca `.eq('company_id', user.id)` (bug latente de `orderReportService.ts`,
 * registrado como dívida, R-7 do PRD — não corrigido aqui, fora de escopo desta feature).
 *
 * GUARDA 2 (D1) — truncamento proibido em silêncio: toda leitura de coleção pagina explicitamente
 * (`.range`) em laço até vir página incompleta, com `MAX_PAGES` de segurança. Se `MAX_PAGES` for
 * atingido, `truncated: true` sobe até `OperationAnalytics` inteiro — a UI é obrigada a mostrar a
 * faixa de truncamento (A16), nunca um número parcial sem esse rótulo.
 *
 * D6 — cada bloco devolve um `MetricBlock<T>` (`sem-fonte` | `amostra-insuficiente` | `ok`).
 * `loading` é responsabilidade da UI (este service não fica "em voo" no seu próprio retorno).
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { toBrazilDateOnly, calculateWorkedHours, formatDurationMs } from '../lib/dateUtils';
import type {
  ShiftCallReason,
  OperationAnalytics,
  SpendSummaryBlock,
  HiresSummaryBlock,
  CostPerHourSummaryBlock,
  HoursRatioSummaryBlock,
  FillTimeStatsBlock,
  CallsByStatusBlock,
  CallsByReasonBlock,
  WorkerAcceptanceBlock,
  WorkerAttendanceBlock,
  WorkerPerformanceBlock,
  AttendanceConfirmationsBlock,
  PeriodDelta,
} from '../types';

// ---------------------------------------------------------------------------
// Constantes de produto (código, não configuráveis na UI v1 — ver PRD D2c/D4/D5)
// ---------------------------------------------------------------------------

/** PostgREST corta em 1000 linhas por página por default no Supabase (D1 guarda 2). */
export const PAGE_SIZE = 1000;
/** Teto de segurança: 10 páginas = até 10.000 linhas por fonte antes de reportar `truncated`. */
export const MAX_PAGES = 10;
/** D2c — duração acima disto é "marcação inconsistente" (checkout esquecido), descartada do cálculo. */
export const MAX_PLAUSIBLE_SHIFT_HOURS = 18;
/** R15 (D7) — tolerância de atraso, constante de código, não configurável na v1. */
export const LATE_TOLERANCE_MINUTES = 10;
/** R12/R15 — amostra mínima antes de calcular %, para não precipitar 0%/100% de 1 caso. */
export const MIN_SAMPLE_SIZE = 2;

/** Período em data civil BRASILEIRA (`YYYY-MM-DD`), inclusive nas duas pontas. */
export interface OperationAnalyticsPeriod {
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Tipos internos de linha bruta (partial select — não força mudança de schema global)
// ---------------------------------------------------------------------------

interface JobRow {
  id: string;
  company_id: string;
  status: string;
  start_date: string | null;
  created_at: string | null;
  work_start_time: string | null;
  work_end_time: string | null;
  estimated_hours: number | null;
  budget: number | null;
}

interface ApplicationRow {
  id: string;
  job_id: string;
  worker_id: string;
  status: string;
  worker_checkin_at: string | null;
  worker_checkout_at: string | null;
  company_checkin_confirmed_at: string | null;
  company_checkout_confirmed_at: string | null;
}

interface ShiftPaymentRow {
  job_id: string;
  worker_id: string;
  amount: number;
  status: string;
  paid_at: string | null;
}

interface EscrowRow {
  job_id: string;
  application_id: string | null;
  amount: number;
  status: string;
  released_at: string | null;
  captured_at: string | null;
}

interface ShiftCallRow {
  id: string;
  job_id: string;
  company_id: string;
  reason: string;
  status: string;
  created_at: string;
  first_claim_at: string | null;
}

interface ShiftCallTargetRow {
  call_id: string;
  worker_id: string;
  responded_at: string | null;
  response: string | null;
}

interface WorkerRow {
  id: string;
  full_name: string | null;
  rating_average: number | null;
}

interface AttendanceConfirmationRow {
  job_id: string;
  requested_at: string;
  responded_at: string | null;
  response: string | null;
}

/**
 * Linhas brutas coletadas do Supabase, ainda SEM agregação (D5.4 — a agregação é função pura
 * separada, `aggregate`). Cada linha carrega a unidade de origem (`company_id`/`job_id`
 * resolvível), mesmo que a UI v1 some tudo (D5.3 — preparado para F13).
 */
export interface RawAnalyticsData {
  scopeCompanyIds: string[];
  truncated: boolean;
  /** `true` quando QUALQUER fonte paginada falhou a leitura (erro de rede/RLS/coluna inexistente). */
  hasError: boolean;
  jobs: JobRow[];
  applications: ApplicationRow[];
  shiftPayments: ShiftPaymentRow[];
  escrow: EscrowRow[];
  shiftCalls: ShiftCallRow[];
  shiftCallTargets: ShiftCallTargetRow[];
  workers: Map<string, WorkerRow>;
  attendanceConfirmations: AttendanceConfirmationRow[];
}

// ---------------------------------------------------------------------------
// Helpers de data — instantes SEMPRE, nunca comparação de timestamptz com string YYYY-MM-DD.
//
// Por que offset `-03:00` explícito aqui é DIFERENTE do que `dateUtils.ts` proíbe: `dateUtils`
// evita offset hardcoded ao LER um instante (`toBrazilDateOnly` usa `Intl` com timeZone explícito
// porque não sabemos, a priori, se algum dia o Brasil volta a ter DST). Aqui é o caminho inverso —
// CONSTRUIR um instante a partir de uma data civil BR já conhecida — e o offset `-03:00` na string
// ISO é interpretado pelo parser de `Date` de forma determinística em qualquer motor/fuso de
// dispositivo (ao contrário de `new Date(dateStr + 'T00:00:00')`, que usaria o fuso do
// dispositivo). Continua sendo uma premissa "Brasil não tem DST hoje" — mas expressa no único
// lugar que constrói instantes de fronteira de período, não espalhada.
// ---------------------------------------------------------------------------

const BR_OFFSET = '-03:00';

function brazilDayStart(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000${BR_OFFSET}`);
}

function brazilDayEnd(dateOnly: string): Date {
  return new Date(`${dateOnly}T23:59:59.999${BR_OFFSET}`);
}

/** Soma dias (pode ser negativo) a uma data civil `YYYY-MM-DD`, em aritmética UTC pura de calendário. */
function addDaysToDateOnly(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const utcMs = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(utcMs).toISOString().slice(0, 10);
}

/** Diferença em dias entre duas datas civis `YYYY-MM-DD` (aritmética UTC pura de calendário). */
function daysBetweenDateOnly(fromDateOnly: string, toDateOnly: string): number {
  const [y1, m1, d1] = fromDateOnly.split('-').map(Number);
  const [y2, m2, d2] = toDateOnly.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

function isInRange(iso: string | null | undefined, start: Date, end: Date): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= start.getTime() && t <= end.getTime();
}

/** `HH:MM` ou `HH:MM:SS` → minutos desde a meia-noite. `null` se ausente/ininteligível. */
function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

/** Instante (America/Sao_Paulo) de uma data civil + minutos-desde-meia-noite. */
function brazilInstantFromDateAndMinutes(dateOnly: string, minutes: number): Date {
  return new Date(brazilDayStart(dateOnly).getTime() + minutes * 60_000);
}

/**
 * D7 (correção de schema mais importante do PRD) — instante de TÉRMINO esperado do turno.
 * NUNCA `start_date + estimated_hours` (empurraria turnos noturnos para "encerrado" antes de
 * começar). `jobs.start_date` só dá o DIA (âncora de meio-dia local); a hora vem de
 * `work_end_time`/`work_start_time`.
 *
 * Regra (A7'):
 *  1. Com `work_end_time`: dia civil BR de `start_date` + `work_end_time`; se
 *     `work_end_time <= work_start_time` (turno cruza a meia-noite), soma 1 dia.
 *  2. Sem `work_end_time`, com `work_start_time` E `estimated_hours`: `work_start_time +
 *     estimated_hours`.
 *  3. Sem nenhum dos dois: `null` — turno EXCLUÍDO da métrica de no-show, "sem horário cadastrado".
 */
function expectedShiftEndInstant(job: JobRow): Date | null {
  if (!job.start_date) return null;
  const dateOnly = toBrazilDateOnly(job.start_date);
  const startMinutes = parseTimeToMinutes(job.work_start_time);
  const endMinutes = parseTimeToMinutes(job.work_end_time);

  if (endMinutes !== null) {
    const crossesMidnight = startMinutes !== null && endMinutes <= startMinutes;
    const dayOffset = crossesMidnight ? 1 : 0;
    return brazilInstantFromDateAndMinutes(addDaysToDateOnly(dateOnly, dayOffset), endMinutes);
  }

  if (startMinutes !== null && job.estimated_hours != null) {
    const startInstant = brazilInstantFromDateAndMinutes(dateOnly, startMinutes);
    return new Date(startInstant.getTime() + job.estimated_hours * 60 * 60_000);
  }

  return null;
}

/** R15/D7/A13 — instante de INÍCIO esperado (`work_start_time` na data civil BR de `start_date`). */
function expectedShiftStartInstant(job: JobRow): Date | null {
  if (!job.start_date) return null;
  const startMinutes = parseTimeToMinutes(job.work_start_time);
  if (startMinutes === null) return null;
  const dateOnly = toBrazilDateOnly(job.start_date);
  return brazilInstantFromDateAndMinutes(dateOnly, startMinutes);
}

/** `jobs.start_date`, com fallback `created_at` (R6/R14) — data usada para bucketizar por período. */
function jobPeriodDate(job: JobRow): string | null {
  return job.start_date ?? job.created_at ?? null;
}

// ---------------------------------------------------------------------------
// Coleta paginada (D1 guarda 2)
// ---------------------------------------------------------------------------

interface PagedResult<T> {
  rows: T[];
  truncated: boolean;
  /**
   * `true` quando a leitura desta fonte falhou (erro de rede/RLS/coluna inexistente). Antes,
   * um erro aqui devolvia silenciosamente `{ rows: [], truncated: false }` — indistinguível de
   * "fonte legitimamente vazia". Todo chamador deve subir este flag para `hasError` em
   * `RawAnalyticsData`, nunca tratá-lo como "sem dado".
   */
  hasError: boolean;
}

async function fetchAllPaged<T>(
  fetchPage: (rangeFrom: number, rangeTo: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  logContext: string,
): Promise<PagedResult<T>> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) {
      logError(logContext, error);
      return { rows, truncated: false, hasError: true };
    }
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) {
      return { rows, truncated: false, hasError: false };
    }
  }
  // Saiu do laço sem uma página incompleta: MAX_PAGES atingido, pode haver mais linhas na fonte.
  return { rows, truncated: true, hasError: false };
}

/**
 * D5.1/D5.5 — ponto ÚNICO de resolução de escopo de empresa. Devolve `[user.id, ...companies onde
 * owner_id = user.id]`, deduplicado. Hoje 1–2 ids (ancoragem dupla — `jobs.company_id` é gravado
 * como `user.id` na criação, mas `shift_payments.company_id`/outras leituras podem estar ancoradas
 * via `companies.id` quando `owner_id = user.id`). É o ÚNICO lugar do frontend que muda quando
 * `is_job_owner`/`is_company_owner` forem unificadas pelo F13 (multi-unidade) — ver
 * `ADR-20260817-seam-autorizacao-empresa.md`. Toda query do service usa `.in('company_id', ids)`,
 * nunca `.eq(...)` (guarda 1, D1) — mesmo quando esta função devolve só 1 id.
 *
 * G-A2 (verificação de Step 0 contra produção, 21/08/2026): a policy de SELECT de `applications`
 * para empresa hoje ancora SÓ em `jobs.company_id = auth.uid()` (ancoragem SIMPLES) — a segunda
 * policy via `companies.owner_id` não está no banco. Isto NÃO quebra a leitura hoje porque, nas 7
 * empresas de produção verificadas, `owner_id = id` sempre (nenhum `owner_id` nulo/divergente) —
 * então a ancoragem simples da RLS devolve o MESMO conjunto que a ancoragem dupla resolvida aqui.
 * Esta premissa é FRÁGIL: quebra no dia em que (a) uma empresa tiver `owner_id ≠ id` (ex.: conta
 * criada por terceiro) ou (b) o F13 (multi-unidade/gerente) introduzir um dono operacional
 * diferente do dono da linha `companies`. Quando isso acontecer, `resolveCompanyScope` continuará
 * devolvendo os ids corretos, mas a RLS de `applications` vai FILTRAR silenciosamente as linhas
 * cujo `job.company_id` não bate com `auth.uid()` — sintoma: métricas de no-show/cancelamento/
 * aceite ficam incompletas para essa empresa, sem erro. Ver PRD "Gates do harness-architect",
 * G-A2 — corrigir exige migration de policy (fora do escopo desta entrega, território do
 * architect + security-reviewer).
 */
interface CompanyScopeResult {
  ids: string[];
  /**
   * `true` quando a leitura de `companies` falhou. Antes, o erro era só logado e o retorno
   * silenciosamente encolhia para `[userId]` — indistinguível de "esta empresa não tem
   * unidades extras" (mesma falha-vira-vazio do `fetchAllPaged`, aqui na resolução de escopo).
   */
  hasError: boolean;
}

async function resolveCompanyScope(userId: string): Promise<CompanyScopeResult> {
  const ids = new Set<string>([userId]);
  const { data, error } = await supabase.from('companies').select('id').eq('owner_id', userId);
  if (error) {
    logError('operationAnalytics.resolveCompanyScope', error);
    return { ids: Array.from(ids), hasError: true };
  }
  for (const row of data ?? []) {
    if (row?.id) ids.add(row.id as string);
  }
  return { ids: Array.from(ids), hasError: false };
}

async function collectRawData(period: OperationAnalyticsPeriod): Promise<RawAnalyticsData | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const scope = await resolveCompanyScope(user.id);
  const scopeCompanyIds = scope.ids;
  let truncated = false;
  let hasError = scope.hasError;

  // Janela combinada: período atual + período anterior de mesma duração (uma coleta só, D5.4
  // agrega sobre o mesmo pool bruto para os dois períodos).
  const durationDays = daysBetweenDateOnly(period.from, period.to) + 1;
  const previousTo = addDaysToDateOnly(period.from, -1);
  const previousFrom = addDaysToDateOnly(previousTo, -(durationDays - 1));
  const windowStart = brazilDayStart(previousFrom);
  const windowEnd = brazilDayEnd(period.to);

  // 1. Jobs do escopo (todos, sem filtro de período — precisamos deles como lookup por id para
  //    calls/applications/attendance; mesmo padrão de `orderReportService`). Exclui soft-deleted.
  const jobsPaged = await fetchAllPaged<JobRow>(
    (from, to) =>
      supabase
        .from('jobs')
        .select('id, company_id, status, start_date, created_at, work_start_time, work_end_time, estimated_hours, budget')
        .in('company_id', scopeCompanyIds)
        .neq('status', 'deleted')
        .range(from, to),
    'operationAnalytics.collect.jobs',
  );
  truncated = truncated || jobsPaged.truncated;
  hasError = hasError || jobsPaged.hasError;
  const jobIds = jobsPaged.rows.map((j) => j.id);

  // 2. Applications dos jobs do escopo.
  const applicationsPaged: PagedResult<ApplicationRow> =
    jobIds.length === 0
      ? { rows: [], truncated: false, hasError: false }
      : await fetchAllPaged<ApplicationRow>(
          (from, to) =>
            supabase
              .from('applications')
              .select(
                'id, job_id, worker_id, status, worker_checkin_at, worker_checkout_at, company_checkin_confirmed_at, company_checkout_confirmed_at',
              )
              .in('job_id', jobIds)
              .range(from, to),
          'operationAnalytics.collect.applications',
        );
  truncated = truncated || applicationsPaged.truncated;
  hasError = hasError || applicationsPaged.hasError;

  // 3. shift_payments recorded (modo A) — filtro server-side pela janela combinada.
  const shiftPaymentsPaged = await fetchAllPaged<ShiftPaymentRow>(
    (from, to) =>
      supabase
        .from('shift_payments')
        .select('job_id, worker_id, amount, status, paid_at')
        .in('company_id', scopeCompanyIds)
        .eq('status', 'recorded')
        .gte('paid_at', windowStart.toISOString())
        .lte('paid_at', windowEnd.toISOString())
        .range(from, to),
    'operationAnalytics.collect.shiftPayments',
  );
  truncated = truncated || shiftPaymentsPaged.truncated;
  hasError = hasError || shiftPaymentsPaged.hasError;

  // 4. escrow_transactions liberados/capturados (modos B/C, D8) — escopo via job_id (a tabela não
  //    tem company_id direto; ver `001_create_wallet_escrow_tables.sql`).
  const escrowPaged: PagedResult<EscrowRow> =
    jobIds.length === 0
      ? { rows: [], truncated: false, hasError: false }
      : await fetchAllPaged<EscrowRow>(
          (from, to) =>
            supabase
              .from('escrow_transactions')
              .select('job_id, application_id, amount, status, released_at, captured_at')
              .in('job_id', jobIds)
              .in('status', ['released', 'captured'])
              .range(from, to),
          'operationAnalytics.collect.escrow',
        );
  truncated = truncated || escrowPaged.truncated;
  hasError = hasError || escrowPaged.hasError;

  // 5. shift_calls do escopo, na janela combinada (server-side).
  const shiftCallsPaged = await fetchAllPaged<ShiftCallRow>(
    (from, to) =>
      supabase
        .from('shift_calls')
        .select('id, job_id, company_id, reason, status, created_at, first_claim_at')
        .in('company_id', scopeCompanyIds)
        .gte('created_at', windowStart.toISOString())
        .lte('created_at', windowEnd.toISOString())
        .range(from, to),
    'operationAnalytics.collect.shiftCalls',
  );
  truncated = truncated || shiftCallsPaged.truncated;
  hasError = hasError || shiftCallsPaged.hasError;
  const callIds = shiftCallsPaged.rows.map((c) => c.id);

  // 6. shift_call_targets dos chamados acima — é a tabela que MAIS cresce (guarda 2 do PRD).
  const shiftCallTargetsPaged: PagedResult<ShiftCallTargetRow> =
    callIds.length === 0
      ? { rows: [], truncated: false, hasError: false }
      : await fetchAllPaged<ShiftCallTargetRow>(
          (from, to) =>
            supabase
              .from('shift_call_targets')
              .select('call_id, worker_id, responded_at, response')
              .in('call_id', callIds)
              .range(from, to),
          'operationAnalytics.collect.shiftCallTargets',
        );
  truncated = truncated || shiftCallTargetsPaged.truncated;
  hasError = hasError || shiftCallTargetsPaged.hasError;

  // 7. shift_attendance_confirmations dos jobs do escopo, na janela combinada.
  const attendanceConfirmationsPaged: PagedResult<AttendanceConfirmationRow> =
    jobIds.length === 0
      ? { rows: [], truncated: false, hasError: false }
      : await fetchAllPaged<AttendanceConfirmationRow>(
          (from, to) =>
            supabase
              .from('shift_attendance_confirmations')
              .select('job_id, requested_at, responded_at, response')
              .in('job_id', jobIds)
              .gte('requested_at', windowStart.toISOString())
              .lte('requested_at', windowEnd.toISOString())
              .range(from, to),
          'operationAnalytics.collect.attendanceConfirmations',
        );
  truncated = truncated || attendanceConfirmationsPaged.truncated;
  hasError = hasError || attendanceConfirmationsPaged.hasError;

  // 8. workers — só os que aparecem em applications/shift_call_targets desta empresa (RLS:
  //    `can_view_worker_profile` já concede leitura por vínculo operacional — não amplia superfície).
  const workerIds = new Set<string>();
  for (const a of applicationsPaged.rows) workerIds.add(a.worker_id);
  for (const t of shiftCallTargetsPaged.rows) workerIds.add(t.worker_id);
  const workerIdsArray = Array.from(workerIds);
  const workers = new Map<string, WorkerRow>();
  if (workerIdsArray.length > 0) {
    const workersPaged = await fetchAllPaged<WorkerRow>(
      (from, to) =>
        supabase
          .from('workers')
          .select('id, full_name, rating_average')
          .in('id', workerIdsArray)
          .range(from, to),
      'operationAnalytics.collect.workers',
    );
    truncated = truncated || workersPaged.truncated;
    hasError = hasError || workersPaged.hasError;
    for (const w of workersPaged.rows) workers.set(w.id, w);
  }

  return {
    scopeCompanyIds,
    truncated,
    hasError,
    jobs: jobsPaged.rows,
    applications: applicationsPaged.rows,
    shiftPayments: shiftPaymentsPaged.rows,
    escrow: escrowPaged.rows,
    shiftCalls: shiftCallsPaged.rows,
    shiftCallTargets: shiftCallTargetsPaged.rows,
    workers,
    attendanceConfirmations: attendanceConfirmationsPaged.rows,
  };
}

// ---------------------------------------------------------------------------
// Agregação PURA (D5.4) — sem Supabase, testável em isolado. Recebe as linhas brutas (já
// coletadas para a janela combinada período atual + anterior) e o período ALVO; devolve os
// blocos com estado (D6) e delta (R5–R8) vs. o período anterior de mesma duração.
// ---------------------------------------------------------------------------

function computeDelta(current: number, previous: number | null): PeriodDelta {
  if (previous === null) return { current, previous: null, percentChange: null };
  if (previous === 0) return { current, previous, percentChange: null };
  return { current, previous, percentChange: ((current - previous) / previous) * 100 };
}

interface HoursResolution {
  hours: number | null;
  /** true quando a duração excedeu MAX_PLAUSIBLE_SHIFT_HOURS e foi descartada (D2c). */
  inconsistent: boolean;
}

/**
 * Horas reais de uma application, resolvidas CAMPO A CAMPO (D2a — vence sobre resolução por par):
 * checkin = worker_checkin_at ?? company_checkin_confirmed_at; checkout idem. Mesma regra de
 * `ReceiptView` — o mesmo turno não pode exibir totais diferentes em duas telas.
 */
function resolveRealHours(app: ApplicationRow, calculateWorkedHours: (a: string | null, b: string | null) => number | null): HoursResolution {
  const checkin = app.worker_checkin_at ?? app.company_checkin_confirmed_at ?? null;
  const checkout = app.worker_checkout_at ?? app.company_checkout_confirmed_at ?? null;
  const hours = calculateWorkedHours(checkin, checkout);
  if (hours === null) return { hours: null, inconsistent: false };
  if (hours > MAX_PLAUSIBLE_SHIFT_HOURS) return { hours: null, inconsistent: true };
  return { hours, inconsistent: false };
}

function workerName(workers: Map<string, WorkerRow>, workerId: string): string {
  return workers.get(workerId)?.full_name ?? 'Freela';
}

interface SpendComputation {
  totalAmount: number;
  conflictingRowsCount: number;
  hasSource: boolean;
}

function computeSpend(raw: RawAnalyticsData, start: Date, end: Date): SpendComputation {
  const paymentPairs = new Set<string>();
  let totalAmount = 0;
  let hasSource = false;

  for (const p of raw.shiftPayments) {
    if (!isInRange(p.paid_at, start, end)) continue;
    hasSource = true;
    totalAmount += p.amount;
    paymentPairs.add(`${p.job_id}:${p.worker_id}`);
  }

  const applicationsById = new Map(raw.applications.map((a) => [a.id, a] as const));
  let conflictingRowsCount = 0;
  for (const e of raw.escrow) {
    const instant = e.released_at ?? e.captured_at;
    if (!isInRange(instant, start, end)) continue;
    hasSource = true;
    const workerId = e.application_id ? applicationsById.get(e.application_id)?.worker_id : undefined;
    const pairKey = workerId ? `${e.job_id}:${workerId}` : null;
    if (pairKey && paymentPairs.has(pairKey)) {
      conflictingRowsCount += 1;
      continue; // shift_payments vence (D8) — não soma de novo.
    }
    totalAmount += e.amount;
  }

  return { totalAmount, conflictingRowsCount, hasSource };
}

function buildSpendBlock(raw: RawAnalyticsData, currentStart: Date, currentEnd: Date, prevStart: Date, prevEnd: Date): SpendSummaryBlock {
  const current = computeSpend(raw, currentStart, currentEnd);
  if (!current.hasSource) return { state: 'sem-fonte' };
  const previous = computeSpend(raw, prevStart, prevEnd);
  return {
    state: 'ok',
    totalAmount: current.totalAmount,
    conflictingRowsCount: current.conflictingRowsCount,
    delta: computeDelta(current.totalAmount, previous.hasSource ? previous.totalAmount : null),
  };
}

function jobsInPeriod(raw: RawAnalyticsData, start: Date, end: Date): JobRow[] {
  return raw.jobs.filter((j) => isInRange(jobPeriodDate(j), start, end));
}

/**
 * Turnos do periodo que de fato ACONTECERAM.
 *
 * Tres metricas filtravam por `jobs.status === 'completed'` -- e nada, em lugar nenhum do
 * produto, escreve esse valor. Conferido no banco de producao: `jobs.status` so assume 'open' e
 * 'deleted'. O resultado era que "Custo por hora", "Horas realizadas / previstas" e a tabela de
 * desempenho por freela diziam "Nenhum turno concluido neste periodo" para TODA empresa, sempre,
 * mesmo com turno concluido e pago dentro do periodo -- cartoes que a entrevista pediu pelo nome.
 *
 * A conclusao, no modo A, mora em `applications.status='completed'`: e o que a empresa marca ao
 * confirmar o turno, o que dispara os agregados do freela, e como as badges, o recibo e a agenda
 * ja definem "concluido". Esta funcao alinha o analytics ao resto do produto.
 */
function completedJobsInPeriod(raw: RawAnalyticsData, start: Date, end: Date): JobRow[] {
  const jobIdsConcluidos = new Set(
    raw.applications.filter((a) => a.status === 'completed').map((a) => a.job_id),
  );
  return jobsInPeriod(raw, start, end).filter((j) => jobIdsConcluidos.has(j.id));
}

const HIRED_STATUSES = new Set(['hired', 'in_progress', 'completed']);

function buildHiresBlock(raw: RawAnalyticsData, currentStart: Date, currentEnd: Date, prevStart: Date, prevEnd: Date): HiresSummaryBlock {
  const jobsById = new Map(raw.jobs.map((j) => [j.id, j] as const));
  const countInPeriod = (start: Date, end: Date): { count: number; jobsCreatedCount: number; hasSource: boolean } => {
    const jobsHere = jobsInPeriod(raw, start, end);
    if (jobsHere.length === 0) return { count: 0, jobsCreatedCount: 0, hasSource: false };
    const jobIdsInPeriod = new Set(jobsHere.map((j) => j.id));
    let count = 0;
    for (const a of raw.applications) {
      if (!jobIdsInPeriod.has(a.job_id)) continue;
      if (!jobsById.has(a.job_id)) continue;
      if (HIRED_STATUSES.has(a.status)) count += 1;
    }
    return { count, jobsCreatedCount: jobsHere.length, hasSource: true };
  };

  const current = countInPeriod(currentStart, currentEnd);
  if (!current.hasSource) return { state: 'sem-fonte' };
  const previous = countInPeriod(prevStart, prevEnd);
  return {
    state: 'ok',
    count: current.count,
    // R6/D6 — contexto obrigatório para o zero-real: "0" sozinho é indistinguível de "sem-fonte"
    // ao olho; "0 de N vagas criadas" prova que a leitura rodou e realmente não houve contratação.
    jobsCreatedCount: current.jobsCreatedCount,
    delta: computeDelta(current.count, previous.hasSource ? previous.count : null),
  };
}

interface CostPerHourComputation {
  totalSpend: number;
  totalHours: number;
  shiftsCount: number;
  estimatedHoursShiftsCount: number;
  inconsistentDurationShiftsCount: number;
  /** C-ANALYTICS-TRACO-MUDO — turnos SEM nenhuma fonte de hora (nem marcação, nem estimativa). */
  noHoursSourceShiftsCount: number;
  hasSource: boolean;
}

function computeCostPerHour(
  raw: RawAnalyticsData,
  start: Date,
  end: Date,
  spend: SpendComputation,
  calculateWorkedHours: (a: string | null, b: string | null) => number | null,
): CostPerHourComputation {
  const completedJobs = completedJobsInPeriod(raw, start, end);
  if (completedJobs.length === 0) {
    return {
      totalSpend: spend.totalAmount,
      totalHours: 0,
      shiftsCount: 0,
      estimatedHoursShiftsCount: 0,
      inconsistentDurationShiftsCount: 0,
      noHoursSourceShiftsCount: 0,
      hasSource: false,
    };
  }
  const completedJobIds = new Set(completedJobs.map((j) => j.id));
  const jobsById = new Map(completedJobs.map((j) => [j.id, j] as const));

  let totalHours = 0;
  let estimatedHoursShiftsCount = 0;
  let inconsistentDurationShiftsCount = 0;
  let noHoursSourceShiftsCount = 0;
  let shiftsCount = 0;
  const jobIdsWithApplication = new Set<string>();

  for (const a of raw.applications) {
    if (!completedJobIds.has(a.job_id)) continue;
    jobIdsWithApplication.add(a.job_id);
    shiftsCount += 1;
    const { hours, inconsistent } = resolveRealHours(a, calculateWorkedHours);
    if (inconsistent) {
      inconsistentDurationShiftsCount += 1;
      continue;
    }
    if (hours !== null) {
      totalHours += hours;
      continue;
    }
    const job = jobsById.get(a.job_id);
    if (job?.estimated_hours != null) {
      totalHours += job.estimated_hours;
      estimatedHoursShiftsCount += 1;
    } else {
      // Nem marcação de ponto (checkin/checkout de nenhuma fonte) nem `estimated_hours` cadastrado
      // — sem este bucket, o turno contava em `shiftsCount` mas em NENHUM outro contador, deixando
      // o "—" do custo/hora sem qualquer legenda que explicasse o porquê (D6 linha 3).
      noHoursSourceShiftsCount += 1;
    }
  }

  // Turno `completed` sem NENHUMA application (ninguém registrado como tendo trabalhado nele) —
  // mesmo buraco do caso acima, mas no nível do turno em vez do worker: sem este ramo, o turno
  // nem aparecia em `shiftsCount`, e o custo/hora incluiria o gasto sem denominador correspondente.
  for (const jobId of completedJobIds) {
    if (jobIdsWithApplication.has(jobId)) continue;
    shiftsCount += 1;
    noHoursSourceShiftsCount += 1;
  }

  return {
    totalSpend: spend.totalAmount,
    totalHours,
    shiftsCount,
    estimatedHoursShiftsCount,
    inconsistentDurationShiftsCount,
    noHoursSourceShiftsCount,
    hasSource: true,
  };
}

function buildCostPerHourBlock(
  raw: RawAnalyticsData,
  currentStart: Date,
  currentEnd: Date,
  prevStart: Date,
  prevEnd: Date,
  currentSpend: SpendComputation,
  prevSpend: SpendComputation,
  calculateWorkedHours: (a: string | null, b: string | null) => number | null,
): CostPerHourSummaryBlock {
  const current = computeCostPerHour(raw, currentStart, currentEnd, currentSpend, calculateWorkedHours);
  if (!current.hasSource) return { state: 'sem-fonte' };
  const previous = computeCostPerHour(raw, prevStart, prevEnd, prevSpend, calculateWorkedHours);
  const currentCostPerHour = current.totalHours > 0 ? current.totalSpend / current.totalHours : null;
  const previousCostPerHour = previous.hasSource && previous.totalHours > 0 ? previous.totalSpend / previous.totalHours : null;
  return {
    state: 'ok',
    costPerHour: currentCostPerHour,
    totalSpend: current.totalSpend,
    totalHours: current.totalHours,
    shiftsCount: current.shiftsCount,
    estimatedHoursShiftsCount: current.estimatedHoursShiftsCount,
    inconsistentDurationShiftsCount: current.inconsistentDurationShiftsCount,
    noHoursSourceShiftsCount: current.noHoursSourceShiftsCount,
    delta: computeDelta(currentCostPerHour ?? 0, previousCostPerHour),
  };
}

interface HoursRatioComputation {
  realizedHours: number;
  estimatedHours: number;
  excludedNoEstimateCount: number;
  excludedNoAttendanceCount: number;
  hasSource: boolean;
}

function computeHoursRatio(
  raw: RawAnalyticsData,
  start: Date,
  end: Date,
  calculateWorkedHours: (a: string | null, b: string | null) => number | null,
): HoursRatioComputation {
  const completedJobs = completedJobsInPeriod(raw, start, end);
  if (completedJobs.length === 0) {
    return { realizedHours: 0, estimatedHours: 0, excludedNoEstimateCount: 0, excludedNoAttendanceCount: 0, hasSource: false };
  }
  const completedJobIds = new Set(completedJobs.map((j) => j.id));
  const jobsById = new Map(completedJobs.map((j) => [j.id, j] as const));

  let realizedHours = 0;
  let estimatedHours = 0;
  let excludedNoEstimateCount = 0;
  let excludedNoAttendanceCount = 0;

  for (const a of raw.applications) {
    if (!completedJobIds.has(a.job_id)) continue;
    const job = jobsById.get(a.job_id);
    if (job?.estimated_hours == null) {
      excludedNoEstimateCount += 1;
      continue;
    }
    const { hours, inconsistent } = resolveRealHours(a, calculateWorkedHours);
    if (hours === null || inconsistent) {
      excludedNoAttendanceCount += 1;
      continue;
    }
    realizedHours += hours;
    estimatedHours += job.estimated_hours;
  }

  return { realizedHours, estimatedHours, excludedNoEstimateCount, excludedNoAttendanceCount, hasSource: true };
}

function buildHoursRatioBlock(
  raw: RawAnalyticsData,
  currentStart: Date,
  currentEnd: Date,
  prevStart: Date,
  prevEnd: Date,
  calculateWorkedHours: (a: string | null, b: string | null) => number | null,
): HoursRatioSummaryBlock {
  const current = computeHoursRatio(raw, currentStart, currentEnd, calculateWorkedHours);
  if (!current.hasSource) return { state: 'sem-fonte' };
  const previous = computeHoursRatio(raw, prevStart, prevEnd, calculateWorkedHours);
  const currentRatio = current.estimatedHours > 0 ? current.realizedHours / current.estimatedHours : null;
  const previousRatio = previous.hasSource && previous.estimatedHours > 0 ? previous.realizedHours / previous.estimatedHours : null;
  return {
    state: 'ok',
    ratio: currentRatio,
    realizedHours: current.realizedHours,
    estimatedHours: current.estimatedHours,
    excludedNoEstimateCount: current.excludedNoEstimateCount,
    excludedNoAttendanceCount: current.excludedNoAttendanceCount,
    delta: computeDelta(currentRatio ?? 0, previousRatio),
  };
}

function buildFillTimeBlock(raw: RawAnalyticsData, start: Date, end: Date, formatDurationMs: (ms: number) => string): FillTimeStatsBlock {
  const callsHere = raw.shiftCalls.filter((c) => isInRange(c.created_at, start, end));
  if (callsHere.length === 0) return { state: 'sem-fonte' };
  const withClaim = callsHere.filter((c) => c.first_claim_at);
  if (withClaim.length === 0) return { state: 'amostra-insuficiente' };
  const totalMs = withClaim.reduce((sum, c) => sum + (new Date(c.first_claim_at as string).getTime() - new Date(c.created_at).getTime()), 0);
  const averageMs = totalMs / withClaim.length;
  return { state: 'ok', averageMs, averageLabel: formatDurationMs(averageMs), sampleCount: withClaim.length };
}

const CALL_STATUSES = ['open', 'filled', 'expired', 'cancelled'] as const;

function buildCallsByStatusBlock(raw: RawAnalyticsData, start: Date, end: Date): CallsByStatusBlock {
  const callsHere = raw.shiftCalls.filter((c) => isInRange(c.created_at, start, end));
  if (callsHere.length === 0) return { state: 'sem-fonte' };
  const counts: Record<(typeof CALL_STATUSES)[number], number> = { open: 0, filled: 0, expired: 0, cancelled: 0 };
  for (const c of callsHere) {
    if ((CALL_STATUSES as readonly string[]).includes(c.status)) {
      counts[c.status as (typeof CALL_STATUSES)[number]] += 1;
    }
  }
  return { state: 'ok', ...counts, total: callsHere.length };
}

const SHIFT_CALL_REASONS: ShiftCallReason[] = ['falta', 'demissao', 'pico_previsto', 'evento', 'ferias', 'folga', 'reforco', 'outro'];

function buildCallsByReasonBlock(raw: RawAnalyticsData, start: Date, end: Date): CallsByReasonBlock {
  const callsHere = raw.shiftCalls.filter((c) => isInRange(c.created_at, start, end));
  if (callsHere.length === 0) return { state: 'sem-fonte' };
  const rows = SHIFT_CALL_REASONS.map((reason) => {
    const forReason = callsHere.filter((c) => c.reason === reason);
    return {
      reason,
      total: forReason.length,
      filled: forReason.filter((c) => c.status === 'filled').length,
      expired: forReason.filter((c) => c.status === 'expired').length,
    };
  }).filter((row) => row.total > 0);
  return { state: 'ok', rows };
}

function buildAcceptanceBlock(raw: RawAnalyticsData, start: Date, end: Date): WorkerAcceptanceBlock {
  const callsHere = raw.shiftCalls.filter((c) => isInRange(c.created_at, start, end));
  if (callsHere.length === 0) return { state: 'sem-fonte' };
  const callIdsHere = new Set(callsHere.map((c) => c.id));
  const callById = new Map(callsHere.map((c) => [c.id, c] as const));

  const byWorker = new Map<string, { received: number; accepted: number; declined: number; noResponse: number; companyId: string }>();
  for (const t of raw.shiftCallTargets) {
    if (!callIdsHere.has(t.call_id)) continue;
    const call = callById.get(t.call_id);
    if (!call) continue;
    const entry = byWorker.get(t.worker_id) ?? { received: 0, accepted: 0, declined: 0, noResponse: 0, companyId: call.company_id };
    entry.received += 1;
    if (t.response === 'accepted') entry.accepted += 1;
    else if (t.response === 'declined') entry.declined += 1;
    else entry.noResponse += 1; // 'closed' ou pendente (null) — nunca contado como recusa.
    byWorker.set(t.worker_id, entry);
  }

  if (byWorker.size === 0) return { state: 'sem-fonte' };

  const rows = Array.from(byWorker.entries())
    .map(([workerId, v]) => ({
      workerId,
      workerName: workerName(raw.workers, workerId),
      companyId: v.companyId,
      received: v.received,
      accepted: v.accepted,
      declined: v.declined,
      noResponse: v.noResponse,
      acceptanceRate: v.received >= MIN_SAMPLE_SIZE ? v.accepted / v.received : null,
    }))
    .sort((a, b) => a.workerName.localeCompare(b.workerName, 'pt-BR'));

  return { state: 'ok', rows };
}

function buildAttendanceBlock(raw: RawAnalyticsData, start: Date, end: Date, now: Date): WorkerAttendanceBlock {
  const relevantApps = raw.applications.filter((a) => {
    const job = raw.jobs.find((j) => j.id === a.job_id);
    if (!job) return false;
    return isInRange(jobPeriodDate(job), start, end) && (HIRED_STATUSES.has(a.status) || a.status === 'cancelled');
  });
  if (relevantApps.length === 0) return { state: 'sem-fonte' };

  const jobsById = new Map(raw.jobs.map((j) => [j.id, j] as const));
  interface Acc {
    noShowCount: number;
    noShowExcludedNoScheduleCount: number;
    cancelledCount: number;
    punctualCount: number;
    lateCount: number;
    checkinsWithScheduleCount: number;
    companyId: string;
  }
  const byWorker = new Map<string, Acc>();
  const getEntry = (workerId: string, companyId: string): Acc => {
    let entry = byWorker.get(workerId);
    if (!entry) {
      entry = { noShowCount: 0, noShowExcludedNoScheduleCount: 0, cancelledCount: 0, punctualCount: 0, lateCount: 0, checkinsWithScheduleCount: 0, companyId };
      byWorker.set(workerId, entry);
    }
    return entry;
  };

  for (const a of relevantApps) {
    const job = jobsById.get(a.job_id);
    if (!job) continue;
    const entry = getEntry(a.worker_id, job.company_id);

    if (a.status === 'cancelled') {
      entry.cancelledCount += 1;
      continue;
    }

    // R13/A7' — no-show: turno hired/in_progress cujo término esperado já passou e sem checkin do freela.
    if (a.status === 'hired' || a.status === 'in_progress') {
      const expectedEnd = expectedShiftEndInstant(job);
      if (expectedEnd === null) {
        entry.noShowExcludedNoScheduleCount += 1;
      } else if (expectedEnd.getTime() < now.getTime() && !a.worker_checkin_at) {
        entry.noShowCount += 1;
      }
    }

    // R15/D7/A13 — pontualidade: precisa de work_start_time E checkin (worker, fallback empresa).
    const expectedStart = expectedShiftStartInstant(job);
    const checkin = a.worker_checkin_at ?? a.company_checkin_confirmed_at ?? null;
    if (expectedStart !== null && checkin) {
      const diffMinutes = (new Date(checkin).getTime() - expectedStart.getTime()) / 60_000;
      entry.checkinsWithScheduleCount += 1;
      if (diffMinutes <= LATE_TOLERANCE_MINUTES) entry.punctualCount += 1;
      else entry.lateCount += 1;
    }
  }

  const rows = Array.from(byWorker.entries())
    .map(([workerId, v]) => ({
      workerId,
      workerName: workerName(raw.workers, workerId),
      companyId: v.companyId,
      noShowCount: v.noShowCount,
      noShowExcludedNoScheduleCount: v.noShowExcludedNoScheduleCount,
      cancelledCount: v.cancelledCount,
      punctualCount: v.punctualCount,
      lateCount: v.lateCount,
      checkinsWithScheduleCount: v.checkinsWithScheduleCount,
      punctualityRate: v.checkinsWithScheduleCount >= MIN_SAMPLE_SIZE ? v.punctualCount / v.checkinsWithScheduleCount : null,
    }))
    .sort((a, b) => a.workerName.localeCompare(b.workerName, 'pt-BR'));

  return { state: 'ok', rows };
}

function buildPerformanceBlock(raw: RawAnalyticsData, start: Date, end: Date): WorkerPerformanceBlock {
  const completedJobs = completedJobsInPeriod(raw, start, end);
  if (completedJobs.length === 0) return { state: 'sem-fonte' };
  const completedJobIds = new Set(completedJobs.map((j) => j.id));
  const jobsById = new Map(completedJobs.map((j) => [j.id, j] as const));

  const byWorker = new Map<string, { completedWithCompanyCount: number; companyId: string }>();
  for (const a of raw.applications) {
    if (!completedJobIds.has(a.job_id) || a.status !== 'completed') continue;
    const job = jobsById.get(a.job_id);
    if (!job) continue;
    const entry = byWorker.get(a.worker_id) ?? { completedWithCompanyCount: 0, companyId: job.company_id };
    entry.completedWithCompanyCount += 1;
    byWorker.set(a.worker_id, entry);
  }

  if (byWorker.size === 0) return { state: 'sem-fonte' };

  const rows = Array.from(byWorker.entries())
    .map(([workerId, v]) => ({
      workerId,
      workerName: workerName(raw.workers, workerId),
      companyId: v.companyId,
      ratingAverage: raw.workers.get(workerId)?.rating_average ?? null,
      completedWithCompanyCount: v.completedWithCompanyCount,
    }))
    .sort((a, b) => a.workerName.localeCompare(b.workerName, 'pt-BR'));

  return { state: 'ok', rows };
}

function buildAttendanceConfirmationsBlock(raw: RawAnalyticsData, start: Date, end: Date): AttendanceConfirmationsBlock {
  const rowsHere = raw.attendanceConfirmations.filter((c) => isInRange(c.requested_at, start, end));
  if (rowsHere.length === 0) return { state: 'sem-fonte' };
  const responded = rowsHere.filter((c) => c.responded_at).length;
  const declined = rowsHere.filter((c) => c.response === 'cannot_attend').length;
  return { state: 'ok', requested: rowsHere.length, responded, declined };
}

/**
 * Dependências injetáveis para deixar `aggregate` 100% pura/testável (D5.4) sem depender de
 * import estático de `lib/dateUtils` no corpo do teste — o teste passa as mesmas funções reais.
 */
export interface AggregateDeps {
  calculateWorkedHours: (checkinIso: string | null | undefined, checkoutIso: string | null | undefined) => number | null;
  formatDurationMs: (ms: number) => string;
  now?: Date;
}

/**
 * Função PURA de agregação (D5.4) — sem Supabase. Recebe as linhas brutas (já coletadas para a
 * janela período-atual + período-anterior) e devolve o `OperationAnalytics` completo, com os
 * blocos em estado `sem-fonte`/`amostra-insuficiente`/`ok` (D6) e deltas vs. período anterior de
 * mesma duração (R5–R8).
 */
export function aggregate(raw: RawAnalyticsData, period: OperationAnalyticsPeriod, deps: AggregateDeps): OperationAnalytics {
  const now = deps.now ?? new Date();
  const currentStart = brazilDayStart(period.from);
  const currentEnd = brazilDayEnd(period.to);
  const durationDays = daysBetweenDateOnly(period.from, period.to) + 1;
  const previousTo = addDaysToDateOnly(period.from, -1);
  const previousFrom = addDaysToDateOnly(previousTo, -(durationDays - 1));
  const prevStart = brazilDayStart(previousFrom);
  const prevEnd = brazilDayEnd(previousTo);

  const currentSpend = computeSpend(raw, currentStart, currentEnd);
  const prevSpend = computeSpend(raw, prevStart, prevEnd);

  return {
    scopeCompanyIds: raw.scopeCompanyIds,
    truncated: raw.truncated,
    hasError: raw.hasError,
    spend: buildSpendBlock(raw, currentStart, currentEnd, prevStart, prevEnd),
    hires: buildHiresBlock(raw, currentStart, currentEnd, prevStart, prevEnd),
    costPerHour: buildCostPerHourBlock(raw, currentStart, currentEnd, prevStart, prevEnd, currentSpend, prevSpend, deps.calculateWorkedHours),
    hoursRatio: buildHoursRatioBlock(raw, currentStart, currentEnd, prevStart, prevEnd, deps.calculateWorkedHours),
    fillTime: buildFillTimeBlock(raw, currentStart, currentEnd, deps.formatDurationMs),
    callsByStatus: buildCallsByStatusBlock(raw, currentStart, currentEnd),
    callsByReason: buildCallsByReasonBlock(raw, currentStart, currentEnd),
    acceptanceByWorker: buildAcceptanceBlock(raw, currentStart, currentEnd),
    attendanceByWorker: buildAttendanceBlock(raw, currentStart, currentEnd, now),
    performanceByWorker: buildPerformanceBlock(raw, currentStart, currentEnd),
    attendanceConfirmations: buildAttendanceConfirmationsBlock(raw, currentStart, currentEnd),
  };
}

/**
 * Devolve um `OperationAnalytics` "sem-fonte" em todos os blocos. `hasError` (default `false`)
 * marca "não consegui ler", que a UI **precisa** distinguir de "não há dado" (achado
 * C-ANALYTICS-ERRO-VIRA-VAZIO: a tela afirmava "Nenhum turno criado neste período" para uma
 * empresa com 16 turnos quando a leitura falhava). O caso "sem sessão" (`!raw`, nunca deveria
 * acontecer atrás de `ProtectedRoute`) passa `hasError: false` — não é falha, é ausência de usuário.
 *
 * Exportada para a página reusar no `catch` do fetch, em vez de duplicar a montagem dos 11 blocos
 * — duplicata envelheceria sozinha a cada bloco novo.
 */
export function emptyAnalytics(hasError = false): OperationAnalytics {
  return {
    scopeCompanyIds: [],
    truncated: false,
    hasError,
    spend: { state: 'sem-fonte' },
    hires: { state: 'sem-fonte' },
    costPerHour: { state: 'sem-fonte' },
    hoursRatio: { state: 'sem-fonte' },
    fillTime: { state: 'sem-fonte' },
    callsByStatus: { state: 'sem-fonte' },
    callsByReason: { state: 'sem-fonte' },
    acceptanceByWorker: { state: 'sem-fonte' },
    attendanceByWorker: { state: 'sem-fonte' },
    performanceByWorker: { state: 'sem-fonte' },
    attendanceConfirmations: { state: 'sem-fonte' },
  };
}

export const OperationAnalyticsService = {
  /**
   * Busca + agrega o analytics de operação da empresa autenticada para o período informado
   * (datas civis BR, `YYYY-MM-DD`, inclusive). Somente leitura — nunca lança para o caller em
   * caso de erro de rede/RLS (loga via `logError` e devolve estado `sem-fonte` em tudo).
   */
  async getOperationAnalytics(period: OperationAnalyticsPeriod): Promise<OperationAnalytics> {
    try {
      const raw = await collectRawData(period);
      if (!raw) return emptyAnalytics();
      return aggregate(raw, period, { calculateWorkedHours, formatDurationMs });
    } catch (error) {
      logError('operationAnalytics.getOperationAnalytics', error);
      return emptyAnalytics(true);
    }
  },
};
