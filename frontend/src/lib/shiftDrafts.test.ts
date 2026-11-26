import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BATCH_LIMIT_MESSAGE, addDays, applyToAll, batchFingerprint, batchSummary, copyJobs, createRow,
  distinctModels, duplicateRow, emptyTemplate, hasBlockingIssue, isValidDate, lastWeekRange,
  lastWeekendRange, mergeDrafts, newId, nowTimeInBrazil, quickDateOptions, resolveSeries, rowCost,
  separateRows, seriesDates, templateFromJob, toPublishPayload, validateBatch, weekdayOf,
  categoryName, weeklySeriesFrom, sanitizeSavedTemplate, templateToSave, type ShiftDraftBatch, type ShiftDraftRow, type SourceJob,
} from './shiftDrafts';
import { toBrazilDateOnly } from './dateUtils';

const TODAY = '2026-11-25';
const template = { ...emptyTemplate('garcom'), location: 'Rua A' };
const row = (patch: Partial<ShiftDraftRow> = {}): ShiftDraftRow => ({
  ...createRow('2026-11-28', { start_time: '18:00', end_time: '23:00', slots: 3, budget: 150 }),
  ...patch,
});
const batch = (rows: ShiftDraftRow[], patch: Partial<ShiftDraftBatch> = {}): ShiftDraftBatch => ({
  client_batch_id: newId(), source: 'form', template, rows, ...patch,
});
const validate = (rows: ShiftDraftRow[], ctx = {}) =>
  validateBatch(batch(rows), { today: TODAY, nowTime: '10:00', ...ctx });

afterEach(() => vi.useRealTimers());

describe('mergeDrafts (A1)', () => {
  it('linhas iguais viram 1 turno com as vagas somadas', () => {
    const a = row();
    const b = row({ slots: 2, invite_worker_ids: ['w1'] });
    const { rows, merges } = mergeDrafts(template, [a, b]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: a.key, slots: 5, invite_worker_ids: ['w1'] });
    expect(merges).toEqual([{ key: a.key, sourceKeys: [a.key, b.key], slots: 5 }]);
    expect(a.slots).toBe(3);
  });

  it('horário diferente fica separado', () => {
    expect(mergeDrafts(template, [row(), row({ end_time: '22:00' })]).rows).toHaveLength(2);
  });

  it('valor diferente fica separado', () => {
    expect(mergeDrafts(template, [row(), row({ budget: 160 })]).rows).toHaveLength(2);
  });

  it.each([
    ['data', { date: '2026-11-29' }],
    ['função', { overrides: { category: 'barman' } }],
    ['local', { overrides: { location: 'Rua B' } }],
    ['título', { overrides: { title: 'Outro' } }],
    ['tipo de valor', { overrides: { budget_type: 'hourly' as const } }],
    ['etiqueta', { overrides: { tag_id: 't1' } }],
  ])('%s diferente fica separado', (_label, patch) => {
    expect(mergeDrafts(template, [row(), row(patch)]).rows).toHaveLength(2);
  });

  it('caixa e espaços no título e no local não separam', () => {
    const other = row({ overrides: { title: '  garçom /  garçonete ', location: 'rua a' } });
    expect(mergeDrafts(template, [row(), other]).rows).toHaveLength(1);
  });

  it('"Separar" desfaz a junção e é estável', () => {
    const input = [row(), row()];
    const { merges } = mergeDrafts(template, input);
    const separated = separateRows(input, merges[0].sourceKeys);
    expect(mergeDrafts(template, separated)).toMatchObject({ rows: [{}, {}], merges: [] });
  });

  it('linha duplicada na edição não se junta sozinha', () => {
    const a = row();
    expect(mergeDrafts(template, [a, duplicateRow(a)]).rows).toHaveLength(2);
  });

  it('linhas incompletas não são juntadas', () => {
    expect(mergeDrafts(template, [row({ budget: 0 }), row({ budget: 0 })]).rows).toHaveLength(2);
  });

  it('é idempotente', () => {
    const once = mergeDrafts(template, [row(), row(), row({ budget: 90 })]).rows;
    expect(mergeDrafts(template, once).rows).toEqual(once);
  });
});

