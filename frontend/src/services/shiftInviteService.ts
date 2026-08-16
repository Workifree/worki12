/**
 * ShiftInviteService — convite push de turno (Slice 1, R5/R7/R8).
 *
 * Fluxo push: EMPRESA cria application com status='invited' para worker da equipe.
 * Fluxo de resposta: WORKER aceita ('accepted') ou recusa ('declined').
 *
 * Avisos do architect (ADR-001):
 * 1. A transição de status do convite (invited → accepted/declined) NÃO é forçada por RLS;
 *    validamos a máquina de estados AQUI no service.
 * 2. Recusa é NEUTRA (zero punição — R7): só muda status para 'declined'.
 * 3. Criar-turno e aceite NÃO chamam reserve_escrow (postpago é Slice 2).
 *    accepted aqui = status 'hired' (confirmado no turno) SEM escrow. Slice 2 preenche o gap.
 * 4. inserts de review devem passar direction explicitamente — ver ReviewService em types/index.ts.
 */

import { supabase } from '../lib/supabase';
import { invokeFunction } from './api';
import { logError } from '../lib/logger';
import { TeamConnectionService } from './teamConnectionService';
import type {
  Application,
  ApplicationStatus,
  InvitationResponse,
} from '../types';

// ---------------------------------------------------------------------------
// Tipos do resultado estruturado de autorização de pagamento
// ---------------------------------------------------------------------------

export type AuthorizePaymentOutcome =
  | { kind: 'ok'; asaasPaymentId: string }
  | { kind: 'fallback_charge_on_demand'; reason: string }
  | { kind: 'card_declined'; errorMsg: string };

// ---------------------------------------------------------------------------
// Feature flag: pré-autorização postpago (Slice 2 / modo C — opt-in)
// ---------------------------------------------------------------------------

/**
 * No piloto (ADR-20260630-pagamento-opcional-piloto) o modo padrão é (A) — pagamento externo
 * registrado, SEM escrow/cartão. O caminho postpago (modo C, hold via `asaas-authorize-payment`)
 * é opt-in / semente de expansão, não o trilho padrão.
 *
 * Por que uma flag e não uma checagem de "a empresa tem cartão on-file?": quem dispara este
 * hold é o WORKER (ao aceitar o convite) e a RLS de `payment_methods` restringe SELECT ao owner
 * da empresa (Article 4/8 — ver `20260622000600_payment_methods.sql`), então o client do worker
 * nunca teria como saber, sem uma mudança de backend, se a empresa aderiu ao modo C.
 *
 * Mantemos o disparo desligado por flag para o piloto: evita a chamada órfã (e o erro de CORS
 * no console) no modo A, sem remover o suporte postpago. Reversível: virar `true` (ou substituir
 * por uma checagem real assim que existir um mecanismo seguro) quando o modo C for reaberto.
 */
const POSTPAY_AUTHORIZE_ENABLED = false;

// ---------------------------------------------------------------------------
// Helper interno: disparar pré-autorização postpago (best-effort, não bloqueia o aceite)
// ---------------------------------------------------------------------------

/**
 * Invoca asaas-authorize-payment após o aceite do convite.
 * Retorna um resultado estruturado:
 *  - 'ok'                    : hold criado com sucesso.
 *  - 'fallback_charge_on_demand': pré-auth não habilitada; cobrança será na conclusão.
 *  - 'card_declined'         : cartão recusado — empresa deve verificar o método de pagamento.
 *
 * Falha NÃO reverte o status 'hired' — o aceite já aconteceu no DB.
 * Em 'card_declined', uma notificação in-app é criada para a empresa.
 */
