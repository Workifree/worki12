/**
 * JobSeriesService — Escala Recorrente (F3): série-mãe (`job_series`) + geração EAGER de
 * ocorrências materializadas em `jobs`.
 *
 * Spec: `.harness/spec/escala-recorrente/spec.md` (R1, R3, R7, R9, R10, R11, R13).
 * Gate: `.harness/memory-bank/decisions/ADR-20260817-serie-eager-e-cancelamento-suave.md`.
 * Migration: `supabase/migrations/20260817000400_job_series.sql`.
 *
 * DIVISÃO DE RESPONSABILIDADE COM O BANCO — o ponto mais importante deste arquivo:
 *
 *   `create_job_series`, `update_job_series_future` e `stop_job_series` são as ÚNICAS operações
 *   de escrita em massa (ADR, decisão 4: corrida check-then-act sobre até 60 linhas + predicado-
 *   guarda que não pode depender de RLS). Este service NUNCA lê `jobs`/`applications`/
 *   `shift_calls` para "decidir quem tocar" — ele monta os parâmetros e reage ao `outcome` da
 *   RPC, exatamente como `ShiftCallService` reage ao `outcome` de `claim_shift_slot`.
 *
 * Datas de ocorrência (`occurrenceDates`) vêm PRONTAS do client (`lib/recurrence.ts`,
 * `generateOccurrenceDates`) — este service não recalcula (ADR, "Alternativas rejeitadas": SQL
 * puro tiraria a regra do alcance dos testes unitários).
 *
 * Landmines do architect relevantes aqui (ver migration para o detalhe completo):
 * - LM-12: `createSeries` traduz um erro `23505` (unique violation) para "Essa série já foi
 *   criada." em vez de repassar o erro cru do Postgres — ISSO é o que o teste cobre. O que o
 *   23505 realmente cobre HOJE (corrigido após revisão pós-implementação, F3): o índice único
 *   `(series_id, series_occurrence_date)` só protege contra DATAS DUPLICADAS DENTRO DO MESMO
 *   lote de uma chamada — não contra duplo-clique no botão "Criar". Cada chamada de
 *   `create_job_series` cria um `job_series` NOVO (id gerado no banco), então duas submissões
 *   idênticas (duplo-clique) geram DUAS séries com `series_id` diferentes e o índice NUNCA
 *   colide entre elas — o duplo-clique hoje produz 2 séries + 2N turnos, sem erro. A defesa
 *   contra duplo-clique é só de UI (`disabled={loading}` na página, fora deste service) — ver
 *   `20260817000400_job_series.sql` para a análise completa.
 * - LM-15: `p_job_template` viaja como jsonb (não parâmetros `text` individuais) — a RPC usa
 *   `jsonb_populate_record`, que resolve o cast de `work_start_time`/`work_end_time` (`time`)
 *   pela função de entrada da própria coluna.
 *
 * PRÉVIA (dry-run): `previewUpdateFutureOccurrences`/`previewStopSeries` chamam as MESMAS RPCs
 * de `updateFutureOccurrences`/`stopSeries` com `p_dry_run=true` — mesmo predicado, sem escrever
 * nada. Métodos SEPARADOS (não um parâmetro extra nos dois já existentes) porque a assinatura
 * `updateFutureOccurrences(seriesId, fromDate, patch)`/`stopSeries(seriesId, fromDate?)` é
 * contrato congelado consumido pela UI em paralelo — não alterar.
 *
 * Padrão do projeto: `useState`/`useEffect` + supabase direto (Article 5), erros por retorno
 * estruturado (nunca throw para a UI), `logError` para diagnóstico.
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { MAX_SERIES_OCCURRENCES } from '../lib/recurrence';
import type { JobSeries, RecurrenceType } from '../types';

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

/**
 * Campos herdados por TODA ocorrência da série (R3). `budget`/`budget_type` só entram aqui —
 * na CRIAÇÃO — nunca em `updateFutureOccurrences` (R11: valor é imutável pós-criação).
 */
export interface JobSeriesTemplate {
  title: string;
  category: string;
  type?: string;
  description?: string;
  requirements?: string;
  briefing?: string;
  location: string;
  budget: number;
  budget_type: string;
  work_start_time: string;
  work_end_time: string;
  has_lunch?: boolean;
  slots: number;
  scope?: string;
}

export interface CreateJobSeriesParams {
  recurrenceType: RecurrenceType;
  /** Obrigatório e não-vazio quando `recurrenceType === 'weekly'`. Ignorado quando 'daily'. */
  weekdays?: number[];
  rangeStartDate: string;
  rangeEndDate: string;
  /** Já calculadas por `generateOccurrenceDates` (client) — este service não recalcula. */
  occurrenceDates: string[];
  jobTemplate: JobSeriesTemplate;
}

