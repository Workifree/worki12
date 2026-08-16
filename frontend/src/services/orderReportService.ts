/**
 * OrderReportService — Relatório de Ordens da empresa.
 *
 * GRANULARIDADE (revisado — ver `.harness/memory-bank/decisions/ADR-20260816-marcador-
 * pagamento-por-freela.md`): "Ordem" = par (turno, freela), não mais "turno" sozinho. Um
 * turno com N freelas com marcador de pagamento ativo gera N linhas — cada uma com o
 * pagamento e o nome do freela correspondente. Só cola em "1 linha = 1 turno" quando o
 * turno NÃO tem nenhum marcador ativo: aí a linha usa o freela "primário" (candidatura
 * mais avançada) como hoje, para o turno não sumir do relatório enquanto ninguém foi
 * pago. "Nota"/comprovante = pagamento (shift_payments, modo A — pagamento externo
 * registrado). Ao registrar o pagamento a application do freela já vira 'completed' —
 * este relatório dá a visão consolidada (aberta/paga/conciliada) + export para o
 * financeiro/estoquista.
 *
 * SOMENTE LEITURA — não cria/altera nenhuma linha, não move saldo, sem RPC (fora do
 * escopo do Article 8; este service nem toca `wallets`/`escrow_transactions`).
 *
 * Status derivado por linha (turno, freela):
 *  - 'conciliada': shift_payment ATIVO com status='recorded' E worker_confirmed_at preenchido
 *    (o freela confirmou o recebimento).
 *  - 'paga': shift_payment ATIVO com status='recorded', mas o freela ainda não confirmou.
 *  - 'aberta': sem shift_payment 'recorded' para aquele freela (pode ter 'scheduled'
 *    pendente, ou nenhum marcador no turno inteiro).
 *
 * Valor da linha: amount do shift_payment ATIVO daquele freela (recorded, senão
 * scheduled); na ausência de QUALQUER marcador no turno, cai para jobs.budget
 * (estimativa do turno — a linha única de fallback).
 *
 * `summary.total` conta LINHAS (pares turno+freela exibidos), não turnos distintos —
 * mesma base de `abertas`/`pagas`/`conciliadas`/`valorTotal` (todos somam sobre as
 * linhas, sem dupla contagem: cada marcador ativo entra em exatamente 1 linha).
 *
 * Data da ordem: jobs.start_date; se nulo, jobs.created_at (fallback — turnos antigos
 * podem não ter start_date preenchido).
 *
 * "Função" (CSV/coluna) = jobs.category (o papel/função do turno, ex.: "Garçom",
 * "Cozinheiro"); se category vier nulo, cai para jobs.title.
 *
 * Padrões do projeto:
 *  - supabase.from direto (Art. 5 — sem React Query).
 *  - Tipos locais (partial select) — não força atualização de types/index.ts (sem
 *    mudança de schema; `category` já existe em `jobs` mas ainda não está no Job
 *    global — mesma convenção já usada em financialBIService.ts).
 *  - Imports relativos (sem alias @/).
 *  - logError (nunca console.log).
 */

import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';

// ---------------------------------------------------------------------------
// Tipos exportados
// ---------------------------------------------------------------------------

export type OrderStatus = 'aberta' | 'paga' | 'conciliada';

export interface OrderRow {
  jobId: string;
  /**
   * Identifica o freela desta linha (worker_id do shift_payment ATIVO, ou da candidatura
   * primária quando o turno ainda não tem nenhum marcador). `null` só no caso-limite de
   * turno sem marcador E sem candidatura nenhuma. Usado como parte da key de linha
   * (`${jobId}:${workerId ?? 'none'}`) — um turno com N freelas pagos gera N `OrderRow`
   * com o mesmo `jobId` e `workerId` distintos (ADR-20260816).
   */
  workerId: string | null;
  /** ISO date ou date-only (YYYY-MM-DD) — start_date do turno, ou created_at como fallback. */
  date: string | null;
  title: string;
  category: string | null;
  workerName: string | null;
  amount: number;
  /** 'external_pix' | 'cash' | 'other' (ou null se não há marcador de pagamento). */
  source: string | null;
  /** Data do pagamento efetivado (só quando status='paga'/'conciliada'). */
  paidAt: string | null;
  status: OrderStatus;
}

