/**
 * Parser determinístico de texto para rascunhos de turno (pt-BR), sem LLM:
 * "sex e sáb 18-23h 3 garçons 150".
 *
 * Regra de ouro: NUNCA chuta. O que não é reconhecido volta em `unknown`. Expressões que mudam o
 * sentido das datas ("que vem", "toda", "não", "ou") recusam a linha inteira. Cada linha (ou trecho
 * separado por ";") tem no máximo um horário.
 */
import {
  addDays, categoryName, createRow, emptyTemplate, isValidDate, newId, nextWeekday, shortDate,
  suggestDescription, weekdayOf, type ShiftBudgetType, type ShiftDraftBatch, type ShiftDraftRow,
  type ShiftDraftTemplate,
} from './shiftDrafts';
import { todayInBrazil } from './dateUtils';

export interface ParsedShift {
  date: string;
  /** '' = não informado (a revisão cobra). */
  start_time: string;
  end_time: string;
  slots: number;
  /** 0 = não informado. */
  budget: number;
  /** null = o texto não disse (vale o padrão do comum). */
  budget_type: ShiftBudgetType | null;
  category: string | null;
}

export interface ShiftTextParseResult {
  shifts: ParsedShift[];
  /** Frases prontas para a tela: "Não entendi: ...". */
  unknown: string[];
  /** Suposições declaradas (ex.: sem quantidade = 1 vaga). */
  notes: string[];
}

const FUNCTIONS: [string, string][] = [
  ['auxiliar_cozinha', '(?:auxiliar(?:es)?|aux\\.?|ajudantes?) de cozinha|cumins?|cumim'],
  ['eventos', '(?:auxiliar(?:es)?|aux\\.?|ajudantes?) de (?:eventos?|buffet)|buffet'],
  ['garcom', 'garcons?|garcom|garconetes?'],
  ['barista', 'baristas?'],
  ['barman', 'barman|barmans|barmen|bartenders?'],
  ['cozinha', 'cozinheir[oa]s?|cozinha'],
  ['atendente', 'atendentes?|balconistas?'],
  ['caixa', 'caixas?'],
  ['recepcao', 'recepcionistas?|recepcao|hostess'],
  ['limpeza', 'limpeza|copeir[oa]s?|stewards?|faxineir[oa]s?'],
  ['estoque', 'estoquistas?|estoque|repositor(?:es|as?)?'],
  ['seguranca', 'segurancas?|porteir[oa]s?'],
  ['promotor', 'promotor(?:es|as?)?|degustador(?:es|as?)?'],
];
const FUNCTION_GROUP = FUNCTIONS.map(([, p]) => `(${p})`).join('|');

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};
const COUNT = `\\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')}`;

const WEEKDAYS = '(domingos?|dom|segunda|seg|terca|ter|quarta|qua|quinta|qui|sexta|sex|sabados?|sab)(?:[- ]feira)?';
const WEEKDAY_INDEX: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
const WEEKDAY_NAME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const MONEY = '\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+(?:,\\d{1,2})?';
const HOURLY = '(?:\\s*\\/\\s*h(?:ora)?\\b|\\s+(?:por|a|cada) hora\\b|\\s+hora\\b)';
const DAILY = '(?:\\s*\\/\\s*dia\\b|\\s+(?:por dia|a diaria|de diaria|da diaria|na diaria|diaria|o dia)\\b)';

const STOPWORDS = new Set((
  'e de da do das dos no na nos nas para pra pro o a os as com em cada um uma preciso precisamos quero ' +
  'vaga vagas pessoa pessoas freela freelas turno turnos horario valor pago pagando proxima proximo esta ' +
  'este nesta neste essa esse nessa nesse feira dia por x'
).split(' '));

/** Mudam o sentido das datas ou negam: ler "por cima" criaria turno errado. */
const REFUSE = /\b(que vem|semana|semanas|todo|toda|todos|todas|mes|meses|quinzena|quinzenal|depois|antes|ou|talvez|nao|sem|menos|exceto|salvo|cancela\w*)\b/;

