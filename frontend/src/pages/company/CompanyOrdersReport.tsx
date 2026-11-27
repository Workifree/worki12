/**
 * CompanyOrdersReport — Relatório financeiro da empresa.
 *
 * "Ordem" = par (turno, freela) (ADR-20260816). Os dados vêm da RPC `get_financial_report`
 * (ADR-20261127): o banco decide o escopo. Gestor vê a company inteira, com filtro de responsável
 * e botão da Planilha de pagamento (CPF/PIX). Encarregado confirmado vê só os turnos dele, sem
 * filtro de responsável, sem planilha e sem nenhum dado pessoal (a RPC nunca devolve CPF/PIX).
 *
 * Valor "real" = pagamento registrado/agendado; "estimado" = sem pagamento, usa o orçamento do
 * turno. Nunca somados num número só. Horas vazias = "sem check-in/out" (nunca "0h").
 *
 * Padrões: useState + useEffect, imports relativos, TS strict, design neo-brutalista empresa.
 */

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import SectionTabs from '../../components/SectionTabs';
import { FileText, FileSpreadsheet, Printer, Download, Loader2 } from 'lucide-react';
import {
  OrderReportService,
  toCSV,
  reportOutcomeMessage,
  formatReportDate,
  formatReportDateTime,
  ORDER_STATUS_LABELS,
  PAYMENT_SOURCE_LABELS,
  AMOUNT_KIND_LABELS,
  NO_HOURS_LABEL,
} from '../../services/orderReportService';
import type { OrderStatus } from '../../services/orderReportService';
import { isGestor } from '../../services/companyScopeService';
import { useCurrentCompanyState } from '../../hooks/useCurrentCompany';
import { logError } from '../../lib/logger';
import { downloadCsv } from '../../lib/csv';
import { useToast } from '../../contexts/ToastContext';
import PageMeta from '../../components/PageMeta';
import PaymentSheetModal from '../../components/company/PaymentSheetModal';
import { Alert, Button, Card, EmptyState, ErrorState, Field, PageHeader } from '../../components/ui';
import { roleLabel } from '../../lib/statusLabels';
import { formatBRL } from '../../lib/currency';
import type { FinancialReport, FinancialReportRow } from '../../types';

// ---------------------------------------------------------------------------
// Helpers de data/format
// ---------------------------------------------------------------------------

function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 = domingo
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function formatHours(hours: number | null): string {
  if (hours === null) return NO_HOURS_LABEL;
  return `${hours.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h`;
}

function formatTime(value: string | null): string {
  return value ? formatReportDateTime(value) : '—';
}

type PresetKey = 'hoje' | 'semana' | 'mes' | 'custom';

const STATUS_OPTIONS: Array<{ key: OrderStatus | 'todas'; label: string }> = [
  { key: 'todas', label: 'Todas' },
  { key: 'aberta', label: 'Aberta' },
  { key: 'agendada', label: 'Agendada' },
  { key: 'paga', label: 'Paga' },
  { key: 'conciliada', label: 'Confirmada pelo freela' },
];

const STATUS_BADGE_CLASS: Record<OrderStatus, string> = {
  aberta: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  agendada: 'bg-gray-100 text-gray-700 border-gray-300',
  paga: 'bg-blue-100 text-blue-700 border-blue-300',
  conciliada: 'bg-primary-light text-primary-dark border-primary',
};

interface Option {
  id: string;
  label: string;
}

