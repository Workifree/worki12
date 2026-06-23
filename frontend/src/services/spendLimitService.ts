/**
 * SpendLimitService — teto de gasto + alertas in-app (Slice 3, R12).
 *
 * Responsabilidades:
 *  1. CRUD do teto de gasto (company_spend_limits).
 *  2. CRUD do faturamento mensal declarado (company_monthly_revenue).
 *  3. evaluateSpendAlert — computa BI-1, compara com o teto, e insere alerta idempotente
 *     em `notifications` para o maior threshold cruzado ainda não alertado.
 *
 * Contratos do architect (spec Slice 3):
 *  - Gasto = escrow_transactions WHERE status IN ('released','captured').
 *  - Período: COALESCE(captured_at, released_at, created_at).
 *  - Empresa da linha: company_wallet_id → wallets.user_id = companyId.
 *  - Alerta NUNCA bloqueia contratação.
 *  - Idempotência via link='/company/financeiro?alert=<companyId>:<YYYYMM>:<threshold>'
 *    + SELECT LIMIT 1 antes do INSERT.
 *  - Dispara APENAS o maior threshold cruzado ainda não alertado no período.
 *  - Threshold >100% usa chave ':OVER'.
 *
 * Padrões do projeto:
 *  - Fetch: supabase.from direto (Art. 5 — sem React Query).
 *  - Tipos à mão em types/index.ts (Art. 2).
 *  - Imports relativos (sem alias @/).
 *  - logError (nunca console.log).
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import type { SpendLimit, MonthlyRevenue } from '../types';

// ---------------------------------------------------------------------------
// Helpers de período
// ---------------------------------------------------------------------------

/** Retorna o primeiro dia do mês de uma Date no formato ISO date (YYYY-MM-DD). */
function monthStart(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Retorna o primeiro dia do MÊS SEGUINTE de uma Date no formato ISO date. */
function nextMonthStart(d: Date): string {
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Formata YYYYMM a partir de uma Date (para a chave de idempotência de alerta). */
function yyyymm(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Helpers de query
// ---------------------------------------------------------------------------

/**
 * Calcula o gasto acumulado de uma empresa no mês corrente (BI-1).
 * Gasto = SUM(amount) de escrow_transactions com status IN ('released','captured')
 * filtrado pelo carimbo COALESCE(captured_at, released_at, created_at) dentro do mês.
 *
 * A empresa é identificada via company_wallet_id → wallets.user_id = companyId.
 *
 * @returns { totalAmount, periodStart, periodEnd } ou null em caso de erro.
 */
async function computeAccumulatedSpend(
  companyId: string,
  now: Date,
): Promise<{ totalAmount: number; periodStart: string; periodEnd: string } | null> {
  try {
    const ps = monthStart(now);
    const pe = nextMonthStart(now);

    // Buscar o wallet_id da empresa
    const { data: wallet, error: walletErr } = await supabase
      .from('wallets')
      .select('id')
      .eq('user_id', companyId)
      .maybeSingle();

    if (walletErr) {
      logError('spendLimit.computeAccumulatedSpend.wallet', walletErr);
      return null;
    }
    if (!wallet) return { totalAmount: 0, periodStart: ps, periodEnd: pe };

    // Soma do gasto efetivo (released + captured) no período
    // Filtra pelo carimbo: COALESCE(captured_at, released_at, created_at)
    // PostgREST não suporta COALESCE em filtros → buscar as linhas e filtrar em JS.
    // Volume esperado: dezenas/centenas por empresa por mês → ok.
    const { data: rows, error: escrowErr } = await supabase
      .from('escrow_transactions')
      .select('amount, captured_at, released_at, created_at')
      .eq('company_wallet_id', wallet.id)
      .in('status', ['released', 'captured']);

    if (escrowErr) {
      logError('spendLimit.computeAccumulatedSpend.escrow', escrowErr);
      return null;
    }

    const psDate = new Date(ps);
    const peDate = new Date(pe);
    let totalAmount = 0;

    for (const row of rows ?? []) {
      const stamp = new Date(
        (row.captured_at as string | null) ??
        (row.released_at as string | null) ??
        (row.created_at as string),
      );
      if (stamp >= psDate && stamp < peDate) {
        totalAmount += Number(row.amount ?? 0);
      }
    }

    return { totalAmount, periodStart: ps, periodEnd: pe };
  } catch (err) {
    logError('spendLimit.computeAccumulatedSpend', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// SpendLimitService (exportado)
// ---------------------------------------------------------------------------

export const SpendLimitService = {
  // -------------------------------------------------------------------------
  // CRUD — teto de gasto
  // -------------------------------------------------------------------------

  /**
   * Busca o teto de gasto mensal da empresa. Retorna null se não configurado.
   * scope '' (string vazia) = empresa inteira (NOT NULL DEFAULT '' — v1 single-store).
   */
  async getSpendLimit(companyId: string, scope: string = ''): Promise<SpendLimit | null> {
    try {
      const { data, error } = await supabase
        .from('company_spend_limits')
        .select('*')
        .eq('company_id', companyId)
        .eq('period', 'month')
        .eq('scope', scope)
        .maybeSingle();
      if (error) {
        logError('spendLimit.getSpendLimit', error);
        return null;
      }
      return (data as SpendLimit) ?? null;
    } catch (err) {
      logError('spendLimit.getSpendLimit', err);
      return null;
    }
  },

  /**
   * Cria ou atualiza o teto de gasto mensal da empresa (upsert idempotente).
   * Usa ON CONFLICT (company_id, period, scope) — scope NOT NULL DEFAULT ''.
   * scope = '' → teto da empresa inteira (v1 single-store).
   *
   * @returns SpendLimit atualizado ou null em caso de erro.
   */
  async upsertSpendLimit(
    companyId: string,
    params: {
      amount: number;
      alertThresholds?: number[];
      scope?: string;
      financialContactEmail?: string | null;
      financialContactPhone?: string | null;
    },
  ): Promise<SpendLimit | null> {
    try {
      const payload: Record<string, unknown> = {
        company_id: companyId,
        period: 'month',
        amount: params.amount,
        scope: params.scope ?? '',
      };
      if (params.alertThresholds !== undefined) {
        payload.alert_thresholds = params.alertThresholds;
      }
      if (params.financialContactEmail !== undefined) {
        payload.financial_contact_email = params.financialContactEmail;
      }
      if (params.financialContactPhone !== undefined) {
        payload.financial_contact_phone = params.financialContactPhone;
      }

      const { data, error } = await supabase
        .from('company_spend_limits')
        .upsert(payload, { onConflict: 'company_id,period,scope' })
        .select()
        .single();

      if (error) {
        logError('spendLimit.upsertSpendLimit', error);
        return null;
      }
      return data as SpendLimit;
    } catch (err) {
      logError('spendLimit.upsertSpendLimit', err);
      return null;
    }
  },

  // -------------------------------------------------------------------------
  // CRUD — faturamento mensal
  // -------------------------------------------------------------------------

  /**
   * Busca o faturamento declarado da empresa em um mês (year_month = DATE no dia 1).
   * Normaliza para o primeiro dia do mês automaticamente.
   *
   * @param yearMonth Date ou string YYYY-MM-DD (sempre normalizada para o dia 1).
   */
  async getMonthlyRevenue(
    companyId: string,
    yearMonth: Date | string,
  ): Promise<MonthlyRevenue | null> {
    try {
      const ym =
        typeof yearMonth === 'string'
          ? yearMonth.slice(0, 7) + '-01'
          : monthStart(yearMonth);

      const { data, error } = await supabase
        .from('company_monthly_revenue')
        .select('*')
        .eq('company_id', companyId)
        .eq('year_month', ym)
        .maybeSingle();

      if (error) {
        logError('spendLimit.getMonthlyRevenue', error);
        return null;
      }
      return (data as MonthlyRevenue) ?? null;
    } catch (err) {
      logError('spendLimit.getMonthlyRevenue', err);
      return null;
    }
  },

  /**
   * Cria ou atualiza o faturamento declarado do mês (upsert idempotente).
   * Normaliza year_month para o primeiro dia do mês.
   *
   * @param yearMonth Date ou string YYYY-MM-DD.
   * @param amount    Faturamento bruto BRL (>= 0).
   */
  async upsertMonthlyRevenue(
    companyId: string,
    yearMonth: Date | string,
    amount: number,
  ): Promise<MonthlyRevenue | null> {
    try {
      const ym =
        typeof yearMonth === 'string'
          ? yearMonth.slice(0, 7) + '-01'
          : monthStart(yearMonth);

      const { data, error } = await supabase
        .from('company_monthly_revenue')
        .upsert(
          { company_id: companyId, year_month: ym, amount },
          { onConflict: 'company_id,year_month' },
        )
        .select()
        .single();

      if (error) {
        logError('spendLimit.upsertMonthlyRevenue', error);
        return null;
      }
      return data as MonthlyRevenue;
    } catch (err) {
      logError('spendLimit.upsertMonthlyRevenue', err);
      return null;
    }
  },

  // -------------------------------------------------------------------------
  // Avaliação do alerta de teto (R12)
  // -------------------------------------------------------------------------

  /**
   * Avalia se o gasto acumulado do mês corrente cruzou algum threshold do teto.
   * Insere alerta idempotente em `notifications` para o MAIOR threshold cruzado
   * ainda não alertado no período.
   *
   * Regras (spec Slice 3 — contrato de ALERTA):
   *  - Dispara apenas o MAIOR threshold cruzado não-alertado (ex.: cruzou 92% → alerta 90%, não 80%).
   *  - Threshold >100% usa chave 'OVER'.
   *  - Idempotência: verifica SELECT LIMIT 1 por link antes do INSERT.
   *  - NUNCA bloqueia contratação (exceções capturadas silenciosamente — best-effort).
   *  - NÃO chama dentro de RPC de saldo (Article 8).
   *
   * @param companyId   UUID da empresa (= auth.uid() da empresa = wallets.user_id).
   * @param now         Data de referência (default: Date.now()). Injetável para testes.
   */
  async evaluateSpendAlert(companyId: string, now: Date = new Date()): Promise<void> {
    try {
      // 1. Buscar o teto configurado (scope = '' → empresa inteira, v1)
      const limit = await SpendLimitService.getSpendLimit(companyId);
      if (!limit || limit.amount <= 0) return; // Sem teto configurado → nada a fazer

      // 2. Calcular gasto acumulado do período
      const spend = await computeAccumulatedSpend(companyId, now);
      if (!spend) return; // Erro de query → best-effort, não bloqueia

      const { totalAmount } = spend;
      const percent = (totalAmount / limit.amount) * 100;

      // 3. Determinar o maior threshold cruzado
      //    Inclui 'OVER' se gasto > teto (>100%)
      const thresholds = [...(limit.alert_thresholds ?? [80, 90, 100])].sort((a, b) => a - b);

      let highestCrossed: number | 'OVER' | null = null;

      if (percent > 100) {
        highestCrossed = 'OVER';
      } else {
        for (const t of thresholds) {
          if (percent >= t) {
            highestCrossed = t;
          }
        }
      }

      if (highestCrossed === null) return; // Nenhum threshold cruzado

      // 4. Construir a chave de idempotência
      const periodKey = yyyymm(now);
      const thresholdKey = highestCrossed === 'OVER' ? 'OVER' : String(highestCrossed);
      const alertLink = `/company/financeiro?alert=${companyId}:${periodKey}:${thresholdKey}`;

      // 5. Resolver o owner da empresa (user_id para a notificação)
      //    Usa o financial_contact_email se disponível, mas notificação in-app vai pro owner.
      const { data: companyRow, error: companyErr } = await supabase
        .from('companies')
        .select('owner_id')
        .eq('id', companyId)
        .maybeSingle();

      if (companyErr || !companyRow) {
        logError('spendLimit.evaluateSpendAlert.company', companyErr ?? new Error('company not found'));
        return;
      }
      const ownerId = companyRow.owner_id as string;

      // 6. Verificar idempotência: já existe alerta com este link?
      //    notifications_user_id_idx cobre user_id (sem full-scan).
      const { data: existing, error: checkErr } = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', ownerId)
        .eq('link', alertLink)
        .limit(1)
        .maybeSingle();

      if (checkErr) {
        logError('spendLimit.evaluateSpendAlert.check', checkErr);
        return;
      }
      if (existing) return; // Alerta já enviado → idempotência

      // 7. Compor mensagem do alerta
      const percentFormatted = Math.round(percent);
      const amountFormatted = totalAmount.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      });
      const limitFormatted = limit.amount.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      });

      let title: string;
      let message: string;

      if (highestCrossed === 'OVER') {
        title = 'Teto de gasto ultrapassado';
        message =
          `Gasto mensal de ${amountFormatted} ultrapassou o teto de ${limitFormatted} ` +
          `(${percentFormatted}%). As contratações continuam funcionando normalmente.`;
      } else {
        title = `Alerta: ${highestCrossed}% do teto de gasto atingido`;
        message =
          `Gasto mensal de ${amountFormatted} atingiu ${percentFormatted}% do teto de ` +
          `${limitFormatted}. As contratações continuam funcionando normalmente.`;
      }

      // 8. Inserir notificação in-app
      const { error: insertErr } = await supabase.from('notifications').insert({
        user_id: ownerId,
        type: 'payment',
        title,
        message,
        link: alertLink,
      });

      if (insertErr) {
        logError('spendLimit.evaluateSpendAlert.insert', insertErr);
        // Best-effort — não propaga o erro para não quebrar o pagamento
      }
    } catch (err) {
      // NUNCA propaga — alerta é best-effort (spec: "Alerta NUNCA bloqueia")
      logError('spendLimit.evaluateSpendAlert', err);
    }
  },
};
