import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();
const mockInvoke = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: { onAuthStateChange: vi.fn() },
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
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
  buildWhatsAppUrl,
  confirmMember,
  getInvitePreview,
  inviteMember,
  listMembers,
  memberActionMessage,
  normalizeBrazilPhone,
  provisionTeamInviteAccount,
  rotateElencoLink,
  rejectMember,
  removeMember,
  resendInvite,
  revokeInvite,
  setMemberDefaultTag,
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
    expect(r).toEqual({
      outcome: 'ok', companyName: 'Divino Fogão', role: 'encarregado', emailMasked: undefined, emailBound: false,
    });
  });

  it('traz o e-mail MASCARADO e se o convite está preso a e-mail', async () => {
    mockRpc.mockResolvedValue({
      data: { outcome: 'ok', company_name: 'X', role: 'encarregado', email_masked: 'jo***@x.com', email_bound: true },
      error: null,
    });
    expect(await getInvitePreview('t')).toMatchObject({ emailMasked: 'jo***@x.com', emailBound: true });
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
    const r = await inviteMember('c1', 'Ana', 'encarregado', '  Ana@Exemplo.COM ');
    expect(mockRpc).toHaveBeenCalledWith('invite_company_member', {
      p_company_id: 'c1',
      p_display_name: 'Ana',
      p_role: 'encarregado',
      p_email: 'ana@exemplo.com',
    });
    expect(r).toMatchObject({ outcome: 'invited', memberId: 'm1', inviteToken: 'tok' });
  });

  it('invite repassa outcomes de recusa sem token', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'forbidden' }, error: null });
    const r = await inviteMember('c1', 'Ana');
    expect(r.outcome).toBe('forbidden');
    expect(r.inviteToken).toBeUndefined();
  });

  it.each([
    'email_required', 'invalid_email', 'name_already_invited', 'already_member', 'worker_cannot_be_manager',
  ])('invite repassa o outcome %s sem token', async (outcome) => {
    mockRpc.mockResolvedValue({ data: { outcome }, error: null });
    const r = await inviteMember('c1', 'Ana', 'encarregado', 'ana@x.com');
    expect(r.outcome).toBe(outcome);
    expect(r.inviteToken).toBeUndefined();
    expect(mockInvalidate).not.toHaveBeenCalled();
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
    'use_manager_invite', 'tos_required', 'worker_cannot_be_manager', 'email_not_verified', 'email_mismatch',
    'invalid_input', 'unauthenticated',
  ])('repassa o outcome %s', async (outcome) => {
    mockRpc.mockResolvedValue({ data: { outcome }, error: null });
    expect((await acceptMemberInvite('tok', true)).outcome).toBe(outcome);
  });
});

