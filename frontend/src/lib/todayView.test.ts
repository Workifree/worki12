import { describe, it, expect } from 'vitest';
import { canCancelJob, canPassJob, dayLabel, groupByDay, jobHasStarted, responsibleLine } from './todayView';
import type { TodayJob } from '../services/shiftOperationService';

function job(overrides: Partial<TodayJob> = {}): TodayJob {
  return {
    jobId: 'j1', title: 'Garçom', status: 'open', date: '2026-11-25', startTime: '18:00', slots: 2, filled: 1,
    responsibleId: 'u1', responsibleKind: 'person', responsibleLabel: 'Ana', creatorLabel: null,
    tagId: null, tagName: null, tagArchived: false, ...overrides,
  };
}

describe('dayLabel / groupByDay', () => {
  it('rotula hoje e amanhã e ordena por data e horário', () => {
    expect(dayLabel('2026-11-23', '2026-11-23')).toBe('Hoje');
    expect(dayLabel('2026-11-24', '2026-11-23')).toBe('Amanhã');
    expect(dayLabel('2026-11-25', '2026-11-23')).toMatch(/25\/11/);

    const groups = groupByDay(
      [job({ jobId: 'c', date: '2026-11-24', startTime: null }), job({ jobId: 'b', startTime: '09:00', date: '2026-11-23' }), job({ jobId: 'a', startTime: '08:00', date: '2026-11-23' })],
      '2026-11-23',
    );
    expect(groups.map((g) => g.label)).toEqual(['Hoje', 'Amanhã']);
    expect(groups[0].jobs.map((j) => j.jobId)).toEqual(['a', 'b']);
  });
});

describe('responsibleLine', () => {
  it('mostra responsável e etiqueta', () => {
    expect(responsibleLine(job({ tagName: 'Salão' }))).toBe('Responsável: Ana · Salão');
  });
  it('sem etiqueta não deixa separador sobrando', () => {
    expect(responsibleLine(job())).toBe('Responsável: Ana');
  });
  it('Gestor efetivo mostra o rastro de quem criou', () => {
    expect(responsibleLine(job({ responsibleKind: 'gestor', responsibleLabel: 'Gestor', creatorLabel: 'Bia' })))
      .toBe('Responsável: Gestor (criado por Bia)');
  });
  it('turno coberto diz que você cobre um colega', () => {
    expect(responsibleLine(job({ responsibleKind: 'covering', responsibleLabel: 'Você cobre um colega', tagName: 'Salão' })))
      .toBe('Você cobre um colega · Salão');
  });
  it('marca etiqueta arquivada', () => {
    expect(responsibleLine(job({ tagName: 'Evento', tagArchived: true }))).toContain('Evento (arquivada)');
  });
});

describe('permissões da UI', () => {
  const gestor = { isGestor: true, teamEnabled: true, hasDestinations: true };
  const encarregado = { isGestor: false, teamEnabled: true, hasDestinations: true };

  it('Gestor passa qualquer turno; encarregado só os próprios', () => {
    expect(canPassJob(job(), gestor)).toBe(true);
    expect(canPassJob(job({ responsibleKind: 'self' }), encarregado)).toBe(true);
    expect(canPassJob(job({ responsibleKind: 'covering' }), encarregado)).toBe(false);
  });

  it('dono único (sem equipe) ou sem destino não vê "Passar para"', () => {
    expect(canPassJob(job(), { ...gestor, teamEnabled: false })).toBe(false);
    expect(canPassJob(job(), { ...gestor, hasDestinations: false })).toBe(false);
  });

  it('cancelar: Gestor sempre; encarregado só o que é dele ou cobre', () => {
    expect(canCancelJob(job(), { isGestor: true })).toBe(true);
    expect(canCancelJob(job({ responsibleKind: 'self' }), { isGestor: false })).toBe(true);
    expect(canCancelJob(job({ responsibleKind: 'covering' }), { isGestor: false })).toBe(true);
    expect(canCancelJob(job({ responsibleKind: 'person' }), { isGestor: false })).toBe(false);
  });
});

describe('cancelar depois que o turno começou', () => {
  const now = new Date('2026-11-23T20:00:00-03:00');
  it('jobHasStarted usa o horário de São Paulo', () => {
    expect(jobHasStarted('2026-11-23', '18:00', now)).toBe(true);
    expect(jobHasStarted('2026-11-23', '21:00', now)).toBe(false);
  });
  it('encarregado não vê "Cancelar" em turno iniciado; Gestor continua vendo', () => {
    const started = job({ responsibleKind: 'self', date: '2026-11-23', startTime: '18:00' });
    const future = job({ responsibleKind: 'self', date: '2026-11-24', startTime: '09:00' });
    expect(canCancelJob(started, { isGestor: false }, now)).toBe(false);
    expect(canCancelJob(future, { isGestor: false }, now)).toBe(true);
    expect(canCancelJob(started, { isGestor: true }, now)).toBe(true);
  });
});