export interface OrderReportSummary {
  total: number;
  abertas: number;
  pagas: number;
  conciliadas: number;
  valorTotal: number;
}

export interface OrderReport {
  rows: OrderRow[];
  summary: OrderReportSummary;
}

export interface GetReportParams {
  /** Início do período (inclusive), YYYY-MM-DD. */
  from: string;
  /** Fim do período (inclusive), YYYY-MM-DD. */
  to: string;
  /** Filtra as linhas retornadas por status derivado. 'todas' (default) não filtra. */
  status?: OrderStatus | 'todas';
}

// ---------------------------------------------------------------------------
// Tipos internos de linha bruta
// ---------------------------------------------------------------------------

interface JobRow {
  id: string;
  title: string;
  category: string | null;
  budget: number;
  start_date: string | null;
  created_at: string | null;
  status: string;
}

interface ShiftPaymentRow {
  job_id: string;
  worker_id: string;
  amount: number;
  source: string;
  status: 'scheduled' | 'recorded';
  paid_at: string | null;
  scheduled_for: string | null;
  worker_confirmed_at: string | null;
  /** Só usado para ordenar deterministicamente as linhas de um mesmo turno (mais antigo primeiro). */
  created_at: string | null;
}

interface ApplicationRow {
  job_id: string;
  worker_id: string;
  status: string;
  invitation_response: string | null;
}

// ---------------------------------------------------------------------------
// Labels (pt-BR) — reaproveitados pela página e pelo CSV
// ---------------------------------------------------------------------------

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  aberta: 'Aberta',
  paga: 'Paga',
  conciliada: 'Conciliada',
};

export const PAYMENT_SOURCE_LABELS: Record<string, string> = {
  external_pix: 'PIX',
  cash: 'Dinheiro',
  other: 'Outro',
};

// ---------------------------------------------------------------------------
// Helpers de data
// ---------------------------------------------------------------------------

/**
 * Parseia uma string de data como LOCAL, sem shift de fuso, quando for "date-only"
 * (YYYY-MM-DD — ex.: `jobs.start_date` quando a coluna é `date`, ou input `<input
 * type="date">`). Datas com timestamp completo (ISO com hora/timezone) usam o parser
 * padrão. Mesmo raciocínio de `ReceiptView.formatDateOnly` (evita off-by-one em BRT).
 */
