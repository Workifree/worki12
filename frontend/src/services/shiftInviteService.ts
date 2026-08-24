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
import { ShiftCallService } from './shiftCallService';
import type {
  Application,
  ApplicationStatus,
  InvitationResponse,
} from '../types';
import { getAuthenticatedCompanyId as resolverEmpresaDaSessao } from './companyScopeService';

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
  /**
   * Sempre `null` desde o F1: o convite individual virou um chamado de um alvo e a
   * `applications` só nasce quando o freela aceita. Mantido no tipo para não quebrar chamadores
   * que ainda desestruturam este campo.
   */
  application: Application | null;
  /** id do `shift_calls` criado. */
  callId?: string;
  error?: string;
  /** true quando já existe um convite/chamado pendente (idempotência). */
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
  /** true quando o bloqueio foi por já existir pagamento (agendado ou registrado) para ESTE freela neste turno. */
  blockedByPayment?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Obtém o company_id da sessão autenticada (empresa). */
async function getAuthCompanyId(): Promise<string> {
    // Delega ao seam: `owner_id` sozinho e a ancora ANTIGA -- nao cobre empresa cujo id e o do
  // proprio usuario, nem gerente de unidade (company_members). Ver companyScopeService.
  return resolverEmpresaDaSessao();
}

// ---------------------------------------------------------------------------
// hasAttendedShift — predicado único de "o freela já compareceu" (revisão pré-piloto, QA)
// ---------------------------------------------------------------------------

/** Sinais de presença de uma application — subconjunto usado por `hasAttendedShift`. */
export interface AttendanceSignals {
  worker_checkin_at?: string | null;
  company_checkin_confirmed_at?: string | null;
  company_checkout_confirmed_at?: string | null;
}

/**
 * true quando o freela já COMPARECEU ao turno, por QUALQUER um dos três sinais reais que o
 * sistema reconhece. "Dispensar" é um gesto de ANTES do turno acontecer; a partir do momento
 * em que qualquer um destes sinais existe, o freela já tem trabalho a faturar — o caminho
 * correto passa a ser registrar (ou, se necessário, estornar) o pagamento, nunca dispensar
 * (`applications.status → 'cancelled'` é irreversível: `UNIQUE(job_id, worker_id)` impede
 * reconvidar o mesmo freela para o mesmo turno).
 *
 * Os três sinais, nenhum redundante — cobrem os três jeitos reais de um turno começar:
 *  1. `worker_checkin_at`             — o próprio freela bateu chegada no app.
 *  2. `company_checkin_confirmed_at`  — a empresa confirmou a chegada pela tela, MESMO sem o
 *     freela nunca ter aberto o app (`handleConfirmCheckin`/"Confirmar Presença" —
 *     justamente o caminho canônico do modo A, freela que não usa o app).
 *  3. `company_checkout_confirmed_at` — a empresa já confirmou a SAÍDA (turno claramente
 *     aconteceu, mesmo no caso raro de o checkin nunca ter sido confirmado).
 *
 * Centralizado e nomeado de propósito (não replicado condição a condição em cada chamador):
 * foi a ausência do sinal (2) numa versão anterior desta guarda — presente só em
 * `shiftInviteService.dismissFromShift` e no render de `CompanyJobCandidates` — que deixava
 * "Dispensar" disponível depois de "Confirmar Presença" sem o freela ter batido check-in no
 * app (o caminho normal quando ele não usa o app). Uma quarta forma de "o turno começou" no
 * futuro só precisa entrar AQUI, uma vez, para os dois lados (UI e service) ficarem corretos.
 */
export function hasAttendedShift(app: AttendanceSignals): boolean {
  return !!(
    app.worker_checkin_at ||
    app.company_checkin_confirmed_at ||
    app.company_checkout_confirmed_at
  );
}

// ---------------------------------------------------------------------------
// ShiftInviteService
// ---------------------------------------------------------------------------