/** minúsculas sem acento, com o MESMO comprimento do original (para citar o trecho como digitado). */
function fold(text: string): string {
  return Array.from(text, (ch) => {
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    return base.length === ch.length ? base : ch;
  }).join('');
}

interface Match { start: number; end: number; groups: (string | undefined)[] }

/** Consome (apaga com espaços) cada trecho reconhecido; `accept=false` deixa o trecho para depois. */
class Scanner {
  rest: string;
  constructor(text: string) { this.rest = text; }

  take(pattern: string, accept: (m: Match) => boolean | void = () => true): void {
    const re = new RegExp(pattern, 'g');
    let found: RegExpExecArray | null;
    while ((found = re.exec(this.rest)) !== null) {
      const match = { start: found.index, end: found.index + found[0].length, groups: [...found] };
      if (accept(match) === false) continue;
      this.rest = this.rest.slice(0, match.start) + ' '.repeat(match.end - match.start) + this.rest.slice(match.end);
    }
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

function toTime(hour: string, minute: string | undefined, isEnd: boolean): string | null {
  let h = Number(hour);
  const m = Number(minute ?? '0');
  if (isEnd && h === 24 && m === 0) h = 0;
  return h <= 23 && m <= 59 ? `${pad(h)}:${pad(m)}` : null;
}

const money = (raw: string) => Number(raw.replace(/\.(?=\d{3})/g, '').replace(',', '.'));

interface DayToken { start: number; end: number; weekday?: number; date?: string }

function resolveDate(day: number, month: number, year: string | undefined, today: string): string | null {
  const thisYear = Number(today.slice(0, 4));
  const fullYear = year ? (year.length === 2 ? 2000 + Number(year) : Number(year)) : thisYear;
  let date = `${fullYear}-${pad(month)}-${pad(day)}`;
  if (!isValidDate(date)) return null;
  // Sem ano e muito no passado ("10/01" dito em novembro) é o ano que vem. Passado recente fica
  // como está, e a revisão bloqueia: nunca empurrar em silêncio.
  if (!year && date < addDays(today, -60)) {
    date = `${fullYear + 1}-${pad(month)}-${pad(day)}`;
    if (!isValidDate(date)) return null;
  }
  return date;
}

function parseLine(original: string, today: string): ShiftTextParseResult {
  const result: ShiftTextParseResult = { shifts: [], unknown: [], notes: [] };
  const fail = (message: string) => { result.unknown.push(message); return result; };
  const text = fold(original);
  const quote = (m: { start: number; end: number }) => original.slice(m.start, m.end).trim();
  const scan = new Scanner(text);
  const days: DayToken[] = [];

  scan.take('\\bdepois de amanha\\b', (m) => { days.push({ ...m, date: addDays(today, 2) }); });
  scan.take('\\b(?:fim|final) de semana\\b|\\bfds\\b', (m) => {
    days.push({ start: m.start, end: m.start, weekday: 6 }, { start: m.start, end: m.end, weekday: 0 });
  });

  const refused = REFUSE.exec(scan.rest);
  if (refused) {
    return fail(`Não entendi "${original.trim()}": não sei interpretar "${quote({ start: refused.index, end: refused.index + refused[0].length })}". Escreva as datas, por exemplo "sex e sáb" ou "29/11".`);
  }

  // Datas dd/mm
  let badDate = false;
  scan.take('(?<![\\d/])(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{4}|\\d{2}))?(?![\\d/])', (m) => {
    const date = resolveDate(Number(m.groups[1]), Number(m.groups[2]), m.groups[3], today);
    if (!date) { badDate = true; result.unknown.push(`Não entendi: "${quote(m)}" não é uma data.`); return; }
    days.push({ ...m, date });
  });
  if (badDate) return result;
  let loneDay = false;
  scan.take('\\bdia (\\d{1,2})(?![\\d/:h,.])(?!\\s*(?:-|reais|por))', (m) => {
    loneDay = true;
    result.unknown.push(`Não entendi "${quote(m)}": informe também o mês (ex.: ${m.groups[1]}/${today.slice(5, 7)}).`);
  });
  if (loneDay) return result;

  // Intervalo de horário
  const intervals: { start: string; end: string }[] = [];
  let badTime = false;
  const interval = '(?<![\\d,.$/])(das? |de )?(\\d{1,2})(?:(h(?:rs?|oras)?|:)\\s?(\\d{2})?)?\\s*(-|–|—|\\bas\\b|\\bate(?: as)?\\b|\\ba\\b)\\s*(\\d{1,2})(?:(h(?:rs?|oras)?|:)(\\d{2})?)?(?![\\da-z/,])';
  scan.take(interval, (m) => {
    const [, prefix, h1, mark1, min1, link, h2, mark2, min2] = m.groups;
    const marked = Boolean(mark1 || mark2);
    if (!marked && !prefix?.startsWith('das')) {
      // "3 a 5 garçons" ou "2-3 garçons" é quantidade, não horário.
      if (link === 'a') return false;
      if (new RegExp(`^\\s*(?:${FUNCTION_GROUP}|vagas|pessoas)\\b`).test(text.slice(m.end))) return false;
    }
    const start = toTime(h1 as string, min1, false);
    const end = toTime(h2 as string, min2, true);
    if (!start || !end || start === end) {
      badTime = true;
      result.unknown.push(`Não entendi: "${quote(m)}" não é um horário válido.`);
      return;
    }
    intervals.push({ start, end });
  });
  if (badTime) return result;
  if (intervals.length > 1) {
    return fail(`Não entendi "${original.trim()}": há mais de um horário. Use uma linha (ou ";") para cada horário.`);
  }

  // Valores explícitos
  const values: { at: number; amount: number; type: ShiftBudgetType | null }[] = [];
  const unitOf = (unit: string | undefined): ShiftBudgetType | null =>
    unit === undefined ? null : /h(?:ora)?$/.test(unit.trim()) ? 'hourly' : 'daily';
  scan.take(`r\\$\\s*(${MONEY})(?:\\s*reais)?(${HOURLY}|${DAILY})?`, (m) => {
    values.push({ at: m.start, amount: money(m.groups[1] as string), type: unitOf(m.groups[2]) });
  });
  scan.take(`(?<![\\d,./:])(${MONEY})\\s*(?:reais|conto|pila)(${HOURLY}|${DAILY})?`, (m) => {
    values.push({ at: m.start, amount: money(m.groups[1] as string), type: unitOf(m.groups[2]) });
  });
  scan.take(`(?<![\\d,./:h-])(${MONEY})(${HOURLY}|${DAILY})`, (m) => {
    values.push({ at: m.start, amount: money(m.groups[1] as string), type: unitOf(m.groups[2]) });
  });

  // Só a entrada ("sexta 18h", "às 18:30")
  const singles: string[] = [];
  scan.take('(?<![\\d,./$])(?:a partir das |das |as )?(\\d{1,2})(?:h(\\d{2})?|:(\\d{2}))(?![\\da-z])', (m) => {
    const start = toTime(m.groups[1] as string, m.groups[2] ?? m.groups[3], false);
    if (!start) return false;
    singles.push(start);
  });
  if (singles.length + intervals.length > 1) {
    return fail(`Não entendi "${original.trim()}": há mais de um horário. Use uma linha (ou ";") para cada horário.`);
  }

  // Dias da semana e relativos
  scan.take(`\\b${WEEKDAYS}\\b`, (m) => { days.push({ ...m, weekday: WEEKDAY_INDEX[(m.groups[1] as string).slice(0, 3)] }); });
  scan.take('\\bhoje\\b', (m) => { days.push({ ...m, date: today }); });
  scan.take('\\bamanha\\b', (m) => { days.push({ ...m, date: addDays(today, 1) }); });
  days.sort((a, b) => a.start - b.start);

  // Funções com quantidade
  const groups: { at: number; category: string; slots: number }[] = [];
  const unitless: string[] = [];
  scan.take(`(?<![\\d,./])(?:\\b(${COUNT})\\s*(?:x\\s*)?)?\\b(?:${FUNCTION_GROUP})\\b`, (m) => {
    const index = m.groups.slice(2).findIndex((g) => g !== undefined);
    const raw = m.groups[1];
    if (raw === undefined) unitless.push(categoryName(FUNCTIONS[index][0]));
    groups.push({ at: m.start, category: FUNCTIONS[index][0], slots: raw === undefined ? 1 : NUMBER_WORDS[raw] ?? Number(raw) });
  });
  let looseSlots: number | null = null;
  if (groups.length <= 1) {
    scan.take(`\\b(${COUNT})\\s*(?:vagas?|pessoas?|freelas?)\\b`, (m) => {
      if (looseSlots !== null) return false;
      looseSlots = NUMBER_WORDS[m.groups[1] as string] ?? Number(m.groups[1]);
    });
  }

  // Número solto >= 20 é o valor; menor que isso não dá para saber o que é.
  scan.take(`(?<![\\w,./:$-])(${MONEY})(?![\\w/:$])(?![.,]\\d)`, (m) => {
    const amount = money(m.groups[1] as string);
    if (amount < 20) return false;
    values.push({ at: m.start, amount, type: null });
  });
  values.sort((a, b) => a.at - b.at);

  // Intervalos de dias ("seg a sex") e dia da semana como rótulo de data ("sáb 29/11")
  const resolved: string[] = [];
  let previous: string | null = null;
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const next = days[i + 1];
    if (day.weekday !== undefined && next?.date && /^[\s,]*(?:dia\s*)?$/.test(text.slice(day.end, next.start))) {
      if (weekdayOf(next.date) !== day.weekday) {
        return fail(`Não entendi: ${shortDate(next.date)} não é ${WEEKDAY_NAME[day.weekday]}.`);
      }
      continue;
    }
    const date: string = day.date ?? nextWeekday(previous ?? today, day.weekday as number);
    const rangeLink = next && day.end > day.start && /^\s*(?:a|ate|-|–)\s*$/.test(text.slice(day.end, next.start));
    if (rangeLink) {
      const last = next.date ?? nextWeekday(date, next.weekday as number);
      if (last < date) return fail(`Não entendi o período "${quote({ start: day.start, end: next.end })}".`);
      if (last > addDays(date, 31)) return fail('Não entendi: períodos de mais de um mês precisam ser escritos em partes.');
      for (let d = date; d <= last; d = addDays(d, 1)) resolved.push(d);
      previous = last;
      i += 1;
      continue;
    }
    resolved.push(date);
    previous = date;
  }
  const dates = [...new Set(resolved)];

  // Sobras
  const leftovers: string[] = [];
  const wordRe = /[^\s,.;:!?()+&-]+/g;
  let word: RegExpExecArray | null;
  while ((word = wordRe.exec(scan.rest)) !== null) {
    if (!STOPWORDS.has(word[0])) leftovers.push(original.slice(word.index, word.index + word[0].length));
  }

  if (dates.length === 0) {
    return fail(`Não entendi "${original.trim()}": não encontrei o dia (ex.: "sexta", "amanhã" ou "29/11").`);
  }
  if (groups.length === 0 && intervals.length === 0 && singles.length === 0) {
    return fail(`Não entendi "${original.trim()}": diga o horário ou a função.`);
  }
  if (leftovers.length) result.unknown.push(`Não entendi: "${leftovers.join(' ')}".`);

  // Valor por função
  const blocks = groups.length
    ? groups.map((g) => ({ category: g.category as string | null, slots: g.slots, at: g.at }))
    : [{ category: null as string | null, slots: looseSlots ?? 1, at: 0 }];
  if (groups.length === 1 && looseSlots !== null && unitless.length) {
    blocks[0].slots = looseSlots;
    unitless.length = 0;
  }
  const valueFor: ({ amount: number; type: ShiftBudgetType | null } | null)[] = blocks.map(() => null);
  if (values.length === 1 && (blocks.length === 1 || values[0].at > blocks[blocks.length - 1].at)) {
    valueFor.fill(values[0]);
  } else if (values.length > 0) {
    let ambiguous = blocks.length === 1;
    for (const value of values) {
      let owner = -1;
      blocks.forEach((b, i) => { if (b.at < value.at) owner = i; });
      if (owner < 0 || valueFor[owner]) ambiguous = true;
      else valueFor[owner] = value;
    }
    if (ambiguous) {
      valueFor.fill(null);
      result.unknown.push('Não entendi qual é o valor: há mais de um número que pode ser o valor. Preencha na revisão.');
    }
  }

  for (const name of unitless) result.notes.push(`Sem quantidade para ${name}: considerei 1 vaga.`);
  if (looseSlots === null && groups.length === 0) result.notes.push('Sem quantidade: considerei 1 vaga.');

  const time = intervals[0] ?? { start: singles[0] ?? '', end: '' };
  for (const date of dates) {
    blocks.forEach((block, i) => {
      result.shifts.push({
        date,
        start_time: time.start,
        end_time: time.end,
        slots: block.slots,
        budget: valueFor[i]?.amount ?? 0,
        budget_type: valueFor[i]?.type ?? null,
        category: block.category,
      });
    });
  }
  return result;
}

export function parseShiftText(input: string, options: { today?: string } = {}): ShiftTextParseResult {
  const today = options.today ?? todayInBrazil();
  const result: ShiftTextParseResult = { shifts: [], unknown: [], notes: [] };
  const lines = input.normalize('NFC').split(/[\n;]+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 60)) {
    const parsed = parseLine(line, today);
    result.shifts.push(...parsed.shifts);
    result.unknown.push(...parsed.unknown);
    result.notes.push(...parsed.notes);
  }
  if (lines.length > 60) result.unknown.push('Não li o texto inteiro: o limite é de 60 linhas.');
  result.notes = [...new Set(result.notes)];
  return result;
}