async function dispatchAuthorizePayment(
  jobId: string,
  applicationId: string,
  companyOwnerId: string,
): Promise<AuthorizePaymentOutcome> {
  try {
    // invokeFunction lança se HTTP status >= 400 (comportamento padrão de api.ts)
    const result = await invokeFunction('asaas-authorize-payment', { jobId, applicationId }) as {
      success?: boolean;
      status?: string;
      fallback?: boolean;
      reason?: string;
      asaasPaymentId?: string;
    };

    if (result?.status === 'charge_on_demand') {
      return { kind: 'fallback_charge_on_demand', reason: result.reason ?? '' };
    }

    return { kind: 'ok', asaasPaymentId: result?.asaasPaymentId ?? '' };
  } catch (authErr) {
    const errMsg = authErr instanceof Error ? authErr.message : 'Erro desconhecido na autorização.';

    // Detectar estado terminal (HTTP 409): o escrow deste turno já passou por captura/liberação.
    // A mensagem vinda da edge function contém "estado terminal" ou "já está em estado" (409).
    // Neste caso o turno já foi pago — NÃO é recusa de cartão; não notificar a empresa.
    const isTerminalState =
      errMsg.includes('estado terminal') ||
      errMsg.includes('já está em estado') ||
      errMsg.includes('Não é possível criar novo hold');

    if (isTerminalState) {
      // Logar para rastreabilidade, mas sem notificação de "cartão recusado"
      logError('shiftInvite.authorizePayment (terminal state — turno já pago)', authErr);
      return { kind: 'fallback_charge_on_demand', reason: errMsg };
    }

    // Detectar recusa de cartão: a Edge Function agora lança erros específicos (não engole mais
    // recusas). Qualquer erro que não seja "pré-auth não disponível" nem "estado terminal" é
    // tratado como card_declined para fins de notificação.
    logError('shiftInvite.authorizePayment (best-effort)', authErr);

    // Notificar empresa sobre falha no cartão (best-effort — não bloqueia o aceite)
    if (companyOwnerId) {
      try {
        await supabase.from('notifications').insert({
          user_id: companyOwnerId,
          type: 'payment',
          title: 'Falha na autorização do cartão',
          message:
            `A autorização do pagamento para o turno falhou: ${errMsg}. ` +
            'Verifique o método de pagamento cadastrado para garantir que o freela receba.',
        });
      } catch (notifErr) {
        logError('shiftInvite.authorizePayment.notif', notifErr);
      }
    }

    return { kind: 'card_declined', errorMsg: errMsg };
  }
}

// ---------------------------------------------------------------------------
// Tipos de parâmetros e resultado
// ---------------------------------------------------------------------------

/** Janela de expiração do convite em horas (R8). Default = 48h. */
const DEFAULT_INVITE_EXPIRY_HOURS = 48;

export interface InviteWorkerToShiftOptions {
  /** Horas até o convite expirar (default: 48). */
  expiresInHours?: number;
  /** Mensagem personalizada para a notificação (opcional). */
  message?: string;
}

export interface InviteWorkerResult {
  application: Application | null;
  error?: string;
  /** true quando já existe um convite pendente (idempotência). */
  alreadyInvited?: boolean;
}

export interface RespondToInviteResult {
  success: boolean;
  error?: string;
}

export interface CancelInviteResult {
  success: boolean;
  error?: string;
}

export interface DismissFromShiftResult {
  success: boolean;
  error?: string;
  /** true quando o bloqueio foi por já existir pagamento (agendado ou registrado) para o turno. */
  blockedByPayment?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Obtém o company_id da sessão autenticada (empresa). */
async function getAuthCompanyId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Sessão expirada. Faça login novamente.');

  const { data: company, error } = await supabase
    .from('companies')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle();

  if (error) throw error;
  if (!company) throw new Error('Perfil de empresa não encontrado.');

  return company.id as string;
}