function parseDateFlexible(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

/** Início do dia (00:00:00 local) a partir de um YYYY-MM-DD. */
function startOfDayLocal(dateOnly: string): Date {
  const [y, m, d] = dateOnly.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Fim do dia (23:59:59.999 local) a partir de um YYYY-MM-DD. */
function endOfDayLocal(dateOnly: string): Date {
  const [y, m, d] = dateOnly.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Formata uma data (ISO ou date-only) como dd/MM/yyyy, sem shift de fuso. */
function formatDDMMYYYY(value: string): string {
  const d = parseDateFlexible(value);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Helper: seleciona a application "primária" de um turno sem marcador de pagamento
// (usada só para exibir o nome do freela quando ainda não há shift_payment).
// ---------------------------------------------------------------------------

const PRIMARY_STATUS_PRIORITY = ['completed', 'hired', 'in_progress'];

function pickPrimaryApplication(apps: ApplicationRow[] | undefined): ApplicationRow | undefined {
  if (!apps || apps.length === 0) return undefined;
  for (const st of PRIMARY_STATUS_PRIORITY) {
    const found = apps.find((a) => a.status === st);
    if (found) return found;
  }
  const accepted = apps.find((a) => a.invitation_response === 'accepted');
  if (accepted) return accepted;
  return apps[0];
}

// ---------------------------------------------------------------------------
// OrderReportService (exportado)
// ---------------------------------------------------------------------------

export const OrderReportService = {
  /**
   * Busca o relatório de ordens (pares turno+freela) da empresa autenticada no período
   * informado. `summary` sempre reflete o PERÍODO COMPLETO (todos os status); `rows`
   * reflete o filtro de status quando informado (a tabela e o CSV usam `rows`).
   */
  async getReport({ from, to, status }: GetReportParams): Promise<OrderReport> {
    const empty: OrderReport = {
      rows: [],
      summary: { total: 0, abertas: 0, pagas: 0, conciliadas: 0, valorTotal: 0 },
    };

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return empty;

      // 1. Turnos da empresa (todos, exceto deletados) — filtragem por período é feita
      //    em JS pois precisamos do fallback start_date -> created_at.
      const { data: jobsData, error: jobsErr } = await supabase
        .from('jobs')
        .select('id, title, category, budget, start_date, created_at, status')
        .eq('company_id', user.id)
        .neq('status', 'deleted');

      if (jobsErr) {
        logError('orderReport.getReport.jobs', jobsErr);
        return empty;
      }

      const fromDate = startOfDayLocal(from);
      const toDate = endOfDayLocal(to);

      const periodJobs = ((jobsData ?? []) as JobRow[]).filter((job) => {
        const effective = job.start_date ?? job.created_at;
        if (!effective) return false;
        const d = parseDateFlexible(effective);
        return d >= fromDate && d <= toDate;
      });

      if (periodJobs.length === 0) return empty;

      const jobIds = periodJobs.map((j) => j.id);

      // 2. Marcadores de pagamento ATIVOS (scheduled ou recorded — voided é ignorado)
      //    e candidaturas/convites dos turnos do período, em paralelo. Query própria
      //    (não `PaymentRecordService.listActivePaymentsByJob`, que é por UM job_id — usá-la
      //    aqui significaria 1 chamada por turno do período = N+1 varrendo um mês inteiro).
      //    Uma única query `.in('job_id', jobIds)` cobre todos os turnos do período de
      //    uma vez. ADR-20260816 permite até 1 linha ativa POR (job_id, worker_id), então
      //    um turno pode trazer N linhas aqui (uma por freela pago/agendado).
      const [paymentsResult, appsResult] = await Promise.all([
        supabase
          .from('shift_payments')
          .select(
            'job_id, worker_id, amount, source, status, paid_at, scheduled_for, worker_confirmed_at, created_at',
          )
          .in('job_id', jobIds)
          .in('status', ['scheduled', 'recorded'])
          .order('created_at', { ascending: true }),
        supabase
          .from('applications')
          .select('job_id, worker_id, status, invitation_response')
          .in('job_id', jobIds),
      ]);

      if (paymentsResult.error) {
        logError('orderReport.getReport.shiftPayments', paymentsResult.error);
      }
      if (appsResult.error) {
        logError('orderReport.getReport.applications', appsResult.error);
      }

      const payments = (paymentsResult.data ?? []) as ShiftPaymentRow[];
      const applications = (appsResult.data ?? []) as ApplicationRow[];

      // ADR-20260816: o UNIQUE parcial agora é (job_id, worker_id) WHERE status IN
      // ('scheduled','recorded') — no máximo 1 linha ativa POR FREELA, mas um turno pode
      // ter N linhas (uma por freela). Agrupamos por job_id preservando TODAS as linhas
      // (nada é colapsado); dentro de um mesmo (job_id, worker_id) — que não deveria
      // repetir sob o índice atual, mas fica defensivo como o resto do service — 'recorded'
      // tem precedência sobre 'scheduled'.
      const paymentsByJob = new Map<string, ShiftPaymentRow[]>();
      for (const p of payments) {
        const list = paymentsByJob.get(p.job_id) ?? [];
        const dupIdx = list.findIndex((existing) => existing.worker_id === p.worker_id);
        if (dupIdx === -1) {
          list.push(p);
        } else if (list[dupIdx].status === 'scheduled' && p.status === 'recorded') {
          list[dupIdx] = p;
        }
        paymentsByJob.set(p.job_id, list);
      }

      const appsByJob = new Map<string, ApplicationRow[]>();
      for (const a of applications) {
        const list = appsByJob.get(a.job_id) ?? [];
        list.push(a);
        appsByJob.set(a.job_id, list);
      }

      // 3. Nomes dos freelas — union de worker_ids vindos de pagamentos + applications.
      const workerIds = [
        ...new Set([
          ...payments.map((p) => p.worker_id),
          ...applications.map((a) => a.worker_id),
        ]),
      ];

      const workerNameById = new Map<string, string>();
      if (workerIds.length > 0) {
        const { data: workers, error: workersErr } = await supabase
          .from('workers')
          .select('id, full_name')
          .in('id', workerIds);
        if (workersErr) {
          logError('orderReport.getReport.workers', workersErr);
        }
        for (const w of (workers ?? []) as Array<{ id: string; full_name: string }>) {
          workerNameById.set(w.id, w.full_name);
        }
      }

      // 4. Montar as linhas do relatório — uma linha por (turno, freela) quando o turno
      //    tem marcador(es) ativo(s); fallback de 1 linha (freela "primário" ou vazio)
      //    quando o turno não tem nenhum marcador, para não sumir do relatório.
      function buildRow(job: JobRow, payment: ShiftPaymentRow | undefined, workerId: string | null): OrderRow {
        let derivedStatus: OrderStatus = 'aberta';
        if (payment?.status === 'recorded') {
          derivedStatus = payment.worker_confirmed_at ? 'conciliada' : 'paga';
        }

        const amount = payment ? Number(payment.amount) : Number(job.budget ?? 0);
        const source = payment?.source ?? null;
        const paidAt = payment?.status === 'recorded' ? payment.paid_at : null;

        return {
          jobId: job.id,
          workerId,
          date: job.start_date ?? job.created_at ?? null,
          title: job.title,
          category: job.category ?? null,
          workerName: workerId ? workerNameById.get(workerId) ?? null : null,
          amount,
          source,
          paidAt,
          status: derivedStatus,
        };
      }

      const allRows: OrderRow[] = periodJobs.flatMap((job) => {
        const jobPayments = paymentsByJob.get(job.id) ?? [];

        if (jobPayments.length === 0) {
          const primaryApp = pickPrimaryApplication(appsByJob.get(job.id));
          const workerId = primaryApp?.worker_id ?? null;
          return [buildRow(job, undefined, workerId)];
        }

        return jobPayments.map((payment) => buildRow(job, payment, payment.worker_id));
      });

      // Mais recente primeiro (turnos com N linhas mantêm a ordem estável de inserção
      // entre si — sort é estável e as linhas já chegam ordenadas por created_at ASC).
      allRows.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return parseDateFlexible(b.date).getTime() - parseDateFlexible(a.date).getTime();
      });

      const summary: OrderReportSummary = {
        total: allRows.length,
        abertas: allRows.filter((r) => r.status === 'aberta').length,
        pagas: allRows.filter((r) => r.status === 'paga').length,
        conciliadas: allRows.filter((r) => r.status === 'conciliada').length,
        valorTotal: allRows.reduce((acc, r) => acc + r.amount, 0),
      };

      const rows =
        status && status !== 'todas' ? allRows.filter((r) => r.status === status) : allRows;

      return { rows, summary };
    } catch (err) {
      logError('orderReport.getReport', err);
      return empty;
    }
  },
};

// ---------------------------------------------------------------------------
// CSV (pt-BR, delimitador ';' — Excel pt-BR abre corretamente sem passo extra)
// ---------------------------------------------------------------------------

function csvEscape(field: string): string {
  if (/[;"\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/** Gera o CSV do relatório (usa `report.rows` — já respeita o filtro de status aplicado). */
export function toCSV(report: OrderReport): string {
  const header = ['Data', 'Função', 'Freela', 'Valor', 'Forma', 'Status', 'Data Pgto'];
  const lines = [header.map(csvEscape).join(';')];

  for (const row of report.rows) {
    const dateStr = row.date ? formatDDMMYYYY(row.date) : '';
    const paidAtStr = row.paidAt ? formatDDMMYYYY(row.paidAt) : '';
    const valorStr = row.amount.toFixed(2).replace('.', ',');
    const formaStr = row.source ? PAYMENT_SOURCE_LABELS[row.source] ?? row.source : '—';
    const funcaoStr = row.category ?? row.title;
    const statusStr = ORDER_STATUS_LABELS[row.status];

    lines.push(
      [
        dateStr,
        funcaoStr,
        row.workerName ?? '—',
        valorStr,
        formaStr,
        statusStr,
        paidAtStr,
      ]
        .map(csvEscape)
        .join(';'),
    );
  }

  return lines.join('\r\n');
}
