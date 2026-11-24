import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: { onAuthStateChange: vi.fn() },
  },
}));
vi.mock('../lib/logger', () => ({ logError: vi.fn() }));

const mockInvalidate = vi.fn();
vi.mock('./companyScopeService', () => ({
  invalidateCompanyScope: () => mockInvalidate(),
}));

import {
  acceptMemberInvite,
  buildInviteLink,
  buildInviteMessage,
  buildWhatsAppUrl,
  confirmMember,
  getInvitePreview,
  inviteMember,
  listMembers,
  normalizeBrazilPhone,
  rejectMember,
  removeMember,
  resendInvite,
  revokeInvite,
} from './teamMembersService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getInvitePreview', () => {
  it('chama a RPC por POST (.rpc sem opção get) com o token só no corpo', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'ok', company_name: 'Divino Fogão', role: 'encarregado' }, error: null });
    const r = await getInvitePreview('a'.repeat(64));
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const args = mockRpc.mock.calls[0];
    expect(args[0]).toBe('get_member_invite_preview');
    expect(args[1]).toEqual({ p_token: 'a'.repeat(64) });
    // Nenhum terceiro argumento: `{ get: true }` poria o token na URL.
    expect(args.length).toBe(2);
    expect(r).toEqual({ outcome: 'ok', companyName: 'Divino Fogão', role: 'encarregado' });
  });

  it.each(['expired', 'not_found'] as const)('repassa outcome %s', async (outcome) => {
    mockRpc.mockResolvedValue({ data: { outcome }, error: null });
    expect((await getInvitePreview('t')).outcome).toBe(outcome);
  });

  it('resposta inesperada ou erro de rede viram "error" (sem lançar)', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'qualquer' }, error: null });
    expect((await getInvitePreview('t')).outcome).toBe('error');
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('rede') });
    expect((await getInvitePreview('t')).outcome).toBe('error');
  });
});

describe('inviteMember / resendInvite / revokeInvite', () => {
  it('invite envia (empresa, nome, papel) e devolve o token', async () => {
    mockRpc.mockResolvedValue({
      data: { outcome: 'invited', member_id: 'm1', invite_token: 'tok', expires_at: '2026-12-07T00:00:00Z' },
      error: null,
    });
    const r = await inviteMember('c1', 'Ana');
    expect(mockRpc).toHaveBeenCalledWith('invite_company_member', {
      p_company_id: 'c1',
      p_display_name: 'Ana',
      p_role: 'encarregado',
    });
    expect(r).toMatchObject({ outcome: 'invited', memberId: 'm1', inviteToken: 'tok' });
  });

  it('invite repassa outcomes de recusa sem token', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'forbidden' }, error: null });
    const r = await inviteMember('c1', 'Ana');
    expect(r.outcome).toBe('forbidden');
    expect(r.inviteToken).toBeUndefined();
  });

  it('resend rotaciona e devolve o novo token', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'resent', member_id: 'm1', invite_token: 'novo' }, error: null });
    const r = await resendInvite('m1');
    expect(mockRpc).toHaveBeenCalledWith('resend_member_invite', { p_member_id: 'm1' });
    expect(r).toMatchObject({ outcome: 'resent', inviteToken: 'novo' });
  });

  it('revoke devolve o outcome; falha de rede vira error', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'revoked' }, error: null });
    expect(await revokeInvite('m1')).toEqual({ outcome: 'revoked' });
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('x') });
    expect(await revokeInvite('m1')).toEqual({ outcome: 'error' });
  });
});

describe('acceptMemberInvite', () => {
  it('envia o token e p_accept_tos', async () => {
    mockRpc.mockResolvedValue({
      data: { outcome: 'accepted', company_id: 'c1', member_id: 'm1', role: 'encarregado', confirmed: false },
      error: null,
    });
    const r = await acceptMemberInvite('tok', true);
    expect(mockRpc).toHaveBeenCalledWith('accept_company_member_invite', { p_token: 'tok', p_accept_tos: true });
    expect(r).toEqual({ outcome: 'accepted', companyId: 'c1', memberId: 'm1', role: 'encarregado', confirmed: false });
  });

  it('derruba o cache do seam só quando a pessoa passou a operar', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'accepted' }, error: null });
    await acceptMemberInvite('tok', true);
    expect(mockInvalidate).toHaveBeenCalledTimes(1);

    mockRpc.mockResolvedValueOnce({ data: { outcome: 'expired' }, error: null });
    await acceptMemberInvite('tok', true);
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });

  it.each([
    'already_accepted', 'already_operator', 'token_already_used', 'revoked', 'expired', 'not_found',
    'use_manager_invite', 'tos_required', 'worker_cannot_be_manager', 'email_not_verified',
    'invalid_input', 'unauthenticated',
  ])('repassa o outcome %s', async (outcome) => {
    mockRpc.mockResolvedValue({ data: { outcome }, error: null });
    expect((await acceptMemberInvite('tok', true)).outcome).toBe(outcome);
  });
});

