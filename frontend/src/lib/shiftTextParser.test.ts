import { describe, expect, it } from 'vitest';
import { batchFromParse, parseShiftText } from './shiftTextParser';
import { emptyTemplate } from './shiftDrafts';

// 25/11/2026 é quarta-feira.
const TODAY = '2026-11-25';
const parse = (text: string, today = TODAY) => parseShiftText(text, { today });
/** "data entrada-saída vagas valor função" */
const view = (text: string, today = TODAY) =>
  parse(text, today).shifts.map(
    (s) => `${s.date.slice(5)} ${s.start_time}-${s.end_time} ${s.slots}x ${s.budget} ${s.category ?? '?'}${s.budget_type ? ` ${s.budget_type}` : ''}`,
  );

describe('parseShiftText — o que entende', () => {
  it('A10: o exemplo da spec', () => {
    const r = parse('sex e sáb 18-23h 3 garçons 150');
    expect(view('sex e sáb 18-23h 3 garçons 150')).toEqual([
      '11-27 18:00-23:00 3x 150 garcom',
      '11-28 18:00-23:00 3x 150 garcom',
    ]);
    expect(r.unknown).toEqual([]);
    expect(r.notes).toEqual([]);
  });

  it.each<[string, string[]]>([
    ['Sexta-feira das 18 às 23 três garçonetes R$150', ['11-27 18:00-23:00 3x 150 garcom']],
    ['amanhã 18h às 23h30 1 barman R$ 180,50', ['11-26 18:00-23:30 1x 180.5 barman']],
    ['hoje 22:00-02:00 2 seguranças 200 reais', ['11-25 22:00-02:00 2x 200 seguranca']],
    ['sab 18h30-2h 2 copeiras 120', ['11-28 18:30-02:00 2x 120 limpeza']],
    ['sab 18-24h 2 caixas 120', ['11-28 18:00-00:00 2x 120 caixa']],
    ['29/11 9-17 2 atendentes 120', ['11-29 09:00-17:00 2x 120 atendente']],
    ['dom 29/11 12h até 17h 2 cumins 100', ['11-29 12:00-17:00 2x 100 auxiliar_cozinha']],
    ['dom 10h-16h 4 auxiliares de cozinha 1.200', ['11-29 10:00-16:00 4x 1200 auxiliar_cozinha']],
    ['qui 8-12h 1 barista 15/h', ['11-26 08:00-12:00 1x 15 barista hourly']],
    ['qui 8-12h 1 barista R$ 20 por hora', ['11-26 08:00-12:00 1x 20 barista hourly']],
    ['qui 8-12h 1 barista 120 por dia', ['11-26 08:00-12:00 1x 120 barista daily']],
    ['depois de amanhã 18-23h 1 recepcionista 100', ['11-27 18:00-23:00 1x 100 recepcao']],
    ['fds 9-17h 2 promotoras 130', ['11-28 09:00-17:00 2x 130 promotor', '11-29 09:00-17:00 2x 130 promotor']],
    ['10/01 18-23h 1 garçom 150', ['01-10 18:00-23:00 1x 150 garcom']],
    ['sex 18-23h 3 vagas 150', ['11-27 18:00-23:00 3x 150 ?']],
    ['preciso de 2 garçons para sexta das 19 às 23 pagando 140', ['11-27 19:00-23:00 2x 140 garcom']],
  ])('%s', (text, expected) => {
    expect(view(text)).toEqual(expected);
    expect(parse(text).unknown).toEqual([]);
  });

  it('A9: sem saída e sem valor não inventa nada', () => {
    expect(view('3 garçons sexta 18h')).toEqual(['11-27 18:00- 3x 0 garcom']);
  });

  it('intervalo de dias "seg a qua" parte da próxima segunda', () => {
    expect(view('seg a qua 9-17h 1 estoquista 110').map((v) => v.slice(0, 5))).toEqual(['11-30', '12-01', '12-02']);
  });

  it('hoje conta como o próprio dia da semana', () => {
    expect(view('quarta 18-23h 1 garçom 150')[0]).toContain('11-25');
  });

  it('no domingo, "sáb e dom" vira o próximo fim de semana em ordem', () => {
    expect(view('sáb e dom 18-23h 1 garçom 150', '2026-11-29').map((v) => v.slice(0, 5))).toEqual(['12-05', '12-06']);
  });

  it('data passada recente fica como está (a revisão bloqueia), sem pular para o ano que vem', () => {
    expect(parse('20/11 18-23h 1 garçom 150').shifts[0].date).toBe('2026-11-20');
  });

  it('virada de ano', () => {
    expect(parse('sábado 18-23h 1 garçom 150', '2026-12-31').shifts[0].date).toBe('2027-01-02');
  });

  it('várias funções com um valor cada', () => {
    expect(view('sex 18-23h 2 garçons 150 e 1 barman 180')).toEqual([
      '11-27 18:00-23:00 2x 150 garcom',
      '11-27 18:00-23:00 1x 180 barman',
    ]);
  });

  it('um valor no fim vale para todas as funções', () => {
    expect(view('sex 18-23h 2 garçons e 1 barman 150').every((v) => v.includes(' 150 '))).toBe(true);
  });

  it('um valor no meio não é estendido à função seguinte', () => {
    expect(view('sex 18-23h 2 garçons 150 e 1 barman')).toEqual([
      '11-27 18:00-23:00 2x 150 garcom',
      '11-27 18:00-23:00 1x 0 barman',
    ]);
  });

  it('cada linha (ou ";") tem o próprio horário', () => {
    expect(view('sex 18-23h 1 garçom 150; sáb 12-17h 2 garçons 120\ndom 9-13h 1 caixa 90')).toHaveLength(3);
  });

  it('função sem quantidade avisa que considerou 1', () => {
    const r = parse('sex 18-23h barman 180');
    expect(r.shifts[0].slots).toBe(1);
    expect(r.notes[0]).toMatch(/1 vaga/);
  });

  it('acento digitado decomposto (teclado do celular) também funciona', () => {
    expect(view('sáb 18-23h 1 garçom 150'.normalize('NFD'))).toHaveLength(1);
  });
});

