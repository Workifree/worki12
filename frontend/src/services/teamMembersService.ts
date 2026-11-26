/**
 * TeamMembersService — Equipe e encarregados (E4): convite, entrada, confirmação e remoção.
 *
 * Contrato REAL: `supabase/migrations/20261123000500_equipe_e4_convites_e_papel.sql`.
 * ADRs: previa-publica-do-convite, encarregado-confirmado-e-pii, remover-pessoa-so-corta-acesso.
 *
 * Toda autorização mora nas RPCs `SECURITY DEFINER`; este serviço só invoca e traduz `outcome`
 * (padrão de `organizationService`/`referralService`): erro de rede vira `outcome: 'error'`, nunca
 * lança para a UI. Nada aqui toca saldo (Article 8).
 *
 * A prévia pública (`get_member_invite_preview`) é VOLATILE de propósito: chamada via `.rpc()` sem
 * `get: true`, ou seja, POST com o token no corpo — nunca na URL (nem em log de proxy/CDN).
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { invalidateCompanyScope } from './companyScopeService';
import { markTeamMember } from '../lib/teamInviteToken';
import type {
  AcceptMemberInviteOutcome,
  AcceptMemberInviteResult,
  CompanyMemberStatus,
  ConfirmMemberOutcome,
  InviteMemberOutcome,
  InvitePreviewOutcome,
  InvitePreviewResult,
  InviteTokenResult,
  ListMembersOutcome,
  RejectMemberOutcome,
  RemoveMemberOutcome,
  RemoveMemberResult,
  ResendInviteOutcome,
  RevokeInviteOutcome,
  TeamMemberItem,
  TeamMemberRole,
  TeamMemberState,
} from '../types';

interface RpcMemberRow {
  member_id: string;
  user_id: string | null;
  display_name: string | null;
  role: string;
  status: string;
  state: string;
  confirmed: boolean;
  accepted_email: string | null;
  confirmation_expires_at?: string | null;
  invited_at: string | null;
  expires_at: string | null;
  accepted_at: string | null;
  confirmed_at: string | null;
  removed_at: string | null;
}

interface RpcRow {
  outcome?: string;
  member_id?: string;
  invite_token?: string;
  expires_at?: string;
  company_id?: string;
  company_name?: string;
  role?: string;
  confirmed?: boolean;
  display_name?: string | null;
  open_jobs?: number;
  elenco_link_rotation_advised?: boolean;
  already_removed?: boolean;
  items?: RpcMemberRow[];
  elenco_link_rotation_pending?: boolean;
}

function asRole(value: string | undefined): TeamMemberRole | undefined {
  return value === 'manager' || value === 'encarregado' ? value : undefined;
}

/** Normaliza o jsonb devolvido: outcome ausente ou não-string vira 'error'. */
function outcomeOf<O extends string>(row: RpcRow | null | undefined): O {
  return (typeof row?.outcome === 'string' ? row.outcome : 'error') as O;
}

/**
 * Mensagem neutra (sem culpa, sem gênero) para desfechos de ação do Gestor. `fallback` cobre o
 * resto (erro de rede, desfecho desconhecido).
 */
export function memberActionMessage(outcome: string, fallback: string): string {
  switch (outcome) {
    case 'forbidden':
      return 'Você não tem permissão para fazer isso nesta empresa.';
    case 'not_found':
      return 'Não encontramos essa pessoa. Talvez outro Gestor já tenha resolvido isso.';
    case 'not_pending_confirmation':
    case 'not_pending':
      return 'Outro Gestor já resolveu isso. A lista foi atualizada.';
    case 'last_manager':
      return 'A empresa precisa ter pelo menos um Gestor. Inclua outro Gestor antes de tirar este.';
    case 'cannot_remove_self':
      return 'Você não pode remover o seu próprio acesso.';
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre de novo.';
    default:
      return fallback;
  }
}

// ── Prévia pública (anon) ────────────────────────────────────────────────────────────────────

export async function getInvitePreview(token: string): Promise<InvitePreviewResult> {
  try {
    // POST via .rpc() (sem `get: true`): o token é segredo e não pode ir na URL.
    const { data, error } = await supabase.rpc('get_member_invite_preview', { p_token: token });
    if (error) throw error;
    const row = (data ?? null) as RpcRow | null;
    const outcome = outcomeOf<string>(row);
    const known: string[] = ['ok', 'expired', 'not_found'];
    if (!known.includes(outcome)) return { outcome: 'error' };
    return {
      outcome: outcome as InvitePreviewOutcome,
      companyName: row?.company_name ?? undefined,
      role: asRole(row?.role),
    };
  } catch (err) {
    logError('teamMembersService.getInvitePreview', err);
    return { outcome: 'error' };
  }
}

// ── Convite (Gestor) ─────────────────────────────────────────────────────────────────────────

