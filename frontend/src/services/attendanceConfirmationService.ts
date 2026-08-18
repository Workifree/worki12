/**
 * AttendanceConfirmationService — Confirmação de véspera (D-1, F4).
 *
 * Spec: `.harness/spec/confirmacao-vespera/spec.md` (R2, R3, R5 — REVISADOS pelo gate).
 * DDL aprovado (fonte normativa): `.harness/spec/confirmacao-vespera/ddl-aprovado.md`.
 * ADR: `.harness/memory-bank/decisions/ADR-20260817-confirmacao-vespera-log-evento.md`.
 * Migrations: `supabase/migrations/20260817000600_shift_attendance_confirmations.sql`,
 *             `supabase/migrations/20260817000700_attendance_confirmation_rpcs.sql`.
 *
 * DIVISÃO DE RESPONSABILIDADE COM O BANCO — o ponto mais importante deste arquivo:
 *
 *   O estado da confirmação (cap de 2 pedidos, cooldown de 6h, imutabilidade da resposta) mora
 *   inteiramente nas RPCs `request_attendance_confirmation`/`respond_attendance_confirmation`
 *   (SECURITY DEFINER). Este service NUNCA decide isso no client — ele só chama a RPC e traduz
 *   o `outcome`. Mesmo raciocínio de `ShiftCallService`/`JobSeriesService`: qualquer "checar
 *   antes" aqui seria teatro (a corrida se resolve no lock da RPC, não numa leitura prévia).
 *
 *   `shift_attendance_confirmations` NÃO tem policy de INSERT/UPDATE (só SELECT) — não há
 *   caminho de escrita direta pelo client a se preocupar aqui (ao contrário de tabelas com RLS
 *   de escrita, o padrão `.select('id')` + checagem de 0 linhas de `removeFromTeam` não se
 *   aplica: este service não faz nenhum `.update()`/`.insert()` direto na tabela).
 *
 * Padrão do projeto: `useState`/`useEffect` + supabase direto (Article 5), erros por retorno
 * estruturado (nunca throw para a UI), `logError` para diagnóstico.
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import type {
  AttendanceConfirmationOutcome,
  AttendanceConfirmationResponse,
  ShiftAttendanceConfirmation,
} from '../types';

// ---------------------------------------------------------------------------
// Tipos de resultado
// ---------------------------------------------------------------------------

export interface RequestConfirmationResult {
  outcome: AttendanceConfirmationOutcome;
  /** Só presente quando outcome='requested'. */
  requestCount?: number;
  /** Só presente quando outcome='cooldown' — instante em que o próximo pedido é permitido. */
  retryAfter?: string;
  error?: string;
}

export interface RespondConfirmationResult {
  outcome: AttendanceConfirmationOutcome;
  error?: string;
}

/** Formato mínimo devolvido pelo Postgres em erros de query/RPC do supabase-js. */
interface SupabaseErrorLike {
  message?: string;
}

/** Formato jsonb devolvido pelas RPCs desta feature. */
interface AttendanceConfirmationRpcResult {
  outcome?: string;
  request_count?: number;
  retry_after?: string;
}

// ---------------------------------------------------------------------------
// Tradução de outcome → mensagem de erro para a UI
// ---------------------------------------------------------------------------

/**
 * Cobre os outcomes de AMBAS as RPCs (request/respond) — alguns se sobrepõem
 * (unauthenticated/invalid_status/not_found), e é mais simples manter um mapa único do que
 * duplicar. Outcomes de SUCESSO ('requested'/'confirmed'/'cannot_attend') não entram aqui.
 *
 * Exportado (achado do evaluator, 18/08/2026 — mutation testing pegou 16/32 testes verdes por
 * acidente quando esta tradução foi trocada por um retorno genérico fixo): os testes importam
 * este mapa e comparam a mensagem exata, em vez de só `toBeTruthy()` — que o fallback genérico
 * também satisfaria.
 */
export const OUTCOME_ERRORS: Partial<Record<AttendanceConfirmationOutcome, string>> = {
  unauthenticated: 'Sessão expirada. Faça login novamente.',
  forbidden: 'Você não tem permissão para pedir confirmação neste turno.',
  not_target: 'Você não pode responder por outro freela.',
  invalid_status: 'Este turno não está mais elegível para confirmação de presença.',
  invalid_response: 'Resposta inválida.',
  job_inactive: 'Este turno foi cancelado.',
  job_past: 'Este turno já passou — não é mais véspera.',
  already_responded: 'Este pedido de confirmação já foi respondido.',
  not_requested: 'Não há pedido de confirmação em aberto para este turno.',
  limit_reached: 'Limite de pedidos de confirmação atingido para este turno.',
  cooldown: 'Aguarde algumas horas antes de pedir confirmação de novo.',
  not_found: 'Candidatura não encontrada.',
};

function translateOutcome(outcome: string | undefined): string {
  return (
    OUTCOME_ERRORS[(outcome ?? '') as AttendanceConfirmationOutcome] ??
    'Não foi possível concluir a confirmação de véspera.'
  );
}

// ---------------------------------------------------------------------------
// AttendanceConfirmationService
// ---------------------------------------------------------------------------

