/**
 * Criação rápida de turnos — contrato `ShiftDraft` e regras puras.
 * Spec: `.harness/spec/criacao-rapida-de-turnos/spec.md` (Regra 1, contrato, Regras 2 e 4).
 *
 * Formulário, parser de texto e copiloto produzem o MESMO `ShiftDraftBatch`. Nada aqui lê rede
 * nem grava: quem publica é `services/shiftBatchService` (RPC `create_jobs_batch`), sempre
 * depois de um toque da pessoa.
 */
import { SHIFT_CATEGORIES } from '../components/company/shiftCategories';
import { shiftMinutes, todayInBrazil, toBrazilDateOnly } from './dateUtils';
import { generateOccurrenceDates, type RecurrenceType } from './recurrence';
import type { ShiftCallReason } from '../types';

export const MAX_BATCH_ROWS = 60;
export const MAX_SLOTS = 50;
/** Mesma frase do banco (`create_jobs_batch`, código `over_limit`). */
export const BATCH_LIMIT_MESSAGE = 'Um lote pode ter no máximo 60 turnos.';

export type ShiftDraftSource = 'form' | 'template' | 'repeat' | 'copy_week' | 'parser' | 'copilot';
export type ShiftBudgetType = 'hourly' | 'daily' | 'project';

/**
 * RESERVADO (Regra 6). Os valores seguem `.harness/spec/presenca-verificada`; a coluna ainda não
 * existe. O campo do template fica sempre `null` e a RPC recusa um valor preenchido.
 */
export type AttendanceMode = 'dual' | 'qr_gps';

export interface ShiftDraftTemplate {
  title: string;
  /** slug de SHIFT_CATEGORIES */
  category: string;
  description: string;
  requirements?: string;
  briefing?: string;
  certification_requirement?: string | null;
  location?: string;
  budget_type: ShiftBudgetType;
  has_lunch: boolean;
  tag_id?: string | null;
  attendance_mode?: AttendanceMode | null;
  source_job_id?: string | null;
}

/** O que uma linha pode ter de diferente do comum (copiar semana junta turnos distintos). */
export type ShiftDraftOverrides = Partial<
  Pick<
    ShiftDraftTemplate,
    | 'title' | 'category' | 'location' | 'tag_id' | 'description' | 'requirements' | 'briefing'
    | 'certification_requirement' | 'budget_type' | 'has_lunch'
  >
>;

export interface ShiftDraftRow {
  /** uuid local, estável na tela */
  key: string;
  /** YYYY-MM-DD local (America/Sao_Paulo) */
  date: string;
  /** HH:MM; saída menor que a entrada = vira a meia-noite */
  start_time: string;
  end_time: string;
  slots: number;
  budget: number;
  overrides?: ShiftDraftOverrides;
  /** Chamar junto: substitui, só nesta linha, a escolha geral. */
  invite_worker_ids?: string[];
  /** A pessoa tocou em "Separar": a linha não se junta a outra igual. */
  keep_separate?: boolean;
}

export interface ShiftDraftCall {
  mode: 'none' | 'list' | 'workers';
  list_id?: string;
  worker_ids?: string[];
  reason?: ShiftCallReason;
  expires_minutes?: number;
}

export interface ShiftDraftSeries {
  recurrence_type: RecurrenceType;
  weekdays?: number[];
  range_start: string;
  range_end: string;
}

export interface ShiftDraftBatch {
  /** uuid de idempotência: muda só quando o conteúdo do lote muda */
  client_batch_id: string;
  source: ShiftDraftSource;
  template: ShiftDraftTemplate;
  rows: ShiftDraftRow[];
  call?: ShiftDraftCall;
  /** "Repetir toda semana até…": só vira job_series se nada for editado (ver `resolveSeries`). */
  series?: ShiftDraftSeries | null;
}

export type ShiftDraftIssueKind =
  | 'past_date' | 'crosses_midnight' | 'probable_duplicate' | 'worker_busy' | 'missing_field' | 'over_limit';

export interface ShiftDraftIssue {
  kind: ShiftDraftIssueKind;
  /** '' = problema do lote inteiro */
  row_key: string;
  detail: string;
  blocking: boolean;
  /** Turno parecido (para o link "Ver"); ausente quando a pessoa não pode abri-lo. */
  job_id?: string;
}