/** Calcula timestamp de expiração. */
function calcExpiry(hours: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// ShiftInviteService
// ---------------------------------------------------------------------------

export const ShiftInviteService = {
  // -------------------------------------------------------------------------
  // EMPRESA: convidar worker para turno
  // -------------------------------------------------------------------------

  /**
   * Convida um worker da equipe para um turno específico.
   *
   * Pré-condições verificadas:
   *  1. O worker é conexão 'accepted' da empresa (R2 — lista fechada).
   *  2. Não existe convite ativo (invited) para o mesmo job+worker.
   *
   * Ações:
   *  1. Insere em `applications` com status='invited'.
   *  2. Cria notificação in-app (insert em `notifications`).
   *  3. Invoca `send-notification` para entrega por e-mail.
   *
   * Não chama reserve_escrow (Slice 2).
   *
   * @param jobId    UUID do turno (job).
   * @param workerId UUID do worker a convidar.
   * @param opts     Opções adicionais.
   */
  async inviteWorkerToShift(
    jobId: string,
    workerId: string,
    opts: InviteWorkerToShiftOptions = {},
  ): Promise<InviteWorkerResult> {
    try {
      const companyId = await getAuthCompanyId();

      // 1. Validar que o worker está na equipe aceita (R2)
      const inTeam = await TeamConnectionService.isWorkerInTeam(companyId, workerId);
      if (!inTeam) {
        return {
          application: null,
          error:
            'O freela não está na sua equipe. Adicione-o primeiro para poder convidar.',
        };
      }

      // 2. Verificar se já existe convite pendente (idempotência)
      const { data: existing, error: checkErr } = await supabase
        .from('applications')
        .select('id, status')
        .eq('job_id', jobId)
        .eq('worker_id', workerId)
        .maybeSingle();

      if (checkErr) {
        logError('shiftInvite.inviteWorkerToShift.check', checkErr);
        return { application: null, error: 'Erro ao verificar convite existente.' };
      }

      if (existing) {
        // Já existe application (qualquer status)
        if (existing.status === 'invited') {
          return {
            application: existing as Application,
            alreadyInvited: true,
          };
        }
        return {
          application: null,
          error: `Já existe uma candidatura para este turno com status '${existing.status}'.`,
        };
      }

      // 3. Calcular expiração
      const expiresInHours = opts.expiresInHours ?? DEFAULT_INVITE_EXPIRY_HOURS;
      const expiresAt = calcExpiry(expiresInHours);
      const now = new Date().toISOString();

      // 4. Inserir convite em applications
      const { data: application, error: insertErr } = await supabase
        .from('applications')
        .insert({
          job_id: jobId,
          worker_id: workerId,
          status: 'invited' as ApplicationStatus,
          invited_by_company_at: now,
          invitation_expires_at: expiresAt,
        })
        .select()
        .single();

      if (insertErr) {
        if (insertErr.code === '23505') {
          return { application: null, alreadyInvited: true };
        }
        logError('shiftInvite.inviteWorkerToShift.insert', insertErr);
        return { application: null, error: 'Não foi possível criar o convite.' };
      }

      // 5. Notificação in-app (insert direto em notifications)
      const { error: notifErr } = await supabase.from('notifications').insert({
        user_id: workerId,
        type: 'status_change',
        title: 'Novo convite de turno',
        message:
          opts.message ??
          'Você recebeu um convite para um turno. Acesse "Convites" para aceitar ou recusar.',
        link: `/my-jobs`,
      });

      if (notifErr) {
        // Não bloqueia — a application foi criada; notificação é best-effort
        logError('shiftInvite.inviteWorkerToShift.notif', notifErr);
      }

      // 6. Entrega por e-mail via send-notification (best-effort)
      try {
        await invokeFunction('send-notification', {
          userId: workerId,
          type: 'shift_invite',
          data: {
            jobId,
            applicationId: application.id,
            expiresAt,
          },
        });
      } catch (emailErr) {
        // Edge function falhou — não bloqueia o convite
        logError('shiftInvite.inviteWorkerToShift.email', emailErr);
      }

      return { application: application as Application };
    } catch (err) {
      logError('shiftInvite.inviteWorkerToShift', err);
      return {
        application: null,
        error: err instanceof Error ? err.message : 'Erro inesperado.',
      };
    }
  },

  // -------------------------------------------------------------------------
  // EMPRESA: desfazer convite/contratação (revisão pré-piloto, onda 3)
  // -------------------------------------------------------------------------

  /**
   * Cancela um convite que ainda NÃO foi respondido pelo freela ('invited' → 'cancelled').
   * Libera o job para convidar outro membro da equipe — a MESMA application/worker não pode
   * ser reconvidada (UNIQUE(job_id, worker_id) no schema); é preciso escolher outro freela.
   *
   * Notificação simétrica ao freela: este método NÃO insere notificação nenhuma pelo client
   * (mesmo a policy de INSERT de `notifications`, desde `20260702000000_notifications_notify_counterpart.sql`,
   * já permitindo empresa→worker quando existe `team_connections` com status 'accepted' — ver
   * `inviteWorkerToShift` acima, que insere assim). Quem avisa o freela aqui é o trigger
   * `trg_notify_counterpart_on_application_cancel` (SECURITY DEFINER, migration
   * `20260816150000_notify_counterpart_on_application_cancel.sql`, ADR-20260816-notificacao-
   * contraparte-por-trigger), disparado automaticamente por este mesmo UPDATE
   * (`status → 'cancelled'`) — ramifica por `auth.uid()` para saber quem foi o ator e notifica
   * a contraparte certa. Preferido a um INSERT no client por não depender de RLS de
   * `authenticated`: um INSERT pelo client exigiria vínculo de equipe VIVO (`team_connections
   * accepted`), e se o freela sair do Elenco/bloquear a empresa DEPOIS do turno, esse INSERT
   * seria negado em silêncio — justo para quem tem atrito com a empresa e mais precisa da
   * trilha do recibo. O trigger SECURITY DEFINER não passa por essa RLS, então o aviso
   * independe do vínculo. NÃO adicionar INSERT em `notifications` aqui — duplicaria o aviso.
   */
  async cancelInvite(applicationId: string): Promise<CancelInviteResult> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { success: false, error: 'Sessão expirada.' };

      const { data: current, error: fetchErr } = await supabase
        .from('applications')
        .select('id, status')
        .eq('id', applicationId)
        .maybeSingle();

      if (fetchErr) {
        logError('shiftInvite.cancelInvite.fetch', fetchErr);
        return { success: false, error: 'Convite não encontrado.' };
      }
      if (!current) return { success: false, error: 'Convite não encontrado.' };
      if (current.status !== 'invited') {
        return {
          success: false,
          error: `Transição inválida: status atual é '${current.status}', esperado 'invited'.`,
        };
      }

      const { error: updateErr } = await supabase
        .from('applications')
        .update({ status: 'cancelled' })
        .eq('id', applicationId)
        .eq('status', 'invited');

      if (updateErr) {
        logError('shiftInvite.cancelInvite.update', updateErr);
        return { success: false, error: 'Erro ao cancelar o convite.' };
      }

      return { success: true };
    } catch (err) {
      logError('shiftInvite.cancelInvite', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro inesperado.',
      };
    }
  },

  /**
   * Dispensa um freela JÁ contratado deste turno ('hired' | 'in_progress' → 'cancelled').
   * Gesto sério (o freela já contava com o turno) — a UI DEVE exigir confirmação explícita
   * antes de chamar isto; este método não confirma nada, só executa a transição.
   *
   * Guarda: bloqueia se já existe um marcador ATIVO em `shift_payments` (status
   * 'scheduled' ou 'recorded') para este job. Motivo: dispensar deixaria esse marcador
   * órfão — atrelado a um freela que não está mais no turno — e o UNIQUE parcial de
   * `shift_payments` (`(job_id) WHERE status IN ('scheduled','recorded')`) impediria
   * registrar/agendar o pagamento de um freela substituto enquanto o marcador antigo
   * seguir ativo. A empresa precisa estornar (`PaymentRecordService.voidPayment`) antes.
   *
   * Notificação simétrica ao freela: mesmo caminho de `cancelInvite` — o trigger
   * `trg_notify_counterpart_on_application_cancel` avisa o freela automaticamente; este
   * método não insere notificação nenhuma.
   */
  async dismissFromShift(applicationId: string): Promise<DismissFromShiftResult> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { success: false, error: 'Sessão expirada.' };

      const { data: current, error: fetchErr } = await supabase
        .from('applications')
        .select('id, status, job_id')
        .eq('id', applicationId)
        .maybeSingle();

      if (fetchErr) {
        logError('shiftInvite.dismissFromShift.fetch', fetchErr);
        return { success: false, error: 'Freela não encontrado neste turno.' };
      }
      if (!current) return { success: false, error: 'Freela não encontrado neste turno.' };
      if (current.status !== 'hired' && current.status !== 'in_progress') {
        return {
          success: false,
          error: `Transição inválida: status atual é '${current.status}', esperado 'hired' ou 'in_progress'.`,
        };
      }

      // Guarda: pagamento ATIVO (scheduled|recorded) para este job bloqueia o dispensar
      // (ver motivo no comentário do método) — checagem defensiva, além da UI já impedir.
      const { data: activePayment, error: paymentErr } = await supabase
        .from('shift_payments')
        .select('id, status')
        .eq('job_id', current.job_id)
        .in('status', ['scheduled', 'recorded'])
        .maybeSingle();

      if (paymentErr) {
        logError('shiftInvite.dismissFromShift.checkPayment', paymentErr);
        return { success: false, error: 'Erro ao verificar pagamento do turno.' };
      }
      if (activePayment) {
        return {
          success: false,
          blockedByPayment: true,
          error:
            'Este turno já tem um pagamento registrado ou agendado. Estorne o pagamento antes de dispensar o freela.',
        };
      }

      const { error: updateErr } = await supabase
        .from('applications')
        .update({ status: 'cancelled' })
        .eq('id', applicationId)
        .in('status', ['hired', 'in_progress']);

      if (updateErr) {
        logError('shiftInvite.dismissFromShift.update', updateErr);
        return { success: false, error: 'Erro ao dispensar o freela deste turno.' };
      }

      return { success: true };
    } catch (err) {
      logError('shiftInvite.dismissFromShift', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro inesperado.',
      };
    }
  },

  // -------------------------------------------------------------------------
  // WORKER: responder ao convite (aceitar ou recusar)
  // -------------------------------------------------------------------------

  /**
   * Worker responde a um convite de turno.
   *
   * Máquina de estados (validada aqui — ADR-001):
   *   'invited' → 'hired'    (quando accepted)
   *   'invited' → 'declined' (quando declined — NEUTRO, zero punição — R7)
   *
   * NÃO chama reserve_escrow (postpago é Slice 2; Slice 2 adiciona o hook aqui).
   *
   * @param applicationId UUID da application (convite).
   * @param response      'accepted' | 'declined'.
   */
  async respondToInvite(
    applicationId: string,
    response: InvitationResponse,
  ): Promise<RespondToInviteResult> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { success: false, error: 'Sessão expirada.' };

      // 1. Buscar application atual (validar máquina de estados)
      const { data: current, error: fetchErr } = await supabase
        .from('applications')
        .select('id, status, worker_id, job_id, invited_by_company_at, invitation_expires_at')
        .eq('id', applicationId)
        .maybeSingle();

      if (fetchErr) {
        logError('shiftInvite.respondToInvite.fetch', fetchErr);
        return { success: false, error: 'Convite não encontrado.' };
      }
      if (!current) return { success: false, error: 'Convite não encontrado.' };
      if (current.worker_id !== user.id) {
        return { success: false, error: 'Este convite não é para você.' };
      }
      if (current.status !== 'invited') {
        return {
          success: false,
          error: `Transição inválida: status atual é '${current.status}', esperado 'invited'.`,
        };
      }

      // 2. Verificar expiração (R8)
      if (current.invitation_expires_at) {
        const expiresAt = new Date(current.invitation_expires_at as string);
        if (expiresAt < new Date()) {
          return {
            success: false,
            error: 'Este convite expirou. O operador precisará reenviar um novo convite.',
          };
        }
      }

      // 3. Mapear response → status final
      //    accepted → 'hired' (turno confirmado para os dois lados — sem escrow neste slice)
      //    declined → 'declined' (neutro — R7)
      const newStatus: ApplicationStatus = response === 'accepted' ? 'hired' : 'declined';
      const now = new Date().toISOString();

      const { error: updateErr } = await supabase
        .from('applications')
        .update({
          status: newStatus,
          invitation_response: response,
          invitation_responded_at: now,
        })
        .eq('id', applicationId)
        .eq('worker_id', user.id);

      if (updateErr) {
        logError('shiftInvite.respondToInvite.update', updateErr);
        return { success: false, error: 'Erro ao registrar resposta.' };
      }

      // 4. Resolver o owner da empresa (necessário tanto para notificação de aceite quanto
      //    para notificação de falha de cartão em dispatchAuthorizePayment).
      let companyOwnerId: string | null = null;
      if (response === 'accepted') {
        const { data: jobRow } = await supabase
          .from('applications')
          .select('job:jobs(company_id)')
          .eq('id', applicationId)
          .maybeSingle();

        const companyId = (jobRow?.job as { company_id?: string } | null)?.company_id;
        if (companyId) {
          const { data: companyRow } = await supabase
            .from('companies')
            .select('owner_id')
            .eq('id', companyId)
            .maybeSingle();
          companyOwnerId = companyRow?.owner_id ?? null;
        }
      }

      // 5. Pré-autorização postpago (best-effort — não bloqueia o aceite em caso de falha).
      //    Modo 'authorize': cria hold no cartão da empresa. Modo 'charge_on_demand': no-op aqui.
      //    A captura (ou cobrança direta) ocorre na conclusão via asaas-capture-payment.
      //    Em card_declined, dispatchAuthorizePayment já envia notificação à empresa.
      //    Desligado no piloto (modo A — ver POSTPAY_AUTHORIZE_ENABLED): não dispara chamada
      //    ao caminho postpago, evitando o erro de CORS órfão no console do worker.
      if (response === 'accepted' && POSTPAY_AUTHORIZE_ENABLED) {
        await dispatchAuthorizePayment(current.job_id, applicationId, companyOwnerId ?? '');
      }

      // 6. Notificação in-app para a empresa sobre o aceite (best-effort)
      if (response === 'accepted' && companyOwnerId) {
        const { error: notifErr } = await supabase.from('notifications').insert({
          user_id: companyOwnerId,
          type: 'status_change',
          title: 'Freela aceitou o turno',
          message: 'Um freela aceitou seu convite de turno.',
          link: `/company/jobs/${current.job_id}/candidates`,
        });

        if (notifErr) {
          logError('shiftInvite.respondToInvite.notif', notifErr);
        }
      }

      return { success: true };
    } catch (err) {
      logError('shiftInvite.respondToInvite', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro inesperado.',
      };
    }
  },

  // -------------------------------------------------------------------------
  // Listagem de convites pendentes (worker)
  // -------------------------------------------------------------------------

  /**
   * Lista convites de turno pendentes ('invited') do worker autenticado.
   * Inclui dados do job e da empresa para a aba "Convites".
   */
  async listPendingInvites(): Promise<Application[]> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('applications')
        .select(
          `
          *,
          job:jobs (
            id,
            title,
            description,
            briefing,
            location,
            start_date,
            work_start_time,
            work_end_time,
            budget,
            has_lunch,
            company_id,
            company:companies (
              id,
              name,
              logo_url,
              rating_average
            )
          )
        `,
        )
        .eq('worker_id', user.id)
        .eq('status', 'invited')
        .order('invited_by_company_at', { ascending: false });

      if (error) {
        logError('shiftInvite.listPendingInvites', error);
        return [];
      }

      return (data ?? []) as Application[];
    } catch (err) {
      logError('shiftInvite.listPendingInvites', err);
      return [];
    }
  },

  /**
   * Lista convites enviados por uma empresa para um job específico.
   * Para o operador acompanhar respostas.
   */
  async listInvitesByJob(jobId: string | null | undefined): Promise<Application[]> {
    // Guarda: sem jobId (ex.: turno ainda não criado/persistido, ou id ainda não resolvido pelo
    // router), não há o que consultar. `!jobId` cobre '', null E undefined — evita tanto
    // `GET /applications?...&job_id=eq.&...` (400, filtro vazio) quanto `...&job_id=eq.null`
    // (400/dado incorreto, caso algum chamador passe null/undefined em vez de coalescer para '').
    if (!jobId) return [];

    try {
      const { data, error } = await supabase
        .from('applications')
        .select(
          `
          *,
          worker:workers (
            id,
            full_name,
            avatar_url,            primary_role,
            rating_average
          )
        `,
        )
        .eq('job_id', jobId)
        .not('invited_by_company_at', 'is', null)
        .order('invited_by_company_at', { ascending: false });

      if (error) {
        logError('shiftInvite.listInvitesByJob', error);
        return [];
      }

      return (data ?? []) as Application[];
    } catch (err) {
      logError('shiftInvite.listInvitesByJob', err);
      return [];
    }
  },
};