describe('parseShiftText — o que não entende (nunca chuta)', () => {
  it.each([
    'tal dia lá',
    '3 garçons 150',
    'sexta',
    'sexta que vem 18-23h 1 garçom 150',
    'toda sexta 18-23h 1 garçom 150',
    'sex ou sáb 18-23h 1 garçom 150',
    'não precisa sexta 18-23h 1 garçom',
    'todos os dias menos domingo 18-23h',
    'semana inteira 18-23h 2 garçons',
    'dia 29 18-23h 1 garçom 150',
    '31/02 18-23h 1 garçom 150',
    'sex 25-27h 1 garçom 150',
    'sex 18-18h 1 garçom 150',
    'sex 12-14h e 18-23h 2 garçons 150',
    'sex 29/11 18-23h 1 garçom 150',
  ])('recusa "%s" sem gerar linha', (text) => {
    const r = parse(text);
    expect(r.shifts).toEqual([]);
    expect(r.unknown.join(' ')).toMatch(/Não (entendi|li)/);
  });

  it('palavra desconhecida é citada como digitada e a linha entendida segue', () => {
    const r = parse('sex 18-23h 2 garçons 150 Uniformizados');
    expect(r.shifts).toHaveLength(1);
    expect(r.unknown).toEqual(['Não entendi: "Uniformizados".']);
  });

  it('número pequeno solto não vira valor', () => {
    const r = parse('sex 18-23h 2 garçons 7');
    expect(r.shifts[0].budget).toBe(0);
    expect(r.unknown[0]).toContain('7');
  });

  it('dois valores para uma função: deixa o valor em branco e avisa', () => {
    const r = parse('sex 18-23h 2 garçons 150 200');
    expect(r.shifts[0].budget).toBe(0);
    expect(r.unknown.join()).toMatch(/valor/);
  });

  it('"2-3 garçons" não é lido como horário', () => {
    expect(parse('sex 2-3 garçons 150').shifts.every((s) => s.start_time === '')).toBe(true);
    expect(parse('sex 2-3 garçons 150').unknown.length).toBeGreaterThan(0);
  });

  it('texto vazio não produz nada', () => {
    expect(parse('   \n ;')).toEqual({ shifts: [], unknown: [], notes: [] });
  });
});

describe('batchFromParse', () => {
  it('sem linha entendida não há rascunho', () => {
    expect(batchFromParse(parse('tal dia lá'))).toBeNull();
  });

  it('usa a primeira função no comum e ajusta só as linhas diferentes', () => {
    const batch = batchFromParse(parse('sex 18-23h 2 garçons 150 e 1 barman 180'));
    expect(batch?.source).toBe('parser');
    expect(batch?.template.category).toBe('garcom');
    expect(batch?.template.description).not.toBe('');
    expect(batch?.rows[0].overrides).toBeUndefined();
    expect(batch?.rows[1].overrides?.category).toBe('barman');
  });

  it('mantém o modelo escolhido quando o texto fala da mesma função', () => {
    const base = { ...emptyTemplate('garcom'), title: 'Garçom evento', location: 'Salão 2' };
    expect(batchFromParse(parse('sex 18-23h 2 garçons 150'), base)?.template.title).toBe('Garçom evento');
  });
});
