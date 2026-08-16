/**
 * OrderReportService — Relatório de Ordens da empresa.
 *
 * GRANULARIDADE (ver `.harness/memory-bank/decisions/ADR-20260816-marcador-pagamento-
 * por-freela.md`): "Ordem" = par (turno, freela), não mais "turno" sozinho. A linha é
 * ancorada na UNIÃO de duas fontes, chaveada por `(job_id, worker_id)` para nunca
 * duplicar:
 *   - marcadores de pagamento ATIVOS (shift_payments, status IN scheduled/recorded);
 *   - candidaturas CONTRATADAS (applications.status IN hired/in_progress/completed).
 * Um freela contratado sem marcador ainda é passivo em aberto — precisa aparecer como
 * 'aberta', não sumir do relatório só porque ainda não foi pago. Um freela com marcador
 * usa os dados do pagamento independente do status da candidatura (o pagamento é a
 * fonte mais forte). Só cai para "1 linha, freela vazio" quando o turno não tem NENHUM
 * marcador E NENHUMA candidatura contratada (turno sem elenco nenhum) — sempre aparece,
 * nunca some. "Nota"/comprovante = pagamento (shift_payments, modo A — pagamento externo
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
 *  - 'aberta': freela contratado sem shift_payment 'recorded' (pode ter 'scheduled'
 *    pendente, ou nenhum marcador — passivo em aberto), OU a linha única de fallback de
 *    um turno sem elenco nenhum.
 *
 * Valor da linha: amount do shift_payment ATIVO daquele freela (recorded, senão
 * scheduled); na ausência de marcador para aquele freela (contratado mas ainda não
 * pago, ou fallback de turno sem elenco), cai para jobs.budget — é uma ESTIMATIVA do
 * turno inteiro, repetida em cada linha 'aberta' daquele turno (não há split por freela
 * no dado disponível; ver `valorPrevisto` abaixo).
 *
 * `summary.total` conta LINHAS (pares turno+freela exibidos), não turnos distintos —
 * mesma base de `abertas`/`pagas`/`conciliadas` (todos somam sobre as linhas, sem
 * dupla contagem: cada `(job_id, worker_id)` entra em exatamente 1 linha).
 *
 * `summary.valorPago` x `summary.valorPrevisto`: linhas 'aberta' carregam um valor
 * ESTIMADO (jobs.budget), linhas 'paga'/'conciliada' carregam um valor REALIZADO
 * (shift_payment.amount) — são naturezas diferentes de número e não devem ser somadas
 * num único "Valor Total" (isso já foi o bug de origem: some-se ao juntar). Por isso o
 * summary expõe os dois separados: `valorPago` = soma das linhas paga+conciliada (dinheiro
 * que já saiu, registrado); `valorPrevisto` = soma das linhas 'aberta' (passivo/estimativa
 * do que ainda falta pagar). A UI rotula os dois cards nomeando a natureza de cada um —
 * nunca um único "Valor Total" que misturaria as duas.
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
 *  - Sem N+1: `applications` é buscado em lote (`.in('job_id', jobIds)`), mesmo padrão
 *    já usado para `shift_payments` — o relatório varre um período inteiro de uma vez.
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
   * Identifica o freela desta linha: worker_id do shift_payment ATIVO, ou da candidatura
   * contratada (`hired`/`in_progress`/`completed`) quando não há marcador para ele.
   * `null` só no caso-limite de turno sem marcador E sem candidatura contratada nenhuma
   * (turno sem elenco). Usado como parte da key de linha (`${jobId}:${workerId ?? 'none'}`)
   * — um turno com N freelas (pagos e/ou só contratados) gera N `OrderRow` com o mesmo
   * `jobId` e `workerId` distintos, nunca duplicando o mesmo par (ADR-20260816).
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
  /** Soma das linhas 'paga' + 'conciliada' — valor REALIZADO (shift_payment.amount). */
  valorPago: number;
  /** Soma das linhas 'aberta' — valor ESTIMADO/passivo (jobs.budget, ainda não pago). */
  valorPrevisto: number;
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
// Elenco contratado: status de application que conta como "freela em passivo" mesmo
// sem marcador de pagamento (ADR-20260816). Convite pendente/recusado/candidatura ainda
// não decidida NÃO contam — só quem de fato está/esteve escalado no turno.
// ---------------------------------------------------------------------------

const CONTRACTED_STATUSES = new Set(['hired', 'in_progress', 'completed']);

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
      summary: { total: 0, abertas: 0, pagas: 0, conciliadas: 0, valorPago: 0, valorPrevisto: 0 },
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

      // 4. Montar as linhas do relatório — a chave de linha é a UNIÃO de marcadores
      //    ativos ∪ candidaturas contratadas, por `(job_id, worker_id)` (ADR-20260816):
      //     - freela com marcador → linha com os dados do pagamento;
      //     - freela contratado (hired/in_progress/completed) SEM marcador → linha
      //       'aberta' com o nome dele e o valor previsto (job.budget) — é o passivo
      //       em aberto que o relatório existe para mostrar;
      //     - turno sem marcador E sem contratado nenhum → 1 linha de fallback, freela
      //       vazio, pra nunca sumir do relatório.
      //    A união é por Set de worker_id: cada par (job_id, worker_id) entra em
      //    exatamente 1 linha, nunca duplicando quem tem marcador E application.
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
        const paymentByWorker = new Map<string, ShiftPaymentRow>();
        for (const p of jobPayments) paymentByWorker.set(p.worker_id, p);

        const contractedWorkerIds = (appsByJob.get(job.id) ?? [])
          .filter((a) => CONTRACTED_STATUSES.has(a.status))
          .map((a) => a.worker_id);

        // Set preserva ordem de 1ª ocorrência: primeiro os workers com marcador (já vêm
        // ordenados por created_at ASC), depois quem só está contratado sem marcador.
        const unionWorkerIds = new Set<string>([...paymentByWorker.keys(), ...contractedWorkerIds]);

        if (unionWorkerIds.size === 0) {
          return [buildRow(job, undefined, null)];
        }

        return [...unionWorkerIds].map((workerId) => buildRow(job, paymentByWorker.get(workerId), workerId));
      });

      // Mais recente primeiro (turnos com N linhas mantêm a ordem estável de inserção
      // entre si — sort é estável e as linhas já chegam ordenadas por created_at ASC).
      allRows.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return parseDateFlexible(b.date).getTime() - parseDateFlexible(a.date).getTime();
      });

      // valorPago x valorPrevisto são somados separadamente de propósito — misturar
      // valor REALIZADO (pago/conciliada) com valor ESTIMADO (aberta = jobs.budget) num
      // único total inflaria/mentiria a leitura do passivo (ver JSDoc do topo).
      const summary: OrderReportSummary = {
        total: allRows.length,
        abertas: allRows.filter((r) => r.status === 'aberta').length,
        pagas: allRows.filter((r) => r.status === 'paga').length,
        conciliadas: allRows.filter((r) => r.status === 'conciliada').length,
        valorPago: allRows
          .filter((r) => r.status === 'paga' || r.status === 'conciliada')
          .reduce((acc, r) => acc + r.amount, 0),
        valorPrevisto: allRows
          .filter((r) => r.status === 'aberta')
          .reduce((acc, r) => acc + r.amount, 0),
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