describe('custo previsto', () => {
  it('diária: vagas x valor', () => expect(rowCost(template, row())).toBe(450));
  it('por hora, atravessando a meia-noite e descontando o intervalo', () => {
    const hourly = { ...template, budget_type: 'hourly' as const, has_lunch: true };
    // 18:00-02:30 = 8h30, menos 1h de intervalo = 7h30; 2 pessoas x 20
    expect(rowCost(hourly, row({ end_time: '02:30', slots: 2, budget: 20 }))).toBe(300);
  });
  it('por hora sem horário completo não inventa custo', () => {
    expect(rowCost({ ...template, budget_type: 'hourly' }, row({ end_time: '' }))).toBe(0);
  });
  it('resumo do cabeçalho', () => {
    expect(batchSummary(template, [row(), row(), row({ slots: 2 })])).toEqual({ shifts: 3, slots: 8, cost: 1200 });
  });
});

describe('validateBatch', () => {
  it('linha completa e futura não tem aviso', () => expect(validate([row()])).toEqual([]));

  it('A5: data passada bloqueia', () => {
    const issues = validate([row({ date: '2026-11-24' })]);
    expect(issues).toMatchObject([{ kind: 'past_date', blocking: true }]);
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it('entrada de hoje que já passou só avisa', () => {
    expect(validate([row({ date: TODAY, start_time: '09:00' })])).toMatchObject([{ kind: 'past_date', blocking: false }]);
  });

  it('A5: vira a meia-noite avisa sem bloquear', () => {
    expect(validate([row({ start_time: '22:00', end_time: '02:00' })])).toEqual([
      expect.objectContaining({ kind: 'crosses_midnight', blocking: false, detail: 'Termina 02:00 do dia seguinte.' }),
    ]);
  });

  it('entrada igual à saída bloqueia', () => {
    expect(hasBlockingIssue(validate([row({ end_time: '18:00' })]))).toBe(true);
  });

  it('diz o que falta', () => {
    expect(validate([row({ end_time: '', budget: 0 })])[0].detail).toBe('Falta: saída, valor.');
  });

  it.each([0, 1.5, 51, Number.NaN])('vagas %s bloqueiam', (slots) => {
    expect(hasBlockingIssue(validate([row({ slots })]))).toBe(true);
  });

  it('50 vagas passam; a junção que passa de 50 bloqueia', () => {
    expect(validate([row({ slots: 50 })])).toEqual([]);
    const merged = mergeDrafts(template, [row({ slots: 30 }), row({ slots: 30 })]).rows;
    expect(validate(merged)).toMatchObject([{ kind: 'over_limit', blocking: true }]);
  });

  it('31 de fevereiro não é data', () => {
    expect(isValidDate('2027-02-31')).toBe(false);
    expect(hasBlockingIssue(validate([row({ date: '2027-02-31' })]))).toBe(true);
  });

  it('A12: 61 turnos bloqueiam com a mensagem do banco; 60 passam', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => row({ date: addDays('2026-12-01', i) }));
    expect(validate(many(60))).toEqual([]);
    expect(validate(many(61))).toMatchObject([{ kind: 'over_limit', row_key: '', detail: BATCH_LIMIT_MESSAGE }]);
  });

  it('A6: duplicata provável avisa com link só quando a pessoa pode abrir', () => {
    const existing = { id: 'j1', date: '2026-11-28', start_time: '18:00:00', category: 'garcom', visible: true };
    expect(validate([row()], { existingShifts: [existing] })).toMatchObject([
      { kind: 'probable_duplicate', blocking: false, job_id: 'j1' },
    ]);
    expect(validate([row()], { existingShifts: [{ ...existing, visible: false }] })[0].job_id).toBeUndefined();
    expect(validate([row()], { existingShifts: [{ ...existing, category: 'barman' }] })).toEqual([]);
  });

  it('freela ocupado nunca bloqueia', () => {
    const a = row();
    expect(validate([a], { busy: [{ row_key: a.key, worker_name: 'Ana' }] })).toMatchObject([
      { kind: 'worker_busy', blocking: false },
    ]);
  });
});

