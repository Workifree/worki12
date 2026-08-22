import { describe, it, expect } from 'vitest';
import {
  getWeekdayIndex,
  isCertificationExpired,
  todayLocalDate,
  calculateWorkedHours,
  formatDurationMs,
  formatDurationShort,
  todayInBrazil,
  toBrazilDateOnly,
} from './dateUtils';

/**
 * Soma/subtrai dias a partir de HOJE em horário LOCAL, devolvendo `YYYY-MM-DD` — nunca datas
 * absolutas fixas no texto do teste, porque este arquivo roda em qualquer dia (CI e máquina de
 * quem desenvolve). `vitest.config.ts` fixa `TZ=America/Sao_Paulo`; construir a partir dos
 * componentes locais de `todayLocalDate()` evita reintroduzir o próprio bug de fuso que a
 * função sob teste existe para evitar.
 */
function shiftDays(offset: number): string {
    const [y, m, d] = todayLocalDate().split('-').map(Number);
    const shifted = new Date(y, m - 1, d + offset);
    const yyyy = shifted.getFullYear();
    const mm = String(shifted.getMonth() + 1).padStart(2, '0');
    const dd = String(shifted.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// F7 — BLOCKER 2 da revisão de frontend: `getWeekdayIndex` foi extraído de `ShiftCallModal`
// (`parseDateOnly(job.start_date).getDay()` inline) para não criar uma segunda convenção de
// semana concorrente com `job_series.weekdays`/`lib/availability.ts` (0=domingo .. 6=sábado).
//
// `vitest.config.ts` fixa `TZ='America/Sao_Paulo'` — no runner do CI (que roda em UTC por
// padrão) uma implementação que voltasse a usar `new Date(isoString).getUTCDay()` ou
// `new Date(isoString).getDay()` cru (sem passar por `parseDateOnly`) passaria por acidente,
// porque em UTC não há o off-by-one de meia-noite. Os casos abaixo testam justamente as datas
// onde o bug apareceria em BRT (perto da virada do dia em UTC-3).
// ---------------------------------------------------------------------------

describe('getWeekdayIndex — convenção 0=domingo, calculado em horário LOCAL', () => {
  it('domingo (2026-09-06) → 0', () => {
    expect(getWeekdayIndex('2026-09-06')).toBe(0);
  });

  it('quarta-feira (2026-09-02) → 3', () => {
    expect(getWeekdayIndex('2026-09-02')).toBe(3);
  });

  it('sábado (2026-09-12) → 6', () => {
    expect(getWeekdayIndex('2026-09-12')).toBe(6);
  });

  it('não sofre off-by-one de fuso: `2026-07-01` é quarta (3), não terça (2)', () => {
    // Sem `parseDateOnly` (ex.: `new Date('2026-07-01').getDay()` cru), o motor de datas
    // interpretaria a string como meia-noite UTC, que em BRT (UTC-3) ainda é 30/06 às 21h —
    // recuando o dia da semana em 1. Este é o caso canônico documentado no cabeçalho de
    // `parseDateOnly` em `dateUtils.ts`.
    expect(getWeekdayIndex('2026-07-01')).toBe(3);
  });

  it('aceita timestamp ISO completo, usando só a parte de data (mesmo contrato de `parseDateOnly`)', () => {
    expect(getWeekdayIndex('2026-09-06T23:59:59.000Z')).toBe(0);
  });

  it('vira o ano corretamente (2026-12-31 é quinta, 4)', () => {
    expect(getWeekdayIndex('2026-12-31')).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// isCertificationExpired — predicado ÚNICO de vencimento (F8, D2 do ddl-aprovado).
// MESMO predicado do SQL: `expires_at IS NOT NULL AND expires_at < data local`.
// Comparação SEMPRE com data local — nunca `new Date().toISOString().slice(0,10)`
// (UTC), que erra o dia entre ~21h e 00h no Brasil.
// ---------------------------------------------------------------------------

describe('isCertificationExpired — predicado derivado, nunca status congelado (D2)', () => {
  it('sem expires_at (null) → nunca vencida', () => {
    expect(isCertificationExpired(null)).toBe(false);
  });

  it('sem expires_at (undefined) → nunca vencida', () => {
    expect(isCertificationExpired(undefined)).toBe(false);
  });

  it('data de ontem → vencida (true)', () => {
    expect(isCertificationExpired(shiftDays(-1))).toBe(true);
  });

  it('data de hoje → AINDA NÃO vencida (predicado é estritamente `<`, não `<=`)', () => {
    expect(isCertificationExpired(shiftDays(0))).toBe(false);
  });

  it('data de amanhã → não vencida', () => {
    expect(isCertificationExpired(shiftDays(1))).toBe(false);
  });

  it('vencida há 1 ano → continua true (R8: vencida antiga nunca é tratada como "não vencida")', () => {
    expect(isCertificationExpired(shiftDays(-365))).toBe(true);
  });

  it('aceita timestamp ISO completo — usa só a parte de data, sem conversão de fuso', () => {
    // Timestamp com hora 23:59:59Z de ONTEM: se a função convertesse para Date/UTC em vez de
    // só cortar a string, isso poderia (dependendo da implementação) mudar o resultado. O
    // contrato é: pega a string ANTES do 'T' e compara como texto de data, ponto.
    const yesterday = shiftDays(-1);
    expect(isCertificationExpired(`${yesterday}T23:59:59.000Z`)).toBe(true);
  });

  it('não muta nem depende de estado global — duas chamadas com o mesmo argumento dão o mesmo resultado', () => {
    const date = shiftDays(-10);
    expect(isCertificationExpired(date)).toBe(isCertificationExpired(date));
  });
});

// ---------------------------------------------------------------------------
// calculateWorkedHours — extraída de ReceiptView (F9, PRD D2/Step 1). Mesmo comportamento:
// null se ausente/inconsistente; meia-noite já resolvida por timestamps absolutos (sem hack).
// ---------------------------------------------------------------------------

describe('calculateWorkedHours — extraída de ReceiptView, mesma assinatura e comportamento', () => {
  it('checkin/checkout no mesmo dia: calcula horas corretamente', () => {
    const hours = calculateWorkedHours('2026-08-20T08:00:00.000Z', '2026-08-20T16:30:00.000Z');
    expect(hours).toBe(8.5);
  });

  it('turno que cruza a meia-noite (2 turnos reais em produção, ver STEP 0 do prompt): ' +
     'checkin 23:00, checkout 01:00 do dia seguinte — timestamps absolutos resolvem sem ajuste manual', () => {
    const hours = calculateWorkedHours('2026-08-20T23:00:00.000Z', '2026-08-21T01:00:00.000Z');
    expect(hours).toBe(2);
  });

  it('checkin ausente → null', () => {
    expect(calculateWorkedHours(null, '2026-08-20T16:00:00.000Z')).toBeNull();
  });

  it('checkout ausente → null (turno sem checkout — nunca inventar horas)', () => {
    expect(calculateWorkedHours('2026-08-20T08:00:00.000Z', undefined)).toBeNull();
  });

  it('checkout <= checkin (dado inconsistente) → null, nunca duração negativa', () => {
    expect(calculateWorkedHours('2026-08-20T16:00:00.000Z', '2026-08-20T08:00:00.000Z')).toBeNull();
  });

  it('checkout igual ao checkin → null (duração zero não é duração válida)', () => {
    expect(calculateWorkedHours('2026-08-20T08:00:00.000Z', '2026-08-20T08:00:00.000Z')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatDurationMs / formatDurationShort — núcleo extraído (R9). Mesma formatação em
// qualquer lugar que meça "tempo até o primeiro aceite" — chamado de turno e painel de operação.
// ---------------------------------------------------------------------------

describe('formatDurationMs — núcleo de formatação, reaproveitado por formatDurationShort', () => {
  it('menos de 1 minuto', () => {
    expect(formatDurationMs(20_000)).toBe('menos de 1 min');
  });

  it('minutos exatos (6 min — o número do produto, "de 2 horas para 6 minutos")', () => {
    expect(formatDurationMs(6 * 60_000)).toBe('6 min');
  });

  it('horas exatas, sem minutos residuais', () => {
    expect(formatDurationMs(2 * 60 * 60_000)).toBe('2h');
  });

  it('horas com minutos residuais', () => {
    expect(formatDurationMs(((1 * 60) + 12) * 60_000)).toBe('1h 12min');
  });

  it('negativo ou não finito → "—" (nunca duração negativa renderizada)', () => {
    expect(formatDurationMs(-1000)).toBe('—');
    expect(formatDurationMs(NaN)).toBe('—');
  });

  it('formatDurationShort continua funcionando a partir de dois ISO (usa o mesmo núcleo)', () => {
    expect(formatDurationShort('2026-08-20T10:00:00.000Z', '2026-08-20T10:06:00.000Z')).toBe('6 min');
  });
});

// ---------------------------------------------------------------------------
// todayInBrazil / toBrazilDateOnly — fuso EXPLÍCITO `America/Sao_Paulo` (D3), não o fuso do
// dispositivo. `vitest.config.ts` já fixa `TZ=America/Sao_Paulo` de propósito — NÃO mockar o
// fuso aqui. O teste abaixo prova o comportamento do jeito que sobrevive à troca de TZ do
// processo: usa `Intl.DateTimeFormat` com `timeZone` explícito, que ignora o TZ do host sempre —
// por isso o instante de fronteira (meia-noite UTC-3) resolve para o dia civil BRASILEIRO mesmo
// que o valor bruto (UTC) já tenha virado o dia seguinte.
// ---------------------------------------------------------------------------

describe('toBrazilDateOnly — data civil SEMPRE em America/Sao_Paulo, nunca o fuso do dispositivo', () => {
  it('instante que já é dia seguinte em UTC, mas ainda é o dia anterior em BRT (UTC-3)', () => {
    // 2026-01-01T02:00:00Z = 2025-12-31T23:00:00 em America/Sao_Paulo (UTC-3).
    expect(toBrazilDateOnly('2026-01-01T02:00:00.000Z')).toBe('2025-12-31');
  });

  it('instante que já é o mesmo dia em ambos os fusos', () => {
    expect(toBrazilDateOnly('2026-08-20T15:00:00.000Z')).toBe('2026-08-20');
  });

  it('meia-noite exata em BRT (03:00 UTC) vira o dia seguinte em BRT', () => {
    // 2026-08-20T03:00:00Z = 2026-08-20T00:00:00 em America/Sao_Paulo.
    expect(toBrazilDateOnly('2026-08-20T03:00:00.000Z')).toBe('2026-08-20');
    // Um minuto antes ainda é o dia civil anterior em BRT.
    expect(toBrazilDateOnly('2026-08-20T02:59:00.000Z')).toBe('2026-08-19');
  });

  it('aceita string sem milissegundos', () => {
    expect(toBrazilDateOnly('2026-08-20T15:00:00Z')).toBe('2026-08-20');
  });
});

describe('todayInBrazil — sempre YYYY-MM-DD, sem lançar', () => {
  it('formato YYYY-MM-DD', () => {
    expect(todayInBrazil()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('bate com toBrazilDateOnly(new Date().toISOString()) no mesmo instante', () => {
    const now = new Date();
    expect(todayInBrazil()).toBe(toBrazilDateOnly(now.toISOString()));
  });
});
