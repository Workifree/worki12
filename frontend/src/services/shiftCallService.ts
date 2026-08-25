/**
 * ShiftCallService — Chamado de Turno (F1): disparo 1→N com primeiro-aceite.
 *
 * O gesto que a entrevista de 17/08/2026 pediu: em vez de ligar/mandar zap para um freela de
 * cada vez e segurar a vaga por horas, a empresa dispara para vários do elenco ao mesmo tempo e
 * fica com o primeiro que aceitar.
 *
 * DIVISÃO DE RESPONSABILIDADE COM O BANCO — o ponto mais importante deste arquivo:
 *
 *   Este service NÃO arbitra a corrida. Ele monta o disparo (INSERT em `shift_calls` +
 *   `shift_call_targets`, sob RLS) e, na resposta, apenas CHAMA a RPC e reage ao `outcome`.
 *   Quem decide quem ficou com a vaga é `claim_shift_slot` (20260817000200), que serializa no
 *   lock da linha do turno. Qualquer tentativa de "checar antes se ainda tem vaga" aqui no
 *   client é teatro: entre o SELECT e o UPDATE cabe o aceite de outro freela — é exatamente o
 *   bug que o `respondToInvite` legado tem e que esta feature existe para corrigir.
 *
 *   Corolário prático: nunca derive o estado da vaga de uma leitura anterior. O `outcome` da
 *   RPC é a única verdade, e é ele que a UI deve traduzir.
 *
 * Padrão do projeto: `useState`/`useEffect` + supabase direto (Article 5), erros por retorno
 * estruturado (nunca throw para a UI), `logError` para diagnóstico.
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import type {
  PendingInvite,
  ShiftCall,
  ShiftCallReason,
  ShiftCallRpcResult,
  ShiftCallTarget,
} from '../types';
import { getAuthenticatedCompanyId as resolverEmpresaDaSessao } from './companyScopeService';

// ---------------------------------------------------------------------------
// Janela de expiração
// ---------------------------------------------------------------------------

/**
 * Opções de janela oferecidas no disparo. O default do produto é 2 HORAS — o convite legado
 * expirava em 48h, que é literalmente o comportamento criticado na entrevista ("sem segurar a
 * vaga por uma ou duas horas enquanto o cara não aceita"). Uma janela curta é o que faz o
 * gerente saber rápido que precisa chamar mais gente.
 */
export const CALL_EXPIRY_PRESETS = [
  { value: 0.5, label: '30 minutos' },
  { value: 1, label: '1 hora' },
  { value: 2, label: '2 horas' },
  { value: 6, label: '6 horas' },
  { value: 24, label: '24 horas' },
] as const;

export const DEFAULT_CALL_EXPIRY_HOURS = 2;

export interface CreateShiftCallOptions {
  /** Horas até expirar. Ignorado se `expiresAt` for passado. Default: 2. */
  expiresInHours?: number;
  /** Instante exato de expiração (ex.: "até o início do turno"). Tem precedência. */
  expiresAt?: string;
  reason?: ShiftCallReason;
  message?: string;
}

export interface CreateShiftCallResult {
  call: ShiftCall | null;
  /** Quantos alvos foram efetivamente gravados. */
  invited: number;
  error?: string;
}

export interface CancelShiftCallResult {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function calcExpiry(hours: number): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + Math.round(hours * 60));
  return d.toISOString();
}

/**
 * `jobs.start_date` é timestamptz e `work_start_time` é texto ("08:00"). Quando a empresa
 * escolhe "até o início do turno", o limite é a data do turno com o horário de início colado
 * por cima — e nunca um instante no passado (turno de hoje às 8h, disparo às 8h30: aí a janela
 * cai para o mínimo de 30 minutos, senão o chamado nasceria morto).
 */