/** Turno já publicado, usado para o aviso de duplicata provável. */
export interface ExistingShift {
  id: string;
  date: string;
  start_time: string;
  category: string;
  /** false = existe, mas é de outra pessoa da equipe (Encarregado): avisa sem link. */
  visible: boolean;
}

// ---------------------------------------------------------------------------
// Identidade e datas (aritmética em UTC sobre "date-only": imune ao fuso do aparelho)
// ---------------------------------------------------------------------------

export function newId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  // http em rede local não expõe randomUUID; getRandomValues sim.
  const bytes = c.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === date;
}

export function isValidTime(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 0 = domingo .. 6 = sábado. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const SHORT_DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function shortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}

export function dayLabel(date: string): string {
  return isValidDate(date) ? `${SHORT_DAYS[weekdayOf(date)]} ${shortDate(date)}` : 'Sem data';
}

/** Primeira data >= `from` que cai no dia da semana pedido. */
export function nextWeekday(from: string, weekday: number): string {
  return addDays(from, (weekday - weekdayOf(from) + 7) % 7);
}

/** Hora atual em America/Sao_Paulo, HH:MM. */
export function nowTimeInBrazil(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(now);
}

export function quickDateOptions(today: string = todayInBrazil()): { label: string; date: string }[] {
  const options = [
    { label: 'Hoje', date: today },
    { label: 'Amanhã', date: addDays(today, 1) },
    { label: 'Sáb', date: nextWeekday(today, 6) },
    { label: 'Dom', date: nextWeekday(today, 0) },
  ];
  return options
    .filter((o, i) => options.findIndex((x) => x.date === o.date) === i)
    .map((o) => ({ ...o, label: `${o.label} ${shortDate(o.date)}` }));
}

/**
 * "Repetir o fim de semana passado": sábado mais recente ANTES de hoje, e o domingo seguinte.
 * No domingo, o sábado de ontem conta (o deslocamento de +7 cai no próximo fim de semana).
 */
export function lastWeekendRange(today: string = todayInBrazil()): { from: string; to: string } {
  const back = ((weekdayOf(today) - 6 + 7) % 7) || 7;
  const from = addDays(today, -back);
  return { from, to: addDays(from, 1) };
}

/** "A semana passada": os 7 dias anteriores a hoje, então +7 nunca cai no passado. */
export function lastWeekRange(today: string = todayInBrazil()): { from: string; to: string } {
  return { from: addDays(today, -7), to: addDays(today, -1) };
}

// ---------------------------------------------------------------------------
// Construção
// ---------------------------------------------------------------------------

export function categoryName(slug: string): string {
  return SHIFT_CATEGORIES.find((c) => c.slug === slug)?.name ?? '';
}

/** Descrição obrigatória não deve custar digitação: sugestão a partir da função, editável. */
export function suggestDescription(slug: string): string {
  const name = categoryName(slug);
  return name ? `Turno presencial de ${name}.` : '';
}

export function emptyTemplate(category = ''): ShiftDraftTemplate {
  return {
    title: categoryName(category),
    category,
    description: suggestDescription(category),
    requirements: '',
    briefing: '',
    certification_requirement: null,
    location: '',
    budget_type: 'daily',
    has_lunch: false,
    tag_id: null,
    attendance_mode: null,
    source_job_id: null,
  };
}

/** Troca a função sem apagar o que a pessoa digitou: título e descrição só mudam se eram sugestão. */
export function changeCategory(template: ShiftDraftTemplate, category: string): ShiftDraftTemplate {
  const titleWasSuggested = !template.title.trim() || template.title === categoryName(template.category);
  const descriptionWasSuggested =
    !template.description.trim() || template.description === suggestDescription(template.category);
  return {
    ...template,
    category,
    title: titleWasSuggested ? categoryName(category) : template.title,
    description: descriptionWasSuggested ? suggestDescription(category) : template.description,
  };
}

export type RowDefaults = Pick<ShiftDraftRow, 'start_time' | 'end_time' | 'slots' | 'budget'>;