export async function inviteMember(
  companyId: string,
  displayName: string,
  role: TeamMemberRole = 'encarregado',
): Promise<InviteTokenResult<InviteMemberOutcome>> {
  try {
    const { data, error } = await supabase.rpc('invite_company_member', {
      p_company_id: companyId,
      p_display_name: displayName,
      p_role: role,
    });
    if (error) throw error;
    const row = (data ?? null) as RpcRow | null;
    const outcome = outcomeOf<InviteMemberOutcome>(row);
    // A primeira pessoa liga `team_enabled`: o seam precisa reler para o menu "Equipe" aparecer.
    if (outcome === 'invited' || outcome === 'reinvited' || outcome === 'already_invited') {
      invalidateCompanyScope();
    }
    return {
      outcome,
      memberId: row?.member_id,
      inviteToken: row?.invite_token,
      expiresAt: row?.expires_at,
    };
  } catch (err) {
    logError('teamMembersService.inviteMember', err);
    return { outcome: 'error' };
  }
}

/** Rotaciona o token (o link antigo morre) e renova a validade em +14 dias. */
export async function resendInvite(memberId: string): Promise<InviteTokenResult<ResendInviteOutcome>> {
  try {
    const { data, error } = await supabase.rpc('resend_member_invite', { p_member_id: memberId });
    if (error) throw error;
    const row = (data ?? null) as RpcRow | null;
    const outcome = outcomeOf<ResendInviteOutcome>(row);
    if (outcome === 'resent') invalidateCompanyScope();
    return {
      outcome,
      memberId: row?.member_id,
      inviteToken: row?.invite_token,
      expiresAt: row?.expires_at,
    };
  } catch (err) {
    logError('teamMembersService.resendInvite', err);
    return { outcome: 'error' };
  }
}

export async function revokeInvite(memberId: string): Promise<{ outcome: RevokeInviteOutcome }> {
  try {
    const { data, error } = await supabase.rpc('revoke_member_invite', { p_member_id: memberId });
    if (error) throw error;
    const outcome = outcomeOf<RevokeInviteOutcome>(data as RpcRow | null);
    if (outcome === 'revoked') invalidateCompanyScope();
    return { outcome };
  } catch (err) {
    logError('teamMembersService.revokeInvite', err);
    return { outcome: 'error' };
  }
}

// ── Entrada (convidado autenticado por OTP) ──────────────────────────────────────────────────

/** `acceptTos` precisa ser `true`: sem isso a RPC responde `tos_required` sem consumir o token. */
export async function acceptMemberInvite(
  token: string,
  acceptTos: boolean,
): Promise<AcceptMemberInviteResult> {
  try {
    const { data, error } = await supabase.rpc('accept_company_member_invite', {
      p_token: token,
      p_accept_tos: acceptTos,
    });
    if (error) throw error;
    const row = (data ?? null) as RpcRow | null;
    const outcome = outcomeOf<AcceptMemberInviteOutcome>(row);
    if (outcome === 'accepted' || outcome === 'already_accepted') {
      // A pessoa passou a operar uma empresa: derruba o cache do seam (get_my_companies).
      invalidateCompanyScope();
      // Marca esta pessoa como membro de equipe: se o acesso for encerrado depois, ela vê a tela
      // neutra de "acesso encerrado" em vez de cair no onboarding de CNPJ (só UX, não é segurança).
      // A marca é por usuário: precisa do id da sessão que acabou de aceitar.
      try {
        const { data: sessionData } = await supabase.auth.getUser();
        markTeamMember(sessionData.user?.id);
      } catch (markError) {
        logError('teamMembersService.markTeamMember', markError);
      }
    }
    return {
      outcome,
      companyId: row?.company_id,
      memberId: row?.member_id,
      role: asRole(row?.role),
      confirmed: row?.confirmed,
    };
  } catch (err) {
    logError('teamMembersService.acceptMemberInvite', err);
    return { outcome: 'error' };
  }
}

// ── Equipe (Gestor) ──────────────────────────────────────────────────────────────────────────

export async function confirmMember(
  companyId: string,
  userId: string,
  typedName: string,
): Promise<{ outcome: ConfirmMemberOutcome }> {
  try {
    // O Gestor DIGITA o nome do convite: o banco compara (normalizado) antes de liberar.
    const { data, error } = await supabase.rpc('confirm_company_member', {
      p_company_id: companyId,
      p_user_id: userId,
      p_typed_name: typedName,
    });
    if (error) throw error;
    const outcome = outcomeOf<ConfirmMemberOutcome>(data as RpcRow | null);
    // `expired` também muda a equipe: o banco encerra o acesso na hora.
    if (outcome === 'confirmed' || outcome === 'already_confirmed' || outcome === 'expired') {
      invalidateCompanyScope();
    }
    return { outcome };
  } catch (err) {
    logError('teamMembersService.confirmMember', err);
    return { outcome: 'error' };
  }
}

/** "Não é ele": corta o acesso de quem entrou e ainda não foi confirmado. */
export async function rejectMember(
  companyId: string,
  userId: string,
): Promise<{ outcome: RejectMemberOutcome }> {
  try {
    const { data, error } = await supabase.rpc('reject_company_member', {
      p_company_id: companyId,
      p_user_id: userId,
    });
    if (error) throw error;
    const outcome = outcomeOf<RejectMemberOutcome>(data as RpcRow | null);
    if (outcome === 'rejected') invalidateCompanyScope();
    return { outcome };
  } catch (err) {
    logError('teamMembersService.rejectMember', err);
    return { outcome: 'error' };
  }
}

