/**
 * OrganizationService — convite/remoção de gerente + unidades da organização (F13 Fase 4).
 *
 * Spec: `.harness/spec/multi-unidade/spec.md` (R8-R10, R14-R16).
 * DDL aprovado (fonte normativa): `.harness/spec/multi-unidade/ddl-aprovado.md` §5.4.
 * Migrations: `supabase/migrations/20260818100300_manager_invite_rpcs.sql`,
 * `20260821001100_accept_manager_invite_dep_guard.sql`.
 *
 * Só sócio/operador (`organization_members` ativo `owner`/`operator`) pode convidar/remover
 * gerente — a autorização real mora nas RPCs `SECURITY DEFINER`; este service só invoca e
 * traduz `outcome` em algo que a UI consegue exibir. Erros de rede/autorização retornam
 * outcomes explícitos (nunca lançam para a UI), seguindo o padrão de `referralService`.
 *
 * NÃO existe RPC `list_company_managers` — `company_members` tem policy de SELECT própria
 * (`cm_select_self_or_operator`, migration 20260818100000) que já deixa o sócio/operador ler
 * todas as linhas das unidades da própria organização. `listCompanyManagers` usa
 * `supabase.from('company_members').select(...)` direto (Article 5 — nenhuma RPC de leitura
 * nova é necessária quando a RLS já resolve).
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import type { CompanyMember } from '../types';

export type InviteManagerOutcome =
  | 'invited'
  | 'already_invited'
  | 'not_found'
  | 'forbidden'
  | 'invalid_input'
  | 'unauthenticated'
  | 'error';

export interface InviteManagerResult {
  outcome: InviteManagerOutcome;
  memberId?: string;
  inviteToken?: string;
  error?: string;
}

export type AcceptManagerInviteOutcome =
  | 'accepted'
  | 'already_accepted'
  | 'token_already_used'
  | 'revoked'
  | 'expired'
  | 'not_found'
  | 'worker_cannot_be_manager'
  | 'invalid_input'
  | 'unauthenticated'
  | 'error';

export interface AcceptManagerInviteResult {
  outcome: AcceptManagerInviteOutcome;
  companyId?: string;
  memberId?: string;
  error?: string;
}

export type RevokeManagerOutcome = 'revoked' | 'not_found' | 'forbidden' | 'unauthenticated' | 'error';

export interface RevokeManagerResult {
  outcome: RevokeManagerOutcome;
  error?: string;
}

interface RpcOutcomeRow {
  outcome?: string;
  member_id?: string;
  invite_token?: string;
  company_id?: string;
  affected?: number;
}

const GENERIC_ERROR = 'Não foi possível concluir a operação. Tente novamente.';

/**
 * Convida um gerente para operar `companyId` pelo e-mail informado. Idempotente: um convite
 * pendente válido para o mesmo e-mail devolve o mesmo token (`already_invited`) em vez de
 * empilhar convites.
 */
export async function inviteManager(companyId: string, email: string): Promise<InviteManagerResult> {
  try {
    const { data, error } = await supabase.rpc('invite_company_manager', {
      p_company_id: companyId,
      p_email: email,
    });
    if (error) throw error;

    const row = data as RpcOutcomeRow | null;
    const outcome = (row?.outcome ?? 'error') as InviteManagerOutcome;
    return { outcome, memberId: row?.member_id, inviteToken: row?.invite_token };
  } catch (error) {
    logError('organizationService.inviteManager', error);
    return { outcome: 'error', error: GENERIC_ERROR };
  }
}

/**
 * Aceite do convite pelo gerente já autenticado (R9). Nunca aceita silenciosamente um token
 * usado por outra pessoa nem um convite vencido — a RPC devolve `outcome` explícito.
 */
export async function acceptManagerInvite(token: string): Promise<AcceptManagerInviteResult> {
  try {
    const { data, error } = await supabase.rpc('accept_manager_invite', { p_token: token });
    if (error) throw error;

    const row = data as RpcOutcomeRow | null;
    const outcome = (row?.outcome ?? 'error') as AcceptManagerInviteOutcome;
    return { outcome, companyId: row?.company_id, memberId: row?.member_id };
  } catch (error) {
    logError('organizationService.acceptManagerInvite', error);
    return { outcome: 'error', error: GENERIC_ERROR };
  }
}

/**
 * Remoção SOFT de um gerente (R10) — `company_members.status` vira `'removed'`, nunca `DELETE`.
 * `userId` é o `user_id` já vinculado (gerente ativo); use `null` só para revogar um convite
 * ainda `invited` sem `user_id` (o gerente nunca aceitou).
 */
export async function revokeManager(companyId: string, userId: string | null): Promise<RevokeManagerResult> {
  try {
    const { data, error } = await supabase.rpc('revoke_company_manager', {
      p_company_id: companyId,
      p_user_id: userId,
    });
    if (error) throw error;

    const row = data as RpcOutcomeRow | null;
    const outcome = (row?.outcome ?? 'error') as RevokeManagerOutcome;
    return { outcome };
  } catch (error) {
    logError('organizationService.revokeManager', error);
    return { outcome: 'error', error: GENERIC_ERROR };
  }
}

/**
 * Gerentes (convidados + ativos) da unidade `companyId`. Não devolve `removed` por padrão —
 * a UI de gestão de gerentes não precisa do histórico de quem saiu (auditoria fica no banco,
 * não na tela). RLS (`cm_select_self_or_operator`) já garante que só sócio/operador vê todas
 * as linhas; um gerente comum só enxergaria a própria — por isso esta função é só para telas
 * de sócio/operador (Organization.tsx).
 */
export async function listCompanyManagers(companyId: string): Promise<CompanyMember[]> {
  const { data, error } = await supabase
    .from('company_members')
    .select('id, company_id, user_id, role, status, invited_email, invited_at, accepted_at, expires_at')
    .eq('company_id', companyId)
    .neq('status', 'removed')
    .order('invited_at', { ascending: false });

  if (error) {
    logError('organizationService.listCompanyManagers', error);
    return [];
  }
  return (data ?? []) as CompanyMember[];
}