describe('fuso America/Sao_Paulo', () => {
  it('às 23h30 de São Paulo (02h30 UTC do dia seguinte) hoje ainda é hoje', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T02:30:00Z'));
    expect(validateBatch(batch([row({ date: TODAY, start_time: '23:45', end_time: '03:00' })]))
      .filter((i) => i.kind === 'past_date')).toEqual([]);
    expect(nowTimeInBrazil()).toBe('23:30');
    expect(quickDateOptions()[0]).toEqual({ label: 'Hoje 25/11', date: TODAY });
  });

  it('meia-noite vira 00:00, nunca 24:00', () => {
    expect(nowTimeInBrazil(new Date('2026-11-25T03:00:00Z'))).toBe('00:00');
  });

  it('turno gravado ao meio-dia e perto da meia-noite caem no dia civil brasileiro', () => {
    expect(toBrazilDateOnly('2026-11-28T15:00:00+00:00')).toBe('2026-11-28');
    expect(toBrazilDateOnly('2026-11-29T02:00:00+00:00')).toBe('2026-11-28');
  });

  it('aritmética de datas atravessa mês, ano e fevereiro bissexto', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(weekdayOf(TODAY)).toBe(3);
  });

  it('chips não repetem a data (sexta: amanhã = sábado)', () => {
    expect(quickDateOptions('2026-11-27').map((o) => o.date)).toEqual(['2026-11-27', '2026-11-28', '2026-11-29']);
  });
});