/**
 * Remove a pessoa (corta o acesso na hora; nunca bloqueia, nada é migrado). Com `dryRun: true`
 * não escreve e devolve `would_remove` + `openJobs` para o aviso "N turnos abertos dele ficarão
 * com você".
 */
export async function removeMember(
  companyId: string,
  userId: string,
  dryRun = false,
): Promise<RemoveMemberResult> {
  try {
    const { data, error } = await supabase.rpc('remove_company_member', {
      p_company_id: companyId,
      p_user_id: userId,
      p_dry_run: dryRun,
    });
    if (error) throw error;
    const row = (data ?? null) as RpcRow | null;
    const outcome = outcomeOf<RemoveMemberOutcome>(row);
    // Dry-run não escreve: só a remoção real muda o escopo.
    if (outcome === 'removed') invalidateCompanyScope();
    return {
      outcome,
      memberId: row?.member_id,
      displayName: row?.display_name,
      role: asRole(row?.role),
      openJobs: typeof row?.open_jobs === 'number' ? row.open_jobs : 0,
      elencoLinkRotationAdvised: row?.elenco_link_rotation_advised === true,
      alreadyRemoved: row?.already_removed === true,
    };
  } catch (err) {
    logError('teamMembersService.removeMember', err);
    return { outcome: 'error', openJobs: 0, elencoLinkRotationAdvised: false, alreadyRemoved: false };
  }
}

export async function listMembers(
  companyId: string,
  includeRemoved = false,
): Promise<{ outcome: ListMembersOutcome; items: TeamMemberItem[]; elencoLinkRotationPending?: boolean }> {
  try {
    const { data, error } = await supabase.rpc('list_company_members', {
      p_company_id: companyId,
      p_include_removed: includeRemoved,
    });
    if (error) throw error;
    const row = (data ?? null) as RpcRow | null;
    const outcome = outcomeOf<ListMembersOutcome>(row);
    if (outcome !== 'ok') return { outcome, items: [], elencoLinkRotationPending: false };
    const items = (row?.items ?? []).map((m): TeamMemberItem => ({
      memberId: m.member_id,
      userId: m.user_id,
      displayName: m.display_name,
      role: m.role === 'manager' ? 'manager' : 'encarregado',
      status: m.status as CompanyMemberStatus,
      state: m.state as TeamMemberState,
      confirmed: m.confirmed === true,
      acceptedEmail: m.accepted_email,
      invitedAt: m.invited_at,
      expiresAt: m.expires_at,
      acceptedAt: m.accepted_at,
      confirmedAt: m.confirmed_at,
      removedAt: m.removed_at,
      confirmationExpiresAt: m.confirmation_expires_at ?? null,
    }));
    return { outcome: 'ok', items, elencoLinkRotationPending: row?.elenco_link_rotation_pending === true };
  } catch (err) {
    logError('teamMembersService.listMembers', err);
    return { outcome: 'error', items: [], elencoLinkRotationPending: false };
  }
}

/**
 * Gera um link NOVO do Elenco (o antigo deixa de valer) e desliga a pendência de rotação
 * (`elenco_link_rotation_pending`). Só o Gestor passa pela RPC. O token devolvido não é guardado.
 */
export async function rotateElencoLink(companyId: string): Promise<{ ok: boolean }> {
  try {
    const { data, error } = await supabase.rpc('get_company_invite_token', {
      p_rotate: true,
      p_company_id: companyId,
    });
    if (error) throw error;
    return { ok: typeof data === 'string' && data.length > 0 };
  } catch (err) {
    logError('teamMembersService.rotateElencoLink', err);
    return { ok: false };
  }
}

// ── Compartilhamento (puro, sem rede) ────────────────────────────────────────────────────────

export const ROLE_LABEL: Record<TeamMemberRole, string> = {
  manager: 'Gestor',
  encarregado: 'Encarregado',
};

export function buildInviteLink(token: string, origin: string = window.location.origin): string {
  return `${origin}/convite-equipe/${token}`;
}

/** DDI 55 + só dígitos. Devolve `null` sem número plausível (então o wa.me abre sem telefone). */
export function normalizeBrazilPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  const national = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (national.length < 10 || national.length > 11) return null;
  return `55${national}`;
}

export function buildInviteMessage(params: {
  displayName: string;
  companyName: string;
  role: TeamMemberRole;
  link: string;
}): string {
  return (
    `Oi, ${params.displayName}! ${params.companyName} te convidou para o Worki como ` +
    `${ROLE_LABEL[params.role]}. Entre por aqui: ${params.link}. O link é só seu, não repasse.`
  );
}

/** `https://wa.me/55XXXXXXXXXXX?text=...` com telefone; `https://wa.me/?text=...` sem. */
export function buildWhatsAppUrl(message: string, phone?: string | null): string {
  const normalized = normalizeBrazilPhone(phone);
  return `https://wa.me/${normalized ?? ''}?text=${encodeURIComponent(message)}`;
}