export const EMPTY_ROW_DEFAULTS: RowDefaults = { start_time: '', end_time: '', slots: 1, budget: 0 };

export function createRow(date: string, defaults: RowDefaults = EMPTY_ROW_DEFAULTS): ShiftDraftRow {
  return {
    key: newId(),
    date,
    start_time: defaults.start_time,
    end_time: defaults.end_time,
    slots: defaults.slots,
    budget: defaults.budget,
  };
}

/** Mesma data, para outro horário: a cópia não se junta sozinha enquanto a pessoa a edita. */
export function duplicateRow(row: ShiftDraftRow): ShiftDraftRow {
  return { ...row, key: newId(), keep_separate: true };
}

export function applyToAll(rows: ShiftDraftRow[], patch: Partial<RowDefaults>): ShiftDraftRow[] {
  return rows.map((row) => ({ ...row, ...patch }));
}

export function sortRows(rows: ShiftDraftRow[]): ShiftDraftRow[] {
  return [...rows].sort(
    (a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time),
  );
}

/** Dados comuns + o que a linha troca. */
export function effectiveShift(template: ShiftDraftTemplate, row: ShiftDraftRow): ShiftDraftTemplate {
  return { ...template, ...(row.overrides ?? {}) };
}

// ---------------------------------------------------------------------------
// Regra 1 — vagas x turnos
// ---------------------------------------------------------------------------

const norm = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Chave de agrupamento (R1): data, início, fim, função, valor, tipo de valor, local e título.
 * Etiqueta, textos e intervalo também entram: juntar linhas que diferem neles apagaria dado.
 */
export function mergeKey(template: ShiftDraftTemplate, row: ShiftDraftRow): string {
  const s = effectiveShift(template, row);
  return JSON.stringify([
    row.date, row.start_time, row.end_time, s.category, row.budget, s.budget_type,
    norm(s.location), norm(s.title), s.tag_id ?? '', norm(s.description), norm(s.requirements),
    norm(s.briefing), norm(s.certification_requirement), s.has_lunch,
  ]);
}

export interface DraftMerge {
  /** Linha que sobrou depois da junção. */
  key: string;
  sourceKeys: string[];
  slots: number;
}

const isComplete = (row: ShiftDraftRow) =>
  isValidDate(row.date) && isValidTime(row.start_time) && isValidTime(row.end_time) && row.budget > 0;

/** Determinística: preserva a ordem da primeira ocorrência. Não altera as linhas de entrada. */
export function mergeDrafts(
  template: ShiftDraftTemplate,
  rows: ShiftDraftRow[],
): { rows: ShiftDraftRow[]; merges: DraftMerge[] } {
  const result: ShiftDraftRow[] = [];
  const byKey = new Map<string, number>();
  const sources = new Map<string, string[]>();

  for (const row of rows) {
    const groupKey = !row.keep_separate && isComplete(row) ? mergeKey(template, row) : null;
    const at = groupKey === null ? undefined : byKey.get(groupKey);
    if (at === undefined) {
      if (groupKey !== null) byKey.set(groupKey, result.length);
      result.push({ ...row });
      sources.set(row.key, [row.key]);
      continue;
    }
    const kept = result[at];
    const invites = [...new Set([...(kept.invite_worker_ids ?? []), ...(row.invite_worker_ids ?? [])])];
    result[at] = {
      ...kept,
      slots: kept.slots + row.slots,
      ...(invites.length ? { invite_worker_ids: invites } : {}),
    };
    sources.get(kept.key)?.push(row.key);
  }

  const merges = result
    .map((row) => ({ key: row.key, sourceKeys: sources.get(row.key) ?? [], slots: row.slots }))
    .filter((m) => m.sourceKeys.length > 1);
  return { rows: result, merges };
}

export function separateRows(rows: ShiftDraftRow[], sourceKeys: string[]): ShiftDraftRow[] {
  const keys = new Set(sourceKeys);
  return rows.map((row) => (keys.has(row.key) ? { ...row, keep_separate: true } : row));
}

export function mergeMessage(merge: DraftMerge): string {
  return `${merge.sourceKeys.length} linhas iguais foram juntadas: 1 turno com ${merge.slots} vagas.`;
}

