/**
 * Helpers de formatação PURAMENTE de exibição para o painel de Analytics de Operação (F9).
 * Não duplica lógica de negócio — só formata números que o service já calculou.
 */
import type { PeriodDelta } from '../../../types';

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatHours(value: number): string {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 0 })}h`;
}

export function formatPercent(ratio: number, digits = 0): string {
  return `${(ratio * 100).toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
}

export interface DeltaDisplay {
  label: string;
  direction: 'up' | 'down' | 'flat' | 'none';
}

/**
 * `previous === null` → não há período anterior comparável (sem-fonte no anterior): não exibir
 * seta, só o valor atual. `percentChange === null` com `previous` não-nulo → `previous === 0`
 * (variação percentual indefinida, mas sabemos que era zero).
 */
export function formatDelta(delta: PeriodDelta): DeltaDisplay {
  if (delta.previous === null) {
    return { label: 'Sem período anterior para comparar', direction: 'none' };
  }
  if (delta.percentChange === null) {
    return { label: 'Período anterior era zero', direction: 'flat' };
  }
  const rounded = Math.round(delta.percentChange * 10) / 10;
  if (rounded === 0) return { label: 'Igual ao período anterior', direction: 'flat' };
  const sign = rounded > 0 ? '+' : '';
  return {
    label: `${sign}${rounded.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs. período anterior`,
    direction: rounded > 0 ? 'up' : 'down',
  };
}

/** Data civil `YYYY-MM-DD` → `DD/MM/YYYY`, sem passar por `Date`/fuso (string pura). */
export function formatCivilDateBR(dateOnly: string): string {
  const [y, m, d] = dateOnly.split('-');
  return `${d}/${m}/${y}`;
}
