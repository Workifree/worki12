/**
 * LinkRiskService — Guarda de risco de vínculo trabalhista (F5).
 *
 * Spec: `.harness/spec/guarda-vinculo/spec.md` (R3 e R5 REPROVADOS pelo gate — ver DDL/ADR).
 * DDL aprovado (fonte normativa): `.harness/spec/guarda-vinculo/ddl-aprovado.md`.
 * ADR: `.harness/memory-bank/decisions/ADR-20260818-guarda-vinculo-contagem-no-banco.md`.
 * Migration: `supabase/migrations/20260817000900_link_risk_guard.sql`.
 *
 * DIVISÃO DE RESPONSABILIDADE COM O BANCO — o ponto mais importante deste arquivo:
 *
 *   A contagem (fuso, janela dom-sáb, soft delete, ancoragem dupla de empresa) mora INTEIRA na
 *   RPC `count_worker_shifts_by_week` (SECURITY DEFINER). Este service NUNCA recalcula a janela
 *   de semana nem filtra status no client — ele só chama a RPC e traduz o resultado num `Map`.
 *   `localWeekStartKey`/`weekRangeLabel` (`components/company/seriesWeekRisk.ts`) seguem existindo
 *   só para RÓTULO (exibição), não para decidir o que conta.
 *
 * Este serviço é SOMENTE LEITURA e nunca bloqueia nada (R6/A7 do spec): erro de qualquer tipo
 * degrada para "sem selo" (Map vazio) + `logError`, nunca lança para a UI. A regra de "quando
 * avisar" (prospectivo = contagem + 1 > threshold) mora no CLIENTE que consome este service
 * (`ShiftCallModal`/`InviteSeriesModal`), não aqui — este arquivo só entrega o número.
 *
 * LM-3 do DDL aprovado: autorização negada na RPC (turno de outra empresa) levanta EXCEÇÃO, não
 * devolve zero. Aqui isso vira `error` no retorno do supabase-js — tratamos como "não consegui
 * verificar" (log + Map vazio), nunca como "está tudo bem" silencioso.
 *
 * LM-5: se a migration ainda não foi aplicada em produção (deploy do frontend adiantado), a RPC
 * não existe no schema cache e o PostgREST devolve o código `PGRST202`. Degradar para "sem selo",
 * nunca quebrar a tela — o disparo do chamado/convite segue funcionando (A7).
 *
 * Padrão do projeto: `useState`/`useEffect` + supabase direto (Article 5), erros por retorno
 * estruturado (nunca throw para a UI), `logError` para diagnóstico.
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface LinkRiskConfig {
  enabled: boolean;
  threshold: number;
}

/** Fallback quando `my_link_risk_config()` não responde — fail-safe na direção do aviso (LIGADO). */
export const DEFAULT_LINK_RISK_CONFIG: LinkRiskConfig = { enabled: true, threshold: 2 };

/** Formato mínimo devolvido pelo Postgres/PostgREST em erros de query/RPC do supabase-js. */
interface SupabaseErrorLike {
  message?: string;
  code?: string;
}

/** Uma linha crua devolvida por `count_worker_shifts_by_week`. */
interface WeekShiftCountRow {
  worker_id: string;
  week_start: string;
  shift_count: number;
}