describe('confirm / reject / remove / list', () => {
  it('confirm e reject usam (empresa, pessoa)', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'confirmed' }, error: null });
    expect(await confirmMember('c1', 'u1', 'Ana')).toEqual({ outcome: 'confirmed' });
    expect(mockRpc).toHaveBeenLastCalledWith('confirm_company_member', {
      p_company_id: 'c1', p_user_id: 'u1', p_typed_name: 'Ana',
    });

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
    expect(await listMembers('c1')).toEqual({ outcome: 'forbidden', items: [], elencoLinkRotationPending: false });
  });

  it.each(['expired', 'name_mismatch'] as const)('confirm repassa %s', async (outcome) => {
    mockRpc.mockResolvedValue({ data: { outcome }, error: null });
    expect(await confirmMember('c1', 'u1', 'Ana')).toEqual({ outcome });
    // expired encerra o acesso no banco; name_mismatch não muda nada
    expect(mockInvalidate).toHaveBeenCalledTimes(outcome === 'expired' ? 1 : 0);
  });

  it('list traz pending_expired, prazo de confirmação e a pendência de rotação do link', async () => {
    mockRpc.mockResolvedValue({
      data: {
        outcome: 'ok',
        elenco_link_rotation_pending: true,
        items: [{
          member_id: 'm1', user_id: 'u1', display_name: 'Ana', role: 'encarregado', status: 'active',
          state: 'pending_expired', confirmed: false, accepted_email: null, confirmation_expires_at: '2026-11-28T12:00:00Z',
          invited_at: null, expires_at: null, accepted_at: null, confirmed_at: null, removed_at: null,
        }],
      },
      error: null,
    });
    const r = await listMembers('c1');
    expect(r.elencoLinkRotationPending).toBe(true);
    expect(r.items[0]).toMatchObject({ state: 'pending_expired', confirmationExpiresAt: '2026-11-28T12:00:00Z' });
  });

  it('rotaciona o link do Elenco com p_rotate=true e a unidade', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'novo-token', error: null });
    expect(await rotateElencoLink('c1')).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenLastCalledWith('get_company_invite_token', { p_rotate: true, p_company_id: 'c1' });
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('x') });
    expect(await rotateElencoLink('c1')).toEqual({ ok: false });
  });

  it('last_manager é repassado em remove e revoke, com mensagem própria', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'last_manager' }, error: null });
    expect((await removeMember('c1', 'u1')).outcome).toBe('last_manager');
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'last_manager' }, error: null });
    expect(await revokeInvite('m1')).toEqual({ outcome: 'last_manager' });
    expect(memberActionMessage('last_manager', 'x')).toMatch(/pelo menos um Gestor/);
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
    const msg = 'Oi, Ana!';
    expect(buildWhatsAppUrl(msg, '(11) 91234-5678')).toMatch(/^https:\/\/wa\.me\/5511912345678\?text=Oi%2C%20Ana/);
    expect(buildWhatsAppUrl(msg)).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(buildWhatsAppUrl(msg, 'lixo')).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });

  it('monta o link da rota pública', () => {
    expect(buildInviteLink('abc', 'https://worki.app')).toBe('https://worki.app/convite-equipe/abc');
  });
});

describe('provisionTeamInviteAccount', () => {
  it('chama a Edge Function accept-team-invite com token, senha e accept_tos', async () => {
    mockInvoke.mockResolvedValue({ data: { outcome: 'created', email: 'ana@x.com' }, error: null });
    const r = await provisionTeamInviteAccount('tok', 'senha-forte-1');
    expect(mockInvoke).toHaveBeenCalledWith('accept-team-invite', {
      body: { token: 'tok', password: 'senha-forte-1', accept_tos: true },
    });
    expect(r).toEqual({ outcome: 'created', email: 'ana@x.com' });
  });

  it.each([
    'existing_account', 'account_pending', 'worker_cannot_be_manager', 'legacy_invite', 'not_found', 'expired',
  ])('repassa %s e NÃO devolve e-mail', async (outcome) => {
    mockInvoke.mockResolvedValue({ data: { outcome, email: 'vazou@x.com' }, error: null });
    expect(await provisionTeamInviteAccount('tok', 'senha-forte-1')).toEqual({ outcome, email: undefined });
  });

  it('429 do gateway: lê o outcome do corpo da resposta', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'non-2xx', context: { json: async () => ({ outcome: 'rate_limited' }) } },
    });
    expect((await provisionTeamInviteAccount('tok', 'senha-forte-1')).outcome).toBe('rate_limited');
  });

  it('400 invalid_input vem do corpo', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'non-2xx', context: { json: async () => ({ outcome: 'invalid_input' }) } },
    });
    expect((await provisionTeamInviteAccount('tok', 'x')).outcome).toBe('invalid_input');
  });

  it('erro de rede, corpo ilegível ou outcome desconhecido viram error (sem lançar)', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('rede') });
    expect((await provisionTeamInviteAccount('t', 'p')).outcome).toBe('error');
    mockInvoke.mockResolvedValueOnce({ data: { outcome: 'qualquer' }, error: null });
    expect((await provisionTeamInviteAccount('t', 'p')).outcome).toBe('error');
    mockInvoke.mockRejectedValueOnce(new Error('boom'));
    expect((await provisionTeamInviteAccount('t', 'p')).outcome).toBe('error');
  });
});

