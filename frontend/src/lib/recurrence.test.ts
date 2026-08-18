import { describe, it, expect } from 'vitest';
import { generateOccurrenceDates, MAX_SERIES_OCCURRENCES } from './recurrence';
import { localDateToTimestamp } from './dateUtils';
import { parseDateOnly } from './dateUtils';

// Referência fixa, bem antes de qualquer range usado nos testes — evita que o clamp "nunca gera
// no passado" (ver recurrence.ts) interfira nas asserções de contagem/datas.
const FAR_PAST_REFERENCE = new Date(2026, 0, 1, 12, 0, 0); // 01/01/2026 meio-dia local

describe('generateOccurrenceDates — semanal', () => {
  it('A1 (spec): só Domingo, 01/09/2026 a 30/09/2026 → exatamente 4 domingos', () => {
    const result = generateOccurrenceDates({
      recurrenceType: 'weekly',
      weekdays: [0],
      rangeStartDate: '2026-09-01',
      rangeEndDate: '2026-09-30',
      referenceDate: FAR_PAST_REFERENCE,
    });

    expect(result).toEqual(['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']);
  });

  it('múltiplos dias da semana no mesmo intervalo (Domingo + Quarta)', () => {
    const result = generateOccurrenceDates({
      recurrenceType: 'weekly',
      weekdays: [0, 3], // domingo, quarta
      rangeStartDate: '2026-09-01', // terça
      rangeEndDate: '2026-09-14', // segunda
      referenceDate: FAR_PAST_REFERENCE,
    });

    // Domingos: 06, 13. Quartas: 02, 09.
    expect(result).toEqual(['2026-09-02', '2026-09-06', '2026-09-09', '2026-09-13']);
  });

  it('respeita as duas pontas do intervalo (inclusive)', () => {
    // 06/09/2026 é domingo — está NAS duas pontas do range.
    const result = generateOccurrenceDates({
      recurrenceType: 'weekly',
      weekdays: [0],
      rangeStartDate: '2026-09-06',
      rangeEndDate: '2026-09-06',
      referenceDate: FAR_PAST_REFERENCE,
    });

    expect(result).toEqual(['2026-09-06']);
  });

  it('devolve lista vazia quando nenhum dia do intervalo bate com os weekdays marcados', () => {
    const result = generateOccurrenceDates({
      recurrenceType: 'weekly',
      weekdays: [1], // segunda — intervalo de 1 dia só, numa terça
      rangeStartDate: '2026-09-01',
      rangeEndDate: '2026-09-01',
      referenceDate: FAR_PAST_REFERENCE,
    });

    expect(result).toEqual([]);
  });
});

describe('generateOccurrenceDates — diária (bloco de cobertura / férias)', () => {
  it('A2 (spec): 01/09/2026 a 05/09/2026 → 5 dias corridos, sem filtro de dia-da-semana', () => {
    const result = generateOccurrenceDates({
      recurrenceType: 'daily',
      rangeStartDate: '2026-09-01',
      rangeEndDate: '2026-09-05',
      referenceDate: FAR_PAST_REFERENCE,
    });

    expect(result).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
  });

  it('um único dia (rangeStartDate === rangeEndDate) gera uma ocorrência', () => {
    const result = generateOccurrenceDates({
      recurrenceType: 'daily',
      rangeStartDate: '2026-09-01',
      rangeEndDate: '2026-09-01',
      referenceDate: FAR_PAST_REFERENCE,
    });

    expect(result).toEqual(['2026-09-01']);
  });
});

describe('generateOccurrenceDates — clamp para não gerar no passado', () => {
  it('range_start_date anterior a "hoje" (referenceDate) é adiantado para hoje', () => {
    const result = generateOccurrenceDates({
      recurrenceType: 'daily',
      rangeStartDate: '2026-08-01', // antes da referência
      rangeEndDate: '2026-08-20',
      referenceDate: new Date(2026, 7, 17, 12, 0, 0), // "hoje" = 17/08/2026
    });

    expect(result[0]).toBe('2026-08-17');
    expect(result[result.length - 1]).toBe('2026-08-20');
  });
});