describe('confirm / reject / remove / list', () => {
  it('confirm e reject usam (empresa, pessoa)', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'confirmed' }, error: null });
    expect(await confirmMember('c1', 'u1')).toEqual({ outcome: 'confirmed' });
    expect(mockRpc).toHaveBeenLastCalledWith('confirm_company_member', { p_company_id: 'c1', p_user_id: 'u1' });

    mockRpc.mockResolvedValueOnce({ data: { outcome: 'rejected' }, error: null });
    expect(await rejectMember('c1', 'u1')).toEqual({ outcome: 'rejected' });
    expect(mockRpc).toHaveBeenLastCalledWith('reject_company_member', { p_company_id: 'c1', p_user_id: 'u1' });
  });

  it('remove em dry-run manda p_dry_run=true, devolve open_jobs e NÃO derruba o cache', async () => {
    mockRpc.mockResolvedValue({
      data: { outcome: 'would_remove', member_id: 'm1', display_name: 'Ana', role: 'encarregado', open_jobs: 3, elenco_link_rotation_advised: true },
      error: null,
    });
    const r = await removeMember('c1', 'u1', true);
    expect(mockRpc).toHaveBeenCalledWith('remove_company_member', { p_company_id: 'c1', p_user_id: 'u1', p_dry_run: true });
    expect(r).toMatchObject({ outcome: 'would_remove', openJobs: 3, elencoLinkRotationAdvised: true, alreadyRemoved: false });
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it('remove real: p_dry_run=false e idempotência (already_removed)', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'removed', already_removed: true }, error: null });
    const r = await removeMember('c1', 'u1');
    expect(mockRpc).toHaveBeenCalledWith('remove_company_member', { p_company_id: 'c1', p_user_id: 'u1', p_dry_run: false });
    expect(r).toMatchObject({ outcome: 'removed', alreadyRemoved: true, openJobs: 0 });
  });

  it('remove: cannot_remove_self e erro de rede', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'cannot_remove_self' }, error: null });
    expect((await removeMember('c1', 'eu')).outcome).toBe('cannot_remove_self');
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('x') });
    expect((await removeMember('c1', 'u1')).outcome).toBe('error');
  });

  it('list mapeia a projeção fechada para camelCase', async () => {
    mockRpc.mockResolvedValue({
      data: {
        outcome: 'ok',
        items: [{
          member_id: 'm1', user_id: 'u1', display_name: 'Ana', role: 'encarregado', status: 'active',
          state: 'awaiting_confirmation', confirmed: false, accepted_email: 'ana@x.com',
          invited_at: 'a', expires_at: null, accepted_at: 'b', confirmed_at: null, removed_at: null,
        }],
      },
      error: null,
    });
    const r = await listMembers('c1');
    expect(mockRpc).toHaveBeenCalledWith('list_company_members', { p_company_id: 'c1', p_include_removed: false });
    expect(r.outcome).toBe('ok');
    expect(r.items[0]).toMatchObject({
      memberId: 'm1', userId: 'u1', displayName: 'Ana', state: 'awaiting_confirmation',
      confirmed: false, acceptedEmail: 'ana@x.com',
    });
    expect(r.items[0]).not.toHaveProperty('inviteToken');
  });

  it('list: forbidden devolve lista vazia', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'forbidden' }, error: null });
    expect(await listMembers('c1')).toEqual({ outcome: 'forbidden', items: [] });
  });
});

describe('compartilhamento (wa.me)', () => {
  it('normaliza telefone: DDI 55 + só dígitos', () => {
    expect(normalizeBrazilPhone('(11) 91234-5678')).toBe('5511912345678');
    expect(normalizeBrazilPhone('+55 11 91234-5678')).toBe('5511912345678');
    expect(normalizeBrazilPhone('1132345678')).toBe('551132345678');
    expect(normalizeBrazilPhone('123')).toBeNull();
    expect(normalizeBrazilPhone('')).toBeNull();
    expect(normalizeBrazilPhone(undefined)).toBeNull();
  });

  it('wa.me com telefone e sem telefone', () => {
    const msg = buildInviteMessage({
      displayName: 'Ana', companyName: 'Divino Fogão', role: 'encarregado', link: 'https://x.app/convite-equipe/t',
    });
    expect(msg).toBe(
      'Oi, Ana! Divino Fogão te convidou para o Worki como Encarregado. Entre por aqui: https://x.app/convite-equipe/t. O link é só seu, não repasse.',
    );
    expect(buildWhatsAppUrl(msg, '(11) 91234-5678')).toMatch(/^https:\/\/wa\.me\/5511912345678\?text=Oi%2C%20Ana/);
    expect(buildWhatsAppUrl(msg)).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(buildWhatsAppUrl(msg, 'lixo')).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });

  it('monta o link da rota pública', () => {
    expect(buildInviteLink('abc', 'https://worki.app')).toBe('https://worki.app/convite-equipe/abc');
  });
});

describe('invalida o escopo (Sidebar reflete team_enabled sem recarregar)', () => {
  it('derruba o cache após cada ação que muda a equipe', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'invited', invite_token: 't' }, error: null });
    await inviteMember('c1', 'Ana');
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'resent', invite_token: 't' }, error: null });
    await resendInvite('m1');
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'confirmed' }, error: null });
    await confirmMember('c1', 'u1');
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'rejected' }, error: null });
    await rejectMember('c1', 'u1');
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'removed' }, error: null });
    await removeMember('c1', 'u1');
    expect(mockInvalidate).toHaveBeenCalledTimes(5);
  });

  it('não derruba o cache quando a ação foi recusada', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'forbidden' }, error: null });
    await inviteMember('c1', 'Ana');
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'not_pending' }, error: null });
    await resendInvite('m1');
    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});