/** Une opções novas às já conhecidas (a lista não encolhe quando um filtro é aplicado). */
function mergeOptions(prev: Option[], next: Option[]): Option[] {
  const map = new Map(prev.map((o) => [o.id, o]));
  for (const o of next) map.set(o.id, o);
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

function optionsFromRows(rows: FinancialReportRow[]) {
  const workers: Option[] = [];
  const responsibles: Option[] = [];
  const tags: Option[] = [];
  for (const r of rows) {
    if (r.worker_id) workers.push({ id: r.worker_id, label: r.worker_name ?? 'Freela' });
    if (r.responsible_id) responsibles.push({ id: r.responsible_id, label: r.responsible_name ?? 'Responsável' });
    if (r.tag_id) tags.push({ id: r.tag_id, label: r.tag_name ?? 'Loja' });
  }
  return { workers, responsibles, tags };
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function CompanyOrdersReport() {
  const { addToast } = useToast();
  const { company, resolved } = useCurrentCompanyState();
  const gestor = resolved && isGestor(company);

  const [preset, setPreset] = useState<PresetKey>('mes');
  const [from, setFrom] = useState<string>(toDateInput(startOfMonth(new Date())));
  const [to, setTo] = useState<string>(toDateInput(new Date()));
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'todas'>('todas');
  const [workerId, setWorkerId] = useState('');
  const [responsibleId, setResponsibleId] = useState('');
  const [tagId, setTagId] = useState('');

  const [workerOptions, setWorkerOptions] = useState<Option[]>([]);
  const [responsibleOptions, setResponsibleOptions] = useState<Option[]>([]);
  const [tagOptions, setTagOptions] = useState<Option[]>([]);

  const [report, setReport] = useState<FinancialReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  // O filtro de responsável não existe para o Encarregado (escopo forçado no banco).
  const effectiveResponsibleId = gestor ? responsibleId : '';

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await OrderReportService.getReport({
          from,
          to,
          status: statusFilter,
          workerId,
          responsibleId: effectiveResponsibleId,
          tagId,
        });
        if (!active) return;
        setReport(result);
        if (result.outcome === 'ok') {
          const opts = optionsFromRows(result.rows);
          setWorkerOptions((p) => mergeOptions(p, opts.workers));
          setResponsibleOptions((p) => mergeOptions(p, opts.responsibles));
          setTagOptions((p) => mergeOptions(p, opts.tags));
        }
      } catch (err) {
        logError('CompanyOrdersReport.fetchReport', err);
        if (active) setError('Não foi possível carregar o relatório.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [from, to, statusFilter, workerId, effectiveResponsibleId, tagId, reloadTick]);

  const retry = useCallback(() => setReloadTick((n) => n + 1), []);

  function applyPreset(key: PresetKey) {
    const now = new Date();
    if (key === 'hoje') {
      const today = toDateInput(now);
      setFrom(today);
      setTo(today);
    } else if (key === 'semana') {
      setFrom(toDateInput(startOfWeek(now)));
      setTo(toDateInput(now));
    } else if (key === 'mes') {
      setFrom(toDateInput(startOfMonth(now)));
      setTo(toDateInput(now));
    }
    setPreset(key);
  }

  function handleCustomDateChange(which: 'from' | 'to', value: string) {
    setPreset('custom');
    if (which === 'from') setFrom(value);
    else setTo(value);
  }

  function handleExportCSV() {
    if (!report || report.rows.length === 0) {
      addToast('Nenhum pagamento para exportar.', 'info');
      return;
    }
    downloadCsv(toCSV(report), `relatorio-financeiro-${from}_a_${to}.csv`);
  }

  const okReport = report?.outcome === 'ok' ? report : null;
  const rows: FinancialReportRow[] = okReport?.rows ?? [];
  const totals = okReport?.totals;
  const periodLabel = `${formatReportDate(from)} a ${formatReportDate(to)}`;
  const outcomeProblem = report && report.outcome !== 'ok' ? reportOutcomeMessage(report.outcome) : null;

  return (
    <div className="flex flex-col gap-6 pb-20 md:pb-12 font-sans text-accent max-w-7xl mx-auto print:pb-0">
      <PageMeta title="Relatório de Pagamentos" />

      <div className="print:hidden">
        {/* As abas levam a "Operação", que é só do Gestor: o Encarregado não as vê. */}
        {gestor && <SectionTabs section="relatorios" />}
        <PageHeader
          title="Relatório de Pagamentos"
          subtitle={
            gestor
              ? 'Quanto foi pago, a quem, quando e quantas horas — com exportação para o financeiro. Um turno com mais de um freela vira uma ordem por freela.'
              : 'Os seus turnos: horas, valores e situação do pagamento de cada freela.'
          }
          className="!mb-0"
        />
      </div>

      {/* Cabeçalho de impressão — só aparece no print */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-bold">Relatório de Pagamentos</h1>
        <p className="text-sm font-semibold">Período: {periodLabel}</p>
      </div>

      {/* Filtros + ações — não imprime */}
      <Card className="print:hidden flex flex-col gap-5">
        <div role="group" aria-label="Período" className="flex flex-wrap gap-2 self-start">
          {(['hoje', 'semana', 'mes'] as PresetKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key)}
              aria-pressed={preset === key}
              className={`h-11 px-5 rounded-full border-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                preset === key ? 'bg-black text-white border-black' : 'bg-white text-gray-700 border-gray-300 hover:border-black'
              }`}
            >
              {key === 'hoje' ? 'Dia de hoje' : key === 'semana' ? 'Semana' : 'Mês'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="De">
            <input id="fromInput" type="date" value={from} max={to} onChange={(e) => handleCustomDateChange('from', e.target.value)} />
          </Field>
          <Field label="Até">
            <input id="toInput" type="date" value={to} min={from} onChange={(e) => handleCustomDateChange('to', e.target.value)} />
          </Field>
          <Field label="Status">
            <select id="statusSelect" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as OrderStatus | 'todas')}>
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Freela">
            <select id="workerSelect" value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
              <option value="">Todos</option>
              {workerOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </Field>
          {gestor && (
            <Field label="Responsável">
              <select id="responsibleSelect" value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
                <option value="">Todos</option>
                {responsibleOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </Field>
          )}
          <Field label="Loja">
            <select id="tagSelect" value={tagId} onChange={(e) => setTagId(e.target.value)}>
              <option value="">Todas</option>
              {tagOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </Field>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 border-t-2 border-gray-100 pt-5">
          <Button
            variant="dark"
            onClick={handleExportCSV}
            disabled={loading || rows.length === 0}
            iconLeft={<Download size={16} />}
            data-copilot="empresa.relatorio.exportar-csv"
          >
            Exportar CSV
          </Button>
          <Button variant="secondary" onClick={() => window.print()} disabled={loading || rows.length === 0} iconLeft={<Printer size={16} />}>
            Imprimir / PDF
          </Button>
          {gestor && (
            <Button variant="secondary" onClick={() => setSheetOpen(true)} disabled={loading || !!outcomeProblem} iconLeft={<FileSpreadsheet size={16} />}>
              Planilha de pagamento
            </Button>
          )}
        </div>
      </Card>

      {sheetOpen && gestor && (
        <PaymentSheetModal
          filters={{ from, to, workerId, responsibleId, tagId }}
          statusFilterIgnored={statusFilter !== 'todas'}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {okReport?.truncated && (
        <Alert tone="warning" className="print:hidden">
          Há mais de 5.000 ordens no período: só parte delas está na lista. Reduza o período ou use os filtros.
        </Alert>
      )}

      {/* Resumo: pago e a pagar SEPARADOS (a pagar pode incluir valores estimados) */}
      {totals && !loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 print:grid-cols-3">
          <SummaryCard
            label="Pago"
            value={formatBRL(totals.overall.total_paid)}
            detail={`${rows.filter((r) => r.status === 'paga' || r.status === 'conciliada').length} pagas de ${totals.overall.shifts_count} ordens`}
          />
          <SummaryCard
            label="A pagar (pode incluir estimado)"
            value={formatBRL(totals.overall.total_to_pay)}
            detail={`${rows.filter((r) => r.status === 'aberta' || r.status === 'agendada').length} em aberto ou agendadas`}
            className="text-yellow-700"
          />
          <SummaryCard
            label="Horas medidas"
            value={formatHours(totals.overall.hours_total > 0 ? totals.overall.hours_total : null)}
            detail={
              totals.overall.hours_missing_count > 0
                ? `${totals.overall.hours_missing_count} ordens ${NO_HOURS_LABEL}`
                : `${totals.overall.shifts_count} ordens`
            }
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 print:hidden">
          <span role="status"><span className="sr-only">Carregando</span><Loader2 size={28} aria-hidden="true" className="animate-spin text-gray-600" /></span>
        </div>
      ) : error ? (
        <ErrorState title={error} onRetry={retry} className="print:hidden" />
      ) : outcomeProblem ? (
        <Alert tone="warning" role="alert">{outcomeProblem}</Alert>
      ) : rows.length === 0 ? (
        <EmptyState icon={FileText} title="Nenhum pagamento no período." description="Troque o período ou os filtros para ver outras ordens." />
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="flex flex-col gap-3 md:hidden print:hidden">
            {rows.map((row) => (
              <OrderCard key={`${row.job_id}:${row.worker_id ?? 'none'}`} row={row} showResponsible={gestor} />
            ))}
          </div>

          {/* Desktop / impressão: tabela */}
          <Card padding="none" className="hidden md:block print:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-black bg-gray-50 text-left">
                  <Th>Data</Th>
                  <Th>Turno</Th>
                  <Th>Loja</Th>
                  {gestor && <Th>Responsável</Th>}
                  <Th>Freela</Th>
                  <Th>Check-in / out</Th>
                  <Th right>Horas</Th>
                  <Th right>Valor/hora</Th>
                  <Th right>Valor</Th>
                  <Th>Forma</Th>
                  <Th>Status</Th>
                  <Th>Data Pgto</Th>
                  <Th>Recibo</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.job_id}:${row.worker_id ?? 'none'}`} className="border-b border-gray-200 last:border-0 align-top">
                    <td className="px-3 py-3 font-bold whitespace-nowrap">{row.job_date ? formatReportDate(row.job_date) : '—'}</td>
                    <td className="px-3 py-3 font-medium">
                      {row.job_title ?? '—'}
                      {roleLabel(row.job_category) && <span className="block text-xs text-gray-600">{roleLabel(row.job_category)}</span>}
                    </td>
                    <td className="px-3 py-3">{row.tag_name ?? '—'}</td>
                    {gestor && <td className="px-3 py-3">{row.responsible_name ?? '—'}</td>}
                    <td className="px-3 py-3 font-medium">{row.worker_name ?? '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs">
                      {formatTime(row.checkin_at)}
                      <span className="block">{formatTime(row.checkout_at)}</span>
                    </td>
                    <td className="px-3 py-3 tabular-nums text-right whitespace-nowrap">{formatHours(row.hours)}</td>
                    <td className="px-3 py-3 tabular-nums text-right whitespace-nowrap">{row.hourly_rate !== null ? formatBRL(row.hourly_rate) : '—'}</td>
                    <td className="px-3 py-3 font-bold tabular-nums text-right whitespace-nowrap">
                      {formatBRL(row.amount)}
                      <span className="block text-xs font-medium text-gray-600">{AMOUNT_KIND_LABELS[row.amount_kind]}</span>
                    </td>
                    <td className="px-3 py-3">{row.source ? PAYMENT_SOURCE_LABELS[row.source] ?? row.source : '—'}</td>
                    <td className="px-3 py-3"><StatusBadge status={row.status} /></td>
                    <td className="px-3 py-3 whitespace-nowrap">{row.paid_at ? formatReportDate(row.paid_at) : '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs tabular-nums" title={row.payment_id ?? undefined}>
                      {row.payment_id ? `#${row.payment_id.slice(0, 8)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {totals && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 break-inside-avoid">
              <Card padding="none" className="overflow-x-auto">
                <h2 className="px-4 pt-4 pb-2 text-sm font-bold">Total por freela</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-black bg-gray-50 text-left">
                      <Th>Freela</Th><Th right>Ordens</Th><Th right>Horas</Th><Th right>Pago</Th><Th right>A pagar</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {totals.by_worker.map((w) => (
                      <tr key={w.worker_id ?? 'none'} className="border-b border-gray-200 last:border-0">
                        <td className="px-3 py-2 font-medium">{w.worker_name ?? 'Sem freela'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{w.shifts_count}</td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{totalHours(w.hours_total, w.hours_missing_count)}</td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatBRL(w.total_paid)}</td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatBRL(w.total_to_pay)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <Card padding="none" className="overflow-x-auto">
                <h2 className="px-4 pt-4 pb-2 text-sm font-bold">Total por dia</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-black bg-gray-50 text-left">
                      <Th>Dia</Th><Th right>Ordens</Th><Th right>Horas</Th><Th right>Pago</Th><Th right>A pagar</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {totals.by_day.map((d) => (
                      <tr key={d.job_date} className="border-b border-gray-200 last:border-0">
                        <td className="px-3 py-2 font-bold whitespace-nowrap">{formatReportDate(d.job_date)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{d.shifts_count}</td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{totalHours(d.hours_total, d.hours_missing_count)}</td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatBRL(d.total_paid)}</td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatBRL(d.total_to_pay)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------------

/** Horas somadas; "sem check-in/out" quando nenhuma ordem teve medição. */
function totalHours(total: number, missing: number): string {
  if (total <= 0) return NO_HOURS_LABEL;
  return missing > 0 ? `${formatHours(total)} (+${missing} sem check-in/out)` : formatHours(total);
}

function Th({ children, right = false }: { children: string; right?: boolean }) {
  return <th className={`px-3 py-3 font-semibold text-xs text-gray-600 ${right ? 'text-right' : ''}`}>{children}</th>;
}

function SummaryCard({ label, value, detail, className = '' }: { label: string; value: string; detail: string; className?: string }) {
  return (
    <Card padding="sm">
      <p className="text-xs font-semibold text-gray-600 mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums whitespace-nowrap ${className}`}>{value}</p>
      <p className="text-xs text-gray-600">{detail}</p>
    </Card>
  );
}

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-pill border whitespace-nowrap ${STATUS_BADGE_CLASS[status]}`}>
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}

function OrderCard({ row, showResponsible }: { row: FinancialReportRow; showResponsible: boolean }) {
  const context = [row.job_title, roleLabel(row.job_category), row.job_date ? formatReportDate(row.job_date) : null].filter(Boolean).join(' · ');
  const extra = [row.tag_name, showResponsible ? row.responsible_name : null].filter(Boolean).join(' · ');
  return (
    <Card padding="sm" className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-sm break-words">{row.worker_name ?? 'Sem freela'}</p>
          <p className="text-xs text-gray-600 break-words">{context}</p>
          {extra && <p className="text-xs text-gray-600 break-words">{extra}</p>}
        </div>
        <span className="shrink-0 text-right font-bold tabular-nums">
          {formatBRL(row.amount)}
          <span className="block text-xs font-medium text-gray-600">{AMOUNT_KIND_LABELS[row.amount_kind]}</span>
        </span>
      </div>
      <p className="text-xs text-gray-600">
        {formatHours(row.hours)}
        {row.hourly_rate !== null && ` · ${formatBRL(row.hourly_rate)}/h`}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <StatusBadge status={row.status} />
        {row.source && <span>{PAYMENT_SOURCE_LABELS[row.source] ?? row.source}</span>}
        {row.paid_at && <span>Pago em {formatReportDate(row.paid_at)}</span>}
        {row.payment_id && <span>Recibo #{row.payment_id.slice(0, 8)}</span>}
      </div>
      <Link to={`/company/jobs/${row.job_id}/candidates`} className="inline-flex min-h-11 items-center self-start text-sm font-bold underline">
        {row.status === 'aberta' && row.worker_name ? 'Registrar pagamento' : 'Abrir turno'}
      </Link>
    </Card>
  );
}