describe('generateOccurrenceDates — A4 (spec): virada de fuso não desloca o dia', () => {
  it('referenceDate às 21h, 23h59 e meio-dia (mesmo dia civil local) produzem EXATAMENTE o mesmo resultado', () => {
    // As três representam o MESMO dia civil LOCAL (17/08/2026, no fuso em que o processo de
    // teste roda), só variando o horário — é precisamente a janela em que
    // `toISOString()`/`getUTCDay()` cru já fez o produto "perder" um dia perto da virada, em
    // BRT (ver cabeçalho de dateUtils.ts). Não é preciso forçar TZ='America/Sao_Paulo' aqui: a
    // função só usa métodos LOCAIS (`getFullYear`/`getDate`/`getDay`) tanto para construir quanto
    // para ler a data, o que é simétrico em QUALQUER fuso — o teste é um guarda de regressão
    // contra a reintrodução de `toISOString()`/`getUTC*` no meio da função, não uma simulação
    // exata de BRT.
    const paramsBase = {
      recurrenceType: 'weekly' as const,
      weekdays: [0, 1, 2, 3, 4, 5, 6], // todos os dias — maximiza a chance de expor off-by-one
      rangeStartDate: '2026-08-17',
      rangeEndDate: '2026-08-24',
    };

    const noon = generateOccurrenceDates({
      ...paramsBase,
      referenceDate: new Date(2026, 7, 17, 12, 0, 0),
    });
    const at21h = generateOccurrenceDates({
      ...paramsBase,
      referenceDate: new Date(2026, 7, 17, 21, 0, 0),
    });
    const at2359 = generateOccurrenceDates({
      ...paramsBase,
      referenceDate: new Date(2026, 7, 17, 23, 59, 0),
    });

    expect(at21h).toEqual(noon);
    expect(at2359).toEqual(noon);
    // A primeira ocorrência elegível é o próprio dia local esperado — nunca o dia seguinte
    // (o que aconteceria se a referência "hoje" tivesse sido calculada via UTC cru).
    expect(noon[0]).toBe('2026-08-17');
  });
});

describe('generateOccurrenceDates — cap de 60 (R7)', () => {
  it('intervalo que geraria mais de 60 ocorrências NÃO é truncado — devolve a lista real para o chamador bloquear', () => {
    const result = generateOccurrenceDates({
      recurrenceType: 'daily', // ~181 dias corridos
      rangeStartDate: '2027-01-01',
      rangeEndDate: '2027-06-30',
      referenceDate: FAR_PAST_REFERENCE,
    });

    expect(result.length).toBeGreaterThan(MAX_SERIES_OCCURRENCES);
    // Confirma que é o CHAMADOR que decide bloquear a partir desta contagem, não a função:
    expect(result.length > MAX_SERIES_OCCURRENCES).toBe(true);
  });

  it('MAX_SERIES_OCCURRENCES é 60 (número documentado na spec e no ADR)', () => {
    expect(MAX_SERIES_OCCURRENCES).toBe(60);
  });
});

describe('localDateToTimestamp — âncora de meio-dia (dateUtils)', () => {
  it("localDateToTimestamp('2026-08-17') cai no dia 17 quando reconvertido com parseDateOnly", () => {
    const timestamp = localDateToTimestamp('2026-08-17');
    const reparsed = parseDateOnly(timestamp);

    expect(reparsed.getFullYear()).toBe(2026);
    expect(reparsed.getMonth()).toBe(7); // agosto, 0-indexed
    expect(reparsed.getDate()).toBe(17);
  });

  it('produz um ISO string válido (não lança, não é NaN)', () => {
    const timestamp = localDateToTimestamp('2026-01-01');
    expect(Number.isNaN(new Date(timestamp).getTime())).toBe(false);
  });
});
