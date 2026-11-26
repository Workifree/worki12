import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ result: { data: null as unknown, error: null as { code: string; message: string } | null }, update: vi.fn() }));

vi.mock('../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  chain.update = (payload: unknown) => { db.update(payload); return chain; };
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.select = () => Promise.resolve(db.result);
  return { supabase: { from: () => chain, auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } } };
});

import { emptyTemplate } from '../lib/shiftDrafts';
import { updateShiftTemplate } from './shiftTemplateService';

const defaults = { start_time: '18:00', end_time: '23:00', slots: 2, budget: 120 };
const template = { ...emptyTemplate('garcom'), title: 'Garçom', description: 'Salão' };

beforeEach(() => {
  db.update.mockClear();
  db.result = { data: null, error: null };
});

describe('updateShiftTemplate', () => {
  it('grava só nome, template e defaults (chaves permitidas) e devolve o modelo saneado', async () => {
    db.result = { data: [{ id: 't1', name: 'Novo nome', template: { category: 'garcom', title: 'Garçom' }, defaults }], error: null };
    const result = await updateShiftTemplate('t1', '  Novo nome  ', template, defaults);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.template).toMatchObject({ id: 't1', name: 'Novo nome', defaults });
    const payload = db.update.mock.calls[0][0] as { name: string; template: Record<string, unknown>; defaults: Record<string, unknown> };
    expect(Object.keys(payload).sort()).toEqual(['defaults', 'name', 'template']);
    expect(payload.name).toBe('Novo nome');
    expect(Object.keys(payload.defaults).sort()).toEqual(['budget', 'end_time', 'slots', 'start_time']);
    expect(payload.template).not.toHaveProperty('attendance_mode');
    expect(payload.template).not.toHaveProperty('source_job_id');
  });

  it('23505 vira "duplicate"', async () => {
    db.result = { data: null, error: { code: '23505', message: 'duplicate key' } };
    expect(await updateShiftTemplate('t1', 'Repetido', template, defaults)).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('outro erro, ou nenhuma linha alterada, vira "error"', async () => {
    db.result = { data: null, error: { code: '42501', message: 'negado' } };
    expect(await updateShiftTemplate('t1', 'X', template, defaults)).toEqual({ ok: false, reason: 'error' });
    db.result = { data: [], error: null };
    expect(await updateShiftTemplate('t1', 'X', template, defaults)).toEqual({ ok: false, reason: 'error' });
  });
});
