import { describe, it, expect } from 'vitest';
import { isJobActive, isJobConcluded, isShiftInProgress } from './shiftProgress';
import { formatShiftDuration, shiftMinutes } from './dateUtils';

describe('D-14: contratado não é em andamento', () => {
  const now = '2026-11-25T01:00:00-03:00';
  it('só há "em andamento" com chegada registrada e sem saída confirmada', () => {
    expect(isShiftInProgress({ status: 'hired' })).toBe(false);
    expect(isShiftInProgress({ status: 'hired', worker_checkin_at: now })).toBe(true);
    expect(isShiftInProgress({ status: 'in_progress', company_checkin_confirmed_at: now })).toBe(true);
    expect(isShiftInProgress({ status: 'in_progress', company_checkin_confirmed_at: now, company_checkout_confirmed_at: now })).toBe(false);
    expect(isShiftInProgress({ status: 'completed', worker_checkin_at: now })).toBe(false);
    expect(isShiftInProgress({ status: 'cancelled', worker_checkin_at: now })).toBe(false);
  });
});

describe('D-18: turno pago/concluído não é ativo', () => {
  it('conclui quando todas as vagas estão concluídas', () => {
    expect(isJobConcluded(1, [{ status: 'completed' }])).toBe(true);
    expect(isJobConcluded(2, [{ status: 'completed' }])).toBe(false);
    expect(isJobConcluded(null, [])).toBe(false);
  });
  it('ativo = aberto e não concluído', () => {
    expect(isJobActive({ status: 'open', slots: 1 }, [{ status: 'completed' }])).toBe(false);
    expect(isJobActive({ status: 'open', slots: 1 }, [{ status: 'hired' }])).toBe(true);
    expect(isJobActive({ status: 'paused', slots: 1 }, [])).toBe(false);
  });
});

describe('D-13: duração em pt-BR', () => {
  it('01:10-04:50 vira "3 h 40 min", nunca "3.7 h"', () => {
    expect(formatShiftDuration(shiftMinutes('01:10', '04:50'))).toBe('3 h 40 min');
  });
  it('horas cheias, só minutos, virada do dia e intervalo', () => {
    expect(formatShiftDuration(shiftMinutes('09:00', '17:00'))).toBe('8 h');
    expect(formatShiftDuration(shiftMinutes('09:00', '09:45'))).toBe('45 min');
    expect(formatShiftDuration(shiftMinutes('22:00', '04:00'))).toBe('6 h');
    expect(formatShiftDuration(shiftMinutes('09:00', '18:00', 60))).toBe('8 h');
    expect(shiftMinutes('', '10:00')).toBe(0);
  });
});