// ---------------------------------------------------------------------------
// Custo previsto
// ---------------------------------------------------------------------------

export function crossesMidnight(start: string, end: string): boolean {
  return isValidTime(start) && isValidTime(end) && end < start;
}

/** Minutos pagos por pessoa: duração do turno menos o intervalo de 1 h, quando houver. */
export function workedMinutes(start: string, end: string, hasLunch: boolean): number {
  if (!isValidTime(start) || !isValidTime(end) || start === end) return 0;
  return shiftMinutes(start, end, hasLunch ? 60 : 0);
}

export function rowCost(template: ShiftDraftTemplate, row: ShiftDraftRow): number {
  const s = effectiveShift(template, row);
  const base = Math.max(0, row.slots || 0) * Math.max(0, row.budget || 0);
  const total = s.budget_type === 'hourly'
    ? (base * workedMinutes(row.start_time, row.end_time, s.has_lunch)) / 60
    : base;
  return Math.round(total * 100) / 100;
}

export function batchSummary(template: ShiftDraftTemplate, rows: ShiftDraftRow[]) {
  return {
    shifts: rows.length,
    slots: rows.reduce((sum, r) => sum + (r.slots || 0), 0),
    cost: Math.round(rows.reduce((sum, r) => sum + rowCost(template, r), 0) * 100) / 100,
  };
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Validação única (UI e copiloto)
// ---------------------------------------------------------------------------

export interface ValidationContext {
  today?: string;
  /** HH:MM em São Paulo, para avisar horário de hoje que já passou. */
  nowTime?: string;
  existingShifts?: ExistingShift[];
  busy?: { row_key: string; worker_name: string }[];
}

/**
 * Pura. Passe o lote como será publicado (depois de `mergeDrafts`); o teto de 60 é contado sobre
 * as linhas já agrupadas.
 */
export function validateBatch(batch: ShiftDraftBatch, context: ValidationContext = {}): ShiftDraftIssue[] {
  const today = context.today ?? todayInBrazil();
  const nowTime = context.nowTime ?? nowTimeInBrazil();
  const issues: ShiftDraftIssue[] = [];
  const add = (
    kind: ShiftDraftIssueKind, row_key: string, detail: string, blocking: boolean, job_id?: string,
  ) => issues.push({ kind, row_key, detail, blocking, ...(job_id ? { job_id } : {}) });

  if (batch.rows.length === 0) add('missing_field', '', 'Escolha pelo menos uma data.', true);
  if (mergeDrafts(batch.template, batch.rows).rows.length > MAX_BATCH_ROWS) {
    add('over_limit', '', BATCH_LIMIT_MESSAGE, true);
  }

  for (const row of batch.rows) {
    const s = effectiveShift(batch.template, row);
    const missing: string[] = [];
    if (!s.title.trim()) missing.push('título');
    if (!s.category) missing.push('função');
    if (!s.description.trim()) missing.push('descrição');
    if (!isValidDate(row.date)) missing.push('data');
    if (!isValidTime(row.start_time)) missing.push('entrada');
    if (!isValidTime(row.end_time)) missing.push('saída');
    if (!(row.budget > 0)) missing.push('valor');
    if (missing.length) add('missing_field', row.key, `Falta: ${missing.join(', ')}.`, true);
    if (isValidTime(row.start_time) && row.start_time === row.end_time) {
      add('missing_field', row.key, 'Entrada e saída não podem ser iguais.', true);
    }
    if ((s.certification_requirement ?? '').length > 200) {
      add('over_limit', row.key, 'A certificação exigida passa de 200 caracteres.', true);
    }
    if (!Number.isInteger(row.slots) || row.slots < 1) {
      add('missing_field', row.key, 'Informe quantas pessoas (pelo menos 1).', true);
    } else if (row.slots > MAX_SLOTS) {
      add('over_limit', row.key, `No máximo ${MAX_SLOTS} vagas por turno.`, true);
    }

    if (isValidDate(row.date)) {
      if (row.date < today) {
        add('past_date', row.key, 'Esta data já passou.', true);
      } else if (row.date === today && isValidTime(row.start_time) && row.start_time <= nowTime) {
        add('past_date', row.key, `A entrada (${row.start_time}) já passou hoje.`, false);
      }
    }
    if (crossesMidnight(row.start_time, row.end_time)) {
      add('crosses_midnight', row.key, `Termina ${row.end_time} do dia seguinte.`, false);
    }

    const twin = (context.existingShifts ?? []).find(
      (e) => e.date === row.date && e.start_time.slice(0, 5) === row.start_time && e.category === s.category,
    );
    if (twin) {
      add('probable_duplicate', row.key, 'Já existe um turno parecido (mesma data, entrada e função).', false,
        twin.visible ? twin.id : undefined);
    }
    for (const b of context.busy ?? []) {
      if (b.row_key === row.key) {
        add('worker_busy', row.key, `${b.worker_name} já está em outro turno nesse horário.`, false);
      }
    }
  }
  return issues;
}

export function hasBlockingIssue(issues: ShiftDraftIssue[]): boolean {
  return issues.some((i) => i.blocking);
}

// ---------------------------------------------------------------------------
// Idempotência, série e payload
// ---------------------------------------------------------------------------

/** O que vira `jobs`. Chamar freelas não entra: não muda o lote publicado. */
export function toPublishPayload(template: ShiftDraftTemplate, rows: ShiftDraftRow[]) {
  const { source_job_id: _source, attendance_mode, ...common } = template;
  void _source;
  return {
    // Só vai quando preenchido: o banco recusa política de presença que ainda não sabe gravar.
    template: attendance_mode ? { ...common, attendance_mode } : common,
    rows: rows.map((r) => ({
      date: r.date,
      start_time: r.start_time,
      end_time: r.end_time,
      slots: r.slots,
      budget: r.budget,
      ...(r.overrides && Object.keys(r.overrides).length ? { overrides: r.overrides } : {}),
    })),
  };
}

export function batchFingerprint(
  template: ShiftDraftTemplate, rows: ShiftDraftRow[], series?: ShiftDraftSeries | null,
): string {
  return JSON.stringify([toPublishPayload(template, rows), series ?? null]);
}

export function seriesDates(series: ShiftDraftSeries, today: string = todayInBrazil()): string[] {
  const [y, m, d] = today.split('-').map(Number);
  return generateOccurrenceDates({
    recurrenceType: series.recurrence_type,
    weekdays: series.weekdays,
    rangeStartDate: series.range_start,
    rangeEndDate: series.range_end,
    referenceDate: new Date(y, m - 1, d, 12),
  });
}

/**
 * R2d: o lote só é publicado como `job_series` se as linhas são exatamente as datas geradas, todas
 * iguais e sem ajuste individual. Qualquer edição devolve `null` (lote comum).
 */
export function resolveSeries(
  template: ShiftDraftTemplate,
  rows: ShiftDraftRow[],
  series: ShiftDraftSeries | null | undefined,
  today: string = todayInBrazil(),
): ShiftDraftSeries | null {
  if (!series || rows.length === 0) return null;
  if (rows.some((r) => r.overrides && Object.keys(r.overrides).length > 0)) return null;
  const shapes = new Set(rows.map((r) => mergeKey(template, { ...r, date: '' }) + `|${r.slots}`));
  if (shapes.size !== 1) return null;
  const expected = seriesDates(series, today);
  const actual = rows.map((r) => r.date).sort();
  if (expected.length !== actual.length || expected.some((d, i) => d !== actual[i])) return null;
  return series;
}

export const SERIES_BROKEN_MESSAGE =
  'Como você mudou horários ou datas, estes turnos não formam uma série: para parar, cancele cada um.';

/** Monta a repetição semanal a partir das datas escolhidas: mesmos dias da semana até `until`. */
export function weeklySeriesFrom(dates: string[], until: string): ShiftDraftSeries | null {
  const sorted = dates.filter(isValidDate).sort();
  if (sorted.length === 0 || !isValidDate(until) || until < sorted[0]) return null;
  return {
    recurrence_type: 'weekly',
    weekdays: [...new Set(sorted.map(weekdayOf))].sort((a, b) => a - b),
    range_start: sorted[0],
    range_end: until,
  };
}

// ---------------------------------------------------------------------------
// Turnos anteriores → modelos e cópia de semana
// ---------------------------------------------------------------------------

/** Colunas de `jobs` usadas como modelo. */
export interface SourceJob {
  id: string;
  title: string | null;
  category: string | null;
  description: string | null;
  requirements?: string | null;
  briefing?: string | null;
  certification_requirement?: string | null;
  location?: string | null;
  budget: number | string | null;
  budget_type: string | null;
  has_lunch?: boolean | null;
  slots?: number | null;
  tag_id?: string | null;
  start_date: string | null;
  work_start_time: string | null;
  work_end_time: string | null;
  responsible_id?: string | null;
  created_at?: string | null;
}

const time5 = (value: string | null | undefined) => {
  const t = (value ?? '').slice(0, 5);
  return isValidTime(t) ? t : '';
};

export function templateFromJob(job: SourceJob): { template: ShiftDraftTemplate; defaults: RowDefaults } {
  const category = job.category ?? '';
  const budgetType: ShiftBudgetType =
    job.budget_type === 'hourly' || job.budget_type === 'project' ? job.budget_type : 'daily';
  return {
    template: {
      ...emptyTemplate(category),
      title: job.title?.trim() || categoryName(category),
      description: job.description?.trim() || suggestDescription(category),
      requirements: job.requirements ?? '',
      briefing: job.briefing ?? '',
      certification_requirement: job.certification_requirement ?? null,
      location: job.location ?? '',
      budget_type: budgetType,
      has_lunch: job.has_lunch === true,
      tag_id: job.tag_id ?? null,
      source_job_id: job.id,
    },
    defaults: {
      start_time: time5(job.work_start_time),
      end_time: time5(job.work_end_time),
      slots: job.slots && job.slots > 0 ? job.slots : 1,
      budget: Number(job.budget) > 0 ? Number(job.budget) : 0,
    },
  };
}

/** Modelos = turnos reais distintos por título, função, horário e valor (Regra 3). */
export function distinctModels(jobs: SourceJob[], limit = 6): SourceJob[] {
  const seen = new Set<string>();
  const result: SourceJob[] = [];
  for (const job of jobs) {
    if (!norm(job.title)) continue;
    const key = [norm(job.title), job.category, time5(job.work_start_time), time5(job.work_end_time), Number(job.budget)].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(job);
    if (result.length >= limit) break;
  }
  return result;
}

const OVERRIDE_FIELDS = [
  'title', 'category', 'location', 'tag_id', 'description', 'requirements', 'briefing',
  'certification_requirement', 'budget_type', 'has_lunch',
] as const;

/**
 * Copia turnos deslocando `shiftBy` dias. O primeiro vira o comum; o que difere vira ajuste da
 * linha. `rowSource` liga cada linha ao turno de origem (sugestão de freelas).
 * `archivedTagIds`: etiqueta arquivada derrubaria o lote inteiro no banco, então não é copiada.
 */
export function copyJobs(
  jobs: SourceJob[],
  shiftBy = 7,
  archivedTagIds: ReadonlySet<string> = new Set(),
): { template: ShiftDraftTemplate; rows: ShiftDraftRow[]; rowSource: Record<string, string> } | null {
  const usable = jobs.filter((j) => j.start_date);
  if (usable.length === 0) return null;
  const parsed = usable.map((job) => {
    const result = templateFromJob(job);
    if (result.template.tag_id && archivedTagIds.has(result.template.tag_id)) result.template.tag_id = null;
    return { job, ...result };
  });
  const template: ShiftDraftTemplate = { ...parsed[0].template, source_job_id: null };
  const rowSource: Record<string, string> = {};
  const rows = parsed.map(({ job, template: own, defaults }) => {
    const row = createRow(addDays(toBrazilDateOnly(job.start_date as string), shiftBy), defaults);
    const diff: Record<string, unknown> = {};
    for (const field of OVERRIDE_FIELDS) {
      if ((own[field] ?? null) !== (template[field] ?? null)) diff[field] = own[field] ?? null;
    }
    if (Object.keys(diff).length) row.overrides = diff as ShiftDraftOverrides;
    rowSource[row.key] = job.id;
    return row;
  });
  return { template, rows: sortRows(rows), rowSource };
}
