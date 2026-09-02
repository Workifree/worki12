/**
 * ReferralService — Indicação de freela entre empresas (F10).
 *
 * Spec: `.harness/spec/troca-freelas/spec.md`.
 * DDL aprovado (fonte normativa — onde spec e DDL divergem, o DDL vence): `.harness/spec/troca-freelas/ddl-aprovado.md`.
 * ADR: `.harness/memory-bank/decisions/ADR-20260821-indicacao-entre-empresas.md`.
 * Migration: `supabase/migrations/20260817001500_worker_referrals.sql`.
 *
 * VOCABULÁRIO É REQUISITO, NÃO ESTILO: "indicar" / "indicação" / "indicado por". Nunca "trocar",
 * "emprestar", "ceder", "transferir" ou "repassar" — essas palavras afirmam que o freela é um
 * ativo que se move entre empresas por vontade delas, o que contradiz o modelo de consentimento
 * de `team_connections` (veto indelével, migration 20260816000000).
 *
 * A REGRA CENTRAL QUE ESTE SERVICE TEM DE RESPEITAR (não é decoração, é segurança):
 *   A empresa DESTINO (`requesting_company_id`) NUNCA obtém o `worker_id` antes do aceite do
 *   freela. A RLS de `worker_referrals` só deixa a empresa destino ler a própria linha depois de
 *   `status='accepted'`; pré-aceite ela só enxerga a indicação via `list_worker_referral_cards()` /
 *   `get_worker_referral_card()`, que OMITEM `worker_id` (vêm `null`). Por isso:
 *     - LM-1: NUNCA usar `from('worker_referrals')` para a tela de A esperando linhas pendentes —
 *       a RLS devolve 0 linhas de propósito; "consertar" isso é regressão de segurança.
 *     - LM-2: NUNCA montar o cartão a partir de `from('workers')` no client para a tela de A —
 *       a policy `can_view_worker_profile` devolve 0 linhas para quem não tem vínculo.
 *
 * Todos os motivos privados do freela (veto, opt-out, já conectado, teto de indicações abertas,
 * indicação pendente de outra empresa) colapsam no MESMO outcome `not_available` na criação —
 * LM-3: nunca detalhar, nunca logar o `p_worker_id` associado, nunca inferir o motivo na UI.
 *
 * Padrão do projeto: `useState`/`useEffect` + supabase direto (Article 5), erros por retorno
 * estruturado (nunca throw para a UI), `logError` para diagnóstico (nunca `console.log`).
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import type { WorkerReferral, WorkerReferralCard, WorkerReferralStatus } from '../types';

// ---------------------------------------------------------------------------
// Outcomes das RPCs (ddl-aprovado.md §6) — tipados exaustivamente por função.
// ---------------------------------------------------------------------------

export type CreateReferralOutcome =
  | 'created'
  | 'unauthenticated'
  | 'invalid_input'
  | 'same_company'
  | 'invalid_target'
  | 'forbidden'
  | 'company_not_found'
  | 'not_in_roster'
  | 'already_pending'
  | 'rate_limited'
  // GENÉRICO: veto do freela, opt-out, já conectado, teto por freela, ou indicação pendente de
  // outra empresa. NUNCA distinguir — colapsar em detalhe seria transformar a RPC num oráculo
  // sobre o histórico do freela (ver cabeçalho e ADR D4).
  | 'not_available';

export type AcceptReferralOutcome =
  | 'accepted'
  | 'already_connected'
  | 'blocked_by_you'
  | 'expired'
  | 'not_pending'
  | 'not_found'
  | 'forbidden'
  | 'unauthenticated';

export type DeclineReferralOutcome =
  | 'declined'
  | 'not_pending'
  | 'not_found'
  | 'forbidden'
  | 'unauthenticated';

export type CancelReferralOutcome =
  | 'cancelled'
  | 'not_pending'
  | 'not_found'
  | 'forbidden'
  | 'unauthenticated';

export type CardOutcome =
  | 'ok'
  | 'not_available'
  | 'not_found'
  | 'forbidden'
  | 'unauthenticated';

export type ListCardsOutcome = 'ok' | 'unauthenticated';

// ---------------------------------------------------------------------------
// Formatos de retorno do service — SEMPRE outcome + error opcional (nunca throw p/ UI).
// ---------------------------------------------------------------------------

export interface CreateReferralResult {
  outcome: CreateReferralOutcome;
  referralId?: string;
  /** Só em rate_limited: 'company_24h' | 'pair_30d' (constantes da RPC, ddl §6.1 LM-4). */
  limit?: string;
  error?: string;
}

