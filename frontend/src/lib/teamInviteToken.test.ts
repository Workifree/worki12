import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearAllTeamMemberHints,
  clearTeamMemberHint,
  hasTeamMemberHint,
  markTeamMember,
} from './teamInviteToken';

beforeEach(() => {
  localStorage.clear();
});

describe('marca "já foi da equipe" por usuário', () => {
  it('só vale para quem a gravou (aparelho compartilhado)', () => {
    markTeamMember('ex-membro');
    expect(hasTeamMemberHint('ex-membro')).toBe(true);
    expect(hasTeamMemberHint('dono-novo')).toBe(false);
    expect(hasTeamMemberHint(null)).toBe(false);
  });

  it('a marca global antiga (sem uid) é ignorada', () => {
    localStorage.setItem('worki_team_member_hint', '1');
    expect(hasTeamMemberHint('qualquer')).toBe(false);
  });

  it('clearTeamMemberHint apaga a do usuário e a antiga; clearAll apaga todas', () => {
    markTeamMember('a');
    markTeamMember('b');
    localStorage.setItem('worki_team_member_hint', '1');
    clearTeamMemberHint('a');
    expect(hasTeamMemberHint('a')).toBe(false);
    expect(localStorage.getItem('worki_team_member_hint')).toBeNull();
    expect(hasTeamMemberHint('b')).toBe(true);

    clearAllTeamMemberHints();
    expect(hasTeamMemberHint('b')).toBe(false);
  });
});