// ---------------------------------------------------------------------------
// WhatsApp — aviso manual de convite (zero backend, deep link `wa.me`)
// ---------------------------------------------------------------------------
// O convite só existe dentro do app: o InviteTakeover só dispara com o app aberto e a
// notificação do navegador não sobrevive à aba fechada. Sem push real/SMS (infra que o
// projeto não tem), o telefone já cadastrado do freela (`workers.phone`) é o único canal
// fora do app que a empresa tem à mão. Funções puras (sem I/O) — fáceis de testar isoladas.

/**
 * Normaliza um telefone brasileiro (gravado mascarado, ex.: "(11) 99999-9999") para o
 * formato que o `wa.me` espera: só dígitos, com DDI 55 na frente.
 *
 * - 10/11 dígitos (DDD + telefone, sem DDI) → prefixa "55".
 * - 12/13 dígitos já começando com "55" → mantém como está (já veio com DDI).
 * - Qualquer outro formato (vazio, incompleto, sem DDD reconhecível) → `null`, nunca gera
 *   `wa.me/undefined` ou um link quebrado.
 */
export function normalizePhoneForWhatsApp(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;

  // Já veio com DDI 55 (12 = DDD + fixo 8 dígitos + 55; 13 = DDD + celular 9 dígitos + 55).
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    return digits;
  }

  // Número local sem DDI (10 = fixo, 11 = celular).
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return null;
}