export interface AcceptReferralResult {
  outcome: AcceptReferralOutcome;
  error?: string;
}

export interface DeclineReferralResult {
  outcome: DeclineReferralOutcome;
  error?: string;
}

export interface CancelReferralResult {
  outcome: CancelReferralOutcome;
  error?: string;
}

export interface GetCardResult {
  outcome: CardOutcome;
  card?: WorkerReferralCard;
  error?: string;
}

export interface ListCardsResult {
  outcome: ListCardsOutcome;
  items: WorkerReferralCard[];
  error?: string;
}

/** Formato jsonb bruto devolvido pelas RPCs desta feature (supabase-js já entrega parseado). */
interface ReferralRpcResult {
  outcome?: string;
  referral_id?: string;
  limit?: string;
  status?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Tradução de outcome → mensagem de erro para a UI
//
// Exportado (mesmo raciocínio de `attendanceConfirmationService.OUTCOME_ERRORS`): testes
// comparam a mensagem exata, para não deixar passar um fallback genérico acidental cobrindo
// tudo. LM-3: a mensagem de `not_available` é SEMPRE a mesma, aqui e em qualquer lugar da UI —
// nunca variar por contexto (isso vazaria informação por eliminação).
// ---------------------------------------------------------------------------

const GENERIC_NOT_AVAILABLE = 'Não foi possível concluir a indicação.';

export const CREATE_REFERRAL_ERRORS: Partial<Record<CreateReferralOutcome, string>> = {
  unauthenticated: 'Sessão expirada. Faça login novamente.',
  invalid_input: 'Dados inválidos para indicação.',
  same_company: 'Não é possível indicar para a própria empresa.',
  invalid_target: 'Indicação inválida.',
  forbidden: 'Você não tem permissão para indicar por esta empresa.',
  company_not_found: 'Empresa de destino não encontrada.',
  not_in_roster: 'Este freela não faz parte do seu elenco.',
  already_pending: 'Já existe uma indicação sua pendente para esta empresa.',
  rate_limited: 'Limite de indicações atingido. Tente novamente mais tarde.',
  not_available: GENERIC_NOT_AVAILABLE,
};

export const ACCEPT_REFERRAL_ERRORS: Partial<Record<AcceptReferralOutcome, string>> = {
  unauthenticated: 'Sessão expirada. Faça login novamente.',
  forbidden: 'Você não pode responder por outro freela.',
  not_found: 'Indicação não encontrada.',
  not_pending: 'Esta indicação já foi respondida.',
  expired: 'Esta indicação expirou.',
  blocked_by_you:
    'Você bloqueou esta empresa. Para se conectar, reative o vínculo nas suas configurações de bloqueio.',
};

export const DECLINE_REFERRAL_ERRORS: Partial<Record<DeclineReferralOutcome, string>> = {
  unauthenticated: 'Sessão expirada. Faça login novamente.',
  forbidden: 'Você não pode responder por outro freela.',
  not_found: 'Indicação não encontrada.',
  not_pending: 'Esta indicação já foi respondida.',
};

export const CANCEL_REFERRAL_ERRORS: Partial<Record<CancelReferralOutcome, string>> = {
  unauthenticated: 'Sessão expirada. Faça login novamente.',
  forbidden: 'Você não tem permissão para cancelar esta indicação.',
  not_found: 'Indicação não encontrada.',
  not_pending: 'Esta indicação já não está pendente.',
};

export const CARD_ERRORS: Partial<Record<CardOutcome, string>> = {
  unauthenticated: 'Sessão expirada. Faça login novamente.',
  forbidden: 'Você não tem permissão para ver esta indicação.',
  not_found: 'Indicação não encontrada.',
  not_available: 'Esta indicação não está mais disponível.',
};

function translate<T extends string>(map: Partial<Record<T, string>>, outcome: T): string {
  return map[outcome] ?? 'Não foi possível concluir a operação.';
}

// ---------------------------------------------------------------------------
// ReferralService
// ---------------------------------------------------------------------------

export const ReferralService = {
  // -------------------------------------------------------------------------
  // EMPRESA (indicadora): apresentar um freela do próprio elenco a outra empresa.
  // -------------------------------------------------------------------------

  /**
   * Chama `create_worker_referral`. Todo motivo de recusa ligado ao freela (veto, opt-out, já
   * conectado, teto de indicações abertas, indicação pendente de outra empresa) volta como
   * `not_available` — a UI deve exibir SEMPRE a mesma mensagem genérica, nunca tentar adivinhar
   * o motivo (LM-3 do DDL aprovado).
   */
  async createReferral(
    workerId: string,
    referringCompanyId: string,
    requestingCompanyId: string,
    message?: string,
  ): Promise<CreateReferralResult> {
    try {
      if (!workerId || !referringCompanyId || !requestingCompanyId) {
        return { outcome: 'invalid_input', error: CREATE_REFERRAL_ERRORS.invalid_input };
      }

      const { data, error } = await supabase.rpc('create_worker_referral', {
        p_worker_id: workerId,
        p_referring_company_id: referringCompanyId,
        p_requesting_company_id: requestingCompanyId,
        p_message: message ?? null,
      });

      if (error) {
        logError('referralService.createReferral', error);
        return { outcome: 'not_available', error: GENERIC_NOT_AVAILABLE };
      }

      const result = (data ?? {}) as ReferralRpcResult;
      const outcome = (result.outcome ?? 'not_available') as CreateReferralOutcome;

      if (outcome === 'created') {
        return { outcome, referralId: result.referral_id };
      }
      if (outcome === 'already_pending') {
        return { outcome, referralId: result.referral_id, error: translate(CREATE_REFERRAL_ERRORS, outcome) };
      }
      if (outcome === 'rate_limited') {
        return { outcome, limit: result.limit, error: translate(CREATE_REFERRAL_ERRORS, outcome) };
      }

      return { outcome, error: translate(CREATE_REFERRAL_ERRORS, outcome) };
    } catch (err) {
      logError('referralService.createReferral', err);
      return { outcome: 'not_available', error: GENERIC_NOT_AVAILABLE };
    }
  },

  /**
   * B lê as PRÓPRIAS indicações (qualquer status) por RLS direta — `wr_select_referring_company`.
   * Não passa pela vitrine: B já tem vínculo de elenco com o freela (é quem indicou).
   */
  async listMyReferrals(referringCompanyId: string): Promise<WorkerReferral[]> {
    try {
      if (!referringCompanyId) return [];

      const { data, error } = await supabase
        .from('worker_referrals')
        .select('*')
        .eq('referring_company_id', referringCompanyId)
        .order('created_at', { ascending: false });

      if (error) {
        logError('referralService.listMyReferrals', error);
        return [];
      }

      return (data ?? []) as WorkerReferral[];
    } catch (err) {
      logError('referralService.listMyReferrals', err);
      return [];
    }
  },

  /**
   * B retira uma indicação ainda pendente. A empresa destino NUNCA é notificada (ela nunca soube
   * da tentativa — R8/A9). O freela recebe notificação neutra via trigger.
   */
  async cancelReferral(referralId: string): Promise<CancelReferralResult> {
    try {
      if (!referralId) {
        return { outcome: 'not_found', error: CANCEL_REFERRAL_ERRORS.not_found };
      }

      const { data, error } = await supabase.rpc('cancel_worker_referral', {
        p_referral_id: referralId,
      });

      if (error) {
        logError('referralService.cancelReferral', error);
        return { outcome: 'not_found', error: 'Não foi possível cancelar a indicação.' };
      }

      const result = (data ?? {}) as ReferralRpcResult;
      const outcome = (result.outcome ?? 'not_found') as CancelReferralOutcome;

      if (outcome === 'cancelled') {
        return { outcome };
      }
      return { outcome, error: translate(CANCEL_REFERRAL_ERRORS, outcome) };
    } catch (err) {
      logError('referralService.cancelReferral', err);
      return { outcome: 'not_found', error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  // -------------------------------------------------------------------------
  // EMPRESA (destino): caixa de entrada — SEMPRE via RPC, NUNCA from('worker_referrals')
  // pré-aceite (LM-1) nem from('workers') para montar o cartão (LM-2).
  // -------------------------------------------------------------------------

  /**
   * `list_worker_referral_cards()` — SEM PARÂMETRO de propósito (não aceita "por qual empresa
   * listar", precedente `is_shift_call_target`). `worker_id` de cada item vem `null` enquanto
   * `status !== 'accepted'` — nenhum fluxo de UI pode depender dele antes disso.
   */
  async listReceivedCards(): Promise<ListCardsResult> {
    try {
      const { data, error } = await supabase.rpc('list_worker_referral_cards');

      if (error) {
        logError('referralService.listReceivedCards', error);
        return { outcome: 'unauthenticated', items: [], error: 'Não foi possível carregar as indicações recebidas.' };
      }

      const result = (data ?? {}) as { outcome?: string; items?: WorkerReferralCard[] };
      const outcome = (result.outcome ?? 'unauthenticated') as ListCardsOutcome;

      if (outcome === 'ok') {
        return { outcome, items: result.items ?? [] };
      }
      return { outcome, items: [], error: 'Sessão expirada. Faça login novamente.' };
    } catch (err) {
      logError('referralService.listReceivedCards', err);
      return { outcome: 'unauthenticated', items: [], error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  /**
   * `get_worker_referral_card(referral_id)` — vitrine de UM cartão específico. `card.worker_id`
   * é `null` enquanto pendente (ddl-aprovado.md §5/§6.5); a UI não deve ter caminho que dependa
   * dele antes do aceite.
   */
  async getReceivedCard(referralId: string): Promise<GetCardResult> {
    try {
      if (!referralId) {
        return { outcome: 'not_found', error: CARD_ERRORS.not_found };
      }

      const { data, error } = await supabase.rpc('get_worker_referral_card', {
        p_referral_id: referralId,
      });

      if (error) {
        logError('referralService.getReceivedCard', error);
        return { outcome: 'not_found', error: 'Não foi possível carregar a indicação.' };
      }

      const result = (data ?? {}) as { outcome?: string } & Partial<WorkerReferralCard>;
      const outcome = (result.outcome ?? 'not_found') as CardOutcome;

      if (outcome === 'ok') {
        const {
          referral_id,
          status,
          message,
          created_at,
          expires_at,
          referring_company,
          worker_id,
          card,
        } = result as unknown as WorkerReferralCard & { outcome: string };
        return {
          outcome,
          card: { referral_id, status, message, created_at, expires_at, referring_company, worker_id, card },
        };
      }
      return { outcome, error: translate(CARD_ERRORS, outcome) };
    } catch (err) {
      logError('referralService.getReceivedCard', err);
      return { outcome: 'not_found', error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  // -------------------------------------------------------------------------
  // FREELA: "quem te indicou" — aceitar/recusar. O único "sim" que cria vínculo.
  // -------------------------------------------------------------------------

  /**
   * Todas as indicações que o freela recebeu (própria linha por RLS `wr_select_worker`, qualquer
   * status). A tela "Quem te indicou" filtra `status='awaiting_worker'` na consulta, não no
   * client, para não trazer histórico inteiro desnecessariamente.
   */
  async listMyPendingReferrals(): Promise<WorkerReferral[] | null> {
    try {
      const { data, error } = await supabase
        .from('worker_referrals')
        .select('*')
        .eq('status', 'awaiting_worker' as WorkerReferralStatus)
        .order('created_at', { ascending: false });

      if (error) {
        logError('referralService.listMyPendingReferrals', error);
        return null;
      }

      return (data ?? []) as WorkerReferral[];
    } catch (err) {
      logError('referralService.listMyPendingReferrals', err);
      return null;
    }
  },

  /**
   * `accept_worker_referral` — o único ato que cria `team_connections(status='accepted',
   * source='referral')`. `blocked_by_you` é o único outcome cujo motivo é seguro contar ao
   * freela (o veto é dele) — todo outro motivo privado nunca chega aqui, porque quem decide
   * "not_available" é a criação, não o aceite.
   */
  async acceptReferral(referralId: string): Promise<AcceptReferralResult> {
    try {
      if (!referralId) {
        return { outcome: 'not_found', error: ACCEPT_REFERRAL_ERRORS.not_found };
      }

      const { data, error } = await supabase.rpc('accept_worker_referral', {
        p_referral_id: referralId,
      });

      if (error) {
        logError('referralService.acceptReferral', error);
        return { outcome: 'not_found', error: 'Não foi possível aceitar a indicação.' };
      }

      const result = (data ?? {}) as ReferralRpcResult;
      const outcome = (result.outcome ?? 'not_found') as AcceptReferralOutcome;

      if (outcome === 'accepted' || outcome === 'already_connected') {
        return { outcome };
      }
      return { outcome, error: translate(ACCEPT_REFERRAL_ERRORS, outcome) };
    } catch (err) {
      logError('referralService.acceptReferral', err);
      return { outcome: 'not_found', error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  /**
   * `decline_worker_referral` — recusa NEUTRA (R6, precedente `decline_shift_call`). Sem
   * penalidade ao freela. B recebe notificação genérica idêntica a qualquer outro desfecho.
   */
  async declineReferral(referralId: string): Promise<DeclineReferralResult> {
    try {
      if (!referralId) {
        return { outcome: 'not_found', error: DECLINE_REFERRAL_ERRORS.not_found };
      }

      const { data, error } = await supabase.rpc('decline_worker_referral', {
        p_referral_id: referralId,
      });

      if (error) {
        logError('referralService.declineReferral', error);
        return { outcome: 'not_found', error: 'Não foi possível recusar a indicação.' };
      }

      const result = (data ?? {}) as ReferralRpcResult;
      const outcome = (result.outcome ?? 'not_found') as DeclineReferralOutcome;

      if (outcome === 'declined') {
        return { outcome };
      }
      return { outcome, error: translate(DECLINE_REFERRAL_ERRORS, outcome) };
    } catch (err) {
      logError('referralService.declineReferral', err);
      return { outcome: 'not_found', error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  // -------------------------------------------------------------------------
  // FREELA: opt-out (R7) — só o próprio dono da linha grava (policy de UPDATE `id = auth.uid()`).
  // -------------------------------------------------------------------------

  /**
   * `workers.accepts_referrals` — coluna, não RPC (o grant de tabela já cobre; ver ddl §1). Só
   * pode ser gravado pelo próprio freela autenticado.
   */
  async setAcceptsReferrals(accepts: boolean): Promise<{ success: boolean; error?: string }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return { success: false, error: 'Sessão expirada. Faça login novamente.' };
      }

      const { error } = await supabase
        .from('workers')
        .update({ accepts_referrals: accepts })
        .eq('id', user.id);

      if (error) {
        logError('referralService.setAcceptsReferrals', error);
        return { success: false, error: 'Não foi possível salvar sua preferência.' };
      }

      return { success: true };
    } catch (err) {
      logError('referralService.setAcceptsReferrals', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },
};
