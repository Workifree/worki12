/**
 * FinancialBIService — inteligência financeira da empresa (Slice 3, R13-R16).
 *
 * Implementa 4 queries derivadas de BI sobre escrow_transactions + jobs + applications.
 * Nenhuma view criada (decisão do architect: views não propagam RLS com segurança — spec Slice 3).
 *
 * BI-2: Gasto e horas por freela (real: checkout-checkin; fallback: jobs.estimated_hours).
 * BI-3: Ratio custo/hora + custo-%-faturamento (oculto se mês sem faturamento informado).
 * BI-4: Custo de no-show — heurística v1, ROTULADO COMO ESTIMATIVA.
 * BI-5: Flag de concentração de horas/dias por freela (risco de vínculo trabalhista).
 *
 * Contratos de dados (spec Slice 3):
 *  - Gasto = escrow_transactions WHERE status IN ('released','captured').
 *  - Carimbo: COALESCE(captured_at, released_at, created_at) — filtrar o mês por este.
 *  - Empresa da linha: company_wallet_id → wallets.user_id = companyId.
 *  - Freela: worker_wallet_id → wallets.user_id | application_id → applications.worker_id.
 *
 * Padrões do projeto:
 *  - supabase.from direto (Art. 5 — sem React Query).
 *  - Tipos à mão em types/index.ts (Art. 2).
 *  - Imports relativos (sem alias @/).
 *  - logError (nunca console.log).
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import type {
  AccumulatedSpend,
  SpendByWorker,
  CostRatio,
  NoShowCost,
  ConcentrationFlag,
} from '../types';

// ---------------------------------------------------------------------------
// Constantes de produto (BI-5 — limiar de concentração)
// Calibrar aqui sem migration.
// ---------------------------------------------------------------------------

/** Horas totais no período que sinalizam risco de vínculo. */
const CONCENTRATION_HOURS_THRESHOLD = 150;

/** Dias distintos no período que, combinados com as horas, sinalizam risco de vínculo. */
const CONCENTRATION_DAYS_THRESHOLD = 20;

// ---------------------------------------------------------------------------
// Helpers de período
// ---------------------------------------------------------------------------

export interface BIPeriod {
  /** Primeiro dia do mês (inclusive), ISO date string YYYY-MM-DD. */
  start: string;
  /** Primeiro dia do mês seguinte (exclusive), ISO date string YYYY-MM-DD. */
  end: string;
}

/** Retorna o período do mês corrente. */
export function currentMonthPeriod(now: Date = new Date()): BIPeriod {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const start = `${y}-${m}-01`;
  const next = new Date(y, now.getMonth() + 1, 1);
  const ny = next.getFullYear();
  const nm = String(next.getMonth() + 1).padStart(2, '0');
  const end = `${ny}-${nm}-01`;
  return { start, end };
}

/** Retorna um período customizado a partir de strings ISO date. */
export function customPeriod(start: string, end: string): BIPeriod {
  return { start, end };
}

// ---------------------------------------------------------------------------
// Tipos internos de linha bruta de escrow
// ---------------------------------------------------------------------------

interface EscrowRow {
  amount: number;
  captured_at: string | null;
  released_at: string | null;
  created_at: string;
  application_id: string | null;
  worker_wallet_id: string | null;
  job_id: string | null;
}

interface ApplicationRow {
  id: string;
  worker_id: string;
  job_id: string;
  status: string;
  worker_checkin_at: string | null;
  worker_checkout_at: string | null;
  invitation_response: string | null;
  invitation_expires_at: string | null;
}

interface JobRow {
  id: string;
  start_date: string;
  estimated_hours: number | null;
}

interface WorkerProfileRow {
  id: string;
  full_name: string;
  avatar_url: string | null;
  photo_url: string | null;
}

// ---------------------------------------------------------------------------
// Helper: buscar wallet_id da empresa
// ---------------------------------------------------------------------------

async function getCompanyWalletId(companyId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('wallets')
    .select('id')
    .eq('user_id', companyId)
    .maybeSingle();
  if (error) {
    logError('financialBI.getCompanyWalletId', error);
    return null;
  }
  return (data?.id as string | null) ?? null;
}

// ---------------------------------------------------------------------------
// Helper: filtrar linha de escrow pelo período (JS-side, PostgREST não suporta COALESCE)
// ---------------------------------------------------------------------------

function isInPeriod(row: EscrowRow, startDate: Date, endDate: Date): boolean {
  const stamp = new Date(
    row.captured_at ?? row.released_at ?? row.created_at,
  );
  return stamp >= startDate && stamp < endDate;
}