export const ShiftInviteService = {
  // -------------------------------------------------------------------------
  // EMPRESA: convidar worker para turno
  // -------------------------------------------------------------------------

  /**
   * Convida UM worker da equipe para um turno específico.
   *
   * Desde o F1 (Chamado de Turno) este método é um **atalho de um alvo** sobre
   * `ShiftCallService.createShiftCall` — não existe mais um caminho de convite próprio.
   *
   * Por que delegar em vez de manter os dois: enquanto o convite individual escrevia direto em
   * `applications` com status 'invited', ele produzia um estado que o chamado não produz (uma
   * application antes do aceite) e que o `UNIQUE(job_id, worker_id)` transforma em bloqueio
   * permanente se o convite for cancelado. Dois produtores do mesmo convite, com regras
   * diferentes de reversibilidade, é o tipo de divergência que só aparece no pior dia — a
   * empresa tentando rechamar alguém e o sistema dizendo que não dá, sem explicar por quê.
   *
   * Pré-condições (elenco aceito, idempotência) continuam valendo: a primeira é verificada
   * aqui e reforçada na policy de INSERT de `shift_call_targets`; a segunda é verificada aqui.
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

      // 1. Validar que o worker está na equipe aceita (R2 — lista fechada)
      const inTeam = await TeamConnectionService.isWorkerInTeam(companyId, workerId);
      if (!inTeam) {
        return {
          application: null,
          error:
            'O freela não está na sua equipe. Adicione-o primeiro para poder convidar.',
        };
      }

      // 2. Já está no turno? (application de qualquer origem — pull, convite legado ou aceite)
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
        if (existing.status === 'invited') {
          return { application: existing as Application, alreadyInvited: true };
        }
        return {
          application: null,
          error: `Já existe uma candidatura para este turno com status '${existing.status}'.`,
        };
      }

      // 3. Já existe chamado ABERTO deste turno com este freela como alvo pendente?
      //    (idempotência do caminho novo — evita dois chamados para a mesma pessoa/turno)
      const { data: openTargets, error: openErr } = await supabase
        .from('shift_call_targets')
        .select('id, call:shift_calls!inner ( id, job_id, status )')
        .eq('worker_id', workerId)
        .is('response', null)
        .eq('call.job_id', jobId)
        .eq('call.status', 'open')
        .limit(1);

      if (openErr) {
        logError('shiftInvite.inviteWorkerToShift.checkCall', openErr);
      } else if (openTargets && openTargets.length > 0) {
        return { application: null, alreadyInvited: true };
      }

      // 4. Disparo de um alvo só.
      const expiresInHours = opts.expiresInHours ?? DEFAULT_INVITE_EXPIRY_HOURS;
      const result = await ShiftCallService.createShiftCall(jobId, [workerId], {
        expiresInHours,
        message: opts.message,
      });

      if (result.error || !result.call) {
        return { application: null, error: result.error ?? 'Não foi possível criar o convite.' };
      }

      return { application: null, callId: result.call.id };
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

      // `.select('id')` obrigatório (padrão `removeFromTeam`/patterns.md): sob RLS, um
      // UPDATE cuja linha não casa mais com a policy USING não gera erro — retorna 0 linhas
      // e o PostgREST devolve 204. Sem checar `data`, o service reportaria sucesso mesmo
      // quando o banco não mudou nada.
      const { data: updated, error: updateErr } = await supabase
        .from('applications')
        .update({ status: 'cancelled' })
        .eq('id', applicationId)
        .eq('status', 'invited')
        .select('id');

      if (updateErr) {
        logError('shiftInvite.cancelInvite.update', updateErr);
        return { success: false, error: 'Erro ao cancelar o convite.' };
      }
      if (!updated || updated.length === 0) {
        return { success: false, error: 'Não foi possível cancelar este convite.' };
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
   * 'scheduled' ou 'recorded') para ESTE FREELA neste turno (ADR-20260816 — o marcador é
   * por (job_id, worker_id), não mais por job_id sozinho: dois freelas do mesmo turno têm
   * marcadores independentes, e o pagamento de um não pode travar o dispensar do outro).
   * Motivo do bloqueio em si: dispensar deixaria o marcador ATIVO deste freela órfão —
   * atrelado a alguém que não está mais no turno. A empresa precisa estornar
   * (`PaymentRecordService.voidPayment`) antes.
   *
   * Guarda (revisão pré-piloto, onda 3 — QA #2, reforçada na rodada seguinte de QA): bloqueia
   * também se o freela já COMPARECEU ao turno — `hasAttendedShift` (ver acima), que cobre os
   * TRÊS sinais reais (checkin do próprio freela, chegada confirmada pela empresa, ou saída
   * confirmada pela empresa). "Dispensar" é um gesto de ANTES do turno; depois que o freela
   * trabalhou, dispensar (status→'cancelled') tornaria o turno impagável para sempre —
   * `UNIQUE(job_id, worker_id)` impede reconvidar o mesmo freela e a UI de pagamento só
   * aparece para 'hired'|'in_progress'|'completed'. Nesse ponto o caminho certo é registrar
   * o pagamento (ou estornar um já registrado).
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
        .select(
          'id, status, job_id, worker_id, worker_checkin_at, company_checkin_confirmed_at, company_checkout_confirmed_at',
        )
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

      if (hasAttendedShift(current)) {
        return {
          success: false,
          error: 'O turno já foi cumprido; dispensar não está mais disponível. Registre o pagamento deste turno.',
        };
      }

      // Guarda: pagamento ATIVO (scheduled|recorded) DESTE FREELA neste job bloqueia o
      // dispensar (ver motivo no comentário do método) — checagem defensiva, além da UI já
      // impedir. `.limit(1)` (não `.maybeSingle()`): o filtro por worker_id já garante no
      // máximo 1 linha em qualquer estado do banco (atual OU pós-migration), mas `.limit(1)`
      // não quebra se, por alguma inconsistência, houver mais de uma — só ignora o excedente.
      const { data: activePayments, error: paymentErr } = await supabase
        .from('shift_payments')
        .select('id, status')
        .eq('job_id', current.job_id)
        .eq('worker_id', current.worker_id)
        .in('status', ['scheduled', 'recorded'])
        .limit(1);

      if (paymentErr) {
        logError('shiftInvite.dismissFromShift.checkPayment', paymentErr);
        return { success: false, error: 'Erro ao verificar pagamento do turno.' };
      }
      const activePayment = activePayments?.[0] ?? null;
      if (activePayment) {
        return {
          success: false,
          blockedByPayment: true,
          error:
            'Este freela já tem um pagamento registrado ou agendado neste turno. Estorne o pagamento antes de dispensá-lo.',
        };
      }

      // `.select('id')` obrigatório (padrão `removeFromTeam`/patterns.md) — ver `cancelInvite`
      // acima para o raciocínio completo (UPDATE sob RLS sem match no USING = 0 linhas, sem erro).
      const { data: updated, error: updateErr } = await supabase
        .from('applications')
        .update({ status: 'cancelled' })
        .eq('id', applicationId)
        .in('status', ['hired', 'in_progress'])
        .select('id');

      if (updateErr) {
        logError('shiftInvite.dismissFromShift.update', updateErr);
        return { success: false, error: 'Erro ao dispensar o freela deste turno.' };
      }
      if (!updated || updated.length === 0) {
        return { success: false, error: 'Não foi possível dispensar este freela.' };
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

      // `.select('id')` obrigatório (padrão `removeFromTeam`/patterns.md — DELETE/UPDATE sob
      // RLS negado silenciosamente): se a linha não casar mais com a policy USING no momento
      // do UPDATE (ex.: convite cancelado pela empresa entre o fetch e esta chamada), o
      // PostgREST retorna 204 sem erro e 0 linhas afetadas. Sem checar `data`, o freela veria
      // "convite aceito" com o banco intocado — é justamente o gesto que abre o turno inteiro
      // (o pior sítio para mentir: ninguém descobre até o dia do turno).
      const { data: updated, error: updateErr } = await supabase
        .from('applications')
        .update({
          status: newStatus,
          invitation_response: response,
          invitation_responded_at: now,
        })
        .eq('id', applicationId)
        .eq('worker_id', user.id)
        .eq('status', 'invited')
        .select('id');

      if (updateErr) {
        logError('shiftInvite.respondToInvite.update', updateErr);
        return { success: false, error: 'Erro ao registrar resposta.' };
      }
      if (!updated || updated.length === 0) {
        return {
          success: false,
          error: 'Não foi possível registrar sua resposta a este convite. Atualize a página e tente novamente.',
        };
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
