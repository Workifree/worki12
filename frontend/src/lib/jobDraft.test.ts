import { describe, it, expect, beforeEach } from 'vitest';
import { clearJobDrafts, jobDraftKey } from './jobDraft';

describe('jobDraft', () => {
  beforeEach(() => localStorage.clear());

  it('separa o rascunho por usuário e por empresa', () => {
    expect(jobDraftKey('u1', 'c1')).not.toBe(jobDraftKey('u2', 'c1'));
    expect(jobDraftKey('u1', 'c1')).not.toBe(jobDraftKey('u1', 'c2'));
  });

  it('limpa todos os rascunhos e a chave antiga, sem tocar em outras chaves', () => {
    localStorage.setItem(jobDraftKey('u1', 'c1'), '{}');
    localStorage.setItem(jobDraftKey('u2', 'c2'), '{}');
    localStorage.setItem('worki_rascunho_turno', '{}');
    localStorage.setItem('outra', '1');
    clearJobDrafts();
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem('outra')).toBe('1');
  });
});