/**
 * Rascunho a partir do que foi entendido. `base` é o comum já escolhido (um modelo); a função dita
 * no texto vence a do modelo, só nas linhas em que difere. Sem nada entendido, `null`.
 */
export function batchFromParse(
  parsed: ShiftTextParseResult,
  base?: ShiftDraftTemplate,
): ShiftDraftBatch | null {
  if (parsed.shifts.length === 0) return null;
  const first = parsed.shifts[0];
  const firstType = first.budget_type ?? base?.budget_type ?? 'daily';
  const template: ShiftDraftTemplate = base && (!first.category || first.category === base.category)
    ? { ...base, budget_type: firstType }
    : {
      ...emptyTemplate(first.category ?? ''),
      location: base?.location ?? '',
      briefing: base?.briefing ?? '',
      budget_type: firstType,
    };
  const rows: ShiftDraftRow[] = parsed.shifts.map((shift) => {
    const row = createRow(shift.date, shift);
    const overrides: ShiftDraftRow['overrides'] = {};
    if (shift.category && shift.category !== template.category) {
      overrides.category = shift.category;
      overrides.title = categoryName(shift.category);
      overrides.description = suggestDescription(shift.category);
    }
    const type = shift.budget_type ?? base?.budget_type ?? 'daily';
    if (type !== template.budget_type) overrides.budget_type = type;
    if (Object.keys(overrides).length) row.overrides = overrides;
    return row;
  });
  return { client_batch_id: newId(), source: 'parser', template, rows };
}
