// F7 — Disponibilidade declarada pelo freela: helpers puros (nenhum I/O).
//
// Contrato normativo: `.harness/spec/disponibilidade-freela/ddl-aprovado.md` (§3.2, §3.5) e
// ADR-20260821-disponibilidade-grade-jsonb.md. Este arquivo é onde a cicatriz de formato de hora
// (LM-5 do DDL) e a poda de "vazio" (LM-8) moram — testadas em `availability.test.ts`.
//
// É SINAL, NUNCA TRAVA: estes helpers só decidem ORDEM (quem provavelmente aceita primeiro),
// nunca filtram nem bloqueiam disparo do Chamado de Turno.

import type { AvailabilityDays, AvailabilityPeriod, AvailabilityWeekday } from '../types';

/**
 * Bucketiza um horário de início de turno (`jobs.work_start_time`) num período do dia.
 *
 * LM-5 (DDL §3.2): a coluna é `time` no Postgres e chega dos dois formatos no código real —
 * `'18:00'` (`ShiftCallModal.test.tsx:103`) e `'20:00:00'` (`InviteToShiftModal.test.tsx:143`).
 * Uma regex só de `HH:MM` devolveria `null` para boa parte dos turnos reais — a feature não
 * apareceria, SEM erro e sem log. Por isso a regex é ancorada só nos dois primeiros grupos
 * (`^(\d{1,2}):(\d{2})`) e ignora o que vier depois (segundos, ou nada).
 *
 * Faixas (não circulares, exceto 'noite' que atravessa a meia-noite):
 *   05:00–11:59 → 'manha' | 12:00–17:59 → 'tarde' | 18:00–04:59 → 'noite'
 *
 * Entrada inválida (fora do range 0-23h/0-59min, não-numérica, vazia, `null`/`undefined`) → `null`.
 * `null` de retorno é SINAL de "não sei o período", nunca deve ser tratado como "disponível" nem
 * "indisponível" — quem chama decide o que fazer (ex.: não ordenar nada).
 */
export function periodForTime(time: string | null | undefined): AvailabilityPeriod | null {
  if (!time) return null;

  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return null;

  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;

  if (hh >= 5 && hh < 12) return 'manha';
  if (hh >= 12 && hh < 18) return 'tarde';
  // 18:00–23:59 e 00:00–04:59 são ambos 'noite' (madrugada dobrada em noite, DDL §1).
  return 'noite';
}

const AVAILABILITY_WEEKDAYS: readonly AvailabilityWeekday[] = ['0', '1', '2', '3', '4', '5', '6'];
const AVAILABILITY_PERIODS: readonly AvailabilityPeriod[] = ['manha', 'tarde', 'noite'];

function isAvailabilityWeekday(key: string): key is AvailabilityWeekday {
  return (AVAILABILITY_WEEKDAYS as readonly string[]).includes(key);
}

function isAvailabilityPeriod(value: unknown): value is AvailabilityPeriod {
  return typeof value === 'string' && (AVAILABILITY_PERIODS as readonly string[]).includes(value);
}

/**
 * Normaliza uma grade de disponibilidade ANTES de gravar no banco: poda chaves com array vazio
 * e remove qualquer entrada fora do domínio válido (dia/período desconhecido, duplicata).
 *
 * LM-8 (DDL): só pode haver UMA representação de "vazio". Se depois da poda não sobrar nenhuma
 * chave, devolve `null` (SQL NULL) — NUNCA `{}` — porque o CTA de adoção (R14) testa
 * `availability_days IS NULL` e o CHECK do banco rejeita o JSON `null` literal (que é diferente
 * de SQL NULL: aqui devolvemos o valor JS `null`, que o client grava como coluna NULL).
 *
 * Também remove duplicata dentro de cada dia e recorta para no máximo 3 períodos (mesmo teto do
 * CHECK `workers_availability_days_shape`), para que um objeto já normalizado sempre passe no
 * banco sem depender de o client ter feito certo.
 */
export function normalizeAvailabilityGrade(
  grade: AvailabilityDays | null | undefined,
): AvailabilityDays | null {
  if (!grade) return null;

  const normalized: AvailabilityDays = {};

  for (const key of Object.keys(grade)) {
    if (!isAvailabilityWeekday(key)) continue; // fora do domínio '0'..'6' — descartado

    const rawPeriods = grade[key];
    if (!Array.isArray(rawPeriods)) continue;

    const dedup = Array.from(new Set(rawPeriods.filter(isAvailabilityPeriod))).slice(0, 3);
    if (dedup.length === 0) continue; // poda: dia sem período declarado não vira chave vazia

    normalized[key] = dedup;
  }

  return Object.keys(normalized).length === 0 ? null : normalized;
}

/**
 * Responde "este freela declarou disponibilidade para este dia+período?".
 *
 * Contrato de vizinhança com `ShiftCallModal` (DDL §3.5): `weekday` é `0..6` (0=domingo, mesma
 * convenção de `job_series.weekdays`, derivado no client via `getWeekdayIndex`/`parseDateOnly` —
 * nunca aqui). `period` pode ser `null` (horário do turno não resolvido) — nesse caso a resposta
 * é sempre `false`, nunca lança.
 *
 * `undefined`/`null` na grade (nunca declarou, ou coluna não trazida pela query) → `false`, o
 * mesmo tratamento de "não declarou este dia": ausência de dado NUNCA vira "indisponível" nem
 * "disponível" no produto — é apenas "sem sinal para ordenar", refletido aqui como `false`
 * (não entra no grupo ordenado à frente).
 */
export function isWorkerAvailableFor(
  grade: AvailabilityDays | null | undefined,
  weekday: number,
  period: AvailabilityPeriod | null,
): boolean {
  if (!grade || period === null) return false;
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return false;

  const key = String(weekday) as AvailabilityWeekday;
  const periods = grade[key];
  if (!periods) return false;

  return periods.includes(period);
}
