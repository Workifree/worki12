import { describe, it, expect } from 'vitest';
import { attendanceLabel, isJobActive, isJobConcluded, isShiftInProgress, shiftTimeState } from './shiftProgress';
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

describe('shiftTimeState / isJobActive / attendanceLabel', () => {
  // 25/11/2026, 09:00-17:00 em São Paulo (UTC-3)
  const day = { start_date: '2026-11-25', work_start_time: '09:00', work_end_time: '17:00' };
  const at = (iso: string) => new Date(iso);
  it('upcoming, ongoing e past', () => {
    expect(shiftTimeState(day, at('2026-11-25T11:59:00Z'))).toBe('upcoming');
    expect(shiftTimeState(day, at('2026-11-25T15:00:00Z'))).toBe('ongoing');
    expect(shiftTimeState(day, at('2026-11-26T12:00:00Z'))).toBe('past');
  });
  it('limite da tolerância de 2h após o fim', () => {
    expect(shiftTimeState(day, at('2026-11-25T22:00:00Z'))).toBe('ongoing');
    expect(shiftTimeState(day, at('2026-11-25T22:00:01Z'))).toBe('past');
  });
  it('turno que cruza a meia-noite: 22:00-04:00 às 02:00 do dia seguinte é ongoing', () => {
    const night = { start_date: '2026-11-25', work_start_time: '22:00', work_end_time: '04:00' };
    expect(shiftTimeState(night, at('2026-11-26T05:00:00Z'))).toBe('ongoing');
    expect(shiftTimeState(night, at('2026-11-26T09:01:00Z'))).toBe('past');
  });
  it('start_date em timestamp 15:00 UTC cai no dia local certo', () => {
    const ts = { start_date: '2026-11-25T15:00:00Z', work_start_time: '09:00', work_end_time: '17:00' };
    expect(shiftTimeState(ts, at('2026-11-25T15:00:00Z'))).toBe('ongoing');
  });
  it('sem work_end_time vale o fim do dia local; sem data nunca é past', () => {
    const open = { start_date: '2026-11-25', work_start_time: '09:00' };
    expect(shiftTimeState(open, at('2026-11-26T02:59:00Z'))).toBe('ongoing');
    expect(shiftTimeState(open, at('2026-11-26T03:01:00Z'))).toBe('past');
    expect(shiftTimeState({}, at('2030-01-01T00:00:00Z'))).toBe('ongoing');
  });
  it('isJobActive de turno passado é falso', () => {
    const job = { status: 'open', slots: 1, ...day };
    expect(isJobActive(job, [{ status: 'hired' }], at('2026-11-25T15:00:00Z'))).toBe(true);
    expect(isJobActive(job, [{ status: 'hired' }], at('2026-11-27T15:00:00Z'))).toBe(false);
  });
  it('attendanceLabel', () => {
    const past = at('2026-11-27T15:00:00Z');
    const live = at('2026-11-25T15:00:00Z');
    expect(attendanceLabel({ status: 'hired' }, day, past)).toEqual({ rotulo: 'Não compareceu / sem registro', tone: 'danger' });
    expect(attendanceLabel({ status: 'hired' }, day, live).rotulo).toBe('Aguardando chegada');
    expect(attendanceLabel({ status: 'in_progress', company_checkout_confirmed_at: 'x' }, day, past).rotulo).toBe('Saída confirmada');
    expect(attendanceLabel({ status: 'hired', worker_checkin_at: 'x' }, day, live).rotulo).toBe('Chegou — confirme');
    expect(attendanceLabel({ status: 'hired', company_checkin_confirmed_at: 'x' }, day, live).rotulo).toBe('Presença OK');
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