describe('invalida o escopo (Sidebar reflete team_enabled sem recarregar)', () => {
  it('derruba o cache após cada ação que muda a equipe', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'invited', invite_token: 't' }, error: null });
    await inviteMember('c1', 'Ana', 'encarregado', 'ana@x.com');
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'resent', invite_token: 't' }, error: null });
    await resendInvite('m1');
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'confirmed' }, error: null });
    await confirmMember('c1', 'u1', 'Ana');
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

describe('equipe unificada e loja padrão (ADR-20261127)', () => {
  it('convite de Encarregado manda p_default_tag_id; de Gestor nunca manda', async () => {
    mockRpc.mockResolvedValue({ data: { outcome: 'invited', member_id: 'm1', invite_token: 'tok' }, error: null });
    await inviteMember('c1', 'Ana', 'encarregado', 'ana@x.com', 't1');
    expect(mockRpc).toHaveBeenLastCalledWith('invite_company_member', {
      p_company_id: 'c1', p_display_name: 'Ana', p_role: 'encarregado', p_email: 'ana@x.com', p_default_tag_id: 't1',
    });
    await inviteMember('c1', 'Gil', 'manager', 'gil@x.com', 't1');
    expect(mockRpc).toHaveBeenLastCalledWith('invite_company_member', {
      p_company_id: 'c1', p_display_name: 'Gil', p_role: 'manager', p_email: 'gil@x.com',
    });
  });

  it.each(['already_invited_other_role', 'invalid_tag'])('invite repassa %s sem token', async (outcome) => {
    mockRpc.mockResolvedValue({ data: { outcome }, error: null });
    const r = await inviteMember('c1', 'Ana', 'encarregado', 'ana@x.com');
    expect(r.outcome).toBe(outcome);
    expect(r.inviteToken).toBeUndefined();
  });

  it('setMemberDefaultTag usa (empresa, membro, loja) e aceita null para remover', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'updated' }, error: null });
    expect(await setMemberDefaultTag('c1', 'm1', 't1')).toEqual({ outcome: 'updated' });
    expect(mockRpc).toHaveBeenLastCalledWith('set_member_default_tag', {
      p_company_id: 'c1', p_member_id: 'm1', p_tag_id: 't1',
    });
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'updated' }, error: null });
    await setMemberDefaultTag('c1', 'm1', null);
    expect(mockRpc).toHaveBeenLastCalledWith('set_member_default_tag', {
      p_company_id: 'c1', p_member_id: 'm1', p_tag_id: null,
    });
  });

  it('setMemberDefaultTag: outcome do banco e erro de rede', async () => {
    mockRpc.mockResolvedValueOnce({ data: { outcome: 'not_encarregado' }, error: null });
    expect((await setMemberDefaultTag('c1', 'm1', 't1')).outcome).toBe('not_encarregado');
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('x') });
    expect((await setMemberDefaultTag('c1', 'm1', 't1')).outcome).toBe('error');
  });

  it('list traz a loja padrão e Gestor aguardando confirmação', async () => {
    mockRpc.mockResolvedValue({
      data: {
        outcome: 'ok',
        items: [
          { member_id: 'm1', user_id: 'u1', display_name: 'Ana', role: 'encarregado', status: 'active',
            state: 'active', confirmed: true, accepted_email: null, invited_at: null, expires_at: null,
            accepted_at: null, confirmed_at: null, removed_at: null, default_tag_id: 't1', default_tag_name: 'Loja A' },
          { member_id: 'm2', user_id: 'u2', display_name: 'Gil', role: 'manager', status: 'active',
            state: 'awaiting_confirmation', confirmed: false, accepted_email: null, invited_at: null, expires_at: null,
            accepted_at: null, confirmed_at: null, removed_at: null },
        ],
      },
      error: null,
    });
    const r = await listMembers('c1');
    expect(r.items[0]).toMatchObject({ defaultTagId: 't1', defaultTagName: 'Loja A' });
    expect(r.items[1]).toMatchObject({ role: 'manager', state: 'awaiting_confirmation', defaultTagId: null });
  });

  it('memberActionMessage: invalid_tag e not_encarregado', () => {
    expect(memberActionMessage('invalid_tag', 'x')).toMatch(/loja/i);
    expect(memberActionMessage('not_encarregado', 'x')).toMatch(/Encarregado/);
  });
});
