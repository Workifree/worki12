/**
 * OrderReportService — Relatório financeiro da empresa (ex-"Relatório de Ordens").
 *
 * Contrato: ADR-20261127-relatorio-financeiro-e-planilha-de-pagamento (seções 3, 5 e 7).
 * A leitura sai TODA pela RPC `get_financial_report` (SECURITY DEFINER): o service não consulta
 * `jobs`, `applications`, `shift_payments` nem `workers`. O banco decide o escopo (Gestor = company
 * inteira; Encarregado confirmado = só os próprios turnos + cobertos), calcula horas, valor/hora,
 * período em data LOCAL (America/Sao_Paulo) e os totais (por freela, por dia, geral). A RPC nunca
 * devolve CPF/PIX — isso só existe em `get_payment_sheet` (ver `paymentSheetService`).
 *
 * "Ordem" = par (turno, freela) — ADR-20260816. SOMENTE LEITURA: não move saldo (Article 8 intacto).
 *
 * Valor: `amount_kind='realized'` = pagamento registrado/agendado (shift_payments.amount);
 * `'estimated'` = sem marcador, jobs.budget. Nunca somados num número só — a UI rotula os dois.
 * Horas: `hours` null = sem check-in/out (nunca 0); `hours_estimated` é só o planejado.
 *
 * Padrões: supabase.rpc direto (Art. 5), imports relativos, logError.
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { getSessionUserOrThrow } from '../lib/authSession';
import { getAuthenticatedCompanyId } from './companyScopeService';
import { roleLabel } from '../lib/statusLabels';
import { csvDecimal, csvFile, csvLine, csvSafeText } from '../lib/csv';
import type {
  FinancialReport,
  FinancialReportOutcome,
  FinancialReportRow,
  FinancialReportStatus,
  FinancialReportTotals,
  FinancialTotalsBase,
} from '../types';

// ---------------------------------------------------------------------------
// Tipos exportados
// ---------------------------------------------------------------------------

export type OrderStatus = FinancialReportStatus;

/** Filtros compartilhados pelo relatório e pela planilha de pagamento. */
export interface ReportFilters {
  /** Início do período (inclusive), YYYY-MM-DD. */
  from: string;
  /** Fim do período (inclusive), YYYY-MM-DD. */
  to: string;
  workerId?: string | null;
  /** Ignorado pelo banco para o Encarregado (escopo forçado). */
  responsibleId?: string | null;
  tagId?: string | null;
}

export interface GetReportParams extends ReportFilters {
  /** 'todas' (default) não filtra. */
  status?: OrderStatus | 'todas';
}

// ---------------------------------------------------------------------------
// Labels (pt-BR) — reaproveitados pela página e pelo CSV
// ---------------------------------------------------------------------------

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  aberta: 'Aberta',
  agendada: 'Agendada',
  paga: 'Paga',
  conciliada: 'Confirmada pelo freela',
};

export const PAYMENT_SOURCE_LABELS: Record<string, string> = {
  external_pix: 'PIX',
  cash: 'Dinheiro',
  other: 'Outro',
};

export const AMOUNT_KIND_LABELS = {
  realized: 'Real',
  estimated: 'Estimado',
  estimated_by_planned_hours: 'Estimado (horas previstas)',
} as const;

/** Texto exibido quando não há horas medidas (nunca "0h"). */
export const NO_HOURS_LABEL = 'sem check-in/out';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function normalizeBase(t: Partial<FinancialTotalsBase> | null | undefined): FinancialTotalsBase {
  return {
    shifts_count: num(t?.shifts_count),
    hours_total: num(t?.hours_total),
    hours_missing_count: num(t?.hours_missing_count),
    total_amount: num(t?.total_amount),
    total_paid: num(t?.total_paid),
    total_to_pay: num(t?.total_to_pay),
  };
}

function normalizeRow(r: FinancialReportRow): FinancialReportRow {
  return {
    ...r,
    checkout_confirmed: r.checkout_confirmed === true,
    hours: numOrNull(r.hours),
    hours_estimated: numOrNull(r.hours_estimated),
    amount: num(r.amount),
    hourly_rate: numOrNull(r.hourly_rate),
  };
}

function normalizeTotals(t: Partial<FinancialReportTotals> | null | undefined): FinancialReportTotals {
  return {
    by_worker: (t?.by_worker ?? []).map((w) => ({
      ...normalizeBase(w),
      worker_id: w.worker_id ?? null,
      worker_name: w.worker_name ?? null,
    })),
    by_day: (t?.by_day ?? []).map((d) => ({ ...normalizeBase(d), job_date: d.job_date })),
    overall: normalizeBase(t?.overall),
  };
}

