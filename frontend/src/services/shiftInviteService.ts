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

      // 4. Notificação in-app para a empresa (best-effort)
      if (response === 'accepted') {
        // Buscar company para notificar o operador
        const { data: job } = await supabase
          .from('applications')
          .select('job:jobs(company_id)')
          .eq('id', applicationId)
          .maybeSingle();

        // job.job é um objeto com company_id
        const companyId = (job?.job as { company_id?: string } | null)?.company_id;

        if (companyId) {
          // Buscar owner da empresa
          const { data: company } = await supabase
            .from('companies')
            .select('owner_id')
            .eq('id', companyId)
            .maybeSingle();

          if (company?.owner_id) {
            const { error: notifErr } = await supabase.from('notifications').insert({
              user_id: company.owner_id,
              type: 'status_change',
              title: 'Freela aceitou o turno',
              message: 'Um freela aceitou seu convite de turno.',
              link: `/company/jobs/${current.job_id}/candidates`,
            });

            if (notifErr) {
              logError('shiftInvite.respondToInvite.notif', notifErr);
            }
          }
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
  async listInvitesByJob(jobId: string): Promise<Application[]> {
    try {
      const { data, error } = await supabase
        .from('applications')
        .select(
          `
          *,
          worker:workers (
            id,
            full_name,
            avatar_url,
            photo_url,
            primary_role,
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