// ---------------------------------------------------------------------------
// FinancialBIService (exportado)
// ---------------------------------------------------------------------------

export const FinancialBIService = {
  // -------------------------------------------------------------------------
  // BI-1: Gasto acumulado do período
  // -------------------------------------------------------------------------

  /**
   * Computa o gasto acumulado da empresa no período (BI-1).
   * Fonte: escrow_transactions WHERE status IN ('released','captured'),
   * filtrado pelo carimbo COALESCE(captured_at, released_at, created_at).
   */
  async getAccumulatedSpend(companyId: string, period: BIPeriod): Promise<AccumulatedSpend> {
    const empty: AccumulatedSpend = {
      totalAmount: 0,
      periodStart: period.start,
      periodEnd: period.end,
    };

    try {
      const walletId = await getCompanyWalletId(companyId);
      if (!walletId) return empty;

      const { data: rows, error } = await supabase
        .from('escrow_transactions')
        .select('amount, captured_at, released_at, created_at')
        .eq('company_wallet_id', walletId)
        .in('status', ['released', 'captured']);

      if (error) {
        logError('financialBI.getAccumulatedSpend', error);
        return empty;
      }

      const startDate = new Date(period.start);
      const endDate = new Date(period.end);
      let totalAmount = 0;

      for (const row of (rows ?? []) as EscrowRow[]) {
        if (isInPeriod(row, startDate, endDate)) {
          totalAmount += Number(row.amount ?? 0);
        }
      }

      return { totalAmount, periodStart: period.start, periodEnd: period.end };
    } catch (err) {
      logError('financialBI.getAccumulatedSpend', err);
      return empty;
    }
  },

  // -------------------------------------------------------------------------
  // BI-2: Gasto e horas por freela no período
  // -------------------------------------------------------------------------

  /**
   * Gasto e horas por freela no período (BI-2).
   *
   * Horas reais quando houver worker_checkout_at e worker_checkin_at em applications.
   * Fallback: jobs.estimated_hours do turno concluído.
   * hoursSource = 'real' | 'estimated' | 'mixed' (por freela no período).
   *
   * Agrupa por worker_id (via application_id → applications.worker_id).
   */
  async getSpendByWorker(companyId: string, period: BIPeriod): Promise<SpendByWorker[]> {
    try {
      const walletId = await getCompanyWalletId(companyId);
      if (!walletId) return [];

      // 1. Linhas de escrow no período (com application_id para join)
      const { data: escrowRows, error: escrowErr } = await supabase
        .from('escrow_transactions')
        .select('amount, captured_at, released_at, created_at, application_id, job_id')
        .eq('company_wallet_id', walletId)
        .in('status', ['released', 'captured'])
        .not('application_id', 'is', null);

      if (escrowErr) {
        logError('financialBI.getSpendByWorker.escrow', escrowErr);
        return [];
      }

      const startDate = new Date(period.start);
      const endDate = new Date(period.end);

      // Filtrar pelo período
      const inPeriod = ((escrowRows ?? []) as EscrowRow[]).filter((r) =>
        isInPeriod(r, startDate, endDate),
      );

      if (inPeriod.length === 0) return [];

      // 2. Buscar applications (check-in/out + worker_id) para os application_ids do período
      const appIds = [...new Set(inPeriod.map((r) => r.application_id as string))];
      const jobIds = [...new Set(inPeriod.map((r) => r.job_id).filter(Boolean) as string[])];

      const [appResult, jobResult] = await Promise.all([
        supabase
          .from('applications')
          .select('id, worker_id, job_id, worker_checkin_at, worker_checkout_at, status')
          .in('id', appIds),
        jobIds.length > 0
          ? supabase
              .from('jobs')
              .select('id, estimated_hours')
              .in('id', jobIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (appResult.error) {
        logError('financialBI.getSpendByWorker.apps', appResult.error);
        return [];
      }
      if (jobResult.error) {
        logError('financialBI.getSpendByWorker.jobs', jobResult.error);
      }

      const appMap = new Map<string, ApplicationRow>(
        ((appResult.data ?? []) as ApplicationRow[]).map((a) => [a.id, a]),
      );
      const jobMap = new Map<string, JobRow>(
        ((jobResult.data ?? []) as JobRow[]).map((j) => [j.id, j]),
      );

      // Coletar worker_ids únicos
      const workerIds = [...new Set(
        appIds
          .map((aid) => appMap.get(aid)?.worker_id)
          .filter(Boolean) as string[],
      )];

      if (workerIds.length === 0) return [];

      // 3. Buscar perfis dos workers
      const { data: workers, error: workerErr } = await supabase
        .from('workers')
        .select('id, full_name, avatar_url, photo_url')
        .in('id', workerIds);

      if (workerErr) {
        logError('financialBI.getSpendByWorker.workers', workerErr);
      }

      const workerMap = new Map<string, WorkerProfileRow>(
        ((workers ?? []) as WorkerProfileRow[]).map((w) => [w.id, w]),
      );

      // 4. Agregar por worker
      interface WorkerAgg {
        totalAmount: number;
        totalHours: number;
        realHoursCount: number;
        estimatedHoursCount: number;
        shiftsCount: number;
      }

      const agg = new Map<string, WorkerAgg>();

      for (const row of inPeriod) {
        const app = appMap.get(row.application_id as string);
        if (!app) continue;

        const workerId = app.worker_id;
        if (!agg.has(workerId)) {
          agg.set(workerId, {
            totalAmount: 0,
            totalHours: 0,
            realHoursCount: 0,
            estimatedHoursCount: 0,
            shiftsCount: 0,
          });
        }
        const entry = agg.get(workerId)!;
        entry.totalAmount += Number(row.amount ?? 0);
        entry.shiftsCount += 1;

        // Horas: real se houver check-in/out; fallback estimated_hours
        if (app.worker_checkin_at && app.worker_checkout_at) {
          const hours =
            (new Date(app.worker_checkout_at).getTime() -
              new Date(app.worker_checkin_at).getTime()) /
            3_600_000;
          entry.totalHours += hours;
          entry.realHoursCount += 1;
        } else {
          const job = row.job_id ? jobMap.get(row.job_id) : undefined;
          const estimated = job?.estimated_hours ?? 0;
          entry.totalHours += estimated;
          entry.estimatedHoursCount += 1;
        }
      }

      // 5. Montar resultado
      const result: SpendByWorker[] = [];
      for (const [workerId, data] of agg.entries()) {
        const worker = workerMap.get(workerId);
        let hoursSource: SpendByWorker['hoursSource'] = 'estimated';
        if (data.realHoursCount > 0 && data.estimatedHoursCount === 0) {
          hoursSource = 'real';
        } else if (data.realHoursCount > 0 && data.estimatedHoursCount > 0) {
          hoursSource = 'mixed';
        }

        result.push({
          workerId,
          workerName: worker?.full_name ?? 'Worker',
          workerAvatarUrl: worker?.avatar_url ?? worker?.photo_url ?? null,
          totalAmount: data.totalAmount,
          totalHours: data.totalHours,
          hoursSource,
          shiftsCount: data.shiftsCount,
        });
      }

      // Ordenar por gasto descendente
      result.sort((a, b) => b.totalAmount - a.totalAmount);
      return result;
    } catch (err) {
      logError('financialBI.getSpendByWorker', err);
      return [];
    }
  },

  // -------------------------------------------------------------------------
  // BI-3: Ratio custo/hora + custo-%-faturamento
  // -------------------------------------------------------------------------

  /**
   * Computa o ratio de custo (BI-3).
   * costPerHour = totalCost / totalHours (null se horas = 0).
   * costPercentRevenue = totalCost / faturamento declarado (null se não informado → exibir CTA).
   *
   * @param spendByWorker Resultado de getSpendByWorker (evita recompute).
   * @param totalCost     Gasto total (de getAccumulatedSpend).
   * @param companyId     Para buscar faturamento declarado.
   * @param yearMonth     Mês do período (Date ou YYYY-MM-DD).
   */
  async getCostRatio(
    spendByWorker: SpendByWorker[],
    totalCost: number,
    companyId: string,
    yearMonth: Date | string,
  ): Promise<CostRatio> {
    try {
      const totalHours = spendByWorker.reduce((acc, w) => acc + w.totalHours, 0);
      const costPerHour = totalHours > 0 ? totalCost / totalHours : null;

      // Normalizar year_month para o dia 1
      const ym =
        typeof yearMonth === 'string'
          ? yearMonth.slice(0, 7) + '-01'
          : `${yearMonth.getFullYear()}-${String(yearMonth.getMonth() + 1).padStart(2, '0')}-01`;

      const { data: revRow, error: revErr } = await supabase
        .from('company_monthly_revenue')
        .select('amount')
        .eq('company_id', companyId)
        .eq('year_month', ym)
        .maybeSingle();

      if (revErr) {
        logError('financialBI.getCostRatio.revenue', revErr);
      }

      const declaredRevenue =
        revRow != null ? Number((revRow as { amount: number }).amount) : null;
      const costPercentRevenue =
        declaredRevenue != null && declaredRevenue > 0
          ? (totalCost / declaredRevenue) * 100
          : null;

      return { costPerHour, totalCost, totalHours, costPercentRevenue, declaredRevenue };
    } catch (err) {
      logError('financialBI.getCostRatio', err);
      return {
        costPerHour: null,
        totalCost,
        totalHours: 0,
        costPercentRevenue: null,
        declaredRevenue: null,
      };
    }
  },

  // -------------------------------------------------------------------------
  // BI-4: Custo de no-show (heurística v1)
  // -------------------------------------------------------------------------

  /**
   * Estima o custo de no-show no período (BI-4 — HEURÍSTICA V1, ROTULADO COMO ESTIMATIVA).
   *
   * Heurística: application com invitation_response='accepted' (ou status='hired') cujo
   * turno já passou (jobs.start_date < now) E sem worker_checkout_at E sem conclusão.
   *
   * No postpago, o no-show antes da captura resulta em hold liberado (custo real = 0).
   * O estimatedAmount expõe o custo de oportunidade (valor do turno que não aconteceu).
   *
   * GAP sinalizado: sem coluna explícita no_show na v1. Se o piloto exigir precisão,
   * escalar para architect → marcador explícito de no-show em applications (migration menor).
   */
  async getNoShowCost(companyId: string, period: BIPeriod): Promise<NoShowCost> {
    const empty: NoShowCost = { estimatedCount: 0, estimatedAmount: 0, isEstimate: true };

    try {
      // Buscar jobs da empresa no período
      const { data: jobs, error: jobsErr } = await supabase
        .from('jobs')
        .select('id, start_date, budget')
        .eq('company_id', companyId)
        .gte('start_date', period.start)
        .lt('start_date', period.end);

      if (jobsErr) {
        logError('financialBI.getNoShowCost.jobs', jobsErr);
        return empty;
      }

      if (!jobs || jobs.length === 0) return empty;

      const now = new Date();
      const pastJobIds = (jobs as Array<{ id: string; start_date: string; budget: number }>)
        .filter((j) => new Date(j.start_date) < now)
        .map((j) => j.id);

      if (pastJobIds.length === 0) return empty;

      const jobBudgetMap = new Map<string, number>(
        (jobs as Array<{ id: string; budget: number }>).map((j) => [j.id, Number(j.budget ?? 0)]),
      );

      // Buscar applications de turnos passados da empresa que podem ser no-show
      const { data: apps, error: appsErr } = await supabase
        .from('applications')
        .select('id, job_id, status, worker_checkout_at, invitation_response')
        .in('job_id', pastJobIds)
        .in('status', ['hired', 'in_progress'])
        .is('worker_checkout_at', null);

      if (appsErr) {
        logError('financialBI.getNoShowCost.apps', appsErr);
        return empty;
      }

      // Filtrar: convite aceito (invitation_response='accepted' ou status='hired') sem checkout
      const noShows = ((apps ?? []) as Pick<
        ApplicationRow,
        'id' | 'job_id' | 'status' | 'worker_checkout_at' | 'invitation_response'
      >[]).filter(
        (a) =>
          a.invitation_response === 'accepted' ||
          a.status === 'hired' ||
          a.status === 'in_progress',
      );

      let estimatedAmount = 0;
      for (const ns of noShows) {
        estimatedAmount += jobBudgetMap.get(ns.job_id) ?? 0;
      }

      return {
        estimatedCount: noShows.length,
        estimatedAmount,
        isEstimate: true,
      };
    } catch (err) {
      logError('financialBI.getNoShowCost', err);
      return empty;
    }
  },

  // -------------------------------------------------------------------------
  // BI-5: Flag de concentração de horas/dias por freela (risco de vínculo)
  // -------------------------------------------------------------------------

  /**
   * Identifica freelas com horas/dias concentrados no período (BI-5).
   * Flag quando AMBOS os limiares (CONCENTRATION_HOURS_THRESHOLD e CONCENTRATION_DAYS_THRESHOLD)
   * são cruzados por um freela.
   *
   * Horas: reutiliza getSpendByWorker (se fornecido) ou recomputa.
   * Dias distintos: COUNT(DISTINCT date(jobs.start_date)) em turnos concluídos da empresa.
   *
   * Limiares (constantes de produto no topo do arquivo, não no banco):
   *  CONCENTRATION_HOURS_THRESHOLD = 150h
   *  CONCENTRATION_DAYS_THRESHOLD  = 20 dias
   */
  async getConcentrationFlags(
    companyId: string,
    period: BIPeriod,
    spendByWorker?: SpendByWorker[],
  ): Promise<ConcentrationFlag[]> {
    try {
      // Usar spendByWorker fornecido ou computar
      const workerSpend = spendByWorker ?? (await FinancialBIService.getSpendByWorker(companyId, period));

      if (workerSpend.length === 0) return [];

      const workerIds = workerSpend.map((w) => w.workerId);

      // Buscar applications concluídas da empresa para os workers no período
      // (aplicações com status 'completed' ou 'in_progress' com checkout)
      const { data: jobs, error: jobsErr } = await supabase
        .from('jobs')
        .select('id, start_date')
        .eq('company_id', companyId)
        .gte('start_date', period.start)
        .lt('start_date', period.end);

      if (jobsErr) {
        logError('financialBI.getConcentrationFlags.jobs', jobsErr);
        return [];
      }

      if (!jobs || jobs.length === 0) return [];

      const jobIds = (jobs as Array<{ id: string; start_date: string }>).map((j) => j.id);
      const jobDateMap = new Map<string, string>(
        (jobs as Array<{ id: string; start_date: string }>).map((j) => [j.id, j.start_date]),
      );

      const { data: apps, error: appsErr } = await supabase
        .from('applications')
        .select('worker_id, job_id, status')
        .in('job_id', jobIds)
        .in('worker_id', workerIds)
        .in('status', ['completed', 'in_progress', 'hired']);

      if (appsErr) {
        logError('financialBI.getConcentrationFlags.apps', appsErr);
        return [];
      }

      // Agregar dias distintos por worker
      const daysMap = new Map<string, Set<string>>();
      for (const app of (apps ?? []) as Array<{ worker_id: string; job_id: string; status: string }>) {
        const startDate = jobDateMap.get(app.job_id);
        if (!startDate) continue;
        const dayStr = startDate.slice(0, 10); // YYYY-MM-DD
        if (!daysMap.has(app.worker_id)) daysMap.set(app.worker_id, new Set());
        daysMap.get(app.worker_id)!.add(dayStr);
      }

      // Montar flags
      const flags: ConcentrationFlag[] = [];
      for (const ws of workerSpend) {
        const distinctDays = daysMap.get(ws.workerId)?.size ?? 0;
        const flagged =
          ws.totalHours >= CONCENTRATION_HOURS_THRESHOLD &&
          distinctDays >= CONCENTRATION_DAYS_THRESHOLD;

        flags.push({
          workerId: ws.workerId,
          workerName: ws.workerName,
          totalHours: ws.totalHours,
          distinctDays,
          flagged,
          hoursThreshold: CONCENTRATION_HOURS_THRESHOLD,
          daysThreshold: CONCENTRATION_DAYS_THRESHOLD,
        });
      }

      // Flagged primeiro, depois ordenado por horas descendente
      flags.sort((a, b) => {
        if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
        return b.totalHours - a.totalHours;
      });

      return flags;
    } catch (err) {
      logError('financialBI.getConcentrationFlags', err);
      return [];
    }
  },

  // -------------------------------------------------------------------------
  // Conveniência: todos os BI de uma vez (para o hook useFinancialBI)
  // -------------------------------------------------------------------------

  /**
   * Computa todos os indicadores do período de uma vez.
   * Reutiliza getSpendByWorker entre BI-2, BI-3 e BI-5 para evitar queries duplas.
   *
   * @param companyId UUID da empresa.
   * @param period    Período (usar currentMonthPeriod() ou customPeriod()).
   */
  async getAllBI(
    companyId: string,
    period: BIPeriod,
  ): Promise<{
    accumulatedSpend: AccumulatedSpend;
    spendByWorker: SpendByWorker[];
    costRatio: CostRatio;
    noShowCost: NoShowCost;
    concentrationFlags: ConcentrationFlag[];
  }> {
    // Computar em paralelo onde não há dependência
    const [accumulatedSpend, spendByWorker, noShowCost] = await Promise.all([
      FinancialBIService.getAccumulatedSpend(companyId, period),
      FinancialBIService.getSpendByWorker(companyId, period),
      FinancialBIService.getNoShowCost(companyId, period),
    ]);

    // BI-3 e BI-5 dependem de spendByWorker
    const [costRatio, concentrationFlags] = await Promise.all([
      FinancialBIService.getCostRatio(
        spendByWorker,
        accumulatedSpend.totalAmount,
        companyId,
        period.start,
      ),
      FinancialBIService.getConcentrationFlags(companyId, period, spendByWorker),
    ]);

    return { accumulatedSpend, spendByWorker, costRatio, noShowCost, concentrationFlags };
  },
};