const EMPTY_TOTALS: FinancialReportTotals = { by_worker: [], by_day: [], overall: normalizeBase(null) };

/** Formata dd/MM/yyyy (aceita date-only YYYY-MM-DD sem shift de fuso, ou timestamp ISO em horário de Brasília). */
export function formatReportDate(value: string): string {
  const only = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (only) return `${only[3]}/${only[2]}/${only[1]}`;
  return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** Formata dd/MM/yyyy HH:mm no fuso de Brasília. */
export function formatReportDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const time = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

// ---------------------------------------------------------------------------
// OrderReportService (exportado)
// ---------------------------------------------------------------------------

export const OrderReportService = {
  /**
   * Busca o relatório. O `outcome` diferente de 'ok' (forbidden, not_confirmed, range_too_large...)
   * volta como dado — a tela decide a mensagem. Falha de rede/RPC lança.
   */
  async getReport(params: GetReportParams): Promise<FinancialReport> {
    try {
      const user = await getSessionUserOrThrow();
      if (!user) {
        return { outcome: 'unauthenticated', scope: 'company', truncated: false, rows: [], totals: EMPTY_TOTALS };
      }
      // Empresa OPERADA pela sessão (seam) — nunca `user.id`.
      const companyId = await getAuthenticatedCompanyId();

      const { data, error } = await supabase.rpc('get_financial_report', {
        p_company_id: companyId,
        p_from: params.from,
        p_to: params.to,
        p_worker_id: params.workerId || null,
        p_responsible_id: params.responsibleId || null,
        p_tag_id: params.tagId || null,
        p_status: params.status && params.status !== 'todas' ? params.status : null,
      });
      if (error) throw error;

      const payload = (data ?? {}) as Partial<FinancialReport>;
      const outcome = (payload.outcome ?? 'ok') as FinancialReportOutcome;
      return {
        outcome,
        scope: payload.scope === 'own' ? 'own' : 'company',
        truncated: payload.truncated === true,
        rows: (payload.rows ?? []).map(normalizeRow),
        totals: normalizeTotals(payload.totals),
      };
    } catch (err) {
      logError('orderReport.getReport', err);
      throw err;
    }
  },
};

/** Mensagem pt-BR para um `outcome` que não é 'ok'. */
export function reportOutcomeMessage(outcome: FinancialReportOutcome): string {
  switch (outcome) {
    case 'range_too_large':
      return 'Período grande demais. Escolha no máximo 92 dias.';
    case 'not_confirmed':
      return 'Seu acesso ainda não foi confirmado pelo Gestor. Assim que for, o relatório dos seus turnos aparece aqui.';
    case 'forbidden':
      return 'Você não tem acesso a este relatório.';
    case 'invalid_range':
      return 'Confira as datas escolhidas.';
    case 'invalid_status':
      return 'Status inválido. Escolha outro filtro.';
    default:
      return 'Não foi possível carregar o relatório.';
  }
}

// ---------------------------------------------------------------------------
// CSV (UTF-8 com BOM, `;`, vírgula decimal, proteção contra fórmula)
// ---------------------------------------------------------------------------

export const REPORT_CSV_HEADER = [
  'Data', 'Etiqueta', 'Turno', 'Função', 'Responsável', 'Freela', 'Check-in', 'Check-out',
  'Horas', 'Valor/hora', 'Valor', 'Tipo do valor', 'Forma', 'Status', 'Data Pgto', 'ID do pagamento',
];

/** Gera o CSV a partir das linhas (já filtradas pelo banco). Texto livre protegido contra fórmula. */
export function toCSV(report: Pick<FinancialReport, 'rows'>): string {
  const lines = [csvLine(REPORT_CSV_HEADER)];
  for (const row of report.rows) {
    lines.push(
      csvLine([
        row.job_date ? formatReportDate(row.job_date) : '',
        csvSafeText(row.tag_name),
        csvSafeText(row.job_title),
        csvSafeText(roleLabel(row.job_category) || row.job_title || ''),
        csvSafeText(row.responsible_name),
        csvSafeText(row.worker_name ?? '—'),
        row.checkin_at ? formatReportDateTime(row.checkin_at) : '',
        row.checkout_at ? formatReportDateTime(row.checkout_at) : '',
        csvDecimal(row.hours),
        csvDecimal(row.hourly_rate),
        csvDecimal(row.amount),
        AMOUNT_KIND_LABELS[row.amount_kind] ?? row.amount_kind,
        row.source ? PAYMENT_SOURCE_LABELS[row.source] ?? row.source : '—',
        ORDER_STATUS_LABELS[row.status] ?? row.status,
        row.paid_at ? formatReportDate(row.paid_at) : '',
        csvSafeText(row.payment_id),
      ]),
    );
  }
  return csvFile(lines);
}