describe('copiar semana e fim de semana (A8)', () => {
  it.each([
    ['quarta', '2026-11-25', '2026-11-21'],
    ['segunda', '2026-11-30', '2026-11-28'],
    ['sábado', '2026-11-28', '2026-11-21'],
    ['domingo', '2026-11-29', '2026-11-28'],
  ])('fim de semana passado numa %s', (_l, today, saturday) => {
    expect(lastWeekendRange(today)).toEqual({ from: saturday, to: addDays(saturday, 1) });
    expect(addDays(lastWeekendRange(today).from, 7) >= today).toBe(true);
  });

  it('semana passada + 7 nunca cai no passado', () => {
    expect(lastWeekRange(TODAY)).toEqual({ from: '2026-11-18', to: '2026-11-24' });
  });

  const job = (patch: Partial<SourceJob> = {}): SourceJob => ({
    id: 'a', title: 'Loja sábado', category: 'atendente', description: 'Balcão', budget: '120', budget_type: 'daily',
    start_date: '2026-11-21T15:00:00+00:00', work_start_time: '09:00:00', work_end_time: '17:00:00', slots: 2, ...patch,
  });

  it('desloca +7 e guarda como ajuste o que difere', () => {
    const copy = copyJobs([
      job(),
      job({ id: 'b', title: 'Caixa domingo', category: 'caixa', budget_type: 'hourly', start_date: '2026-11-22T15:00:00+00:00', tag_id: 'velha' }),
    ], 7, new Set(['velha']));
    expect(copy?.rows.map((r) => r.date)).toEqual(['2026-11-28', '2026-11-29']);
    expect(copy?.rows[0]).toMatchObject({ start_time: '09:00', end_time: '17:00', slots: 2, budget: 120 });
    expect(copy?.rows[0].overrides).toBeUndefined();
    expect(copy?.rows[1].overrides).toMatchObject({ title: 'Caixa domingo', category: 'caixa', budget_type: 'hourly' });
    expect(copy?.rows[1].overrides?.tag_id).toBeUndefined();
    expect(copy?.rowSource[copy.rows[1].key]).toBe('b');
  });

  it('sem turnos não há rascunho', () => expect(copyJobs([])).toBeNull());

  it('modelos são distintos por título, função, horário e valor', () => {
    const models = distinctModels([job(), job({ id: 'b' }), job({ id: 'c', budget: 130 }), job({ id: 'd', title: ' ' })]);
    expect(models.map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('modelo antigo sem descrição ganha a sugerida', () => {
    expect(templateFromJob(job({ description: null })).template.description).toContain('Atendente');
  });
});

describe('série x lote', () => {
  const series = weeklySeriesFrom(['2026-11-28', '2026-11-29'], '2026-12-13')!;
  const rows = () => seriesDates(series, TODAY).map((date) => row({ date }));

  it('gera as datas dos mesmos dias da semana', () => {
    expect(seriesDates(series, TODAY)).toEqual(['2026-11-28', '2026-11-29', '2026-12-05', '2026-12-06', '2026-12-12', '2026-12-13']);
  });

  it('sem edição publica como série, inclusive após "aplicar a todas"', () => {
    expect(resolveSeries(template, rows(), series, TODAY)).toEqual(series);
    expect(resolveSeries(template, applyToAll(rows(), { budget: 200 }), series, TODAY)).toEqual(series);
  });

  it.each<[string, (r: ShiftDraftRow[]) => ShiftDraftRow[]]>([
    ['horário de uma linha', (r) => [{ ...r[0], start_time: '17:00' }, ...r.slice(1)]],
    ['vagas de uma linha', (r) => [{ ...r[0], slots: 1 }, ...r.slice(1)]],
    ['linha removida', (r) => r.slice(1)],
    ['linha duplicada', (r) => [...r, duplicateRow(r[0])]],
    ['ajuste individual', (r) => [{ ...r[0], overrides: { title: 'x' } }, ...r.slice(1)]],
  ])('com %s vira lote comum', (_l, edit) => {
    expect(resolveSeries(template, edit(rows()), series, TODAY)).toBeNull();
  });

  it('data final antes do início não forma série', () => {
    expect(weeklySeriesFrom(['2026-11-28'], '2026-11-27')).toBeNull();
  });
});

describe('idempotência e payload', () => {
  it('chamar freelas não muda a impressão do lote; editar muda', () => {
    const a = row();
    expect(batchFingerprint(template, [a])).toBe(batchFingerprint(template, [{ ...a, invite_worker_ids: ['w'], key: 'z' }]));
    expect(batchFingerprint(template, [a])).not.toBe(batchFingerprint(template, [{ ...a, slots: 4 }]));
  });

  it('presença reservada não vai ao banco enquanto nula', () => {
    const payload = toPublishPayload({ ...template, source_job_id: 'x' }, [row()]);
    expect(payload.template).not.toHaveProperty('attendance_mode');
    expect(payload.template).not.toHaveProperty('source_job_id');
    expect(Object.keys(payload.rows[0]).sort()).toEqual(['budget', 'date', 'end_time', 'slots', 'start_time']);
  });

  it('newId gera uuid v4 mesmo sem randomUUID', () => {
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(undefined as never);
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true });
    spy.mockRestore();
  });
});

describe('modelos salvos', () => {
  it('sanitizeSavedTemplate: o que vem do banco nunca quebra a tela', () => {
    const lixo = sanitizeSavedTemplate({
      id: 'x', name: 'Modelo',
      template: { title: 42, category: 'garcom', budget_type: 'mensal', has_lunch: 'sim', tag_id: 7, location: 'a'.repeat(500) },
      defaults: { start_time: '25:99', end_time: '23:00', slots: -3, budget: 'caro' },
    });
    expect(lixo.template.title).toBe(categoryName('garcom'));
    expect(lixo.template.budget_type).toBe('daily');
    expect(lixo.template.has_lunch).toBe(false);
    expect(lixo.template.tag_id).toBeNull();
    expect(lixo.template.location).toHaveLength(200);
    expect(lixo.template.source_job_id).toBeNull();
    expect(lixo.defaults).toEqual({ start_time: '', end_time: '23:00', slots: 1, budget: 0 });
    expect(sanitizeSavedTemplate({ id: 'y', name: 'N', template: null, defaults: 'x' }).defaults.slots).toBe(1);
  });

  it('templateToSave não leva data nem origem, e volta igual por sanitizeSavedTemplate', () => {
    const t = { ...emptyTemplate('garcom'), title: 'Garçom sábado', location: 'Salão', has_lunch: true, source_job_id: 'job-9' };
    const defaults = { start_time: '18:00', end_time: '23:00', slots: 3, budget: 150 };
    const saved = templateToSave(t, defaults);
    expect(saved.template).not.toHaveProperty('source_job_id');
    expect(saved.template).not.toHaveProperty('date');
    const back = sanitizeSavedTemplate({ id: 'i', name: 'Garçom sábado', ...saved });
    expect(back.template).toMatchObject({ title: 'Garçom sábado', category: 'garcom', location: 'Salão', has_lunch: true, source_job_id: null });
    expect(back.defaults).toEqual(defaults);
  });
});