export interface ShiftInviteWhatsAppMessageParams {
  companyName: string;
  jobTitle: string;
  /** Data já formatada pelo caller (ex.: "16/08/2026") — evita duplicar a lógica de fuso aqui. */
  dateLabel?: string | null;
  /** Horário já formatado pelo caller (ex.: "08:00 às 17:00"). */
  timeLabel?: string | null;
  location?: string | null;
  /** Valor do turno em BRL. */
  amount?: number | null;
  /** URL para o freela abrir o app e responder ao convite. */
  appUrl: string;
}

/**
 * Monta a mensagem pronta do WhatsApp — nome da empresa, título do turno, data, horário,
 * local e valor, mais o link direto para o app. Não genérica: usa os dados reais do turno.
 */
export function buildShiftInviteWhatsAppMessage(params: ShiftInviteWhatsAppMessageParams): string {
  const { companyName, jobTitle, dateLabel, timeLabel, location, amount, appUrl } = params;

  const valueLabel =
    typeof amount === 'number' && amount > 0
      ? `Valor: R$ ${amount.toFixed(2).replace('.', ',')}`
      : null;

  const lines = [
    `Oi! Aqui é ${companyName || 'a empresa'} pelo Worki.`,
    `Te convidei para o turno "${jobTitle}"${dateLabel ? `, ${dateLabel}` : ''}${timeLabel ? ` (${timeLabel})` : ''}.`,
    location ? `Local: ${location}` : null,
    valueLabel,
    '',
    `Dá uma olhada e responde no app: ${appUrl}`,
  ].filter((line): line is string => line !== null);

  return lines.join('\n');
}