export function calcExpiryAtShiftStart(
  startDate: string | null | undefined,
  workStartTime: string | null | undefined,
): string {
  const fallback = calcExpiry(DEFAULT_CALL_EXPIRY_HOURS);
  if (!startDate) return fallback;

  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return fallback;

  if (workStartTime) {
    const [h, m] = workStartTime.split(':');
    const hours = Number(h);
    const minutes = Number(m ?? '0');
    if (!Number.isNaN(hours)) start.setHours(hours, Number.isNaN(minutes) ? 0 : minutes, 0, 0);
  }

  const minimum = new Date();
  minimum.setMinutes(minimum.getMinutes() + 30);
  return start.getTime() > minimum.getTime() ? start.toISOString() : minimum.toISOString();
}

/** Obtém o company_id da sessão autenticada (empresa). */
async function getAuthCompanyId(): Promise<string> {
  // Delega ao seam. A ancoragem dupla escrita aqui (owner_id, com fallback para o uid)
  // cobria os dois formatos de DONO, mas nao o gerente de unidade (company_members).
  return resolverEmpresaDaSessao();
}

// ---------------------------------------------------------------------------
// ShiftCallService
// ---------------------------------------------------------------------------

export const ShiftCallService = {
  // -------------------------------------------------------------------------
  // EMPRESA: disparar
  // -------------------------------------------------------------------------

  /**
   * Dispara um chamado para 1..N freelas do elenco.
   *
   * Um alvo = o convite individual de sempre; N alvos = a corrida. É o mesmo gesto, e por isso
   * `ShiftInviteService.inviteWorkerToShift` delega para cá em vez de manter um caminho próprio.
   *
   * A validação de "só quem está no elenco aceito" NÃO é feita aqui em laço: ela mora na policy
   * de INSERT de `shift_call_targets` (lista fechada, espelhando R1/R2). Se algum alvo não tiver
   * vínculo aceito, o INSERT em lote falha inteiro — comportamento correto: a empresa monta a
   * lista de novo em vez de disparar um chamado silenciosamente incompleto.
   */
  async createShiftCall(
    jobId: string,
    workerIds: string[],
    opts: CreateShiftCallOptions = {},
  ): Promise<CreateShiftCallResult> {
    try {
      if (!jobId) {
        return { call: null, invited: 0, error: 'Turno não informado.' };
      }
      const uniqueWorkerIds = Array.from(new Set(workerIds.filter(Boolean)));
      if (uniqueWorkerIds.length === 0) {
        return { call: null, invited: 0, error: 'Selecione ao menos um freela.' };
      }

      const companyId = await getAuthCompanyId();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { call: null, invited: 0, error: 'Sessão expirada.' };

      // `slots` vem do turno (fonte da verdade); o chamado guarda o snapshot.
      const { data: job, error: jobErr } = await supabase
        .from('jobs')
        .select('id, slots, company_id')
        .eq('id', jobId)
        .maybeSingle();

      if (jobErr) {
        logError('shiftCall.createShiftCall.job', jobErr);
        return { call: null, invited: 0, error: 'Não foi possível carregar o turno.' };
      }
      if (!job) return { call: null, invited: 0, error: 'Turno não encontrado.' };

      const expiresAt = opts.expiresAt ?? calcExpiry(opts.expiresInHours ?? DEFAULT_CALL_EXPIRY_HOURS);

      const { data: call, error: callErr } = await supabase
        .from('shift_calls')
        .insert({
          job_id: jobId,
          // O INSERT exige que bata com jobs.company_id (policy). Usamos o do turno, não o
          // resolvido pela sessão — são iguais quando a empresa é dona, e o banco recusa se não.
          company_id: (job.company_id as string) ?? companyId,
          created_by: user.id,
          slots: (job.slots as number) ?? 1,
          reason: opts.reason ?? 'outro',
          message: opts.message ?? null,
          targets_count: uniqueWorkerIds.length,
          status: 'open',
          expires_at: expiresAt,
        })
        .select()
        .single();

      if (callErr || !call) {
        logError('shiftCall.createShiftCall.insertCall', callErr);
        return { call: null, invited: 0, error: 'Não foi possível abrir o chamado.' };
      }

      const { data: targets, error: targetsErr } = await supabase
        .from('shift_call_targets')
        .insert(uniqueWorkerIds.map((workerId) => ({ call_id: call.id, worker_id: workerId })))
        .select('id, worker_id');

      if (targetsErr || !targets || targets.length === 0) {
        logError('shiftCall.createShiftCall.insertTargets', targetsErr);
        // O chamado sem alvo nenhum é lixo visível na tela da empresa — fecha na hora.
        // Best-effort: se este cancelamento falhar, o chamado ainda expira sozinho.
        await supabase.rpc('cancel_shift_call', { p_call_id: call.id });
        return {
          call: null,
          invited: 0,
          error:
            'Não foi possível convidar os freelas selecionados. Verifique se todos ainda estão no seu elenco.',
        };
      }

      // Notificação in-app (best-effort — o chamado já existe; aviso não bloqueia).
      const { error: notifErr } = await supabase.from('notifications').insert(
        uniqueWorkerIds.map((workerId) => ({
          user_id: workerId,
          type: 'status_change',
          title: uniqueWorkerIds.length > 1 ? 'Chamado de turno — responda rápido' : 'Novo convite de turno',
          message:
            opts.message ??
            (uniqueWorkerIds.length > 1
              ? 'Um turno foi aberto para você e outros freelas. Quem aceitar primeiro fica com a vaga.'
              : 'Você recebeu um convite para um turno. Abra para aceitar ou recusar.'),
          link: '/my-jobs',
        })),
      );
      if (notifErr) logError('shiftCall.createShiftCall.notif', notifErr);

      // NAO ha e-mail de convite hoje. O bloco que existia aqui chamava a edge function
      // `send-notification` com `type: 'shift_invite'` -- um tipo que o `switch` da funcao nunca
      // tratou: caia no `default`, respondia `{success:false, reason:'unknown_type'}` com HTTP
      // 200, e como 200 e "fulfilled" para o Promise.allSettled, o contador de falhas ficava em
      // zero. Ou seja: nunca enviou e-mail nenhum, e nunca avisou que nao enviava.
      //
      // A funcao foi REMOVIDA de producao em 25/08/2026 -- estava deployada sem checagem de auth
      // (respondia 200 a POST anonimo) e nao tinha nenhum chamador que funcionasse. Manter a
      // chamada aqui so trocaria um no-op silencioso por um 404 barulhento no Sentry.
      //
      // O aviso ao freela continua funcionando pelos dois caminhos que de fato funcionam: a
      // notificacao in-app inserida logo acima e o Realtime. Se e-mail virar requisito do piloto,
      // e trabalho novo: template `shift_invite`, checagem de auth na funcao e RESEND_API_KEY.

      return { call: call as ShiftCall, invited: targets.length };
    } catch (err) {
      logError('shiftCall.createShiftCall', err);
      return {
        call: null,
        invited: 0,
        error: err instanceof Error ? err.message : 'Erro inesperado.',
      };
    }
  },

  /** Chamados de um turno, com os alvos e o perfil de cada freela (visão da empresa). */
  async listCallsByJob(jobId: string | null | undefined): Promise<ShiftCall[]> {
    if (!jobId) return [];
    try {
      const { data, error } = await supabase
        .from('shift_calls')
        .select(
          `
          *,
          targets:shift_call_targets (
            id, call_id, worker_id, notified_at, responded_at, response,
            worker:workers ( id, full_name, avatar_url, primary_role, rating_average )
          )
        `,
        )
        .eq('job_id', jobId)
        .order('created_at', { ascending: false });

      if (error) {
        logError('shiftCall.listCallsByJob', error);
        return [];
      }
      return (data ?? []) as ShiftCall[];
    } catch (err) {
      logError('shiftCall.listCallsByJob', err);
      return [];
    }
  },

  /** Empresa para de procurar. Não desfaz quem já aceitou (ver comentário da RPC). */
  async cancelShiftCall(callId: string): Promise<CancelShiftCallResult> {
    try {
      const { data, error } = await supabase.rpc('cancel_shift_call', { p_call_id: callId });
      if (error) {
        logError('shiftCall.cancelShiftCall', error);
        return { success: false, error: 'Não foi possível cancelar o chamado.' };
      }
      const result = data as ShiftCallRpcResult | null;
      if (result?.outcome === 'cancelled') return { success: true };

      return {
        success: false,
        error:
          result?.outcome === 'forbidden'
            ? 'Você não pode cancelar este chamado.'
            : 'Este chamado já foi encerrado.',
      };
    } catch (err) {
      logError('shiftCall.cancelShiftCall', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  // -------------------------------------------------------------------------
  // FREELA: responder
  // -------------------------------------------------------------------------

  /**
   * Aceita o chamado. O banco arbitra — este método só repassa o `outcome`.
   * Ver o cabeçalho do arquivo sobre por que não há checagem prévia de vaga aqui.
   */
  async claimSlot(callId: string): Promise<ShiftCallRpcResult> {
    try {
      const { data, error } = await supabase.rpc('claim_shift_slot', { p_call_id: callId });
      if (error) {
        logError('shiftCall.claimSlot', error);
        return { outcome: 'not_found' };
      }
      return (data ?? { outcome: 'not_found' }) as ShiftCallRpcResult;
    } catch (err) {
      logError('shiftCall.claimSlot', err);
      return { outcome: 'not_found' };
    }
  },

  /** Recusa. NEUTRA — zero punição (R6). */
  async declineCall(callId: string): Promise<ShiftCallRpcResult> {
    try {
      const { data, error } = await supabase.rpc('decline_shift_call', { p_call_id: callId });
      if (error) {
        logError('shiftCall.declineCall', error);
        return { outcome: 'not_found' };
      }
      return (data ?? { outcome: 'not_found' }) as ShiftCallRpcResult;
    } catch (err) {
      logError('shiftCall.declineCall', err);
      return { outcome: 'not_found' };
    }
  },

  /**
   * Chamados pendentes do freela autenticado, já normalizados em `PendingInvite`.
   *
   * Filtra os expirados no client de propósito: a expiração é preguiçosa no banco (quem chega
   * atrasado fecha o chamado), então uma linha pode continuar `open` com `expires_at` no
   * passado até alguém tocar nela. Mostrar isso ao freela seria oferecer uma vaga que a RPC vai
   * recusar no clique seguinte.
   */
  async listPendingForWorker(): Promise<PendingInvite[]> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('shift_call_targets')
        .select(
          `
          id, call_id, worker_id, notified_at, responded_at, response,
          call:shift_calls (
            id, job_id, slots, reason, message, targets_count, status, expires_at, created_at,
            job:jobs (
              id, title, description, briefing, location, start_date,
              work_start_time, work_end_time, budget, has_lunch, slots, company_id,
              company:companies ( id, name, logo_url, rating_average )
            )
          )
        `,
        )
        .eq('worker_id', user.id)
        .is('response', null)
        .order('notified_at', { ascending: false });

      if (error) {
        logError('shiftCall.listPendingForWorker', error);
        return [];
      }

      const now = Date.now();

      return (data ?? [])
        .map((row) => {
          const target = row as unknown as ShiftCallTarget;
          const call = target.call;
          if (!call || call.status !== 'open') return null;
          if (new Date(call.expires_at).getTime() <= now) return null;

          const invite: PendingInvite = {
            source: 'call',
            id: target.id,
            callId: call.id,
            jobId: call.job_id,
            expiresAt: call.expires_at,
            disputed: (call.targets_count ?? 1) > 1,
            targetsCount: call.targets_count ?? 1,
            slots: call.slots ?? 1,
            reason: call.reason,
            message: call.message,
            job: call.job,
          };
          return invite;
        })
        .filter((invite): invite is PendingInvite => invite !== null);
    } catch (err) {
      logError('shiftCall.listPendingForWorker', err);
      return [];
    }
  },
};