export interface CreateJobSeriesResult {
  seriesId: string | null;
  occurrences: number;
  error?: string;
}

export interface UpdateFutureOccurrencesResult {
  updated: number;
  skippedFilled: number;
  skippedCalled: number;
  error?: string;
}

export interface StopSeriesResult {
  cancelled: number;
  skippedFilled: number;
  skippedCalled: number;
  error?: string;
}

/**
 * Prévia (dry-run) de `updateFutureOccurrences` — MESMO predicado/RPC, sem escrever nada.
 * Métodos separados (em vez de sobrecarregar `updateFutureOccurrences`/`stopSeries` com mais um
 * parâmetro) de propósito: o contrato congelado dessas duas (`{updated,skippedFilled,
 * skippedCalled,error?}` / `{cancelled,...}`) já está sendo consumido pela UI em paralelo — não
 * mexer na assinatura existente evita quebrar esse trabalho em andamento.
 */
export interface PreviewUpdateFutureOccurrencesResult {
  wouldUpdate: number;
  skippedFilled: number;
  skippedCalled: number;
  error?: string;
}

/** Prévia (dry-run) de `stopSeries` — mesmo raciocínio de `PreviewUpdateFutureOccurrencesResult`. */
export interface PreviewStopSeriesResult {
  wouldCancel: number;
  skippedFilled: number;
  skippedCalled: number;
  error?: string;
}

/** Formato mínimo devolvido pelo Postgres em erros de query/RPC do supabase-js. */
interface SupabaseErrorLike {
  code?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Obtém o `company_id` da sessão autenticada.
 * (Mesmo helper duplicado em `shiftCallService.ts`/`shiftInviteService.ts`/`teamListService.ts`
 * — o projeto não usa um módulo compartilhado de sessão de empresa, de propósito: services
 * independentes.)
 */
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
  // Ancoragem dupla (ver 20260816210000): sem perfil em `companies`, o uid do dono já É o
  // company_id válido nas policies de `jobs`/`job_series`.
  return (company?.id as string | undefined) ?? user.id;
}

/** Traduz o `outcome` estruturado das RPCs em mensagem de erro para a UI. */
const OUTCOME_ERRORS: Record<string, string> = {
  unauthenticated: 'Sessão expirada. Faça login novamente.',
  no_occurrences: 'Nenhuma ocorrência no intervalo selecionado.',
  cap_exceeded: `O intervalo geraria mais turnos que o limite de ${MAX_SERIES_OCCURRENCES}.`,
  invalid_recurrence_type: 'Tipo de recorrência inválido.',
  invalid_weekdays: 'Selecione ao menos um dia da semana.',
  not_found: 'Série não encontrada.',
  forbidden: 'Você não tem permissão sobre esta série.',
};

// ---------------------------------------------------------------------------
// JobSeriesService
// ---------------------------------------------------------------------------

