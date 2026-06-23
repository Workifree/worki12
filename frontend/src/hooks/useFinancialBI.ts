/**
 * Hooks de inteligência financeira — Slice 3 (R12-R16).
 *
 * useSpendLimit: CRUD do teto de gasto mensal da empresa + faturamento declarado.
 * useFinancialBI: todos os indicadores BI do período (BI-1 a BI-5) + avaliação de alerta on-demand.
 *
 * Padrões do projeto:
 *  - useState + useEffect + supabase.from direto (Art. 5 — sem React Query).
 *  - Tipos à mão em types/index.ts (Art. 2).
 *  - Imports relativos (sem alias @/).
 *  - logError (nunca console.log).
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { SpendLimitService } from '../services/spendLimitService';
import { FinancialBIService, currentMonthPeriod, type BIPeriod } from '../services/financialBIService';
import { logError } from '../lib/logger';
import type {
  SpendLimit,
  MonthlyRevenue,
  FinancialBIData,
} from '../types';

// ---------------------------------------------------------------------------
// useSpendLimit — CRUD do teto + faturamento
// ---------------------------------------------------------------------------

export interface UseSpendLimitResult {
  /** Teto configurado (null = não configurado). */
  spendLimit: SpendLimit | null;
  /** Faturamento declarado do mês de referência (null = não informado). */
  monthlyRevenue: MonthlyRevenue | null;
  loading: boolean;
  error: string | null;
  /**
   * Cria ou atualiza o teto de gasto mensal.
   * @returns true em caso de sucesso.
   */
  upsertSpendLimit: (params: {
    amount: number;
    alertThresholds?: number[];
    financialContactEmail?: string | null;
    financialContactPhone?: string | null;
  }) => Promise<boolean>;
  /**
   * Cria ou atualiza o faturamento declarado do mês.
   * @returns true em caso de sucesso.
   */
  upsertMonthlyRevenue: (amount: number, yearMonth?: Date | string) => Promise<boolean>;
  /** Recarregar dados. */
  refresh: () => void;
}

/**
 * Hook para EMPRESA — gerenciar teto de gasto e faturamento declarado.
 *
 * @param yearMonth Mês de referência para o faturamento (default: mês corrente).
 */
export function useSpendLimit(yearMonth?: Date | string): UseSpendLimitResult {
  const [spendLimit, setSpendLimit] = useState<SpendLimit | null>(null);
  const [monthlyRevenue, setMonthlyRevenue] = useState<MonthlyRevenue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const navigate = useNavigate();

  // Mês de referência estável
  const refMonth: Date | string = yearMonth ?? new Date();

  const load = useCallback(
    async (cid?: string) => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          navigate('/login');
          return;
        }

        setLoading(true);
        setError(null);

        let resolvedCompanyId = cid ?? companyId;
        if (!resolvedCompanyId) {
          const { data: company, error: cErr } = await supabase
            .from('companies')
            .select('id')
            .eq('owner_id', user.id)
            .maybeSingle();
          if (cErr) {
            logError('useSpendLimit.load.company', cErr);
            setError('Erro ao carregar dados da empresa.');
            setLoading(false);
            return;
          }
          if (!company) {
            setLoading(false);
            return;
          }
          resolvedCompanyId = company.id as string;
          setCompanyId(resolvedCompanyId);
        }

        const [limit, revenue] = await Promise.all([
          SpendLimitService.getSpendLimit(resolvedCompanyId),
          SpendLimitService.getMonthlyRevenue(resolvedCompanyId, refMonth),
        ]);

        setSpendLimit(limit);
        setMonthlyRevenue(revenue);
      } catch (err) {
        logError('useSpendLimit.load', err);
        setError('Erro ao carregar dados financeiros.');
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, companyId],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        navigate('/login');
        return;
      }

      setLoading(true);
      setError(null);

      const { data: company, error: cErr } = await supabase
        .from('companies')
        .select('id')
        .eq('owner_id', user.id)
        .maybeSingle();

      if (cErr || !company) {
        if (active) {
          setLoading(false);
          if (cErr) setError('Erro ao carregar dados da empresa.');
        }
        return;
      }

      const cid = company.id as string;
      if (active) setCompanyId(cid);

      const [limit, revenue] = await Promise.all([
        SpendLimitService.getSpendLimit(cid),
        SpendLimitService.getMonthlyRevenue(cid, refMonth),
      ]);

      if (!active) return;
      setSpendLimit(limit);
      setMonthlyRevenue(revenue);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const upsertSpendLimit = useCallback(
    async (params: {
      amount: number;
      alertThresholds?: number[];
      financialContactEmail?: string | null;
      financialContactPhone?: string | null;
    }): Promise<boolean> => {
      if (!companyId) return false;
      const result = await SpendLimitService.upsertSpendLimit(companyId, params);
      if (!result) return false;
      setSpendLimit(result);
      return true;
    },
    [companyId],
  );

  const upsertMonthlyRevenue = useCallback(
    async (amount: number, ym?: Date | string): Promise<boolean> => {
      if (!companyId) return false;
      const result = await SpendLimitService.upsertMonthlyRevenue(
        companyId,
        ym ?? refMonth,
        amount,
      );
      if (!result) return false;
      setMonthlyRevenue(result);
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companyId],
  );

  return {
    spendLimit,
    monthlyRevenue,
    loading,
    error,
    upsertSpendLimit,
    upsertMonthlyRevenue,
    refresh: () => void load(),
  };
}