/** Shape jsonb devolvido por `my_link_risk_config()`. */
interface LinkRiskConfigRpcResult {
  enabled?: boolean;
  threshold?: number;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * `PGRST202` = função não encontrada no schema cache do PostgREST (migration ainda não aplicada
 * no ambiente, ou nome/assinatura divergente). Distinto de qualquer outro erro (ex.: a RAISE
 * EXCEPTION de autorização da própria RPC, que chega como outro código/mensagem) — mas o
 * TRATAMENTO no client é o mesmo em ambos os casos desta feature: degradar sem quebrar a tela.
 */
function isMissingRpc(error: SupabaseErrorLike): boolean {
  return error.code === 'PGRST202' || /Could not find the function/i.test(error.message ?? '');
}

// ---------------------------------------------------------------------------
// LinkRiskService
// ---------------------------------------------------------------------------

export const LinkRiskService = {
  /**
   * Config do aviso da empresa da sessão. RPC `my_link_risk_config()` SEMPRE devolve uma linha
   * (fail-safe no banco) — o fallback aqui só cobre o caso de a chamada em si falhar
   * (rede, RPC ausente/LM-5, sessão inválida).
   */
  async getConfig(): Promise<LinkRiskConfig> {
    try {
      const { data, error } = await supabase.rpc('my_link_risk_config');

      if (error) {
        if (!isMissingRpc(error as SupabaseErrorLike)) {
          logError('linkRisk.getConfig', error);
        }
        return { ...DEFAULT_LINK_RISK_CONFIG };
      }

      const result = (data ?? {}) as LinkRiskConfigRpcResult;
      return {
        enabled: result.enabled !== false,
        threshold:
          typeof result.threshold === 'number' && result.threshold > 0
            ? result.threshold
            : DEFAULT_LINK_RISK_CONFIG.threshold,
      };
    } catch (err) {
      logError('linkRisk.getConfig', err);
      return { ...DEFAULT_LINK_RISK_CONFIG };
    }
  },

  /**
   * Modo âncora: contagem por freela na semana do turno-alvo, excluindo o próprio turno-alvo
   * (o "+1" prospectivo é responsabilidade de quem consome, R4). Usado pelo `ShiftCallModal` (F5).
   *
   * Erro de qualquer natureza (RPC ausente, autorização negada, rede) ⇒ Map vazio + logError.
   * Um Map vazio faz a UI não exibir nenhum selo — nunca "sem risco" implícito, porque quem
   * decide se avisa é o consumidor, e sem dado ele simplesmente não desenha nada (degradação,
   * não afirmação).
   */
  async countForShift(jobId: string, workerIds: string[]): Promise<Map<string, number>> {
    if (!jobId || workerIds.length === 0) return new Map();

    try {
      const { data, error } = await supabase.rpc('count_worker_shifts_by_week', {
        p_worker_ids: workerIds,
        p_anchor_job_id: jobId,
      });

      if (error) {
        if (!isMissingRpc(error as SupabaseErrorLike)) {
          logError('linkRisk.countForShift', error);
        }
        return new Map();
      }

      const rows = (data ?? []) as WeekShiftCountRow[];
      const result = new Map<string, number>();
      for (const row of rows) {
        result.set(row.worker_id, row.shift_count);
      }
      return result;
    } catch (err) {
      logError('linkRisk.countForShift', err);
      return new Map();
    }
  },

  /**
   * Modo intervalo: contagem por freela E por semana (chave `${workerId}|${weekStart}`) num
   * range de datas — sempre expandido para semanas inteiras pela própria RPC. Usado pelo
   * `InviteSeriesModal` (F3, refactor R10) para somar a carga preexistente do freela à carga
   * das ocorrências-alvo da série.
   */
  async countForRange(
    workerIds: string[],
    rangeStart: string,
    rangeEnd: string,
  ): Promise<Map<string, number>> {
    if (workerIds.length === 0 || !rangeStart || !rangeEnd) return new Map();

    try {
      const { data, error } = await supabase.rpc('count_worker_shifts_by_week', {
        p_worker_ids: workerIds,
        p_range_start: rangeStart,
        p_range_end: rangeEnd,
      });

      if (error) {
        if (!isMissingRpc(error as SupabaseErrorLike)) {
          logError('linkRisk.countForRange', error);
        }
        return new Map();
      }

      const rows = (data ?? []) as WeekShiftCountRow[];
      const result = new Map<string, number>();
      for (const row of rows) {
        result.set(`${row.worker_id}|${row.week_start}`, row.shift_count);
      }
      return result;
    } catch (err) {
      logError('linkRisk.countForRange', err);
      return new Map();
    }
  },
};
