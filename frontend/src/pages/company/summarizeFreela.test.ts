import { describe, it, expect } from 'vitest';
import { summarizeFreela } from './CompanyJobs';

const app = (status: string, name: string) => ({ status, worker: { full_name: name } });

describe('summarizeFreela', () => {
  it('lista só quem ocupa vaga e conta os aguardando à parte', () => {
    const r = summarizeFreela([app('hired', 'Felipe Nascimento Duarte'), app('invited', 'A'), app('invited', 'B')]);
    expect(r?.name).toBe('Felipe Nascimento Duarte');
    expect(r?.extraCount).toBe(0);
    expect(r?.pendingCount).toBe(2);
  });
  it('só convidados: sem contratados, nada de pendingCount', () => {
    const r = summarizeFreela([app('invited', 'A'), app('invited', 'B')]);
    expect(r?.state).toBe('awaiting');
    expect(r?.pendingCount).toBe(0);
  });
});