export const AttendanceConfirmationService = {
  // -------------------------------------------------------------------------
  // EMPRESA: pedir confirmação (manual — fallback/lembrete do disparo automático D-1)
  // -------------------------------------------------------------------------

  /**
   * Dispara `request_attendance_confirmation` (cap de 2 pedidos por application, cooldown de
   * 6h entre pedidos — L3, serializado por lock na RPC). O client não decide se o botão "deve"
   * estar habilitado por conta própria além de refletir o último estado lido via
   * `getConfirmationsForJob` — a RPC é a autoridade final e pode recusar mesmo que a UI ache
   * que está liberado (ex.: outra aba já pediu nesse meio tempo).
   */
  async requestConfirmation(applicationId: string): Promise<RequestConfirmationResult> {
    try {
      if (!applicationId) {
        return { outcome: 'not_found', error: 'Candidatura não informada.' };
      }

      const { data, error } = await supabase.rpc('request_attendance_confirmation', {
        p_application_id: applicationId,
      });

      if (error) {
        logError('attendanceConfirmation.requestConfirmation', error as SupabaseErrorLike);
        return { outcome: 'not_found', error: 'Não foi possível pedir a confirmação de presença.' };
      }

      const result = (data ?? {}) as AttendanceConfirmationRpcResult;
      const outcome = (result.outcome ?? 'not_found') as AttendanceConfirmationOutcome;

      if (outcome === 'requested') {
        return { outcome, requestCount: result.request_count };
      }
      if (outcome === 'cooldown') {
        return { outcome, retryAfter: result.retry_after, error: translateOutcome(outcome) };
      }

      return { outcome, error: translateOutcome(outcome) };
    } catch (err) {
      logError('attendanceConfirmation.requestConfirmation', err);
      return { outcome: 'not_found', error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  // -------------------------------------------------------------------------
  // FREELA: responder (UM toque — "Sim, vou" / "Não vou poder")
  // -------------------------------------------------------------------------

  /**
   * Dispara `respond_attendance_confirmation`. Idempotente por construção (L8 — UPDATE atômico
   * na RPC): duplo toque/retry sempre devolve `already_responded` na segunda chamada, nunca
   * sobrescreve a primeira resposta.
   */
  async respondConfirmation(
    applicationId: string,
    response: AttendanceConfirmationResponse,
  ): Promise<RespondConfirmationResult> {
    try {
      if (!applicationId) {
        return { outcome: 'not_found', error: 'Candidatura não informada.' };
      }

      const { data, error } = await supabase.rpc('respond_attendance_confirmation', {
        p_application_id: applicationId,
        p_response: response,
      });

      if (error) {
        logError('attendanceConfirmation.respondConfirmation', error as SupabaseErrorLike);
        return { outcome: 'not_found', error: 'Não foi possível registrar sua resposta.' };
      }

      const result = (data ?? {}) as AttendanceConfirmationRpcResult;
      const outcome = (result.outcome ?? 'not_found') as AttendanceConfirmationOutcome;

      if (outcome === 'confirmed' || outcome === 'cannot_attend') {
        return { outcome };
      }

      return { outcome, error: translateOutcome(outcome) };
    } catch (err) {
      logError('attendanceConfirmation.respondConfirmation', err);
      return { outcome: 'not_found', error: err instanceof Error ? err.message : 'Erro inesperado.' };
    }
  },

  // -------------------------------------------------------------------------
  // Leitores — R5 (a leitura deixou de "vir junto com a application"; ADR, Negativas)
  // -------------------------------------------------------------------------

  /**
   * Todas as confirmações (pedidas + respondidas) de um turno, mais recentes primeiro.
   * Pode haver até 2 linhas por freela (auto + lembrete manual — cap de 2, L3): o agrupamento
   * por `worker_id`/`application_id` para exibir UM badge por freela é responsabilidade de quem
   * consome (`CompanyJobCandidates`), não deste service — mantemos a leitura crua e auditável.
   */
  async getConfirmationsForJob(jobId: string): Promise<ShiftAttendanceConfirmation[]> {
    try {
      if (!jobId) return [];

      const { data, error } = await supabase
        .from('shift_attendance_confirmations')
        .select('*')
        .eq('job_id', jobId)
        .order('requested_at', { ascending: false });

      if (error) {
        logError('attendanceConfirmation.getConfirmationsForJob', error);
        return [];
      }

      return (data ?? []) as ShiftAttendanceConfirmation[];
    } catch (err) {
      logError('attendanceConfirmation.getConfirmationsForJob', err);
      return [];
    }
  },

  /**
   * Pedidos PENDENTES (response IS NULL) do freela autenticado, um por `application_id` (o mais
   * recente quando há 2 pedidos abertos para o mesmo turno — auto + lembrete manual). A UI
   * (`MyJobs`) mostra UM card por turno, não um card por pedido.
   */
  async getMyPendingConfirmations(): Promise<ShiftAttendanceConfirmation[]> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('shift_attendance_confirmations')
        .select('*')
        .eq('worker_id', user.id)
        .is('response', null)
        .order('requested_at', { ascending: false });

      if (error) {
        logError('attendanceConfirmation.getMyPendingConfirmations', error);
        return [];
      }

      const seen = new Set<string>();
      const deduped: ShiftAttendanceConfirmation[] = [];
      for (const row of (data ?? []) as ShiftAttendanceConfirmation[]) {
        if (seen.has(row.application_id)) continue;
        seen.add(row.application_id);
        deduped.push(row);
      }
      return deduped;
    } catch (err) {
      logError('attendanceConfirmation.getMyPendingConfirmations', err);
      return [];
    }
  },
};