// ---------------------------------------------------------------------------
// useFinancialBI — todos os indicadores do período
// ---------------------------------------------------------------------------

export interface UseFinancialBIResult {
  data: FinancialBIData | null;
  loading: boolean;
  error: string | null;
  /** company_id resolvido (necessário para ações da UI). */
  companyId: string;
  /** Recarregar dados + disparar avaliação de alerta on-demand. */
  refresh: () => void;
}

/**
 * Hook para EMPRESA — carregar todos os indicadores BI do período.
 * Avalia o alerta de teto on-demand ao carregar (best-effort, não bloqueia).
 *
 * @param period Período de análise. Default: mês corrente.
 */
export function useFinancialBI(period?: BIPeriod): UseFinancialBIResult {
  const [data, setData] = useState<FinancialBIData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string>('');
  const navigate = useNavigate();

  const resolvedPeriod: BIPeriod = period ?? currentMonthPeriod();

  const load = useCallback(
    async (cid?: string) => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          navigate('/login');
          return;
        }

        setLoading(true);
        setError(null);

        let resolvedCompanyId = cid ?? companyId;
        if (!resolvedCompanyId) {
          const { data: company, error: cErr } = await supabase
            .from('companies')
            .select('id')
            .eq('owner_id', user.id)
            .maybeSingle();
          if (cErr || !company) {
            setError('Empresa não encontrada.');
            setLoading(false);
            return;
          }
          resolvedCompanyId = company.id as string;
          setCompanyId(resolvedCompanyId);
        }

        const biData = await FinancialBIService.getAllBI(resolvedCompanyId, resolvedPeriod);
        setData(biData);

        // Avaliar alerta de teto on-demand (best-effort — não bloqueia UI)
        void SpendLimitService.evaluateSpendAlert(resolvedCompanyId).catch((alertErr) => {
          logError('useFinancialBI.evaluateSpendAlert', alertErr);
        });
      } catch (err) {
        logError('useFinancialBI.load', err);
        setError('Erro ao carregar indicadores financeiros.');
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, companyId, resolvedPeriod.start, resolvedPeriod.end],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        navigate('/login');
        return;
      }

      setLoading(true);
      setError(null);

      const { data: company, error: cErr } = await supabase
        .from('companies')
        .select('id')
        .eq('owner_id', user.id)
        .maybeSingle();

      if (cErr || !company) {
        if (active) {
          setError('Empresa não encontrada.');
          setLoading(false);
        }
        return;
      }

      const cid = company.id as string;
      if (active) setCompanyId(cid);

      const biData = await FinancialBIService.getAllBI(cid, resolvedPeriod);
      if (!active) return;

      setData(biData);
      setLoading(false);

      // Avaliar alerta de teto on-demand (best-effort)
      void SpendLimitService.evaluateSpendAlert(cid).catch((alertErr) => {
        logError('useFinancialBI.evaluateSpendAlert', alertErr);
      });
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, resolvedPeriod.start, resolvedPeriod.end]);

  return {
    data,
    loading,
    error,
    companyId,
    refresh: () => void load(),
  };
}