export const JobSeriesService = {
  /**
   * Cria a série + materializa as ocorrências (`create_job_series`, transação única — LM-11:
   * não existe "desfazer a série se o lote falhar" porque não há dois passos para desfazer).
   *
   * R7: bloqueia ANTES de qualquer INSERT se `occurrenceDates.length > MAX_SERIES_OCCURRENCES`
   * — checagem no client (evita a viagem ao banco no caso comum); a RPC revalida do mesmo jeito
   * (defesa em profundidade), e o trigger de statement em `jobs` é a última linha.
   */
  async createSeries(params: CreateJobSeriesParams): Promise<CreateJobSeriesResult> {
    try {
      const { recurrenceType, weekdays, rangeStartDate, rangeEndDate, occurrenceDates, jobTemplate } =
        params;

      if (occurrenceDates.length === 0) {
        return { seriesId: null, occurrences: 0, error: OUTCOME_ERRORS.no_occurrences };
      }
      if (occurrenceDates.length > MAX_SERIES_OCCURRENCES) {
        return {
          seriesId: null,
          occurrences: 0,
          error: `O intervalo geraria ${occurrenceDates.length} turnos — o limite é ${MAX_SERIES_OCCURRENCES}. Encurte o período ou reduza os dias da semana.`,
        };
      }
      if (recurrenceType === 'weekly' && (!weekdays || weekdays.length === 0)) {
        return { seriesId: null, occurrences: 0, error: OUTCOME_ERRORS.invalid_weekdays };
      }

      const companyId = await getAuthCompanyId();

      const { data, error } = await supabase.rpc('create_job_series', {
        p_company_id: companyId,
        p_recurrence_type: recurrenceType,
        p_weekdays: recurrenceType === 'weekly' ? weekdays : null,
        p_range_start_date: rangeStartDate,
        p_range_end_date: rangeEndDate,
        p_occurrence_dates: occurrenceDates,
        p_job_template: jobTemplate,
      });

      if (error) {
        logError('jobSeries.createSeries', error);
        const err = error as SupabaseErrorLike;
        // LM-12: se um 23505 chegar aqui (datas duplicadas no MESMO lote — não protege contra
        // duplo-clique, ver cabeçalho do arquivo), mensagem específica, nunca "Erro ao salvar
        // turno" cru.
        if (err.code === '23505') {
          return { seriesId: null, occurrences: 0, error: 'Essa série já foi criada.' };
        }
        return { seriesId: null, occurrences: 0, error: 'Não foi possível criar a série de turnos.' };
      }

      const result = data as { outcome?: string; series_id?: string; occurrences?: number } | null;

      if (result?.outcome === 'ok' && result.series_id) {
        return { seriesId: result.series_id, occurrences: result.occurrences ?? occurrenceDates.length };
      }

      return {
        seriesId: null,
        occurrences: 0,
        error: OUTCOME_ERRORS[result?.outcome ?? ''] ?? 'Não foi possível criar a série de turnos.',
      };
    } catch (err) {
      logError('jobSeries.createSeries', err);
      return {
        seriesId: null,
        occurrences: 0,
        error: err instanceof Error ? err.message : 'Erro inesperado.',
      };
    }
  },

  /**
   * R11 "Este e os futuros": aplica `patch` (título/categoria/descrição/requisitos/briefing/
   * localização/horário/vagas — NUNCA `budget`) às ocorrências futuras sem freela ativo/convite
   * pendente/chamado aberto. O banco decide o que é "tocável" (`update_job_series_future`); este
   * método só repassa o `outcome`.
   */
  async updateFutureOccurrences(
    seriesId: string,
    fromDate: string,
    patch: Record<string, unknown>,
  ): Promise<UpdateFutureOccurrencesResult> {
    try {
      const { data, error } = await supabase.rpc('update_job_series_future', {
        p_series_id: seriesId,
        p_from_date: fromDate,
        p_patch: patch,
      });

      if (error) {
        logError('jobSeries.updateFutureOccurrences', error);
        return {
          updated: 0,
          skippedFilled: 0,
          skippedCalled: 0,
          error: 'Não foi possível atualizar os turnos futuros.',
        };
      }

      const result = data as
        | { outcome?: string; updated?: number; skipped_filled?: number; skipped_called?: number }
        | null;

      if (result?.outcome === 'ok') {
        return {
          updated: result.updated ?? 0,
          skippedFilled: result.skipped_filled ?? 0,
          skippedCalled: result.skipped_called ?? 0,
        };
      }

      return {
        updated: 0,
        skippedFilled: 0,
        skippedCalled: 0,
        error: OUTCOME_ERRORS[result?.outcome ?? ''] ?? 'Não foi possível atualizar os turnos futuros.',
      };
    } catch (err) {
      logError('jobSeries.updateFutureOccurrences', err);
      return {
        updated: 0,
        skippedFilled: 0,
        skippedCalled: 0,
        error: err instanceof Error ? err.message : 'Erro inesperado.',
      };
    }
  },

  /**
   * Prévia (dry-run) de `updateFutureOccurrences` — MESMA RPC, MESMO predicado, `p_dry_run=true`.
   * Não escreve nada. Serve para o gestor ver o impacto ("N turnos serão alterados") ANTES de
   * confirmar. Nunca calcular esta contagem no client: a RLS simples de `applications` faria o
   * número mentir para uma empresa ancorada só via `companies.owner_id` (mesmo motivo da RPC ser
   * DEFINER — ver migration, seção 4).
   */
  async previewUpdateFutureOccurrences(
    seriesId: string,
    fromDate: string,
    patch: Record<string, unknown>,
  ): Promise<PreviewUpdateFutureOccurrencesResult> {
    try {
      const { data, error } = await supabase.rpc('update_job_series_future', {
        p_series_id: seriesId,
        p_from_date: fromDate,
        p_patch: patch,
        p_dry_run: true,
      });

      if (error) {
        logError('jobSeries.previewUpdateFutureOccurrences', error);
        return {
          wouldUpdate: 0,
          skippedFilled: 0,
          skippedCalled: 0,
          error: 'Não foi possível calcular a prévia dos turnos futuros.',
        };
      }

      const result = data as
        | { outcome?: string; would_update?: number; skipped_filled?: number; skipped_called?: number }
        | null;

      if (result?.outcome === 'preview') {
        return {
          wouldUpdate: result.would_update ?? 0,
          skippedFilled: result.skipped_filled ?? 0,
          skippedCalled: result.skipped_called ?? 0,
        };
      }

      return {
        wouldUpdate: 0,
        skippedFilled: 0,
        skippedCalled: 0,
        error: OUTCOME_ERRORS[result?.outcome ?? ''] ?? 'Não foi possível calcular a prévia dos turnos futuros.',
      };
    } catch (err) {
      logError('jobSeries.previewUpdateFutureOccurrences', err);
      return {
        wouldUpdate: 0,
        skippedFilled: 0,
        skippedCalled: 0,
        error: err instanceof Error ? err.message : 'Erro inesperado.',
      };
    }
  },

  /**
   * R11 "Cancelar a série inteira": `job_series.status='stopped'` + soft delete
   * (`status='deleted'`, NUNCA `DELETE` — ver migration) das ocorrências futuras sem freela
   * ativo/convite pendente/chamado aberto. `fromDate` default = hoje (calculado no banco,
   * `America/Sao_Paulo`) quando omitido.
   */
  async stopSeries(seriesId: string, fromDate?: string): Promise<StopSeriesResult> {
    try {
      const { data, error } = await supabase.rpc('stop_job_series', {
        p_series_id: seriesId,
        p_from_date: fromDate ?? null,
      });

      if (error) {
        logError('jobSeries.stopSeries', error);
        return { cancelled: 0, skippedFilled: 0, skippedCalled: 0, error: 'Não foi possível cancelar a série.' };
      }

      const result = data as
        | { outcome?: string; cancelled?: number; skipped_filled?: number; skipped_called?: number }
        | null;

      if (result?.outcome === 'ok') {
        return {
          cancelled: result.cancelled ?? 0,
          skippedFilled: result.skipped_filled ?? 0,
          skippedCalled: result.skipped_called ?? 0,
        };
      }

      return {
        cancelled: 0,
        skippedFilled: 0,
        skippedCalled: 0,
        error: OUTCOME_ERRORS[result?.outcome ?? ''] ?? 'Não foi possível cancelar a série.',
      };
    } catch (err) {
      logError('jobSeries.stopSeries', err);
      return {
        cancelled: 0,
        skippedFilled: 0,
        skippedCalled: 0,
        error: err instanceof Error ? err.message : 'Erro inesperado.',
      };
    }
  },

  /**
   * Prévia (dry-run) de `stopSeries` — MESMA RPC, MESMO predicado, `p_dry_run=true`. Não marca
   * a série como `stopped` nem toca nenhum `jobs`. Mesmo raciocínio de
   * `previewUpdateFutureOccurrences`: a contagem tem que vir do banco, nunca do client.
   */
  async previewStopSeries(seriesId: string, fromDate?: string): Promise<PreviewStopSeriesResult> {
    try {
      const { data, error } = await supabase.rpc('stop_job_series', {
        p_series_id: seriesId,
        p_from_date: fromDate ?? null,
        p_dry_run: true,
      });

      if (error) {
        logError('jobSeries.previewStopSeries', error);
        return {
          wouldCancel: 0,
          skippedFilled: 0,
          skippedCalled: 0,
          error: 'Não foi possível calcular a prévia do cancelamento.',
        };
      }

      const result = data as
        | { outcome?: string; would_cancel?: number; skipped_filled?: number; skipped_called?: number }
        | null;

      if (result?.outcome === 'preview') {
        return {
          wouldCancel: result.would_cancel ?? 0,
          skippedFilled: result.skipped_filled ?? 0,
          skippedCalled: result.skipped_called ?? 0,
        };
      }

      return {
        wouldCancel: 0,
        skippedFilled: 0,
        skippedCalled: 0,
        error: OUTCOME_ERRORS[result?.outcome ?? ''] ?? 'Não foi possível calcular a prévia do cancelamento.',
      };
    } catch (err) {
      logError('jobSeries.previewStopSeries', err);
      return {
        wouldCancel: 0,
        skippedFilled: 0,
        skippedCalled: 0,
        error: err instanceof Error ? err.message : 'Erro inesperado.',
      };
    }
  },

  /** Séries da empresa autenticada, mais recentes primeiro. */
  async listSeries(): Promise<JobSeries[]> {
    try {
      const companyId = await getAuthCompanyId();

      const { data, error } = await supabase
        .from('job_series')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (error) {
        logError('jobSeries.listSeries', error);
        return [];
      }
      return (data ?? []) as JobSeries[];
    } catch (err) {
      logError('jobSeries.listSeries', err);
      return [];
    }
  },
};
